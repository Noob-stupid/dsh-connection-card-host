export interface SessionRowInfo {
    element: Element;
    id: string;
    top: number;
    bottom: number;
    left: number;
}
/** 收集当前 DOM 里能确定 id 的会话行（按视觉顺序）。 */
export declare function collectSessionRows(sessionIds: readonly string[]): SessionRowInfo[];
/** 命中坐标下的会话行信息；没有可靠映射时返回 null。 */
export declare function sessionRowAtPoint(x: number, y: number, sessionIds: readonly string[]): SessionRowInfo | null;
