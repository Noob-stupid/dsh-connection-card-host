/**
 * 影子 ctx —— 挂载 DSH 插件时交给它的**受限上下文**。
 *
 * ## 它是什么
 *
 * 普通 DSH 插件的宿主入口形如 `export function apply(ctx, config)`。
 * 官方加载器给它的 `ctx` 是**真宿主上下文**；我们给的是这一个：
 * 只实现插件**申报过的**能力，其余访问**当场抛错**。
 *
 * ## 为什么用 Proxy 而不是"缺啥补啥的对象"
 *
 * 插件访问一个**不存在**的属性时，普通对象只会给 `undefined` ——
 * 于是插件里的 `ctx.llm.chat(...)` 会以 "Cannot read properties of undefined"
 * 这种**与真实原因无关**的形态炸掉。Proxy 能截住这次访问，说出
 * "你访问了 llm，但你申报的是 [tools]，本版本已实现的是 …"。
 *
 * 这正是护栏②要的第三态：不放行、不静默忽略，而是**显式失败**。
 *
 * ## 生命周期
 *
 * `effect` 与 `tools.register` 都产出 disposer，全部登记在册；
 * `dispose()` 时**逆序**执行（后注册的先清理，符合依赖方向）。
 * 卸载卡片 / 断开连接 / 重放前都必须调它 —— 否则就是幽灵工具（护栏③）。
 */

import {
  describeCapabilityFailure,
  isImplemented,
  type CapabilityDeclaration,
} from './capabilities.js'
import type { ToolDefinition } from './facade.js'
import type { PromptSection } from './prompt-inject.js'

/** 一次挂载中被捕获的东西。 */
export interface ShadowCapture {
  /** 插件注册的工具：名字 → 定义（注册顺序保留）。 */
  tools: Map<string, ToolDefinition>
  /** 插件贡献的提示词段（`prompt` 能力）。 */
  prompts: PromptSection[]
  /** 插件登记的所有清理函数（逆序执行）。 */
  disposers: { label: string; fn: () => void }[]
  /** 插件试图向全局提供服务的记录（不执行，只记账 + 抛错）。 */
  providedAttempts: string[]
}

export interface ShadowCtxOptions {
  /** 插件标识（用于错误文案与审计）。 */
  pluginId: string
  /** 能力申报（已通过 `validateDeclaration`）。 */
  declaration: CapabilityDeclaration
  /** 审计日志。 */
  audit: (message: string) => void
  /**
   * 由适配宿主提供的服务实例（例如按卡片实例建的 `llm` 门面）。
   *
   * 为什么从这里注入、而不是在影子 ctx 内部造：这些服务要绑定**具体卡片实例**
   * （调用预算、审计前缀、可见范围），而影子 ctx 只负责回答"能不能访问"。
   */
  services?: Record<string, unknown>
}

export interface ShadowCtx {
  /** 交给插件 `apply` 的 ctx。 */
  ctx: unknown
  /** 本次挂载捕获到的东西。 */
  capture: ShadowCapture
  /** 清理：逆序执行所有 disposer，并清空捕获表。 */
  dispose: () => void
  /** 供诊断输出的一行摘要。 */
  describe: () => string
}

/**
 * 这些属性名不参与能力判定 —— 它们由语言/工具链反射性访问，
 * 抛错只会制造误报（例如 `await ctx`、`console.log(ctx)`、`JSON.stringify(ctx)`）。
 */
const REFLECTIVE_PROPS = new Set([
  'then',
  'toJSON',
  'toString',
  'valueOf',
  'constructor',
  'inspect',
  'name',
  'prototype',
])

/**
 * 构造影子 ctx。
 */
