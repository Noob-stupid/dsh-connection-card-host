import { installCard, uninstallCard } from '../card-host/installer.js';
export function createStableApi(manager, eventBus, cardHost, adapter, bridge, awareness, auditLog, relay) {
    const track = awareness?.workState;
    const box = awareness?.box;
    const audit = auditLog ?? ((m) => console.log('[ConnectionCardHost]', m));
    /** 声明约定后立刻落盘（公约必须跨重启保留）。 */
    const persistBox = (cid) => manager.persistConventions(cid);
    return {
        createConnection: (a, b) => manager.create(a, b),
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