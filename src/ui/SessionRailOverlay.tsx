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
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { allocateLanes } from '../core/lane-allocator.js'
import type { PermissionLevel } from '../types/index.js'
import type { ConnectionCardHostClient } from '../client/host-client.js'
import type { SessionsBridge } from '../client/sessions-bridge.js'
import { sessionLabel } from '../client/sessions-bridge.js'
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

/** 权限色对应的文字 —— 悬停提示里用，光有颜色说不清。 */
const PERMISSION_TEXT: Record<PermissionLevel, string> = {
  read: '只读（只能感知，不能收发消息）',
  suggest: '可建议（能发言，不能派活）',
  write: '可写入（能发言，也能请求对方做事）',
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
  const merged = {
    top: Math.max(own.top, viewport.top),
    left: Math.max(own.left, viewport.left),
    right: Math.min(own.right, viewport.right),
    bottom: Math.min(own.bottom, viewport.bottom),
  }

  /*
   * ⚠️ 退化护栏（2026-10-02 加）。
   *
   * `own` 可能是**零宽/零高**，或者整个跑到屏幕外 —— 那时 `merged` 会**反向**
   * （right < left 或 bottom < top）。反向的 clip 会把**每一条**线段都判成
   * "裁没了"或"横向出界"，而下游还会因为 `bounds` 退化成 < 1 而返回 null
   * —— 表现就是**连接都在、行也都在、却一条线都不画**，
   * 正好是 2026-10-02 那 1806 条 `conns=3 rows=18 segments=0 missing=[无]`。
   *
   * 拿不准就退回 viewport：宁可画到列表外（有 overflow:hidden 兜着），
   * 也不要整层空白。
   */
  if (merged.right - merged.left < 1 || merged.bottom - merged.top < 1) {
    return viewport
  }

  return merged
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

    const segments: {
      id: string
      laneIndex: number
      x: number
      y1: number
      y2: number
      top: number
      bottom: number
      dotTop: number
      dotBottom: number
      /** 上端点的颜色（= 上端那一方**能对对方做什么**）。 */
      topColor: string
      /** 下端点的颜色。与 topColor 可以不同 —— 权限是分方向的。 */
      bottomColor: string
      /** 端点的悬停提示（连的是谁 + 什么权限）。 */
      topTip: string
      bottomTip: string
      broken: boolean
    }[] = []

    /**
     * 被跳过的连接及其**原因**。
     *
     * 为什么要有它：原来诊断只报 `segments=0`，但**五个 `continue` 哪个中的无从得知** ——
     * 2026-10-02 那份 1806 条 `conns=3 rows=18 segments=0 missing=[无]` 的日志
     * 就是这个毛病：证据齐全、但指不出病灶，只能靠猜。
     *
     * 现在把每条被跳过的连接连同**判定时的实际数字**记下来
     * （clip / x / yTop / yBot），下次出现就能直接定位。
     */
    const skips: string[] = []
    const shortId = (s: string) => s.replace(/^session-/, '').slice(0, 8)

    for (const conn of connections) {
      const assignment = layout.connections.get(conn.id)
      if (!assignment) {
        skips.push(`${shortId(conn.id)}:未分到 lane`)
        continue
      }
      const a = rowById.get(conn.sessionA)
      const b = rowById.get(conn.sessionB)
      if (!a || !b) {
        skips.push(`${shortId(conn.id)}:行未映射(${a ? '' : shortId(conn.sessionA)}${
          !a && !b ? '+' : ''
        }${b ? '' : shortId(conn.sessionB)})`)
        continue
      }

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
      if (yBot - yTop < 1) {
        skips.push(
          `${shortId(conn.id)}:纵向裁没(y=${Math.round(rawY1)}→${Math.round(rawY2)} ` +
            `clip=${Math.round(clip.top)}~${Math.round(clip.bottom)})`,
        )
        continue
      }
      // 水平方向同理：lane 排到可视区外（列表横向滚过）也不画
      if (x < clip.left - 8 || x > clip.right + 8) {
        skips.push(
          `${shortId(conn.id)}:横向出界(x=${Math.round(x)} ` +
            `clip=${Math.round(clip.left)}~${Math.round(clip.right)})`,
        )
        continue
      }

      const upward = rawY1 <= rawY2
      const y1 = upward ? yTop : yBot
      const y2 = upward ? yBot : yTop

      /**
       * 两端圆点各自显示**自己那个方向**的权限。
       *
       * ⚠️ 原来两端都用 `aToB` —— 那是错的：不对称连接下，B 端的点会显示
       * A→B 的权限，等于告诉你一个跟这一端无关的数字。
       * 正确语义：**这个点代表"这一端能对对方做什么"**。
       *
       * 谁是 A 端：`conn.sessionA` 那一行（上行 = y1 那一端）。
       */
      const aOnTop = upward
      const topLevel = aOnTop ? conn.permission.aToB : conn.permission.bToA
      const bottomLevel = aOnTop ? conn.permission.bToA : conn.permission.aToB
      const peerOfTop = aOnTop ? conn.sessionB : conn.sessionA
      const peerOfBottom = aOnTop ? conn.sessionA : conn.sessionB

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
        /** 两个端点各自的颜色与提示（分方向，不再是同一个值）。 */
        topColor: PERMISSION_COLOR[topLevel] ?? '#9CA3AF',
        bottomColor: PERMISSION_COLOR[bottomLevel] ?? '#9CA3AF',
        topTip: `与「${sessionLabel(sessions, peerOfTop, snapshot)}」相连 · ${PERMISSION_TEXT[topLevel] ?? topLevel}`,
        bottomTip: `与「${sessionLabel(sessions, peerOfBottom, snapshot)}」相连 · ${PERMISSION_TEXT[bottomLevel] ?? bottomLevel}`,
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
    if (bounds.bottom - bounds.top < 1 || bounds.right - bounds.left < 1) {
      /*
       * ⚠️ 这里返回 null，而诊断读的是 `rail?.segments.length ?? 0` ——
       * 所以 **null 和"线段数组为空"在日志里长得一模一样**（都是 segments=0）。
       * 那正是 2026-10-02 那批日志指不出病灶的原因之一：把 `skips` 一起带出去，
       * 至少能区分"被逐条跳过"和"算出来了但边界退化"。
       */
      return { segments: [], bounds: null, skips: [...skips, `边界退化(bounds=${Math.round(bounds.left)}~${Math.round(bounds.right)},${Math.round(bounds.top)}~${Math.round(bounds.bottom)} clip=${Math.round(clip.left)}~${Math.round(clip.right)})`] }
    }

    return { segments, bounds, skips }
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
        // 关键：把"为什么画不出来"一起报出去（原来只有数字，指不出病灶）
        `skips=[${(rail?.skips ?? []).join(' | ') || '无'}] ` +
        `mapped=[${rows.map((r) => short(r.id)).join(',')}]`,
    )
  }, [rail, rows, connections, client])

  /**
   * 是否已上报过遮挡诊断 —— **每次挂载只打一行**，不刷屏。
   *
   * （原来是"段数变化就打"，但那会在 1→2→1 这种抖动下重复。
   * 这条诊断的使命是"确认一次绘制顺序"，一次就够。）
   */
  const railDiagRef = useRef(false)

  /**
   * 轨道的专用宿主 —— **追加为 `document.body` 的最后一个子节点**。
   *
   * 见渲染末尾那段长注释：只 portal 到 `body` 不够（会被应用根节点盖住），
   * 必须**排在应用根之后**（同层级后者胜）**且**带接近上限的 z-index。
   *
   * 这个宿主独立于 DSH 的任何槽位容器 —— 轨道的堆叠因此与"哪个槽位在上面"
   * 彻底解耦，不会被别人的皮肤/叠加层按堆叠上下文压住。
   */
  const hostRef = useRef<HTMLDivElement | null>(null)
  if (typeof document !== 'undefined' && !hostRef.current) {
    const el = document.createElement('div')
    el.className = 'ccr-rail-host'
    // 宿主自己也要 fixed + 高 z-index：光抬 svg 的不够 ——
    // 真正比的是"宿主所在上下文 vs 应用根所在上下文"。
    el.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483000;'
    document.body.appendChild(el)
    hostRef.current = el
  }
  // 卸载时移除宿主：不留 DOM 垃圾，也避免热重载堆积多个宿主
  useEffect(
    () => () => {
      hostRef.current?.remove()
      hostRef.current = null
    },
    [],
  )

  /** 视图偏好：整条轨道可以一键隐藏（只影响观感，连接本身不动）。 */
  const [railVisible, setRailVisible] = useState(() => prefs.get().railVisible)
  useEffect(
    () => prefs.subscribe(() => setRailVisible(prefs.get().railVisible)),
    [prefs],
  )

  /**
   * 遮挡诊断：**画出来了但看不见**时用。
   *
   * 与 rail 的 `skips=` 诊断互补 —— 那个答的是"为什么没算出来"，
   * 这个答的是"算出来了为什么看不到"。
   *
   * ## ⚠️ 方法论（这一条我和对端各栽过一次，留给后来人）
   *
   * **测「绘制顺序」不能用 `elementsFromPoint`** ——
   * 它会**跳过 `pointer-events: none` 的元素**，而我们的宿主与 svg 恰恰都是 `none`。
   * 于是那个栈测的是「**谁能被点到**」而不是「**谁画在上面**」，
   * 轨道**再高也永远不会出现在里面**。
   *
   * 这个盲点害我们下过**两次错误结论**：
   *   ① 见栈顶是 `div.skin-wallpaper` → 断定"轨道被壁纸遮住"（据此还改了宿主）
   *   ② 见栈顶是 `div.hIlkoa_sessionRow` → 断定"轨道输给了会话行"
   * 两次都不成立 —— 栈里出现谁，只说明"谁能被点到"。
   *
   * **正确做法二选一**：
   *   · **临时放开命中**：测量瞬间置 `pointerEvents='auto'` → 取栈 → `finally` 恢复
   *     （本函数采用的就是这条）
   *   · **纯计算**：逐级比较两元素所在堆叠上下文链的 `z-index / position / transform`
   *
   * 记住一句话：**命中测试的栈 ≠ 绘制顺序的栈。**
   *
   * 触发时机：每次挂载**只打一行**（它的使命是"确认一次绘制顺序"）。
   * 内容：画布 rect / 计算样式 z-index-opacity-display / 段数与首段端点 /
   * 宿主与应用根的层级 / 首段中点的 `elementsFromPoint` 栈顶 3 层。
   */
  useEffect(() => {
    if (!client) return
    const n = rail?.segments.length ?? 0
    if (n === 0) return
    if (railDiagRef.current) return
    railDiagRef.current = true
    const seg = rail!.segments[0]!
    const midX = seg.x
    const midY = (seg.y1 + seg.y2) / 2
    let top3 = 'n/a'
    let svgStyle = 'n/a'
    /** 宿主与"应用根"的层级对比 —— 谁在谁上面要完全可见。 */
    let hostInfo = 'n/a'
    try {
      const svgEl = document.querySelector('.ccr-rail-overlay') as SVGElement | null

      /*
       * ⚠️ **测量前临时放开命中**（2026-10-02，对方指出的构造性盲点）。
       *
       * 我们的宿主与 svg 都是 `pointer-events: none`，而
       * **`elementsFromPoint` 会跳过这类元素** —— 所以不放开的话，
       * 轨道**再高也永远不会出现在栈里**：那个栈测的是"**谁能被点到**"，
       * 不是"**谁画在上面**"。
       *
       * 这曾导致一个错误结论（我自己下的、后来被对方更正）：
       * 看到栈顶是 `div.skin-wallpaper` 就断定"轨道被壁纸遮住" ——
       * 其实那只能说明"壁纸能被点到"，与轨道的绘制顺序无关。
       *
       * 所以：测量瞬间把 host + svg 的 pointer-events 放开 → 取栈 → **立刻恢复**。
       * `finally` 保证异常路径也会恢复，不留状态。
       */
      const hostEl = hostRef.current
      const hostPe = hostEl?.style.pointerEvents ?? ''
      const svgPe = svgEl?.style.pointerEvents ?? ''
      if (hostEl) hostEl.style.pointerEvents = 'auto'
      if (svgEl) svgEl.style.pointerEvents = 'auto'
      try {
        const stack = document.elementsFromPoint(midX, midY).slice(0, 3)
        top3 = stack
          .map(
            (e) =>
              `${e.tagName.toLowerCase()}${
                e.getAttribute('class') ? `.${(e.getAttribute('class') ?? '').split(/\s+/)[0]}` : ''
              }`,
          )
          .join(' | ')
      } finally {
        if (hostEl) hostEl.style.pointerEvents = hostPe
        if (svgEl) svgEl.style.pointerEvents = svgPe
      }

      if (svgEl) {
        const cs = window.getComputedStyle(svgEl)
        svgStyle = `z=${cs.zIndex} op=${cs.opacity} disp=${cs.display}`
      }
      // 宿主自身：z-index / 是否还挂在 DOM 上 / 在 body 子节点里的索引
      const host = hostRef.current
      if (host) {
        const hcs = window.getComputedStyle(host)
        const idx = Array.prototype.indexOf.call(document.body.children, host)
        hostInfo = `host[z=${hcs.zIndex} conn=${host.isConnected} idx=${idx}/${
          document.body.children.length - 1
        }]`
      }
      // 应用根（常见几个）的 z-index —— 用来判断"谁建立了堆叠上下文"
      const root = document.querySelector('#root,#app,[data-reactroot]')
      if (root) {
        const rcs = window.getComputedStyle(root)
        hostInfo += ` root[z=${rcs.zIndex} pos=${rcs.position} tf=${
          rcs.transform === 'none' ? 'none' : 'yes'
        }]`
      }
    } catch {
      /* 诊断失败不影响渲染 */
    }
    const r = rail!.bounds
    client.report(
      `rail 遮挡诊断 segs=${n} bounds={x:${Math.round(r?.left ?? 0)},y:${Math.round(
        r?.top ?? 0,
      )},w:${Math.round((r?.right ?? 0) - (r?.left ?? 0))},h:${Math.round(
        (r?.bottom ?? 0) - (r?.top ?? 0),
      )}} ${svgStyle} 首段=(${Math.round(seg.x)},${Math.round(seg.y1)})~(${Math.round(
        seg.x,
      )},${Math.round(seg.y2)}) ${hostInfo} 中点栈顶3层=[${top3}]`,
    )
  }, [client, rail])

  if (!railVisible) return null
  if (!rail) return null

  const { segments, bounds } = rail
  // bounds 为 null = 边界退化（见 useMemo 里的说明）→ 没东西可画
  if (!bounds) return null
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top

  const svg = (
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
        zIndex: 9999,
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
          {/* 两端节点：**各端显示各自方向的权限**，悬停告诉你连的是谁 */}
          {(
            [
              [seg.dotTop, seg.topColor, seg.topTip],
              [seg.dotBottom, seg.bottomColor, seg.bottomTip],
            ] as const
          ).map(([y, color, tip], i) => (
            <g key={i}>
              {/*
                SVG 的 <title> 就是原生悬停提示。
                用户反馈过：圆点只说"权限"不说"连的是谁"，
                多条连接并存时分不清哪个点跟自己有关（曾误以为连错了会话）。
              */}
              <title>{tip}</title>
              <circle
                cx={seg.x - bounds.left}
                cy={y - bounds.top}
                r={4.5}
                fill={color}
                fillOpacity={0.22}
                filter="url(#ccr-rail-glow)"
              />
              <circle
                cx={seg.x - bounds.left}
                cy={y - bounds.top}
                r={2.6}
                fill={color}
                fillOpacity={0.9}
              />
            </g>
          ))}
        </g>
      ))}
    </svg>
  )

  /*
   * ⚠️ **专用宿主 + 追加为 body 最后一个子节点**（2026-10-02 第二版修法）。
   *
   * ## 为什么"只 portal 到 body"还不够 —— 被实测打回来了
   *
   * 第一版直接 createPortal(svg, document.body)，诊断读数是：
   *
   *     div.skin-wallpaper 不再在栈里 ✓        ← 壁纸遮挡解决
   *     但栈顶变成 span.hIlkoa_time | div.hIlkoa_sessionRow   ← 输给了应用内容
   *
   * 物理含义：轨道是 x=254 一条**竖线**（bounds 只 16px 宽），会话行是**通栏**的 ——
   * 行不透明时，线只在**行与行的缝里**透出来，等于看不见。
   * （这也解释了 skin-off 时为何可见：那时轨道在 shell.overlay 槽位里，本就压在行之上。）
   *
   * ## 两个要点，缺一不可
   *
   * ① **追加为 document.body 的最后一个子节点** ——
   *    若应用根节点（#root/#app 之类）**自身建立了堆叠上下文**或带 z-index，
   *    那么**先挂上去的 body 子节点仍会被它盖住**。同层级下**后者胜**，
   *    所以"排在它后面"与"高 z-index"一样重要。
   * ② **接近上限的 z-index** —— 压过任何正常应用的层级。
   *    2147483000 是离 32 位上限还有余量的值（留出调试空间）。
   *
   * 坐标不受影响：svg 仍是 position: fixed + getBoundingClientRect() 视口坐标。
   * 宿主与 svg 都 pointer-events: none —— 不挡任何交互。
   *
   * 宿主随组件卸载而移除（见上面的 cleanup effect），不留 DOM 垃圾。
   */
  const host = hostRef.current
  if (!host) return null
  return createPortal(svg, host)
}
