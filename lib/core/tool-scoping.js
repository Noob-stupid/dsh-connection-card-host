/**
 * 按会话 scope 隐藏感知工具 —— 没参与连接的会话不该背这份 schema。
 *
 * ## 问题
 *
 * 5 个 `connection_*` 工具是**全局注册**的：每个会话（哪怕一条连接都没有）
 * 都在上下文里背着约 **1700 tokens** 的 schema。实测数据：
 *
 *     description 1275 字符 + parameters 1208 字符 ≈ 1698 tokens 常驻
 *
 * 而实测还发现：**没连接的会话真的会看到并尝试使用它们** ——
 * session-59945c2c 在**被连上之前 19 分钟**就调用了 `connection_conventions`
 * 和 `connection_peer_work`（`[seq=17] 10:23:13` 调用，`[seq=242] 10:42:56` 才收到「连接已建立」）。
 * 所以这不是"看见了也忽略"，是实打实的浪费加误导。
 *
 * ## 为什么用 waterfall，而不是 DSH 原生的 `deferLoading`
 *
 * DSH 的 `defineTool` 确实支持 `deferLoading: true`，但 LLM 包写明了它的语义：
 *
 *   > 显式延迟加载的初始工具**在首个保留的添加块出现前保持延迟状态**；
 *   > **声明延迟加载工具不会使其激活**。
 *
 * 也就是"藏起来等某个事件激活"，**不是"按会话条件显示"** —— 单独用它会让工具永远隐藏。
 * 我们要的是后者，所以用官方的 `system-prompt/assemble` waterfall（它本身是 scope-filtered）。
 *
 * ## 契约（照抄 dsh-tool-search 的实际用法，不靠猜）
 *
 *     ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
 *       const settled = await next()          // 先让后面的监听者处理完
 *       return 改造后的 assembly               // 返回改写版
 *     })
 *
 * `context.scope` 是一个 agent：`scope.session.id` 就是会话 id
 * （`Session.id` 是 `get id() { return this.header.id }`，已核对 DSH 源码）。
 *
 * ## 设计原则：**fail-open**
 *
 * 任何一步拿不准（拿不到 scope、拿不到会话 id、服务没装配、过滤后会把工具全删光），
 * **一律原样下发**。理由：**工具多出来的代价是 token，工具消失的代价是查不出原因的故障。**
 * 而且这个模块坏了会让所有会话的工具面变化，比省下的 token 危险得多。
 */
/** 要按 scope 隐藏的工具名前缀。 */
const SCOPED_PREFIX = 'connection_';
/** 过滤开关。出问题可以一键关掉（改这里或将来接配置）。 */
let enabled = true;
/** 供测试与排查用：临时开关。 */
export function setScopingEnabled(v) {
    enabled = v;
}
export function isScopingEnabled() {
    return enabled;
}
/**
 * 一次装配该不该过滤。
 *
 * 拆成纯函数是为了**可离线断言** —— 不依赖真实 agent/会话就能覆盖各种情况。
 *
 * @returns `filter: true` 表示要摘掉感知工具；否则原样下发
 */
export function decideFilter(context, deps) {
    if (!enabled)
        return { filter: false, reason: '开关关闭' };
    // ── 拿会话 id：任一步不对就 fail-open ──
    const scope = context?.scope;
    if (scope === null || scope === undefined)
        return { filter: false, reason: '没有 scope（全局视图）' };
    const session = scope.session;
    if (session === null || session === undefined)
        return { filter: false, reason: 'scope 上没有 session' };
    const sessionId = session.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { filter: false, reason: '会话 id 不是非空字符串' };
    }
    // ── 查它有没有连接：查不动也 fail-open ──
    let conns;
    try {
        conns = deps.getConnectionsBySession(sessionId);
    }
    catch (e) {
        return { filter: false, reason: `查连接时抛错：${e instanceof Error ? e.message : String(e)}`, sessionId };
    }
    if (!Array.isArray(conns))
        return { filter: false, reason: '查连接返回的不是数组', sessionId };
    if (conns.length > 0)
        return { filter: false, reason: `参与了 ${conns.length} 条连接`, sessionId };
    return { filter: true, reason: '没有任何连接', sessionId };
}
/**
 * 摘掉感知工具。
 *
 * 只动 `connection_` 前缀的，**绝不碰别人的工具**。
 * 若过滤后工具列表为空（说明判断错了，或这个会话本来就只有这些工具），
 * 也**放弃过滤** —— 让模型面对空工具面比多几个工具更糟。
 */
export function filterAssembly(assembly) {
    const tools = assembly?.tools;
    if (!Array.isArray(tools))
        return { assembly, removed: 0 };
    const kept = tools.filter((t) => !String(t?.name ?? '').startsWith(SCOPED_PREFIX));
    const removed = tools.length - kept.length;
    if (removed === 0 || kept.length === 0)
        return { assembly, removed: 0 };
    return { assembly: { ...assembly, tools: kept }, removed };
}
/**
 * 挂到 `system-prompt/assemble` waterfall 上。
 *
 * @param on - 注册监听（传 `ctx.on`）
 * @returns 注销函数
 */
export function installToolScoping(on, deps) {
    const log = deps.debug ?? (() => { });
    /** 每个会话只记一次"摘掉了"，避免每轮刷屏。 */
    const announced = new Set();
    return on('system-prompt/assemble', async (...args) => {
        // 监听者签名是 (assembly, context, next)
        const context = args[1];
        const next = args[args.length - 1];
        if (typeof next !== 'function')
            return args[0]; // 形态不对：原样放行
        // 先让后面的监听者处理完，再决定（照 dsh-tool-search 的次序）
        const settled = (await next());
        try {
            const d = decideFilter(context, deps);
            if (!d.filter)
                return settled;
            const { assembly, removed } = filterAssembly(settled);
            if (removed === 0)
                return settled;
            const key = d.sessionId ?? '?';
            if (!announced.has(key)) {
                announced.add(key);
                const msg = `按会话 scope 隐藏了 ${removed} 个感知工具（${key.slice(0, 8)}：${d.reason}）`;
                log(msg);
                deps.audit(msg);
            }
            return assembly;
        }
        catch (e) {
            // 兜底：这个模块绝不能让装配失败（fail-open）
            log(`按 scope 过滤时出错，原样放行：${e instanceof Error ? e.message : String(e)}`);
            return settled;
        }
    });
}
//# sourceMappingURL=tool-scoping.js.map