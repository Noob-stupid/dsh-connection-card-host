/**
 * dsh-connection-card-host — 宿主端入口。
 *
 * 挂载连接管理器、事件总线、适配层、卡片宿主；
 * 并通过 DSH 官方 Connection RPC 通道（ctx.connection.rpc）把服务暴露给浏览器半。
 */
import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { ConnectionManager } from './core/connection-manager.js'
import { ConnectionEventBus } from './core/event-bus.js'
import { Persistence } from './core/persistence.js'
import { DSHAdapter } from './adapter/dsh-adapter.js'
import { createStableApi, type ConnectionCardHostService } from './adapter/stable-api.js'
import { ConventionBox } from './core/box.js'
import { WorkStateTracker } from './core/work-state.js'
import { registerAwarenessTools } from './tools/awareness-tools.js'
import { registerConnectionSkill } from './tools/connection-skill.js'
import { installToolScoping } from './core/tool-scoping.js'
import { registerRpcBridge } from './adapter/rpc-bridge.js'
import { CardHost } from './card-host/loader.js'
import { SessionBridge } from './adapter/session-bridge.js'
import { ConnectionRelay } from './core/relay.js'
import { safeCtxGet } from './safe-ctx.js'
import { CardAdapterHost } from './adapter/card-adapter.js'
import { installBridgedFilter } from './adapter/assemble.js'
import { loadAdapterFlag } from './adapter/flag-file.js'

export const name = 'connection-card-host'

/**
 * 诊断日志：写到插件目录旁的 host-debug.log（绝对路径，不受 DSH_HOME 影响）。
 * 桥接问题排查用；路径固定在仓库内，便于开发期读取。
 */
const DEBUG_LOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'host-debug.log')
function debug(msg: string): void {
  try {
    appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    // 诊断失败不影响业务
  }
}

/**
 * 必需依赖。
 *
 * ⚠️ cordis 的 Context 是 Proxy：**未在此声明的服务读不到**（读会抛，
 * safeCtxGet 会把它变成 undefined）。所以要用 ctx.agents / ctx.sessions /
 * ctx.tools 就必须在这里声明，否则能力探测会误报"不可用"。
 *
 * `agents` 与 `sessions` 两个版本都有；`sessionController` 仅 runtime 0.2+ 有，
 * 因此**不放进这个数组**（否则 checkout 上插件直接不加载），
 * 改用 ctx.inject(['sessionController'], ...) 作可选增强。
 */
export const inject = ['agents', 'sessions', 'tools']

/**
 * 对外提供的服务名。必须在此声明，否则 `ctx.provide()` 会抛
 * `cannot set property "x" without provide`。
 */
export const provide = ['connectionCardHost']

type HostContext = Context & {
  connectionCardHost?: ConnectionCardHostService
}

