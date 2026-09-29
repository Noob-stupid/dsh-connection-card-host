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
  const AnchorWidget = () => {
    const drag = useDragLine()
    const [lineDone, setLineDone] = useState(false)
    // 当前被高亮的会话行（拖拽落点提示）
    const highlightedRef = useRef<Element | null>(null)

    const clearHighlight = useCallback(() => {
      highlightedRef.current?.classList.remove('ccr-target')
      highlightedRef.current = null
    }, [])

    const beginDrag = useCallback(
      (x: number, y: number) => {
        setLineDone(false)
        drag.onMouseDown(x, y)
      },
      [drag],
    )

    /** 松手：命中会话行就建连接。起点取 DSH 的当前会话。 */
    const finishAt = useCallback(
      (x: number, y: number) => {
        const ids = sessions?.getSnapshot().ids ?? []
        const hit = sessionRowAtPoint(x, y, ids)
        const sourceId = sessions?.getSnapshot().current ?? null
        if (hit && sourceId && sourceId !== hit.id) {
          void client?.createConnection(sourceId, hit.id).catch((err) => {
            console.error('[connection-card-host] 建立连接失败:', err)
          })
        }
        clearHighlight()
      },
      [client, sessions, clearHighlight],
    )

    /** 拖拽中的落点高亮。 */
    const trackTarget = useCallback(
      (x: number, y: number) => {
        const ids = sessions?.getSnapshot().ids ?? []
        const hit = sessionRowAtPoint(x, y, ids)
        const current = sessions?.getSnapshot().current
        const next = hit && hit.id !== current ? hit.element : null
        if (next !== highlightedRef.current) {
          highlightedRef.current?.classList.remove('ccr-target')
          next?.classList.add('ccr-target')
          highlightedRef.current = next
        }
      },
      [sessions],
    )

    // 鼠标拖拽
    useEffect(() => {
      if (!drag.state.dragging) return

      const onMove = (e: MouseEvent) => {
        drag.onMouseMove(e.clientX, e.clientY)
        trackTarget(e.clientX, e.clientY)
      }
      const onUp = (e: MouseEvent) => {
        finishAt(e.clientX, e.clientY)
        drag.onMouseUp()
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          clearHighlight()
          drag.onMouseUp()
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('keydown', onKey)
      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('keydown', onKey)
        clearHighlight()
      }
    }, [drag.state.dragging, drag, finishAt, trackTarget, clearHighlight])

    // 触屏拖拽（8px 阈值 + 16px 锚点半径在 useDragLine 内判定）
    useEffect(() => {
      if (!drag.state.dragging) return

      const onMove = (e: TouchEvent) => {
        const t = e.touches[0]
        if (!t) return
        if (drag.onTouchMove(t.clientX, t.clientY)) e.preventDefault()
        trackTarget(t.clientX, t.clientY)
      }
      const onEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0]
        if (t) finishAt(t.clientX, t.clientY)
        drag.onTouchEnd()
      }

      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onEnd)
      return () => {
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onEnd)
        clearHighlight()
      }
    }, [drag.state.dragging, drag, finishAt, trackTarget, clearHighlight])

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
      () => AnchorWidget(),
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
