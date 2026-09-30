/**
 * SessionBridge — 宿主 ↔ 会话 的桥。
 *
 * 这是「A 说话 B 能感知」的实现层。两个方向：
 *   - observe：`ctx.on('session/event', (session, event) => ...)`
 *     宿主级监听**收到所有会话**的事件（无 scope 的监听器 = 全局）。
 *   - deliver：`ctx.agents.get(sessionId)` → `agent.followup(msg)` 投递并唤醒；
 *     只想让对方"看到但先别动"用 `agent.inject(msg)`（不唤醒 driver）。
 *
 * ## 为什么全部走 safeCtxGet + 形状探测，而不是 import
 *
 * 本插件不 import 任何 `@deepseek-ai/*` 运行时代码（除了 cordis 类型），
 * 原因是**开发用的 checkout 与真实运行时差一个大版本**（0.1.0-rc.5 vs 0.2.0-rc.2），
 * 硬 import 会在另一边直接崩。实测差异包括：
 *   - `session.events`       → runtime 已删，改 `snapshotEvents()`
 *   - `assistant/chunk`      → runtime 已删，改 `assistant/attempt`
 *   - `ctx.sessionController`→ 仅 runtime 有
 * 所以这里只按"两个版本的交集 + 形状探测"写，拿不到就诚实报错，绝不猜。
 */
import type { Context } from '@deepseek-ai/cordis'
import { safeCtxGet, safeCtxMethod } from '../safe-ctx.js'

/** 观察到的会话活动。 */
export interface SessionActivity {
  sessionId: string
  /** 谁说的：user=用户输入，assistant=模型输出 */
  role: 'user' | 'assistant'
  text: string
  /** 事件序号（会话内单调递增），用于去重/断点续读。 */
  seq: number
  /** 这条消息的来源是不是本插件投递的（防回环用）。 */
  fromPlugin: boolean
  /**
   * 这轮回复是否由本插件投递的消息触发 —— 即它处在中继链的后续跳上。
   *
   * 为什么需要单独一个标志：助手消息的 `source.kind` 是 `model`，不是 plugin，
   * 所以光看 source 挡不住「收到中继消息后自动回复、回复又被中继出去」的无限乒乓。
   * 判据是**该会话最近一条 user 消息是不是我们投递的**。
   */
  relayTriggered: boolean
}

/**
 * 投递紧急度 —— **由调用方按情况判断**（助手自己决定，不要求用户选）。
 *
 *   quiet   只告知：放进上下文不唤醒。进展同步、背景信息。
 *   normal  排队（默认）：对方处理完手头的事就看到。一般任务与请求。
 *   urgent  插话：插进对方**正在跑的那一轮**。阻塞问题、"先停手"。
 *
 * 之所以由调用方判断而不是系统写死：**只有发起方知道这件事急不急**。
 * 旧实现是"只要对端在跑就打断"（等价于每条消息都是最高优先级），
 * 而大部分消息并不急 —— 打断的代价（对端中断当前思路）只该在真急时付。
 */
export type DeliverUrgency = 'quiet' | 'normal' | 'urgent'

export interface DeliverResult {
  ok: boolean
  /** 实际走通的通道，便于诊断。 */
  via?: 'sessionController' | 'agents.steer' | 'agents.followup' | 'agents.inject'
  /** 实际使用的投递模式：steer=即时插话，queue=排队到下一轮，inject=只放进上下文。 */
  mode?: 'steer' | 'queue' | 'inject'
  /** 投递时对端是否处于活跃状态（false = 把它冷启动唤醒了）。 */
  live?: boolean
  reason?: string
}

/** 从 ContentBlock[] 里抽纯文本（块类型未知的用 [type] 占位）。 */
function textOfBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const b = block as { type?: unknown; text?: unknown } | null
      if (b?.type === 'text' && typeof b.text === 'string') return b.text
      return typeof b?.type === 'string' ? `[${b.type}]` : ''
    })
    .filter((s) => s.length > 0)
    .join('')
}

/**
 * 被视为**真人发言**的 `source.kind` 允许集。
 *
 * 目前只有 `user`。要加新来源时在这里显式写出来 —— 未知来源一律被挡，
 * 但**会在审计日志里留痕**（见 `noteSkippedKind`），所以框架若改了 kind，
 * 你能从日志发现，而不是靠对端"我发了你怎么没反应"。
 */
const HUMAN_SOURCE_KINDS: ReadonlySet<string> = new Set(['user'])

