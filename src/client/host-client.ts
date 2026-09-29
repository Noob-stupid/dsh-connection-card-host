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

/** 会话摘要（面板的会话选择器）。 */
export interface KnownSessionView {
  id: string
  title: string
  updatedAt: number
}

/** 待确认的权限升级请求。 */
export interface PendingUpgradeView {
  id: string
  connectionId: string
  direction: 'aToB' | 'bToA'
  from: PermissionLevel
  to: PermissionLevel
  acceptedCount: number
  requiredAccepts: number
}

/** 可用卡片模板（面板的卡片装载区）。 */
export interface CardTemplateView {
  templateId: string
  name: string
  version: string
  source: 'builtin' | 'installed'
  requires: { read: string[]; write: string[] }
  events: string[]
  hasPanel: boolean
  loadedCount: number
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
  listCardTemplates(connectionId?: string): Promise<CardTemplateView[]>
  renderCardPanel(instanceId: string): Promise<string | null>
  /** 待确认的权限升级请求。 */
  listPendingUpgrades(connectionId?: string): Promise<PendingUpgradeView[]>
  /** 协商可远程调用的方法白名单。 */
  negotiateWhitelist(
    connectionId: string,
    methods: { method: string; description: string }[],
  ): Promise<number>
  listWhitelistedMethods(connectionId: string): Promise<WhitelistEntryView[]>
  listSessions(): Promise<KnownSessionView[]>
  /** 诊断上报（浏览器里读不到 console，只能借 RPC 落盘）。 */
  report(message: string): void
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
    listCardTemplates: (connectionId) =>
      invoke(RPC_ENDPOINTS.listCardTemplates, connectionId ? { connectionId } : {}),
    renderCardPanel: (instanceId) => invoke(RPC_ENDPOINTS.renderCardPanel, { instanceId }),
    listPendingUpgrades: (connectionId) =>
      invoke(RPC_ENDPOINTS.listUpgradeRequests, connectionId ? { connectionId } : {}),
    negotiateWhitelist: (connectionId, methods) =>
      invoke(RPC_ENDPOINTS.negotiateWhitelist, { connectionId, methods }),
    listWhitelistedMethods: (connectionId) =>
      invoke(RPC_ENDPOINTS.listWhitelist, { connectionId }),
    listSessions: () => invoke(RPC_ENDPOINTS.listSessions),
    // 诊断：不能阻塞交互，失败静默
    report: (message) => {
      void rpc
        .call(RPC_CHANNEL, RPC_ENDPOINTS.debugLog, { message })
        .catch(() => {})
    },
  }
}
