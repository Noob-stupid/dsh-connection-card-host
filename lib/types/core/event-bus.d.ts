/**
 * ConnectionEventBus — 连接级事件总线。
 * 命名空间：conn:<connectionId>:<event>
 * 卡片只能订阅自己所在连接的事件。
 */
type Handler = (data: unknown) => void;
type AllHandler = (event: string, data: unknown) => void;
export declare class ConnectionEventBus {
    private handlers;
    private allHandlers;
    emit(connectionId: string, event: string, data: unknown): void;
    subscribe(connectionId: string, event: string, handler: Handler): () => void;
    subscribeAll(connectionId: string, handler: AllHandler): () => void;
    /** 清除某连接的所有订阅（断开时调用） */
    clearConnection(connectionId: string): void;
}
export {};
