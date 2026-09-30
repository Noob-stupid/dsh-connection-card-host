/**
 * ConnectionManager — 连接生命周期管理。
 * 创建时检查重复会话对；断开时通知卡片宿主暂停所有卡片。
 * 集成权限升级协商（低→高需双方确认）。
 */
import { randomUUID } from 'node:crypto'
import type { Connection, PermissionLevel } from '../types/index.js'
import { permValue } from '../types/permission.js'
import { Persistence } from './persistence.js'
import { ConnectionEventBus } from './event-bus.js'
import { PermissionUpgradeManager, RemoteMethodWhitelist } from './permission.js'
import { ConnectionMessageLog } from './message-log.js'
import type { ConventionBox } from './box.js'

type EventHandler = (conn: Connection) => void

export class ConnectionManager {
  private connections: Map<string, Connection> = new Map()
  private persistence: Persistence
  private eventBus: ConnectionEventBus
  private listeners = new Map<string, Set<EventHandler>>()
  readonly upgradeManager: PermissionUpgradeManager
  readonly whitelist: RemoteMethodWhitelist
  /** 连接两端的规范交流记录（「交流配合」的底座）。 */
  readonly messages: ConnectionMessageLog

  /** 公约盒（连接级共享约定）。由 index.ts 在构造后挂上并负责持久化。 */
  private box: ConventionBox | null = null

  /** 挂上公约盒，并把已持久化的约定载回来。 */
  attachBox(box: ConventionBox): void {
    this.box = box
    const all = this.persistence.getAllConventions()
    for (const [connectionId, list] of Object.entries(all)) {
      if (list.length > 0) box.hydrate(connectionId, list)
    }
  }

  /** 取公约盒（未挂上时返回 null，调用方需处理）。 */
  conventions(): ConventionBox | null {
    return this.box
  }

  /** 把某连接的约定落盘。 */
  persistConventions(connectionId: string): void {
    if (!this.box) return
    this.persistence.setConventions(connectionId, this.box.dump(connectionId))
  }

  constructor(persistence: Persistence, eventBus: ConnectionEventBus) {
    this.persistence = persistence
    this.eventBus = eventBus
    this.upgradeManager = new PermissionUpgradeManager(eventBus)
    this.whitelist = new RemoteMethodWhitelist(eventBus)
    this.messages = new ConnectionMessageLog(eventBus, (m) => console.log('[ConnectionMessage]', m))
    // 从持久化恢复
    for (const conn of persistence.getConnections()) {
      this.connections.set(conn.id, conn)
      // 交流记录也要恢复，否则重启后对话历史消失
      const history = persistence.getMessages(conn.id)
      if (history.length > 0) this.messages.hydrate(conn.id, history)
    }
  }

  /** 把某连接的交流记录落盘。 */
  persistMessages(connectionId: string): void {
    this.persistence.setMessages(connectionId, this.messages.dump(connectionId))
  }

  /**
   * 创建连接。若同一对会话已存在连接，返回已有连接。
   * 默认权限 aToB = 'read', bToA = 'read'。
   */
  create(sessionA: string, sessionB: string): Connection {
    // 检查重复（双向）
    for (const conn of this.connections.values()) {
      if (
        (conn.sessionA === sessionA && conn.sessionB === sessionB) ||
        (conn.sessionA === sessionB && conn.sessionB === sessionA)
      ) {
        return conn
      }
    }

    const now = Date.now()
    const conn: Connection = {
      id: randomUUID(),
      sessionA,
      sessionB,
      permission: { aToB: 'read', bToA: 'read' },
      status: 'active',
      health: 'green',
      cards: [],
      createdAt: now,
      updatedAt: now,
    }

    this.connections.set(conn.id, conn)
    this.persistence.addConnection(conn)
    this.emit('created', conn)
    return conn
  }

  /**
   * 权限升级：低→高需双方确认；高→低直接生效。
   * 返回升级请求 id；accepted 后自动调用 updatePermission。
   */
  requestPermissionUpgrade(
    id: string,
    direction: 'aToB' | 'bToA',
    to: PermissionLevel,
  ): string | null {
    const conn = this.connections.get(id)
    if (!conn) return null
    const from = conn.permission[direction]

    // 高→低或同级：直接生效
    if (permValue(to) <= permValue(from)) {
      this.updatePermission(id, direction, to)
      return null
    }

    // 低→高：发起协商
    const req = this.upgradeManager.requestUpgrade(id, direction, from, to)

    // 监听 accepted 事件，自动更新权限
    const off = this.eventBus.subscribe(id, 'permission_upgrade_accepted', (data: any) => {
      if (data?.id === req.id) {
        this.updatePermission(id, direction, to)
        off()
      }
    })

    return req.id
  }

  /** 确认权限升级请求 */
  acceptPermissionUpgrade(requestId: string, acceptorId: string): boolean {
    return this.upgradeManager.acceptUpgrade(requestId, acceptorId)
  }

  /** 拒绝权限升级请求 */
  rejectPermissionUpgrade(requestId: string, rejectorId: string): void {
    this.upgradeManager.rejectUpgrade(requestId, rejectorId)
  }

  /**
   * 把某条连接的当前状态落盘。
   * 连接上的卡片增删不经过 create/updatePermission，需要显式调用。
   */
  persistConnection(id: string): void {
    const conn = this.connections.get(id)
    if (!conn) return
    this.persistence.updateConnection(id, () => conn)
  }

  updatePermission(
    id: string,
    direction: 'aToB' | 'bToA',
    level: PermissionLevel,
  ): void {
    const conn = this.connections.get(id)
    if (!conn) return
    conn.permission[direction] = level
    conn.updatedAt = Date.now()
    this.persistence.updateConnection(id, () => conn)
    this.emit('updated', conn)
  }

  disconnect(id: string): void {
    const conn = this.connections.get(id)
    if (!conn) return
    conn.status = 'broken'
    conn.updatedAt = Date.now()
    this.persistence.removeConnection(id)
    this.connections.delete(id)
    this.eventBus.clearConnection(id)
    this.whitelist.clearConnection(id)
    this.messages.clear(id)
    this.box?.drop(id)
    this.persistence.setConventions(id, [])
    this.emit('disconnected', conn)
  }

  getBySession(sessionId: string): Connection[] {
    const result: Connection[] = []
    for (const conn of this.connections.values()) {
      if (conn.sessionA === sessionId || conn.sessionB === sessionId) {
        result.push(conn)
      }
    }
    return result
  }

  getById(id: string): Connection | undefined {
    return this.connections.get(id)
  }

  getAll(): Connection[] {
    return Array.from(this.connections.values())
  }

  on(event: 'created' | 'updated' | 'disconnected', handler: EventHandler): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)
    return () => { set!.delete(handler) }
  }

  private emit(event: string, conn: Connection): void {
    const set = this.listeners.get(event)
    if (set) {
      for (const h of set) {
        try { h(conn) } catch (e) {
          console.error(`[ConnectionManager] listener error for ${event}:`, e)
        }
      }
    }
  }
}
