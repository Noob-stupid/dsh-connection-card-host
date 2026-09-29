export interface SessionSummaryLite {
    title?: string;
    updatedAt?: number;
}
export interface SessionListSnapshot {
    /** 宿主列表顺序的会话 id。 */
    ids: string[];
    byId: Record<string, SessionSummaryLite>;
    /** 当前选中的会话。 */
    current: string | undefined;
}
export interface SessionsBridge {
    getSnapshot(): SessionListSnapshot;
    subscribe(listener: () => void): () => void;
    /** 选中某个会话（侧栏点击等价）。 */
    open(id: string): void;
}
/** 从 cordis 上下文取会话桥；不可用时返回 null。 */
export declare function resolveSessions(ctx: unknown): SessionsBridge | null;
/** 会话的展示名：标题优先，否则截断 id。 */
export declare function sessionLabel(bridge: SessionsBridge | null, id: string, snapshot?: SessionListSnapshot): string;
