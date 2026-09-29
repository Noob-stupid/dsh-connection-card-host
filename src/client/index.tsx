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
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const sessionItem = el?.closest('[data-session-id]')
        if (sessionItem && drag.state.start) {
          const targetId = sessionItem.getAttribute('data-session-id')!
          const sourceId = findSourceSession(sessionItem)
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

    return (
      <>
        <AnchorCircle onDragStart={drag.onMouseDown} />
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
  // conversation.composer.bar: 输入框区域的活动控件区（小圆圈）
  ctx.slots.inject('conversation.composer.bar', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.bar',
        id: 'connection-anchor',
        order: 100,
      },
      () => AnchorWidget(),
    ),
  )

  // sidebar.right.pane.tab: 侧栏面板标签页（卡片面板入口）
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab',
        id: 'connection-panel',
        order: 200,
      },
      () => PanelWidget(),
    ),
  )
}

/** 尝试从 DOM 推断当前会话 ID（宿主页面约定 data-current-session 或路由参数） */
function findSourceSession(_el: Element): string | null {
  const current = document.querySelector('[data-current-session]')
  if (current) return current.getAttribute('data-current-session')
  // fallback：URL hash / query
  const m = location.href.match(/session[=/]([^&#]+)/i)
  return m ? m[1] : null
}
