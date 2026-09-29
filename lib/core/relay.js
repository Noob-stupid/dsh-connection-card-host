import { permValue } from '../types/permission.js';
/** 同一个连接在每个时间窗内最多转发多少条，超过就丢弃（防对刷）。 */
const MAX_RELAY_PER_WINDOW = 12;
const RELAY_WINDOW_MS = 10_000;
/** 只读权限下不转发任何内容 —— 连接仅用于观察挂载，不做交流。 */
const MIN_LEVEL_FOR_SAY = 'suggest';
/**
 * 是否把中继内容**注入**对端会话。
 *
 * ## 为什么这里需要一个开关
 *
 * 2026-09-30 事故：手搓的 message `source` 写成 V3 形状
 * `{ kind: 'plugin', plugin }`，被运行时 V4 会话格式拒绝：
 *   `format v4 message requires a producer-owned source kind`
 * 后果不是"这条消息失败"，而是**对端会话每一轮都失败**——写句柄把整批事件
 * 塞回缓冲并置 `drainPaused = true`，之后每次发言都重试同一批、每次都失败。
 *
 * 现已改为 producer-owned kind（见 session-bridge.ts 的 PLUGIN_SOURCE_KIND），
 * 并经只读巡检确认 5 个 live 会话 `badLog=0 / buffered=0 / drainPaused=false`。
 *
 * 保留这个开关的意义：注入是**能弄坏用户会话**的操作。
 * 以后若要改 source 形状，先把这里置 false 验证，再打开。
 */
const DELIVERY_ENABLED = true;
export class ConnectionRelay {
    manager;
    bridge;
    options;
    auditLog;
    off;
    /** connectionId → 时间窗内的转发时间戳。 */
    relayTimes = new Map();
    constructor(manager, bridge, auditLog, options = {}) {
        this.manager = manager;
        this.bridge = bridge;
        this.auditLog = auditLog;
        this.options = { relayAssistant: true, relayUser: true, ...options };
    }
    start() {
        if (this.off)
            return;
        this.off = this.bridge.observe((activity) => {
            void this.onActivity(activity);
        });
        this.auditLog('中继已启动');
    }
    stop() {
        this.off?.();
        this.off = undefined;
        this.auditLog('中继已停止');
    }
    /** 一条会话活动 → 可能触发多条连接的中继。 */
    async onActivity(activity) {
        if (activity.role === 'user' && !this.options.relayUser)
            return;
        if (activity.role === 'assistant' && !this.options.relayAssistant)
            return;
        if (activity.fromPlugin)
            return; // 防回环：本插件投递进来的不再外传
        // 这个会话参与的所有连接
        const connections = this.manager.getBySession(activity.sessionId);
        for (const conn of connections) {
            // 判断说话的是哪一端
            const from = conn.sessionA === activity.sessionId
                ? 'a'
                : conn.sessionB === activity.sessionId
                    ? 'b'
                    : null;
            if (!from)
                continue;
            const peerSessionId = from === 'a' ? conn.sessionB : conn.sessionA;
            const direction = from === 'a' ? 'aToB' : 'bToA';
            const level = conn.permission[direction];
            // 权限闸门：读权限不外传（连接仅用于挂载观察，不做交流）
            if (permValue(level) < permValue(MIN_LEVEL_FOR_SAY)) {
                this.auditLog(`中继跳过（${direction}=${level} 低于 ${MIN_LEVEL_FOR_SAY}）: ${conn.id}`);
                continue;
            }
            // 频控
            if (!this.withinRate(conn.id)) {
                this.auditLog(`中继节流: ${conn.id}`);
                continue;
            }
            // 写入连接交流记录（两端共享，面板能看到）
            const kind = activity.role === 'assistant' ? 'reply' : 'say';
            const label = activity.role === 'assistant' ? '对方助手' : '对方用户';
            const result = this.manager.messages.append(conn, from, kind, `【${label}】${activity.text}`);
            if (!result.ok) {
                this.auditLog(`中继写入被拒（${result.reason}）: ${conn.id}`);
                continue;
            }
            this.manager.persistMessages(conn.id);
            // 投递给对端会话，让它的 agent 能感知
            if (!DELIVERY_ENABLED) {
                this.auditLog(`中继已记录但未注入（DELIVERY_ENABLED=false）: ${conn.id} ${from}→${from === 'a' ? 'b' : 'a'}`);
                continue;
            }
            const delivered = await this.bridge.deliver(peerSessionId, `[连接消息 · 来自另一端] ${activity.text}`, true);
            if (delivered.ok) {
                this.auditLog(`中继 ${conn.id} ${from}→${from === 'a' ? 'b' : 'a'} via=${delivered.via}: ${activity.text.slice(0, 60)}`);
            }
            else {
                this.auditLog(`中继投递失败（对端感知不到）: ${delivered.reason}`);
            }
        }
    }
    /** 滑动窗口频控。 */
    withinRate(connectionId) {
        const now = Date.now();
        const times = (this.relayTimes.get(connectionId) ?? []).filter((t) => now - t < RELAY_WINDOW_MS);
        if (times.length >= MAX_RELAY_PER_WINDOW) {
            this.relayTimes.set(connectionId, times);
            return false;
        }
        times.push(now);
        this.relayTimes.set(connectionId, times);
        return true;
    }
}
//# sourceMappingURL=relay.js.map