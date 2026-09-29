/**
 * CardStack — 连接下的卡片列表渲染。
 * Phase 1：静态展示卡片状态点（健康色）。
 * Phase 2：接入真实卡片 UI（mountPanel）。
 */
import type { Connection } from '../types/index.js'

const HEALTH_COLORS = {
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#EF4444',
} as const

interface CardStackProps {
  connection: Connection
}

export function CardStack({ connection }: CardStackProps) {
  if (connection.cards.length === 0) {
    return null
  }
  return (
    <div className="ccr-card-stack">
      {connection.cards.map((card) => (
        <div key={card.instanceId} className="ccr-card-row">
          ├ {card.templateId}{' '}
          <span style={{ color: HEALTH_COLORS[connection.health], marginLeft: 6 }}>● 正常</span>
        </div>
      ))}
    </div>
  )
}
