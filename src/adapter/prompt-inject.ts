/**
 * `prompt` 能力 —— 卡片往**它那条连接的那一端**的会话提示词里加内容。
 *
 * ## 用官方扩展点，不改装配体
 *
 * DSH 的 `ctx.systemPrompt.section({ name, order, text, interpolate })` 是**正门**：
 * 段按 `order` 升序拼进系统提示词，`text` **可以是函数**（每次装配时求值）——
 * 见 `dsh-system-prompt/lib/index.js`：`text: typeof section.text === 'function'
 * ? section.text(context) : section.text`（第 342 行）。
 *
 * 所以我们**每张适配卡注册一段**就够了，段文本函数在装配时判定：
 *
 *     这个会话在不在该卡片的可见范围内？在 ⇒ 返回卡片给的文字；不在 ⇒ 返回 ''（空段会被丢掉）
 *
 * 这比"给每个会话单独注册/注销"稳得多：会话是活的、会生会灭，
 * 而装配是每次请求都发生的 —— 把判定放在装配时，就没有"漏注册/漏注销"的窗口。
 *
 * ## 两个必须守住的细节
 *
 * 1. **`interpolate: false`**：卡片给的文字是**外部内容**，若原样插值，
 *    里面的 `{{...}}` 会被当成变量引用；官方规则是**未注册的引用直接抛错**
 *    （"a malformed prompt is worse than a loud failure"）——
 *    那会让整次装配失败。关掉插值，卡片写什么就是什么。
 * 2. **可见性判定复用同一份**：与工具桥接共用 `decideBridgedVisibility`，
 *    避免出现"工具藏了、提示词还在"这种半拉状态。
 */

import { decideBridgedVisibility } from './tool-scope.js'
import type { CardScope } from '../types/index.js'

/** 卡片贡献的一段提示词（由影子 ctx 捕获）。 */
export interface PromptSection {
  /** 段名（同名会覆盖；缺省由适配层按卡片生成）。 */
  name?: string
  /** 文字内容。 */
  text: string
  /** 排序位；缺省用一个偏后的位置，避免抢在宿主内容之前。 */
  order?: number
}

/** 注入器需要的宿主能力（依赖注入，便于离线测试）。 */
export interface PromptInjectorDeps {
  /** `ctx.systemPrompt.section(...)` 的绑定版：注册一段，返回注销函数。 */
  registerSection: (section: {
    name: string
    order: number
    text: (context: unknown) => string
    interpolate: boolean
  }) => () => void
  /** 按连接 id 取两端会话 id。 */
  getConnection: (connectionId: string) => { sessionA: string; sessionB: string } | undefined
  /** 审计。 */
  audit: (message: string) => void
}

/** 适配层默认用的排序位：**排在宿主内容之后**，不当"先声夺人"的那一段。 */
export const DEFAULT_PROMPT_ORDER = 900

interface Entry {
  instanceId: string
  cardId: string
  connectionId: string
  scope: CardScope | undefined
  sectionName: string
  dispose: () => void
}

/** 从装配 context 里取会话 id（与 tool-scoping 同一契约）。 */
export function sessionIdOfAssemblyContext(context: unknown): string | null {
  const scope = (context as { scope?: { session?: { id?: unknown } } } | undefined)?.scope
  const id = scope?.session?.id
  if (typeof id === 'string' && id.length > 0) return id
  // 兜底：有的装配路径把 agent 直接挂在 context 上
  const agentId = (context as { agent?: { id?: unknown } } | undefined)?.agent?.id
  return typeof agentId === 'string' && agentId.length > 0 ? agentId : null
}

export class PromptInjector {
  private deps: PromptInjectorDeps
  private byInstance = new Map<string, Entry[]>()

  constructor(deps: PromptInjectorDeps) {
    this.deps = deps
  }

  /** 已注册的卡片数（诊断用）。 */
  size(): number {
    return this.byInstance.size
  }

  /**
   * 为一张适配卡注册提示词段。
   *
   * @param sections 卡片通过影子 ctx 贡献的段（可多段）
   */
  register(
    target: { instanceId: string; cardId: string; connectionId: string; scope?: CardScope },
    sections: PromptSection[],
  ): number {
    if (sections.length === 0) return 0
    const { instanceId, cardId, connectionId, scope } = target
    const { registerSection, getConnection, audit } = this.deps

    if (this.byInstance.has(instanceId)) {
      throw new Error(`适配卡实例 ${instanceId} 的提示词段已经注册过 —— 请先 unregister。`)
    }

    const entries: Entry[] = []
    for (const [index, section] of sections.entries()) {
      // 段名带上卡片与实例：不同卡片的段互不覆盖（同名会覆盖，这是官方语义）
      const sectionName = section.name
        ? `card:${cardId}:${section.name}`
        : `card:${cardId}:${instanceId.slice(0, 8)}:${index}`

      const dispose = registerSection({
        name: sectionName,
        order: section.order ?? DEFAULT_PROMPT_ORDER,
        // ⚠️ 关掉插值：卡片文字里的 {{...}} 不该被当成变量引用（未注册的引用会抛错）
        interpolate: false,
        text: (context) => {
          const sessionId = sessionIdOfAssemblyContext(context)
          if (!sessionId) return ''
          const conn = getConnection(connectionId)
          if (!conn) return ''
          const decision = decideBridgedVisibility(scope, conn, sessionId)
          return decision.visible ? section.text : ''
        },
      })

      entries.push({ instanceId, cardId, connectionId, scope, sectionName, dispose })
    }

    this.byInstance.set(instanceId, entries)
    audit(
      `[adapter] 提示词：卡片「${cardId}」注册 ${entries.length} 段` +
        `（连接 ${connectionId}，scope=${scope ?? 'both'}，按装配时判定可见性）`,
    )
    return entries.length
  }

  /** 撤销一张卡片的全部提示词段。 */
  unregister(instanceId: string): number {
    const entries = this.byInstance.get(instanceId)
    if (!entries) return 0
    for (const e of entries) {
      try {
        e.dispose()
      } catch (err) {
        this.deps.audit(`[adapter] 撤销提示词段「${e.sectionName}」时抛错（已忽略）：${String(err)}`)
      }
    }
    this.byInstance.delete(instanceId)
    this.deps.audit(`[adapter] 提示词：撤销 ${entries.length} 段（实例 ${instanceId}）`)
    return entries.length
  }

  /** 全部撤销（插件卸载时收口）。 */
  disposeAll(): void {
    for (const instanceId of [...this.byInstance.keys()]) this.unregister(instanceId)
  }

  describe(): string {
    const total = [...this.byInstance.values()].reduce((n, e) => n + e.length, 0)
    return `提示词段=${total} 卡片数=${this.byInstance.size}`
  }
}
