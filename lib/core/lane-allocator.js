export function allocateLanes(connections, sessionOrder) {
    const intervals = connections
        .map((c) => {
        const idxA = sessionOrder.indexOf(c.sessionA);
        const idxB = sessionOrder.indexOf(c.sessionB);
        if (idxA === -1 || idxB === -1)
            return null;
        const start = Math.min(idxA, idxB);
        const end = Math.max(idxA, idxB);
        return { id: c.id, start, end };
    })
        .filter((x) => x !== null)
        .sort((a, b) => a.start - b.start);
    const lanes = [];
    const assignments = new Map();
    for (const interval of intervals) {
        let placed = false;
        for (let i = 0; i < lanes.length; i++) {
            const lane = lanes[i];
            const conflicts = lane.connections.some((cid) => {
                const other = assignments.get(cid);
                // 共享端点不算重叠：interval.end <= other.startIndex || interval.start >= other.endIndex
                return !(interval.end <= other.startIndex || interval.start >= other.endIndex);
            });
            if (!conflicts) {
                lane.connections.push(interval.id);
                assignments.set(interval.id, {
                    connectionId: interval.id,
                    laneIndex: i,
                    startIndex: interval.start,
                    endIndex: interval.end,
                });
                placed = true;
                break;
            }
        }
        if (!placed) {
            const newLane = { index: lanes.length, connections: [interval.id] };
            lanes.push(newLane);
            assignments.set(interval.id, {
                connectionId: interval.id,
                laneIndex: newLane.index,
                startIndex: interval.start,
                endIndex: interval.end,
            });
        }
    }
    return { lanes, connections: assignments };
}
//# sourceMappingURL=lane-allocator.js.map