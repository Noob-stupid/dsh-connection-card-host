/**
 * 卡片适配宿主 —— 把"挂载一个普通 DSH 插件"这件事接到**卡片生命周期**上。
 *
 * 它是适配层与既有卡片系统之间的**唯一接缝**：
 *
 *     面板点「添加卡片」 → CardHost.loadCard()
 *        └─ 这张卡片的清单里有 `dshCard.adapter` 吗？
 *             有 → 交给本文件（挂载插件 + 桥接工具）
 *             没有 → 走原来的卡片路径（完全不变）
 *
 * 接缝只有这一处，是**刻意的**：适配层出问题时，能一眼看出影响面在哪；
 * 回退时也只需要拿掉这一个接缝（见 REVERT.md）。
 *
 * ## 三层闸门（缺一不可）
 *
 * 1. **总开关**（`flags.ts`，默认 OFF）—— 没开就完全不参与
 * 2. **卡片申报** —— 清单里必须有 `adapter` 段；没有的卡片行为与今天完全一致
 * 3. **能力清单** —— 逐个校验，未申报的访问当场抛错（影子 ctx）
 *
 * ## 为什么不用 CardAPI
 *
 * 普通卡片拿到的是 `CardAPI`（`api.send/on/registerTool` 那套，宿主自研协议）；
 * 而适配卡拿到的是**影子 ctx**（模拟 DSH 的插件上下文）。
 * 两者刻意不混：硬把 DSH 插件塞进 CardAPI 只会让两边语义都变形。
 */

import { isAdapterEnabled } from './flags.js'
import { mountPlugin, type MountedPlugin, type MountRequest } from './mount.js'
import { ToolBridge, type BridgeDeps } from './tool-bridge.js'
import { PromptInjector } from './prompt-inject.js'
import { CardLlm } from './llm-facade.js'
import type { CardScope } from '../types/index.js'

export interface CardAdapterHostOptions extends BridgeDeps {
  /** 垫片根：其下会建 `node_modules`（= 卡片根，插件的向上查找才会命中）。 */
  shimRoot: string
  /** 门面模块所在目录（`lib/adapter`）。 */
  facadeBaseDir: string
  /**
   * 注册一段系统提示词（`ctx.systemPrompt.section` 的绑定版）。
   *
   * 没提供时 `prompt` 能力**不可用**：插件声明了它会在装载阶段被拒绝 ——
   * 这比"装上了但不生效"诚实。
   */
  registerPromptSection?: (section: {
    name: string
    order: number
    text: (context: unknown) => string
    interpolate: boolean
  }) => () => void
  /**
   * 模型调用（`ctx.llm` 的绑定版）。没提供时 `llm` 能力不可用。
   */
  llm?: {
    stream: (options: Record<string, unknown>) => AsyncIterable<never>
    listProviders: () => string[]
  }
  /** 每张卡片实例的模型调用预算（默认见 llm-facade）。 */
  llmBudget?: number
  /** 调试日志（默认静默）。 */
  debug?: (message: string) => void
}

/** 一次挂载的请求（由 CardHost 在装载适配卡时给出）。 */
export interface AdapterMountRequest {
  instanceId: string
  cardId: string
  /** 插件目录（卡片目录）。 */
  pluginDir: string
  /** 能力申报（`dshCard.adapter.capabilities`）。 */
  capabilities: unknown
  connectionId: string
  scope?: CardScope
  /** 第三方依赖从哪儿解析（卡片被拷进 cards/ 后，通常要从原安装位置解析）。 */
  depSourceDir?: string
}

export class CardAdapterHost {
  private options: CardAdapterHostOptions
  readonly bridge: ToolBridge
  /** instanceId → 已挂载的插件（卸载时要 dispose）。 */
  private mounted = new Map<string, MountedPlugin>()
  /** 提示词段注入器 —— 只在宿主接上了 `ctx.systemPrompt` 时存在。 */
  private promptInjector?: PromptInjector

  constructor(options: CardAdapterHostOptions) {
    this.options = options
    this.bridge = new ToolBridge(options)
    if (options.registerPromptSection) {
      this.promptInjector = new PromptInjector({
        registerSection: options.registerPromptSection,
        getConnection: options.getConnection,
        audit: options.audit,
      })
    }
  }

  /** 总开关状态（宿主侧判定用；UI 的标注走 `adapter/status.ts`）。 */
  enabled(): boolean {
    return isAdapterEnabled()
  }

