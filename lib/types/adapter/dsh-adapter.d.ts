/**
 * DSHAdapter — 所有 DSH 交互的中间层。
 * 卡片永远不直接调用 DSH；DSH 升级时只改此文件。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type VersionCheckResult } from './version-guard.js';
export interface SessionStatus {
    id: string;
    title: string;
    status: string;
    updatedAt: number;
}
export interface SessionLogEntry {
    timestamp: number;
    role: string;
    content: string;
}
export interface PresetStatus {
    presetId: string;
    healthy: boolean;
    errors: string[];
}
export interface RepairResult {
    success: boolean;
    message: string;
}
type SessionEventHandler = (sessionId: string, event: string, data: unknown) => void;
export declare class DSHAdapter {
    private ctx;
    private versionResult;
    private whitelistCheck?;
    private auditLog?;
    constructor(ctx: Context, options?: {
        whitelistCheck?: (connectionId: string, method: string) => boolean;
        auditLog?: (msg: string) => void;
    });
    /**
     * 启动时调用，检查 DSH 版本兼容性。
     *
     * ⚠️ 不要在 cordis 上下文上直接读未声明的服务：Context 是 Proxy，
     * 读未 inject 的属性会抛 `cannot get property "x" without inject`。
     * 一律经 safeCtxGet。
     */
    init(): VersionCheckResult;
    /** 尽力探测 DSH 版本；拿不到就返回 undefined（守卫会 fail-open）。 */
    private detectVersion;
    getVersionCheck(): VersionCheckResult;
    getSessionStatus(sessionId: string): Promise<SessionStatus>;
    getSessionLog(_sessionId: string): Promise<SessionLogEntry[]>;
    getPresetStatus(_sessionId: string): Promise<PresetStatus>;
    /**
     * requestRemote — 在对端会话执行操作（安全白名单机制）。
     * 超时 30s，不自动重试，白名单外方法拒绝，全部审计日志。
     */
    requestRemote(sessionId: string, method: string, params: unknown, connectionId?: string): Promise<unknown>;
    repairPreset(_sessionId: string): Promise<RepairResult>;
    onSessionEvent(handler: SessionEventHandler): () => void;
}
export {};
