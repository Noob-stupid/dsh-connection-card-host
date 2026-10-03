/** 判断一条事件是否应该送达某个作用域的卡片。 */
function reachesScope(scope, data) {
    if (scope === 'both')
        return true;
    const from = data?.from;
    // 没有 from 字段的事件（普通自定义事件）双向都送；
    // 有 from 的消息事件只送给对应端。
    if (from !== 'a' && from !== 'b')
        return true;
    return from === scope;
}
export function createCardApi(deps) {
    const { instance, eventBus, adapter, messageLog, manager } = deps;
    const connectionId = instance.connectionId;
    const scope = instance.scope ?? 'both';
    const tools = new Map();
    const api = {
        scope,
        on(event, handler) {
            return eventBus.subscribe(connectionId, event, (data) => {
                if (!reachesScope(scope, data))
                    return;
                handler(data);
            });
        },
        emit(event, data) {
            eventBus.emit(connectionId, event, data);
        },
        registerTool(name, fn) {
            tools.set(name, fn);
        },
        mountUI(element) {
            element.dataset.cardInstanceId = instance.instanceId;
        },
        async requestRemote(method, params) {
            return adapter.requestRemote(connectionId, method, params, connectionId);
        },
        log(...args) {
            console.log(`[card:${instance.templateId}]`, ...args);
        },
        send(kind, text, options = {}) {
            // 单端卡片默认以自己那端发言；双向卡片必须显式指定
            const from = options.from ?? (scope === 'both' ? undefined : scope);
            if (from !== 'a' && from !== 'b') {
                return { ok: false, reason: '双向作用域的卡片必须显式指定 from（a 或 b）' };
            }
            const conn = manager.getById(connectionId);
            const result = messageLog.append(conn, from, kind, text, {
                ...(options.replyTo ? { replyTo: options.replyTo } : {}),
            });
            if (result.ok)
                manager.persistMessages(connectionId);
            return result.ok ? { ok: true } : { ok: false, reason: result.reason };
        },
        /**
         * **卡片代用户向对端投递一条消息**（对端请求的唯一新增能力）。
         *
         * ## 四条实现约束（对端提的，逐条落实）
         *
         * 1. **复用宿主既有投递路径**（`session-bridge.deliver`）—— 不另写一套。
         *    于是 preempt 的那套约束（默认关闭、需写权限、每连接 5 分钟 1 次、
         *    不满足自动退化为 urgent）**全部自动生效** ✓
         * 2. **fail-closed 授权**：没拿到"发消息"这个 `requires.write` 资源 ⇒ **直接拒绝**。
         *    "卡片代我对外说话"是**能力**，不是默认权利 ✓
         * 3. **不重试**（与 `requestRemote` 的 30s/不重试一致）；**返回结构，不抛字符串** ✓
         * 4. **每次尝试都审计**（哪一档、实际 via、是否降级）✓
         */
        async sendMessage(text, options = {}) {
            const body = typeof text === 'string' ? text.trim() : '';
            if (!body) {
                return { ok: false, code: 'threw', permanent: true, reason: '文本为空 —— 没有可投递的内容' };
            }
            /** ② 授权（fail-closed）：没有这张能力就不发。 */
            if (!deps.canSendMessage?.()) {
                return {
                    ok: false,
                    code: 'not-authorized',
                    /** **永久**：授权来自 manifest，挂载时就定了 ⇒ 卡片别再反复重试。 */
                    permanent: true,
                    reason: `卡片没有"发消息"能力 —— 请在卡片 manifest 的 ` +
                        `requires.write 里声明 "send_message"（这是用户授权，不是默认权利）。`,
                };
            }
            /** 目标端：`scope` 为 both 时无法判定 ⇒ 拒绝（宁可不说，也不要对错的一端说）。 */
            const peer = deps.resolvePeerSession?.();
            if (!peer) {
                return {
                    ok: false,
                    /**
                     * ⚠️ **结构化 `code`**（不只给文本 reason）。
                     *
                     * 卡片的"惰性宣告"要靠它区分**永久拒绝**与**暂时失败**：
                     * 永久拒绝 ⇒ 别再每次调用都重试（否则就是**重试风暴** ✗）；
                     * 暂时失败 ⇒ 下次再试 ✓。
                     * 只给文本的话，卡片只能去**解析文案** —— 那正是本仓立过规矩不许做的事。
                     */
                    code: scope === 'both' ? 'scope-ambiguous' : 'no-peer-session',
                    /** `scope-ambiguous` 是**永久**的（挂载时就定了）；`no-peer-session` 可能是暂时的。 */
                    permanent: scope === 'both',
                    reason: scope === 'both'
                        ? '这张卡片挂在两端（scope=both）—— 无法判定该对哪一端说话，故未发送'
                        : '这一端没有可投递的会话（对端可能尚未建立）',
                };
            }
            /** ① 投递：走宿主既有路径（没有它就不发，而不是另找一条路）。 */
            const deliver = deps.deliver;
            if (!deliver) {
                return {
                    ok: false,
                    code: 'no-channel',
                    permanent: false,
                    reason: '宿主投递通道不可用（未接入会话桥）',
                };
            }
            const urgency = options.urgency ?? 'normal';
            /**
             * 加**卡片来源标记**：收端应当知道这条不是用户本人说的。
             * 与 `markColdDelivery` 同一思路 —— **别让接收方误判说话的人是谁**。
             */
            const prefixed = `【卡片 · ${instance.templateId}】${body}`;
            try {
                const r = await deliver(peer, prefixed, urgency);
                /** ④ 审计：用了哪档、实际怎么送的、是否降级。 */
                api.log(`sendMessage urgency=${urgency} → ${r.ok ? `via=${r.via ?? '?'} live=${r.live ?? '?'}` : `失败：${r.reason ?? '未说明'}`}`);
                return r.ok
                    ? { ok: true, ...(r.via ? { via: r.via } : {}), ...(r.live !== undefined ? { live: r.live } : {}) }
                    : { ok: false, reason: r.reason ?? '投递失败（未说明原因）' };
            }
            catch (e) {
                /** ③ 不重试；把异常收成结构（绝不把异常抛给卡片）。 */
                const msg = e instanceof Error ? e.message : String(e);
                api.log(`sendMessage 抛错（不重试）：${msg}`);
                return { ok: false, reason: `投递异常：${msg}` };
            }
        },
        read(options = {}) {
            return messageLog.list(connectionId, options);
        },
    };
    api._tools = tools;
    return api;
}
//# sourceMappingURL=card-api.js.map