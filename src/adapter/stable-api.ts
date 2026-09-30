/**
 * Stable API — 对外暴露的稳定接口层。
 * 浏览器端和卡片通过此接口与宿主交互，隔离内部实现变化。
 */
import type { Connection, PermissionLevel, CardInstance, ConnectionMessage, MessageKind, SendGate } from '../types/index.js'
import type { ConnectionManager } from '../core/connection-manager.js'
import type { ConnectionEventBus } from '../core/event-bus.js'
import type { CardHost, CardTemplateInfo } from '../card-host/loader.js'
import type { DSHAdapter, KnownSession } from './dsh-adapter.js'
import type { SessionBridge } from './session-bridge.js'
import type { WorkState, WorkStateTracker } from '../core/work-state.js'
import type { AddResult, Convention, ConventionBox } from '../core/box.js'

export type { KnownSession, CardTemplateInfo, WorkState, Convention, AddResult }

/** 协作感知两层的依赖（由 index.ts 装配后注入）。 */
export interface AwarenessDeps {
  workState: WorkStateTracker
  box: ConventionBox
}

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
  /** 可用卡片模板（含在当前连接上已装载的数量）。 */
  listCardTemplates(connectionId?: string): CardTemplateInfo[]
  /** 渲染卡片面板 HTML（宿主侧跑 renderPanel/mountPanel，取回 HTML）。 */
  renderCardPanel(instanceId: string): Promise<string | null>

  /** 待确认的权限升级请求（面板据此显示「待确认 + 同意/拒绝」）。 */
  listPendingUpgrades(connectionId?: string): {
    id: string
    connectionId: string
    direction: 'aToB' | 'bToA'
    from: PermissionLevel
    to: PermissionLevel
    acceptedCount: number
    requiredAccepts: number
  }[]

  // 白名单管理
  negotiateWhitelist(connectionId: string, methods: { method: string; description: string }[]): void
  isWhitelisted(connectionId: string, method: string): boolean
  listWhitelistedMethods(connectionId: string): { method: string; description: string; approvedBy: string[] }[]

  // 会话列表（面板的会话选择器用）
  listSessions(): KnownSession[]

  // 连接交流记录（「双方开启可读写后规范交流配合」的底座）
  listMessages(
    connectionId: string,
    options?: { since?: number; limit?: number },
  ): ConnectionMessage[]
  sendMessage(
    connectionId: string,
    from: 'a' | 'b',
    kind: MessageKind,
    text: string,
    options?: { replyTo?: string },
  ): SendGate & { message?: ConnectionMessage }
  /** 清空某条连接的交流记录（连接本身不动）。 */
  clearMessages(connectionId: string): { ok: boolean; removed: number }

  // ── 协作感知 A 层：工作状态 ──
  /** 某会话当前在干什么（采集自工具事件）。未采集到时返回 null。 */
  peerWork(sessionId: string, label: string): string | null
  /** 某会话的工作状态原始快照（面板用）。 */
  workSnapshot(sessionId: string): WorkState | undefined
  /** 本连接两端的工作状态对照文本。 */
  connectionWork(connectionId: string): { a: WorkState | undefined; b: WorkState | undefined }

  // ── 协作感知 B 层：公约盒 ──
  listConventions(connectionId: string, includeSuperseded?: boolean): Convention[]
  searchConventions(connectionId: string, keyword: string): Convention[]
  /** 声明一条约定。supersedes 用于取代旧约定（保留追溯）。 */
  declareConvention(
    connectionId: string,
    by: 'a' | 'b',
    topic: string,
    text: string,
    supersedes?: string,
  ): AddResult
  removeConvention(connectionId: string, id: string): boolean
  /** 渲染公约盒文本（给模型看）。aLabel/bLabel 必须按连接自己的端点定义传。 */
  renderConventions(connectionId: string, aLabel: string, bLabel: string): string

  // 会话桥（「A 说话 B 能感知」）
  /** 会话桥能力探测。 */
  relayCapabilities(): { observe: boolean; deliver: boolean; via: string[]; notes: string[] }
  /** 直接往某个会话投递文本（目标必须有 live agent）。 */
  deliverToSession(sessionId: string, text: string, wake?: boolean): Promise<{ ok: boolean; via?: string; reason?: string }>
  /** 读取某会话最近的消息（诊断用）。 */
  readSessionRecent(sessionId: string, limit?: number): { role: string; text: string }[]
}

export function createStableApi(
  manager: ConnectionManager,
  eventBus: ConnectionEventBus,
  cardHost?: CardHost,
  adapter?: DSHAdapter,
  bridge?: SessionBridge,
  awareness?: AwarenessDeps,
): ConnectionCardHostService {
  const track = awareness?.workState
  const box = awareness?.box
  /** 声明约定后立刻落盘（公约必须跨重启保留）。 */
  const persistBox = (cid: string): void => manager.persistConventions(cid)

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
    listCardTemplates: (cid) => cardHost!.listTemplates(cid),
    renderCardPanel: (iid) => cardHost!.renderCardPanel(iid),
    listPendingUpgrades: (cid) =>
      manager.upgradeManager.getPendingRequests(cid).map((r) => ({
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
      const before = manager.messages.list(cid, {}).length
      manager.messages.clear(cid)
      manager.persistMessages(cid)
      return { ok: true, removed: before }
    },
    sendMessage: (cid, from, kind, text, options) => {
      const conn = manager.getById(cid)
      const result = manager.messages.append(conn, from, kind, text, options ?? {})
      if (result.ok) manager.persistMessages(cid)
      return result.ok
        ? { ok: true, ...(result.message ? { message: result.message } : {}) }
        : { ok: false, reason: result.reason }
    },
    relayCapabilities: () =>
      bridge?.capabilities() ?? {
        observe: false,
        deliver: false,
        via: [],
        notes: ['会话桥未装配'],
      },

    // ── 协作感知 A 层：工作状态（只读，采集自工具事件） ──
    peerWork: (sessionId, label) => track?.summarize(sessionId, label) ?? null,
    workSnapshot: (sessionId) => track?.get(sessionId),
    connectionWork: (connectionId) => {
      const conn = manager.getById(connectionId)
      if (!conn) return { a: undefined, b: undefined }
      return { a: track?.get(conn.sessionA), b: track?.get(conn.sessionB) }
    },

    // ── 协作感知 B 层：公约盒（显式声明，持久） ──
    listConventions: (cid, includeSuperseded) =>
      box?.list(cid, { ...(includeSuperseded !== undefined ? { includeSuperseded } : {}) }) ?? [],
    searchConventions: (cid, keyword) => box?.search(cid, keyword) ?? [],
    declareConvention: (cid, by, topic, text, supersedes) => {
      if (!box) return { ok: false, reason: '公约盒未装配' }
      const r = box.add(cid, by, topic, text, supersedes)
      if (r.ok) persistBox(cid)
      return r
    },
    removeConvention: (cid, id) => {
      const ok = box?.remove(cid, id) ?? false
      if (ok) persistBox(cid)
      return ok
    },
    renderConventions: (cid, aLabel, bLabel) =>
      box?.render(cid, aLabel, bLabel) ?? '公约盒未装配',
    deliverToSession: async (sessionId, text, wake = true) => {
      if (!bridge) return { ok: false, reason: '会话桥未装配' }
      const r = await bridge.deliver(sessionId, text, wake)
      return r.ok ? { ok: true, ...(r.via ? { via: r.via } : {}) } : { ok: false, reason: r.reason }
    },
    readSessionRecent: (sessionId, limit) => bridge?.readRecent(sessionId, limit ?? 20) ?? [],
  }
}
