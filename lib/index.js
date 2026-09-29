/**
 * dsh-connection-card-host — 宿主端入口。
 *
 * 挂载连接管理器、事件总线、适配层、卡片宿主；
 * 并通过 DSH 官方 Connection RPC 通道（ctx.connection.rpc）把服务暴露给浏览器半。
 */
import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionManager } from './core/connection-manager.js';
import { ConnectionEventBus } from './core/event-bus.js';
import { Persistence } from './core/persistence.js';
import { DSHAdapter } from './adapter/dsh-adapter.js';
import { createStableApi } from './adapter/stable-api.js';
import { registerRpcBridge } from './adapter/rpc-bridge.js';
import { CardHost } from './card-host/loader.js';
import { safeCtxGet } from './safe-ctx.js';
export const name = 'connection-card-host';
/**
 * 诊断日志：写到插件目录旁的 host-debug.log（绝对路径，不受 DSH_HOME 影响）。
 * 桥接问题排查用；路径固定在仓库内，便于开发期读取。
 */
const DEBUG_LOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'host-debug.log');
function debug(msg) {
    try {
        appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
    }
    catch {
        // 诊断失败不影响业务
    }
}
/**
 * 不声明必需依赖：核心能力（连接管理/持久化/卡片宿主）独立于 connection 服务，
 * 只有 RPC 桥需要它。用 ctx.inject() 延迟注册，避免 connection 缺席时整个插件不加载。
 */
export const inject = [];
/**
 * 对外提供的服务名。必须在此声明，否则 `ctx.provide()` 会抛
 * `cannot set property "x" without provide`。
 */
export const provide = ['connectionCardHost'];
export function apply(ctx, _config) {
    debug('apply: entered');
    try {
        // 初始化核心模块（先建 EventBus，因为 DSHAdapter 需要白名单检查函数）
        const persistence = new Persistence();
        debug(`apply: persistence ready baseDir=${persistence.baseDir()}`);
        const eventBus = new ConnectionEventBus();
        const manager = new ConnectionManager(persistence, eventBus);
        debug(`apply: manager ready (${manager.getAll().length} restored)`);
        // 审计日志：写入 $DSH_HOME/connection-cards/audit.log
        const auditFile = join(persistence.baseDir(), 'audit.log');
        const auditLog = (msg) => {
            try {
                appendFileSync(auditFile, `[${new Date().toISOString()}] ${msg}\n`);
            }
            catch (e) {
                debug(`auditLog 写入失败: ${String(e)}`);
            }
        };
        // 浏览器半的诊断上报：单独文件，避免与宿主审计混在一起。
        // 浏览器里读不到 console，拖拽这类交互问题只能靠它落盘。
        const clientLogFile = join(persistence.baseDir(), 'client-debug.log');
        const clientLog = (msg) => {
            try {
                appendFileSync(clientLogFile, `[${new Date().toISOString()}] ${msg}\n`);
            }
            catch {
                /* 诊断失败不影响业务 */
            }
        };
        // 适配层（注入白名单检查函数 + 审计日志）
        const adapter = new DSHAdapter(ctx, {
            whitelistCheck: (connId, method) => manager.whitelist.isAllowed(connId, method),
            auditLog,
        });
        const versionCheck = adapter.init();
        debug(`apply: adapter ready supported=${versionCheck.supported}`);
        if (!versionCheck.supported) {
            ctx.logger?.warn?.(`[${name}] DSH version ${versionCheck.current} outside supported range ${versionCheck.range}. Running in degraded mode.`);
        }
        // 卡片宿主（连接卡片运行时）
        // 内置卡片随插件发布在包根的 cards/；用户安装的放在 $DSH_HOME/connection-cards/cards/
        const cardHost = new CardHost(manager, eventBus, adapter, {
            installedRoot: join(persistence.baseDir(), 'cards'),
        });
        debug('apply: cardHost ready');
        // 启动重放：连接是从 connections.json 恢复的，卡片挂在连接上，
        // 但 apply()（事件订阅 / 工具注册）不会自动重跑 —— 不重放卡片就是"哑"的。
        void cardHost
            .restoreAll()
            .then((n) => {
            if (n > 0)
                debug(`apply: 重放卡片 ${n} 张`);
        })
            .catch((e) => debug(`apply: 重放卡片失败 ${String(e)}`));
        // 稳定 API
        const service = createStableApi(manager, eventBus, cardHost, adapter);
        // 必须走 ctx.provide（不是直接赋值）：cordis 服务由 fiber 持有生命周期，
        // 直接 `ctx.connectionCardHost = ...` 会抛 cannot set ... without provide。
        // 热重载时旧 fiber 可能尚未释放同名服务，此时视为已就绪即可（幂等）。
        const provideFn = safeCtxGet(ctx, 'provide');
        if (typeof provideFn === 'function') {
            try {
                provideFn('connectionCardHost', service);
                debug('apply: service provided via ctx.provide');
            }
            catch (e) {
                debug(`apply: ctx.provide 跳过（${e instanceof Error ? e.message : String(e)}）`);
            }
        }
        else {
            debug('apply: ctx.provide 不可用，跳过服务暴露');
        }
        // 浏览器半的唯一通道：Connection RPC。
        // connection 是核心插件、通常在 apply 时就绪 —— 直接注册；
        // 若尚未就绪则用 ctx.inject 等它出现（cordis 会在服务消失时回滚 effect）。
        // ⚠️ 必须用 safeCtxGet：直接读未声明的服务属性会让 cordis 代理抛异常。
        const connection = safeCtxGet(ctx, 'connection');
        const hasConnection = Boolean(connection);
        debug(`apply: ctx.connection=${hasConnection ? 'ready' : 'absent'}`);
        auditLog(`apply: ctx.connection ${hasConnection ? 'ready' : 'absent'}`);
        const bridgeLogger = {
            info: (m) => {
                debug(m);
                ctx.logger?.info?.(m);
            },
            warn: (m) => {
                debug(m);
                ctx.logger?.warn?.(m);
            },
        };
        if (hasConnection) {
            const dispose = registerRpcBridge(ctx, service, {
                logger: bridgeLogger,
                audit: auditLog,
                clientLog,
            });
            if (dispose)
                ctx.effect(() => dispose, 'connection-card-host: rpc channel');
            debug(`apply: direct bridge done (dispose=${dispose ? 'yes' : 'no'})`);
        }
        else {
            // rpc.handle 内部会 `owner.webServer.register(route)`，
            // 因此 webServer 必须一起注入，否则抛 cannot get property "webServer" without inject。
            debug('apply: 走 ctx.inject 等待 connection + webServer');
            ctx.inject(['connection', 'webServer'], (scope) => {
                debug('inject: connection/webServer 就绪，注册桥');
                const dispose = registerRpcBridge(scope, service, {
                    logger: bridgeLogger,
                    audit: auditLog,
                    clientLog,
                });
                if (dispose)
                    scope.effect(() => dispose, 'connection-card-host: rpc channel');
                debug(`inject: bridge done (dispose=${dispose ? 'yes' : 'no'})`);
            });
        }
        ctx.logger?.info?.(`[${name}] initialized (${manager.getAll().length} connections restored)`);
    }
    catch (e) {
        debug(`apply: THREW ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`);
        console.error(`[${name}] apply failed:`, e);
        ctx.logger?.error?.(`[${name}] apply failed: ${String(e)}`);
    }
}
//# sourceMappingURL=index.js.map