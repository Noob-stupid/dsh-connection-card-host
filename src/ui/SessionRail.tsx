/**
 * SessionRail — 左侧轨道。
 * 位置：会话列表左侧，宽度 --rail-width(24px)。
 * 同时显示最多 3 条 lane，超出折叠为 +N。
 */
import type { Connection } from '../types/index.js'
import { useLaneLayout } from './hooks/useLaneLayout.js'
import { RailLane } from './RailLane.js'

interface SessionRailProps {
  connections: Connection[]
  sessions: string[] // sessionOrder（会话 ID 按列表顺序）
  hoveredConnectionId: string | null
  hoveredSessionId: string | null
}

export function SessionRail({
  connections,
  sessions,
  hoveredConnectionId,
  hoveredSessionId,
}: SessionRailProps) {
  const layout = useLaneLayout(connections, sessions)

  return (
    <div className="session-rail" style={{ width: 'var(--rail-width)' }}>
      {layout.lanes.slice(0, 3).map((lane) => (
        <RailLane
          key={lane.index}
          lane={lane}
          assignments={layout.connections}
          connections={connections}
          sessionCount={sessions.length}
          hoveredConnectionId={hoveredConnectionId}
          hoveredSessionId={hoveredSessionId}
        />
      ))}
      {layout.lanes.length > 3 && (
        <div className="session-rail__overflow">+{layout.lanes.length - 3}</div>
      )}
    </div>
  )
}
