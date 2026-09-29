import { safeCtxGet, safeCtxMethod } from '../safe-ctx.js';
/** 从 ContentBlock[] 里抽纯文本（块类型未知的用 [type] 占位）。 */
function textOfBlocks(content) {
    if (!Array.isArray(content))
        return '';
    return content
        .map((block) => {
        const b = block;
        if (b?.type === 'text' && typeof b.text === 'string')
            return b.text;
        return typeof b?.type === 'string' ? `[${b.type}]` : '';
    })
        .filter((s) => s.length > 0)
        .join('');
}
/** 判断消息来源是不是我们自己投递的（防止 A→B→A 无限回环）。 */
function isFromPlugin(source) {
    const s = source;
    // 当前形状：producer-owned kind
    if (s?.kind === PLUGIN_SOURCE_KIND)
        return true;
    // 兼容旧形状（V3 的 `{ kind: 'plugin', plugin }` 包装）：
    // 老宿主/老日志里仍是这个形状，认出来才能继续防回环。
    return s?.kind === 'plugin' && s?.plugin === PLUGIN_SOURCE;
}
/** 投递时写的 source.plugin 标识，用于回环识别。 */
export const PLUGIN_SOURCE = 'dsh-connection-card-host';
/**
 * 投递时写进 `source.kind` 的 **producer-owned kind**。
 *
 * 会话消息格式升到 V4 后（框架 0.1.7-rc.1 起），每条被解释的消息 source
 * 都必须带一个「生产方自己的 kind」——非空、且**不能**是字面量 `'plugin'`
 * （那是已退役的 V3 包装）。写错这一个字，收端一开会话就报
 * `format v4 message requires a producer-owned source kind`，整个会话卡死。
 * 第三方插件的规范形状是 `plugin:<包名>`，与框架自带的 V3→V4 迁移器一致。
 */
