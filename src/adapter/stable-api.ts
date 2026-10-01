/**
 * Stable API — 对外暴露的稳定接口层。
 * 浏览器端和卡片通过此接口与宿主交互，隔离内部实现变化。
 */
import type { Connection, PermissionLevel, CardInstance, ConnectionMessage, MessageKind, SendGate, CardScope } from '../types/index.js'
import type { ConnectionManager } from '../core/connection-manager.js'
import type { ConnectionEventBus } from '../core/event-bus.js'
import type { CardHost, CardTemplateInfo } from '../card-host/loader.js'
import type { DSHAdapter, KnownSession } from './dsh-adapter.js'
import type { SessionBridge, DeliverUrgency } from './session-bridge.js'
import type { WorkState, WorkStateTracker } from '../core/work-state.js'
import type { AddResult, Convention, ConventionBox } from '../core/box.js'
import { installCard, uninstallCard, type InstallResult } from '../card-host/installer.js'
import { checkCardUpdate, readSourceRecord, type UpdateCheck } from '../card-host/updates.js'

export type { KnownSession, CardTemplateInfo, WorkState, Convention, AddResult, InstallResult }

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
  loadCard(templateId: string, connectionId: string, scope?: CardScope): Promise<CardInstance>
  unloadCard(instanceId: string): Promise<void>
  reloadCard(instanceId: string): Promise<void>
  /** 改已装载卡片的可见范围（两端 / 仅 A / 仅 B）。返回 false = 模板钉死了或实例不存在。 */
  setCardScope(instanceId: string, scope: CardScope): boolean
  /** 可用卡片模板（含在当前连接上已装载的数量）。 */
  listCardTemplates(connectionId?: string): CardTemplateInfo[]
  /** 渲染卡片面板 HTML（宿主侧跑 renderPanel/mountPanel，取回 HTML）。 */
  renderCardPanel(instanceId: string): Promise<string | null>

  // ── 面板内安装（装到我们自己的目录，完全不碰 profile） ──
  /**
   * 安装一张卡片。spec 支持：本地目录 / 本地 tgz / npm 包名 / HTTP tgz 地址。
   * 装到 `$DSH_HOME/connection-cards/cards/<id>/`，不跑 pnpm、不动 profile。
   */
  installCard(spec: string): Promise<InstallResult>
  /** 卸载一张已安装的卡片（只删我们目录下的）。 */
  uninstallCard(cardId: string): { ok: boolean; reason?: string }

  /**
   * 检查某张已安装卡片有没有更新。
   *
   * **判断不了时带 `reason`，而不是 `hasUpdate: false`** ——
   * "无法检查"和"已是最新"是两回事，面板必须能区分，否则就是谎报。
   */
  checkCardUpdate(cardId: string): UpdateCheck

  /**
   * 更新一张卡片：照着**记录的来源**重装 + 让已装载的实例重载。
   *
   * 能"装载中更新"靠的是版本化目录（新版本写新目录，不碰被锁的旧的）。
   */
  updateCard(cardId: string): Promise<{
    ok: boolean
    version?: string
    reloaded?: number
    dir?: string
    reason?: string
  }>
  /** 已安装卡片的根目录（面板显示给用户看，让"装到哪儿了"是透明的）。 */
  cardsRoot(): string

  /**
   * 某连接上、**对某一端可见**的卡片工具。
   *
   * 卡片此前只能画面板（`renderPanel`）；`registerTool` 注册进去**没人读**
   * （`card-api.ts` 里注释写着"暴露工具表供宿主按白名单转发调用"，但全仓库
   * 没有第二处引用）。这两个方法把它接通：
   * 会话通过 `connection_card_tool` 桥接工具能**列**、能**调**，
   * 且**遵守卡片的可见范围**（`both` / `仅 A` / `仅 B`）。
   */
  listCardTools(
    connectionId: string,
    side: 'a' | 'b',
  ): { instanceId: string; cardId: string; scope: string; tools: string[] }[]

  /** 调用某张卡片的工具（**带可见范围校验**）。 */
  callCardTool(
    instanceId: string,
    tool: string,
    args: unknown,
    side: 'a' | 'b',
  ): Promise<{ ok: boolean; value?: unknown; reason?: string }>

  /**
   * 中继运行诊断（**可查询，不靠翻日志**）。
   *
   * 目前暴露"被挡下的非真人来源计数"。存在的理由：日志会被清空/滚动，
   * 只写一次的信号一旦滚掉就永久消失；放进可查询的状态面才可靠 ——
   * 这也顺带补上"状态靠翻日志猜"这个协作感知缺口。
   */
  relayDiagnostics(): {
    skipped: {
      sessionId: string
      kind: string
      count: number
      lastSeenAt: number
      lastDropped: string
    }[]
    total: number
    /**
     * 中继**是否真的在自动转发**。
     *
     * 面板的警告条必须依据这个、而不是权限档位 —— 两者在 2026-10-01 之后
     * 已经解耦：自动转发默认关闭，权限只影响**显式发送**能发哪类消息。
     * 只看权限会让 UI 喊狼来了（"正在互相转发"而实际什么也没转发）。
     */
    relayConfig: { relayAssistant: boolean; relayUser: boolean }
  }

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
    options?: {
      replyTo?: string
      urgency?: DeliverUrgency
    },
  ): Promise<{
    ok: boolean
    message?: ConnectionMessage
    /** 是否**真的投到了对端会话**（false 时看 reason）。 */
    delivered?: boolean
    reason?: string
  }>
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
    by: 'a' | 'b' | 'user',
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
  deliverToSession(
    sessionId: string,
    text: string,
    urgency?: DeliverUrgency,
    form?: 'mirror' | 'handoff',
  ): Promise<{ ok: boolean; via?: string; reason?: string }>
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
  auditLog?: (msg: string) => void,
  relay?: { config(): { relayAssistant: boolean; relayUser: boolean } },
): ConnectionCardHostService {
  const track = awareness?.workState
  const box = awareness?.box
  const audit = auditLog ?? ((m: string) => console.log('[ConnectionCardHost]', m))
  /** 声明约定后立刻落盘（公约必须跨重启保留）。 */
  const persistBox = (cid: string): void => manager.persistConventions(cid)

  return {
    /**
     * 建连接 —— 并且**通知两端会话**。
     *
     * ## 为什么必须通知（2026-10-01 用户提出的场景）
     *
     * 用户的原话：
     *   > 用户本来就有两个或多个对话，把他们搭线后（**搭线后两边会话能自己发现吗**）
     *   > 能就着原来自己会话的任务情况后续交流协作吗？
     *
     * 早先 `create()` **只写进管理器的表**，一个字节都不投给会话 ——
     * 于是搭线对两端**完全不可见**：它们只有碰巧调用 `connection_peer_work` 才会发现。
     * 工具 schema 虽然在上下文里，但**没有任何东西提示它去用**。
     *
     * ## 为什么用 quiet（inject）
     *
     * `quiet` = 只放进上下文、**不唤醒**。两端在**下次干活时**自然看到这条，
     * 不会被平白打断一轮。建连接是一次性事件，代价很小，收益是"发现得了"。
     *
     * ## 为什么要写清"能做什么"
     *
     * 只说"你被连接了"没用 —— 会话不知道该拿它干什么。所以把三个工具的用途一并写进去，
     * 让"发现"直接变成"可用"。
     */
    createConnection: (a, b) => {
      const conn = manager.create(a, b)
      if (!bridge) return conn

      const label = (sid: string): string => {
        const known = adapter?.listSessions?.().find((s) => s.id === sid)
        const title = known?.title?.trim()
        if (title) return title
        const short = sid.replace(/^session-/, '').slice(0, 8)
        return `会话 ${short}`
      }

      // 两端各发一条（不唤醒）。文案刻意写成"可用能力清单"而不是"通知"。
      for (const [self, peer] of [
        [a, b],
        [b, a],
      ] as const) {
        void bridge
          .deliver(
            self,
            `[连接已建立] 你与本机另一个会话连上了：**${label(peer)}**。\n` +
              `\n` +
              `这条连接让你能：\n` +
              `  · connection_peer_work —— 看它**正在做什么**（在改哪些文件、计划到哪一步）。这是拉取式的，不占它上下文。\n` +
              `  · connection_conventions —— 看你们**说好了什么**（接口、单位、命名、分工）。\n` +
              `  · connection_send —— 给它发消息（紧急度自己判断：不急用 quiet，一般用 normal，要它立刻改行为才 urgent）。\n` +
              `\n` +
              `如果你的活与它相关（改同一批文件、依赖同一个接口、分工有交叉），` +
              `先查它的状态再动手；需要对齐就写进公约盒。**不相关就不用管它** —— 这条连接不会打扰你。`,
            'quiet',
          )
          .catch(() => {})
      }
      return conn
    },
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
    loadCard: (tid, cid, scope) => cardHost!.loadCard(tid, cid, scope),
    unloadCard: (iid) => cardHost!.unloadCard(iid),
    reloadCard: (iid) => cardHost!.reloadCard(iid),
    setCardScope: (iid, scope) => cardHost!.setCardScope(iid, scope),
    installCard: async (spec) => {
      if (!cardHost) return { ok: false, reason: '卡片宿主未装配' }
      const result = await installCard(spec, cardHost.installedCardsRoot(), audit)
      // 装完立刻重扫，卡片马上出现在列表里
      if (result.ok) cardHost.scanTemplates(true)
      return result
    },
    uninstallCard: (cardId) => {
      if (!cardHost) return { ok: false, reason: '卡片宿主未装配' }
      const r = uninstallCard(cardId, cardHost.installedCardsRoot())
      if (r.ok) cardHost.scanTemplates(true)
      return r
    },
    cardsRoot: () => cardHost?.installedCardsRoot() ?? '',

    /**
     * 检查某张已安装卡片有没有更新。
     *
     * **判断不了时会带 `reason` 而不是 `hasUpdate: false`** ——
     * "无法检查"和"已是最新"是两回事，面板必须能区分，否则就是谎报。
     */
    checkCardUpdate: (cardId) => {
      if (!cardHost) return { cardId, spec: '', kind: 'dir' as const, dirName: '', reason: '卡片宿主未装配' }
      return checkCardUpdate(cardHost.installedCardsRoot(), cardId)
    },

    /**
     * 更新一张卡片：照着**记录的来源**重装，然后让装载的实例重载。
     *
     * 之所以能"装载中更新"：安装走**版本化目录**（新版本写新目录，不碰被锁的旧的），
     * 指针切过去之后 `reloadCard` 从新目录导入 —— 所有子模块的 URL 都是新的，
     * 不会被 ESM 缓存命中旧代码。
     */
    updateCard: async (cardId) => {
      if (!cardHost) return { ok: false, reason: '卡片宿主未装配' }
      const root = cardHost.installedCardsRoot()
      const rec = readSourceRecord(root, cardId)
      if (!rec) {
        return { ok: false, reason: '没有来源记录，无法自动更新；请用原来的地址重新安装一次' }
      }
      const r = await installCard(rec.spec, root, audit)
      if (!r.ok) return { ok: false, reason: r.reason }
      cardHost.scanTemplates(true)

      // 已装载的实例重载到新代码（没装载的话下次装载自然是新的）
      let reloaded = 0
      for (const inst of cardHost.listInstancesByTemplate(cardId)) {
        await cardHost.reloadCard(inst.instanceId)
        reloaded++
      }
      audit(`卡片已更新：${cardId} → ${r.version ?? '?'}（重载 ${reloaded} 个实例）`)
      return {
        ok: true,
        version: r.version,
        reloaded,
        dir: r.dir,
      }
    },
    listCardTools: (cid, side) => cardHost?.listCardTools(cid, side) ?? [],
    callCardTool: async (instanceId, tool, args, side) =>
      cardHost?.callCardTool(instanceId, tool, args, side) ?? {
        ok: false,
        reason: '卡片宿主未装配',
      },
    relayDiagnostics: () => {
      const s = bridge?.skippedSummary() ?? { entries: [], total: 0 }
      return {
        skipped: s.entries,
        total: s.total,
        relayConfig: relay?.config() ?? { relayAssistant: false, relayUser: false },
      }
    },
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
    /**
     * 发一条消息 —— **记录 + 真的投到对端会话**。
     *
     * ⚠️ 早先这里**只写进连接的消息日志**（给面板/卡片看），**不投递** ——
     * 于是"传话"实际上从来没有真的到达过对端（唯一能到的是中继的自动转发，
     * 而那已经在 2026-10-01 默认关闭）。所以这个函数必须自己负责投递。
     *
     * 投递目标 = 发送端的**对端**（from='a' → 投给 B）。
     * text 是调用方明确给的 —— **这条路径没有任何途径读到会话内容**，
     * 所以它不可能带上"镜像"那类东西。
     */
    sendMessage: async (cid, from, kind, text, options) => {
      const conn = manager.getById(cid)
      const result = manager.messages.append(conn, from, kind, text, options ?? {})
      if (!result.ok) return { ok: false, reason: result.reason }
      manager.persistMessages(cid)

      // ── 真的投到对端会话 ──
      const target = from === 'a' ? conn?.sessionB : conn?.sessionA
      if (bridge && target) {
        const urgency = options?.urgency ?? 'normal'
        const d = await bridge.deliver(
          target,
          // 前缀让对端一眼看出"这是一条发给我的消息"（与自动同步区分）
          `[对方消息 · ${kind === 'ask' ? '请求' : kind === 'reply' ? '回复' : '发言'}] ${text}`,
          urgency,
          'handoff',
        )
        if (!d.ok) {
          return { ok: true, message: result.message, delivered: false, reason: d.reason }
        }
      }

      return {
        ok: true,
        ...(result.message ? { message: result.message } : {}),
        delivered: true,
      }
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
    deliverToSession: async (sessionId, text, urgency = 'normal', form = 'handoff') => {
      if (!bridge) return { ok: false, reason: '会话桥未装配' }
      const r = await bridge.deliver(sessionId, text, urgency, form)
      return r.ok ? { ok: true, ...(r.via ? { via: r.via } : {}) } : { ok: false, reason: r.reason }
    },
    readSessionRecent: (sessionId, limit) => bridge?.readRecent(sessionId, limit ?? 20) ?? [],
  }
}