export function createShadowCtx(options: ShadowCtxOptions): ShadowCtx {
  const { pluginId, declaration, audit } = options
  const declared = declaration.declared

  const capture: ShadowCapture = {
    tools: new Map(),
    prompts: [],
    disposers: [],
    providedAttempts: [],
  }

  const refuse = (capability: string): never => {
    throw new Error(describeCapabilityFailure(capability, declared, pluginId))
  }

  /** `ctx.effect(cb, label?)` —— 立即执行 cb，登记它返回的清理函数。 */
  const effect = (cb: () => unknown, label?: string): void => {
    if (typeof cb !== 'function') {
      throw new Error(`ctx.effect 需要一个函数，收到 ${typeof cb}`)
    }
    const result = cb()
    if (typeof result === 'function') {
      capture.disposers.push({ label: label ?? '(未命名 effect)', fn: result as () => void })
    }
  }

  /** `ctx.tools.register(definition)` —— 捕获定义，返回 disposer。 */
  const registerTool = (definition: unknown): (() => void) => {
    const def = definition as ToolDefinition | undefined
    if (!def || typeof def !== 'object' || typeof def.name !== 'string') {
      throw new Error('ctx.tools.register 收到的定义缺少 name 字段')
    }
    if (capture.tools.has(def.name)) {
      // 同名重复注册：官方会抛，我们也抛 —— 静默覆盖会让"少了一个工具"极难查
      throw new Error(`插件「${pluginId}」重复注册了工具「${def.name}」`)
    }
    capture.tools.set(def.name, def)
    audit(`[adapter] ${pluginId} 注册工具「${def.name}」（待桥接，尚未对会话可见）`)
    return () => {
      capture.tools.delete(def.name)
    }
  }

  const services: Record<string, unknown> = {}
  if (declared.includes('tools')) {
    services.tools = { register: registerTool }
  }
  if (declared.includes('effect')) {
    services.effect = effect
  }
  /**
   * `ctx.prompt.section({ name?, text, order? })` —— 卡片贡献一段提示词。
   *
   * 这里**只捕获、不注册**：注册要绑定连接与可见范围（由适配宿主在装载后做，
   * 见 prompt-inject.ts）。影子 ctx 不掌握那些信息，硬做只会做错。
   */
  if (declared.includes('prompt')) {
    services.prompt = {
      section: (input: unknown): void => {
        const s = input as { name?: unknown; text?: unknown; order?: unknown } | undefined
        if (!s || typeof s.text !== 'string' || s.text.length === 0) {
          throw new Error('ctx.prompt.section 需要 { text: string }，且 text 不能为空')
        }
        capture.prompts.push({
          ...(typeof s.name === 'string' && s.name.length > 0 ? { name: s.name } : {}),
          text: s.text,
          ...(typeof s.order === 'number' && Number.isFinite(s.order) ? { order: s.order } : {}),
        })
        audit(`[adapter] ${pluginId} 贡献提示词段（${s.text.length} 字符，装配时按会话判定给不给）`)
      },
    }
  }
  /**
   * 宿主注入的服务（例如按卡片实例建的 `llm` 门面）。
   *
   * ⚠️ **只在申报过的能力名下可用** —— 否则等于绕过申报制：
   * 宿主塞进来什么，插件就能用什么。
   */
  for (const [name, value] of Object.entries(options.services ?? {})) {
    if (declared.includes(name)) services[name] = value
  }

  const target: Record<string | symbol, unknown> = {
    /**
     * `ctx.set(name, value)` —— cordis 里"向上下文提供服务"的入口。
     *
     * 在卡片作用域里"提供全局服务"是**语义冲突**：这张卡片只服务一条连接的某一端，
     * 而 `provide` 的语义是"给整个宿主用"。所以这里**明确拒绝并说明理由**，
     * 而不是放行（会污染全局）或忽略（插件会在别处崩）。
     */
    set(name: unknown, _value?: unknown): never {
      capture.providedAttempts.push(String(name))
      throw new Error(
        `插件「${pluginId}」试图用 ctx.set('${String(name)}') 向全局提供服务 —— ` +
          `这在卡片作用域里是语义冲突：卡片只服务一条连接的某一端，而 provide 的语义是整个宿主。` +
          `本适配层不提供该能力。若插件的核心功能就是提供全局服务，它**不适合**作为卡片挂载。`,
      )
    },
    /** 供诊断：暴露申报内容（插件一般不会用到）。 */
    __declared: declared,
    /**
     * 反射性访问不该抛错 —— `console.log(ctx)`、模板字符串插值都会走到这里。
     * 抛错只会制造与真实原因无关的误报。
     */
    toString: () => `[shadow-ctx ${pluginId}]`,
    valueOf: () => `[shadow-ctx ${pluginId}]`,
  }

  const ctx = new Proxy(target, {
    get(t, prop, receiver) {
      // 1) 反射性属性：返回 undefined，不抛
      if (typeof prop === 'symbol' || REFLECTIVE_PROPS.has(prop)) {
        return Reflect.get(t, prop, receiver)
      }
      // 2) 明确挂上的成员（set / __declared）
      if (prop in t) return Reflect.get(t, prop, receiver)
      // 3) 申报过且已实现的服务
      if (prop in services) return services[prop]
      // 4) 其余一律**显式失败**（未申报 / 已申报但未实现，文案由 capabilities 区分）
      return refuse(prop)
    },
    has(_t, prop) {
      if (typeof prop === 'symbol') return false
      return prop in services || prop === 'set' || prop === 'effect' || prop === 'tools'
    },
    set(): boolean {
      throw new Error(
        `插件「${pluginId}」试图直接写 ctx 属性 —— 影子 ctx 是只读的。` +
          `需要提供服务请用 ctx.set()（同样被拒绝，理由见其错误文案）。`,
      )
    },
  })

  return {
    ctx,
    capture,
    dispose() {
      // 逆序清理：后登记的依赖先登记的
      for (const d of [...capture.disposers].reverse()) {
        try {
          d.fn()
        } catch (e) {
          audit(`[adapter] ${pluginId} 清理「${d.label}」时抛错（已忽略，继续清理其余）：${String(e)}`)
        }
      }
      capture.disposers = []
      capture.tools.clear()
    },
    describe() {
      return (
        `plugin=${pluginId} declared=[${declared.join(', ')}] ` +
        `tools=${capture.tools.size} disposers=${capture.disposers.length} ` +
        `provideAttempts=${capture.providedAttempts.length}`
      )
    },
  }
}

/** 供上层判断：某个申报的能力是否已实现（避免"能不能挂"的判断散落各处）。 */
export function capabilitySupported(capability: string): boolean {
  return isImplemented(capability)
}