export const PLUGIN_SOURCE_KIND = `plugin:${PLUGIN_SOURCE}`;
export class SessionBridge {
    ctx;
    listeners = new Set();
    off;
    auditLog;
    /** 记录本插件投递过的 sessionId，投递瞬间到达的 session/event 据此忽略。 */
    delivering = new Set();
    constructor(ctx, auditLog) {
        this.ctx = ctx;
        this.auditLog = auditLog ?? (() => { });
    }
    /** 能力探测：投递通道是否可用。 */
    capabilities() {
        const notes = [];
        const agents = safeCtxGet(this.ctx, 'agents');
        const controller = safeCtxGet(this.ctx, 'sessionController');
        const on = safeCtxMethod(this.ctx, 'on');
        const via = [];
        if (typeof controller?.prompt === 'function')
            via.push('sessionController.prompt');
        if (typeof agents?.get === 'function')
            via.push('agents.get + followup');
        // 读不到服务时给出可操作的原因，而不是笼统的"不可用"
        if (!agents) {
            notes.push('读不到 ctx.agents —— 需在插件 inject 里声明 "agents"（cordis 代理只放行已声明的服务）');
        }
        if (!controller) {
            notes.push('ctx.sessionController 读不到（未在 inject 声明，或该版本没有）——' +
                '不影响 agents 路径；冷会话投递才会用到它。');
        }
        return {
            observe: typeof on === 'function',
            deliver: via.length > 0,
            via,
            notes,
        };
    }
    /**
     * 开始观察所有会话的用户/助手消息。
     * @param handler 每条消息回调一次
     * @returns 停止观察
     */
    observe(handler) {
        this.listeners.add(handler);
        if (this.off)
            return () => { this.listeners.delete(handler); };
        const on = safeCtxMethod(this.ctx, 'on');
        if (!on) {
            this.auditLog('观察不可用：ctx.on 不存在');
            return () => { this.listeners.delete(handler); };
        }
        try {
            on('session/event', (...args) => {
                // 宿主级监听签名是 (session, event)
                const session = args[0];
                const event = args[1];
                if (!session || typeof session.id !== 'string' || !event)
                    return;
                const sessionId = session.id;
                const seq = typeof event.seq === 'number' ? event.seq : 0;
                let role = null;
                let text = '';
                if (event.type === 'user/message') {
                    // ⚠️ user/message 的 data **就是 UserMessage 本身**（不是 { message }）
                    const msg = event.data;
                    role = 'user';
                    text = textOfBlocks(msg?.content);
                    if (isFromPlugin(msg?.source)) {
                        // 我们自己投递进去的，不要再中继出去，否则 A→B→A 回环
                        return;
                    }
                }
                else if (event.type === 'assistant/message') {
                    // 其余消息类事件是 { message }
                    const d = event.data;
                    role = 'assistant';
                    text = textOfBlocks(d?.message?.content);
                }
                else {
                    return;
                }
                if (text.trim().length === 0)
                    return;
                const activity = { sessionId, role, text, seq, fromPlugin: false };
                for (const listener of [...this.listeners]) {
                    try {
                        listener(activity);
                    }
                    catch (e) {
                        this.auditLog(`观察回调抛错: ${String(e)}`);
                    }
                }
            });
            this.off = () => { this.listeners.clear(); };
            this.auditLog('观察已启动（session/event）');
        }
        catch (e) {
            this.auditLog(`观察订阅失败: ${String(e)}`);
        }
        return () => { this.listeners.delete(handler); };
    }
    /**
     * 把一段文本投递给某个会话，使其 agent 能感知。
     *
     * 三条路径按可靠性依次尝试：
     *   1. `ctx.sessionController.prompt({...})` —— runtime 官方入口，活/冷会话统一
     *   2. `ctx.agents.get(id).followup(msg)` —— 两个版本都有，但只对**内存里活着**的会话有效
     *   3. `agent.inject(msg)` —— 只入上下文不唤醒（followup 不可用时的兜底）
     *
     * @param sessionId 目标会话
     * @param text 文本
     * @param wake 是否唤醒对方（false = 只让它下次被唤醒时看到）
     */
    async deliver(sessionId, text, wake = true) {
        const content = [{ type: 'text', text }];
        // ① sessionController.prompt（仅 runtime 0.2+）
        const controller = safeCtxGet(this.ctx, 'sessionController');
        if (typeof controller?.prompt === 'function') {
            try {
                await controller.prompt({
                    sessionId,
                    content,
                    mode: wake ? 'queue' : 'steer',
                    requestId: `ccr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                });
                return { ok: true, via: 'sessionController' };
            }
            catch (e) {
                this.auditLog(`sessionController.prompt 失败，回退 agents: ${String(e)}`);
            }
        }
        // ② agents.get → followup / inject（两版本共有）
        const agents = safeCtxGet(this.ctx, 'agents');
        if (!agents?.get) {
            // 区分「服务读不到」和「会话不在内存」——这两种原因的修法完全不同
            return {
                ok: false,
                reason: '读不到 ctx.agents（cordis 代理只放行 inject 里声明过的服务）。' +
                    '请在插件 inject 中加入 "agents"。',
            };
        }
        const agent = agents.get(sessionId);
        if (!agent) {
            return {
                ok: false,
                reason: `会话 ${sessionId} 当前没有 live agent（未打开或已释放），无法投递。` +
                    '对端会话需要处于活跃状态才能感知。',
            };
        }
        // MessageId 是 brand（运行时就是字符串）；source 用 producer-owned kind 标注来源，
        // 既让对端知道"这来自连接中继"，也让本插件能识别并防回环。
        // ⚠️ 绝不能写 V3 的 `{ kind: 'plugin', plugin }`：V4 准入会直接拒绝整个会话。
        const message = {
            id: `ccr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            role: 'user',
            content,
            source: { kind: PLUGIN_SOURCE_KIND, form: 'relay', summary: '连接消息' },
        };
        if (wake && typeof agent.followup === 'function') {
            try {
                this.delivering.add(sessionId);
                agent.followup(message);
                this.auditLog(`投递成功（followup）→ ${sessionId}`);
                return { ok: true, via: 'agents.followup' };
            }
            catch (e) {
                this.auditLog(`followup 失败: ${String(e)}`);
            }
            finally {
                // 事件是同步发出的，下一帧清掉即可
                setTimeout(() => this.delivering.delete(sessionId), 0);
            }
        }
        if (typeof agent.inject === 'function') {
            try {
                agent.inject(message);
                this.auditLog(`投递成功（inject，不唤醒）→ ${sessionId}`);
                return { ok: true, via: 'agents.inject' };
            }
            catch (e) {
                return { ok: false, reason: `inject 失败: ${String(e)}` };
            }
        }
        return { ok: false, reason: '目标 agent 既没有 followup 也没有 inject，无法投递' };
    }
    /** 读取某会话最近的消息历史（诊断/工具用）。 */
    readRecent(sessionId, limit = 20) {
        const sessions = safeCtxGet(this.ctx, 'sessions');
        const session = sessions?.get?.(sessionId);
        if (!session)
            return [];
        try {
            // deriveMessages 已应用 surface 折叠与投影，是官方推荐的消息读取口
            if (typeof session.deriveMessages === 'function') {
                const messages = session.deriveMessages();
                if (Array.isArray(messages)) {
                    return messages.slice(-limit).map((m) => {
                        const msg = m;
                        return {
                            role: typeof msg.role === 'string' ? msg.role : 'unknown',
                            text: textOfBlocks(msg.content),
                        };
                    });
                }
            }
            // 退路：runtime 用 snapshotEvents，checkout 用 events
            const events = typeof session.snapshotEvents === 'function'
                ? session.snapshotEvents()
                : session.events;
            if (!Array.isArray(events))
                return [];
            return events
                .filter((e) => {
                const type = e.type;
                return type === 'user/message' || type === 'assistant/message';
            })
                .slice(-limit)
                .map((e) => {
                const ev = e;
                if (ev.type === 'user/message') {
                    const msg = ev.data;
                    return { role: 'user', text: textOfBlocks(msg?.content) };
                }
                const d = ev.data;
                return { role: 'assistant', text: textOfBlocks(d?.message?.content) };
            });
        }
        catch (e) {
            this.auditLog(`读取会话历史失败: ${String(e)}`);
            return [];
        }
    }
    dispose() {
        this.off?.();
        this.off = undefined;
        this.listeners.clear();
    }
}
//# sourceMappingURL=session-bridge.js.map