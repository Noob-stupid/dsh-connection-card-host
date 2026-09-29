/**
 * 权限级别定义
 * - read: 只读，可观察对端状态
 * - suggest: 建议，可向对端发送建议但不强制执行
 * - write: 写入，可通过 requestRemote 在对端执行操作
 */
export type PermissionLevel = 'read' | 'suggest' | 'write';
export declare const PERMISSION_ORDER: Record<PermissionLevel, number>;
export declare function permValue(level: PermissionLevel): number;
export declare function permFromValue(value: number): PermissionLevel;