/**
 * 只取**真正的正文**（type=text 的块），不含 `[reasoning]` / `[tool-call]` 这类占位。
 *
 * 为什么单独要这个：一轮对话里 `assistant/message` 会触发**多次** ——
 * 带工具调用时，中间的助手消息往往只有思考块和工具调用块、没有正文。
 * 那些是**过程**不是**发言**，中继出去毫无意义（用户看到的是 `[reasoning][tool-call]`）。
 * 所以判断"这条值不值得中继"要用这个，而不是上面那个带占位的版本。
 */
function textContentOnly(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const b = block as { type?: unknown; text?: unknown } | null
      return b?.type === 'text' && typeof b.text === 'string' ? b.text : ''
    })
    .filter((s) => s.length > 0)
    .join('')
}

/** 判断消息来源是不是我们自己投递的（防止 A→B→A 无限回环）。 */
function isFromPlugin(source: unknown, deliveryIds?: Set<string>): boolean {
  const s = source as { kind?: unknown; plugin?: unknown; rpcId?: unknown } | null
  // ① 当前形状：producer-owned kind
  if (s?.kind === PLUGIN_SOURCE_KIND) return true
  // ② 兼容旧形状（V3 的 `{ kind: 'plugin', plugin }` 包装）：
  // 老宿主/老日志里仍是这个形状，认出来才能继续防回环。
  if (s?.kind === 'plugin' && s?.plugin === PLUGIN_SOURCE) return true
  // ③ 投递 id 命中我们登记过的集合 —— 框架覆写 source 时的兜底
  if (typeof s?.rpcId === 'string' && deliveryIds?.has(s.rpcId)) return true
  // ④ id 前缀兜底：即便登记集合因宿主重启而空了，`ccr-` 也是本插件独有的前缀
  if (typeof s?.rpcId === 'string' && s.rpcId.startsWith('ccr-')) return true
  return false
}

/** 投递时写的 source.plugin 标识，用于回环识别。 */
export const PLUGIN_SOURCE = 'dsh-connection-card-host'

/**
 * 投递时写进 `source.kind` 的 **producer-owned kind**。
 *
 * 会话消息格式升到 V4 后（框架 0.1.7-rc.1 起），每条被解释的消息 source
 * 都必须带一个「生产方自己的 kind」——非空、且**不能**是字面量 `'plugin'`
 * （那是已退役的 V3 包装）。写错这一个字，收端一开会话就报
 * `format v4 message requires a producer-owned source kind`，整个会话卡死。
 * 第三方插件的规范形状是 `plugin:<包名>`，与框架自带的 V3→V4 迁移器一致。
 */
export const PLUGIN_SOURCE_KIND = `plugin:${PLUGIN_SOURCE}`

export class SessionBridge {
  private ctx: Context
  private listeners = new Set<(activity: SessionActivity) => void>()
  private off: (() => void) | undefined
  private auditLog: (msg: string) => void
  /** 记录本插件投递过的 sessionId，投递瞬间到达的 session/event 据此忽略。 */
  private delivering = new Set<string>()
  /**
   * 能读到 `sessionController` 的上下文。
   *
   * 为什么要单独存一个 ctx：cordis 是 Proxy，**没在 inject 里声明的服务读不到**。
   * `sessionController` 只在 runtime 0.2+ 有，不能放进静态 inject 数组
   * （那会让插件在旧版本上直接不加载），只能用 `ctx.inject([...], cb)` 拿一个
   * 已声明该服务的 scope，再从这里做查找。
   *
   * 它值钱的地方：`sessionController.prompt()` 是「**活则复用、冷则 resume**」——
   * 对端没打开时能把它**唤醒**，而不是投递失败。
   */
  private controllerCtx: Context | null = null

  /** 原始会话事件订阅者（不过滤事件类型）。 */
  private rawHandlers = new Set<(sessionId: string, event: unknown) => void>()

  /**
   * 我们最近投递时生成并登记的 requestId。
   *
   * 这是**不依赖 source 形状**的防回环依据：`sessionController.prompt()` 会把
   * 调用方的 `requestId` 放进它自己造的 `source.rpcId`，所以只要 id 还在集合里，
   * 哪怕框架改掉 source.kind，我们仍能认出"这条是自己人发的"。
   * 见 `isFromPlugin()` 的说明与 2026-09-30 回声事故。
   */
  private deliveryIds = new Set<string>()
  /** sessionId → 最近一次投递时刻（用于把过期 id 清出去）。 */
  private deliveryIdTimes = new Map<string, number>()

