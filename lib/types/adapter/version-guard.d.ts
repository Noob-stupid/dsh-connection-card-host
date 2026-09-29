/**
 * DSH 版本守卫 — 启动时检查当前 DSH 版本是否在支持范围内。
 * 不支持则降级并提示，卡片不直接调用 DSH。
 */
export interface VersionCheckResult {
    supported: boolean;
    current: string;
    range: string;
}
export declare function checkVersion(currentVersion: string): VersionCheckResult;
