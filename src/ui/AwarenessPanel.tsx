/**
 * AwarenessPanel —— 一条连接上的「协作感知」区块。
 *
 * 两块内容，对应两层：
 *
 *   A. 工作状态 —— **自动采集**：两边各自在改什么文件、计划进行到哪一步。
 *      只读，刷新即可。这是「我知道你在干什么」。
 *
 *   B. 公约盒   —— **显式声明**：双方说好了什么（接口、坐标、单位、命名、分工）。
 *      可增可删。这是「我们说好了什么」。
 *
 * 为什么两者并列显示：它们回答的是不同问题，而且**状态会过期、公约不会** ——
 * 混在一起会让人分不清哪条是"此刻如此"、哪条是"一直如此"。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  ConnectionCardHostClient,
  ConventionView,
  WorkView,
} from '../client/host-client.js'
import type { Connection } from '../types/index.js'

interface AwarenessPanelProps {
  client: ConnectionCardHostClient | null
  connection: Connection
  labelA: string
  labelB: string
  onNotice: (msg: string) => void
}

/** 工作状态的新鲜度：多久没更新就算"停下来了"。 */
const STALE_MS = 3 * 60_000

function ago(ts: number): string {
  if (!ts) return '未知'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`
  return `${Math.round(s / 3600)} 小时前`
}

export function AwarenessPanel({
  client,
  connection,
  labelA,
  labelB,
  onNotice,
}: AwarenessPanelProps) {
  const [work, setWork] = useState<{ a: WorkView | null; b: WorkView | null }>({
    a: null,
    b: null,
  })
  const [conventions, setConventions] = useState<ConventionView[]>([])
  const [draft, setDraft] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!client) return
    try {
      const [w, c] = await Promise.all([
        client.connectionWork(connection.id),
        client.listConventions(connection.id),
      ])
      setWork(w)
      setConventions(c)
    } catch {
      /* 轮询失败静默，下一轮再试 */
    }
  }, [client, connection.id])

  // 工作状态是**实时**的，所以要轮询；3 秒足够跟手，又不会打爆宿主
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load])

  const declare = useCallback(async () => {
    if (!client) return
    const text = draft.trim()
    if (text.length === 0) return
    setBusy(true)
    try {
      // by='user'：声明的是**人**，不是 A 也不是 B。
      // 早先硬编码成 'a'，会让人写的东西被算到 A 头上，对端看到会误判来源。
      const r = await client.declareConvention(connection.id, 'user', topic.trim() || '一般', text)
      if (r.ok) {
        setDraft('')
        setTopic('')
        onNotice('已放入公约盒')
        await load()
      } else {
        onNotice(`声明失败：${r.reason ?? '未知原因'}`)
      }
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [client, connection.id, draft, topic, load, onNotice])

  const remove = useCallback(
    async (id: string) => {
      if (!client) return
      try {
        await client.removeConvention(connection.id, id)
        await load()
      } catch (e) {
        onNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [client, connection.id, load, onNotice],
  )

  return (
    <>
      {/* ═══ A. 工作状态（自动采集，只读） ═══ */}
      <div className="ccr-field">
        <div className="ccr-field__label">
          对方在做什么
          <span className="ccr-field__auto" title="由会话事件自动采集，对方不需要专门告诉你">
            自动
          </span>
        </div>

        <div className="ccr-work">
          {([['a', labelA, work.a], ['b', labelB, work.b]] as const).map(
            ([side, name, state]) => (
              <div key={side} className="ccr-work__row">
                <div className="ccr-work__head">
                  <span className="ccr-work__name" title={side === 'a' ? connection.sessionA : connection.sessionB}>
                    {name}
                  </span>
                  {state && state.updatedAt > 0 ? (
                    <span
                      className={`ccr-work__age${Date.now() - state.updatedAt > STALE_MS ? ' ccr-work__age--stale' : ''}`}
                    >
                      {ago(state.updatedAt)}
                    </span>
                  ) : (
                    <span className="ccr-work__age">未采集</span>
                  )}
                </div>

                {state && state.updatedAt > 0 ? (
                  <>
                    <div className="ccr-work__action">{state.lastAction || '空闲'}</div>
                    {state.todos.length > 0 && (
                      <ul className="ccr-work__todos">
                        {state.todos.map((t, i) => (
                          <li
                            key={i}
                            className={`ccr-work__todo ccr-work__todo--${t.status}`}
                            title={t.content}
                          >
                            {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '·'}{' '}
                            {t.content}
                          </li>
                        ))}
                      </ul>
                    )}
                    {state.files.length > 0 && (
                      <div className="ccr-work__files" title={state.files.join('\n')}>
                        {state.files.slice(0, 4).map((f) => (
                          <span key={f} className="ccr-work__file">
                            {f.replace(/\\/g, '/').split('/').slice(-2).join('/')}
                          </span>
                        ))}
                      </div>
                    )}
                    {state.turn > 0 && (
                      <div className="ccr-work__progress">
                        第 {state.turn} 轮 · 第 {state.step} 步
                      </div>
                    )}
                  </>
                ) : (
                  <div className="ccr-work__action ccr-work__action--empty">
                    还没采集到 —— 对方开始干活后这里会自动出现
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      </div>

      {/* ═══ B. 公约盒（显式声明，持久） ═══ */}
      <div className="ccr-field">
        <div className="ccr-field__label">
          共享约定
          <span className="ccr-field__count">{conventions.length}</span>
        </div>

        {conventions.length === 0 ? (
          <div className="ccr-box__empty">
            还没有约定。放「对方不知道就会做错的东西」——接口、坐标、单位、命名、分工边界。
          </div>
        ) : (
          <ul className="ccr-box">
            {conventions.map((c) => (
              <li key={c.id} className="ccr-box__item">
                <span className="ccr-box__topic">{c.topic}</span>
                <span className="ccr-box__text">{c.text}</span>
                <span className="ccr-box__who" title={c.by === 'user' ? '你在面板里直接添加的' : c.by === 'a' ? connection.sessionA : connection.sessionB}>
                  {c.by === 'user' ? '你' : c.by === 'a' ? labelA : labelB}
                </span>
                <button
                  type="button"
                  className="ccr-box__del"
                  title="删除这条约定"
                  onClick={() => void remove(c.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="ccr-box__add">
          <input
            className="ccr-input ccr-input--topic"
            placeholder="分类"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <input
            className="ccr-input"
            placeholder="约定内容（对方不知道就会做错的事）"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void declare()
              }
            }}
          />
          <button
            type="button"
            className="ccr-btn"
            disabled={busy || draft.trim().length === 0}
            onClick={() => void declare()}
          >
            放入
          </button>
        </div>

        <div className="ccr-field__hint">
          约定**只存不发**，不占对方上下文；参与连接的会话可用 connection_conventions
          工具随时查到。
        </div>
      </div>
    </>
  )
}
