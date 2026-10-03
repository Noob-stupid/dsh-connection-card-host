/**
 * 适配能力清单 —— **申报制**的词汇表。
 *
 * 用户裁决（`adapter-design.md` D1）：`llm` 要给。但"清单里要有"与"这一版实现了"
 * 是两件事 —— 本文件把两者**分开表达**，因为把"已列入清单但还没实现"说成"支持"
 * 会让插件作者在挂载时撞上莫名其妙的失败。
 *
 * 访问语义（护栏②）：
 *   · 未**申报**的能力     → 抛错，并列出"你可以申报哪些"
 *   · 已申报但**尚未实现** → 抛错，并明确说"本版本尚未实现"，与上一条区分
 *   · 已申报且已实现       → 正常工作
 *
 * 为什么是"显式失败"而不是另两种：
 *   · **放行**未申报能力 = 插件照样产生全局副作用（"脱离全局"不成立）
 *   · **静默忽略**       = 插件拿不到服务、在别处莫名崩溃，最难查
 * 把边界变成**加载期错误**，问题就在装上的那一刻暴露。
 */
/** 这一版**真正实现**的能力。 */
export declare const IMPLEMENTED_CAPABILITIES: readonly ["tools", "effect"];
/**
 * 清单里已列入、但**本版本尚未实现**的能力。
 *
 * `llm` —— 用户已裁决要给（D1），实现它需要拿到宿主 LLM 服务并按连接/端限定调用，
 *          属于下一批工作，**现在不假装支持**。
 * `prompt` —— 按会话注入提示（复用 `system-prompt/assemble` 瀑布），同样下一批。
 */
export declare const PLANNED_CAPABILITIES: readonly ["llm", "prompt"];
/** 全部合法能力名（申报时允许出现的集合）。 */
export declare const ALL_CAPABILITIES: readonly string[];
export type Capability = (typeof IMPLEMENTED_CAPABILITIES)[number] | (typeof PLANNED_CAPABILITIES)[number];
/** 申报校验结果。 */
export interface CapabilityDeclaration {
    ok: boolean;
    /** 校验通过时的能力集合（已去重、已排序，便于比对与审计）。 */
    declared: string[];
    /** 校验失败时的原因（面向用户/作者，说清下一步）。 */
    reason?: string;
}
/**
 * 校验一份能力申报。
 *
 * 三条规则：
 *   1. 必须是数组（空数组合法 —— 表示"只要生命周期，不要任何服务"）
 *   2. 每一项都必须在 `ALL_CAPABILITIES` 里；不认识的**直接拒绝**（不静默丢弃）
 *   3. 申报了尚未实现的能力**不算失败**，但要在 `declared` 里如实保留 ——
 *      挂载时由影子 ctx 在**真正被访问**时抛出"尚未实现"。这比在申报阶段就拒绝更准确：
 *      插件可能申报了 `llm` 却根本没用到它。
 */
export declare function validateDeclaration(input: unknown): CapabilityDeclaration;
/** 某能力是否已实现（供影子 ctx 与审计共用，避免两处判断不一致）。 */
export declare function isImplemented(capability: string): boolean;
/**
 * 生成"未申报/未实现"的拒绝文案。
 *
 * 分开措辞是本文件的重点：作者看到的话必须能直接指向下一步动作。
 */
export declare function describeCapabilityFailure(capability: string, declared: readonly string[], pluginId: string): string;
