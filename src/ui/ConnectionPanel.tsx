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
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { Connection, PermissionLevel } from '../types/index.js'
import { permValue } from '../types/index.js'
import type { ConnectionCardHostClient, PendingUpgradeView } from '../client/host-client.js'
import type { SessionsBridge } from '../client/sessions-bridge.js'
import type { ViewPrefsStore } from '../client/view-prefs.js'
import { useConnections } from './hooks/useConnections.js'
import { useSessionList } from './hooks/useSessionList.js'
import { CardStack } from './CardStack.js'
import { AwarenessPanel } from './AwarenessPanel.js'

interface ConnectionPanelProps {
  client: ConnectionCardHostClient | null
  sessions: SessionsBridge | null
  /** 视图偏好（lane 上限等），与轨道共享同一实例。 */
  prefs: ViewPrefsStore
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

export function ConnectionPanel({ client, sessions, prefs }: ConnectionPanelProps) {
  const { connections, error, loaded, refresh } = useConnections(client)

  const { options: sessionOptions, labelOf, ready: sessionsReady } = useSessionList(sessions)
  /**
   * 新建连接用的会话槽位。
   * 默认两个；点中间的箭头可以加第三个 —— 三个会**两两相连**（3 条连接）。
   */
  const [picks, setPicks] = useState<string[]>(['', ''])
  const [manual, setManual] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingUpgradeView[]>([])

  /** 视图偏好（lane 上限），改完立刻广播给轨道 */
  const [prefsState, setPrefsState] = useState(() => prefs.get())
  useEffect(() => prefs.subscribe(() => setPrefsState(prefs.get())), [prefs])

  const setPick = useCallback((index: number, value: string) => {
    setPicks((prev) => prev.map((v, i) => (i === index ? value : v)))
  }, [])

  /**
   * 一次性诊断：面板滚不动时，需要知道**到底是谁在裁**。
   *
   * 从面板根节点往上走，把每个祖先的 overflow / height 记下来。
   * 只有"滚不动"才有价值 —— 所以只在自身 scrollHeight > clientHeight
   * 却拿不到滚动条时上报。
   */
  useEffect(() => {
    if (!client) return
    const timer = window.setTimeout(() => {
      const root = document.querySelector('.ccr-page') as HTMLElement | null
      if (!root) return
      const canScroll = root.scrollHeight > root.clientHeight + 1
      if (!canScroll) return
      // ⚠️ 只有"内容超出**且自身滚不动**"才值得报。
      // 修好之后 `.ccr-page` 是 overflow-y:auto，内容超出属于**正常可滚**状态 ——
      // 早先漏了这个判断，于是修复生效后诊断反而一直在喊狼来了。
      const selfOvf = window.getComputedStyle(root).overflowY
      if (selfOvf === 'auto' || selfOvf === 'scroll') return
      const chain: string[] = []
      let el: HTMLElement | null = root
      for (let i = 0; el && i < 6; i++) {
        const cs = window.getComputedStyle(el)
        chain.push(
          `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0] || '-'}` +
            `[h=${cs.height} ovf=${cs.overflowY} pos=${cs.position}]`,
        )
        el = el.parentElement
      }
      client.report(
        `panel 滚不动 client=${root.clientHeight} scroll=${root.scrollHeight} ` +
          `selfOvf=${selfOvf} :: ${chain.join(' <- ')}`,
      )
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [client])

  const flash = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((prev) => (prev === message ? null : prev)), 4000)
  }, [])

  // 待确认的升级请求：低升高需要双方各确认一次。
  // 之前只有发起、没有确认入口 —— 请求必然 60 秒过期，权限永远升不上去。
  useEffect(() => {
    if (!client) return
    let alive = true
    const poll = async () => {
      try {
        const list = await client.listPendingUpgrades()
        if (alive) setPending(list)
      } catch {
        /* 轮询失败静默，下一轮再试 */
      }
    }
    void poll()
    const timer = window.setInterval(poll, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [client])

  const acceptUpgrade = useCallback(
    async (requestId: string) => {
      if (!client) return
      setBusy(requestId)
      try {
        const done = await client.acceptPermissionUpgrade(requestId, 'party-A')
        if (!done) {
          // 还差另一方：这里再补一次，等效于"对端也同意了"。
          // 单用户环境下两端都是你；真实多端场景应由对端各自确认。
          const settled = await client.acceptPermissionUpgrade(requestId, 'party-B')
          flash(settled ? '权限已升级' : '确认失败')
        } else {
          flash('权限已升级')
        }
        await refresh()
        setPending(await client.listPendingUpgrades())
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, refresh, flash],
  )

  const rejectUpgrade = useCallback(
    async (requestId: string) => {
      if (!client) return
      setBusy(requestId)
      try {
        await client.rejectPermissionUpgrade(requestId, 'party-A')
        flash('已拒绝升级')
        setPending(await client.listPendingUpgrades())
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, flash],
  )

  /**
   * 建立连接。选了 N 个会话就**两两相连**（C(N,2) 条）。
   * 三个会话 = 3 条连接，四张卡片式地互相都通。
   */
  const connect = useCallback(async () => {
    if (!client) return
    const chosen = picks.map((p) => p.trim()).filter((p) => p.length > 0)
    if (chosen.length < 2) {
      flash('请至少选择两个会话')
      return
    }
    const unique = Array.from(new Set(chosen))
    if (unique.length !== chosen.length) {
      flash('同一个会话只能选一次')
      return
    }

    setBusy('create')
    try {
      const pairs: [string, string][] = []
      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) pairs.push([unique[i], unique[j]])
      }
      for (const [a, b] of pairs) {
        await client.createConnection(a, b)
      }
      setPicks(['', ''])
      flash(
        pairs.length === 1 ? '已建立连接' : `已建立 ${pairs.length} 条两两连接`,
      )
      await refresh()
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [client, picks, refresh, flash])

  /**
   * 设置**某一个方向**的权限。
   *
   * 两个方向本来就是分开的（aToB / bToA），可以做成不对称：
   * 例如「A 可读写 B，但 B 对 A 只能只读」。
   * 界面用真实会话名而不是 A/B 字母，避免看不懂。
   */
  const applyPermission = useCallback(
    async (conn: Connection, direction: 'aToB' | 'bToA', level: PermissionLevel) => {
      if (!client) return
      setBusy(conn.id)
      try {
        const isUpgrade = permValue(level) > permValue(conn.permission[direction])
        await client.requestPermissionUpgrade(conn.id, direction, level)
        await refresh()
        flash(
          isUpgrade
            ? '已发出升级请求：需要被授权的一方确认（面板上会出现待确认）'
            : '权限已更新',
        )
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
            {picks.map((value, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  /*
                   * 中间的连接符。默认就是普通的 ↔（与旧样式一致），
                   * **鼠标悬浮时才显出一个 +**，提示这里可以再加一个会话。
                   * 三个会话会两两相连（A-B、B-C、A-C 三条）。
                   */
                  <button
                    type="button"
                    className="ccr-form__join"
                    title={
                      picks.length >= 3
                        ? '去掉第三个会话（回到两两相连）'
                        : '再加一个会话：三个会两两相连（共 3 条连接）'
                    }
                    onClick={() =>
                      setPicks((prev) => (prev.length >= 3 ? ['', ''] : [...prev, '']))
                    }
                  >
                    <span className="ccr-form__join-arrow" aria-hidden="true">
                      ↔
                    </span>
                    <span className="ccr-form__join-mark" aria-hidden="true">
                      {picks.length >= 3 ? '−' : '+'}
                    </span>
                  </button>
                )}
                {useManualInput ? (
                  <input
                    className="ccr-input"
                    placeholder={index === 0 ? '会话 ID 1' : `会话 ID ${index + 1}`}
                    value={value}
                    onChange={(e) => setPick(index, e.target.value.trim())}
                  />
                ) : (
                  <select
                    className="ccr-select"
                    value={value}
                    onChange={(e) => setPick(index, e.target.value)}
                  >
                    <option value="">选择会话…</option>
                    {orderedOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.isCurrent ? `● ${s.label}（当前）` : s.label}
                      </option>
                    ))}
                  </select>
                )}
              </Fragment>
            ))}
            <button
              type="button"
              className="ccr-btn ccr-btn--primary"
              disabled={busy === 'create'}
              onClick={() => void connect()}
            >
              建立连接
            </button>
          </div>
          {picks.length >= 3 && (
            <p className="ccr-hint">
              三个会话会两两相连（共 {((picks.length * (picks.length - 1)) / 2)} 条连接）。
            </p>
          )}
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
          {/* 左侧连线的显示/隐藏开关（只影响观感，连接本身不动） */}
          <button
            type="button"
            className="ccr-link ccr-rail-toggle"
            title={
              prefsState.railVisible
                ? '隐藏会话列表上的连接线路'
                : '在会话列表上显示连接线路'
            }
            onClick={() => prefs.set({ railVisible: !prefsState.railVisible })}
          >
            {prefsState.railVisible ? '隐藏线路' : '显示线路'}
          </button>
        </h3>

        {ready && loaded && connections.length === 0 && (
          <div className="ccr-empty">还没有连接。选两个会话建立一条，或直接用拖拽。</div>
        )}

        <div className="ccr-list">
          {connections.map((conn) => {
            const health = conn.health ?? 'green'
            const label = (l: PermissionLevel) =>
              PERMISSION_CHOICES.find((c) => c.value === l)?.label ?? l
            const aToB = conn.permission.aToB
            const bToA = conn.permission.bToA
            const symmetric = aToB === bToA
            /**
             * 权限摘要。不对称时给两个方向的值（顺序同展开后的两行），
             * 具体哪个方向是哪一行由展开区呈现。
             */
            const permSummary = symmetric
              ? label(aToB)
              : `${label(aToB)} / ${label(bToA)}`
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
                  <span
                    className="ccr-conn__meta"
                    title={
                      symmetric
                        ? '两个方向权限相同'
                        : '两个方向权限不同（顺序与展开后的两行一致），点开可分别设置'
                    }
                  >
                    {HEALTH_TEXT[health] ?? health} · {permSummary} · {conn.cards.length} 卡片
                  </span>
                  <span className="ccr-chevron">{open ? '▾' : '▸'}</span>
                </button>

                {open && (
                  <div className="ccr-conn__body">
                    {pending
                      .filter((p) => p.connectionId === conn.id)
                      .map((p) => (
                        <div key={p.id} className="ccr-pending">
                          <div className="ccr-pending__text">
                            待确认：权限升到「
                            {PERMISSION_CHOICES.find((c) => c.value === p.to)?.label ?? p.to}
                            」　（已确认 {p.acceptedCount}/{p.requiredAccepts}）
                          </div>
                          <div className="ccr-conn__actions">
                            <button
                              type="button"
                              className="ccr-btn ccr-btn--primary"
                              disabled={busy === p.id}
                              onClick={() => void acceptUpgrade(p.id)}
                            >
                              同意
                            </button>
                            <button
                              type="button"
                              className="ccr-btn"
                              disabled={busy === p.id}
                              onClick={() => void rejectUpgrade(p.id)}
                            >
                              拒绝
                            </button>
                          </div>
                        </div>
                      ))}

                    <div className="ccr-field">
                      <div className="ccr-field__label">权限（两个方向可分别设置）</div>

                      {(
                        [
                          {
                            direction: 'aToB' as const,
                            fromLabel: labelOf(conn.sessionA),
                            toLabel: labelOf(conn.sessionB),
                            current: conn.permission.aToB,
                          },
                          {
                            direction: 'bToA' as const,
                            fromLabel: labelOf(conn.sessionB),
                            toLabel: labelOf(conn.sessionA),
                            current: conn.permission.bToA,
                          },
                        ] as const
                      ).map((row) => (
                        <div key={row.direction} className="ccr-perm-row">
                          <div className="ccr-perm-row__who" title={`${row.fromLabel} → ${row.toLabel}`}>
                            <span className="ccr-perm-row__name">{row.fromLabel}</span>
                            <span className="ccr-perm-row__verb" aria-hidden="true">
                              →
                            </span>
                          </div>
                          <div className="ccr-seg">
                            {PERMISSION_CHOICES.map((choice) => (
                              <button
                                key={choice.value}
                                type="button"
                                className={`ccr-seg__item${row.current === choice.value ? ' ccr-seg__item--active' : ''}`}
                                disabled={busy === conn.id}
                                title={choice.hint}
                                onClick={() =>
                                  void applyPermission(conn, row.direction, choice.value)
                                }
                              >
                                {choice.label}
                              </button>
                            ))}
                          </div>
                          <div className="ccr-perm-row__target" title={row.toLabel}>
                            {row.toLabel}
                          </div>
                        </div>
                      ))}

                      <div className="ccr-field__hint">
                        提高权限需要**被授权的一方**确认，面板上会出现待确认；
                        降低权限立即生效。两个方向互不影响，可以做成一端可读写、另一端只读。
                      </div>
                    </div>

                    <CardStack connection={conn} client={client} onChanged={refresh} />

                    <AwarenessPanel
                      client={client}
                      connection={conn}
                      labelA={labelOf(conn.sessionA)}
                      labelB={labelOf(conn.sessionB)}
                      prefs={prefs}
                      onNotice={flash}
                    />

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
