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
import { type CapabilityDeclaration } from './capabilities.js';
import type { ToolDefinition } from './facade.js';
import type { PromptSection } from './prompt-inject.js';
/** 一次挂载中被捕获的东西。 */
export interface ShadowCapture {
    /** 插件注册的工具：名字 → 定义（注册顺序保留）。 */
    tools: Map<string, ToolDefinition>;
    /** 插件贡献的提示词段（`prompt` 能力）。 */
    prompts: PromptSection[];
    /** 插件登记的所有清理函数（逆序执行）。 */
    disposers: {
        label: string;
        fn: () => void;
    }[];
    /** 插件试图向全局提供服务的记录（不执行，只记账 + 抛错）。 */
    providedAttempts: string[];
}
export interface ShadowCtxOptions {
    /** 插件标识（用于错误文案与审计）。 */
    pluginId: string;
    /** 能力申报（已通过 `validateDeclaration`）。 */
    declaration: CapabilityDeclaration;
    /** 审计日志。 */
    audit: (message: string) => void;
    /**
     * 由适配宿主提供的服务实例（例如按卡片实例建的 `llm` 门面）。
     *
     * 为什么从这里注入、而不是在影子 ctx 内部造：这些服务要绑定**具体卡片实例**
     * （调用预算、审计前缀、可见范围），而影子 ctx 只负责回答"能不能访问"。
     */
    services?: Record<string, unknown>;
}
export interface ShadowCtx {
    /** 交给插件 `apply` 的 ctx。 */
    ctx: unknown;
    /** 本次挂载捕获到的东西。 */
    capture: ShadowCapture;
    /** 清理：逆序执行所有 disposer，并清空捕获表。 */
    dispose: () => void;
    /** 供诊断输出的一行摘要。 */
    describe: () => string;
}
/**
 * 构造影子 ctx。
 */
export declare function createShadowCtx(options: ShadowCtxOptions): ShadowCtx;
/** 供上层判断：某个申报的能力是否已实现（避免"能不能挂"的判断散落各处）。 */
export declare function capabilitySupported(capability: string): boolean;
