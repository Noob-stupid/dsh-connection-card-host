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
/** 调用预算的默认值（见文件头"花钱的事"）。 */
export const DEFAULT_LLM_BUDGET = 100;
export class CardLlm {
    deps;
    calls = 0;
    budget;
    pluginId;
    constructor(pluginId, deps) {
        this.pluginId = pluginId;
        this.deps = deps;
        this.budget = deps.budget ?? DEFAULT_LLM_BUDGET;
    }
    /** 可用的 provider 路由（卡片据此挑）。 */
    providers() {
        try {
            const list = this.deps.listProviders();
            return Array.isArray(list) ? list.map(String) : [];
        }
        catch (e) {
            this.deps.audit(`[adapter] 卡片「${this.pluginId}」查 provider 失败：${String(e)}`);
            return [];
        }
    }
    /** 已用调用数（诊断用）。 */
    used() {
        return this.calls;
    }
    /**
     * 非流式的一次调用：把流拼成一段文本返回。
     *
     * 失败**不抛异常**，而是返回 `{ ok:false, failure }` ——
     * 卡片是宿主里的第三方代码，让它拿一个可判定的结果比让它接异常更不容易写错。
     */
    async chat(args) {
        const { provider, model, system, prompt, maxTokens } = args ?? {};
        if (!provider || !model || typeof prompt !== 'string') {
            return {
                ok: false,
                failure: {
                    code: 'BAD_ARGS',
                    message: 'provider / model / prompt 都是必填；provider 与 model 必须显式给（见文件头说明）',
                },
            };
        }
        if (this.calls >= this.budget) {
            const msg = `卡片「${this.pluginId}」的模型调用已达上限（${this.budget} 次/挂载）—— 已拒绝本次调用。` +
                `这是**费用护栏**：写错的循环不该悄悄烧额度。重新挂载卡片会重置计数。`;
            this.deps.audit(`[adapter] ${msg}`);
            return { ok: false, failure: { code: 'CARD_BUDGET_EXCEEDED', message: msg } };
        }
        this.calls++;
        const messages = [];
        if (system)
            messages.push({ role: 'system', content: [{ type: 'text', text: system }] });
        messages.push({ role: 'user', content: [{ type: 'text', text: prompt }] });
        const parts = [];
        let failure;
        let usage;
        try {
            const options = { provider, model, messages };
            if (typeof maxTokens === 'number')
                options.maxTokens = maxTokens;
            for await (const chunk of this.deps.stream(options)) {
                // 文本增量（官方 chunk：{ type: 'text-delta', text }）
                if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
                    parts.push(chunk.text);
                    continue;
                }
                if (chunk?.usage !== undefined)
                    usage = chunk.usage;
                // 终止块：官方约定 kind 为 error / aborted 时带 failure
                if (chunk?.kind === 'error' || chunk?.kind === 'aborted') {
                    failure = {
                        code: String(chunk.failure?.code ?? chunk.kind.toUpperCase()),
                        ...(chunk.failure?.message ? { message: String(chunk.failure.message) } : {}),
                    };
                }
            }
        }
        catch (e) {
            failure = { code: 'STREAM_THREW', message: e instanceof Error ? e.message : String(e) };
        }
        const text = parts.join('');
        this.deps.audit(`[adapter] 模型调用：卡片「${this.pluginId}」${provider}/${model}` +
            `（prompt ${prompt.length} 字符，第 ${this.calls}/${this.budget} 次）→ ` +
            (failure ? `失败 ${failure.code}` : `成功，输出 ${text.length} 字符`));
        return failure
            ? { ok: false, failure, ...(usage !== undefined ? { usage } : {}) }
            : { ok: true, text, ...(usage !== undefined ? { usage } : {}) };
    }
    describe() {
        return `模型调用=${this.calls}/${this.budget}`;
    }
}
//# sourceMappingURL=llm-facade.js.map