/**
 * dsh-connection-card-host — 浏览器端入口。
 *
 * 槽位注册（都挑 kind=list / replaceRisk=none 的追加位，不抢出厂 UI）：
 *   - conversation.input.left : 输入框工具行左侧的连接锚点（小圆点）
 *   - sidebar.panellist       : 侧栏图标 —— **只放图标**，点击由侧栏负责切主面板
 *   - main (key=同 id)        : 真正的连接管理面板
 *   - shell.overlay           : 左侧会话列表上的竖直连接线（覆盖层）
 *
 * 宿主数据经 DSH 官方 Connection RPC 通道读取（ctx.connection.rpc）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { AnchorCircle } from '../ui/AnchorCircle.js'
import { DragLine } from '../ui/DragLine.js'
import { ConnectionPanel } from '../ui/ConnectionPanel.js'
import { ConnectionPanelIcon } from '../ui/ConnectionPanelIcon.js'
import { SessionRailOverlay } from '../ui/SessionRailOverlay.js'
import { SessionRowMarker } from '../ui/SessionRowMarker.js'
import { useDragLine } from '../ui/hooks/useDragLine.js'
import { createHostClient, resolveRpcCaller } from './host-client.js'
import { resolveSessions } from './sessions-bridge.js'
import { sessionRowAtPoint } from './row-map.js'
import { injectStyles } from '../styles/tokens.js'
import { safeCtxGet } from '../safe-ctx.js'

/** 侧栏图标 id 与主面板 key 必须一致，侧栏才能找到对应面板。 */
const PANEL_ID = 'connection-panel'

type ClientContext = Context & {
  slots: {
    inject(slotName: string, callback: () => unknown): void
    register(
      spec: {
        name: string
        /** list 槽位的单元键 */
        id?: string
        /** keyed 槽位的键（main 用） */
        key?: string
        order?: number
        label?: string | (() => string)
      },
      componentFactory: (props?: unknown) => unknown,
    ): unknown
  }
}

/** 需要 slots 注入 UI，connection 提供宿主 RPC，sessions 提供会话身份。 */
export const inject = ['slots', 'connection', 'sessions']

const STYLE_TAG_ID = 'dsh-connection-card-host-styles'

/**
 * 布局探针：把锚点往上 5 层祖先的尺寸记下来。
 *
 * 用户反馈「拖拽时整个输入区域在动」，但看不到屏幕，只能靠这个定位
 * 究竟是哪一层盒子被撑开/移位（例如脉冲光环没被绝对定位、样式表丢失等）。
 */
