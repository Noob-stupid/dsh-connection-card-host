import { checkVersion } from './version-guard.js';
export class DSHAdapter {
    ctx;
    versionResult = null;
    whitelistCheck;
    auditLog;
    constructor(ctx, options) {
        this.ctx = ctx;
        this.whitelistCheck = options?.whitelistCheck;
        this.auditLog = options?.auditLog;
    }
    /** 启动时调用，检查 DSH 版本兼容性 */
    init() {
        // 尝试从 ctx 获取版本号
        const version = this.ctx.dsh?.version ?? '0.1.1-rc.2';
        this.versionResult = checkVersion(version);
        if (!this.versionResult.supported) {
            console.warn(`[DSHAdapter] DSH version ${this.versionResult.current} not in supported range ${this.versionResult.range}. Running in degraded mode.`);
        }
        return this.versionResult;
    }
    getVersionCheck() {
        return this.versionResult ?? this.init();
    }
    async getSessionStatus(sessionId) {
        try {
            const sessions = this.ctx.sessions;
            if (sessions?.get) {
                const s = await sessions.get(sessionId);
                if (s)
                    return { id: sessionId, title: s.title ?? '', status: s.status ?? 'unknown', updatedAt: s.updatedAt ?? 0 };
            }
        }
        catch (e) {
            console.error('[DSHAdapter] getSessionStatus failed:', e);
        }
        return { id: sessionId, title: '', status: 'unknown', updatedAt: 0 };
    }
    async getSessionLog(_sessionId) {
        // TODO: 对接 DSH session log API
        return [];
    }
    async getPresetStatus(_sessionId) {
        // TODO: 对接 DSH preset status API
        return { presetId: '', healthy: true, errors: [] };
    }
    /**
     * requestRemote — 在对端会话执行操作（安全白名单机制）。
     * 超时 30s，不自动重试，白名单外方法拒绝，全部审计日志。
     */
    async requestRemote(sessionId, method, params, connectionId) {
        // 白名单校验（如果提供了 connectionId 和白名单检查函数）
        if (connectionId && this.whitelistCheck) {
            if (!this.whitelistCheck(connectionId, method)) {
                this.auditLog?.(`requestRemote 拒绝（白名单外）: ${connectionId}.${method}`);
                return { error: 'whitelist_violation', message: `方法 ${method} 不在白名单中` };
            }
        }
        const timeoutMs = 30_000;
        this.auditLog?.(`requestRemote 调用: ${sessionId}.${method}`);
        try {
            const remote = this.ctx.remote;
            if (remote?.call) {
                const result = await Promise.race([
                    remote.call(sessionId, method, params),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
                ]);
                this.auditLog?.(`requestRemote 成功: ${sessionId}.${method}`);
                return result;
            }
        }
        catch (e) {
            if (e.message === 'timeout') {
                this.auditLog?.(`requestRemote 超时: ${sessionId}.${method}`);
                return { error: 'timeout' };
            }
            this.auditLog?.(`requestRemote 失败: ${sessionId}.${method} ${String(e)}`);
            console.error(`[DSHAdapter] requestRemote failed for ${sessionId}.${method}:`, e);
        }
        return { error: 'not_available' };
    }
    async repairPreset(_sessionId) {
        // TODO: 对接 dsh-plugin-gating-hub 或内置修复逻辑
        return { success: false, message: 'repair not implemented' };
    }
    onSessionEvent(handler) {
        // 订阅 DSH 全局会话事件，过滤后转发
        const off = this.ctx.on?.('session/event', (data) => {
            if (data?.sessionId && data?.event) {
                handler(data.sessionId, data.event, data.payload);
            }
        });
        return typeof off === 'function' ? off : () => { };
    }
}
//# sourceMappingURL=dsh-adapter.js.map