export function createStableApi(manager, eventBus, cardHost, adapter, bridge, awareness) {
    const track = awareness?.workState;
    const box = awareness?.box;
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
        loadCard: (tid, cid) => cardHost.loadCard(tid, cid),
        unloadCard: (iid) => cardHost.unloadCard(iid),
        reloadCard: (iid) => cardHost.reloadCard(iid),
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
        sendMessage: (cid, from, kind, text, options) => {
            const conn = manager.getById(cid);
            const result = manager.messages.append(conn, from, kind, text, options ?? {});
            if (result.ok)
                manager.persistMessages(cid);
            return result.ok
                ? { ok: true, ...(result.message ? { message: result.message } : {}) }
                : { ok: false, reason: result.reason };
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
        deliverToSession: async (sessionId, text, wake = true) => {
            if (!bridge)
                return { ok: false, reason: '会话桥未装配' };
            const r = await bridge.deliver(sessionId, text, wake);
            return r.ok ? { ok: true, ...(r.via ? { via: r.via } : {}) } : { ok: false, reason: r.reason };
        },
        readSessionRecent: (sessionId, limit) => bridge?.readRecent(sessionId, limit ?? 20) ?? [],
    };
}
//# sourceMappingURL=stable-api.js.map