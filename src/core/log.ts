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

export type LogLevel = 'info' | 'warn' | 'error'

/** 出口签名：`level` + 已格式化的一条消息 ✓。 */
export type LogSink = (level: LogLevel, message: string) => void

let sink: LogSink | undefined

/**
 * 注册出口（传 `undefined` 恢复默认的 console 兜底 ✓）。
 *
 * 返回**反注册函数** ✓ —— 便于插件卸载/测试隔离时不留下全局副作用 ✓。
 */
export function setLogSink(next: LogSink | undefined): () => void {
  const prev = sink
  sink = next
  return () => {
    sink = prev
  }
}

/** 把任意参数拼成一条消息（尽量不丢信息 ✓）。 */
function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.message}${a.stack ? `\n${a.stack}` : ''}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

/** 写一条日志 ✓（有 sink 走 sink，没有就退回 console ✓）。 */
export function log(level: LogLevel, ...args: unknown[]): void {
  const message = format(args)
  if (sink) {
    try {
      sink(level, message)
      return
    } catch {
      /* 出口自己坏了：**仍然要留下痕迹** ✓（下面的 console 兜底） */
    }
  }
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(`[connection-card-host] ${message}`)
}

/** 便捷包装（读起来更短 ✓）。 */
export const logInfo = (...args: unknown[]): void => log('info', ...args)
export const logWarn = (...args: unknown[]): void => log('warn', ...args)
export const logError = (...args: unknown[]): void => log('error', ...args)

/** 诊断用：当前有没有注册出口 ✓（测试与自检用 ✓）。 */
export function hasLogSink(): boolean {
  return sink !== undefined
}
