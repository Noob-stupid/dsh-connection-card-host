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
export const IMPLEMENTED_CAPABILITIES = ['tools', 'effect'];
/**
 * 清单里已列入、但**本版本尚未实现**的能力。
 *
 * `llm` —— 用户已裁决要给（D1），实现它需要拿到宿主 LLM 服务并按连接/端限定调用，
 *          属于下一批工作，**现在不假装支持**。
 * `prompt` —— 按会话注入提示（复用 `system-prompt/assemble` 瀑布），同样下一批。
 */
export const PLANNED_CAPABILITIES = ['llm', 'prompt'];
/** 全部合法能力名（申报时允许出现的集合）。 */
export const ALL_CAPABILITIES = [
    ...IMPLEMENTED_CAPABILITIES,
    ...PLANNED_CAPABILITIES,
];
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
export function validateDeclaration(input) {
    if (input === undefined || input === null) {
        return { ok: true, declared: [] };
    }
    if (!Array.isArray(input)) {
        return {
            ok: false,
            declared: [],
            reason: `capabilities 必须是数组，收到 ${typeof input}`,
        };
    }
    const unknown = input.filter((c) => typeof c !== 'string' || !ALL_CAPABILITIES.includes(c));
    if (unknown.length > 0) {
        return {
            ok: false,
            declared: [],
            reason: `有未定义的能力名：${unknown.map((c) => JSON.stringify(c)).join(', ')}。` +
                `可用的能力名是：${ALL_CAPABILITIES.join(' / ')}`,
        };
    }
    return { ok: true, declared: [...new Set(input)].sort() };
}
/** 某能力是否已实现（供影子 ctx 与审计共用，避免两处判断不一致）。 */
export function isImplemented(capability) {
    return IMPLEMENTED_CAPABILITIES.includes(capability);
}
/**
 * 生成"未申报/未实现"的拒绝文案。
 *
 * 分开措辞是本文件的重点：作者看到的话必须能直接指向下一步动作。
 */
export function describeCapabilityFailure(capability, declared, pluginId) {
    const available = `本版本已实现：${IMPLEMENTED_CAPABILITIES.join(' / ')}` +
        (PLANNED_CAPABILITIES.length > 0
            ? `；已列入清单但尚未实现：${PLANNED_CAPABILITIES.join(' / ')}`
            : '');
    if (declared.includes(capability) && !isImplemented(capability)) {
        return (`插件「${pluginId}」访问了能力「${capability}」，但它在本版本**尚未实现**。` +
            `${available}。` +
            `若该插件依赖它，请等待适配层实现后再挂载 —— 不要用忽略的方式绕过（那会让它在别处莫名失败）。`);
    }
    return (`插件「${pluginId}」访问了**未申报**的能力「${capability}」。` +
        `它申报的是：[${declared.join(', ') || '（空）'}]。` +
        `${available}。` +
        `若该插件确实需要「${capability}」，请在它的清单里申报 —— 适配层不会静默放行未申报的能力，` +
        `因为那会让插件的影响溢出到这张卡片之外。`);
}
//# sourceMappingURL=capabilities.js.map