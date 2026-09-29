/**
 * Lane 分配算法 — 贪心区间着色。
 * 共享端点（A-B 和 B-C）不算重叠，可同 lane。
 * 区间方向无关，按 start/end 排序。
 */
import type { Connection, RailLayout, Lane, LaneAssignment } from '../types/index.js'

export function allocateLanes(
  connections: Connection[],
  sessionOrder: string[],
): RailLayout {
  const intervals = connections
    .map((c) => {
      const idxA = sessionOrder.indexOf(c.sessionA)
      const idxB = sessionOrder.indexOf(c.sessionB)
      if (idxA === -1 || idxB === -1) return null
      const start = Math.min(idxA, idxB)
      const end = Math.max(idxA, idxB)
      return { id: c.id, start, end }
    })
    .filter((x): x is { id: string; start: number; end: number } => x !== null)
    .sort((a, b) => a.start - b.start)

  const lanes: Lane[] = []
  const assignments = new Map<string, LaneAssignment>()

  for (const interval of intervals) {
    let placed = false
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]
      const conflicts = lane.connections.some((cid) => {
        const other = assignments.get(cid)!
        // 共享端点不算重叠：interval.end <= other.startIndex || interval.start >= other.endIndex
        return !(interval.end <= other.startIndex || interval.start >= other.endIndex)
      })
      if (!conflicts) {
        lane.connections.push(interval.id)
        assignments.set(interval.id, {
          connectionId: interval.id,
          laneIndex: i,
          startIndex: interval.start,
          endIndex: interval.end,
        })
        placed = true
        break
      }
    }
    if (!placed) {
      const newLane: Lane = { index: lanes.length, connections: [interval.id] }
      lanes.push(newLane)
      assignments.set(interval.id, {
        connectionId: interval.id,
        laneIndex: newLane.index,
        startIndex: interval.start,
        endIndex: interval.end,
      })
    }
  }

  return { lanes, connections: assignments }
}
