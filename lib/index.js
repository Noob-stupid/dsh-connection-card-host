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
import { ConventionBox } from './core/box.js';
import { WorkStateTracker } from './core/work-state.js';
import { registerAwarenessTools } from './tools/awareness-tools.js';
import { installToolScoping } from './core/tool-scoping.js';
import { registerRpcBridge } from './adapter/rpc-bridge.js';
import { CardHost } from './card-host/loader.js';
import { SessionBridge } from './adapter/session-bridge.js';
import { ConnectionRelay } from './core/relay.js';
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
 * 必需依赖。
 *
 * ⚠️ cordis 的 Context 是 Proxy：**未在此声明的服务读不到**（读会抛，
 * safeCtxGet 会把它变成 undefined）。所以要用 ctx.agents / ctx.sessions /
 * ctx.tools 就必须在这里声明，否则能力探测会误报"不可用"。
 *
 * `agents` 与 `sessions` 两个版本都有；`sessionController` 仅 runtime 0.2+ 有，
 * 因此**不放进这个数组**（否则 checkout 上插件直接不加载），
 * 改用 ctx.inject(['sessionController'], ...) 作可选增强。
 */
export const inject = ['agents', 'sessions', 'tools'];
/**
 * 对外提供的服务名。必须在此声明，否则 `ctx.provide()` 会抛
 * `cannot set property "x" without provide`。
 */