  /**
   * 挂载一张适配卡。
   *
   * @throws Error 一切可预期的拒绝都带明确原因（开关没开 / 依赖缺 / 申报缺 / apply 失败）
   */
  async mount(request: AdapterMountRequest): Promise<{ tools: number; pluginId: string }> {
    const { instanceId, cardId, pluginDir, capabilities, connectionId, scope, depSourceDir } = request
    const { audit, debug, shimRoot, facadeBaseDir } = this.options
    const log = debug ?? (() => {})

    if (!isAdapterEnabled()) {
      throw new Error(
        `「${cardId}」是适配卡，但适配层**没有开启**（默认关闭）。` +
          `开启后重试；未开启时它不会被挂载，也不会影响其它卡片。`,
      )
    }
    if (this.mounted.has(instanceId)) {
      throw new Error(`适配卡实例 ${instanceId} 已经挂载过 —— 请先卸载。`)
    }

    const mountRequest: MountRequest = {
      pluginId: cardId,
      pluginDir,
      capabilities,
      shimRoot,
      facadeBaseDir,
      ...(depSourceDir ? { depSourceDir } : {}),
      /**
       * 按**这一张卡片实例**建模型门面：调用预算、审计前缀都绑在这个实例上。
       * 影子 ctx 只会在申报过 `llm` 时才把它交出去。
       */
      services: this.options.llm
        ? {
            llm: new CardLlm(cardId, {
              stream: this.options.llm.stream as never,
              listProviders: this.options.llm.listProviders,
              audit,
              ...(this.options.llmBudget !== undefined ? { budget: this.options.llmBudget } : {}),
            }),
          }
        : {},
    }

    const plugin = await mountPlugin(mountRequest, audit)
    try {
      const tools = this.bridge.add(plugin, { cardId, instanceId, connectionId, scope })

      /**
       * 提示词段：装载后**立刻**注册（同样按装配时判定可见性）。
       *
       * 与工具分开收口（桥接失败要回滚工具、提示词注册失败要回滚提示词），
       * 所以放在同一个 try 里、由同一个 catch 统一回滚。
       */
      let prompts = 0
      if (plugin.capture.prompts.length > 0) {
        if (!this.promptInjector) {
          throw new Error(
            `插件「${cardId}」贡献了 ${plugin.capture.prompts.length} 段提示词，` +
              `但适配层没有接上 ctx.systemPrompt —— 无法注册（拒绝装载，避免"装上了却不生效"）。`,
          )
        }
        prompts = this.promptInjector.register(
          { instanceId, cardId, connectionId, ...(scope ? { scope } : {}) },
          plugin.capture.prompts,
        )
      }

      this.mounted.set(instanceId, plugin)
      audit(
        `[adapter] 适配卡「${cardId}」已挂到连接 ${connectionId}（scope=${scope ?? 'both'}），` +
          `桥接 ${tools.length} 个工具、${prompts} 段提示词；${this.bridge.describe()}`,
      )
      return { tools: tools.length, pluginId: plugin.pluginId }
    } catch (e) {
      // 任一环节失败 ⇒ 把刚挂上的插件与已注册的东西全撤掉，不留半截状态
      try {
        this.promptInjector?.unregister(instanceId)
      } catch (err) {
        log(`回滚提示词段时抛错（已忽略）：${String(err)}`)
      }
      try {
        this.bridge.remove(instanceId)
      } catch (err) {
        log(`回滚桥接时抛错（已忽略）：${String(err)}`)
      }
      try {
        plugin.dispose()
      } catch (err) {
        log(`卸载半截插件时抛错（已忽略）：${String(err)}`)
      }
      throw e
    }
  }

  /** 卸载一张适配卡：先摘提示词与工具（无幽灵），再释放插件资源。 */
  unmount(instanceId: string): void {
    const { audit, debug } = this.options
    const log = debug ?? (() => {})
    const plugin = this.mounted.get(instanceId)

    let prompts = 0
    try {
      prompts = this.promptInjector?.unregister(instanceId) ?? 0
    } catch (e) {
      log(`撤销提示词段时抛错（已忽略）：${String(e)}`)
    }
    const unregistered = this.bridge.remove(instanceId)
    if (plugin) {
      try {
        plugin.dispose()
      } catch (e) {
        log(`释放插件资源时抛错（已忽略）：${String(e)}`)
      }
      this.mounted.delete(instanceId)
    }
    if (plugin || unregistered > 0 || prompts > 0) {
      audit(
        `[adapter] 适配卡实例 ${instanceId} 已卸载（注销工具 ${unregistered} 个、提示词 ${prompts} 段）`,
      )
    }
  }

  /** 某个会话看得见的桥接工具名（供下发过滤）。 */
  visibleToolNamesForSession(sessionId: string | null): Set<string> {
    return this.bridge.visibleToolNamesForSession(sessionId)
  }

  /** 插件卸载时收口：把所有适配卡卸掉。 */
  disposeAll(): void {
    for (const instanceId of [...this.mounted.keys()]) this.unmount(instanceId)
  }

  /** 诊断摘要。 */
  describe(): string {
    return (
      `适配层=${isAdapterEnabled() ? '开' : '关'} 已挂载适配卡=${this.mounted.size} ` +
      this.bridge.describe()
    )
  }
}
