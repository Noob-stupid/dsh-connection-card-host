/**
 * RailLane — 单条 lane 渲染。
 * 垂直竖线从 start 到 end，端点处圆点。
 * 链式连接（A-B 和 B-C 同 lane）在 B 点用双端点标记。
 * 双色连接用 SVG linearGradient。
 */
import { useMemo } from 'react'
import type { Lane, LaneAssignment, Connection } from '../types/index.js'

interface RailLaneProps {
  lane: Lane
  assignments: Map<string, LaneAssignment>
  connections: Connection[]
  sessionCount: number
  hoveredConnectionId: string | null
  hoveredSessionId: string | null
}

const PERM_COLORS = {
  read: '#9CA3AF',
  suggest: '#3B82F6',
  write: '#F97316',
} as const

export function RailLane({
  lane,
  assignments,
  connections,
  sessionCount,
  hoveredConnectionId,
  hoveredSessionId,
}: RailLaneProps) {
  const laneX = 4 + lane.index * 8 // rail-lane-gap = 8px

  const segments = useMemo(() => {
    return lane.connections.map((cid) => {
      const assignment = assignments.get(cid)
      if (!assignment) return null
      const conn = connections.find((c) => c.id === cid)
      if (!conn) return null

      const yStart = (assignment.startIndex / Math.max(sessionCount - 1, 1)) * 100
      const yEnd = (assignment.endIndex / Math.max(sessionCount - 1, 1)) * 100

      const colorA = PERM_COLORS[conn.permission.aToB]
      const colorB = PERM_COLORS[conn.permission.bToA]
      const isSingleColor = colorA === colorB

      const isDimmed =
        (hoveredConnectionId !== null && hoveredConnectionId !== cid) ||
        (hoveredSessionId !== null &&
          hoveredSessionId !== conn.sessionA &&
          hoveredSessionId !== conn.sessionB)

      const isHighlighted =
        hoveredConnectionId === cid ||
        (hoveredSessionId !== null &&
          (hoveredSessionId === conn.sessionA || hoveredSessionId === conn.sessionB))

      return {
        cid,
        yStart,
        yEnd,
        colorA,
        colorB,
        isSingleColor,
        isDimmed,
        isHighlighted,
        gradientId: `grad-${cid}`,
      }
    }).filter(Boolean)
  }, [lane.connections, assignments, connections, sessionCount, hoveredConnectionId, hoveredSessionId])

  return (
    <svg className="rail-lane" style={{ left: laneX, width: 8 }}>
      <defs>
        {segments.map((seg) => {
          if (!seg || seg.isSingleColor) return null
          return (
            <linearGradient key={seg.gradientId} id={seg.gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seg.colorA} />
              <stop offset="100%" stopColor={seg.colorB} />
            </linearGradient>
          )
        })}
      </defs>
      {segments.map((seg) => {
        if (!seg) return null
        const stroke = seg.isSingleColor ? seg.colorA : `url(#${seg.gradientId})`
        const strokeWidth = seg.isHighlighted ? 3 : 2
        return (
          <g key={seg.cid}>
            <line
              className={`rail-lane__line${seg.isDimmed ? ' rail-lane__line--dimmed' : ''}`}
              x1={4}
              y1={`${seg.yStart}%`}
              x2={4}
              y2={`${seg.yEnd}%`}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
            {/* 起点圆点 */}
            <circle className="rail-lane__node" cx={4} cy={`${seg.yStart}%`} r={seg.isHighlighted ? 5 : 4} fill={seg.colorA} />
            {/* 终点圆点 */}
            <circle className="rail-lane__node" cx={4} cy={`${seg.yEnd}%`} r={seg.isHighlighted ? 5 : 4} fill={seg.colorB} />
          </g>
        )
      })}
    </svg>
  )
}
