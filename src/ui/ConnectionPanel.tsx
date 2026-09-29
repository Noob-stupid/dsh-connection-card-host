/**
 * ConnectionPanel — 卡片面板。
 * 入口：sidebar.panellist 槽位。
 * 结构：顶部 tab（全部/正常/告警）→ 连接行（可展开卡片列表）。
 * 悬停连接行 → 轨道对应高亮；悬停轨道 → 面板行背景填充。
 */
import { useState, useEffect, useCallback } from 'react'
import type { ConnectionCardHostService } from '../adapter/stable-api.js'
import type { Connection } from '../types/index.js'
import { CardStack } from './CardStack.js'

interface ConnectionPanelProps {
  host: ConnectionCardHostService
}

type Tab = 'all' | 'normal' | 'alert'

const PERM_LABELS = { read: '只读', suggest: '建议', write: '写入' } as const

export function ConnectionPanel({ host }: ConnectionPanelProps) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')

  // 订阅连接变更，实时刷新
  useEffect(() => {
    const refresh = () => setConnections(host.getAllConnections())
    refresh()
    const off1 = host.onConnectionEvent('created', refresh)
    const off2 = host.onConnectionEvent('updated', refresh)
    const off3 = host.onConnectionEvent('disconnected', refresh)
    return () => { off1(); off2(); off3() }
  }, [host])

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const filtered = connections.filter((c) => {
    if (tab === 'all') return true
    if (tab === 'normal') return c.health === 'green' && c.status !== 'broken'
    return c.health !== 'green' || c.status === 'broken'
  })

  return (
    <div className="connection-panel">
      <div className="connection-panel__tabs">
        {(['all', 'normal', 'alert'] as Tab[]).map((t) => (
          <div
            key={t}
            className={`connection-panel__tab${tab === t ? ' connection-panel__tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'all' ? '全部' : t === 'normal' ? '正常' : '告警'}
          </div>
        ))}
      </div>
      <div className="connection-panel__list">
        {filtered.length === 0 && (
          <div style={{ padding: 16, opacity: 0.5 }}>暂无连接</div>
        )}
        {filtered.map((conn) => {
          const permLabel =
            conn.permission.aToB === conn.permission.bToA
              ? PERM_LABELS[conn.permission.aToB]
              : `${PERM_LABELS[conn.permission.aToB]}↔${PERM_LABELS[conn.permission.bToA]}`
          const healthColor =
            conn.health === 'green' ? '#10B981' : conn.health === 'yellow' ? '#F59E0B' : '#EF4444'
          return (
            <div key={conn.id}>
              <div
                className={`connection-row${expandedId === conn.id ? ' connection-row--highlighted' : ''}`}
                onClick={() => toggleExpand(conn.id)}
              >
                <span style={{ color: healthColor }}>●</span>{' '}
                {conn.sessionA.slice(0, 6)} ↔ {conn.sessionB.slice(0, 6)}{' '}
                {permLabel} [{conn.cards.length} 张卡片]
              </div>
              {expandedId === conn.id && <CardStack connection={conn} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