export const provide = ['connectionCardHost'];
export function apply(ctx, _config) {
    /*
     * 本次装配的短标识。
     *
     * 为什么需要：同一个插件被装配两次时（比如 profile 里新旧两个名字都声明了、
     * 或者 bundle 装配 + 注入装配并存），日志里会出现**两条一模一样的错误** ——
     * `tool "connection_send" is already registered` 连出现三次，
     * 根本分不清哪条来自哪个实例、哪次 apply。加个短标识就能对上号。
     */
    const applyTag = Math.random().toString(36).slice(2, 8);
    debug(`apply: entered [${applyTag}]`);
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
        // 会话桥 + 中继：「A 说话 B 能感知」。
        //   observe: ctx.on('session/event') —— 宿主级监听收到【所有会话】的事件
        //   deliver: ctx.agents.get(id) → agent.followup(msg) —— 投递并唤醒对端
        // 必须在 createStableApi 之前建好（稳定 API 要把桥暴露给 RPC）。
        // 协作感知的两层底座：
        //   WorkStateTracker —— 采集「在干什么」（自动，易变）
        //   ConventionBox    —— 共享「说好了什么」（显式，持久）
        // 二者都**只存不发**，由使用方按需拉取（工具查询 / 面板），不占对方上下文。
        //
        // ⚠️ 顺序有讲究：`workState` 必须**先建** —— 下面 SessionBridge 要拿它当
        // **抢占式中断的安全探针**（"这个会话此刻有没有工具在执行"）。
        // 放在后面就会出现"桥要用还没建好的跟踪器"，只能靠闭包绕过 TDZ，不干净。
        const workState = new WorkStateTracker(auditLog);
        const box = new ConventionBox();
        const bridge = new SessionBridge(ctx, auditLog, 
        // 探针：true = 有工具在跑（或状态未知）→ 抢占不打断。
        // 构造函数里说明了"不传就永不抢占"的保守默认。
        (sid) => workState.busyWithTool(sid));
        const relay = new ConnectionRelay(manager, bridge, auditLog);
        manager.attachBox(box);
        // 工具事件、步骤推进都在原始流里 —— observe() 只放行发言，会把它们丢掉
        ctx.effect(() => bridge.observeRaw((sessionId, event) => workState.ingest(sessionId, event)), 'connection-card-host: work-state collector');
        const caps = bridge.capabilities();
        debug(`relay: observe=${caps.observe} deliver=${caps.deliver} via=[${caps.via.join(', ')}]`);
        auditLog(`relay 能力: observe=${caps.observe} deliver=${caps.deliver} via=[${caps.via.join(', ')}]`);
        for (const note of caps.notes) {
            debug(`relay 提示: ${note}`);
            auditLog(`relay 提示: ${note}`);
        }
        relay.start();
        ctx.effect(() => () => {
            relay.stop();
            bridge.dispose();
        }, 'connection-card-host: session relay');
        // 冷会话唤醒通道：`sessionController` 只在 runtime 0.2+ 有，
        // 放进静态 inject 会让插件在旧版本上直接不加载，所以用可选的 ctx.inject。
        //
        // 拿到它之后，投递给「未打开的对端会话」会自动 resume 该会话 ——
        // 即「A 说话 → B 被唤醒上线 → B 处理」，而不是投递失败。
        // （cordis 是 Proxy：没声明过的服务读不到，所以这一步是必需的，不是优化。）
        ctx.inject(['sessionController'], (scope) => {
            bridge.attachControllerContext(scope);
            const caps2 = bridge.capabilities();
            debug(`relay 能力（接入后）: via=[${caps2.via.join(', ')}]`);
            auditLog(`relay 能力（接入后）: via=[${caps2.via.join(', ')}]`);
            for (const note of caps2.notes)
                auditLog(`relay 提示: ${note}`);
        });
        // 稳定 API
        const service = createStableApi(manager, eventBus, cardHost, adapter, bridge, { workState, box }, auditLog, relay);
        // 协作感知工具（拉取式：模型按需查，不占常驻上下文）
        //
        // ⚠️ 这一段**必须容错**（2026-10-02 修）。
        //
        // 原来它是裸调用，而 `apply` 只有一个兜底 try/catch 在**最末尾** ——
        // 于是"工具重复注册"这种局部失败会**跳过它后面的全部初始化**，
        // 其中就包括 RPC 桥（面板的唯一通道）与卡片宿主。
        // 现场证据：`apply: THREW tool "connection_send" is already registered`
        // 抛在 lib/index.js:163，随后该实例处于**半装配**状态 ——
        // 用户看到"连接消息渲染成纯文本"正是卡片宿主没装上的表现。
        //
        // 一个工具注册失败，不该让整个插件废掉。
        try {
            const toolsService = safeCtxGet(ctx, 'tools');
            if (toolsService?.register) {
                const disposeTools = registerAwarenessTools(toolsService, { service, auditLog });
                ctx.effect(() => () => disposeTools(), 'connection-card-host: awareness tools');
                debug('apply: 感知工具已注册（connection_peer_work / connection_conventions / connection_declare）');
            }
            else {
                debug('apply: ctx.tools 不可用，跳过感知工具注册');
            }
        }
        catch (e) {
            const m = `感知工具注册失败（继续，不影响卡片与面板）：${e instanceof Error ? e.message : String(e)}`;
            debug(`apply: ${m}`);
            // 用 audit 而不是只 debug：这类失败会让模型少几个工具，属于要留痕的事
            auditLog(m);
        }
        /*
         * 按会话 scope 隐藏感知工具 —— 没参与连接的会话不该背约 1700 tokens 的 schema。
         *
         * 走官方 `system-prompt/assemble` waterfall（它本身是 scope-filtered）。
         * 契约照抄 dsh-tool-search 的实际用法（`ctx.on(event, (assembly, context, next) => ...)`），
         * 不是猜的。整条链路 fail-open：拿不准就原样下发。
         */
        const on = safeCtxGet(ctx, 'on');
        if (typeof on === 'function') {
            try {
                const disposeScoping = installToolScoping(on.bind(ctx), {
                    getConnectionsBySession: (sid) => service.getConnectionsBySession(sid),
                    audit: auditLog,
                    debug,
                });
                ctx.effect(() => () => disposeScoping(), 'connection-card-host: tool scoping');
                debug('apply: 已挂 system-prompt/assemble（按会话 scope 隐藏感知工具）');
            }
            catch (e) {
                debug(`apply: 挂 tool scoping 失败（忽略，工具照常全局下发）：${e instanceof Error ? e.message : String(e)}`);
            }
        }
        else {
            debug('apply: ctx.on 不可用，跳过 tool scoping');
        }
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
        /*
         * 浏览器半的唯一通道：Connection RPC。
         * connection 是核心插件、通常在 apply 时就绪 —— 直接注册；
         * 若尚未就绪则用 ctx.inject 等它出现（cordis 会在服务消失时回滚 effect）。
         * ⚠️ 必须用 safeCtxGet：直接读未声明的服务属性会让 cordis 代理抛异常。
         *
         * ⚠️ 这一段也**必须容错**（2026-10-02）：它是面板的命脉，不该被任何
         * 前序段落的失败连累。反过来说，它自己失败也不该让 apply 中断 ——
         * 后面还有收尾日志。
         */
        try {
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
        }
        catch (e) {
            const m = `RPC 桥注册失败（面板将不可用，其余功能仍在）：${e instanceof Error ? e.message : String(e)}`;
            debug(`apply: ${m}`);
            auditLog(m);
        }
        ctx.logger?.info?.(`[${name}] initialized (${manager.getAll().length} connections restored)`);
    }
    catch (e) {
        // 带上 applyTag：日志里同形态的错有多条时，能分清来自哪个实例/哪次装配
        debug(`apply: THREW [${applyTag}] ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`);
        console.error(`[${name}] apply failed [${applyTag}]:`, e);
        ctx.logger?.error?.(`[${name}] apply failed [${applyTag}]: ${String(e)}`);
    }
}
//# sourceMappingURL=index.js.map