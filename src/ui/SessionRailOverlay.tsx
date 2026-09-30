/**
 * SessionRailOverlay — 会话列表上的「垂直连接」。
 *
 * 用户要求：
 *   - 连上后拖拽线消失，改为在会话列表里保留竖线；
 *   - 风格与拖拽的「水流」线近似（白色半透明 + 光晕 + 微流动）；
 *   - **画在会话行上**，不要挤到最左侧的窄边沟里。
 *
 * 实现：挂 `shell.overlay`（root/list/replaceRisk none，纯覆盖不抢槽位），
 * 测量会话行实际坐标后作画 —— DSH 没暴露行坐标接口，只能实测。
 * id 的来源见 client/row-map.ts。
 */
import { useEffect, useMemo, useState } from 'react'
import { allocateLanes } from '../core/lane-allocator.js'
import type { PermissionLevel } from '../types/index.js'
import type { ConnectionCardHostClient } from '../client/host-client.js'
import type { SessionsBridge } from '../client/sessions-bridge.js'
import { collectSessionRows, type SessionRowInfo } from '../client/row-map.js'
import type { ViewPrefsStore } from '../client/view-prefs.js'
import { useConnections } from './hooks/useConnections.js'
import { useSessionList } from './hooks/useSessionList.js'

interface SessionRailOverlayProps {
  client: ConnectionCardHostClient | null
  sessions: SessionsBridge | null
  /** 视图偏好（lane 上限等），与面板共享同一实例。 */
  prefs: ViewPrefsStore
}

/** 每条 lane 的水平间距（px）。多条连接并行时靠它拉开。 */
const LANE_WIDTH = 9
/** 竖线相对会话行**右边缘**内缩多少（贴行画，不占左侧窄沟）。 */
const ROW_RIGHT_INSET = 14
/** 会话行位置的采样间隔。DOM 没有坐标接口，只能定期量。 */
const MEASURE_INTERVAL_MS = 400

const PERMISSION_COLOR: Record<PermissionLevel, string> = {
  read: '#9CA3AF',
  suggest: '#3B82F6',
  write: '#F97316',
}

/**
 * 会话列表的可见矩形（= 它最近的可滚动祖先的可视区）。
 *
 * ## 为什么需要它
 *
 * 轨道是 `position: fixed`，线段坐标取自会话行的 `getBoundingClientRect()`。
 * 但**行滚出列表可视区后，它的 rect 依然存在**（只是被祖先的 overflow 裁掉了
 * 显示）。于是线会被画到列表之外 —— 用户滚动时看到连线浮在最上层、
 * 压在导航区和「工作区」标题上。
 *
 * 可滚动祖先的 rect 就是行的**可见边界**。把线段裁进去，线就绝不会越界。
 *
 * 顺带的要求：JS 里读不到"元素当前被裁成什么样"，所以只能自己往上找
 * 滚动祖先。找不到（列表没滚动条）时返回 null，调用方按不裁剪处理。
 */
function sessionListRect(): { top: number; bottom: number } | null {
  // 拿任一行往上走；行本身就是树项
  const row = document.querySelector('[role="treeitem"]')
  if (!row) return null

  let el: HTMLElement | null = row.parentElement
  while (el && el !== document.body) {
    const cs = window.getComputedStyle(el)
    const oy = cs.overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    }
    el = el.parentElement
  }
  return null
}

