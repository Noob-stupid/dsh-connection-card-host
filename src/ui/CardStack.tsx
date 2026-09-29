/**
 * CardStack — 一条连接下的卡片区。
 *
 * 两部分：
 *   1. 已装载的卡片：名称 + 状态 + 「重载」「移除」，并渲染卡片面板；
 *   2. 添加卡片：列出可用模板（内置 + 已安装），一键加到这条连接上。
 *
 * 卡片面板 HTML 由**宿主**渲染好后传过来 —— 卡片模块跑在宿主进程里
 * （apply 要订阅事件、注册工具），宿主没有 DOM，用 dom-shim 取 innerHTML。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Connection } from '../types/index.js'
import type { ConnectionCardHostClient, CardTemplateView } from '../client/host-client.js'

interface CardStackProps {
  connection: Connection
  client: ConnectionCardHostClient | null
  /** 卡片增删后通知外层刷新连接列表 */
  onChanged?: () => void
}

const HEALTH_COLOR: Record<string, string> = {
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#EF4444',
}

export function CardStack({ connection, client, onChanged }: CardStackProps) {
  const [templates, setTemplates] = useState<CardTemplateView[]>([])
  const [panels, setPanels] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const cards = connection.cards
  // 依赖用长度与 id 串，避免每次渲染都重新拉取
  const cardKey = cards.map((c) => c.instanceId).join(',')

  /** 拉模板清单 + 渲染每张已装载卡片的面板。 */
  const load = useCallback(async () => {
    if (!client) return
    try {
      const list = await client.listCardTemplates(connection.id)
      setTemplates(list)
      setError(null)

      const ids = cardKey ? cardKey.split(',') : []
      const next: Record<string, string | null> = {}
      for (const id of ids) {
        try {
          next[id] = await client.renderCardPanel(id)
        } catch {
          next[id] = null
        }
      }
      setPanels(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [client, connection.id, cardKey])

  useEffect(() => {
    void load()
  }, [load])

  const add = useCallback(
    async (templateId: string) => {
      if (!client) return
      setBusy(templateId)
      try {
        await client.loadCard(templateId, connection.id)
        setPicking(false)
        await load()
        onChanged?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, connection.id, load, onChanged],
  )

  const remove = useCallback(
    async (instanceId: string) => {
      if (!client) return
      setBusy(instanceId)
      try {
        await client.unloadCard(instanceId)
        await load()
        onChanged?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, load, onChanged],
  )

  const reload = useCallback(
    async (instanceId: string) => {
      if (!client) return
      setBusy(instanceId)
      try {
        await client.reloadCard(instanceId)
        await load()
        onChanged?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, load, onChanged],
  )

  const installed = new Set(cards.map((c) => c.templateId))
  const available = templates.filter((t) => !installed.has(t.templateId))

  return (
    <div className="ccr-cards">
      <div className="ccr-cards__head">
        <span className="ccr-field__label">卡片</span>
        <span className="ccr-count">{cards.length}</span>
        {client && (
          <button
            type="button"
            className="ccr-link ccr-cards__add"
            onClick={() => setPicking((v) => !v)}
          >
            {picking ? '取消' : '+ 添加卡片'}
          </button>
        )}
      </div>

      {error && <div className="ccr-error">{error}</div>}

      {picking && (
        <div className="ccr-cards__picker">
          {available.length === 0 && (
            <div className="ccr-panel__empty">
              {templates.length === 0 ? '没有发现任何卡片模板' : '所有卡片都已添加'}
            </div>
          )}
          {available.map((t) => (
            <button
              key={t.templateId}
              type="button"
              className="ccr-card-option"
              disabled={busy === t.templateId}
              onClick={() => void add(t.templateId)}
            >
              <span className="ccr-card-option__name">{t.name}</span>
              <span className="ccr-card-option__meta">
                {t.source === 'builtin' ? '内置' : '已安装'} · v{t.version}
                {t.events.length > 0 && ` · ${t.events.length} 事件`}
              </span>
            </button>
          ))}
        </div>
      )}

      {cards.length === 0 && !picking && (
        <div className="ccr-panel__empty">这条连接还没有卡片</div>
      )}

      {cards.map((card) => {
        const template = templates.find((t) => t.templateId === card.templateId)
        const html = panels[card.instanceId] ?? null
        return (
          <div key={card.instanceId} className="ccr-card">
            <div className="ccr-card__head">
              <span
                className="ccr-dot"
                style={{ background: HEALTH_COLOR[connection.health] ?? '#10B981' }}
              />
              <span className="ccr-card__name">{template?.name ?? card.templateId}</span>
              <span className="ccr-card__meta">{card.templateId}</span>
              <button
                type="button"
                className="ccr-link"
                disabled={busy === card.instanceId}
                onClick={() => void reload(card.instanceId)}
              >
                重载
              </button>
              <button
                type="button"
                className="ccr-link"
                disabled={busy === card.instanceId}
                onClick={() => void remove(card.instanceId)}
              >
                移除
              </button>
            </div>
            {html && (
              <div
                className="ccr-card__panel"
                // 卡片面板 HTML 由宿主渲染；卡片本来就在宿主跑任意代码，
                // 这里注入不构成新的权限边界。
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
