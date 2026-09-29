/**
 * DSH 版本守卫 — 启动时检查当前 DSH 版本是否在支持范围内。
 * 不支持则降级并提示，卡片不直接调用 DSH。
 */
export interface VersionCheckResult {
    supported: boolean;
    current: string;
    range: string;
}
/**
 * 检查 DSH 版本是否在支持范围内。
 *
 * 传 undefined / 不可解析的版本时 **fail-open**（返回 supported: true）——
 * 真实的兼容性判断应由**能力探测**负责（例如 ctx.connection.rpc 是否存在），
 * 而不是一个我们在运行时未必拿得到的版本字符串。宁可放行并在能力缺失时降级，
 * 也不要因版本探测失败就整体禁用。
 *
 * @param currentVersion - 探测到的版本；拿不到时传 undefined
 */
export declare function checkVersion(currentVersion?: string): VersionCheckResult;
