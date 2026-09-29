/**
 * ConnectionPanel — 会话连接管理面板。
 *
 * 挂载点：`main` 槽位，key = 'connection-panel'（与 sidebar.panellist 的
 * 图标 id 同名，侧栏点图标即切换到这个主面板）。
 *
 * 设计原则（按用户反馈）：
 *   - 不暴露 aToB / bToA 这种内部方向概念。用户看到的是一个「权限」，
 *     设置时双向一起设。
 *   - 让用户自己连：选出两个会话 → 建立连接（拖拽仍是主路径，这里是等价入口）。
 *   - 每个连接可以单独配置权限、断开。
 */
import { useCallback, useMemo, useState } from 'react'
import type { Connection, PermissionLevel } from '../types/index.js'
import { permValue } from '../types/index.js'
import type { ConnectionCardHostClient } from '../client/host-client.js'
import type { SessionsBridge } from '../client/sessions-bridge.js'
import { useConnections } from './hooks/useConnections.js'
import { useSessionList } from './hooks/useSessionList.js'
import { CardStack } from './CardStack.js'

interface ConnectionPanelProps {
  client: ConnectionCardHostClient | null
  sessions: SessionsBridge | null
}

/** 用户视角的权限名称（不是 read/write 这种内部词）。 */
const PERMISSION_CHOICES: { value: PermissionLevel; label: string; hint: string }[] = [
  { value: 'read', label: '只读', hint: '只能观察对方状态，不能改动' },
  { value: 'suggest', label: '可建议', hint: '可以发建议，但不会自动执行' },
  { value: 'write', label: '可写入', hint: '可以在对方会话里执行操作' },
]

const HEALTH_COLOR: Record<string, string> = {
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#EF4444',
}

const HEALTH_TEXT: Record<string, string> = {
  green: '正常',
  yellow: '注意',
  red: '异常',
}

