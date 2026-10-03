/**
 * 工具桥接层 —— 把**挂载进来的插件工具**接到 DSH 的工具面上，并限定可见范围。
 *
 * ## 三件事
 *
 * 1. **注册**：捕获到的工具以 `card_<cardId>_<tool>` 注册进 DSH 工具服务（补充④防撞名）
 * 2. **下发时过滤**：`system-prompt/assemble` 里把"这个会话看不见"的桥接工具摘掉
 * 3. **调用时校验**：工具自己的 `execute` 再校验一次（护栏③：**只藏不校验是不够的**）
 *
 * 2 与 3 共用 `tool-scope.ts` 的同一个纯函数 —— 两份判定迟早分叉，
 * 而分叉的表现是"藏了但能调"或"能调却报不可见"，两种都极难查。
 *
 * ## ⚠️ 注册份数：**一个工具名注册一次**，实例用「绑定」表达（D2 裁决）
 *
 * 第一版写成了"每个卡片实例注册一次"，结果**同一插件挂到两条连接上直接撞名** ——
 * 由离线测试抓到（DSH 的注册表对同名会抛 `already registered`）。
 * 正确形态是按 D2：
 *
 *     card_<cardId>_<tool>            ← 全局**只注册一份**
 *       └─ bindings: [ {instanceId, connectionId, scope}, … ]   ← 每挂一处加一条
 *
 * 调用时按**调用者会话**在 bindings 里解析出该用哪个实例（`resolveBinding`）。
 * 这样注册表不会随连接数膨胀，也不会撞名。
 *
 * ## 调用被拒时**返回文字而不是抛异常**
 *
 * 照 `awareness-tools.ts` 的既有做法（那里写明：工具不该把异常抛回模型 ——
 * 那会让整个回合以 error 结束）。被拒是一次**正常结果**，把原因说清楚即可。
 *
 * ## 过滤的 fail-open 取向
 *
 * 拿不准时**保留**工具（与 `tool-scoping.ts` 同取向）。理由：调用时校验才是真正的闸门，
 * 过滤只是省 token 与避免误导；而误删一个该有的工具，用户看到的是"能力凭空消失"。
 */

import type { CardScope } from '../types/index.js'
import { decideBridgedVisibility, bridgedToolName, isBridgedToolName } from './tool-scope.js'
import type { ToolDefinition, JsonSchema } from './facade.js'
import type { MountedPlugin } from './mount.js'

/** 桥接层需要的宿主能力（依赖注入，便于离线测试）。 */
export interface BridgeDeps {
  /** DSH 的工具注册表：注册一个定义，返回注销函数。 */
  registerTool: (definition: unknown) => () => void
  /** 按 id 取连接（拿两端会话 id 用）。 */
  getConnection: (connectionId: string) => { sessionA: string; sessionB: string } | undefined
  /** 审计。 */
  audit: (message: string) => void
}

/** 一个工具名下的一个实例绑定。 */
export interface ToolBinding {
  cardId: string
  instanceId: string
  connectionId: string
  scope: CardScope | undefined
  /** 该实例的工具实现（每个挂载各有自己的状态）。 */
  definition: ToolDefinition
  pluginId: string
}

/** 一个桥接工具（全局唯一名字 + 若干实例绑定）。 */
export interface BridgeTool {
  cardId: string
  bridgedName: string
  originalName: string
  bindings: ToolBinding[]
  /** 登记过的注销函数。 */
  unregister: () => void
}

