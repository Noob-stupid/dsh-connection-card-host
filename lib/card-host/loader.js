/**
 * CardHost — 卡片宿主。
 *
 * 对照 docs/card-protocol.md 实现：
 *   - 模板发现：内置（随插件发布的 cards/）+ 已安装（$DSH_HOME/connection-cards/cards/）
 *   - 一键加到连接：loadCard(templateId, connectionId)
 *   - 面板渲染：renderPanel(api) 优先；否则用 DOM 替身调 mountPanel 取 innerHTML
 *   - 启动重放：已持久化在连接上的卡片重新 import + apply
 *
 * 卡片模块跑在**宿主进程**（Node），浏览器只拿渲染好的 HTML —— 因为卡片的
 * apply 要订阅事件、注册工具，这些都在宿主侧；而 mountPanel 需要 DOM，
 * 宿主没有 DOM，所以给一个只支持 innerHTML 的替身。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dshHomeDir } from '../core/persistence.js';
import { parseVersionedDirName } from './card-paths.js';
import { checkApiVersion } from './card-api-version.js';
import { fileURLToPath } from 'node:url';
import { CardRegistry } from './registry.js';
import { importCardModule, resolveCardEntry } from './sandbox.js';
import { createCardApi } from './card-api.js';
import { createShimElement } from './dom-shim.js';
import { adapterStatusOf } from '../adapter/status.js';
import { readClientArtifact } from './client-artifact.js';
export class CardHost {
    registry = new CardRegistry();
    manager;
    eventBus;
    adapter;
    /** 连接两端的规范交流记录（CardAPI.send/read 走它）。 */
    messageLog;
    options;
    /**
     * 卡片适配宿主（**可选**）：清单里带 `dshCard.adapter` 的卡片交给它挂载。
     *
     * 用**接口**而不是直接 import 适配模块，是为了让这一层保持单向依赖：
     * 卡片宿主不必知道适配层内部（垫片、影子 ctx、桥接），
     * 回退时也只把这一个注入点摘掉。
     *
     * 未注入时（或适配层总开关关闭时），适配卡的装载会**明确报错**，
     * 而不是悄悄按普通卡片处理 —— 后者会让一个 DSH 插件拿到 CardAPI 并跑出莫名其妙的行为。
     */
    adapterHost;
    /** instanceId → CardAPI。 */
    apiByInstance = new Map();
    scanned = false;
    /**
     * 卡片模块的缓存失效令牌。
     *
     * `reloadCard` 递增它，`loadCard` 把它传给 `importCardModule` ——
     * 否则 Node 的 ESM 缓存按 URL 命中，重载会拿回**旧模块**（"重载"等于没重载）。
     *
     * ⚠️ 它只让**入口**新鲜；卡片内部的 `import './x.js'` 解析出的 URL 不带查询串，
     * 仍会命中缓存。**改卡片代码请重新安装**（落进新版本目录 → 全部 URL 都新）。
     */
    loadSeq = 0;
    constructor(manager, eventBus, adapter, options = {}) {
        this.manager = manager;
        this.eventBus = eventBus;
        this.adapter = adapter;
        this.messageLog = manager.messages;
        this.options = options;
        this.adapterHost = options.adapterHost;
    }
    /**
     * 默认根目录：内置取本包同级 `cards/`；已安装取 `$DSH_HOME/connection-cards/cards/`。
     * `lib/card-host/loader.js` → 上溯两级到包根。
     */
    builtinRoot() {
        if (this.options.builtinRoot)
            return this.options.builtinRoot;
        try {
            const here = fileURLToPath(import.meta.url);
            return join(here, '..', '..', '..', 'cards');
        }
        catch {
            return 'cards';
        }
    }
    installedRoot() {
        if (this.options.installedRoot)
            return this.options.installedRoot;
        // ⚠️ 兜底值**绝不能是 process.cwd()** —— 那样卡片会装到宿主进程的当前目录下，
        // 而进程 cwd 取决于用户从哪儿启动 DSH，既不可预测也不是"我们的目录"。
        // 正常路径由 index.ts 传 `$DSH_HOME/connection-cards/cards`。
        return join(dshHomeDir(), 'connection-cards', 'cards');
    }
    /** 已安装卡片的根目录（安装器要往这里落盘）。 */
    installedCardsRoot() {
        return this.installedRoot();
    }
    /** 扫描两个根目录下的卡片包（幂等）。 */
    scanTemplates(force = false) {
        if (this.scanned && !force)
            return;
        this.scanned = true;
        // 强制重扫 = 磁盘可能变了（刚装/刚卸）→ 先剔除消失的已安装卡片，
        // 否则只会增不会减，卸载掉的卡片一直挂在列表里。
        if (force)
            this.registry.clearInstalledTemplates();
        this.scanRoot(this.builtinRoot(), 'builtin');
        this.scanRoot(this.installedRoot(), 'installed');
    }
    scanRoot(root, source) {
        if (!existsSync(root))
            return;
        let entries;
        try {
            entries = readdirSync(root);
        }
        catch {
            return;
        }
        /**
         * 已安装卡片用**版本化目录 + current 指针**（见 card-paths.ts 的说明）。
         *
         * 扫描规则：
         *   1. 先读所有 `*.current` 指针，得到 id → 生效目录名
         *   2. 只注册**指针指向的那个**版本目录（其余的是旧版本，等清理）
         *   3. **未版本化的老目录（`<id>/`）照样认** —— 向后兼容，不需要迁移
         */
        if (source === 'installed') {
            const currentByid = new Map();
            for (const name of entries) {
                if (!name.endsWith('.current'))
                    continue;
                try {
                    const target = readFileSync(join(root, name), 'utf8').trim();
                    if (target)
                        currentByid.set(name.slice(0, -'.current'.length), target);
                }
                catch {
                    /* 指针读不到就当没有，下面的老目录分支会兜住 */
                }
            }
            for (const name of entries) {
                if (name.endsWith('.current'))
                    continue;
                const parsed = parseVersionedDirName(name);
                if (parsed) {
                    // 版本化目录：只认指针指向的那个
                    const want = currentByid.get(parsed.cardId);
                    if (want && want !== name)
                        continue; // 旧版本，跳过
                    this.registerTemplateDir(join(root, name), source, parsed.cardId);
                    continue;
                }
                // 未版本化的老目录：只有当它没有对应指针时才认（避免和版本目录重复注册）
                if (currentByid.has(name))
                    continue;
                this.registerTemplateDir(join(root, name), source, name);
            }
            return;
        }
        for (const name of entries) {
            this.registerTemplateDir(join(root, name), source, name);
        }
    }
    /** 读一个卡片目录的 package.json → 注册模板。 */
    registerTemplateDir(dir, source, fallbackId) {
        try {
            const pkgPath = join(dir, 'package.json');
            if (!existsSync(pkgPath))
                return false;
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            const manifest = pkg.dshCard;
            if (!manifest)
                return false;
            // CardAPI 版本护栏：卡片要的版本高于宿主就**拒绝注册**并说清原因。
            // 不静默降级 —— 那会让卡片跑到某个分支才炸，比一开始就拒绝难查得多。
            const apiCheck = checkApiVersion(manifest, manifest.name || fallbackId);
            if (!apiCheck.ok) {
                console.error([CardHost]);
                return false;
            }
            const templateId = manifest.id || fallbackId;
            const template = {
                templateId,
                version: pkg.version ?? '0.0.0',
                dir,
                // 入口：package.json main 优先，其次 manifest.ui.panel，最后 dist/index.js
                entry: resolveCardEntry(dir, pkg.main ?? manifest.ui?.panel),
                source,
                manifest,
            };
            this.registry.registerTemplate(template);
            return true;
        }
        catch {
            // 坏掉的卡片包不应该拖垮扫描
            return false;
        }
    }
    /** 可用模板清单（含在当前连接上已装载的数量）。 */
    listTemplates(connectionId) {
        this.scanTemplates();
        const conn = connectionId ? this.manager.getById(connectionId) : undefined;
        return this.registry.listTemplates().map((t) => {
            const req = t.manifest.requires;
            return {
                templateId: t.templateId,
                name: t.manifest.name || t.templateId,
                version: t.version,
                source: t.source,
                requires: {
                    read: Array.isArray(req?.read) ? req.read : [],
                    write: Array.isArray(req?.write) ? req.write : [],
                },
                events: Array.isArray(t.manifest.events) ? t.manifest.events : [],
                hasPanel: Boolean(t.manifest.ui?.panel) || true,
                // 模板若自己钉死了范围，界面要显示出来并禁用选择器
                ...(t.manifest.scope ? { scope: t.manifest.scope } : {}),
                /*
                 * 适配卡：下发状态供候选列表标注/置灰（用户裁决 D6）。
                 * ⚠️ 这里只做**判定**，不做任何挂载动作 —— 是否真能挂，等用户点了才走 mountPlugin，
                 * 那时还会再校验一次（申报、依赖、能力）。提前说是为了不让用户白撞一次。
                 */
                ...(t.manifest.adapter
                    ? {
                        adapter: (() => {
                            const s = adapterStatusOf(t.manifest.adapter);
                            return { status: s.status, capabilities: s.capabilities, reason: s.reason };
                        })(),
                    }
                    : {}),
                loadedCount: conn
                    ? conn.cards.filter((c) => c.templateId === t.templateId).length
                    : 0,
            };
        });
    }
    /**
     * 在目标连接上装载一张卡片。
     * @param templateId 卡片模板 id
     * @param connectionId 目标连接 id
     */
    async loadCard(templateId, connectionId, requestedScope) {
        const conn = this.manager.getById(connectionId);
        if (!conn)
            throw new Error(`连接不存在: ${connectionId}`);
        this.scanTemplates();
        const template = this.registry.getTemplate(templateId);
        if (!template)
            throw new Error(`卡片模板未找到: ${templateId}`);
        // 模板可以把自己固定到某一端（scope: 'a'|'b'）；否则用调用方选的，默认双向
        const scope = template.manifest.scope ?? requestedScope ?? 'both';
        /**
         * ⚠️ **适配卡走另一条路**（清单里有 `dshCard.adapter`）。
         *
         * 它不能按普通卡片处理：那是一个**给 DSH 全局写的插件**，
         * 直接 import 会因解析不到 `@deepseek-ai/*` 而失败；
         * 就算 import 成功，给它 CardAPI 也是错的上下文。
         *
         * 所以这里**分叉**，而不是"失败了再回退" ——
         * 让两条路的边界在代码上可见，也让失败原因指向正确的方向。
         */
        if (template.manifest.adapter) {
            return await this.loadAdapterCard(template, connectionId, scope);
        }
        // 导入卡片模块（含崩溃隔离）。带 loadSeq 做缓存失效 —— 否则 reload 拿回的是旧模块。
        const mod = await importCardModule(template.entry, this.loadSeq);
        this.registry.setModule(templateId, mod);
        const instance = {
            instanceId: randomUUID(),
            templateId,
            connectionId,
            scope,
            config: {},
            state: {},
            permissions: 'read',
            priority: 100,
            enabled: true,
        };
        this.registry.registerInstance(instance);
        conn.cards.push(instance);
        conn.updatedAt = Date.now();
        const api = createCardApi({
            instance,
            eventBus: this.eventBus,
            adapter: this.adapter,
            messageLog: this.messageLog,
            manager: this.manager,
        });
        this.apiByInstance.set(instance.instanceId, api);
        try {
            mod.apply?.(api);
        }
        catch (e) {
            // 卡片 apply 崩溃隔离：不让卡片拖垮宿主
            console.error(`[CardHost] 卡片 ${templateId} apply 失败:`, e);
        }
        // 落盘（卡片挂在连接上，随连接持久化）
        this.manager.persistConnection(connectionId);
        return instance;
    }
    /**
     * 装载一张**适配卡**：交给适配宿主，失败时把已登记的实例回滚掉。
     *
     * 单独成方法（而不是塞进 loadCard 的分支里）是为了让"两条路"在代码结构上就分开：
     * 读代码的人能直接看到适配卡**不走** CardAPI、**不走** importCardModule。
     */
    async loadAdapterCard(template, connectionId, scope) {
        const conn = this.manager.getById(connectionId);
        if (!conn)
            throw new Error(`连接不存在: ${connectionId}`);
        const adapter = this.adapterHost;
        if (!adapter) {
            throw new Error(`「${template.templateId}」是**适配卡**（把一个普通 DSH 插件挂成连接能力），` +
                `但当前宿主没有装配适配层 —— 无法装载。` +
                `这不是卡片坏了：适配层是可选组件，未装配时适配卡一律不可用（普通卡片不受影响）。`);
        }
        // 总开关关着时给出**能指导下一步**的报错（而不是让 mount 内部抛个技术性错误）
        if (!adapter.enabled()) {
            throw new Error(`「${template.templateId}」是适配卡，但**适配层默认关闭**。` +
                `开启后重试；未开启时它不会被装载，也不会影响其它卡片与连接。`);
        }
        const instance = {
            instanceId: randomUUID(),
            templateId: template.templateId,
            connectionId,
            scope,
            config: {},
            state: {},
            permissions: 'read',
            priority: 100,
            enabled: true,
        };
        this.registry.registerInstance(instance);
        conn.cards.push(instance);
        conn.updatedAt = Date.now();
        try {
            /**
             * ⚠️ 这里**不创建 CardAPI** —— 适配卡拿到的是影子 ctx（模拟 DSH 插件上下文），
             * 两者刻意不混（见 card-adapter.ts 文件头）。
             */
            await adapter.mount({
                instanceId: instance.instanceId,
                cardId: template.templateId,
                pluginDir: template.dir,
                capabilities: template.manifest.adapter?.capabilities,
                connectionId,
                scope,
            });
        }
        catch (e) {
            /**
             * 装载失败 ⇒ **回滚实例**（从连接与注册表里摘掉）。
             * 不回滚的话，面板上会挂着一张"看起来装上了但什么都没跑"的卡片，
             * 而真正的原因只留在日志里。
             */
            conn.cards = conn.cards.filter((c) => c.instanceId !== instance.instanceId);
            conn.updatedAt = Date.now();
            this.registry.removeInstance(instance.instanceId);
            this.manager.persistConnection(connectionId);
            throw e;
        }
        this.manager.persistConnection(connectionId);
        return instance;
    }
    /**
     * 读某张**已装载卡片**的客户端制品（UI 捕获用）。
     *
     * 由面板经 RPC 调用：宿主读文件、把**源码文本**送回浏览器。
     * 卡片目录不给浏览器 —— 它只需要一段源码，不需要目录访问权。
     */
    async readClientSource(instanceId) {
        const instance = this.registry.getInstance(instanceId);
        if (!instance)
            return { ok: false, reason: `卡片实例不存在：${instanceId}` };
        this.scanTemplates();
        const template = this.registry.getTemplate(instance.templateId);
        if (!template)
            return { ok: false, reason: `卡片模板不存在：${instance.templateId}` };
        return readClientArtifact(template.dir);
    }
    async unloadCard(instanceId) {
        const instance = this.registry.getInstance(instanceId);
        if (!instance)
            return;
        const conn = this.manager.getById(instance.connectionId);
        if (conn) {
            conn.cards = conn.cards.filter((c) => c.instanceId !== instanceId);
            conn.updatedAt = Date.now();
            this.manager.persistConnection(conn.id);
        }
        this.registry.removeInstance(instanceId);
        this.apiByInstance.delete(instanceId);
        /**
         * 适配卡还要**摘掉桥接的工具并释放插件资源** ——
         * 否则就是幽灵工具（护栏③）。普通卡片在这里是 no-op（适配宿主里没有它的记录）。
         */
        try {
            this.adapterHost?.unmount(instanceId);
        }
        catch (e) {
            // 卸载途中的错误不该让"卸载"本身失败（卡片已经从连接上摘掉了）
            console.error(`[CardHost] 适配卡卸载收尾失败 ${instanceId}:`, e);
        }
    }
    async reloadCard(instanceId) {
        const instance = this.registry.getInstance(instanceId);
        if (!instance)
            return;
        const { templateId, connectionId } = instance;
        this.registry.removeModule(templateId);
        // ⚠️ 只清 registry 不够：Node 的 ESM 缓存按 URL 命中，再 import 同一路径
        // 拿回的是**旧模块**，于是"重载"看起来成功、实际跑的还是旧代码（实测过）。
        // 递增令牌 → 入口 URL 带 ?v=N → 至少入口是新鲜的。
        // （卡片内部的子模块仍会命中缓存；改代码请重新安装，见 importCardModule 的说明。）
        this.loadSeq += 1;
        await this.unloadCard(instanceId);
        await this.loadCard(templateId, connectionId);
    }
    /**
     * 改一张**已装载卡片**的可见范围（两端 / 仅 A / 仅 B）。
     *
     * 为什么不复用 loadCard：那个每次都建**新实例**（新 UUID），
     * 拿来改范围会变成"卸一张又装一张"，instanceId 变了、state 丢了。
     *
     * 这里同时要**重建 CardAPI** —— 因为 API 是按 scope 过滤事件方向的，
     * 只改 instance.scope 而不换 API，卡片收到的仍会是旧方向的推送。
     */
    setCardScope(instanceId, scope) {
        const instance = this.registry.getInstance(instanceId);
        if (!instance)
            return false;
        if (instance.scope === scope)
            return true;
        const template = this.registry.getTemplate(instance.templateId);
        // 模板自己钉死了范围的，不允许用户改（否则与清单声明矛盾）
        if (template?.manifest.scope)
            return false;
        instance.scope = scope;
        const mod = this.registry.getModule(instance.templateId);
        if (mod) {
            const api = createCardApi({
                instance,
                eventBus: this.eventBus,
                adapter: this.adapter,
                messageLog: this.messageLog,
                manager: this.manager,
            });
            this.apiByInstance.set(instanceId, api);
        }
        const conn = this.manager.getById(instance.connectionId);
        if (conn) {
            conn.updatedAt = Date.now();
            this.manager.persistConnection(conn.id);
        }
        return true;
    }
    getCardApi(instanceId) {
        return this.apiByInstance.get(instanceId);
    }
    /** 某个模板当前装载了哪些实例（更新卡片后要逐个重载）。 */
    listInstancesByTemplate(templateId) {
        return this.registry.listInstancesByTemplate(templateId);
    }
    /**
     * 某张卡片注册的工具表。
     *
     * 卡片通过 `api.registerTool(name, fn)` 注册的能力此前是**死路** ——
     * 注册进一个 Map 就再没人读（`card-api.ts` 里注释写着"暴露工具表供宿主
     * 按白名单转发调用"，但全仓库没有第二处引用）。
     * 现在由宿主按**可见范围**转发，会话才有办法调到。
     */
    toolsOf(instanceId) {
        const api = this.apiByInstance.get(instanceId);
        return api?._tools;
    }
    /**
     * 列出某连接上、**对某一端可见**的卡片工具。
     *
     * 可见性规则（这是卡片与 DSH 全局插件的关键差别）：
     *   scope='both'      → 两端都能调
     *   scope='a' | 'b'   → **只有那一端**能调
     *
     * @param connectionId 连接
     * @param side 调用方在连接的哪一端
     */
    listCardTools(connectionId, side) {
        const out = [];
        for (const inst of this.registry.listInstancesByConnection(connectionId)) {
            const scope = inst.scope ?? 'both';
            // 只给"看得见这张卡片"的那一端
            if (scope !== 'both' && scope !== side)
                continue;
            const tools = this.toolsOf(inst.instanceId);
            out.push({
                instanceId: inst.instanceId,
                cardId: inst.templateId,
                scope,
                tools: tools ? [...tools.keys()] : [],
            });
        }
        return out;
    }
    /**
     * 调用某张卡片注册的工具 —— **带可见范围校验**。
     *
     * 校验不通过时明确拒绝（而不是"找不到工具"这种含糊理由），
     * 因为"这张卡片对你不可见"和"这张卡片没提供这个工具"是两回事，
     * 排查时含义完全不同。
     */
    async callCardTool(instanceId, tool, args, side) {
        const inst = this.registry.getInstance(instanceId);
        if (!inst)
            return { ok: false, reason: `卡片实例不存在：${instanceId}` };
        const scope = inst.scope ?? 'both';
        if (scope !== 'both' && scope !== side) {
            return {
                ok: false,
                reason: `这张卡片只对 ${scope === 'a' ? 'A' : 'B'} 端可见（你在 ${side === 'a' ? 'A' : 'B'} 端）`,
            };
        }
        const tools = this.toolsOf(instanceId);
        if (!tools)
            return { ok: false, reason: '这张卡片没有注册工具（或尚未装载完成）' };
        const fn = tools.get(tool);
        if (!fn) {
            return {
                ok: false,
                reason: `卡片「${inst.templateId}」没有提供工具「${tool}」；它提供的是：${[...tools.keys()].join(', ') || '(无)'}`,
            };
        }
        try {
            const value = await fn(args);
            return { ok: true, value };
        }
        catch (e) {
            // 卡片抛错不拖垮宿主 —— 只把原因回给调用方
            return { ok: false, reason: `卡片工具执行出错：${e instanceof Error ? e.message : String(e)}` };
        }
    }
    /**
     * 渲染卡片面板 HTML。
     *
     * 优先 `renderPanel(api)`（纯字符串，宿主友好）；
     * 否则给 `mountPanel` 一个只支持 innerHTML 的 DOM 替身，取回结果。
     *
     * @returns HTML 字符串；卡片没有面板或渲染失败时返回 null。
     */
    async renderCardPanel(instanceId) {
        const instance = this.registry.getInstance(instanceId);
        if (!instance)
            return null;
        try {
            // 确保模块已加载（重启后首次渲染时会走这里）
            let mod = this.registry.getModule(instance.templateId);
            if (!mod) {
                this.scanTemplates();
                const template = this.registry.getTemplate(instance.templateId);
                if (!template)
                    return null;
                mod = await importCardModule(template.entry, this.loadSeq);
                this.registry.setModule(instance.templateId, mod);
            }
            const api = this.apiByInstance.get(instanceId);
            if (typeof mod.renderPanel === 'function') {
                const html = mod.renderPanel(api);
                return typeof html === 'string' ? html : null;
            }
            if (typeof mod.mountPanel === 'function') {
                const shim = createShimElement();
                mod.mountPanel(shim, api);
                return shim.innerHTML || null;
            }
            return null;
        }
        catch (e) {
            console.error(`[CardHost] 渲染面板失败 ${instanceId}:`, e);
            return null;
        }
    }
    /**
     * 启动重放：把已持久化在连接上的卡片重新 import + apply。
     *
     * 连接是从 connections.json 恢复的，卡片的 apply（订阅/注册工具）不会自动重跑，
     * 不重放的话重启后卡片就"哑"了。
     *
     * @returns 成功重放的卡片数
     */
    async restoreAll() {
        this.scanTemplates();
        let restored = 0;
        for (const conn of this.manager.getAll()) {
            for (const instance of conn.cards) {
                try {
                    const template = this.registry.getTemplate(instance.templateId);
                    if (!template) {
                        console.warn(`[CardHost] 重放跳过：模板 ${instance.templateId} 不存在（连接 ${conn.id}）`);
                        continue;
                    }
                    /**
                     * 适配卡的重放走适配层（**不能** importCardModule —— 那是给卡片协议写的；
                     * 普通 DSH 插件在卡片目录里 import 不到 `@deepseek-ai/*`）。
                     *
                     * 总开关关着时**安静跳过**（不是错误）：用户可能就是把适配层关掉了，
                     * 那时已挂在连接上的适配卡自然不再生效 —— 说清楚即可，不要刷一堆失败日志。
                     */
                    if (template.manifest.adapter) {
                        if (!this.adapterHost) {
                            console.warn(`[CardHost] 重放跳过适配卡 ${instance.templateId}：宿主未装配适配层`);
                            continue;
                        }
                        if (!this.adapterHost.enabled()) {
                            console.warn(`[CardHost] 重放跳过适配卡 ${instance.templateId}：适配层已关闭（卡片仍在连接上，开启后重启生效）`);
                            continue;
                        }
                        await this.adapterHost.mount({
                            instanceId: instance.instanceId,
                            cardId: instance.templateId,
                            pluginDir: template.dir,
                            capabilities: template.manifest.adapter?.capabilities,
                            connectionId: conn.id,
                            scope: instance.scope,
                        });
                        this.registry.registerInstance(instance);
                        restored++;
                        continue;
                    }
                    const mod = await importCardModule(template.entry, this.loadSeq);
                    this.registry.setModule(instance.templateId, mod);
                    this.registry.registerInstance(instance);
                    const api = createCardApi({
                        instance,
                        eventBus: this.eventBus,
                        adapter: this.adapter,
                        messageLog: this.messageLog,
                        manager: this.manager,
                    });
                    this.apiByInstance.set(instance.instanceId, api);
                    mod.apply?.(api);
                    restored++;
                }
                catch (e) {
                    console.error(`[CardHost] 重放卡片失败 ${instance.instanceId}:`, e);
                }
            }
        }
        return restored;
    }
}
//# sourceMappingURL=loader.js.map