export function ConnectionPanel({ client, sessions }: ConnectionPanelProps) {
  const { connections, error, loaded, refresh } = useConnections(client)

  const { options: sessionOptions, labelOf, ready: sessionsReady } = useSessionList(sessions)
  const [sessionA, setSessionA] = useState('')
  const [sessionB, setSessionB] = useState('')
  const [manual, setManual] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const flash = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((prev) => (prev === message ? null : prev)), 4000)
  }, [])

  const connect = useCallback(async () => {
    if (!client) return
    if (!sessionA || !sessionB) {
      flash('请选择两个会话')
      return
    }
    if (sessionA === sessionB) {
      flash('不能把会话连到它自己')
      return
    }
    setBusy('create')
    try {
      await client.createConnection(sessionA, sessionB)
      setSessionA('')
      setSessionB('')
      flash('已建立连接')
      await refresh()
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [client, sessionA, sessionB, refresh, flash])

  /** 设置权限：双向一起设（用户看到的是一个「权限」）。 */
  const applyPermission = useCallback(
    async (conn: Connection, level: PermissionLevel) => {
      if (!client) return
      setBusy(conn.id)
      try {
        const isUpgrade =
          permValue(level) > permValue(conn.permission.aToB) ||
          permValue(level) > permValue(conn.permission.bToA)

        await client.requestPermissionUpgrade(conn.id, 'aToB', level)
        await client.requestPermissionUpgrade(conn.id, 'bToA', level)
        await refresh()
        flash(isUpgrade ? '已发出升级请求（需双方确认，60 秒内有效）' : '权限已更新')
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, refresh, flash],
  )

  const disconnect = useCallback(
    async (id: string) => {
      if (!client) return
      setBusy(id)
      try {
        await client.disconnect(id)
        setExpandedId((prev) => (prev === id ? null : prev))
        await refresh()
        flash('已断开')
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, refresh, flash],
  )

  const ready = Boolean(client)
  const noSessions = sessionOptions.length === 0
  // 会话列表拿不到时，退回手填 id
  const useManualInput = manual || noSessions

  // 当前会话排在最前，方便「从这里连出去」
  const orderedOptions = useMemo(
    () =>
      sessionOptions
        .slice()
        .sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1)),
    [sessionOptions],
  )

  return (
    <div className="ccr-page">
      <header className="ccr-page__head">
        <h2 className="ccr-page__title">会话连接</h2>
        <p className="ccr-page__sub">
          在两个会话之间建立有状态连接，连接上可以挂载卡片。
          也可以在输入框左侧按住圆点，直接拖到左侧会话上建立。
        </p>
      </header>

      {!ready && <div className="ccr-empty">连接宿主通道未就绪</div>}
      {ready && error && <div className="ccr-error">宿主通信失败：{error}</div>}
      {notice && <div className="ccr-notice">{notice}</div>}

      {ready && (
        <section className="ccr-block">
          <h3 className="ccr-block__title">新建连接</h3>
          <div className="ccr-form">
            {useManualInput ? (
              <>
                <input
                  className="ccr-input"
                  placeholder="会话 ID A"
                  value={sessionA}
                  onChange={(e) => setSessionA(e.target.value.trim())}
                />
                <span className="ccr-form__sep">↔</span>
                <input
                  className="ccr-input"
                  placeholder="会话 ID B"
                  value={sessionB}
                  onChange={(e) => setSessionB(e.target.value.trim())}
                />
              </>
            ) : (
              <>
                <select
                  className="ccr-select"
                  value={sessionA}
                  onChange={(e) => setSessionA(e.target.value)}
                >
                  <option value="">选择会话…</option>
                  {orderedOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.isCurrent ? `● ${s.label}（当前）` : s.label}
                    </option>
                  ))}
                </select>
                <span className="ccr-form__sep">↔</span>
                <select
                  className="ccr-select"
                  value={sessionB}
                  onChange={(e) => setSessionB(e.target.value)}
                >
                  <option value="">选择会话…</option>
                  {orderedOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.isCurrent ? `● ${s.label}（当前）` : s.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="button"
              className="ccr-btn ccr-btn--primary"
              disabled={busy === 'create'}
              onClick={() => void connect()}
            >
              建立连接
            </button>
          </div>
          {noSessions && (
            <p className="ccr-hint">
              {sessionsReady
                ? '会话列表暂时为空。'
                : '读不到会话列表，可以直接填会话 ID。'}
              也可以直接在输入框左侧按住圆点，拖到左侧会话上建立连接。
            </p>
          )}
          {!noSessions && !manual && (
            <button type="button" className="ccr-link" onClick={() => setManual(true)}>
              改用会话 ID 手动输入
            </button>
          )}
        </section>
      )}

      <section className="ccr-block">
        <h3 className="ccr-block__title">
          已有连接
          <span className="ccr-count">{connections.length}</span>
        </h3>

        {ready && loaded && connections.length === 0 && (
          <div className="ccr-empty">还没有连接。选两个会话建立一条，或直接用拖拽。</div>
        )}

        <div className="ccr-list">
          {connections.map((conn) => {
            const health = conn.health ?? 'green'
            const level = conn.permission.aToB
            const symmetric = conn.permission.aToB === conn.permission.bToA
            const open = expandedId === conn.id
            return (
              <article key={conn.id} className={`ccr-conn${open ? ' ccr-conn--open' : ''}`}>
                <button
                  type="button"
                  className="ccr-conn__head"
                  onClick={() => setExpandedId(open ? null : conn.id)}
                >
                  <span className="ccr-dot" style={{ background: HEALTH_COLOR[health] }} />
                  <span className="ccr-conn__pair">
                    <span className="ccr-conn__session">{labelOf(conn.sessionA)}</span>
                    <span className="ccr-conn__arrow">↔</span>
                    <span className="ccr-conn__session">{labelOf(conn.sessionB)}</span>
                  </span>
                  <span className="ccr-conn__meta">
                    {HEALTH_TEXT[health] ?? health} ·{' '}
                    {symmetric
                      ? PERMISSION_CHOICES.find((c) => c.value === level)?.label ?? level
                      : '权限不一致'}{' '}
                    · {conn.cards.length} 卡片
                  </span>
                  <span className="ccr-chevron">{open ? '▾' : '▸'}</span>
                </button>

                {open && (
                  <div className="ccr-conn__body">
                    <div className="ccr-field">
                      <div className="ccr-field__label">权限</div>
                      <div className="ccr-seg">
                        {PERMISSION_CHOICES.map((choice) => (
                          <button
                            key={choice.value}
                            type="button"
                            className={`ccr-seg__item${level === choice.value && symmetric ? ' ccr-seg__item--active' : ''}`}
                            disabled={busy === conn.id}
                            title={choice.hint}
                            onClick={() => void applyPermission(conn, choice.value)}
                          >
                            {choice.label}
                          </button>
                        ))}
                      </div>
                      <div className="ccr-field__hint">
                        {PERMISSION_CHOICES.find((c) => c.value === level)?.hint}
                        （双向同时设置；升级需要双方确认）
                      </div>
                    </div>

                    <CardStack connection={conn} />

                    <div className="ccr-conn__actions">
                      <button
                        type="button"
                        className="ccr-btn ccr-btn--danger"
                        disabled={busy === conn.id}
                        onClick={() => void disconnect(conn.id)}
                      >
                        断开连接
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
