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
import type { Connection } from '../types/index.js';
/** 供测试与排查用：临时开关。 */
export declare function setScopingEnabled(v: boolean): void;
export declare function isScopingEnabled(): boolean;
/** 这个模块需要的最小依赖面（避免和宿主类型耦合）。 */
export interface ScopingDeps {
    /** 按会话 id 查它参与了哪些连接。 */
    getConnectionsBySession(sessionId: string): Connection[];
    /** 写审计日志。 */
    audit(message: string): void;
    /** 调试日志（默认静默）。 */
    debug?(message: string): void;
}
/** 一次装配的形态（只用到 tools）。 */
interface Assembly {
    tools?: {
        name?: string;
    }[];
    [k: string]: unknown;
}
/**
 * 一次装配该不该过滤。
 *
 * 拆成纯函数是为了**可离线断言** —— 不依赖真实 agent/会话就能覆盖各种情况。
 *
 * @returns `filter: true` 表示要摘掉感知工具；否则原样下发
 */
export declare function decideFilter(context: unknown, deps: Pick<ScopingDeps, 'getConnectionsBySession'>): {
    filter: boolean;
    reason: string;
    sessionId?: string;
};
/**
 * 摘掉感知工具。
 *
 * 只动 `connection_` 前缀的，**绝不碰别人的工具**。
 * 若过滤后工具列表为空（说明判断错了，或这个会话本来就只有这些工具），
 * 也**放弃过滤** —— 让模型面对空工具面比多几个工具更糟。
 */
export declare function filterAssembly(assembly: Assembly): {
    assembly: Assembly;
    removed: number;
};
/**
 * 挂到 `system-prompt/assemble` waterfall 上。
 *
 * @param on - 注册监听（传 `ctx.on`）
 * @returns 注销函数
 */
export declare function installToolScoping(on: (event: string, handler: (...args: unknown[]) => unknown) => () => void, deps: ScopingDeps): () => void;
export {};
