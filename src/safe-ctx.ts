/**
 * cordis 上下文的安全读取。
 *
 * cordis 的 Context 是 Proxy：读取**未在 `inject` 中声明**的服务属性会
 * 抛出 `cannot get property "x" without inject`，而不是返回 `undefined`。
 * 因此 `ctx.x?.y` 这种写法同样会抛 —— 必须用 try/catch 包住。
 *
 * 纯 JS，无 Node 依赖，宿主半与浏览器半共用。
 */

/**
 * 读取上下文上的一个属性；属性不存在或未声明时返回 undefined。
 *
 * @param ctx - cordis 上下文（或任意对象）
 * @param key - 属性/服务名
 */
export function safeCtxGet<T>(ctx: unknown, key: string): T | undefined {
  try {
    const holder = ctx as Record<string, unknown> | null | undefined
    if (!holder) return undefined
    const value = holder[key]
    return (value ?? undefined) as T | undefined
  } catch {
    // 未声明的服务：cordis 代理抛错，视同不可用
    return undefined
  }
}

/** 读取上下文上的一个方法，确保是函数；否则返回 undefined。 */
export function safeCtxMethod<F extends (...args: never[]) => unknown>(
  ctx: unknown,
  key: string,
): F | undefined {
  const value = safeCtxGet<unknown>(ctx, key)
  return typeof value === 'function' ? (value as F) : undefined
}
