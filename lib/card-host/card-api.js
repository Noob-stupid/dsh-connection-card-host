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
        read(options = {}) {
            return messageLog.list(connectionId, options);
        },
    };
    api._tools = tools;
    return api;
}
//# sourceMappingURL=card-api.js.map