export function SessionRailOverlay({ client, sessions, prefs }: SessionRailOverlayProps) {
  const { connections } = useConnections(client)
  const { snapshot } = useSessionList(sessions)
  const [rows, setRows] = useState<SessionRowInfo[]>([])

  // 量会话行的位置（滚动/缩放/列表变化都要跟上）
  useEffect(() => {
    if (typeof document === 'undefined') return

    // 最近一次「见过」的行位置。某个会话行因状态变化被顶掉标记、或列表重排
    // 造成瞬时缺失时，短时间内仍沿用旧坐标，避免竖线闪断。
    const lastSeen = new Map<string, { info: SessionRowInfo; at: number }>()
    const HOLD_MS = 1500

    const measure = () => {
      const fresh = collectSessionRows(snapshot)
      const now = Date.now()

      for (const info of fresh) lastSeen.set(info.id, { info, at: now })
      for (const [id, entry] of lastSeen) {
        if (now - entry.at > HOLD_MS) lastSeen.delete(id)
      }

      // 用「新鲜 + 仍在保鲜期」的并集作图
      const merged: SessionRowInfo[] = []
      const seen = new Set<string>()
      for (const info of fresh) {
        merged.push(info)
        seen.add(info.id)
      }
      for (const [id, entry] of lastSeen) {
        if (seen.has(id)) continue
        merged.push(entry.info)
      }
      merged.sort((a, b) => a.top - b.top)

      setRows((prev) => {
        if (prev.length === merged.length) {
          let same = true
          for (let i = 0; i < merged.length; i++) {
            const a = prev[i]
            const b = merged[i]
            if (
              a.id !== b.id ||
              Math.abs(a.top - b.top) > 0.5 ||
              Math.abs(a.bottom - b.bottom) > 0.5 ||
              Math.abs(a.right - b.right) > 0.5
            ) {
              same = false
              break
            }
          }
          if (same) return prev
        }
        return merged
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
  }, [snapshot])

  const rail = useMemo(() => {
    if (rows.length < 2 || connections.length === 0) return null

    const sessionOrder = rows.map((r) => r.id)
    const layout = allocateLanes(connections, sessionOrder)
    const rowById = new Map(rows.map((r) => [r.id, r]))

    /**
     * 裁剪矩形：会话列表的**滚动容器**可视区。
     *
     * 为什么必须有：轨道是 `position: fixed`，坐标取自行的
     * `getBoundingClientRect()` —— 而**行滚出列表可视区后它的 rect 依然存在**。
     * 于是线会被画到列表外面：用户滚动时看到连线"浮在最上层"，
     * 压在导航区/工作区标题上（2026-09-30 用户报告）。
     *
     * 滚动容器的 rect 就是行的**可见边界**：行滚出去，它的 rect 就在这个矩形外。
     * 把线段裁进它，线就永远不会画到列表之外。
     */
    const clip = sessionListRect()

    // 画在会话行上：贴着行的右边缘往左排 lane
    const baseX = Math.max(...rows.map((r) => r.right)) - ROW_RIGHT_INSET

    const segments = []
    for (const conn of connections) {
      const assignment = layout.connections.get(conn.id)
      if (!assignment) continue
      const a = rowById.get(conn.sessionA)
      const b = rowById.get(conn.sessionB)
      if (!a || !b) continue

      const rawY1 = (a.top + a.bottom) / 2
      const rawY2 = (b.top + b.bottom) / 2

      // 裁到列表可视区（保留原始上下方向，只收窄区间）
      let yTop = Math.min(rawY1, rawY2)
      let yBot = Math.max(rawY1, rawY2)
      if (clip) {
        yTop = Math.max(yTop, clip.top)
        yBot = Math.min(yBot, clip.bottom)
        // 裁没了就整段丢弃 —— 这正是不该画到列表外的那些
        if (yBot - yTop < 1) continue
      }
      const upward = rawY1 <= rawY2
      const y1 = upward ? yTop : yBot
      const y2 = upward ? yBot : yTop

      const x = baseX - assignment.laneIndex * LANE_WIDTH
      const level = conn.permission.aToB

      segments.push({
        id: conn.id,
        laneIndex: assignment.laneIndex,
        x,
        y1,
        y2,
        top: yTop,
        bottom: yBot,
        color: PERMISSION_COLOR[level] ?? '#9CA3AF',
        broken: conn.status === 'broken',
      })
    }

    if (segments.length === 0) return null

    return {
      segments,
      bounds: {
        left: Math.min(...segments.map((s) => s.x)) - 8,
        right: Math.max(...segments.map((s) => s.x)) + 8,
        top: Math.min(...segments.map((s) => s.top)) - 8,
        bottom: Math.max(...segments.map((s) => s.bottom)) + 8,
      },
    }
  }, [rows, connections])

  // 诊断：**只在出问题时上报**。
  //
  // 早先是无条件每 2 秒报一条，把日志刷爆了。而它已经完成了使命 ——
  // 连续多条 `segments=2 missing=[无]` 证明「运行回复时连线消失」
  // （标记属性被卸载时擦掉）那个 bug 确实修好了。
  // 现在只在「有会话没映射上」或「段数少于连接数」时才报，那才是要查的信号。
  useEffect(() => {
    if (!client) return
    if (connections.length === 0) return
    const short = (s: string) => s.replace(/^session-/, '').slice(0, 8)
    const needed = Array.from(
      new Set(connections.flatMap((c) => [c.sessionA, c.sessionB])),
    )
    const mappedIds = new Set(rows.map((r) => r.id))
    const missing = needed.filter((id) => !mappedIds.has(id))
    const segments = rail?.segments.length ?? 0
    if (missing.length === 0 && segments >= connections.length) return

    client.report(
      `rail 异常 conns=${connections.length} rows=${rows.length} segments=${segments} ` +
        `missing=[${missing.map(short).join(',') || '无'}] ` +
        `mapped=[${rows.map((r) => short(r.id)).join(',')}]`,
    )
  }, [rail, rows, connections, client])

  /** 视图偏好：整条轨道可以一键隐藏（只影响观感，连接本身不动）。 */
  const [railVisible, setRailVisible] = useState(() => prefs.get().railVisible)
  useEffect(
    () => prefs.subscribe(() => setRailVisible(prefs.get().railVisible)),
    [prefs],
  )

  if (!railVisible) return null
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
      <defs>
        <filter id="ccr-rail-glow" x="-80%" y="-30%" width="260%" height="160%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>

      {segments.map((seg) => (
        <g key={seg.id} opacity={seg.broken ? 0.35 : 1}>
          {/* 光晕层：与拖拽拉线的「水汽」同一手法 */}
          <line
            x1={seg.x - bounds.left}
            y1={seg.y1 - bounds.top}
            x2={seg.x - bounds.left}
            y2={seg.y2 - bounds.top}
            stroke="var(--ccr-flow-color, #fff)"
            strokeWidth={5}
            strokeOpacity={0.14}
            strokeLinecap="round"
            filter="url(#ccr-rail-glow)"
          />
          {/* 主线：白色半透明、圆头 —— 风格对齐拖拽线 */}
          <line
            x1={seg.x - bounds.left}
            y1={seg.y1 - bounds.top}
            x2={seg.x - bounds.left}
            y2={seg.y2 - bounds.top}
            stroke="var(--ccr-flow-color, #fff)"
            strokeWidth={2}
            strokeOpacity={0.55}
            strokeLinecap="round"
          />
          {/* 微流动：短划线缓慢下滑，比拖拽线克制 */}
          <line
            x1={seg.x - bounds.left}
            y1={seg.y1 - bounds.top}
            x2={seg.x - bounds.left}
            y2={seg.y2 - bounds.top}
            stroke="var(--ccr-flow-color, #fff)"
            strokeWidth={1.2}
            strokeOpacity={0.45}
            strokeLinecap="round"
            strokeDasharray="10 26"
            className="ccr-rail__flow"
          />
          {/* 两端节点：权限色区分 */}
          {[seg.y1, seg.y2].map((y, i) => (
            <g key={i}>
              <circle
                cx={seg.x - bounds.left}
                cy={y - bounds.top}
                r={4.5}
                fill={seg.color}
                fillOpacity={0.22}
                filter="url(#ccr-rail-glow)"
              />
              <circle
                cx={seg.x - bounds.left}
                cy={y - bounds.top}
                r={2.6}
                fill={seg.color}
                fillOpacity={0.9}
              />
            </g>
          ))}
        </g>
      ))}
    </svg>
  )
}