  /** 投递 id 保留多久（远超一轮对话的时间，够覆盖排队与冷启动）。 */
  private static readonly DELIVERY_ID_TTL = 10 * 60_000

  /** 登记一条投递的 id（供防回环识别）。 */
  private rememberDeliveryId(id: string): void {
    this.deliveryIds.add(id)
    this.deliveryIdTimes.set(id, Date.now())
    this.pruneDeliveryIds()
  }

  /** 清掉过期 id，避免集合无限增长。 */
  private pruneDeliveryIds(): void {
    const cutoff = Date.now() - SessionBridge.DELIVERY_ID_TTL
    for (const [id, at] of this.deliveryIdTimes) {
      if (at < cutoff) {
        this.deliveryIds.delete(id)
        this.deliveryIdTimes.delete(id)
      }
    }
  }

  /**
   * 记一笔"因来源非真人而跳过观察"。
   *
   * ## 为什么要留痕
   *
   * 本 bug 家族已咬过两次（`signal` 漏传、`source` 被覆写），
   * 共同点是"看着有、实际永远不生效、UI 和日志都看不出"。
   * 有了这行，框架改 kind 或加新来源时会**自己浮出来**。
   *
   * ## 为什么不能只靠日志（对端会话指出的坑）
   *
   * 日志**会被清空、会滚动**。如果只写一次、写完就再不提，
   * 那条信号一旦被滚掉就**永久消失** —— 同一实例生命周期内不会补写。
   * 所以这里同时维护**可查询的计数**（`skippedSummary()`），
   * 由 awareness 状态面暴露出去：**可查询的东西不怕日志滚动**。
   *
   * 这也顺带补上一个协作感知缺口 —— 状态不该靠翻日志猜。
   */
  private noteSkippedKind(sessionId: string, kind: string, text: string): void {
    const key = `${sessionId}::${kind}`
    const prev = this.skippedCounts.get(key)
    const next = (prev?.count ?? 0) + 1
    this.skippedCounts.set(key, {
      count: next,
      lastSeenAt: Date.now(),
      // 留一份内容预览：计数只说"挡了多少"，**说不出"挡的是什么"**。
      // 万一将来框架给**真人**消息换了个 kind，光看 `tool-jobs×1` 这种
      // 正常计数根本发现不了 —— 那是一条本该进来的真人消息被静音了。
      // 有预览，误挡会当场现形。（对端会话的建议）
      lastDropped: text.replace(/\s+/g, ' ').trim().slice(0, 80),
    })
    // 首次留痕（后续靠可查询的计数，避免刷屏）
    if (next === 1) {
      this.auditLog(`观察跳过（source.kind=${kind} 非真人发言）: ${sessionId}`)
    }
  }

  /**
   * 被挡下的观察计数（可查询，不怕日志滚动）。
   *
   * 带 `lastSeenAt` 与全局 `total`：这样"**还在发生吗**"和"**上次什么时候**"
   * 都能直接从端点看出来，彻底不用回日志 —— 对端会话的建议，也正是
   * 「状态靠翻日志猜」这个缺口的正解。
   *
   * ⚠️ 度量口径：计数只在通知**落成 `user/message`** 那一刻加，
   * 而路径是 `tool-jobs 通知 → agent/inbox/spliced → user/message`，
   * 中间隔着一次 splice —— 所以从"任务完成"到"计数可见"有**十秒级滞后**。
   * 拿它做验收时窗口要留够（我们俩都曾因为查早了而看到空态）。
   */
  skippedSummary(): {
    entries: {
      sessionId: string
      kind: string
      count: number
      lastSeenAt: number
      lastDropped: string
    }[]
    total: number
  } {
    const entries: {
      sessionId: string
      kind: string
      count: number
      lastSeenAt: number
      lastDropped: string
    }[] = []
    let total = 0
    for (const [key, v] of this.skippedCounts) {
      const sep = key.indexOf('::')
      if (sep < 0) continue
      entries.push({
        sessionId: key.slice(0, sep),
        kind: key.slice(sep + 2),
        count: v.count,
        lastSeenAt: v.lastSeenAt,
        lastDropped: v.lastDropped,
      })
      total += v.count
    }
    entries.sort((a, b) => b.count - a.count)
    return { entries, total }
  }

