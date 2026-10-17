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
/** 列表用的会话摘要（面板里的会话选择器）。 */
export interface KnownSession {
    id: string;
    title: string;
    updatedAt: number;
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
    /**
     * 列出宿主当前已知的会话（面板的会话选择器用）。
     *
     * 走宿主 `ctx.sessions.list()`（其目录里确有该方法）。
     * Session 的字段形状未在我们的依赖里声明，因此**逐字段防御式提取**，
     * 拿不到标题就退回 id —— 绝不因为字段名猜错而整体失败。
     */
    listSessions(): KnownSession[];
    getSessionStatus(sessionId: string): Promise<SessionStatus>;
    /**
     * **未实现 —— 如实报错，不返回假数据** ✓
     *
     * ⚠️ 这两个方法原来是**谎报**的 ✗：
     *
     *     getSessionLog   ⇒ return []                      // 看起来像"没有日志" ✗
     *     getPresetStatus ⇒ return { healthy: true, … }     // 看起来像"一切正常" ✗✗
     *
     * 第二条尤其糟 ✓：卡片问"预设健康吗" ⇒ 我们答"健康" ✗ —— 而**我们根本不知道** ✓。
     * 调用方会据此**跳过修复** ✓，用户看到的是"没问题"，实际可能已经坏了 ✗。
     * 这正是本仓库反复出现的那条：**"我不知道"必须与"没问题"分开** ✓
     * （同族：`unknown` 归因桶 ✓ / `unavailable` 状态 ✓ / 清理三档 ✓）。
     *
     * ⇒ 现在**抛错**并说清"未实现" ✓：调用方要么处理 ✓，要么**响亮地失败** ✓ ——
     * 两者都比"拿到一个错的答案"好 ✓。等真接上 DSH 的 API 再把这里换成实现 ✓。
     */
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
