/**
 * AwarenessPanel —— 一条连接上的「协作感知」区块。
 *
 * 两块内容，对应两层：
 *
 *   A. 工作状态 —— **自动采集**：两边各自在改什么文件、计划进行到哪一步。
 *      只读。这是「我知道你在干什么」。
 *
 *   B. 公约盒   —— **显式声明**：双方说好了什么（接口、坐标、单位、命名、分工）。
 *      可增可删。这是「我们说好了什么」。
 *
 * ## 两块默认收起
 *
 * 用户反馈两块都摊开「看着面板太杂了，根本不想仔细看」。
 * 所以默认折叠 —— 但**标题行始终显示一行摘要**（谁在干什么 / 有几条约定、
 * 都是什么主题），不展开也能拿到要点，展开才看细节。
 * 展开状态存进视图偏好，跨会话保持。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  ConnectionCardHostClient,
  ConventionView,
  WorkView,
} from '../client/host-client.js'
import type { ViewPrefsStore } from '../client/view-prefs.js'
import type { Connection } from '../types/index.js'

interface AwarenessPanelProps {
  client: ConnectionCardHostClient | null
  connection: Connection
  labelA: string
  labelB: string
  prefs: ViewPrefsStore
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

function shortPath(p: string): string {
  return p.replace(/\\/g, '/').split('/').slice(-2).join('/')
}

/** 收起状态下的一行摘要：谁在干什么。 */
function workDigest(
  work: { a: WorkView | null; b: WorkView | null },
  labelA: string,
  labelB: string,
): string {
  const parts: string[] = []
  for (const [label, st] of [
    [labelA, work.a],
    [labelB, work.b],
  ] as const) {
    if (st && st.updatedAt > 0) {
      const stale = Date.now() - st.updatedAt > STALE_MS
      parts.push(`${label} ${st.lastAction || '空闲'}${stale ? '（久未更新）' : ''}`)
    } else {
      parts.push(`${label} 未采集`)
    }
  }
  return parts.join(' · ')
}

/** 收起状态下的一行摘要：有几条约定、都是什么主题。 */
function boxDigest(conventions: ConventionView[]): string {
  if (conventions.length === 0) return '还没有约定'
  const topics = Array.from(new Set(conventions.map((c) => c.topic))).slice(0, 4)
  return `${conventions.length} 条 · ${topics.join('、')}`
}

