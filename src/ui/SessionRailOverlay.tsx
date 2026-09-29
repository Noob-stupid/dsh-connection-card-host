/**
 * SessionRailOverlay — 左侧工作区的「垂直连接」。
 *
 * 用户要求：连上之后拖拽线消失，改为在左侧会话列表里保留一条竖直连线。
 *
 * 实现方式：挂到 `shell.overlay`（root 作用域 / list / replaceRisk none，
 * 只是覆盖一层，不抢任何已有槽位），然后**测量 DOM 里会话行的实际位置**
 * 来定位端点 —— 因为 DSH 没有暴露「会话行坐标」的接口，
 * 而 `[data-session-id]` 是会话行的既有属性（拖拽建连接也用同一个选择器）。
 *
 * lane 分配复用 core/lane-allocator 的贪心区间着色。
 */
import { useEffect, useMemo, useState } from 'react'
import { allocateLanes } from '../core/lane-allocator.js'
import type { PermissionLevel } from '../types/index.js'
import type { ConnectionCardHostClient } from '../client/host-client.js'
import type { SessionsBridge } from '../client/sessions-bridge.js'
import { collectSessionRows, type SessionRowInfo } from '../client/row-map.js'
import { useConnections } from './hooks/useConnections.js'
import { useSessionList } from './hooks/useSessionList.js'

interface SessionRailOverlayProps {
  client: ConnectionCardHostClient | null
  sessions: SessionsBridge | null
}

/** 每条 lane 的水平间距（px）。 */
const LANE_WIDTH = 5
/** rail 相对会话行左边缘的偏移。 */
const RAIL_INSET = 8
/** 会话行位置的采样间隔。DOM 没有坐标接口，只能定期量。 */
const MEASURE_INTERVAL_MS = 400

const PERMISSION_COLOR: Record<PermissionLevel, string> = {
  read: '#9CA3AF',
  suggest: '#3B82F6',
  write: '#F97316',
}

export function SessionRailOverlay({ client, sessions }: SessionRailOverlayProps) {
  const { connections } = useConnections(client)
  const { snapshot } = useSessionList(sessions)
  const [rows, setRows] = useState<SessionRowInfo[]>([])

  // 量会话行的位置（滚动/缩放/列表变化都要跟上）。
  // id 的来源见 client/row-map.ts —— DOM 本身没有会话 id。
  useEffect(() => {
    if (typeof document === 'undefined') return

    const measure = () => {
      const next = collectSessionRows(snapshot.ids)
      setRows((prev) => {
        // 只在真正变化时 setState，避免每 400ms 触发一次无意义渲染
        if (prev.length === next.length) {
          let same = true
          for (let i = 0; i < next.length; i++) {
            const a = prev[i]
            const b = next[i]
            if (
              a.id !== b.id ||
              Math.abs(a.top - b.top) > 0.5 ||
              Math.abs(a.bottom - b.bottom) > 0.5 ||
              Math.abs(a.left - b.left) > 0.5
            ) {
              same = false
              break
            }
          }
          if (same) return prev
        }
        return next
      })
    }

    measure()
    const timer = window.setInterval(measure, MEASURE_INTERVAL_MS)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [snapshot.ids])

  const rail = useMemo(() => {
    if (rows.length < 2 || connections.length === 0) return null

    const sessionOrder = rows.map((r) => r.id)
    const layout = allocateLanes(connections, sessionOrder)
    const rowById = new Map(rows.map((r) => [r.id, r]))

    const railX = Math.max(2, Math.min(...rows.map((r) => r.left)) - RAIL_INSET)

    const segments = []
    for (const conn of connections) {
      const assignment = layout.connections.get(conn.id)
      if (!assignment) continue
      const a = rowById.get(conn.sessionA)
      const b = rowById.get(conn.sessionB)
      if (!a || !b) continue

      const y1 = (a.top + a.bottom) / 2
      const y2 = (b.top + b.bottom) / 2
      const top = Math.min(y1, y2)
      const bottom = Math.max(y1, y2)
      // 两个端点太近就不画线（只画两个点）
      const x = railX + assignment.laneIndex * LANE_WIDTH
      const level = conn.permission.aToB

      segments.push({
        id: conn.id,
        x,
        y1,
        y2,
        top,
        bottom,
        color: PERMISSION_COLOR[level] ?? '#9CA3AF',
        broken: conn.status === 'broken',
      })
    }

    if (segments.length === 0) return null

    const bounds = {
      left: Math.min(...segments.map((s) => s.x)) - 6,
      right: Math.max(...segments.map((s) => s.x)) + 6,
      top: Math.min(...segments.map((s) => s.top)) - 6,
      bottom: Math.max(...segments.map((s) => s.bottom)) + 6,
    }
    return { segments, bounds }
  }, [rows, connections])

  if (!rail) return null

  const { segments, bounds } = rail
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top

  return (
    <svg
      className="ccr-rail-overlay"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: bounds.left,
        top: bounds.top,
        width,
        height,
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
    >
      {segments.map((seg) => (
        <g key={seg.id} opacity={seg.broken ? 0.35 : 1}>
          {/* 竖线主体：细、半透明，贴着背景色，不抢视线 */}
          <line
            x1={seg.x - bounds.left}
            y1={seg.y1 - bounds.top}
            x2={seg.x - bounds.left}
            y2={seg.y2 - bounds.top}
            stroke={seg.color}
            strokeWidth={1.5}
            strokeOpacity={0.4}
            strokeLinecap="round"
          />
          {/* 两端节点 */}
          {[seg.y1, seg.y2].map((y, i) => (
            <circle
              key={i}
              cx={seg.x - bounds.left}
              cy={y - bounds.top}
              r={2.6}
              fill={seg.color}
              fillOpacity={0.75}
            />
          ))}
        </g>
      ))}
    </svg>
  )
}
