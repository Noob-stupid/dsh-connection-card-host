import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useLaneLayout } from './hooks/useLaneLayout.js';
import { RailLane } from './RailLane.js';
export function SessionRail({ connections, sessions, hoveredConnectionId, hoveredSessionId, }) {
    const layout = useLaneLayout(connections, sessions);
    return (_jsxs("div", { className: "session-rail", style: { width: 'var(--rail-width)' }, children: [layout.lanes.slice(0, 3).map((lane) => (_jsx(RailLane, { lane: lane, assignments: layout.connections, connections: connections, sessionCount: sessions.length, hoveredConnectionId: hoveredConnectionId, hoveredSessionId: hoveredSessionId }, lane.index))), layout.lanes.length > 3 && (_jsxs("div", { className: "session-rail__overflow", children: ["+", layout.lanes.length - 3] }))] }));
}
//# sourceMappingURL=SessionRail.js.map