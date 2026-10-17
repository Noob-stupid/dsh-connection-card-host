/**
 * **统一日志出口**（宿主侧）。
 *
 * ## 为什么需要它（P1-1 的第一性理由）
 *
 * 原先各模块直接 `console.*` ✗ —— 后果在真机上吃过一次亏：
 * 用户报"连线不画"时，**诊断信息全在浏览器控制台** ✓，
 * 而用户（和我）手里只有 `client-debug.log` / 审计日志 ✗ ⇒ 查了半天 ✓。
 *
 * 一句判据：**日志写到哪里，决定了"出事时谁能看到它"** ✓ ——
 * 写 `console` 等于"只写给正开着 devtools 的人看" ✗，而那通常不是用户 ✓。
 *
 * ## 形态：**可注入的出口（sink）**，而不是把 logger 传遍每个函数
 *
 * 传 logger 参数会污染几十个签名 ✗、且每加一个模块都要改调用链 ✗。
 * 这里用一个**进程级 sink** ✓：
 *
 *     · 宿主在 `src/index.ts` 里注册 sink ✓ ⇒ 写**插件自己的 debug 日志 + 审计** ✓
 *     · 没注册时**退回 console** ✓（库被单独引用、或单测里 ✓ —— 不能因为没 sink 就静默 ✗）
 *
 * ⚠️ **"没注册就静默"是反模式** ✗：那会让"日志没写进去"和"根本没发生"长得一样 ✓
 * （与"拒绝文案的价值 = 让用户知道下一步该不该做"同一条 ✓）。
 */
export type LogLevel = 'info' | 'warn' | 'error';
/** 出口签名：`level` + 已格式化的一条消息 ✓。 */
export type LogSink = (level: LogLevel, message: string) => void;
/**
 * 注册出口（传 `undefined` 恢复默认的 console 兜底 ✓）。
 *
 * 返回**反注册函数** ✓ —— 便于插件卸载/测试隔离时不留下全局副作用 ✓。
 */
export declare function setLogSink(next: LogSink | undefined): () => void;
/** 写一条日志 ✓（有 sink 走 sink，没有就退回 console ✓）。 */
export declare function log(level: LogLevel, ...args: unknown[]): void;
/** 便捷包装（读起来更短 ✓）。 */
export declare const logInfo: (...args: unknown[]) => void;
export declare const logWarn: (...args: unknown[]) => void;
export declare const logError: (...args: unknown[]) => void;
/** 诊断用：当前有没有注册出口 ✓（测试与自检用 ✓）。 */
export declare function hasLogSink(): boolean;
