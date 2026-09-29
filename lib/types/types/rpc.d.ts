/**
 * 宿主 ↔ 浏览器 RPC 契约（两半共享）。
 *
 * 走 DSH 官方的 Connection 通道：宿主 `ctx.connection.rpc.handle()` 注册，
 * 浏览器 `ctx.connection.rpc.call()` 调用。
 *
 * 这个模块必须保持零 Node 依赖 —— 它会被打进 client bundle。
 */
/** RPC 通道前缀（绝对路径，须匹配 /^\/[A-Za-z0-9._~-]+$/）。 */
export declare const RPC_CHANNEL = "/connection-card";
/** 成功结果。 */
export interface RpcOk<T> {
    ok: true;
    value: T;
}
/** 失败结果（沿用 DSH 的 RpcResult 形状）。 */
export interface RpcFail {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}
export type RpcResult<T> = RpcOk<T> | RpcFail;
/**
 * 端点名。宿主 handler 收到的 `endpoint` 是通道相对路径，
 * 例如 `connections/list`（每段须匹配 /^[A-Za-z0-9_$.-]+$/）。
 */
export declare const RPC_ENDPOINTS: {
    readonly health: "health";
    readonly listConnections: "connections/list";
    readonly connectionsBySession: "connections/bySession";
    readonly createConnection: "connections/create";
    readonly disconnect: "connections/disconnect";
    readonly updatePermission: "permission/update";
    readonly requestPermissionUpgrade: "permission/request";
    readonly acceptPermissionUpgrade: "permission/accept";
    readonly rejectPermissionUpgrade: "permission/reject";
    readonly loadCard: "cards/load";
    readonly unloadCard: "cards/unload";
    readonly reloadCard: "cards/reload";
    readonly listCardTemplates: "cards/templates";
    readonly renderCardPanel: "cards/panel";
    readonly listWhitelist: "whitelist/list";
    readonly listSessions: "sessions/list";
    /** 浏览器半的诊断上报通道（宿主落到 client-debug.log）。 */
    readonly debugLog: "debug/log";
    /**
     * 调试用：向连接的 eventBus 发一个事件，用来手动触发卡片逻辑。
     * 卡片订阅的是连接级事件，没有这个入口就没法在不接入真实 DSH 事件源的情况下测试。
     */
    readonly debugEmit: "debug/emit";
    /** 待确认的权限升级请求。 */
    readonly listUpgradeRequests: "permission/pending";
    /** 协商连接的可远程调用方法白名单。 */
    readonly negotiateWhitelist: "whitelist/negotiate";
    /** 读取连接的交流记录。 */
    readonly listMessages: "messages/list";
    /** 以某一端的身份发一条连接消息。 */
    readonly sendMessage: "messages/send";
    /**
     * 调试用：直接往某个会话投递一段文本（验证「A 说话 B 能感知」的最后一跳）。
     * 目标会话必须有 live agent，否则返回失败原因。
     */
    readonly debugDeliver: "debug/deliver";
    /** 会话桥的能力探测结果。 */
    readonly relayCapabilities: "relay/capabilities";
};
export type RpcEndpoint = (typeof RPC_ENDPOINTS)[keyof typeof RPC_ENDPOINTS];
