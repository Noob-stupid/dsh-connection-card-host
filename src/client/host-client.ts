/**
 * 浏览器半的宿主客户端 —— 通过 DSH 的 Connection RPC 通道调用宿主服务。
 *
 * 这是浏览器访问宿主的唯一途径：`ctx.connection.rpc.call(channel, endpoint, payload)`。
 * 每个方法返回 Promise，失败时抛 Error（而不是静默返 null）。
 */
import type { Connection, CardInstance, PermissionLevel } from '../types/index.js'
import { RPC_CHANNEL, RPC_ENDPOINTS, type RpcResult } from '../types/rpc.js'
import { safeCtxGet } from '../safe-ctx.js'

/** 浏览器半收到的 Connection 视图（与宿主类型同构）。 */
export type RemoteConnection = Connection
export type RemoteCardInstance = CardInstance

export interface WhitelistEntryView {
  method: string
  description: string
  approvedBy: string[]
}

export interface ConnectionCardHostClient {
  health(): Promise<{ ready: boolean; connections: number }>
  listConnections(): Promise<RemoteConnection[]>
  connectionsBySession(sessionId: string): Promise<RemoteConnection[]>
  createConnection(sessionA: string, sessionB: string): Promise<RemoteConnection>
  disconnect(id: string): Promise<void>
  updatePermission(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): Promise<void>
  requestPermissionUpgrade(
    id: string,
    direction: 'aToB' | 'bToA',
    level: PermissionLevel,
  ): Promise<string | null>
  acceptPermissionUpgrade(requestId: string, acceptorId: string): Promise<boolean>
  rejectPermissionUpgrade(requestId: string, rejectorId: string): Promise<void>
  loadCard(templateId: string, connectionId: string): Promise<RemoteCardInstance>
  unloadCard(instanceId: string): Promise<void>
  reloadCard(instanceId: string): Promise<void>
  listWhitelistedMethods(connectionId: string): Promise<WhitelistEntryView[]>
}

/** RPC 调用器的形状（取自 ctx.connection.rpc）。 */
export interface RpcCaller {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcResult<unknown>>
}

/** 从 cordis 上下文中取 ctx.connection.rpc；不可用时返回 null。 */
export function resolveRpcCaller(ctx: unknown): RpcCaller | null {
  // Context 是 Proxy：读未声明的服务会抛，必须走 safeCtxGet
  const connection = safeCtxGet<{ rpc?: RpcCaller }>(ctx, 'connection')
  const rpc = connection?.rpc
  return rpc && typeof rpc.call === 'function' ? rpc : null
}

/**
 * 用 RPC 调用器构造宿主客户端。
 * @param rpc - ctx.connection.rpc
 */
export function createHostClient(rpc: RpcCaller): ConnectionCardHostClient {
  const invoke = async <T>(endpoint: string, payload: unknown = {}): Promise<T> => {
    const result = await rpc.call(RPC_CHANNEL, endpoint, payload)
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      throw new Error(`RPC 响应形状非法（${endpoint}）`)
    }
    if (!result.ok) {
      throw new Error(result.error?.message ?? `RPC 调用失败（${endpoint}）`)
    }
    return (result as { ok: true; value: T }).value
  }

  return {
    health: () => invoke(RPC_ENDPOINTS.health),
    listConnections: () => invoke(RPC_ENDPOINTS.listConnections),
    connectionsBySession: (sessionId) =>
      invoke(RPC_ENDPOINTS.connectionsBySession, { sessionId }),
    createConnection: (sessionA, sessionB) =>
      invoke(RPC_ENDPOINTS.createConnection, { sessionA, sessionB }),
    disconnect: (id) => invoke(RPC_ENDPOINTS.disconnect, { id }),
    updatePermission: (id, direction, level) =>
      invoke(RPC_ENDPOINTS.updatePermission, { id, direction, level }),
    requestPermissionUpgrade: (id, direction, level) =>
      invoke(RPC_ENDPOINTS.requestPermissionUpgrade, { id, direction, level }),
    acceptPermissionUpgrade: (requestId, acceptorId) =>
      invoke(RPC_ENDPOINTS.acceptPermissionUpgrade, { requestId, acceptorId }),
    rejectPermissionUpgrade: (requestId, rejectorId) =>
      invoke(RPC_ENDPOINTS.rejectPermissionUpgrade, { requestId, rejectorId }),
    loadCard: (templateId, connectionId) =>
      invoke(RPC_ENDPOINTS.loadCard, { templateId, connectionId }),
    unloadCard: (instanceId) => invoke(RPC_ENDPOINTS.unloadCard, { instanceId }),
    reloadCard: (instanceId) => invoke(RPC_ENDPOINTS.reloadCard, { instanceId }),
    listWhitelistedMethods: (connectionId) =>
      invoke(RPC_ENDPOINTS.listWhitelist, { connectionId }),
  }
}
