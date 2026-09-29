/**
 * DragLine — 拉线动效（含粒子流动）。
 * 底层：虚线流动线（stroke-dashoffset 动画）。
 * 上层：4 个粒子沿贝塞尔曲线匀速流动（getPointAtLength）。
 * 松手：shrinking(200ms) → pulsing(300ms) → 移除。
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'

interface Point { x: number; y: number }

interface DragLineProps {
  start: Point
  end: Point
  onComplete?: () => void
}

interface Particle { t: number }

function buildBezierPath(start: Point, end: Point): string {
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  return `M ${start.x} ${start.y} Q ${midX} ${midY - 20} ${end.x} ${end.y}`
}

export function DragLine({ start, end, onComplete }: DragLineProps) {
  const [phase, setPhase] = useState<'dragging' | 'shrinking' | 'pulsing'>('dragging')
  const [particles, setParticles] = useState<Particle[]>([])
  const pathRef = useRef<SVGPathElement>(null)
  const rafRef = useRef<number>(0)

  const path = useMemo(() => buildBezierPath(start, end), [start, end])

  // 粒子动画循环
  useEffect(() => {
    if (phase !== 'dragging') return
    const pathEl = pathRef.current
    if (!pathEl) return

    const totalLength = pathEl.getTotalLength()
    const count = 4
    const speed = 320 // px/s

    const initial: Particle[] = Array.from({ length: count }, (_, i) => ({
      t: (i / count) * totalLength,
    }))
    setParticles(initial)

    let last = performance.now()

    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setParticles((prev) =>
        prev.map((p) => ({
          t: (p.t + speed * dt) % totalLength,
        })),
      )
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase, path])

  // 松手动效时序
  useEffect(() => {
    if (phase === 'shrinking') {
      const timer = setTimeout(() => setPhase('pulsing'), 200)
      return () => clearTimeout(timer)
    }
    if (phase === 'pulsing') {
      const timer = setTimeout(() => onComplete?.(), 300)
      return () => clearTimeout(timer)
    }
  }, [phase, onComplete])

  /** 外部调用：触发松手动效 */
  const release = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    setPhase('shrinking')
  }, [])

  // 将 release 暴露给父组件（通过 ref 或回调）
  useEffect(() => {
    ;(DragLine as any).__release = release
  }, [release])

  return (
    <svg className="drag-line" aria-hidden="true">
      {/* 底层：虚线流动 */}
      <path
        ref={pathRef}
        d={path}
        className={`drag-line__path drag-line__path--${phase}`}
        style={{ strokeDasharray: '6 4' }}
      />
      {/* 上层：粒子流 */}
      {phase === 'dragging' &&
        particles.map((p, i) => {
          const point = pathRef.current?.getPointAtLength(p.t)
          if (!point) return null
          const totalLen = pathRef.current?.getTotalLength() ?? 1
          const progress = p.t / totalLen
          const opacity = Math.sin(progress * Math.PI) * 0.8 + 0.3
          return (
            <circle
              key={i}
              className="drag-line__particle"
              cx={point.x}
              cy={point.y}
              r={1.5}
              fill="var(--line-drag-color)"
              opacity={opacity}
              style={{ filter: 'blur(1px)' }}
            />
          )
        })}
    </svg>
  )
}
