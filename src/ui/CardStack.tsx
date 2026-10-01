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
import type { Connection, CardScope } from '../types/index.js'
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

/**
 * 卡片可见范围。
 *
 * 「两端通用」= 这条连接上的两端都能收到它的事件、都能看到它的面板；
 * 「仅 A / 仅 B」= 只挂在某一端（另一端连它的存在都感知不到）。
 * 这正是用户要的「卡片是两端共享的，或者可以只给一端」。
 */
const SCOPE_CHOICES: { value: CardScope; label: string; hint: string }[] = [
  { value: 'both', label: '两端', hint: '连接的两端都能收到这张卡片的事件与面板' },
  { value: 'a', label: '仅 A', hint: '只挂在 A 端（B 端感知不到这张卡片）' },
  { value: 'b', label: '仅 B', hint: '只挂在 B 端（A 端感知不到这张卡片）' },
]

export function CardStack({ connection, client, onChanged }: CardStackProps) {
  const [templates, setTemplates] = useState<CardTemplateView[]>([])
  const [panels, setPanels] = useState<Record<string, string | null>>({})
  /**
   * 卡片更新状态：templateId → 检查结论。
   *
   * **`hasUpdate` 与 `reason` 要分开呈现** —— "无法检查"和"已是最新"是两回事，
   * 混在一起就是谎报（"检查更新"按钮点了却什么也没查，却显示"已是最新"）。
   */
  const [upd, setUpd] = useState<
    Record<string, { hasUpdate?: boolean; latestVersion?: string; reason?: string }>
  >({})
  const [updBusy, setUpdBusy] = useState<string | null>(null)
  /**
   * 哪些卡片实例的面板是展开的。
   *
   * **默认全部收起** —— 卡片面板是卡片自己渲染的 HTML，高度不可控，
   * 几张一起展开会把卡片区顶得很长（用户截图反馈"太占地方"）。
   * 收起时卡片名/可见范围/重载/移除照常显示，操作入口不藏。
   */
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  /** 加卡时选的可见范围（只作用于"下一次添加"）。 */
  const [scope, setScope] = useState<CardScope>('both')
  /** 安装：来源输入、进行中标志、回执/错误文本、已安装卡片根目录。 */
  const [spec, setSpec] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installMsg, setInstallMsg] = useState<string | null>(null)
  const [root, setRoot] = useState('')

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

  // 已安装卡片的根目录：显示给用户看，让"装到哪儿了"是透明的
  useEffect(() => {
    if (!client) return
    void client
      .cardsRoot()
      .then((r) => setRoot(r))
      .catch(() => {})
  }, [client])

  const add = useCallback(
    async (templateId: string) => {
      if (!client) return
      setBusy(templateId)
      try {
        await client.loadCard(templateId, connection.id, scope)
        setPicking(false)
        await load()
        onChanged?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, connection.id, scope, load, onChanged],
  )

  /** 装一张卡片到我们自己的目录，然后重扫模板。 */
  /**
   * 检查某张已安装卡片有没有更新。
   *
   * 结论**原样保留 `reason`** —— 面板会区分"有更新 / 已是最新 / 无法检查"三态。
   */
  const doCheckUpdate = useCallback(
    async (templateId: string) => {
      if (!client) return
      setUpdBusy(templateId)
      try {
        const r = await client.checkCardUpdate(templateId)
        setUpd((prev) => ({ ...prev, [templateId]: r }))
        if (r.reason) setInstallMsg(`检查更新：${r.reason}`)
      } catch (e) {
        setUpd((prev) => ({
          ...prev,
          [templateId]: { reason: e instanceof Error ? e.message : String(e) },
        }))
      } finally {
        setUpdBusy(null)
      }
    },
    [client],
  )

  /**
   * 更新一张已安装卡片：照着**记录的来源**重装，并让已装载的实例重载。
   *
   * 装载中也能更新，靠的是版本化目录（新版本写新目录，不碰被锁的旧目录）。
   */
  const doUpdate = useCallback(
    async (templateId: string) => {
      if (!client) return
      setUpdBusy(templateId)
      setInstallMsg(null)
      try {
        const r = await client.updateCard(templateId)
        if (r.ok) {
          setInstallMsg(
            `已更新：v${r.version ?? '?'}${r.reloaded ? `（重载 ${r.reloaded} 个实例）` : ''}`,
          )
          setUpd((prev) => ({ ...prev, [templateId]: {} }))
          await load()
        } else {
          setInstallMsg(`更新失败：${r.reason ?? '未知原因'}`)
        }
      } catch (e) {
        setInstallMsg(e instanceof Error ? e.message : String(e))
      } finally {
        setUpdBusy(null)
      }
    },
    [client, load],
  )

  const doInstall = useCallback(async () => {
    if (!client) return
    const s = spec.trim()
    if (s.length === 0) return
    setInstalling(true)
    setInstallMsg(null)
    try {
      const r = await client.installCard(s)
      if (r.ok) {
        setInstallMsg(`已安装：${r.name ?? r.cardId}${r.version ? ` v${r.version}` : ''}`)
        setSpec('')
        // 重扫后新卡片会出现在上面的可选列表里
        await load()
      } else {
        setInstallMsg(`安装失败：${r.reason ?? '未知原因'}`)
      }
    } catch (e) {
      setInstallMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(false)
    }
  }, [client, spec, load])

  /** 改一张已装载卡片的可见范围。 */  const changeScope = useCallback(
    async (instanceId: string, next: CardScope) => {
      if (!client) return
      setBusy(instanceId)
      try {
        await client.setCardScope(instanceId, next)
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client, load],
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
          {/*
           * 加卡之前先选范围。默认「两端通用」。
           * 这张卡片只在选中的那一端收到事件与面板（由 CardAPI 按 scope 过滤）。
           */}
          <div className="ccr-scope-pick">
            <span className="ccr-scope-pick__label">加到</span>
            <div className="ccr-seg ccr-seg--small">
              {SCOPE_CHOICES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`ccr-seg__item${scope === s.value ? ' ccr-seg__item--active' : ''}`}
                  title={s.hint}
                  onClick={() => setScope(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {available.length === 0 && (
            <div className="ccr-panel__empty">
              {templates.length === 0 ? '没有发现任何卡片模板' : '所有卡片都已添加'}
            </div>
          )}          {available.map((t) => (
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
                {/* 模板自己钉死了范围的话，用户选什么都会被覆盖 —— 提前说清 */}
                {t.scope && ` · 固定仅${t.scope === 'a' ? 'A' : 'B'}端`}
              </span>

              {/*
                已安装的卡片给一个「检查更新 / 更新」入口。
                状态分三种，而且**"无法判断"必须与"已是最新"分开显示** ——
                谎报"已是最新"会让人以为检查过了，实际什么都没查。
              */}
              {t.source === 'installed' && (
                <span
                  className="ccr-card-option__upd"
                  onClick={(e) => {
                    // 别触发外层的"装载"按钮
                    e.stopPropagation()
                    if (upd[t.templateId]?.hasUpdate) void doUpdate(t.templateId)
                    else void doCheckUpdate(t.templateId)
                  }}
                >
                  {updBusy === t.templateId
                    ? '…'
                    : upd[t.templateId]?.hasUpdate
                      ? `↑ 更新到 ${upd[t.templateId]?.latestVersion ?? '新版'}`
                      : upd[t.templateId]?.reason
                        ? '无法检查'
                        : upd[t.templateId]
                          ? '已是最新'
                          : '检查更新'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/*
       * 安装卡片：装到**我们自己的目录**，不碰 profile。
       * 用户给的理由很实在 —— 不会被 DSH 更新破坏，也不会破坏 DSH。
       */}
      {picking && (
        <div className="ccr-install">
          <div className="ccr-install__row">
            <input
              className="ccr-input"
              placeholder="包名 / 仓库 tgz 地址 / 本地目录路径"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void doInstall()
                }
              }}
            />
            <button
              type="button"
              className="ccr-btn"
              disabled={installing || spec.trim().length === 0}
              onClick={() => void doInstall()}
            >
              {installing ? '安装中…' : '安装'}
            </button>
          </div>
          <div className="ccr-field__hint">
            {installMsg ?? (
              <>
                支持 npm 包名、tgz 地址、本地目录。装到 <code>{root || '…'}</code>，
                <strong>不写入 DSH 的 profile</strong>，所以不会影响 DSH 本身、也不会被它的更新破坏。
              </>
            )}
          </div>
        </div>
      )}

      {cards.length === 0 && !picking && (
        <div className="ccr-panel__empty">这条连接还没有卡片</div>
      )}

      {cards.map((card) => {
        const template = templates.find((t) => t.templateId === card.templateId)
        const html = panels[card.instanceId] ?? null
        // 收起/展开：**默认收起**。卡片面板是卡片自己渲染的 HTML，高度不可控，
        // 几张卡一起展开会把整个卡片区顶得很长（用户截图反馈过"太占地方"）。
        // 收起时仍然显示卡片名/范围/重载/移除 —— 操作入口不藏。
        const expanded = expandedCards[card.instanceId] === true
        return (
          <div key={card.instanceId} className="ccr-card">
            <div className="ccr-card__head">
              <button
                type="button"
                className="ccr-card__toggle"
                title={expanded ? '收起' : '展开面板'}
                disabled={!html}
                onClick={() =>
                  setExpandedCards((prev) => ({ ...prev, [card.instanceId]: !expanded }))
                }
              >
                {html ? (expanded ? '▾' : '▸') : '·'}
              </button>
              <span
                className="ccr-dot"
                style={{ background: HEALTH_COLOR[connection.health] ?? '#10B981' }}
              />
              <span className="ccr-card__name">{template?.name ?? card.templateId}</span>
              {/*
               * 范围直接显示成可点的分段控件，而不是只读标签 ——
               * 改范围是常事（先两端试，定了再收紧到单端）。
               */}
              {template?.scope ? (
                <span className="ccr-card__scope-fixed" title="模板固定了这一端，不可更改">
                  仅{template.scope === 'a' ? 'A' : 'B'}端
                </span>
              ) : (
                <div className="ccr-seg ccr-seg--small ccr-card__scope">
                  {SCOPE_CHOICES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={`ccr-seg__item${(card.scope ?? 'both') === s.value ? ' ccr-seg__item--active' : ''}`}
                      disabled={busy === card.instanceId}
                      title={s.hint}
                      onClick={() => void changeScope(card.instanceId, s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
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
            {html && expanded && (
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
