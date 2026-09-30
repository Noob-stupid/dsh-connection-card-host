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
    /** 是否把助手的输出转发给对端（默认 true）。这是「A 说话 B 感知」的本体。 */
    relayAssistant?: boolean;
    /**
     * 是否把**用户输入**也转发（默认 **false**）。
     *
     * ## 为什么默认关 —— 这是修正一个设计错误
     *
     * 用户在会话里打的字，是**对那个会话说的**，不是"A 在跟 B 说话"。
     * 转发出去的话，对端收到的是一个 `user/message` —— **在它看来那就是
     * "用户给我的指令"**，于是它开始做只交给另一边的活。
     *
     * 用户举的例子最清楚：
     *   A 做水面、B 做船。用户给 A 下"优化水面" → **B 凭什么跟着做？**
     *
     * 正确语义：**该转发的是会话助手自己的输出**（它的结论、它说的话），
     * 那才叫"A 说话 B 感知"。用户对 A 下指令 ≠ A 对 B 说话。
     *
     * 要在两端之间传话应走**显式通道**（面板发送框、或让助手调工具），
     * 而不是把某个会话里的用户输入悄悄镜像过去。
     */
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
    /** connectionId → 当前中继链已走的跳数（真实用户发言时归零）。 */
    private hops;
    /** sessionId → 最近一次投递给它的时刻，用于判断后续跳归属。 */
    private deliveredAt;
    constructor(manager: ConnectionManager, bridge: SessionBridge, auditLog: (msg: string) => void, options?: RelayOptions);
    start(): void;
    /**
     * 当前的中继配置（面板据此判断"到底有没有在自动转发"）。
     *
     * 为什么需要：面板的警告条早先是按**权限档位**判断的，但自动转发在
     * 2026-10-01 已默认关闭 —— 两者解耦了。只看权限会让 UI 喊狼来了
     *（显示"正在互相转发消息"而实际什么都没转发）。
     */
    config(): {
        relayAssistant: boolean;
        relayUser: boolean;
    };
    stop(): void;
    /** 一条会话活动 → 可能触发多条连接的中继。 */
    private onActivity;
    /** 滑动窗口频控。 */
    private withinRate;
}
