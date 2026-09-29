export interface SessionRowInfo {
    element: Element;
    id: string;
    top: number;
    bottom: number;
    left: number;
    right: number;
}
export interface SessionSnapshotLike {
    ids: readonly string[];
    byId: Record<string, {
        title?: string;
    }>;
}
/**
 * 收集当前 DOM 里能确定 id 的会话行（按视觉顺序）。
 * @param snapshot - 会话快照（提供 id 顺序与标题，用于兜底匹配）
 */
export declare function collectSessionRows(snapshot: SessionSnapshotLike | null): SessionRowInfo[];
/** 命中坐标下的会话行信息；没有可靠映射时返回 null。 */
export declare function sessionRowAtPoint(x: number, y: number, snapshot: SessionSnapshotLike | null): SessionRowInfo | null;
