import { ConnectionManager } from './core/connection-manager.js';
import { ConnectionEventBus } from './core/event-bus.js';
import { Persistence } from './core/persistence.js';
import { DSHAdapter } from './adapter/dsh-adapter.js';
import { createStableApi } from './adapter/stable-api.js';
import { CardHost } from './card-host/loader.js';
export const name = 'connection-card-host';
export const inject = [];
export function apply(ctx, _config) {
    try {
        // 初始化核心模块（先建 EventBus，因为 DSHAdapter 需要白名单检查函数）
        const persistence = new Persistence();
        const eventBus = new ConnectionEventBus();
        const manager = new ConnectionManager(persistence, eventBus);
        // 审计日志：写入 $DSH_HOME/connection-cards/audit.log
        const auditLog = (msg) => {
            try {
                const { appendFileSync, mkdirSync } = require('node:fs');
                const { join } = require('node:path');
                const auditFile = join(persistence.baseDir(), 'audit.log');
                appendFileSync(auditFile, `[${new Date().toISOString()}] ${msg}\n`);
            }
            catch { /* 日志失败静默 */ }
        };
        // 适配层（注入白名单检查函数 + 审计日志）
        const adapter = new DSHAdapter(ctx, {
            whitelistCheck: (connId, method) => manager.whitelist.isAllowed(connId, method),
            auditLog,
        });
        const versionCheck = adapter.init();
        if (!versionCheck.supported) {
            ctx.logger?.warn?.(`[${name}] DSH version ${versionCheck.current} outside supported range ${versionCheck.range}. Running in degraded mode.`);
        }
        // 卡片宿主（连接卡片运行时）
        const cardHost = new CardHost(manager, eventBus, adapter, {
            cardHomeRoot: persistence.baseDir(), // $DSH_HOME/connection-cards
        });
        // 创建稳定 API 并挂载到 ctx
        const service = createStableApi(manager, eventBus, cardHost);
        ctx.connectionCardHost = service;
        // 同时通过 ctx.set 暴露（兼容远程访问）
        try {
            ctx.set?.('connectionCardHost', service);
        }
        catch {
            // ctx.set 可能不存在于某些环境
        }
        ctx.logger?.info?.(`[${name}] initialized (${manager.getAll().length} connections restored)`);
    }
    catch (e) {
        console.error(`[${name}] apply failed:`, e);
        ctx.logger?.error?.(`[${name}] apply failed: ${String(e)}`);
    }
}
//# sourceMappingURL=index.js.map