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
/**
 * 只取**真正的正文**（type=text 的块），不含 `[reasoning]` / `[tool-call]` 这类占位。
 *
 * 为什么单独要这个：一轮对话里 `assistant/message` 会触发**多次** ——
 * 带工具调用时，中间的助手消息往往只有思考块和工具调用块、没有正文。
 * 那些是**过程**不是**发言**，中继出去毫无意义（用户看到的是 `[reasoning][tool-call]`）。
 * 所以判断"这条值不值得中继"要用这个，而不是上面那个带占位的版本。
 */
function textContentOnly(content) {
    if (!Array.isArray(content))
        return '';
    return content
        .map((block) => {
        const b = block;
        return b?.type === 'text' && typeof b.text === 'string' ? b.text : '';
    })
        .filter((s) => s.length > 0)
        .join('');
}
/** 判断消息来源是不是我们自己投递的（防止 A→B→A 无限回环）。 */
function isFromPlugin(source, deliveryIds) {
    const s = source;
    // ① 当前形状：producer-owned kind
    if (s?.kind === PLUGIN_SOURCE_KIND)
        return true;
    // ② 兼容旧形状（V3 的 `{ kind: 'plugin', plugin }` 包装）：
    // 老宿主/老日志里仍是这个形状，认出来才能继续防回环。
    if (s?.kind === 'plugin' && s?.plugin === PLUGIN_SOURCE)
        return true;
    // ③ 投递 id 命中我们登记过的集合 —— 框架覆写 source 时的兜底
    if (typeof s?.rpcId === 'string' && deliveryIds?.has(s.rpcId))
        return true;
    // ④ id 前缀兜底：即便登记集合因宿主重启而空了，`ccr-` 也是本插件独有的前缀
    if (typeof s?.rpcId === 'string' && s.rpcId.startsWith('ccr-'))
        return true;
    return false;
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
    /**
     * 能读到 `sessionController` 的上下文。
     *
     * 为什么要单独存一个 ctx：cordis 是 Proxy，**没在 inject 里声明的服务读不到**。
     * `sessionController` 只在 runtime 0.2+ 有，不能放进静态 inject 数组
     * （那会让插件在旧版本上直接不加载），只能用 `ctx.inject([...], cb)` 拿一个
     * 已声明该服务的 scope，再从这里做查找。
     *
     * 它值钱的地方：`sessionController.prompt()` 是「**活则复用、冷则 resume**」——
     * 对端没打开时能把它**唤醒**，而不是投递失败。
     */
    controllerCtx = null;
    /** 原始会话事件订阅者（不过滤事件类型）。 */
    rawHandlers = new Set();
    /**
     * 我们最近投递时生成并登记的 requestId。
     *
     * 这是**不依赖 source 形状**的防回环依据：`sessionController.prompt()` 会把
     * 调用方的 `requestId` 放进它自己造的 `source.rpcId`，所以只要 id 还在集合里，
     * 哪怕框架改掉 source.kind，我们仍能认出"这条是自己人发的"。
     * 见 `isFromPlugin()` 的说明与 2026-09-30 回声事故。
     */
    deliveryIds = new Set();
    /** sessionId → 最近一次投递时刻（用于把过期 id 清出去）。 */
    deliveryIdTimes = new Map();
    /** 投递 id 保留多久（远超一轮对话的时间，够覆盖排队与冷启动）。 */
    static DELIVERY_ID_TTL = 10 * 60_000;
    /** 登记一条投递的 id（供防回环识别）。 */
    rememberDeliveryId(id) {
        this.deliveryIds.add(id);
        this.deliveryIdTimes.set(id, Date.now());
        this.pruneDeliveryIds();
    }
    /** 清掉过期 id，避免集合无限增长。 */
    pruneDeliveryIds() {
        const cutoff = Date.now() - SessionBridge.DELIVERY_ID_TTL;
        for (const [id, at] of this.deliveryIdTimes) {
            if (at < cutoff) {
                this.deliveryIds.delete(id);
                this.deliveryIdTimes.delete(id);
            }
        }
    }
    /**
     * 订阅**全部**会话事件（含 tool/call、step/start 等）。
     *
     * 与 `observe()` 的区别：那个只放行 user/assistant **消息**（"发言"），
     * 这个放行一切（"工作状态"的原料：在调什么工具、动哪个文件、走到第几步）。
     * 两条流互不影响。
     */
    observeRaw(handler) {
        this.rawHandlers.add(handler);
        return () => {
            this.rawHandlers.delete(handler);
        };
    }
    /** 接入一个声明了 sessionController 的上下文（冷会话唤醒通道）。 */
    attachControllerContext(ctx) {
        this.controllerCtx = ctx;
        this.auditLog('sessionController 已接入（冷会话可被唤醒）');
    }
    constructor(ctx, auditLog) {
        this.ctx = ctx;
        this.auditLog = auditLog ?? (() => { });
    }
    /** 能力探测：投递通道是否可用。 */
    capabilities() {
        const notes = [];
        const agents = safeCtxGet(this.ctx, 'agents');
        // sessionController 要从已声明它的 scope 里查（见 controllerCtx 的说明）
        const controller = safeCtxGet(this.controllerCtx ?? this.ctx, 'sessionController');
        const on = safeCtxMethod(this.ctx, 'on');
        const via = [];
        if (typeof controller?.prompt === 'function')
            via.push('sessionController.prompt(可唤醒冷会话)');
        if (typeof agents?.get === 'function')
            via.push('agents.get + followup(仅 live)');
        // 读不到服务时给出可操作的原因，而不是笼统的"不可用"
        if (!agents) {
            notes.push('读不到 ctx.agents —— 需在插件 inject 里声明 "agents"（cordis 代理只放行已声明的服务）');
        }
        if (!controller) {
            notes.push('ctx.sessionController 读不到 —— 冷会话（对端未打开）无法唤醒，' +
                '只能投递给已打开的会话。若该服务确实存在，检查是否已用 ctx.inject 声明。');
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
                // 原始事件通道：工具调用、步骤推进这类"工作状态"原料都在这里。
                // 下面那段只放行 user/assistant 消息（那是"发言"），工具事件会被丢掉，
                // 所以单独给 WorkStateTracker 一条不过滤的流。
                for (const handler of this.rawHandlers) {
                    try {
                        handler(sessionId, event);
                    }
                    catch (e) {
                        this.auditLog(`原始事件处理器抛错: ${String(e)}`);
                    }
                }
                let role = null;
                let text = '';
                let relayTriggered = false;
                if (event.type === 'user/message') {
                    // ⚠️ user/message 的 data **就是 UserMessage 本身**（不是 { message }）
                    const msg = event.data;
                    role = 'user';
                    text = textOfBlocks(msg?.content);
                    if (isFromPlugin(msg?.source, this.deliveryIds)) {
                        // 我们自己投递进去的，不要再中继出去，否则 A→B→A 回环
                        return;
                    }
                }
                else if (event.type === 'assistant/message') {
                    // 其余消息类事件是 { message }
                    const d = event.data;
                    const content = d?.message?.content;
                    // 中间步骤（只有思考块 / 工具调用块，没有正文）是**过程**不是**发言**。
                    // 一轮对话里 assistant/message 会触发多次，中继过程毫无意义
                    //（用户只会看到 `[reasoning][tool-call]`），所以这里直接跳过。
                    const body = textContentOnly(content);
                    if (body.trim().length === 0)
                        return;
                    role = 'assistant';
                    // 用纯正文（不含 [reasoning]/[tool-call] 占位）——
                    // 判断和内容必须是同一个版本，否则日志里会留下 `[reasoning]正文` 这种残渣
                    text = body;
                    // 这轮回复若是被中继消息触发的，就处在链上后续跳 —— 交给中继层做跳数判断
                    relayTriggered = this.lastUserWasFromPlugin(sessionId);
                }
                else {
                    return;
                }
                if (text.trim().length === 0)
                    return;
                const activity = {
                    sessionId,
                    role,
                    text,
                    seq,
                    fromPlugin: false,
                    relayTriggered,
                };
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
     * 该会话**最近一条 user 消息**是不是本插件投递的。
     *
     * 用来判断"这一轮助手回复是不是中继链的后续跳" —— 助手消息自身的 source
     * 永远是 model，看不出它是不是被中继消息触发的，只能回溯它回应的是谁。
     *
     * 判据可靠的原因：投递的 user 消息会先被 append 进会话日志，agent 才会开始跑这一轮；
     * 所以 assistant/message 事件到达时，那条 user 消息一定已经在了。
     */
    lastUserWasFromPlugin(sessionId) {
        try {
            const sessions = safeCtxGet(this.ctx, 'sessions');
            const session = sessions?.get?.(sessionId);
            if (!session)
                return false;
            // 优先 deriveMessages（已应用 surface 折叠与投影）
            if (typeof session.deriveMessages === 'function') {
                const messages = session.deriveMessages();
                if (Array.isArray(messages)) {
                    for (let i = messages.length - 1; i >= 0; i--) {
                        const m = messages[i];
                        if (m?.role !== 'user')
                            continue;
                        return isFromPlugin(m.source, this.deliveryIds);
                    }
                    return false;
                }
            }
            // 退路：直接读事件流（runtime 用 snapshotEvents，checkout 用 events）
            const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events;
            if (!Array.isArray(events))
                return false;
            for (let i = events.length - 1; i >= 0; i--) {
                const e = events[i];
                if (e?.type !== 'user/message')
                    continue;
                const msg = e.data;
                return isFromPlugin(msg?.source, this.deliveryIds);
            }
            return false;
        }
        catch {
            // 读不到就当"不是中继触发"——宁可多转发一跳，也不要静默丢掉真实消息
            return false;
        }
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
        const agents = safeCtxGet(this.ctx, 'agents');
        const liveAgent = agents?.get?.(sessionId);
        /**
         * 投递模式：**自适应**。
         *
         * 底层实现（`dsh-api-session-controller/lib/index.js:882`）只有两种：
         *   mode === 'steer' → agent.steer(msg)     即时插话进正在跑的那一轮
         *   其他             → agent.followup(msg)  排到下一轮
         *
         * 而 `steer` 有硬前提（同文件 :966）：
         *   `agent.status !== 'running'` 时抛 session/steer-unavailable。
         *
         * 所以不能写死任何一个：
         *   - 对端**正在跑** → steer，消息当场送到（否则要等它跑完，可能几分钟）
         *   - 对端**空闲**   → followup，下一轮立刻开始，效果本来就等同于即时
         */
        const peerRunning = liveAgent?.status === 'running';
        const mode = peerRunning ? 'steer' : 'queue';
        // 投递 id：**登记下来供防回环识别**（见 isFromPlugin 的说明）。
        // 这个 id 会被 sessionController 原样放进它自己造的 source.rpcId，
        // 所以即便它覆写了 source.kind，我们仍能认出这条是自己发的。
        const deliveryId = `ccr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this.rememberDeliveryId(deliveryId);
        // MessageId 是 brand（运行时就是字符串）；source 用 producer-owned kind 标注来源，
        // 既让对端知道"这来自连接中继"，也让本插件能识别并防回环。
        // ⚠️ 绝不能写 V3 的 `{ kind: 'plugin', plugin }`：V4 准入会直接拒绝整个会话。
        const message = {
            id: deliveryId,
            role: 'user',
            content,
            source: { kind: PLUGIN_SOURCE_KIND, form: 'relay', summary: '连接消息' },
        };
        // ── 首选：对端**活着**时走 agents 路径 ──
        //
        // ⚠️ 顺序很关键。`sessionController.prompt` 会**自己造 source**
        // （`{ kind: 'user', rpcId }`，见 dsh-api-session-controller/lib/index.js:856-860），
        // **完全忽略我们传的 source** —— 于是投递进去的消息看起来就是"真实用户输入"，
        // 本插件的防回环识别与链路判定双双失效，消息会被中继原样转发回去形成回环。
        //
        // 所以：**活着走 agents（source 由我们标注）；只有冷会话才用 sessionController**
        // （它自带 resume，是我们唯一的冷唤醒通道），两条路径都由上面的 deliveryId 兜底。
        if (liveAgent) {
            if (peerRunning && typeof liveAgent.steer === 'function') {
                try {
                    this.delivering.add(sessionId);
                    liveAgent.steer(message);
                    this.auditLog(`投递成功（steer 即时插话）→ ${sessionId}`);
                    return { ok: true, via: 'agents.steer', mode: 'steer', live: true };
                }
                catch (e) {
                    this.auditLog(`steer 失败，回退 followup: ${String(e)}`);
                }
                finally {
                    setTimeout(() => this.delivering.delete(sessionId), 0);
                }
            }
            if (typeof liveAgent.followup === 'function') {
                try {
                    this.delivering.add(sessionId);
                    liveAgent.followup(message);
                    this.auditLog(`投递成功（followup，source 已标注）→ ${sessionId}`);
                    return { ok: true, via: 'agents.followup', mode: 'queue', live: true };
                }
                catch (e) {
                    this.auditLog(`followup 失败: ${String(e)}`);
                }
                finally {
                    setTimeout(() => this.delivering.delete(sessionId), 0);
                }
            }
        }
        // ── 兜底：冷会话唤醒（sessionController 自带 resume） ──
        const controllerSource = this.controllerCtx ?? this.ctx;
        const controller = safeCtxGet(controllerSource, 'sessionController');
        if (typeof controller?.prompt === 'function') {
            try {
                // ⚠️ 必须传 signal：prompt(request, signal) 内部会调 signal.throwIfAborted()，
                // 省略第二个参数会直接抛 TypeError 并静默回退到 agents 路径（冷会话就唤不醒）。
                const abort = new AbortController();
                await controller.prompt({
                    sessionId,
                    content,
                    mode,
                    // 这个值会被 prompt 原样放进它造的 source.rpcId —— 防回环就靠它
                    requestId: deliveryId,
                }, abort.signal);
                this.auditLog(`投递成功（冷会话唤醒，prompt 会覆写 source 但有 id 兜底）→ ${sessionId}`);
                return { ok: true, via: 'sessionController', mode, live: false };
            }
            catch (e) {
                this.auditLog(`sessionController.prompt 失败: ${String(e)}`);
            }
        }
        if (!agents?.get) {
            // 区分「服务读不到」和「会话不在内存」——这两种原因的修法完全不同
            return {
                ok: false,
                reason: '读不到 ctx.agents（cordis 代理只放行 inject 里声明过的服务）。' +
                    '请在插件 inject 中加入 "agents"。',
            };
        }
        // 走到这里说明：对端是冷会话（没有 live agent），且 sessionController 也不可用。
        // agents 路径已在上面优先尝试过（活着的情况），这里只剩失败。
        return {
            ok: false,
            reason: `会话 ${sessionId} 当前没有 live agent（未打开或已释放），` +
                '且 sessionController 不可用，无法唤醒。',
        };
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