  /** sessionId::kind → 被挡次数、最近时刻、最后一条内容预览。 */
  private skippedCounts = new Map<
    string,
    { count: number; lastSeenAt: number; lastDropped: string }
  >()

  /**
   * 订阅**全部**会话事件（含 tool/call、step/start 等）。
   *
   * 与 `observe()` 的区别：那个只放行 user/assistant **消息**（"发言"），
   * 这个放行一切（"工作状态"的原料：在调什么工具、动哪个文件、走到第几步）。
   * 两条流互不影响。
   */
  observeRaw(handler: (sessionId: string, event: unknown) => void): () => void {
    this.rawHandlers.add(handler)
    return () => {
      this.rawHandlers.delete(handler)
    }
  }

  /** 接入一个声明了 sessionController 的上下文（冷会话唤醒通道）。 */
  attachControllerContext(ctx: Context): void {
    this.controllerCtx = ctx
    this.auditLog('sessionController 已接入（冷会话可被唤醒）')
  }

  constructor(ctx: Context, auditLog?: (msg: string) => void) {
    this.ctx = ctx
    this.auditLog = auditLog ?? (() => {})
  }

  /** 能力探测：投递通道是否可用。 */
  capabilities(): { observe: boolean; deliver: boolean; via: string[]; notes: string[] } {
    const notes: string[] = []
    const agents = safeCtxGet<{ get?: unknown }>(this.ctx, 'agents')
    // sessionController 要从已声明它的 scope 里查（见 controllerCtx 的说明）
    const controller = safeCtxGet<{ prompt?: unknown }>(
      this.controllerCtx ?? this.ctx,
      'sessionController',
    )
    const on = safeCtxMethod<(e: string, h: (...a: unknown[]) => void) => unknown>(this.ctx, 'on')

    const via: string[] = []
    if (typeof controller?.prompt === 'function') via.push('sessionController.prompt(可唤醒冷会话)')
    if (typeof agents?.get === 'function') via.push('agents.get + followup(仅 live)')

    // 读不到服务时给出可操作的原因，而不是笼统的"不可用"
    if (!agents) {
      notes.push('读不到 ctx.agents —— 需在插件 inject 里声明 "agents"（cordis 代理只放行已声明的服务）')
    }
    if (!controller) {
      notes.push(
        'ctx.sessionController 读不到 —— 冷会话（对端未打开）无法唤醒，' +
          '只能投递给已打开的会话。若该服务确实存在，检查是否已用 ctx.inject 声明。',
      )
    }
    return {
      observe: typeof on === 'function',
      deliver: via.length > 0,
      via,
      notes,
    }
  }

