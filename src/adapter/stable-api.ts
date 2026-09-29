/**
 * Stable API — 对外暴露的稳定接口层。
 * 浏览器端和卡片通过此接口与宿主交互，隔离内部实现变化。
 */
import type { Connection, PermissionLevel, CardInstance } from '../types/index.js'
import type { ConnectionManager } from '../core/connection-manager.js'
import type { ConnectionEventBus } from '../core/event-bus.js'
import type { CardHost } from '../card-host/loader.js'
import type { DSHAdapter, KnownSession } from './dsh-adapter.js'

export type { KnownSession }

export interface ConnectionCardHostService {
  // 连接管理
  createConnection(sessionA: string, sessionB: string): Connection
  disconnect(id: string): void
  updatePermission(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): void
  requestPermissionUpgrade(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): string | null
  acceptPermissionUpgrade(requestId: string, acceptorId: string): boolean
  rejectPermissionUpgrade(requestId: string, rejectorId: string): void
  getConnectionsBySession(sessionId: string): Connection[]
  getConnectionById(id: string): Connection | undefined
  getAllConnections(): Connection[]

  // 事件订阅
  onConnectionEvent(event: 'created' | 'updated' | 'disconnected', handler: (conn: Connection) => void): () => void
  subscribeConnectionEvent(connectionId: string, event: string, handler: (data: unknown) => void): () => void
  emitConnectionEvent(connectionId: string, event: string, data: unknown): void

  // 卡片管理
  loadCard(templateId: string, connectionId: string): Promise<CardInstance>
  unloadCard(instanceId: string): Promise<void>
  reloadCard(instanceId: string): Promise<void>

  // 白名单管理
  negotiateWhitelist(connectionId: string, methods: { method: string; description: string }[]): void
  isWhitelisted(connectionId: string, method: string): boolean
  listWhitelistedMethods(connectionId: string): { method: string; description: string; approvedBy: string[] }[]

  // 会话列表（面板的会话选择器用）
  listSessions(): KnownSession[]
}

export function createStableApi(
  manager: ConnectionManager,
  eventBus: ConnectionEventBus,
  cardHost?: CardHost,
  adapter?: DSHAdapter,
): ConnectionCardHostService {
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
    loadCard: (tid, cid) => cardHost!.loadCard(tid, cid),
    unloadCard: (iid) => cardHost!.unloadCard(iid),
    reloadCard: (iid) => cardHost!.reloadCard(iid),
    negotiateWhitelist: (cid, methods) => manager.whitelist.negotiate(cid, methods),
    isWhitelisted: (cid, method) => manager.whitelist.isAllowed(cid, method),
    listWhitelistedMethods: (cid) => manager.whitelist.listMethods(cid).map(e => ({ method: e.method, description: e.description, approvedBy: e.approvedBy })),
    listSessions: () => adapter?.listSessions() ?? [],
  }
}
