import type { Lane, LaneAssignment, Connection } from '../types/index.js';
interface RailLaneProps {
    lane: Lane;
    assignments: Map<string, LaneAssignment>;
    connections: Connection[];
    sessionCount: number;
    hoveredConnectionId: string | null;
    hoveredSessionId: string | null;
}
export declare function RailLane({ lane, assignments, connections, sessionCount, hoveredConnectionId, hoveredSessionId, }: RailLaneProps): import("react").JSX.Element;
export {};
