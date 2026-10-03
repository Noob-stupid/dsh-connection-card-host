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
import { CapturedCardUi } from './CapturedCardUi.js'
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

  /**
   * **适配卡**的模板 id 集合 —— 只有这些卡片才有"插件自带 UI"可捕获。
   *
   * 取不到就当作空集：侧栏不显示，面板其余部分照常（UI 捕获是附加能力，
   * 不该因为一次列表请求失败而影响主流程）。
   */
  const [adapterTemplates, setAdapterTemplates] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!client) return
    let alive = true
    void (async () => {
      try {
        const list = await client.listCardTemplates()
        if (!alive) return
        setAdapterTemplates(new Set(list.filter((t) => t.adapter).map((t) => t.templateId)))
      } catch {
        /* 忽略：没有侧栏也能用 */
      }
    })()
    return () => {
      alive = false
    }
  }, [client])

  const { options: sessionOptions, labelOf, ready: sessionsReady } = useSessionList(sessions)

  /**
   * 新建连接用的会话槽位。
   * 默认两个；点中间的箭头可以加第三个 —— 三个会**两两相连**（3 条连接）。
   */
  const [picks, setPicks] = useState<string[]>(['', ''])
  const [manual, setManual] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /**
   * 侧栏要渲染的卡片：**只属于"当前展开的那条连接"** 的适配卡。
   *
   * ## ⚠️ 这里原先是**遍历所有连接** —— 用户报的行为缺陷（现场："固定位置呆着不动"）
   *
   * 用户原话：
   *
   * > 「应该展开对应的连接右侧才会展现，**而不是固定位置呆着不动** ——
   * >   因为如果有多个连接，**展开哪个右侧就显示哪个**。」
   *
   * 原来的写法把**所有连接**上挂的适配卡都收进来 ⇒
   *   ① 右侧**不跟随**展开态（看起来"钉在原地"✗）
   *   ② 多连接时**重复挂载 + 白渲染** ✗
   *   ③ 切换连接时旧组件**不卸载** ⇒ **Y 会看到 X 的组件状态** ✗（React 组件带 state）
   *
   * 现在：`expandedId` 决定一切 ✓ ——
   *   · 展开 X ⇒ 只收 X 的卡 ✓
   *   · 没展开任何连接（`null`）⇒ 列表为空 ⇒ 右侧**整个不渲染**（不残留上一条 ✗）
   *   · 从 X 切到 Y ⇒ 列表成员整体换掉 ⇒ React **卸载旧的、重挂新的** ✓
   *     （`key` 里带上连接 id ⇒ 即使两张卡的 `instanceId` 撞了也不会复用 X 的实例 ✓）
   */
  const capturedCards = useMemo(() => {
    const out: { key: string; instanceId: string; label: string }[] = []
    if (!expandedId) return out
    const conn = connections.find((c) => c.id === expandedId)
    if (!conn) return out
    for (const card of conn.cards ?? []) {
      if (!adapterTemplates.has(card.templateId)) continue
      out.push({
        /** **连接 id + 实例 id** 一起做 key：换连接 ⇒ 必然卸载重挂 ✓。 */
        key: `${conn.id}:${card.instanceId}`,
        instanceId: card.instanceId,
        label: `${card.templateId} · ${conn.id.slice(0, 8)}`,
      })
    }
    return out
  }, [connections, adapterTemplates, expandedId])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingUpgradeView[]>([])

  /** 视图偏好（lane 上限），改完立刻广播给轨道 */
  const [prefsState, setPrefsState] = useState(() => prefs.get())
  useEffect(() => prefs.subscribe(() => setPrefsState(prefs.get())), [prefs])

  /**
   * 中继**是否真的在自动转发**。
   *
   * ⚠️ 不能用权限档位判断 —— 两者在 2026-10-01 之后已解耦：
   * 自动转发默认关闭，权限只影响**显式发送**能发哪类消息。
   * 只看权限会让警告条喊狼来了（显示"正在互相转发"而实际什么都没转发）。
   */
  const [relayOn, setRelayOn] = useState(false)
  useEffect(() => {
    if (!client) return
    let alive = true
    const check = () =>
      client
        .relayDiagnostics()
        .then((d) => {
          if (alive) setRelayOn(d.relayConfig.relayAssistant || d.relayConfig.relayUser)
        })
        .catch(() => {})
    void check()
    const timer = window.setInterval(check, 5000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [client])

  const setPick = useCallback((index: number, value: string) => {
    setPicks((prev) => prev.map((v, i) => (i === index ? value : v)))
  }, [])

  /**
   * 一次性诊断：面板滚不动时，需要知道**到底是谁在裁**。
   *
   * 从面板根节点往上走，把每个祖先的 overflow / height 记下来。
   *
   * ⚠️ **两种坏形态都要报**（第二种是后补的，正是它漏掉过一次真实回归）：
   *
   *   ① 内容超出 + 自身不可滚 —— 直观的那种
   *   ② **自身比视口还高**（说明它"长高了"而不是在滚动）——
   *      这种 `scrollHeight == clientHeight`，旧诊断直接 return，**一声不吭**。
   *      实测踩到：给面板加了一层 flex 外层，`.ccr-page` 的 `height:100%` 落空 ⇒
   *      退化成 auto ⇒ 不再是滚动容器、内容把页面撑高 ⇒ 滚轮没反应且无日志。
   */
  useEffect(() => {
    if (!client) return
    const timer = window.setTimeout(() => {
      const root = document.querySelector('.ccr-page') as HTMLElement | null
      if (!root) return

      const selfOvf = window.getComputedStyle(root).overflowY
      const selfScrollable = selfOvf === 'auto' || selfOvf === 'scroll'
      const overflowing = root.scrollHeight > root.clientHeight + 1
      const tallerThanViewport = root.getBoundingClientRect().height > window.innerHeight + 8

      const broken = (overflowing && !selfScrollable) || (tallerThanViewport && !overflowing)
      if (!broken) return

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
        `panel 滚不动（${tallerThanViewport && !overflowing ? '长高了没滚' : '内容超出不可滚'}）` +
          `client=${root.clientHeight} scroll=${root.scrollHeight} box=${Math.round(root.getBoundingClientRect().height)} ` +
          `vh=${window.innerHeight} selfOvf=${selfOvf} :: ${chain.join(' <- ')}`,
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
    /*
     * 外层是**横向排布**：主内容（原来那一列）+ 右侧的插件 UI 侧栏。
     * 面板主体仍是 `ccr-page`（max-width 720 居中），侧栏占用右边那片留白 ——
     * 用户要的正是"左右两侧那么多空地"当插件的落点。
     */
    <div className="ccr-page-wrap">
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

        {/*
          只在中继**真的在自动转发**时才警告。
          判据是 relayAssistant/relayUser 的实际值，不是权限档位 ——
          自动转发默认已关闭，用权限判断会喊狼来了。
        */}
        {ready && relayOn && (
          <div className="ccr-forward-warn">
            <span className="ccr-forward-warn__dot" />
            <span>
              中继正在<strong>自动转发会话消息</strong>
              —— 你在任一端说的话都会送进另一端，并<strong>让对方被唤醒去回应</strong>。
              这是非默认行为，通常应该关掉。
            </span>
          </div>
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
                      <div className="ccr-field__label">
                        消息转发权限（两个方向可分别设置）
                      </div>

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

                      {/*
                        这两条是「教一次就够」的说明 —— 关掉后不再显示。
                        **按连接记**（localStorage 键里带 connectionId）：
                        新建的连接 id 不同 → 自然重新显示，正好是用户要的
                        「除非新建连接」。
                      */}
                      <DismissibleHint hintKey={`perm:${conn.id}`}>
                        <div className="ccr-field__hint">
                          <strong>这个开关控制的是「允许发哪类消息」，不是「对方能不能干活」</strong>
                          —— 对方任何时候都能自己做事，与这里无关。两个方向互不影响，
                          可以做成一端可写入、另一端只读。
                        </div>
                        <div className="ccr-field__hint">
                          只读<strong>不影响感知</strong>：工作状态与公约盒都是对端主动查询的，
                          与权限无关。降低权限立即生效；提高权限需要被授权的一方确认。
                        </div>
                      </DismissibleHint>
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

      {/*
       * 适配卡插件的 UI —— 用户要的位置：**面板左右两侧的留白处**。
       *
       * 这些组件来自第三方插件，本来是往 DSH 全局槽位注册的；适配层把它们**捕获**下来，
       * 只渲染在这里（见 ui/CapturedCardUi.tsx）。捕获不到就什么都不显示 ——
       * 纯能力型插件本来就没有 UI。
       */}
      {client && capturedCards.length > 0 && (
        <aside className="ccr-page__side" aria-label="卡片界面">
          {capturedCards.map((c) => (
            <CapturedCardUi
              /**
               * ⚠️ key 用 **`连接id:实例id`**（不是单独的 `instanceId`）——
               * 换一条展开的连接时，key 必然整套换掉 ⇒ React **卸载旧的、重挂新的** ✓。
               * 若只用 `instanceId`，两张不同连接的卡在极端情况下可能被 React 复用同一实例 ⇒
               * **Y 会看到 X 的组件状态** ✗（用户点名要确认的就是这条）。
               */
              key={c.key}
              client={client}
              instanceId={c.instanceId}
              label={c.label}
              onDiagnostic={(m: string) => {
                try {
                  client.report(m)
                } catch {
                  /* 诊断失败不影响界面 */
                }
              }}
            />
          ))}
        </aside>
      )}
    </div>
  )
}

/**
 * 可关闭的说明块 —— 「教一次就够」的文案用它包起来。
 *
 * ## 为什么按 `hintKey` 记、存在 localStorage
 *
 * 用户的要求是：**关掉后不再显示，除非新建连接**。
 * 把 connectionId 编进键里，新建的连接 id 不同 → 查不到"已关闭"记录 → 自动重新显示。
 * 正好是这个语义，不需要额外的"新建连接时重置"逻辑。
 *
 * 存本地而不是存进连接数据：这是**这一台浏览器上的阅读偏好**，
 * 不是连接本身的属性 —— 没必要同步给对端，也没必要进持久化文件。
 */
function DismissibleHint({
  hintKey,
  children,
}: {
  hintKey: string
  children: React.ReactNode
}) {
  const storageKey = `ccr-hint-dismissed:${hintKey}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1'
    } catch {
      // 隐私模式等拿不到 localStorage —— 那就当没关过（宁可多显示，不要报错）
      return false
    }
  })

  if (dismissed) return null

  return (
    <div className="ccr-dismissible">
      <button
        type="button"
        className="ccr-hint__close"
        title="关闭后不再显示（新建连接时会重新出现）"
        onClick={() => {
          setDismissed(true)
          try {
            localStorage.setItem(storageKey, '1')
          } catch {
            /* 存不进去只影响"下次还显示"，不该让关闭动作失败 */
          }
        }}
      >
        ×
      </button>
      {children}
    </div>
  )
}