/**
 * dsh-connection-card-host — 浏览器端入口。
 * 通过 ctx.slots.inject() 向 DSH UI 槽位贡献组件：
 *   - conversation.input.activity：输入框左侧小圆圈（AnchorCircle）
 *   - sidebar.panellist：卡片面板入口（ConnectionPanel）
 * 绝不导入其他功能插件的组件；作用域遵循 Cordis effect 生命周期。
 */
import { useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { AnchorCircle } from '../ui/AnchorCircle.js'
import { DragLine } from '../ui/DragLine.js'
import { ConnectionPanel } from '../ui/ConnectionPanel.js'
import { useDragLine } from '../ui/hooks/useDragLine.js'
import type { ConnectionCardHostService } from '../adapter/stable-api.js'

type ClientContext = Context & {
  slots: {
    inject(slotName: string, factory: () => any): void
    register(spec: { name: string; id: string; order?: number }, componentFactory: () => any): any
  }
}

export const inject = ['slots']

/** 从宿主服务获取连接列表（浏览器端经 Remote/API 调用） */
function getHost(ctx: Context): ConnectionCardHostService | null {
  try {
    return (ctx as any).get?.('connectionCardHost') ?? null
  } catch {
    return null
  }
}

export function apply(ctx: ClientContext): void {
  const host = getHost(ctx)

  // ═══ 小圆圈（含拖拽拉线）═══
  const AnchorWidget = () => {
    const drag = useDragLine()

    // 全局 mousemove/mouseup 监听
    useEffect(() => {
      if (!drag.state.dragging) return
      const onMove = (e: MouseEvent) => drag.onMouseMove(e.clientX, e.clientY)
      const onUp = (e: MouseEvent) => {
        // 检查是否落在会话列表项上（target-highlight）
        // 注：DSH 会话列表项使用 data-session-id 属性标识会话 ID
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const sessionItem = el?.closest('[data-session-id]')
        if (sessionItem && drag.state.start) {
          const targetId = sessionItem.getAttribute('data-session-id')!
          const sourceId = findSourceSession()
          if (sourceId && targetId && sourceId !== targetId) {
            host?.createConnection(sourceId, targetId)
          }
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

    // 全局 touchmove/touchend 监听（触屏拖拽，8px 阈值 + 16px 锚点半径）
    useEffect(() => {
      if (!drag.state.dragging) return
      const onMove = (e: TouchEvent) => {
        const t = e.touches[0]
        if (drag.onTouchMove(t.clientX, t.clientY)) {
          e.preventDefault()
        }
      }
      const onEnd = (e: TouchEvent) => {
        const touch = e.changedTouches[0]
        const el = document.elementFromPoint(touch.clientX, touch.clientY)
        const sessionItem = el?.closest('[data-session-id]')
        if (sessionItem && drag.state.start) {
          const targetId = sessionItem.getAttribute('data-session-id')!
          const sourceId = findSourceSession()
          if (sourceId && targetId && sourceId !== targetId) {
            host?.createConnection(sourceId, targetId)
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
          <DragLine
            start={drag.state.start}
            end={drag.state.current}
            onComplete={() => {/* 松手后自动移除 */}}
          />
        )}
      </>
    )
  }

  // ═══ 卡片面板 ═══
  const PanelWidget = () => {
    if (!host) {
      return <div style={{ padding: 12, opacity: 0.6 }}>连接宿主未就绪</div>
    }
    return <ConnectionPanel host={host} />
  }

  // ═══ 槽位注册（inject 自动绑定 fiber 生命周期，销毁时递归折叠）═══
  // conversation.input.activity: 输入框区域的活动控件区（小圆圈）
  // 注：规格书 3.5 节写的是 conversation.composer.bar，实际 DSH 槽位名为 conversation.input.activity
  ctx.slots.inject('conversation.input.activity', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.activity',
        id: 'connection-anchor',
        order: 100,
      },
      () => AnchorWidget(),
    ),
  )

  // sidebar.panellist: 侧栏面板图标列表（卡片面板入口）
  // 注：规格书 3.5 节写的是 sidebar.right.pane.tab，实际 DSH 槽位名为 sidebar.panellist
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: 'connection-panel',
        order: 200,
      },
      () => PanelWidget(),
    ),
  )
}

/** 尝试从 DOM 推断当前会话 ID（宿主页面约定 data-current-session 或路由参数）
 * 注：DSH 会话列表项使用 data-session-id 属性，当前激活会话使用 data-current-session
 */
function findSourceSession(): string | null {
  // 优先从当前激活的 composer 区域获取
  const composer = document.querySelector('[data-current-session]')
  if (composer) return composer.getAttribute('data-current-session')
  // fallback：从 URL hash / query 解析
  const m = location.href.match(/session[=/]([^&#]+)/i)
  return m ? m[1] : null
}
