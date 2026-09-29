/**
 * 宿主 ↔ 浏览器 RPC 契约（两半共享）。
 *
 * 走 DSH 官方的 Connection 通道：宿主 `ctx.connection.rpc.handle()` 注册，
 * 浏览器 `ctx.connection.rpc.call()` 调用。
 *
 * 这个模块必须保持零 Node 依赖 —— 它会被打进 client bundle。
 */

/** RPC 通道前缀（绝对路径，须匹配 /^\/[A-Za-z0-9._~-]+$/）。 */
export const RPC_CHANNEL = '/connection-card'

/** 成功结果。 */
export interface RpcOk<T> {
  ok: true
  value: T
}

/** 失败结果（沿用 DSH 的 RpcResult 形状）。 */
export interface RpcFail {
  ok: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export type RpcResult<T> = RpcOk<T> | RpcFail

/**
 * 端点名。宿主 handler 收到的 `endpoint` 是通道相对路径，
 * 例如 `connections/list`（每段须匹配 /^[A-Za-z0-9_$.-]+$/）。
 */
export const RPC_ENDPOINTS = {
  health: 'health',
  listConnections: 'connections/list',
  connectionsBySession: 'connections/bySession',
  createConnection: 'connections/create',
  disconnect: 'connections/disconnect',
  updatePermission: 'permission/update',
  requestPermissionUpgrade: 'permission/request',
  acceptPermissionUpgrade: 'permission/accept',
  rejectPermissionUpgrade: 'permission/reject',
  loadCard: 'cards/load',
  unloadCard: 'cards/unload',
  reloadCard: 'cards/reload',
  listWhitelist: 'whitelist/list',
  listSessions: 'sessions/list',
  /** 浏览器半的诊断上报通道（宿主落到 client-debug.log）。 */
  debugLog: 'debug/log',
} as const

export type RpcEndpoint = (typeof RPC_ENDPOINTS)[keyof typeof RPC_ENDPOINTS]
