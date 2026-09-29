import type { ConnectionMessage, MessageKind } from '../types/index.js';
import type { ConnectionEventBus } from './event-bus.js';
import type { Connection } from '../types/index.js';
export interface SendResult {
    ok: boolean;
    reason?: string;
    message?: ConnectionMessage;
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
     *   4. 同一连接两次发送之间有最小间隔（抑制刷屏）
     *
     * @param conn 目标连接
     * @param from 发送端
     * @param kind 消息类型
     * @param text 文本
     */
    gateSend(conn: Connection | undefined, from: 'a' | 'b', kind: MessageKind, text: string): {
        ok: boolean;
        reason?: string;
    };
    /**
     * 追加一条消息并广播。
     * 调用方应先用 gateSend 判定；这里再判一次以防漏网。
     */
    append(conn: Connection | undefined, from: 'a' | 'b', kind: MessageKind, text: string, options?: {
        replyTo?: string;
        bypassGate?: boolean;
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
