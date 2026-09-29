/**
 * SessionRail — 左侧轨道。
 * 位置：会话列表左侧，宽度 --rail-width(24px)。
 * 同时显示最多 3 条 lane，超出折叠为 +N。
 */
import type { Connection } from '../types/index.js';
interface SessionRailProps {
    connections: Connection[];
    sessions: string[];
    hoveredConnectionId: string | null;
    hoveredSessionId: string | null;
}
export declare function SessionRail({ connections, sessions, hoveredConnectionId, hoveredSessionId, }: SessionRailProps): import("react").JSX.Element;
export {};
