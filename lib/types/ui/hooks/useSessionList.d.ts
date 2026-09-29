import type { SessionsBridge, SessionListSnapshot } from '../../client/sessions-bridge.js';
export interface SessionOption {
    id: string;
    label: string;
    isCurrent: boolean;
}
export interface UseSessionListResult {
    options: SessionOption[];
    /** 原始快照（拖拽/轨道判定用）。 */
    snapshot: SessionListSnapshot;
    labelOf: (id: string) => string;
    /** 会话列表是否已就绪（未就绪时不要下"没有会话"的结论）。 */
    ready: boolean;
}
export declare function useSessionList(bridge: SessionsBridge | null): UseSessionListResult;
