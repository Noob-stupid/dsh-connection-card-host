/**
 * ConnectionRelay — 「A 说话 B 能感知」的中继策略。
 *
 * 数据流：
 *   A 会话产生消息
 *     → SessionBridge.observe 捕获（session/event）
 *     → 找出 A 参与的所有连接，判断 A 是哪一端
 *     → 过权限闸门（read 不许外传；say 需 ≥suggest；ask/reply 需 write）
 *     → 写入连接交流记录（两端共享）
 *     → SessionBridge.deliver 投递给对端会话 → 对端 agent 下一轮就能看到
 *
 * ## 防回环（关键）
 *
 * A→B 投递后，B 会看到一条 user 消息；如果 B 的 agent 因此回复，
 * 那条回复又会被观察捕获，再投回 A …… 无限循环。
 *
 * 挡法有两层：
 *   1. 投递时把 `source.kind` 写成 producer-owned kind（`plugin:dsh-connection-card-host`，
 *      SessionBridge 的 PLUGIN_SOURCE_KIND），观察时识别并跳过
 *   2. 这里再加一层**转发标记**：中继产生的活动不再二次中继
 *
 * 另外做了每连接的单位时间转发上限，防止两端互相刷屏。
 */
import type { ConnectionManager } from '../core/connection-manager.js';
import type { SessionBridge } from '../adapter/session-bridge.js';
export interface RelayOptions {
    /** 是否把助手的输出也转发（默认 true）。 */
    relayAssistant?: boolean;
    /** 是否把用户输入也转发（默认 true）。 */
    relayUser?: boolean;
}
export declare class ConnectionRelay {
    private manager;
    private bridge;
    private options;
    private auditLog;
    private off;
    /** connectionId → 时间窗内的转发时间戳。 */
    private relayTimes;
    constructor(manager: ConnectionManager, bridge: SessionBridge, auditLog: (msg: string) => void, options?: RelayOptions);
    start(): void;
    stop(): void;
    /** 一条会话活动 → 可能触发多条连接的中继。 */
    private onActivity;
    /** 滑动窗口频控。 */
    private withinRate;
}