export function apply(ctx: HostContext, _config?: Record<string, unknown>): void {
  /*
   * 本次装配的短标识。
   *
   * 为什么需要：同一个插件被装配两次时（比如 profile 里新旧两个名字都声明了、
   * 或者 bundle 装配 + 注入装配并存），日志里会出现**两条一模一样的错误** ——
   * `tool "connection_send" is already registered` 连出现三次，
   * 根本分不清哪条来自哪个实例、哪次 apply。加个短标识就能对上号。
   */
  const applyTag = Math.random().toString(36).slice(2, 8)
  debug(`apply: entered [${applyTag}]`)
  try {
    // 初始化核心模块（先建 EventBus，因为 DSHAdapter 需要白名单检查函数）
    const persistence = new Persistence()
    debug(`apply: persistence ready baseDir=${persistence.baseDir()}`)
    const eventBus = new ConnectionEventBus()
    const manager = new ConnectionManager(persistence, eventBus)
    debug(`apply: manager ready (${manager.getAll().length} restored)`)

    // 审计日志：写入 $DSH_HOME/connection-cards/audit.log
    const auditFile = join(persistence.baseDir(), 'audit.log')
    const auditLog = (msg: string): void => {
      try {
        appendFileSync(auditFile, `[${new Date().toISOString()}] ${msg}\n`)
      } catch (e) {
        debug(`auditLog 写入失败: ${String(e)}`)
      }
    }

    // 浏览器半的诊断上报：单独文件，避免与宿主审计混在一起。
    // 浏览器里读不到 console，拖拽这类交互问题只能靠它落盘。
    const clientLogFile = join(persistence.baseDir(), 'client-debug.log')
    const clientLog = (msg: string): void => {
      try {
        appendFileSync(clientLogFile, `[${new Date().toISOString()}] ${msg}\n`)
      } catch {
        /* 诊断失败不影响业务 */
      }
    }

    // 适配层（注入白名单检查函数 + 审计日志）
    const adapter = new DSHAdapter(ctx, {
      whitelistCheck: (connId, method) => manager.whitelist.isAllowed(connId, method),
      auditLog,
    })
    const versionCheck = adapter.init()
    debug(`apply: adapter ready supported=${versionCheck.supported}`)

    if (!versionCheck.supported) {
      ctx.logger?.warn?.(
        `[${name}] DSH version ${versionCheck.current} outside supported range ${versionCheck.range}. Running in degraded mode.`,
      )
    }

    // 卡片宿主（连接卡片运行时）
    // 内置卡片随插件发布在包根的 cards/；用户安装的放在 $DSH_HOME/connection-cards/cards/
    /**
     * 适配宿主（**默认关闭**，见 adapter/flags.ts）。
     *
     * 构造它本身是无副作用的：只有清单里带 `dshCard.adapter` 的卡片才会走到它，
     * 而且总开关关着时会**明确拒绝**并说清原因。
     *
     * ⚠️ `registerTool` 是**惰性解析** ctx.tools 的：卡片宿主的构造早于工具服务取用，
     * 把服务解析推迟到真正要桥接的那一刻，就不必为了顺序去搬动既有初始化流程。
     */
    const cardsRoot = join(persistence.baseDir(), 'cards')
    /**
     * 读适配层开关（**默认关闭**）。
     *
     * 文件：`$DSH_HOME/connection-cards/adapter.enabled` —— 存在即开启，`del` 即关闭。
     * 只有宿主的这一段会碰磁盘；内存开关（flags.ts）保持纯净，客户端包不带 fs。
     */
    const flag = loadAdapterFlag(persistence.baseDir())
    auditLog(`[adapter] 开关：${flag.reason}`)
    debug(`apply: adapter flag → ${flag.enabled}（${flag.reason}）`)

    const adapterHost = new CardAdapterHost({
      registerTool: (definition) => {
        const tools = safeCtxGet<{ register(definition: unknown): () => void }>(ctx, 'tools')
        if (!tools?.register) {
          throw new Error(
            '适配层要给会话提供插件的工具，但当前宿主没有 ctx.tools 服务 —— 无法桥接。',
          )
        }
        return tools.register(definition)
      },
      getConnection: (id) => {
        const c = manager.getById(id)
        return c ? { sessionA: c.sessionA, sessionB: c.sessionB } : undefined
      },
      // 垫片根 = 卡片根：插件的向上查找只有命中这一层才能解析到 @deepseek-ai/*
      shimRoot: cardsRoot,
      facadeBaseDir: join(dirname(fileURLToPath(import.meta.url)), 'adapter'),
      audit: auditLog,
      debug,
      /**
       * `prompt` 能力：卡片贡献的提示词段走官方 `ctx.systemPrompt.section`。
       *
       * 注册是**全局的**，但段文本是**函数**：装配时按"这个会话在不在该卡片的
       * 可见范围内"决定返回文字还是空串（空段会被丢掉）—— 见 prompt-inject.ts。
       * 拿不到该服务时不提供此能力：声明了 `prompt` 的插件会在装载阶段被明确拒绝，
       * 而不是"装上了却不生效"。
       */
      ...(() => {
        const sp = safeCtxGet<{
          section(section: {
            name: string
            order: number
            text: (context: unknown) => string
            interpolate: boolean
          }): () => void
        }>(ctx, 'systemPrompt')
        if (!sp?.section) {
          debug('apply: 没有 ctx.systemPrompt —— prompt 能力不可用（声明它的插件会被拒）')
          return {}
        }
        return { registerPromptSection: (section: Parameters<typeof sp.section>[0]) => sp.section(section) }
      })(),
      /**
       * `llm` 能力：卡片**自己**调模型（用户裁决只做这个含义；
       * 改会话模型/路由那类**不做**）。门面与预算见 llm-facade.ts。
       */
      ...(() => {
        const llm = safeCtxGet<{
          stream(options: Record<string, unknown>): AsyncIterable<never>
          listProviders(): string[]
        }>(ctx, 'llm')
        if (!llm?.stream) {
          debug('apply: 没有 ctx.llm —— llm 能力不可用（声明它的插件会被拒）')
          return {}
        }
        return { llm: { stream: llm.stream.bind(llm), listProviders: llm.listProviders.bind(llm) } }
      })(),
    })

    /**
     * **晚绑定**的会话桥引用（卡片投递通道要它，但它在本行之后才创建）。
     *
     * 拿不到 ⇒ 返回 undefined ⇒ `api.sendMessage` **明确拒绝**（fail-closed），
     * 而不是悄悄不发 —— 卡片侧会看到"宿主投递通道不可用"这句明确原因。
     */
    let bridgeRef: SessionBridge | undefined

    const cardHost = new CardHost(manager, eventBus, adapter, {
      installedRoot: cardsRoot,
      adapterHost,
      deliverVia: () =>
        bridgeRef
          ? (sessionId, text, urgency) => bridgeRef!.deliver(sessionId, text, urgency)
          : undefined,
    })
    debug(`apply: cardHost ready（${adapterHost.describe()}）`)

    /**
     * **启动清理**：删掉没被指针指向的旧版本目录。
     *
     * 补的是一张**空头支票** —— 注释与用户文案一直写"旧目录留给'清理旧版本'在宿主重启后删"，
     * 但那个清理从来没实现过（全仓 grep 确认）。没有这一步，卸载后删不掉的目录会永久堆积，
     * 而我们对用户说"不需要你动手，重启后会清"。
     *
     * 放在重放**之前**：先清掉不用的，再挂要用的 —— 顺序反了会先挂上再删（无意义且更慢）。
     */
    const pruned = cardHost.pruneStaleVersions()
    /**
     * **三档**（对端点明）：别把"没跑起来"说成"没有可清理的" ——
     * 那会让排查的人以为清理跑过了、只是没东西可清。
     */
    if (!pruned.ok) debug(`apply: 启动清理**没跑起来**（读不到卡片目录）`)
    else if (pruned.removed > 0) debug(`apply: 启动清理删掉 ${pruned.removed} 个旧版本目录`)
    else if (pruned.scanned > pruned.removed) {
      debug(`apply: 启动清理有 ${pruned.scanned - pruned.removed} 个仍被占用（下次启动再试）`)
    }

    // 启动重放：连接是从 connections.json 恢复的，卡片挂在连接上，
    // 但 apply()（事件订阅 / 工具注册）不会自动重跑 —— 不重放卡片就是"哑"的。
    void cardHost
      .restoreAll()
      .then((n) => {
        if (n > 0) debug(`apply: 重放卡片 ${n} 张`)
      })
      .catch((e) => debug(`apply: 重放卡片失败 ${String(e)}`))

    // 会话桥 + 中继：「A 说话 B 能感知」。
    //   observe: ctx.on('session/event') —— 宿主级监听收到【所有会话】的事件
    //   deliver: ctx.agents.get(id) → agent.followup(msg) —— 投递并唤醒对端
    // 必须在 createStableApi 之前建好（稳定 API 要把桥暴露给 RPC）。
    // 协作感知的两层底座：
    //   WorkStateTracker —— 采集「在干什么」（自动，易变）
    //   ConventionBox    —— 共享「说好了什么」（显式，持久）
    // 二者都**只存不发**，由使用方按需拉取（工具查询 / 面板），不占对方上下文。
    //
    // ⚠️ 顺序有讲究：`workState` 必须**先建** —— 下面 SessionBridge 要拿它当
    // **抢占式中断的安全探针**（"这个会话此刻有没有工具在执行"）。
    // 放在后面就会出现"桥要用还没建好的跟踪器"，只能靠闭包绕过 TDZ，不干净。
    const workState = new WorkStateTracker(auditLog)
    const box = new ConventionBox()

    const bridge = new SessionBridge(
      ctx,
      auditLog,
      // 探针：true = 有工具在跑（或状态未知）→ 抢占不打断。
      // 构造函数里说明了"不传就永不抢占"的保守默认。
      (sid) => workState.busyWithTool(sid),
    )
    /** 桥就绪 ⇒ 卡片投递通道随之可用（上面那个取值函数从这里开始返回真东西）。 */
    bridgeRef = bridge
    const relay = new ConnectionRelay(manager, bridge, auditLog)

    manager.attachBox(box)

    // 工具事件、步骤推进都在原始流里 —— observe() 只放行发言，会把它们丢掉
    ctx.effect(
      () => bridge.observeRaw((sessionId, event) => workState.ingest(sessionId, event)),
      'connection-card-host: work-state collector',
    )
    const caps = bridge.capabilities()
    debug(`relay: observe=${caps.observe} deliver=${caps.deliver} via=[${caps.via.join(', ')}]`)
    auditLog(`relay 能力: observe=${caps.observe} deliver=${caps.deliver} via=[${caps.via.join(', ')}]`)
    for (const note of caps.notes) {
      debug(`relay 提示: ${note}`)
      auditLog(`relay 提示: ${note}`)
    }
    relay.start()
    ctx.effect(
      () => () => {
        relay.stop()
        bridge.dispose()
      },
      'connection-card-host: session relay',
    )

    // 冷会话唤醒通道：`sessionController` 只在 runtime 0.2+ 有，
    // 放进静态 inject 会让插件在旧版本上直接不加载，所以用可选的 ctx.inject。
    //
    // 拿到它之后，投递给「未打开的对端会话」会自动 resume 该会话 ——
    // 即「A 说话 → B 被唤醒上线 → B 处理」，而不是投递失败。
    // （cordis 是 Proxy：没声明过的服务读不到，所以这一步是必需的，不是优化。）
    ctx.inject(['sessionController'], (scope) => {
      bridge.attachControllerContext(scope)
      const caps2 = bridge.capabilities()
      debug(`relay 能力（接入后）: via=[${caps2.via.join(', ')}]`)
      auditLog(`relay 能力（接入后）: via=[${caps2.via.join(', ')}]`)
      for (const note of caps2.notes) auditLog(`relay 提示: ${note}`)
    })

    // 稳定 API
    const service = createStableApi(
      manager,
      eventBus,
      cardHost,
      adapter,
      bridge,
      { workState, box },
      auditLog,
      relay,
    )

    // 协作感知工具（拉取式：模型按需查，不占常驻上下文）
    //
    // ⚠️ 这一段**必须容错**（2026-10-02 修）。
    //
    // 原来它是裸调用，而 `apply` 只有一个兜底 try/catch 在**最末尾** ——
    // 于是"工具重复注册"这种局部失败会**跳过它后面的全部初始化**，
    // 其中就包括 RPC 桥（面板的唯一通道）与卡片宿主。
    // 现场证据：`apply: THREW tool "connection_send" is already registered`
    // 抛在 lib/index.js:163，随后该实例处于**半装配**状态 ——
    // 用户看到"连接消息渲染成纯文本"正是卡片宿主没装上的表现。
    //
    // 一个工具注册失败，不该让整个插件废掉。
    try {
      const toolsService = safeCtxGet<{ register(definition: unknown): () => void }>(ctx, 'tools')
      if (toolsService?.register) {
        const disposeTools = registerAwarenessTools(toolsService, { service, auditLog })
        ctx.effect(
          () => () => disposeTools(),
          'connection-card-host: awareness tools',
        )
        debug('apply: 感知工具已注册（connection_peer_work / connection_conventions / connection_declare）')
      } else {
        debug('apply: ctx.tools 不可用，跳过感知工具注册')
      }
    } catch (e) {
      const m = `感知工具注册失败（继续，不影响卡片与面板）：${e instanceof Error ? e.message : String(e)}`
      debug(`apply: ${m}`)
      // 用 audit 而不是只 debug：这类失败会让模型少几个工具，属于要留痕的事
      auditLog(m)
    }

    /*
     * 包内 skill —— 让装了本插件的 DSH 里的 agent 自动知道这套连接工具怎么用。
     *
     * 走官方 provider 通道（`ctx.skills.registerProvider`），
     * 不是往 `~/.dsh/skills/` 拷文件：文件系统通道只扫固定根目录，
     * **不看 npm 包内部**，所以把 SKILL.md 放进包里不会被发现。
     * 形态照 `@deepseek-ai/dsh-skill-badge`（官方随包 skill 的写法）。
     *
     * ⚠️ 与上面感知工具同理，这一段**必须容错**：skill 是增强，不是命脉；
     * 拿不到 ctx.skills（旧 checkout）时只留痕，不能让 apply 半路断掉。
     * dispose 必须挂到 ctx.effect 上，否则插件卸载后 provider 还挂在注册表里。
     */
    try {
      const disposeSkill = registerConnectionSkill(ctx, auditLog)
      if (disposeSkill) {
        ctx.effect(() => () => disposeSkill(), 'connection-card-host: packaged skill provider')
        debug('apply: skill provider 已注册（connection-card）')
      } else {
        debug('apply: ctx.skills 不可用，跳过 skill provider 注册')
      }
    } catch (e) {
      const m = `skill provider 注册失败（继续，不影响工具与卡片）：${e instanceof Error ? e.message : String(e)}`
      debug(`apply: ${m}`)
      auditLog(m)
    }

    /*
     * 按会话 scope 隐藏感知工具 —— 没参与连接的会话不该背约 1700 tokens 的 schema。
     *
     * 走官方 `system-prompt/assemble` waterfall（它本身是 scope-filtered）。
     * 契约照抄 dsh-tool-search 的实际用法（`ctx.on(event, (assembly, context, next) => ...)`），
     * 不是猜的。整条链路 fail-open：拿不准就原样下发。
     */
    const on = safeCtxGet<(event: string, handler: (...a: unknown[]) => unknown) => () => void>(ctx, 'on')
    if (typeof on === 'function') {
      try {
        const disposeScoping = installToolScoping(on.bind(ctx) as never, {
          getConnectionsBySession: (sid) => service.getConnectionsBySession(sid),
          audit: auditLog,
          debug,
        })
        ctx.effect(() => () => disposeScoping(), 'connection-card-host: tool scoping')
        debug('apply: 已挂 system-prompt/assemble（按会话 scope 隐藏感知工具）')
      } catch (e) {
        debug(`apply: 挂 tool scoping 失败（忽略，工具照常全局下发）：${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      debug('apply: ctx.on 不可用，跳过 tool scoping')
    }

    /*
     * 桥接工具的下发过滤 —— 与上面的 tool scoping **并列**，互不改动。
     *
     * 分开装（而不是塞进 tool-scoping 内部）是为了回退：适配层出问题时删掉这一段即可，
     * 不用碰已经稳定运行的感知工具过滤。两个钩子各管各的工具前缀，顺序无关紧要。
     */
    if (typeof on === 'function') {
      try {
        const disposeBridged = installBridgedFilter(on.bind(ctx) as never, {
          bridge: adapterHost.bridge,
          audit: auditLog,
          debug,
        })
        ctx.effect(() => () => disposeBridged(), 'connection-card-host: bridged tool filter')
        debug('apply: 已挂桥接工具过滤（按会话 scope 隐藏不可见的适配卡工具）')
      } catch (e) {
        debug(`apply: 挂桥接过滤失败（忽略，调用时仍会校验）：${e instanceof Error ? e.message : String(e)}`)
      }
      // 插件卸载时把所有适配卡收口（摘工具 + 释放插件资源），不留幽灵
      ctx.effect(() => () => adapterHost.disposeAll(), 'connection-card-host: adapter dispose')
    }
    // 必须走 ctx.provide（不是直接赋值）：cordis 服务由 fiber 持有生命周期，
    // 直接 `ctx.connectionCardHost = ...` 会抛 cannot set ... without provide。
    // 热重载时旧 fiber 可能尚未释放同名服务，此时视为已就绪即可（幂等）。
    const provideFn = safeCtxGet<(name: string, value: unknown) => () => void>(ctx, 'provide')
    if (typeof provideFn === 'function') {
      try {
        provideFn('connectionCardHost', service)
        debug('apply: service provided via ctx.provide')
      } catch (e) {
        debug(`apply: ctx.provide 跳过（${e instanceof Error ? e.message : String(e)}）`)
      }
    } else {
      debug('apply: ctx.provide 不可用，跳过服务暴露')
    }

    /*
     * 浏览器半的唯一通道：Connection RPC。
     * connection 是核心插件、通常在 apply 时就绪 —— 直接注册；
     * 若尚未就绪则用 ctx.inject 等它出现（cordis 会在服务消失时回滚 effect）。
     * ⚠️ 必须用 safeCtxGet：直接读未声明的服务属性会让 cordis 代理抛异常。
     *
     * ⚠️ 这一段也**必须容错**（2026-10-02）：它是面板的命脉，不该被任何
     * 前序段落的失败连累。反过来说，它自己失败也不该让 apply 中断 ——
     * 后面还有收尾日志。
     */
    try {
      const connection = safeCtxGet(ctx, 'connection')
      const hasConnection = Boolean(connection)
      debug(`apply: ctx.connection=${hasConnection ? 'ready' : 'absent'}`)
      auditLog(`apply: ctx.connection ${hasConnection ? 'ready' : 'absent'}`)

      const bridgeLogger = {
        info: (m: string) => {
          debug(m)
          ctx.logger?.info?.(m)
        },
        warn: (m: string) => {
          debug(m)
          ctx.logger?.warn?.(m)
        },
      }

      if (hasConnection) {
        const dispose = registerRpcBridge(ctx, service, {
          logger: bridgeLogger,
          audit: auditLog,
          clientLog,
        })
        if (dispose) ctx.effect(() => dispose, 'connection-card-host: rpc channel')
        debug(`apply: direct bridge done (dispose=${dispose ? 'yes' : 'no'})`)
      } else {
        // rpc.handle 内部会 `owner.webServer.register(route)`，
        // 因此 webServer 必须一起注入，否则抛 cannot get property "webServer" without inject。
        debug('apply: 走 ctx.inject 等待 connection + webServer')
        ctx.inject(['connection', 'webServer'], (scope) => {
          debug('inject: connection/webServer 就绪，注册桥')
          const dispose = registerRpcBridge(scope, service, {
            logger: bridgeLogger,
            audit: auditLog,
            clientLog,
          })
          if (dispose) scope.effect(() => dispose, 'connection-card-host: rpc channel')
          debug(`inject: bridge done (dispose=${dispose ? 'yes' : 'no'})`)
        })
      }
    } catch (e) {
      const m = `RPC 桥注册失败（面板将不可用，其余功能仍在）：${e instanceof Error ? e.message : String(e)}`
      debug(`apply: ${m}`)
      auditLog(m)
    }

    ctx.logger?.info?.(
      `[${name}] initialized (${manager.getAll().length} connections restored)`,
    )
  } catch (e) {
    // 带上 applyTag：日志里同形态的错有多条时，能分清来自哪个实例/哪次装配
    debug(`apply: THREW [${applyTag}] ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`)
    console.error(`[${name}] apply failed [${applyTag}]:`, e)
    ctx.logger?.error?.(`[${name}] apply failed [${applyTag}]: ${String(e)}`)
  }
}