export function AwarenessPanel({
  client,
  connection,
  labelA,
  labelB,
  prefs,
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
  /** 中继诊断：被挡下的非真人来源计数（可查询，不怕日志滚动）。 */
  const [diagnostics, setDiagnostics] = useState<
    {
      sessionId: string
      kind: string
      count: number
      lastSeenAt: number
      lastDropped: string
    }[]
  >([])

  // 展开状态来自共享偏好（默认都收起）
  const [open, setOpen] = useState(() => ({
    work: prefs.get().workOpen,
    box: prefs.get().boxOpen,
  }))
  useEffect(
    () =>
      prefs.subscribe(() => {
        const p = prefs.get()
        setOpen({ work: p.workOpen, box: p.boxOpen })
      }),
    [prefs],
  )
  const toggle = useCallback(
    (which: 'work' | 'box') => {
      const p = prefs.get()
      prefs.set(which === 'work' ? { workOpen: !p.workOpen } : { boxOpen: !p.boxOpen })
    },
    [prefs],
  )

  const load = useCallback(async () => {
    if (!client) return
    try {
      const [w, c] = await Promise.all([
        client.connectionWork(connection.id),
        client.listConventions(connection.id),
      ])
      setWork(w)
      setConventions(c)
      // 诊断另算：它失败不该影响主内容
      client
        .relayDiagnostics()
        .then((d) => setDiagnostics(d.skipped))
        .catch(() => {})
    } catch {
      /* 轮询失败静默，下一轮再试 */
    }
  }, [client, connection.id])

  // 工作状态是实时的，要轮询；收起时降到 8 秒（摘要也要新鲜，但不必那么勤）
  useEffect(() => {
    void load()
    const period = open.work ? 3000 : 8000
    const timer = window.setInterval(() => void load(), period)
    return () => window.clearInterval(timer)
  }, [load, open.work])

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

  // 有"正在干活"的迹象时给标题加个小点，收起状态下也能一眼看出对方在忙
  const someoneActive = [work.a, work.b].some(
    (s) => s && s.updatedAt > 0 && Date.now() - s.updatedAt < STALE_MS,
  )

  /**
   * 中继诊断：被挡下的非真人来源。
   *
   * 放这里而不是只写日志，是因为**日志会被清空/滚动** —— 只写一次的信号
   * 一旦滚掉就永久消失。可查询的东西不怕滚动。
   * （这条建议来自对端会话，同时补上"状态靠翻日志猜"这个缺口。）
   */
  const skipped = diagnostics.filter(
    (d) => d.sessionId === connection.sessionA || d.sessionId === connection.sessionB,
  )

  return (
    <>
      {/* ═══ A. 工作状态 ═══ */}
      <section className={`ccr-fold${open.work ? ' ccr-fold--open' : ''}`}>
        <button type="button" className="ccr-fold__head" onClick={() => toggle('work')}>
          <span className="ccr-fold__chevron">{open.work ? '▾' : '▸'}</span>
          <span className="ccr-fold__title">对方在做什么</span>
          {someoneActive && <span className="ccr-fold__live" title="对方正在活动" />}
          <span className="ccr-fold__digest" title={workDigest(work, labelA, labelB)}>
            {workDigest(work, labelA, labelB)}
          </span>
        </button>

        {open.work && (
          <div className="ccr-fold__body">
            <div className="ccr-work">
              {(
                [
                  ['a', labelA, work.a, connection.sessionA],
                  ['b', labelB, work.b, connection.sessionB],
                ] as const
              ).map(([side, name, state, fullId]) => (
                <div key={side} className="ccr-work__row">
                  <div className="ccr-work__head">
                    <span className="ccr-work__name" title={fullId}>
                      {name}
                    </span>
                    {state && state.updatedAt > 0 ? (
                      <span
                        className={`ccr-work__age${
                          Date.now() - state.updatedAt > STALE_MS ? ' ccr-work__age--stale' : ''
                        }`}
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
                              {t.status === 'completed'
                                ? '✓'
                                : t.status === 'in_progress'
                                  ? '▶'
                                  : '·'}{' '}
                              {t.content}
                            </li>
                          ))}
                        </ul>
                      )}
                      {state.files.length > 0 && (
                        <div className="ccr-work__files" title={state.files.join('\n')}>
                          {state.files.slice(0, 4).map((f) => (
                            <span key={f} className="ccr-work__file">
                              {shortPath(f)}
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
              ))}
            </div>

            {/*
              中继诊断：只在有东西被挡下时才显示（平时不占地方）。
              带内容预览，因为**计数只说"挡了多少"，说不出"挡的是什么"** ——
              万一框架给真人消息换了个 kind，光看正常计数发现不了误挡。
            */}
            {skipped.length > 0 && (
              <div className="ccr-work__diag">
                <div
                  className="ccr-work__diag-head"
                  title="跨会话通道只放行真人发言；宿主通知（任务完成、模型切换等）一律挡下"
                >
                  已挡下非发言来源：
                  {skipped.map((d) => ` ${d.kind}×${d.count}`).join(' · ')}
                </div>
                {skipped.slice(0, 2).map((d) => (
                  <div key={`${d.sessionId}:${d.kind}`} className="ccr-work__diag-item">
                    <span className="ccr-work__diag-kind">{d.kind}</span>
                    <span className="ccr-work__diag-preview" title={d.lastDropped}>
                      {d.lastDropped || '(无内容)'}
                    </span>
                    <span className="ccr-work__diag-age">{ago(d.lastSeenAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ═══ B. 公约盒 ═══ */}
      <section className={`ccr-fold${open.box ? ' ccr-fold--open' : ''}`}>
        <button type="button" className="ccr-fold__head" onClick={() => toggle('box')}>
          <span className="ccr-fold__chevron">{open.box ? '▾' : '▸'}</span>
          <span className="ccr-fold__title">共享约定</span>
          <span className="ccr-fold__digest" title={boxDigest(conventions)}>
            {boxDigest(conventions)}
          </span>
        </button>

        {open.box && (
          <div className="ccr-fold__body">
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
                    <span
                      className="ccr-box__who"
                      title={
                        c.by === 'user'
                          ? '你在面板里直接添加的'
                          : c.by === 'a'
                            ? connection.sessionA
                            : connection.sessionB
                      }
                    >
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
        )}
      </section>
    </>
  )
}