  /**
   * 开始观察所有会话的用户/助手消息。
   * @param handler 每条消息回调一次
   * @returns 停止观察
   */
  observe(handler: (activity: SessionActivity) => void): () => void {
    this.listeners.add(handler)
    if (this.off) return () => { this.listeners.delete(handler) }

    const on = safeCtxMethod<(event: string, cb: (...args: unknown[]) => void) => unknown>(
      this.ctx,
      'on',
    )
    if (!on) {
      this.auditLog('观察不可用：ctx.on 不存在')
      return () => { this.listeners.delete(handler) }
    }

    try {
      on('session/event', (...args: unknown[]) => {
        // 宿主级监听签名是 (session, event)
        const session = args[0] as { id?: unknown } | undefined
        const event = args[1] as
          | { type?: unknown; seq?: unknown; data?: unknown }
          | undefined
        if (!session || typeof session.id !== 'string' || !event) return

        const sessionId = session.id
        const seq = typeof event.seq === 'number' ? event.seq : 0

        // 原始事件通道：工具调用、步骤推进这类"工作状态"原料都在这里。
        // 下面那段只放行 user/assistant 消息（那是"发言"），工具事件会被丢掉，
        // 所以单独给 WorkStateTracker 一条不过滤的流。
        for (const handler of this.rawHandlers) {
          try {
            handler(sessionId, event)
          } catch (e) {
            this.auditLog(`原始事件处理器抛错: ${String(e)}`)
          }
        }

        let role: 'user' | 'assistant' | null = null
        let text = ''
        let relayTriggered = false

        if (event.type === 'user/message') {
          // ⚠️ user/message 的 data **就是 UserMessage 本身**（不是 { message }）
          const msg = event.data as { content?: unknown; source?: unknown } | undefined
          const src = msg?.source as { kind?: unknown } | undefined

          // 我们自己投递进去的，不要再中继出去，否则 A→B→A 回环
          if (isFromPlugin(msg?.source, this.deliveryIds)) return

          /**
           * 只放行**真人发言**。
           *
           * ## 为什么必须挡
           *
           * 其余全是宿主生产方。实测某个会话里的分布：
           *   user 85 / model-selection 23 / tool-jobs 5 / goal 4 /
           *   runtime-context 3 / tool-goal 3 / compact-checkpoint 2 /
           *   agent-message 2 / subagent-settled 2
           * 也就是**近三分之一**的 user/message 根本不是对话内容。
           *
           * 而且它们**常带面向特定属主的祈使句**。实例（2026-09-30 真机）：
           * 后台任务完成通知里有一句 "Read its output with job_output" ——
           * 那是喊给**任务属主**的，转发出去等于让对端执行一条**没发给它的指令**。
           * 那次对端因为自己的 job_list 为空才没照做 —— **是运气，不是设计**。
           *
           * 副作用（也是好处）：不再因为无关通知把对端白白唤醒。
           *
           * ## 为什么用允许集而不是 `!== 'user'`
           *
           * 硬等号会把"**未知但可能是真人**"的来源一并静音。以后框架新增一种
           * 真人来源（改 kind、加字段），表现为"消息莫名其妙不过去"，
           * 而且**查不出原因**。允许集让扩展点显式，配合下面的日志能立刻发现。
           */
          const kind = typeof src?.kind === 'string' ? src.kind : '(无 kind)'
          if (!HUMAN_SOURCE_KINDS.has(kind)) {
            // ⚠️ **不能静默丢弃**。本 bug 家族已咬过两次（signal 漏传、
            // source 被覆写），全都是"看着有、实际永远不生效、UI 和日志都看不出"。
            this.noteSkippedKind(sessionId, kind, textOfBlocks(msg?.content))
            return
          }

          role = 'user'
          text = textOfBlocks(msg?.content)
        } else if (event.type === 'assistant/message') {
          // 其余消息类事件是 { message }
          const d = event.data as { message?: { content?: unknown } } | undefined
          const content = d?.message?.content
          // 中间步骤（只有思考块 / 工具调用块，没有正文）是**过程**不是**发言**。
          // 一轮对话里 assistant/message 会触发多次，中继过程毫无意义
          //（用户只会看到 `[reasoning][tool-call]`），所以这里直接跳过。
          const body = textContentOnly(content)
          if (body.trim().length === 0) return
          role = 'assistant'
          // 用纯正文（不含 [reasoning]/[tool-call] 占位）——
          // 判断和内容必须是同一个版本，否则日志里会留下 `[reasoning]正文` 这种残渣
          text = body
          // 这轮回复若是被中继消息触发的，就处在链上后续跳 —— 交给中继层做跳数判断
          relayTriggered = this.lastUserWasFromPlugin(sessionId)
        } else {
          return
        }

        if (text.trim().length === 0) return
        const activity: SessionActivity = {
          sessionId,
          role,
          text,
          seq,
          fromPlugin: false,
          relayTriggered,
        }
        for (const listener of [...this.listeners]) {
          try {
            listener(activity)
          } catch (e) {
            this.auditLog(`观察回调抛错: ${String(e)}`)
          }
        }
      })
      this.off = () => { this.listeners.clear() }
      this.auditLog('观察已启动（session/event）')
    } catch (e) {
      this.auditLog(`观察订阅失败: ${String(e)}`)
    }

    return () => { this.listeners.delete(handler) }
  }

  /**
   * 该会话**最近一条 user 消息**是不是本插件投递的。
   *
   * 用来判断"这一轮助手回复是不是中继链的后续跳" —— 助手消息自身的 source
   * 永远是 model，看不出它是不是被中继消息触发的，只能回溯它回应的是谁。
   *
   * 判据可靠的原因：投递的 user 消息会先被 append 进会话日志，agent 才会开始跑这一轮；
   * 所以 assistant/message 事件到达时，那条 user 消息一定已经在了。
   */
  private lastUserWasFromPlugin(sessionId: string): boolean {
    try {
      const sessions = safeCtxGet<{ get?(id: string): unknown }>(this.ctx, 'sessions')
      const session = sessions?.get?.(sessionId) as
        | { deriveMessages?(): unknown[]; snapshotEvents?(): unknown[]; events?: unknown[] }
        | undefined
      if (!session) return false

      // 优先 deriveMessages（已应用 surface 折叠与投影）
      if (typeof session.deriveMessages === 'function') {
        const messages = session.deriveMessages()
        if (Array.isArray(messages)) {
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i] as { role?: unknown; source?: unknown }
            if (m?.role !== 'user') continue
            return isFromPlugin(m.source, this.deliveryIds)
          }
          return false
        }
      }

