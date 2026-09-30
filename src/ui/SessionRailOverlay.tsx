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
 * 滚动祖先。
 *
 * ## 为什么不返回 null（2026-09-30 复核修正）
 *
 * 早先版本"找不到滚动祖先就返回 null，调用方按不裁剪处理" —— 那条路径
 * **正好把 bug 原样放回来**：列表当前不可滚（会话少）、或滚动容器是更外层的
 * 祖先时，线又会画到列表外面。现在：
 *   1. 「能滚」的祖先优先（那才是列表视口）；
 *   2. 退而求其次用「会裁」的祖先（overflow 不是 visible 就构成可见边界）；
 *   3. 都没有就用**窗口视口**；
 *   4. 最后再与窗口视口求交 —— 列表本身也可能被窗口裁掉一截。
 * 即：**永远返回一个矩形**，不存在"不裁剪"的分支。
 */
function sessionListRect(): { top: number; left: number; right: number; bottom: number } {
  const viewport = {
    top: 0,
    left: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  }

  // 拿任一行往上走；行本身就是树项
  const row = document.querySelector('[role="treeitem"]')
  if (!row) return viewport

  type Rect = { top: number; left: number; right: number; bottom: number }
  let scrollable: Rect | null = null
  let clipping: Rect | null = null

  let el: HTMLElement | null = row.parentElement
  while (el && el !== document.body) {
    const cs = window.getComputedStyle(el)
    const oy = cs.overflowY
    const clips = oy !== 'visible' || cs.overflowX !== 'visible'
    if (clips) {
      const r = el.getBoundingClientRect()
      if (
        scrollable === null &&
        (oy === 'auto' || oy === 'scroll') &&
        el.scrollHeight > el.clientHeight + 1
      ) {
        scrollable = { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
      }
      if (clipping === null) {
        clipping = { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
      }
    }
    el = el.parentElement
  }

  const own = scrollable ?? clipping ?? viewport
  return {
    top: Math.max(own.top, viewport.top),
    left: Math.max(own.left, viewport.left),
    right: Math.min(own.right, viewport.right),
    bottom: Math.min(own.bottom, viewport.bottom),
  }
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
      const x = baseX - assignment.laneIndex * LANE_WIDTH

      // 线：裁到列表可视区（保留原始上下方向，只收窄区间）。
      // 竖直直线的「裁」与「端点收到边界」像素等价，所以线这一段是对的。
      let yTop = Math.min(rawY1, rawY2)
      let yBot = Math.max(rawY1, rawY2)
      yTop = Math.max(yTop, clip.top)
      yBot = Math.min(yBot, clip.bottom)
      // 裁没了就整段丢弃 —— 这正是不该画到列表外的那些
      if (yBot - yTop < 1) continue
      // 水平方向同理：lane 排到可视区外（列表横向滚过）也不画
      if (x < clip.left - 8 || x > clip.right + 8) continue

      const upward = rawY1 <= rawY2
      const y1 = upward ? yTop : yBot
      const y2 = upward ? yBot : yTop

      const level = conn.permission.aToB

      segments.push({
        id: conn.id,
        laneIndex: assignment.laneIndex,
        x,
        y1,
        y2,
        top: yTop,
        bottom: yBot,
        /**
         * 端点圆点画在**行的真实中心**，不是被收窄过的区间端点。
         *
         * 为什么区分（2026-09-30 复核修正）：线收窄到边界在视觉上等于裁剪，
         * 但**圆点不行** —— 收窄会把圆点钉在列表边界上，看起来像"线的端点标记"，
         * 而它本该标记的是那一行。行滚出去时它应当跟着走、并被裁掉。
         * 真实坐标 + 画布裁剪 = 圆点随行移动、越界自然消失。
         */
        dotTop: Math.min(rawY1, rawY2),
        dotBottom: Math.max(rawY1, rawY2),
        color: PERMISSION_COLOR[level] ?? '#9CA3AF',
        broken: conn.status === 'broken',
      })
    }

    if (segments.length === 0) return null

    /**
     * 画布 = 内容真实外接矩形 ∩ 列表可视区。
     *
     * 与可视区求交之后配合 `overflow: hidden`，**任何**越出列表的形状都被统一
     * 裁掉（滚出去的端点圆点、光晕的模糊外溢、以及以后新加的形状），
     * 不依赖"每个形状各自记得裁剪"。留 8px 内边距给光晕，只在边界处切断。
     */
    const MARGIN = 8
    const bounds = {
      left: Math.max(Math.min(...segments.map((s) => s.x)) - MARGIN, clip.left),
      right: Math.min(Math.max(...segments.map((s) => s.x)) + MARGIN, clip.right),
      top: Math.max(Math.min(...segments.map((s) => s.dotTop)) - MARGIN, clip.top),
      bottom: Math.min(Math.max(...segments.map((s) => s.dotBottom)) + MARGIN, clip.bottom),
    }
    // 内容与可视区完全不相交（全滚出去了）：不必渲染
    if (bounds.bottom - bounds.top < 1 || bounds.right - bounds.left < 1) return null

    return { segments, bounds }
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
    // rows=0 是渲染的**瞬时状态**（重挂载、切换工作区等），报它没有意义 ——
    // 会喊狼来了的诊断比没有诊断更糟。
    if (rows.length === 0) return
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
        // hidden（不是 visible）：画布已经是「内容 ∩ 列表可视区」，
        // 越界的形状（尤其滚出去的端点圆点）必须在这里被统一裁掉 ——
        // 这就是"线永远不会画到列表之外"的最后一道保证。
        overflow: 'hidden',
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
          {/* 两端节点：权限色区分。用**行的真实中心**坐标 —— 越界的由画布裁剪掉 */}
          {[seg.dotTop, seg.dotBottom].map((y, i) => (
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