/** 从 exec 里取调用者会话 id（与 awareness-tools 一致：`exec.agent.id`）。 */
export function callerSessionId(exec: unknown): string | null {
  const agent = (exec as { agent?: { id?: unknown } } | null | undefined)?.agent
  const id = agent?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** 桥接层。 */
export class ToolBridge {
  private deps: BridgeDeps
  /** 工具名 → 桥接工具（**全局一份**）。 */
  private byName = new Map<string, BridgeTool>()
  /** 实例 id → 它参与了哪些工具名（卸载时按实例收口）。 */
  private namesByInstance = new Map<string, Set<string>>()

  constructor(deps: BridgeDeps) {
    this.deps = deps
  }

  /** 当前全部桥接工具。 */
  tools(): BridgeTool[] {
    return [...this.byName.values()]
  }

  /** 全部绑定（拍平，便于计数与诊断）。 */
  bindings(): ToolBinding[] {
    return this.tools().flatMap((t) => t.bindings)
  }

  /**
   * 把一次挂载捕获到的工具接到 DSH 工具面上。
   *
   * 同一 `cardId` 的重复挂载**不会重复注册** —— 只往已有工具的 `bindings` 里加一条。
   *
   * @returns 本次涉及的桥接工具（无工具时为 `[]`）
   */
  add(
    mounted: MountedPlugin,
    target: { cardId: string; instanceId: string; connectionId: string; scope?: CardScope },
  ): BridgeTool[] {
    const { cardId, instanceId, connectionId, scope } = target

    if (this.bindings().some((b) => b.instanceId === instanceId)) {
      throw new Error(
        `卡片实例 ${instanceId} 的工具已经桥接过 —— 重复桥接会让同一实例出现两条绑定，` +
          `调用时无法判断该用哪一个。请先 remove(instanceId)。`,
      )
    }

    const touched: BridgeTool[] = []
    const names = new Set<string>()
    /** 本次调用**新注册**的工具 —— 中途失败时要把它们撤销，不留半截状态。 */
    const createdHere: BridgeTool[] = []

    try {
      for (const [originalName, definition] of mounted.capture.tools) {
        const bridgedName = bridgedToolName(cardId, originalName)
        names.add(bridgedName)

        let tool = this.byName.get(bridgedName)
        if (!tool) {
          // 首次见到这个名字：真正注册进 DSH 工具表
          const created: BridgeTool = {
            cardId,
            bridgedName,
            originalName,
            bindings: [],
            unregister: () => {},
          }
          const bridgedDefinition = this.makeBridgedDefinition(created, definition)
          const unregister = this.deps.registerTool(bridgedDefinition)
          created.unregister = unregister
          this.byName.set(bridgedName, created)
          createdHere.push(created)
          tool = created
          this.deps.audit(`[adapter] 注册桥接工具「${bridgedName}」←「${originalName}」（卡片 ${cardId}）`)
        }

        tool.bindings.push({
          cardId,
          instanceId,
          connectionId,
          scope,
          definition,
          pluginId: mounted.pluginId,
        })
        this.deps.audit(
          `[adapter] 「${bridgedName}」新增绑定：实例 ${instanceId}，连接 ${connectionId}，scope=${scope ?? 'both'}` +
            `（该工具现有 ${tool.bindings.length} 条绑定）`,
        )
        touched.push(tool)
      }
    } catch (e) {
      /**
       * 回滚：一个注册失败不该留下半截状态 ——
       * 撤销本次新注册的工具与本次加上的绑定，让状态回到调用前。
       * 只回滚**本次**的产物；别的实例已有的绑定不受影响。
       */
      for (const t of touched) {
        t.bindings = t.bindings.filter((b) => b.instanceId !== instanceId)
      }
      for (const t of createdHere) {
        try {
          t.unregister()
        } catch {
          /* 回滚途中的错误不覆盖原始错误 */
        }
        this.byName.delete(t.bridgedName)
      }
      throw new Error(
        `桥接「${mounted.pluginId}」时失败：${e instanceof Error ? e.message : String(e)}。` +
          `本次注册的 ${createdHere.length} 个工具与相关绑定**已回滚**，状态回到调用前。`,
      )
    }

    if (names.size > 0) this.namesByInstance.set(instanceId, names)
    else
      this.deps.audit(
        `[adapter] 插件 ${mounted.pluginId} 没有注册任何工具 —— 桥接为空（卡片仍可持有事件/状态）`,
      )

    return touched
  }

  /**
   * 卸载一张卡片实例：摘掉它的绑定；某个工具**没有绑定剩下**时才真正注销。
   *
   * @returns 注销的工具数
   */
  remove(instanceId: string): number {
    const names = this.namesByInstance.get(instanceId)
    if (!names) return 0

    let unregistered = 0
    for (const name of names) {
      const tool = this.byName.get(name)
      if (!tool) continue
      const before = tool.bindings.length
      tool.bindings = tool.bindings.filter((b) => b.instanceId !== instanceId)
      const gone = before - tool.bindings.length
      if (gone > 0) {
        this.deps.audit(
          `[adapter] 「${name}」移除绑定：实例 ${instanceId}（剩 ${tool.bindings.length} 条）`,
        )
      }
      if (tool.bindings.length === 0) {
        try {
          tool.unregister()
        } catch (err) {
          this.deps.audit(`[adapter] 注销「${name}」时抛错（已忽略）：${String(err)}`)
        }
        this.byName.delete(name)
        unregistered++
        this.deps.audit(`[adapter] 注销桥接工具「${name}」（已无实例绑定）`)
      }
    }
    this.namesByInstance.delete(instanceId)
    return unregistered
  }

  /**
   * 按调用者解析该用哪条绑定（**D2 的动态解析**）。
   *
   * @returns 命中的绑定；`null` 时 `reason` 说明为什么都不能用
   */
  resolveBinding(
    tool: BridgeTool,
    sessionId: string | null,
  ): { binding: ToolBinding; reason: string } | { binding: null; reason: string } {
    if (tool.bindings.length === 0) {
      return { binding: null, reason: '这个工具当前没有任何实例绑定（卡片可能已被卸载）' }
    }
    if (!sessionId) {
      return {
        binding: null,
        reason: '认不出调用方是哪个会话（缺少 exec.agent.id），无法判断这张卡片对该会话是否可见',
      }
    }

    const usable: ToolBinding[] = []
    const reasons: string[] = []
    for (const b of tool.bindings) {
      const conn = this.deps.getConnection(b.connectionId)
      if (!conn) {
        reasons.push(`实例 ${b.instanceId} 的连接已不存在`)
        continue
      }
      const d = decideBridgedVisibility(b.scope, conn, sessionId)
      if (d.visible) usable.push(b)
      else reasons.push(d.reason)
    }

    if (usable.length === 0) {
      return { binding: null, reason: reasons[0] ?? '该会话不在这张卡片的可见范围内' }
    }
    if (usable.length > 1) {
      // 同一插件挂在多条都含该会话的连接上：按注册顺序取第一条，并留审计
      this.deps.audit(
        `[adapter] 「${tool.bridgedName}」对会话 ${sessionId} 有 ${usable.length} 条可用绑定，` +
          `按注册顺序选用实例 ${usable[0]!.instanceId}（连接 ${usable[0]!.connectionId}）`,
      )
    }
    return {
      binding: usable[0]!,
      reason: `命中实例 ${usable[0]!.instanceId}（连接 ${usable[0]!.connectionId}）`,
    }
  }

  /**
   * 某个会话**看得见**的桥接工具名（供 `system-prompt/assemble` 过滤）。
   *
   * 与调用时校验共用 `decideBridgedVisibility`。
   */
  visibleToolNamesForSession(sessionId: string | null): Set<string> {
    const out = new Set<string>()
    for (const tool of this.tools()) {
      const r = this.resolveBinding(tool, sessionId)
      if (r.binding) out.add(tool.bridgedName)
    }
    return out
  }

  /** 已知的桥接工具名（过滤时"只动自己的工具"）。 */
  knownToolNames(): Set<string> {
    return new Set(this.byName.keys())
  }

  /** 诊断摘要。 */
  describe(): string {
    const perCard = new Map<string, number>()
    for (const t of this.tools()) perCard.set(t.cardId, (perCard.get(t.cardId) ?? 0) + 1)
    const parts = [...perCard.entries()].map(([c, n]) => `${c}×${n}`)
    return (
      `桥接工具=[${parts.join(', ') || '无'}] 工具数=${this.byName.size} ` +
      `绑定数=${this.bindings().length} 实例数=${this.namesByInstance.size}`
    )
  }

  /** 包一层：名字/描述换成桥接版，`execute` 里做调用时校验与实例解析。 */
  private makeBridgedDefinition(tool: BridgeTool, first: ToolDefinition): ToolDefinition {
    const self = this
    return {
      name: tool.bridgedName,
      // 描述里带上来源：模型看到名字就知道工具从哪来，也便于人工排查
      description:
        `${first.description}\n\n` +
        `（来自连接卡片「${tool.cardId}」；只对该卡片可见的那一端可用）`,
      parameters: first.parameters as JsonSchema,
      output: first.output,
      async execute(args: unknown, exec: unknown): Promise<unknown> {
        const sessionId = callerSessionId(exec)
        const resolved = self.resolveBinding(tool, sessionId)
        if (!resolved.binding) {
          self.deps.audit(
            `[adapter] 拒绝调用「${tool.bridgedName}」：${resolved.reason}（会话 ${sessionId ?? '未知'}）`,
          )
          return `无法调用「${tool.bridgedName}」：${resolved.reason}。`
        }
        // 每个实例有自己的插件实现与状态 —— 调用**命中绑定**的那一份
        return resolved.binding.definition.execute(args, exec)
      },
    }
  }
}

/**
 * 下发时过滤：把该会话看不见的**桥接**工具从装配体里摘掉。
 *
 * ⚠️ 只动**自己知道的**桥接工具 —— 别人的工具一个都不碰。
 * 认不出会话时**保留**（fail-open，见文件头取向），并记审计。
 */
export function filterBridgedTools(
  assembly: { tools?: { name?: string }[]; [k: string]: unknown },
  sessionId: string | null,
  bridge: ToolBridge,
  audit: (message: string) => void,
): { assembly: typeof assembly; removed: number } {
  const known = bridge.knownToolNames()
  if (known.size === 0) return { assembly, removed: 0 }

  const tools = assembly.tools
  if (!Array.isArray(tools) || tools.length === 0) return { assembly, removed: 0 }

  if (!sessionId) {
    audit('[adapter] 过滤跳过：认不出会话 id —— 保留全部桥接工具（fail-open，调用时仍会校验）')
    return { assembly, removed: 0 }
  }

  const visible = bridge.visibleToolNamesForSession(sessionId)
  const kept = tools.filter((t) => {
    const name = typeof t?.name === 'string' ? t.name : ''
    if (!known.has(name)) return true // 不是我们的工具
    if (!isBridgedToolName(name)) return true // 保险：只认带前缀的
    return visible.has(name)
  })

  const removed = tools.length - kept.length
  if (removed > 0) {
    audit(`[adapter] 为会话 ${sessionId} 摘掉 ${removed} 个不可见的桥接工具`)
    return { assembly: { ...assembly, tools: kept }, removed }
  }
  return { assembly, removed: 0 }
}
