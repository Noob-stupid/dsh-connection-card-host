/**
 * AnchorCircle — 输入框左侧小圆圈。
 * 位置：输入框左侧，垂直居中，距左边缘 8px。
 * 尺寸：默认 12px，悬停 14px。
 * 状态：idle(40%) → hover(80%) → dragging(100% + 脉冲光环)。
 */
import { useState, useCallback } from 'react'

interface AnchorCircleProps {
  onDragStart: (x: number, y: number) => void
}

export function AnchorCircle({ onDragStart }: AnchorCircleProps) {
  const [state, setState] = useState<'idle' | 'hover' | 'dragging'>('idle')

  const handleMouseEnter = useCallback(() => {
    if (state !== 'dragging') setState('hover')
  }, [state])

  const handleMouseLeave = useCallback(() => {
    if (state !== 'dragging') setState('idle')
  }, [state])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setState('dragging')
    onDragStart(e.clientX, e.clientY)
  }, [onDragStart])

  return (
    <div
      className={`anchor-circle anchor-circle--${state}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      role="button"
      aria-label="发起会话连接"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const rect = (e.target as HTMLElement).getBoundingClientRect()
          setState('dragging')
          onDragStart(rect.left + rect.width / 2, rect.top + rect.height / 2)
        }
      }}
    >
      <div className="anchor-circle__pulse" />
    </div>
  )
}
