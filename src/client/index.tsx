/**
 * dsh-connection-card-host — 浏览器端入口。
 *
 * 通过 ctx.slots.inject() 向 DSH UI 槽位贡献组件：
 *   - conversation.input.activity：输入框左侧小圆圈（AnchorCircle）
 *   - sidebar.panellist：连接卡片面板（ConnectionPanel）
 *
 * 宿主数据通过 DSH 官方 Connection RPC 通道读取（ctx.connection.rpc）。
 * 作用域遵循 Cordis fiber 生命周期。
 */
import { useEffect, useMemo } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { AnchorCircle } from '../ui/AnchorCircle.js'
import { DragLine } from '../ui/DragLine.js'
import { ConnectionPanel } from '../ui/ConnectionPanel.js'
import { useDragLine } from '../ui/hooks/useDragLine.js'
import { createHostClient, resolveRpcCaller } from './host-client.js'

type ClientContext = Context & {
  slots: {
    inject(slotName: string, callback: () => unknown): void
    register(spec: { name: string; id: string; order?: number }, componentFactory: () => unknown): unknown
  }
}

/** 需要 slots 注入 UI，需要 connection 提供宿主 RPC 通道。 */
export const inject = ['slots', 'connection']

/** 读取当前激活会话 id（拖拽起点）。 */
function findSourceSession(): string | null {
  // DSH 会话列表项使用 data-session-id；当前激活会话在 composer 区标 data-current-session
  const current = document.querySelector('[data-current-session]')
  const direct = current?.getAttribute('data-current-session')
  if (direct) return direct
  // 退化：从 URL 解析
  const m = location.href.match(/session[=/]([^&#]+)/i)
  return m ? m[1] : null
}

/** 命中松手位置下的会话列表项。 */
function sessionIdAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)
  const item = el?.closest('[data-session-id]')
  return item?.getAttribute('data-session-id') ?? null
}

export function apply(ctx: ClientContext): void {
  const rpc = resolveRpcCaller(ctx)
  // 客户端只构造一次；rpc 缺席时保持 null，面板显示"通道未就绪"
  const client = rpc ? createHostClient(rpc) : null

  if (!rpc) {
    ctx.logger?.warn?.(
      '[connection-card-host] ctx.connection.rpc 不可用；面板将无法读取宿主连接',
    )
  }

  // ═══ 小圆圈（含拖拽拉线）═══
  const AnchorWidget = () => {
    const drag = useDragLine()

    // 鼠标拖拽：全局 move/up
    useEffect(() => {
      if (!drag.state.dragging) return

      const onMove = (e: MouseEvent) => drag.onMouseMove(e.clientX, e.clientY)
      const onUp = (e: MouseEvent) => {
        const targetId = sessionIdAtPoint(e.clientX, e.clientY)
        const sourceId = findSourceSession()
        if (targetId && sourceId && sourceId !== targetId) {
          void client?.createConnection(sourceId, targetId).catch((err) => {
            console.error('[connection-card-host] 建立连接失败:', err)
          })
        }
        drag.onMouseUp()
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
    }, [drag.state.dragging])

    // 触屏拖拽：8px 阈值 + 16px 锚点半径在 useDragLine 内判定
    useEffect(() => {
      if (!drag.state.dragging) return

      const onMove = (e: TouchEvent) => {
        const t = e.touches[0]
        if (t && drag.onTouchMove(t.clientX, t.clientY)) e.preventDefault()
      }
      const onEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0]
        if (t) {
          const targetId = sessionIdAtPoint(t.clientX, t.clientY)
          const sourceId = findSourceSession()
          if (targetId && sourceId && sourceId !== targetId) {
            void client?.createConnection(sourceId, targetId).catch((err) => {
              console.error('[connection-card-host] 建立连接失败:', err)
            })
          }
        }
        drag.onTouchEnd()
      }

      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onEnd)
      return () => {
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onEnd)
      }
    }, [drag.state.dragging])

    return (
      <>
        <AnchorCircle
          onDragStart={drag.onMouseDown}
          onTouchStart={drag.onTouchStart}
          onTouchMove={drag.onTouchMove}
          onTouchEnd={drag.onTouchEnd}
        />
        {drag.state.dragging && drag.state.start && drag.state.current && (
          <DragLine start={drag.state.start} end={drag.state.current} />
        )}
      </>
    )
  }

  // ═══ 卡片面板 ═══
  const PanelWidget = () => {
    const stable = useMemo(() => client, [])
    return <ConnectionPanel client={stable} />
  }

  // ═══ 槽位注册（inject 自动绑定 fiber 生命周期）═══
  // conversation.input.activity: 输入框工具行（模型选择器之后的紧凑动作位）
  ctx.slots.inject('conversation.input.activity', () =>
    ctx.slots.register(
      { name: 'conversation.input.activity', id: 'connection-anchor', order: 100 },
      () => AnchorWidget(),
    ),
  )

  // sidebar.panellist: 侧栏全局面板图标列表
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: 'connection-panel', order: 200 },
      () => PanelWidget(),
    ),
  )
}
