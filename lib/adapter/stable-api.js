export function createStableApi(manager, eventBus, cardHost, adapter) {
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
        negotiateWhitelist: (cid, methods) => manager.whitelist.negotiate(cid, methods),
        isWhitelisted: (cid, method) => manager.whitelist.isAllowed(cid, method),
        listWhitelistedMethods: (cid) => manager.whitelist.listMethods(cid).map(e => ({ method: e.method, description: e.description, approvedBy: e.approvedBy })),
        listSessions: () => adapter?.listSessions() ?? [],
    };
}
//# sourceMappingURL=stable-api.js.map