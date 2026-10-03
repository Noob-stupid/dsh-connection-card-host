import { installCard, uninstallCard } from '../card-host/installer.js';
import { checkCardUpdate, readSourceRecord } from '../card-host/updates.js';
export function createStableApi(manager, eventBus, cardHost, adapter, bridge, awareness, auditLog, relay) {
    const track = awareness?.workState;
    const box = awareness?.box;
    const audit = auditLog ?? ((m) => console.log('[ConnectionCardHost]', m));
    /** 声明约定后立刻落盘（公约必须跨重启保留）。 */
    const persistBox = (cid) => manager.persistConventions(cid);
    return {
        /**
         * 建连接 —— 并且**通知两端会话**。
         *
         * ## 为什么必须通知（2026-10-01 用户提出的场景）
         *
         * 用户的原话：
         *   > 用户本来就有两个或多个对话，把他们搭线后（**搭线后两边会话能自己发现吗**）
         *   > 能就着原来自己会话的任务情况后续交流协作吗？
         *
         * 早先 `create()` **只写进管理器的表**，一个字节都不投给会话 ——
         * 于是搭线对两端**完全不可见**：它们只有碰巧调用 `connection_peer_work` 才会发现。
         * 工具 schema 虽然在上下文里，但**没有任何东西提示它去用**。
         *
         * ## 为什么用 quiet（inject）
         *
         * `quiet` = 只放进上下文、**不唤醒**。两端在**下次干活时**自然看到这条，
         * 不会被平白打断一轮。建连接是一次性事件，代价很小，收益是"发现得了"。
         *
         * ## 为什么要写清"能做什么"
         *
         * 只说"你被连接了"没用 —— 会话不知道该拿它干什么。所以把三个工具的用途一并写进去，
         * 让"发现"直接变成"可用"。
         */
        createConnection: (a, b) => {
            const conn = manager.create(a, b);
            if (!bridge)
                return conn;
            const label = (sid) => {
                const known = adapter?.listSessions?.().find((s) => s.id === sid);
                const title = known?.title?.trim();
                if (title)
                    return title;
                const short = sid.replace(/^session-/, '').slice(0, 8);
                return `会话 ${short}`;
            };
            // 两端各发一条（不唤醒）。文案刻意写成"可用能力清单"而不是"通知"。
            for (const [self, peer] of [
                [a, b],
                [b, a],
            ]) {
                void bridge
                    .deliver(self, `[连接已建立] 你与本机另一个会话连上了：**${label(peer)}**。\n` +
                    `\n` +
                    `这条连接让你能：\n` +
                    `  · connection_peer_work —— 看它**正在做什么**（在改哪些文件、计划到哪一步）。这是拉取式的，不占它上下文。\n` +
                    `  · connection_conventions —— 看你们**说好了什么**（接口、单位、命名、分工）。\n` +
                    `  · connection_send —— 给它发消息（紧急度自己判断：不急用 quiet，一般用 normal，要它立刻改行为才 urgent）。\n` +
                    `\n` +
                    `如果你的活与它相关（改同一批文件、依赖同一个接口、分工有交叉），` +
                    `先查它的状态再动手；需要对齐就写进公约盒。**不相关就不用管它** —— 这条连接不会打扰你。`, 'quiet')
                    .catch(() => { });
            }
            return conn;
        },
        disconnect: (id) => manager.disconnect(id),
        updatePermission: (id, dir, level) => manager.updatePermission(id, dir, level),
        requestPermissionUpgrade: (id, dir, level) => manager.requestPermissionUpgrade(id, dir, level),
        acceptPermissionUpgrade: (rid, aid) => manager.acceptPermissionUpgrade(rid, aid),
        rejectPermissionUpgrade: (rid, rid2) => manager.rejectPermissionUpgrade(rid, rid2),
        getConnectionsBySession: (sid) => manager.getBySession(sid),
        getConnectionById: (id) => manager.getById(id),
        getAllConnections: () => manager.getAll(),
        onConnectionEvent: (event, handler) => manager.on(event, handler),
        subscribeConnectionEvent: (cid, event, handler) => eventBus.subscribe(cid, event, handler),
        emitConnectionEvent: (cid, event, data) => eventBus.emit(cid, event, data),
        loadCard: (tid, cid, scope) => cardHost.loadCard(tid, cid, scope),
        unloadCard: (iid) => cardHost.unloadCard(iid),
        reloadCard: (iid) => cardHost.reloadCard(iid),
        setCardScope: (iid, scope) => cardHost.setCardScope(iid, scope),
        installCard: async (spec) => {
            if (!cardHost)
                return { ok: false, reason: '卡片宿主未装配' };
            const result = await installCard(spec, cardHost.installedCardsRoot(), audit);
            // 装完立刻重扫，卡片马上出现在列表里
            if (result.ok)
                cardHost.scanTemplates(true);
            return result;
        },
        uninstallCard: (cardId) => {
            if (!cardHost)
                return { ok: false, reason: '卡片宿主未装配' };
            const r = uninstallCard(cardId, cardHost.installedCardsRoot());
            if (r.ok)
                cardHost.scanTemplates(true);
            return r;
        },
        cardsRoot: () => cardHost?.installedCardsRoot() ?? '',
        /**
         * 检查某张已安装卡片有没有更新。
         *
         * **判断不了时会带 `reason` 而不是 `hasUpdate: false`** ——
         * "无法检查"和"已是最新"是两回事，面板必须能区分，否则就是谎报。
         */
        checkCardUpdate: (cardId) => {
            if (!cardHost)
                return { cardId, spec: '', kind: 'dir', dirName: '', reason: '卡片宿主未装配' };
            return checkCardUpdate(cardHost.installedCardsRoot(), cardId);
        },
        /**
         * 更新一张卡片：照着**记录的来源**重装，然后让装载的实例重载。
         *
         * 之所以能"装载中更新"：安装走**版本化目录**（新版本写新目录，不碰被锁的旧的），
         * 指针切过去之后 `reloadCard` 从新目录导入 —— 所有子模块的 URL 都是新的，
         * 不会被 ESM 缓存命中旧代码。
         */
        updateCard: async (cardId) => {
            if (!cardHost)
                return { ok: false, reason: '卡片宿主未装配' };
            const root = cardHost.installedCardsRoot();
            const rec = readSourceRecord(root, cardId);
            if (!rec) {
                return { ok: false, reason: '没有来源记录，无法自动更新；请用原来的地址重新安装一次' };
            }
            const r = await installCard(rec.spec, root, audit);
            if (!r.ok)
                return { ok: false, reason: r.reason };
            cardHost.scanTemplates(true);
            // 已装载的实例重载到新代码（没装载的话下次装载自然是新的）
            let reloaded = 0;
            for (const inst of cardHost.listInstancesByTemplate(cardId)) {
                await cardHost.reloadCard(inst.instanceId);
                reloaded++;
            }
            audit(`卡片已更新：${cardId} → ${r.version ?? '?'}（重载 ${reloaded} 个实例）`);
            return {
                ok: true,
                version: r.version,
                reloaded,
                dir: r.dir,
            };
        },
        listCardTools: (cid, side) => cardHost?.listCardTools(cid, side) ?? [],
        callCardTool: async (instanceId, tool, args, side) => cardHost?.callCardTool(instanceId, tool, args, side) ?? {
            ok: false,
            reason: '卡片宿主未装配',
        },
        relayDiagnostics: () => {
            const s = bridge?.skippedSummary() ?? { entries: [], total: 0 };
            return {
                skipped: s.entries,
                total: s.total,
                relayConfig: relay?.config() ?? { relayAssistant: false, relayUser: false },
            };
        },
        listCardTemplates: (cid) => cardHost.listTemplates(cid),
        renderCardPanel: (iid) => cardHost.renderCardPanel(iid),
        readCardClientSource: (iid) => cardHost.readClientSource(iid),
        listPendingUpgrades: (cid) => manager.upgradeManager.getPendingRequests(cid).map((r) => ({
            id: r.id,
            connectionId: r.connectionId,
            direction: r.direction,
            from: r.from,
            to: r.to,
            acceptedCount: r.acceptedBy.size,
            requiredAccepts: r.requiredAccepts,
        })),
        negotiateWhitelist: (cid, methods) => manager.whitelist.negotiate(cid, methods),
        isWhitelisted: (cid, method) => manager.whitelist.isAllowed(cid, method),
        listWhitelistedMethods: (cid) => manager.whitelist.listMethods(cid).map(e => ({ method: e.method, description: e.description, approvedBy: e.approvedBy })),
        listSessions: () => adapter?.listSessions() ?? [],
        listMessages: (cid, options) => manager.messages.list(cid, options ?? {}),
        clearMessages: (cid) => {
            const before = manager.messages.list(cid, {}).length;
            manager.messages.clear(cid);
            manager.persistMessages(cid);
            return { ok: true, removed: before };
        },
        /**
         * 发一条消息 —— **记录 + 真的投到对端会话**。
         *
         * ⚠️ 早先这里**只写进连接的消息日志**（给面板/卡片看），**不投递** ——
         * 于是"传话"实际上从来没有真的到达过对端（唯一能到的是中继的自动转发，
         * 而那已经在 2026-10-01 默认关闭）。所以这个函数必须自己负责投递。
         *
         * 投递目标 = 发送端的**对端**（from='a' → 投给 B）。
         * text 是调用方明确给的 —— **这条路径没有任何途径读到会话内容**，
         * 所以它不可能带上"镜像"那类东西。
         */
        sendMessage: async (cid, from, kind, text, options) => {
            const conn = manager.getById(cid);
            const result = manager.messages.append(conn, from, kind, text, options ?? {});
            if (!result.ok)
                return { ok: false, reason: result.reason };
            manager.persistMessages(cid);
            // ── 真的投到对端会话 ──
            const target = from === 'a' ? conn?.sessionB : conn?.sessionA;
            if (bridge && target) {
                const urgency = options?.urgency ?? 'normal';
                const d = await bridge.deliver(target, 
                // 前缀让对端一眼看出"这是一条发给我的消息"（与自动同步区分）
                `[对方消息 · ${kind === 'ask' ? '请求' : kind === 'reply' ? '回复' : '发言'}] ${text}`, urgency, 'handoff');
                if (!d.ok) {
                    return { ok: true, message: result.message, delivered: false, reason: d.reason };
                }
            }
            return {
                ok: true,
                ...(result.message ? { message: result.message } : {}),
                delivered: true,
            };
        },
        relayCapabilities: () => bridge?.capabilities() ?? {
            observe: false,
            deliver: false,
            via: [],
            notes: ['会话桥未装配'],
        },
        // ── 协作感知 A 层：工作状态（只读，采集自工具事件） ──
        peerWork: (sessionId, label) => track?.summarize(sessionId, label) ?? null,
        workSnapshot: (sessionId) => track?.get(sessionId),
        connectionWork: (connectionId) => {
            const conn = manager.getById(connectionId);
            if (!conn)
                return { a: undefined, b: undefined };
            return { a: track?.get(conn.sessionA), b: track?.get(conn.sessionB) };
        },
        // ── 协作感知 B 层：公约盒（显式声明，持久） ──
        listConventions: (cid, includeSuperseded) => box?.list(cid, { ...(includeSuperseded !== undefined ? { includeSuperseded } : {}) }) ?? [],
        searchConventions: (cid, keyword) => box?.search(cid, keyword) ?? [],
        declareConvention: (cid, by, topic, text, supersedes) => {
            if (!box)
                return { ok: false, reason: '公约盒未装配' };
            const r = box.add(cid, by, topic, text, supersedes);
            if (r.ok)
                persistBox(cid);
            return r;
        },
        removeConvention: (cid, id) => {
            const ok = box?.remove(cid, id) ?? false;
            if (ok)
                persistBox(cid);
            return ok;
        },
        renderConventions: (cid, aLabel, bLabel) => box?.render(cid, aLabel, bLabel) ?? '公约盒未装配',
        deliverToSession: async (sessionId, text, urgency = 'normal', form = 'handoff') => {
            if (!bridge)
                return { ok: false, reason: '会话桥未装配' };
            const r = await bridge.deliver(sessionId, text, urgency, form);
            return r.ok ? { ok: true, ...(r.via ? { via: r.via } : {}) } : { ok: false, reason: r.reason };
        },
        readSessionRecent: (sessionId, limit) => bridge?.readRecent(sessionId, limit ?? 20) ?? [],
    };
}
//# sourceMappingURL=stable-api.js.map