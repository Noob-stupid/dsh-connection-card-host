/**
 * DSH 版本守卫 — 启动时检查当前 DSH 版本是否在支持范围内。
 * 不支持则降级并提示，卡片不直接调用 DSH。
 */
const SUPPORTED_RANGE = '>=0.1.1-rc.2 <0.2.0';
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
export function checkVersion(currentVersion) {
    const current = parseVersion(currentVersion);
    const minVer = parseVersion('0.1.1');
    const maxVer = parseVersion('0.2.0');
    if (!current || !minVer || !maxVer) {
        return { supported: false, current: currentVersion, range: SUPPORTED_RANGE };
    }
    const supported = gte(current, minVer) && lt(current, maxVer);
    return { supported, current: currentVersion, range: SUPPORTED_RANGE };
}
//# sourceMappingURL=version-guard.js.map