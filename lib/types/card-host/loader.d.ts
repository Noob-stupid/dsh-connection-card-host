import type { CardInstance, CardAPI, CardScope } from '../types/index.js';
import type { ConnectionManager } from '../core/connection-manager.js';
import type { ConnectionEventBus } from '../core/event-bus.js';
import type { DSHAdapter } from '../adapter/dsh-adapter.js';
export interface CardHostOptions {
    /** 内置卡片根目录（随插件包发布的 cards/）。 */
    builtinRoot?: string;
    /** 已安装卡片的根目录（$DSH_HOME/connection-cards/cards/）。 */
    installedRoot?: string;
}
/** 面板里展示的模板摘要。 */
export interface CardTemplateInfo {
    templateId: string;
    name: string;
    version: string;
    source: 'builtin' | 'installed';
    requires: {
        read: string[];
        write: string[];
    };
    events: string[];
    /** 是否提供面板 UI。 */
    hasPanel: boolean;
    /** 模板自己钉死的可见范围（有则用户不可改）。 */
    scope?: CardScope;
    /** 已加到当前连接的实例数（由调用方填充）。 */
    loadedCount: number;
}
export declare class CardHost {
    private registry;
    private manager;
    private eventBus;
    private adapter;
    /** 连接两端的规范交流记录（CardAPI.send/read 走它）。 */
    private messageLog;
    private options;
    /** instanceId → CardAPI。 */
    private apiByInstance;
    private scanned;
    /**
     * 卡片模块的缓存失效令牌。
     *
     * `reloadCard` 递增它，`loadCard` 把它传给 `importCardModule` ——
     * 否则 Node 的 ESM 缓存按 URL 命中，重载会拿回**旧模块**（"重载"等于没重载）。
     *
     * ⚠️ 它只让**入口**新鲜；卡片内部的 `import './x.js'` 解析出的 URL 不带查询串，
     * 仍会命中缓存。**改卡片代码请重新安装**（落进新版本目录 → 全部 URL 都新）。
     */
    private loadSeq;
    constructor(manager: ConnectionManager, eventBus: ConnectionEventBus, adapter: DSHAdapter, options?: CardHostOptions);
    /**
     * 默认根目录：内置取本包同级 `cards/`；已安装取 `$DSH_HOME/connection-cards/cards/`。
     * `lib/card-host/loader.js` → 上溯两级到包根。
     */
    private builtinRoot;
    private installedRoot;
    /** 已安装卡片的根目录（安装器要往这里落盘）。 */
    installedCardsRoot(): string;
    /** 扫描两个根目录下的卡片包（幂等）。 */
    scanTemplates(force?: boolean): void;
    private scanRoot;
    /** 读一个卡片目录的 package.json → 注册模板。 */
    private registerTemplateDir;
    /** 可用模板清单（含在当前连接上已装载的数量）。 */
    listTemplates(connectionId?: string): CardTemplateInfo[];
    /**
     * 在目标连接上装载一张卡片。
     * @param templateId 卡片模板 id
     * @param connectionId 目标连接 id
     */
    loadCard(templateId: string, connectionId: string, requestedScope?: CardScope): Promise<CardInstance>;
    unloadCard(instanceId: string): Promise<void>;
    reloadCard(instanceId: string): Promise<void>;
    /**
     * 改一张**已装载卡片**的可见范围（两端 / 仅 A / 仅 B）。
     *
     * 为什么不复用 loadCard：那个每次都建**新实例**（新 UUID），
     * 拿来改范围会变成"卸一张又装一张"，instanceId 变了、state 丢了。
     *
     * 这里同时要**重建 CardAPI** —— 因为 API 是按 scope 过滤事件方向的，
     * 只改 instance.scope 而不换 API，卡片收到的仍会是旧方向的推送。
     */
    setCardScope(instanceId: string, scope: CardScope): boolean;
    getCardApi(instanceId: string): CardAPI | undefined;
    /** 某个模板当前装载了哪些实例（更新卡片后要逐个重载）。 */
    listInstancesByTemplate(templateId: string): CardInstance[];
    /**
     * 某张卡片注册的工具表。
     *
     * 卡片通过 `api.registerTool(name, fn)` 注册的能力此前是**死路** ——
     * 注册进一个 Map 就再没人读（`card-api.ts` 里注释写着"暴露工具表供宿主
     * 按白名单转发调用"，但全仓库没有第二处引用）。
     * 现在由宿主按**可见范围**转发，会话才有办法调到。
     */
    private toolsOf;
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
    listCardTools(connectionId: string, side: 'a' | 'b'): {
        instanceId: string;
        cardId: string;
        scope: string;
        tools: string[];
    }[];
    /**
     * 调用某张卡片注册的工具 —— **带可见范围校验**。
     *
     * 校验不通过时明确拒绝（而不是"找不到工具"这种含糊理由），
     * 因为"这张卡片对你不可见"和"这张卡片没提供这个工具"是两回事，
     * 排查时含义完全不同。
     */
    callCardTool(instanceId: string, tool: string, args: unknown, side: 'a' | 'b'): Promise<{
        ok: boolean;
        value?: unknown;
        reason?: string;
    }>;
    /**
     * 渲染卡片面板 HTML。
     *
     * 优先 `renderPanel(api)`（纯字符串，宿主友好）；
     * 否则给 `mountPanel` 一个只支持 innerHTML 的 DOM 替身，取回结果。
     *
     * @returns HTML 字符串；卡片没有面板或渲染失败时返回 null。
     */
    renderCardPanel(instanceId: string): Promise<string | null>;
    /**
     * 启动重放：把已持久化在连接上的卡片重新 import + apply。
     *
     * 连接是从 connections.json 恢复的，卡片的 apply（订阅/注册工具）不会自动重跑，
     * 不重放的话重启后卡片就"哑"了。
     *
     * @returns 成功重放的卡片数
     */
    restoreAll(): Promise<number>;
}
