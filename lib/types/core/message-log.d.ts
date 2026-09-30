import type { ConnectionMessage, MessageKind } from '../types/index.js';
import type { ConnectionEventBus } from './event-bus.js';
import type { Connection } from '../types/index.js';
/**
 * 消息来源：**手动发送** vs **中继自动写入**。
 *
 * ## 为什么必须分开计时（2026-09-30 对端会话指出）
 *
 * 早先 `lastSendAt` 是**每连接一个时间戳，任何一次写入都刷新它** ——
 * 而中继自己往连接日志 append 走的是同一个闸门。于是：
 *
 *   中继刚记了一条镜像消息（自动，用户无感）
 *     → 用户 200ms 内手动发送
 *     → 被拒，文案是「发送过于频繁」
 *
 * **用户主观上只按了一次**，报错却指向他。这类"无关的自动行为让用户的动作
 * 失败、且文案误导"的模式，本项目已经踩过好几次（见 compatibility.md）。
 *
 * 分桶之后：中继的写入不再污染手动发送的间隔判定。
 */
export type SendOrigin = 'manual' | 'relay';
export interface SendResult {
    ok: boolean;
    reason?: string;
    message?: ConnectionMessage;
    /** 被频控拒绝时，还需等待多少毫秒（调用方据此精确重试，而不是猜"窗口过没过"）。 */
    retryAfterMs?: number;
}
export declare class ConnectionMessageLog {
    private messages;
    private lastSendAt;
    private eventBus;
    private auditLog;
    constructor(eventBus: ConnectionEventBus, auditLog?: (msg: string) => void);
    /**
     * 发送前的准入判定。
     *
     * 规则（"规范交流"）：
     *   1. 连接必须存在且未断开
     *   2. `say` 需要发送方向权限 ≥ suggest；`ask`/`reply` 需要 = write
     *   3. 文本非空且不超长
     *   4. 同一连接、**同一来源**两次发送之间有最小间隔（抑制刷屏）
     *
     * @param conn 目标连接
     * @param from 发送端
     * @param kind 消息类型
     * @param text 文本
     * @param origin 来源（手动 / 中继自动）—— **计时分桶，互不干扰**
     */
    gateSend(conn: Connection | undefined, from: 'a' | 'b', kind: MessageKind, text: string, origin?: SendOrigin): {
        ok: boolean;
        reason?: string;
        retryAfterMs?: number;
    };
    /**
     * 追加一条消息并广播。
     * 调用方应先用 gateSend 判定；这里再判一次以防漏网。
     */
    append(conn: Connection | undefined, from: 'a' | 'b', kind: MessageKind, text: string, options?: {
        replyTo?: string;
        bypassGate?: boolean;
        origin?: SendOrigin;
    }): SendResult;
    /** 读取消息（默认全部，可按时间过滤）。 */
    list(connectionId: string, options?: {
        since?: number;
        limit?: number;
    }): ConnectionMessage[];
    /** 装配/恢复时灌入历史。 */
    hydrate(connectionId: string, messages: ConnectionMessage[]): void;
    /** 取某连接的全部消息（用于持久化）。 */
    dump(connectionId: string): ConnectionMessage[];
    clear(connectionId: string): void;
}
