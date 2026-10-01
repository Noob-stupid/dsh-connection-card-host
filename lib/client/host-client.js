import { RPC_CHANNEL, RPC_ENDPOINTS } from '../types/rpc.js';
import { safeCtxGet } from '../safe-ctx.js';
/** 从 cordis 上下文中取 ctx.connection.rpc；不可用时返回 null。 */
export function resolveRpcCaller(ctx) {
    // Context 是 Proxy：读未声明的服务会抛，必须走 safeCtxGet
    const connection = safeCtxGet(ctx, 'connection');
    const rpc = connection?.rpc;
    return rpc && typeof rpc.call === 'function' ? rpc : null;
}
/**
 * 用 RPC 调用器构造宿主客户端。
 * @param rpc - ctx.connection.rpc
 */
export function createHostClient(rpc) {
    const invoke = async (endpoint, payload = {}) => {
        const result = await rpc.call(RPC_CHANNEL, endpoint, payload);
        if (!result || typeof result !== 'object' || !('ok' in result)) {
            throw new Error(`RPC 响应形状非法（${endpoint}）`);
        }
        if (!result.ok) {
            throw new Error(result.error?.message ?? `RPC 调用失败（${endpoint}）`);
        }
        return result.value;
    };
    return {
        health: () => invoke(RPC_ENDPOINTS.health),
        listConnections: () => invoke(RPC_ENDPOINTS.listConnections),
        connectionsBySession: (sessionId) => invoke(RPC_ENDPOINTS.connectionsBySession, { sessionId }),
        createConnection: (sessionA, sessionB) => invoke(RPC_ENDPOINTS.createConnection, { sessionA, sessionB }),
        disconnect: (id) => invoke(RPC_ENDPOINTS.disconnect, { id }),
        updatePermission: (id, direction, level) => invoke(RPC_ENDPOINTS.updatePermission, { id, direction, level }),
        requestPermissionUpgrade: (id, direction, level) => invoke(RPC_ENDPOINTS.requestPermissionUpgrade, { id, direction, level }),
        acceptPermissionUpgrade: (requestId, acceptorId) => invoke(RPC_ENDPOINTS.acceptPermissionUpgrade, { requestId, acceptorId }),
        rejectPermissionUpgrade: (requestId, rejectorId) => invoke(RPC_ENDPOINTS.rejectPermissionUpgrade, { requestId, rejectorId }),
        loadCard: (templateId, connectionId, scope) => invoke(RPC_ENDPOINTS.loadCard, { templateId, connectionId, ...(scope ? { scope } : {}) }),
        unloadCard: (instanceId) => invoke(RPC_ENDPOINTS.unloadCard, { instanceId }),
        reloadCard: (instanceId) => invoke(RPC_ENDPOINTS.reloadCard, { instanceId }),
        setCardScope: (instanceId, scope) => invoke(RPC_ENDPOINTS.setCardScope, { instanceId, scope }),
        installCard: (spec) => invoke(RPC_ENDPOINTS.installCard, { spec }),
        uninstallCard: (cardId) => invoke(RPC_ENDPOINTS.uninstallCard, { cardId }),
        cardsRoot: () => invoke(RPC_ENDPOINTS.cardsRoot),
        checkCardUpdate: (cardId) => invoke(RPC_ENDPOINTS.checkCardUpdate, { cardId }),
        updateCard: (cardId) => invoke(RPC_ENDPOINTS.updateCard, { cardId }),
        relayDiagnostics: () => invoke(RPC_ENDPOINTS.relayDiagnostics),
        listCardTemplates: (connectionId) => invoke(RPC_ENDPOINTS.listCardTemplates, connectionId ? { connectionId } : {}),
        renderCardPanel: (instanceId) => invoke(RPC_ENDPOINTS.renderCardPanel, { instanceId }),
        listPendingUpgrades: (connectionId) => invoke(RPC_ENDPOINTS.listUpgradeRequests, connectionId ? { connectionId } : {}),
        negotiateWhitelist: (connectionId, methods) => invoke(RPC_ENDPOINTS.negotiateWhitelist, { connectionId, methods }),
        listWhitelistedMethods: (connectionId) => invoke(RPC_ENDPOINTS.listWhitelist, { connectionId }),
        listSessions: () => invoke(RPC_ENDPOINTS.listSessions),
        // ── 协作感知 ──
        connectionWork: (connectionId) => invoke(RPC_ENDPOINTS.connectionWork, { connectionId }),
        listConventions: (connectionId, all) => invoke(RPC_ENDPOINTS.listConventions, all ? { connectionId, all } : { connectionId }),
        declareConvention: (connectionId, by, topic, text) => invoke(RPC_ENDPOINTS.declareConvention, { connectionId, by, topic, text }),
        removeConvention: (connectionId, id) => invoke(RPC_ENDPOINTS.removeConvention, { connectionId, id }),
        // 诊断：不能阻塞交互，失败静默
        report: (message) => {
            void rpc
                .call(RPC_CHANNEL, RPC_ENDPOINTS.debugLog, { message })
                .catch(() => { });
        },
    };
}
//# sourceMappingURL=host-client.js.map