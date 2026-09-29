/**
 * DSH 版本守卫 — 启动时检查当前 DSH 版本是否在支持范围内。
 * 不支持则降级并提示，卡片不直接调用 DSH。
 */
const SUPPORTED_RANGE = '>=0.1.1-rc.2 <0.3.0';
/**
 * 简单 semver 范围检查（仅支持 >=X.Y.Z 和 <X.Y.Z 的组合）。
 * 实际项目中可用 semver 库，此处为避免额外依赖而内联。
 */
function parseVersion(v) {
    const m = v.replace(/-.*$/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m)
        return null;
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}
function gte(a, b) {
    if (a[0] !== b[0])
        return a[0] > b[0];
    if (a[1] !== b[1])
        return a[1] > b[1];
    return a[2] >= b[2];
}
function lt(a, b) {
    if (a[0] !== b[0])
        return a[0] < b[0];
    if (a[1] !== b[1])
        return a[1] < b[1];
    return a[2] < b[2];
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
export function checkVersion(currentVersion) {
    const display = currentVersion && currentVersion.length > 0 ? currentVersion : 'unknown';
    const current = currentVersion ? parseVersion(currentVersion) : null;
    const minVer = parseVersion('0.1.1');
    const maxVer = parseVersion('0.3.0');
    if (!current || !minVer || !maxVer) {
        return { supported: true, current: display, range: SUPPORTED_RANGE };
    }
    const supported = gte(current, minVer) && lt(current, maxVer);
    return { supported, current: display, range: SUPPORTED_RANGE };
}
//# sourceMappingURL=version-guard.js.map