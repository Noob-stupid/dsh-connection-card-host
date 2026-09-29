/**
 * ConnectionPanel — 连接卡片面板。
 * 入口：sidebar.panellist 槽位。
 * 结构：顶部 tab（全部/正常/告警）→ 连接行（可展开卡片列表）。
 *
 * 数据来自宿主（经 Connection RPC），用 useConnections 轮询刷新。
 */
import { useState, useCallback } from 'react'
import type { Connection, PermissionLevel } from '../types/index.js'
import type { ConnectionCardHostClient } from '../client/host-client.js'
import { useConnections } from './hooks/useConnections.js'
import { CardStack } from './CardStack.js'

interface ConnectionPanelProps {
  client: ConnectionCardHostClient | null
}

type Tab = 'all' | 'normal' | 'alert'

const PERM_LABELS: Record<PermissionLevel, string> = {
  read: '只读',
  suggest: '建议',
  write: '写入',
}

const PERM_CYCLE: PermissionLevel[] = ['read', 'suggest', 'write']

export function ConnectionPanel({ client }: ConnectionPanelProps) {
  const { connections, error, loaded, refresh } = useConnections(client)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  /** 权限升级：低→高走协商（需双方确认），高→低直接生效。 */
  const cyclePermission = useCallback(
    async (conn: Connection, direction: 'aToB' | 'bToA') => {
      if (!client) return
      const current = conn.permission[direction]
      const next = PERM_CYCLE[(PERM_CYCLE.indexOf(current) + 1) % PERM_CYCLE.length]
      setBusy(conn.id)
      try {
        await client.requestPermissionUpgrade(conn.id, direction, next)
        await refresh()
      } catch (e) {
        console.error('[connection-panel] 权限变更失败:', e)
      } finally {
        setBusy(null)
      }
    },
    [client, refresh],
  )

  const disconnect = useCallback(
    async (id: string) => {
      if (!client) return
      setBusy(id)
      try {
        await client.disconnect(id)
        await refresh()
      } catch (e) {
        console.error('[connection-panel] 断开失败:', e)
      } finally {
        setBusy(null)
      }
    },
    [client, refresh],
  )

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

      {!client && (
        <div style={{ padding: 16, opacity: 0.6 }}>
          连接宿主通道未就绪
        </div>
      )}

      {client && error && (
        <div style={{ padding: '8px 12px', color: '#EF4444', fontSize: 12 }}>
          宿主通信失败：{error}
        </div>
      )}

      {client && !error && loaded && filtered.length === 0 && (
        <div style={{ padding: 16, opacity: 0.5 }}>暂无连接</div>
      )}

      <div className="connection-panel__list">
        {filtered.map((conn) => {
          const aToB = conn.permission.aToB
          const bToA = conn.permission.bToA
          const permLabel =
            aToB === bToA
              ? PERM_LABELS[aToB]
              : `${PERM_LABELS[aToB]}↔${PERM_LABELS[bToA]}`
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
              {expandedId === conn.id && (
                <>
                  <CardStack connection={conn} />
                  <div style={{ display: 'flex', gap: 8, padding: '6px 12px', fontSize: 12 }}>
                    <button
                      type="button"
                      disabled={busy === conn.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        void cyclePermission(conn, 'aToB')
                      }}
                    >
                      权限 A→B: {PERM_LABELS[aToB]}
                    </button>
                    <button
                      type="button"
                      disabled={busy === conn.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        void cyclePermission(conn, 'bToA')
                      }}
                    >
                      权限 B→A: {PERM_LABELS[bToA]}
                    </button>
                    <button
                      type="button"
                      disabled={busy === conn.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        void disconnect(conn.id)
                      }}
                    >
                      断开
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