      // 退路：直接读事件流（runtime 用 snapshotEvents，checkout 用 events）
      const events =
        typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
      if (!Array.isArray(events)) return false
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i] as { type?: unknown; data?: unknown }
        if (e?.type !== 'user/message') continue
        const msg = e.data as { source?: unknown } | undefined
        return isFromPlugin(msg?.source, this.deliveryIds)
      }
      return false
    } catch {
      // 读不到就当"不是中继触发"——宁可多转发一跳，也不要静默丢掉真实消息
      return false
    }
  }

  /**
   * 把一段文本投递给某个会话，使其 agent 能感知。
   *
   * 三条路径按可靠性依次尝试：
   *   1. `ctx.sessionController.prompt({...})` —— runtime 官方入口，活/冷会话统一
   *   2. `ctx.agents.get(id).followup(msg)` —— 两个版本都有，但只对**内存里活着**的会话有效
   *   3. `agent.inject(msg)` —— 只入上下文不唤醒（followup 不可用时的兜底）
   *
   * @param sessionId 目标会话
   * @param text 文本
   * @param wake 是否唤醒对方（false = 只让它下次被唤醒时看到）
   */
  /**
   * 把一段文本投递给某个会话，使其 agent 能感知。
   *
   * @param form **这条消息的性质** —— 接收端据此判断"要不要动手"。
   *
   * ## 为什么必须有这个字段（对端会话从接收侧提出的缺口）
   *
   * 早先自动镜像与显式派活**落库形态完全一样**（同 kind、同前缀），
   * 接收方**没有任何字段能判断**："这是它的进展汇报，还是它有意派给我的活？"
   *
   * 后果不是抽象的 —— 对端会话曾因此**开始做没人派给它的工作**：
   * 中继把我的大段汇报镜像过去，它当成"用户对我的指令"去响应了。
   * 它自己是这样描述的：
   *   > 我无法区分「自动镜像」与「对方显式投递」—— 两者落库形态完全一样。
   *
   *   mirror  —— 自动同步的进展/汇报。**信息，不是任务**，不必动手。
   *   handoff —— 明确派活/交接。**需要处理**。
   */
  /**
   * 投递紧急度 —— **由调用方按情况判断**（助手自己决定，不要求用户选）。
   *
   *   quiet   只告知：放进上下文不唤醒。适合进展同步、背景信息。
   *   normal  排队（默认）：对方处理完手头的事就看到。适合一般任务与请求。
   *   urgent  插话：插进对方正在跑的那一轮。适合阻塞问题、"先停手"。
   */
  async deliver(
    sessionId: string,
    text: string,
    urgency: DeliverUrgency = 'normal',
    form: 'mirror' | 'handoff' = 'handoff',
  ): Promise<DeliverResult> {
    const content = [{ type: 'text', text }]

    const agents = safeCtxGet<{ get?(id: string): unknown }>(this.ctx, 'agents')
    const liveAgent = agents?.get?.(sessionId) as
      | {
          followup?(message: unknown): void
          steer?(message: unknown): void
          inject?(message: unknown): void
          status?: unknown
        }
      | undefined

    /**
     * 投递模式由**紧急度**决定 —— 而不是"总是尽量打断"。
     *
     * ## 三档（对应三种底层机制）
     *
     *   quiet  → inject    只放进上下文，**不唤醒**。对端下次跑时自然看到。
     *                      适合：进展同步、背景信息 —— 不需要它现在做什么。
     *   normal → followup  **排队**。进收件箱，它处理完手头的事就看到。
     *                      适合：一般任务与请求（默认）。
     *   urgent → steer     **插话**。插进它**正在跑的那一轮**，当场读到。
     *                      适合：阻塞性问题、"先停手"这类事。
     *
     * ## 磁盘级判别口径（对端会话从接收侧定出来的，2026-10-01）
     *
     * 排查时**不要只看本文件写的审计日志** —— 那是"我们的代码打算做什么"，
     * 用自己的自我报告验证自己的逻辑是循环论证。要看**框架自己落的事件**：
     *
     *   接收端会话日志里 `agent/inbox/spliced` 的 `target` 字段：
     *     target = "next-step"  →  插话（插进正在跑的那一轮）
     *     target = "next-turn"  →  排队（下一轮才看到）
     *
     *   交叉印证：`next-step` 那条不会起新回合；`next-turn` 那条后面会跟一个
     *   新的 `turn/start`。
     *
     * 对端实测对照（同一条连接、相隔 17 秒）：
     *   seq=1894 target="next-turn" → 随后 turn/start(turn 22)   ← urgent 但对方空闲，降级
     *   seq=1878 target="next-step" → 当时正在跑 turn 21          ← urgent 且对方在跑
     *
     * ## 为什么默认不是 steer（旧行为）
     *
     * 旧实现是 `peerRunning ? steer : queue` —— 只要对端在跑就打断它。
     * 那等于**每条消息都是最高优先级**，而大部分消息并不急。
     * 打断的代价是对端要中断当前思路，这个成本只该在真急的时候付。
     *
     * ## steer 的硬前提与降级
     *
     * `dsh-api-session-controller/lib/index.js:966`：`agent.status !== 'running'`
     * 时抛 session/steer-unavailable。所以 urgent 但对端空闲 → **降级为排队**
     * （它下一轮立刻开始，效果本来就等同于即时），不报错。
     */
    const peerRunning = liveAgent?.status === 'running'
    const mode: 'inject' | 'queue' | 'steer' =
      urgency === 'quiet'
        ? 'inject'
        : urgency === 'urgent'
          ? peerRunning
            ? 'steer'
            : 'queue'
          : 'queue'

    // 投递 id：**登记下来供防回环识别**（见 isFromPlugin 的说明）。
    // 这个 id 会被 sessionController 原样放进它自己造的 source.rpcId，
    // 所以即便它覆写了 source.kind，我们仍能认出这条是自己发的。
    const deliveryId = `ccr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    this.rememberDeliveryId(deliveryId)

    // MessageId 是 brand（运行时就是字符串）；source 用 producer-owned kind 标注来源，
    // 既让对端知道"这来自连接中继"，也让本插件能识别并防回环。
    // ⚠️ 绝不能写 V3 的 `{ kind: 'plugin', plugin }`：V4 准入会直接拒绝整个会话。
    const message = {
      id: deliveryId,
      role: 'user',
      content,
      source: {
        kind: PLUGIN_SOURCE_KIND,
        form,
        summary: form === 'mirror' ? '对方进展（自动同步）' : '对方派活（需要处理）',
      },
    }

    // ── 首选：对端**活着**时走 agents 路径 ──
    //
    // ⚠️ 顺序很关键。`sessionController.prompt` 会**自己造 source**
    // （`{ kind: 'user', rpcId }`，见 dsh-api-session-controller/lib/index.js:856-860），
    // **完全忽略我们传的 source** —— 于是投递进去的消息看起来就是"真实用户输入"，
    // 本插件的防回环识别与链路判定双双失效，消息会被中继原样转发回去形成回环。
    //
    // 所以：**活着走 agents（source 由我们标注）；只有冷会话才用 sessionController**
    // （它自带 resume，是我们唯一的冷唤醒通道），两条路径都由上面的 deliveryId 兜底。
    if (liveAgent) {
      // ── quiet：只放进上下文，**不唤醒** ──
      if (mode === 'inject' && typeof liveAgent.inject === 'function') {
        try {
          this.delivering.add(sessionId)
          liveAgent.inject(message)
          this.auditLog(`投递成功（inject 不唤醒，对方下次跑时看到）→ ${sessionId}`)
          return { ok: true, via: 'agents.inject', mode: 'inject', live: true }
        } catch (e) {
          this.auditLog(`inject 失败，回退 followup: ${String(e)}`)
        } finally {
          setTimeout(() => this.delivering.delete(sessionId), 0)
        }
      }

      if (mode === 'steer' && typeof liveAgent.steer === 'function') {
        try {
          this.delivering.add(sessionId)
          liveAgent.steer(message)
          this.auditLog(`投递成功（steer 即时插话）→ ${sessionId}`)
          return { ok: true, via: 'agents.steer', mode: 'steer', live: true }
        } catch (e) {
          this.auditLog(`steer 失败，回退 followup: ${String(e)}`)
        } finally {
          setTimeout(() => this.delivering.delete(sessionId), 0)
        }
      }

      if (typeof liveAgent.followup === 'function') {
        try {
          this.delivering.add(sessionId)
          liveAgent.followup(message)
          this.auditLog(`投递成功（followup，source 已标注）→ ${sessionId}`)
          return { ok: true, via: 'agents.followup', mode: 'queue', live: true }
        } catch (e) {
          this.auditLog(`followup 失败: ${String(e)}`)
        } finally {
          setTimeout(() => this.delivering.delete(sessionId), 0)
        }
      }
    }

    // ── 兜底：冷会话唤醒（sessionController 自带 resume） ──
    const controllerSource = this.controllerCtx ?? this.ctx
    const controller = safeCtxGet<{
      prompt?(request: unknown, signal?: AbortSignal): unknown
    }>(controllerSource, 'sessionController')
    if (typeof controller?.prompt === 'function') {
      try {
        // ⚠️ 必须传 signal：prompt(request, signal) 内部会调 signal.throwIfAborted()，
        // 省略第二个参数会直接抛 TypeError 并静默回退到 agents 路径（冷会话就唤不醒）。
        const abort = new AbortController()
        await controller.prompt(
          {
            sessionId,
            content,
            mode,
            // 这个值会被 prompt 原样放进它造的 source.rpcId —— 防回环就靠它
            requestId: deliveryId,
          },
          abort.signal,
        )
        this.auditLog(`投递成功（冷会话唤醒，prompt 会覆写 source 但有 id 兜底）→ ${sessionId}`)
        return { ok: true, via: 'sessionController', mode, live: false }
      } catch (e) {
        this.auditLog(`sessionController.prompt 失败: ${String(e)}`)
      }
    }

    if (!agents?.get) {
      // 区分「服务读不到」和「会话不在内存」——这两种原因的修法完全不同
      return {
        ok: false,
        reason:
          '读不到 ctx.agents（cordis 代理只放行 inject 里声明过的服务）。' +
          '请在插件 inject 中加入 "agents"。',
      }
    }

    // 走到这里说明：对端是冷会话（没有 live agent），且 sessionController 也不可用。
    // agents 路径已在上面优先尝试过（活着的情况），这里只剩失败。
    return {
      ok: false,
      reason:
        `会话 ${sessionId} 当前没有 live agent（未打开或已释放），` +
        '且 sessionController 不可用，无法唤醒。',
    }
  }

  /** 读取某会话最近的消息历史（诊断/工具用）。 */
  readRecent(sessionId: string, limit = 20): { role: string; text: string }[] {
    const sessions = safeCtxGet<{ get?(id: string): unknown }>(this.ctx, 'sessions')
    const session = sessions?.get?.(sessionId) as
      | {
          deriveMessages?(): unknown[]
          snapshotEvents?(): unknown[]
          events?: unknown[]
        }
      | undefined
    if (!session) return []

    try {
      // deriveMessages 已应用 surface 折叠与投影，是官方推荐的消息读取口
      if (typeof session.deriveMessages === 'function') {
        const messages = session.deriveMessages()
        if (Array.isArray(messages)) {
          return messages.slice(-limit).map((m) => {
            const msg = m as { role?: unknown; content?: unknown }
            return {
              role: typeof msg.role === 'string' ? msg.role : 'unknown',
              text: textOfBlocks(msg.content),
            }
          })
        }
      }
      // 退路：runtime 用 snapshotEvents，checkout 用 events
      const events =
        typeof session.snapshotEvents === 'function'
          ? session.snapshotEvents()
          : session.events
      if (!Array.isArray(events)) return []
      return events
        .filter((e) => {
          const type = (e as { type?: unknown }).type
          return type === 'user/message' || type === 'assistant/message'
        })
        .slice(-limit)
        .map((e) => {
          const ev = e as { type?: unknown; data?: unknown }
          if (ev.type === 'user/message') {
            const msg = ev.data as { content?: unknown }
            return { role: 'user', text: textOfBlocks(msg?.content) }
          }
          const d = ev.data as { message?: { content?: unknown } }
          return { role: 'assistant', text: textOfBlocks(d?.message?.content) }
        })
    } catch (e) {
      this.auditLog(`读取会话历史失败: ${String(e)}`)
      return []
    }
  }

  dispose(): void {
    this.off?.()
    this.off = undefined
    this.listeners.clear()
  }
}
