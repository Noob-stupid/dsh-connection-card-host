/**
 * `llm` 能力 —— **卡片自己调模型**（用户裁决：只做这个含义）。
 *
 * ## 与"改会话模型"的区别（刻意划清）
 *
 * | | 是什么 | 做不做 |
 * |:--|:--|:--|
 * | 本文件（`llm`） | 卡片**自己**发模型调用、自己挑模型（分类/摘要/判定…），**不动会话** | ✅ 做 |
 * | 模型路由 / 改会话模型 | 让某个会话换模型跑 | ❌ **不做** —— 那是全局插件的活（用户想用自己装 router 类插件） |
 *
 * ## 门面形状（为什么不是把 `ctx.llm` 原样递出去）
 *
 * 官方 `ctx.llm` 是**流式 + 分块装配**的底层接口（`stream()` 出 token 级 chunk，
 * 调用方还得自己 `BlockAssembler` 拼）。卡片要的通常是"给我一段文本"，
 * 把底层接口原样递出去等于让每张卡片重写一遍装配逻辑，还容易写错。
 * 所以这里给一个**窄门面**：
 *
 *     ctx.llm.providers()                     有哪些 provider 可用
 *     await ctx.llm.chat({ provider, model, system?, prompt, maxTokens? })
 *       → { ok, text?, failure?, usage? }
 *
 * **provider 与 model 必须显式给**：这是刻意的 —— 让"用哪个模型"这件事
 * 在卡片代码里看得见（费用与能力都取决于它），而不是被某个默认值悄悄决定。
 *
 * ## 花钱的事要说清楚
 *
 * 卡片调用会**真实消耗额度**。所以：
 *   · 每次调用都记审计（provider/model/字符数/结果）
 *   · 每张卡片实例有**调用预算**（默认 100 次），超出后**明确拒绝**并说明原因
 *     —— 一个写错的循环不该悄悄烧掉整月额度
 */
/** 流式 chunk（只声明我们用到的字段；未知字段一律忽略）。 */
interface StreamChunk {
    type?: string;
    kind?: string;
    text?: string;
    index?: number;
    failure?: {
        code?: string;
        message?: string;
    };
    usage?: unknown;
    [k: string]: unknown;
}
export interface LlmFacadeDeps {
    /** `ctx.llm.stream(options)` 的绑定版。 */
    stream: (options: Record<string, unknown>) => AsyncIterable<StreamChunk>;
    /** `ctx.llm.listProviders()` 的绑定版。 */
    listProviders: () => string[];
    /** 审计。 */
    audit: (message: string) => void;
    /** 每张卡片实例的调用预算（默认 100）。 */
    budget?: number;
}
export interface ChatArgs {
    provider: string;
    model: string;
    /** 系统提示（可选）。 */
    system?: string;
    /** 用户输入（必填）。 */
    prompt: string;
    /** 输出上限（可选，由 provider 适配器决定是否生效）。 */
    maxTokens?: number;
}
export interface ChatResult {
    ok: boolean;
    /** 成功时的文本。 */
    text?: string;
    /** 失败时的稳定错误码（官方约定：按 code 路由，不按 message 文本）。 */
    failure?: {
        code: string;
        message?: string;
    };
    usage?: unknown;
}
/** 调用预算的默认值（见文件头"花钱的事"）。 */
export declare const DEFAULT_LLM_BUDGET = 100;
export declare class CardLlm {
    private deps;
    private calls;
    private budget;
    private readonly pluginId;
    constructor(pluginId: string, deps: LlmFacadeDeps);
    /** 可用的 provider 路由（卡片据此挑）。 */
    providers(): string[];
    /** 已用调用数（诊断用）。 */
    used(): number;
    /**
     * 非流式的一次调用：把流拼成一段文本返回。
     *
     * 失败**不抛异常**，而是返回 `{ ok:false, failure }` ——
     * 卡片是宿主里的第三方代码，让它拿一个可判定的结果比让它接异常更不容易写错。
     */
    chat(args: ChatArgs): Promise<ChatResult>;
    describe(): string;
}
export {};