function layoutSnapshot(): string {
  const parts: string[] = []
  const styleTag = document.getElementById(STYLE_TAG_ID)
  parts.push(`style=${styleTag ? 'yes' : 'MISSING'}`)

  const anchor = document.querySelector('.ccr-anchor')
  if (!anchor) {
    parts.push('anchor=absent')
    return parts.join(' ')
  }

  const fmt = (el: Element): string => {
    const r = el.getBoundingClientRect()
    return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`
  }

  parts.push(`anchor=${fmt(anchor)}`)
  // 脉冲元素是否存在、是否脱离文档流（position:absolute 才算正常）
  const pulse = anchor.querySelector('.ccr-anchor__pulse')
  parts.push(
    pulse
      ? `pulse=${fmt(pulse)}/${
          window.getComputedStyle(pulse).position
        }`
      : 'pulse=none',
  )

  let node: Element | null = anchor.parentElement
  for (let i = 0; node && i < 5; i++) {
    parts.push(`up${i + 1}=${node.tagName.toLowerCase()}.${(node.className || '').toString().split(' ')[0]}:${fmt(node)}`)
    node = node.parentElement
  }
  return parts.join(' ')
}

export function apply(ctx: ClientContext): void {
  const rpc = resolveRpcCaller(ctx)
  const client = rpc ? createHostClient(rpc) : null
  const sessions = resolveSessions(ctx)

  if (!rpc) {
    ctx.logger?.warn?.(
      '[connection-card-host] ctx.connection.rpc 不可用；面板将无法读取宿主连接',
    )
  }
  if (!sessions) {
    ctx.logger?.warn?.(
      '[connection-card-host] ctx.sessions 不可用；拖拽落点与会话选择器将受限',
    )
  }

  // 样式注入：CSS 作为字符串打进 bundle，运行时挂 <style>。
  // 关键几何另有内联兜底，注入失败也不会出现"看不见的控件"。
  try {
    const removeStyles = injectStyles()
    const effect = safeCtxGet<(fn: () => () => void, label?: string) => unknown>(ctx, 'effect')
    if (typeof effect === 'function') effect(() => removeStyles, 'connection-card-host: styles')
  } catch (e) {
    ctx.logger?.warn?.(`[connection-card-host] 样式注入失败: ${String(e)}`)
  }

  // ═══ 小圆点 + 拖拽拉线 ═══
  //
  // `sessionId` 来自槽位的 standardProps —— conversation.input.left 是 session 作用域，
  // 官方直接把当前会话 id 传进来了。**不要**去读 ctx.sessions 快照的 current 字段：
  // 实测该字段在当前 DSH 构建里是 undefined（详见 client-debug.log 的 current=none）。
  const AnchorWidget = ({ sessionId }: { sessionId?: string }) => {
    const drag = useDragLine()
    const [lineDone, setLineDone] = useState(false)
    // 当前被高亮的会话行（拖拽落点提示）
    const highlightedRef = useRef<Element | null>(null)

    const clearHighlight = useCallback(() => {
      highlightedRef.current?.classList.remove('ccr-target')
      highlightedRef.current = null
    }, [])

    /** 落点解析：目标会话 + 起点会话 + 失败原因（诊断用）。 */
    const resolveDrop = useCallback(
      (x: number, y: number) => {
        const snap = sessions?.getSnapshot()
        const hit = sessionRowAtPoint(x, y, snap ?? null)
        // 起点优先用槽位给的 sessionId，快照 current 只作兜底
        const sourceId = sessionId ?? snap?.current ?? null
        let reason: string
        if (!sessions) reason = 'no-sessions-bridge'
        else if (!hit) reason = 'no-row-under-cursor'
        else if (!sourceId) reason = 'no-current-session'
        else if (hit.id === sourceId) reason = 'same-session'
        else reason = 'ok'
        return { hit, sourceId, reason, idCount: snap?.ids?.length ?? 0 }
      },
      [sessions, sessionId],
    )

    const beginDrag = useCallback(
      (x: number, y: number) => {
        setLineDone(false)
        if (client) {
          const snap = sessions?.getSnapshot()
          client.report(
            `dragStart slotSessionId=${sessionId ?? 'none'} snapshotCurrent=${snap?.current ?? 'none'} ` +
              `ids=${snap?.ids?.length ?? 0} ` +
              `rows=${document.querySelectorAll('[role="treeitem"]').length} ` +
              `marked=${document.querySelectorAll('[data-ccr-session]').length}`,
          )
        }
        drag.onMouseDown(x, y)
      },
      [drag, client, sessions, sessionId],
    )

    /** 松手：命中会话行就建连接。起点取 DSH 的当前会话。 */
    const finishAt = useCallback(
      (x: number, y: number) => {
        const { hit, sourceId, reason, idCount } = resolveDrop(x, y)
        if (client) {
          client.report(
            `dragEnd reason=${reason} hit=${hit?.id ?? 'none'} source=${sourceId ?? 'none'} ids=${idCount}`,
          )
        }
        if (reason === 'ok' && hit && sourceId) {
          void client
            ?.createConnection(sourceId, hit.id)
            .then(() => client?.report(`dragEnd created ${sourceId} <-> ${hit.id}`))
            .catch((err) => {
              client?.report(`dragEnd create-failed ${String(err)}`)
              console.error('[connection-card-host] 建立连接失败:', err)
            })
        }
        clearHighlight()
      },
      [client, resolveDrop, clearHighlight],
    )

    /** 拖拽中的落点高亮。 */
    const trackTarget = useCallback(
      (x: number, y: number) => {
        const { hit, sourceId } = resolveDrop(x, y)
        const next = hit && hit.id !== sourceId ? hit.element : null
        if (next !== highlightedRef.current) {
          highlightedRef.current?.classList.remove('ccr-target')
          next?.classList.add('ccr-target')
          highlightedRef.current = next
        }
      },
      [resolveDrop],
    )

    // 把最新的处理函数放进 ref：下面的全局监听只依赖 `dragging` 一个开关。
    // ⚠️ 之前把整个 `drag` 对象放进依赖数组 —— useDragLine 每次渲染都返回新对象，
    // 于是每次 mousemove 都触发 effect 清理+重挂，cleanup 里的 clearHighlight()
    // 刚加上高亮就把它抹掉，落点提示永远看不见。
    const handlersRef = useRef({ drag, trackTarget, finishAt, clearHighlight })
    handlersRef.current = { drag, trackTarget, finishAt, clearHighlight }

    // 鼠标拖拽
    useEffect(() => {
      if (!drag.state.dragging) return

      const onMove = (e: MouseEvent) => {
        const h = handlersRef.current
        h.drag.onMouseMove(e.clientX, e.clientY)
        h.trackTarget(e.clientX, e.clientY)
      }
      const onUp = (e: MouseEvent) => {
        const h = handlersRef.current
        h.finishAt(e.clientX, e.clientY)
        h.drag.onMouseUp()
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          handlersRef.current.clearHighlight()
          handlersRef.current.drag.onMouseUp()
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('keydown', onKey)

      // 拖拽期间锁住文本选择：否则鼠标划过页面会选中文字、触发自动滚动，
      // 观感就是「一拖拽整个界面在跑」。
      const prevUserSelect = document.body.style.userSelect
      const prevCursor = document.body.style.cursor
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'grabbing'

      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('keydown', onKey)
        document.body.style.userSelect = prevUserSelect
        document.body.style.cursor = prevCursor
        // 故意不在这里 clearHighlight：这个 cleanup 会在拖拽期间反复触发
      }
    }, [drag.state.dragging])

    // 拖拽结束才清高亮（单独一个 effect，与监听生命周期解耦）
    useEffect(() => {
      if (!drag.state.dragging) clearHighlight()
    }, [drag.state.dragging, clearHighlight])

    // 触屏拖拽（8px 阈值 + 16px 锚点半径在 useDragLine 内判定）
    useEffect(() => {
      if (!drag.state.dragging) return

      const onMove = (e: TouchEvent) => {
        const t = e.touches[0]
        if (!t) return
        const h = handlersRef.current
        if (h.drag.onTouchMove(t.clientX, t.clientY)) e.preventDefault()
        h.trackTarget(t.clientX, t.clientY)
      }
      const onEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0]
        const h = handlersRef.current
        if (t) h.finishAt(t.clientX, t.clientY)
        h.drag.onTouchEnd()
      }

      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onEnd)
      return () => {
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onEnd)
      }
    }, [drag.state.dragging])

    const showLine = Boolean(drag.state.start && drag.state.current && !lineDone)

    return (
      <>
        <AnchorCircle
          dragging={drag.state.dragging}
          onDragStart={beginDrag}
          onTouchStart={drag.onTouchStart}
          onTouchMove={drag.onTouchMove}
          onTouchEnd={drag.onTouchEnd}
        />
        {showLine && drag.state.start && drag.state.current && (
          <DragLine
            start={drag.state.start}
            end={drag.state.current}
            releasing={!drag.state.dragging}
            onComplete={() => setLineDone(true)}
          />
        )}
      </>
    )
  }

  const stableClient = client
  const stableSessions = sessions

  // ═══ 槽位注册 ═══
  //
  // conversation.input.left：composer 工具行左侧的紧凑控件区。
  //   kind=list / replaceRisk=none —— 自己的 id 会被「追加」在出厂控件旁边。
  //   ⚠️ 不要用 conversation.input.activity：single + shadows-shipped-ui，
  //   占位即替换出厂的活动指示器，且出厂 UI 先注册时会直接抛异常。
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      { name: 'conversation.input.left', id: 'connection-anchor', order: 100, label: '连接' },
      // standardProps 里有 sessionId（session 作用域槽位）—— 当前会话 id 由官方传入
      (props?: unknown) =>
        AnchorWidget({ sessionId: (props as { sessionId?: string } | undefined)?.sessionId }),
    ),
  )

  // sidebar.panellist：**只放图标**。文档明确："Each list id addresses the
  // matching main panel; the sidebar owns the button"。塞整个面板进来会导致侧栏溢出。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 200, label: '连接' },
      () => ConnectionPanelIcon({ size: 18, active: false }),
    ),
  )

  // main（keyed）：真正的面板，key 必须与上面的 list id 相同。
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: PANEL_ID },
      () => ConnectionPanel({ client: stableClient, sessions: stableSessions }),
    ),
  )

  // shell.overlay：左侧会话列表上的竖直连接线（纯覆盖，不抢任何槽位）。
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'connection-rail', order: 50, label: '连接轨道' },
      () => SessionRailOverlay({ client: stableClient, sessions: stableSessions }),
    ),
  )

  // sidebar.session.row.leading：每行挂一个不可见标记，把会话 id 写到行元素上。
  // 这是 DOM 里唯一能拿到会话身份的地方（会话行本身没有 id 属性）。
  ctx.slots.inject('sidebar.session.row.leading', () =>
    ctx.slots.register(
      { name: 'sidebar.session.row.leading', id: 'connection-row-marker', order: 100 },
      // 该槽位的 ownerProps 是 { sessionId }，由行本身传入
      (props?: unknown) => {
        const sessionId = (props as { sessionId?: string } | undefined)?.sessionId
        return sessionId ? SessionRowMarker({ sessionId }) : null
      },
    ),
  )
}
