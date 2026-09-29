/**
 * AnchorCircle — 输入框左侧小圆圈。
 * 位置：输入框左侧，垂直居中，距左边缘 8px。
 * 尺寸：默认 12px，悬停 14px。
 * 状态：idle(40%) → hover(80%) → dragging(100% + 脉冲光环)。
 */
import { useState, useCallback, useRef } from 'react'

interface AnchorCircleProps {
  onDragStart: (x: number, y: number) => void
  onTouchStart?: (x: number, y: number, anchorX: number, anchorY: number) => void
  onTouchMove?: (x: number, y: number) => boolean
  onTouchEnd?: () => void
}

export function AnchorCircle({
  onDragStart,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: AnchorCircleProps) {
  const [state, setState] = useState<'idle' | 'hover' | 'dragging'>('idle')
  const anchorRef = useRef<HTMLDivElement | null>(null)

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

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onTouchStart) return
    const t = e.touches[0]
    const rect = anchorRef.current?.getBoundingClientRect()
    const anchorX = (rect?.left ?? t.clientX) + (rect?.width ?? 0) / 2
    const anchorY = (rect?.top ?? t.clientY) + (rect?.height ?? 0) / 2
    onTouchStart(t.clientX, t.clientY, anchorX, anchorY)
  }, [onTouchStart])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!onTouchMove) return
    const t = e.touches[0]
    if (onTouchMove(t.clientX, t.clientY)) {
      e.preventDefault()
      if (state !== 'dragging') setState('dragging')
    }
  }, [onTouchMove, state])

  const handleTouchEnd = useCallback(() => {
    onTouchEnd?.()
    setState('idle')
  }, [onTouchEnd])

  return (
    <div
      ref={anchorRef}
      className={`anchor-circle anchor-circle--${state}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
