/**
 * row-map — DOM 会话行 → 会话 id 的映射。
 *
 * 三个来源，按可靠度递减：
 *   1. `[data-ccr-session]` —— SessionRowMarker 写在行上。
 *      最可靠，但官方文档明说该槽位会被「状态点」顶掉，只有 idle 行会挂载
 *      （实测 18 行里 12 行有标记）。
 *   2. **标题匹配** —— 用行文本比对会话标题；只接受唯一命中，避免重名误判。
 *   3. **序号对齐** —— DOM 顺序与宿主会话列表顺序一致时按序号补；
 *      只在行数与会话数相等时启用（实测 94 vs 18，通常不成立）。
 *
 * 安全策略：三种都拿不到就放弃这一行。宁可少认几行，
 * 也绝不把连接建到错误的会话上。
 *
 * ## ⚠️ 本模块**不依赖 React**（这是刻意的 ✓）
 *
 * 它是**纯逻辑** ✓，跑在 Node 测试里 ✓。行标记属性名原先定义在
 * `ui/SessionRowMarker.tsx` ✗ ⇒ 任何加载本模块的地方都会被**连带拉起 react** ✗ ⇒
 * 裸 runner（CI）上测试连加载都失败 ✓：
 *
 *     Cannot find package 'react' imported from .../lib/ui/SessionRowMarker.js
 *
 * ⇒ 属性名**下沉到这里** ✓，由组件那边反过来引 ✓。
 * 判据：**常量住在"最先需要它、依赖最少"的那一层** ✓。
 */

/** 行元素上承载会话 id 的属性名（`SessionRowMarker` 与映射器共用 ✓）。 */
export const ROW_ID_ATTR = 'data-ccr-session'

export interface SessionRowInfo {
  element: Element
  id: string
  top: number
  bottom: number
  left: number
  right: number
}

export interface SessionSnapshotLike {
  ids: readonly string[]
  byId: Record<string, { title?: string }>
  /**
   * **当前会话** id（可选 ✓）。
   *
   * 用途：给"当前会话那一行"做**结构锚点** ✓ —— 见 `pickCurrentRowAnchor` ✓。
   * 声明为可选 ✓：老调用方/旧版本快照可能没有它 ✓，那时锚点自动不启用 ✓（不报错 ✓）。
   */
  current?: string
}

/** 行文本归一化：压空白 + 转小写。 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * **行文本 ↔ 会话标题**是否算同一个会话（标题匹配的唯一判据，导出供测试）。
 *
 * ## ⚠️ 为什么必须**双向**前缀（真机 bug 的根因）
 *
 * 旧判据是单向的：
 *
 *     text === title || text.startsWith(title)     // 要求"行文本包含**完整**标题" ✗
 *
 * 而会话行里的长标题会被 UI **截断成省略号** ✓（这类标题常见于以路径命名的会话：
 * `@~/Downloads/DSH 嵌入式…` ✓）—— 此时
 *
 *     行文本 = "@~/downloads/dsh 嵌入式"   （**比标题短** ✗）
 *     标题   = "@~/downloads/dsh 嵌入式 runtime"
 *
 * ⇒ `text.startsWith(title)` **永远为假** ✗ ⇒ 这个会话**永远认不出来** ✗
 * ⇒ 它的行拿不到 id ⇒ 连线配不上对 ⇒ **线画不出来** ✓（用户看到的就是这个 ✓）。
 *
 * 旁证：同一现场里**短标题**的会话（`准备协作` ✓）能匹配上 ✓，
 * 所以诊断里 `missing` **恰好只有一个** ✓ —— 正是"长标题被截断"的形状 ✓。
 *
 * ## 为什么仍然安全（不放松"不猜"这条纪律）
 *
 * · 仍是**前缀关系**（不是子串 ✓）—— 避免"标题是别人行文本中间一段"的误配 ✓
 * · 行文本至少 **4** 个字符才允许"行更短"的方向 ✓（1–2 个字符的前缀能撞上一堆标题 ✗）
 * · 调用方仍要求**唯一命中** ✓（bucket 长度必须为 1 ✓）
 * · 末尾的省略号先剥掉 ✓（`…` / `...` 两种写法 ✓）
 */
export function titleMatchesRowText(rowText: string, title: string): boolean {
  const text = normalizeText(stripTrailingEllipsis(rowText))
  const norm = normalizeText(title)
  if (text.length === 0 || norm.length === 0) return false
  if (text === norm) return true
  /** 行文本包含完整标题（标题较短、行里还有时间等 ✓）。 */
  if (text.startsWith(norm)) return true
  /** 行文本被截断（标题较长 ✓）—— 要求够长才允许，避免短前缀乱配 ✗。 */
  return text.length >= 4 && norm.startsWith(text)
}

/** 去掉末尾的省略号（UI 截断留下的 ✓）。 */
function stripTrailingEllipsis(text: string): string {
  return text.replace(/(?:…|\.{3,})\s*$/, '').trim()
}

/**
 * 标题候选里的**一条**：`[标题, 该标题对应的唯一 id]`。
 *
 * ⚠️ 每条的 id 必须**唯一** ✓（同名会话不进候选 ✓ —— 承认分不清比猜一个强 ✓）。
 */
export type TitleEntry = readonly [title: string, id: string]

/**
 * 从一行的文本里挑出**它所属的会话 id** —— 行级判据（导出供测试）。
 *
 * ## ⚠️ 为什么必须有"行级"这一层（负控抓出来的）
 *
 * 光有 `titleMatchesRowText` 不够 ✗：**一行可能同时匹配多个标题** ✓，例如
 *
 *     行文本 = "准备协作"     （4 个字符）
 *     标题   = "准备协作"     ← 精确匹配 ✓
 *              "准备协作二号" ← 前缀匹配也成立 ✓（行文本是它的前缀 ✓）
 *
 * 若按"第一个匹配上的就用"✗，就可能**连到错误的会话上** ✗ ——
 * 那比连不上更糟 ✓（用户未必立刻发现 ✓）。
 *
 * ## 规则（顺序即优先级）
 *
 *   1. **精确匹配**（行文本 == 标题 ✓）⇒ 直接采用 ✓（无歧义 ✓）
 *   2. 否则收集**所有**前缀匹配 ⇒ **恰好一个**才采用 ✓
 *   3. 零个或多个 ⇒ 返回 undefined ✓（**不猜** ✓）
 */
export function pickRowTitleId(rowText: string, entries: readonly TitleEntry[]): string | undefined {
  const text = normalizeText(stripTrailingEllipsis(rowText))
  if (text.length === 0) return undefined

  // ① 精确优先
  const exact = entries.filter(([title]) => normalizeText(title) === text)
  if (exact.length === 1) return exact[0]![1]
  if (exact.length > 1) return undefined // 同名多个 ⇒ 分不清 ✓

  // ② 前缀匹配，唯一才采用
  const prefix = entries.filter(([title]) => titleMatchesRowText(rowText, title))
  return prefix.length === 1 ? prefix[0]![1] : undefined
}

/**
 * **"当前会话那一行" 作为锚点** —— 用结构而不是文本（导出供测试）。
 *
 * ## 为什么需要它（比标题匹配可靠得多）
 *
 * 标题匹配天生脆 ✗：会截断 ✓、会重名 ✓、会改名 ✓。而"**当前会话**"是**结构事实** ✓：
 * DSH 会在当前会话那一行标 `aria-selected` / `aria-current` ✓（标准无障碍语义 ✓），
 * 而 `snapshot.current` 直接给出当前会话 id ✓ —— 这是**同一个事实的两个来源** ✓。
 *
 * 它恰好覆盖**旧实现翻车的那类行** ✓：当前会话行是**活跃**的 ✓ ⇒
 * 官方用自己的状态点**顶掉我们的标记槽位** ✗ ⇒ 这一行**没有标记** ✓、
 * 标题又可能被截断 ✓ ⇒ 两条老路都断 ✗ —— 而 `snapshot.current` 知道它是谁 ✓。
 *
 * ## 为什么安全（三条自校验，任一不满足就**不采用**）
 *
 *   1. 必须有 `currentId` ✓
 *   2. 那一行**还没有** id ✓（已知事实优先，不覆盖 ✓）
 *   3. **没有任何别的行**已被认成 `currentId` ✓（否则"活跃行 = 当前会话"这个假设
 *      在本次渲染里已被**证伪** ✗ ⇒ 不采用 ✓）
 *
 * ⇒ 这是"**用结构补充文本**"，不是"用猜测覆盖事实" ✓。
 */
export function pickCurrentRowAnchor(
  rowIds: readonly (string | undefined)[],
  activeIndex: number | undefined,
  currentId: string | undefined,
): { index: number; id: string } | undefined {
  if (!currentId) return undefined
  if (activeIndex === undefined || activeIndex < 0 || activeIndex >= rowIds.length) return undefined
  if (rowIds[activeIndex] !== undefined) return undefined
  for (let i = 0; i < rowIds.length; i++) {
    if (i !== activeIndex && rowIds[i] === currentId) return undefined
  }
  return { index: activeIndex, id: currentId }
}

/**
 * 收集当前 DOM 里能确定 id 的会话行（按视觉顺序）。
 * @param snapshot - 会话快照（提供 id 顺序与标题，用于兜底匹配）
 */
export function collectSessionRows(snapshot: SessionSnapshotLike | null): SessionRowInfo[] {
  if (typeof document === 'undefined') return []
  const rows = Array.from(document.querySelectorAll('[role="treeitem"]'))
  if (rows.length === 0) return []

  const ids = snapshot?.ids ?? []
  const byId = snapshot?.byId ?? {}

  const idByRow = new Map<Element, string>()
  const anchorIndexById = new Map<number, string>()

  // 1) 标记属性（最可靠）
  rows.forEach((row, index) => {
    const id = row.getAttribute(ROW_ID_ATTR)
    if (id) {
      idByRow.set(row, id)
      anchorIndexById.set(index, id)
    }
  })

  // 2) 标题匹配：只接受唯一命中的标题，且标题须是行文本的前缀
  //    （行里还有时间等额外文本，用前缀判断更稳）
  const idsByTitle = new Map<string, string[]>()
  for (const id of ids) {
    const title = byId[id]?.title
    if (typeof title !== 'string') continue
    const key = normalizeText(title)
    if (key.length === 0) continue
    const bucket = idsByTitle.get(key)
    if (bucket) bucket.push(id)
    else idsByTitle.set(key, [id])
  }
  if (idsByTitle.size > 0) {
    /** 拍平成 `[标题, id]` 候选（只保留**同名唯一**的标题 ✓ —— 同名多条分不清 ✓）。 */
    const entries: TitleEntry[] = []
    for (const [title, bucket] of idsByTitle) {
      if (bucket.length === 1) entries.push([title, bucket[0]!] as const)
    }
    for (const row of rows) {
      if (idByRow.has(row)) continue
      const text = row.textContent ?? ''
      if (normalizeText(text).length === 0) continue
      /** **行级**判据：精确优先 + 唯一才采用 ✓（见 `pickRowTitleId` 的说明 ✓）。 */
      const picked = pickRowTitleId(text, entries)
      if (picked) idByRow.set(row, picked)
    }
  }

  /**
   * 2.5) **结构锚点：当前会话那一行** ✓
   *
   * 这一步专治"活跃行两条老路都断"的场合（没有标记 ✗ + 标题被截断 ✗）：
   * 当前会话行恰恰是活跃行 ✓，而 `snapshot.current` 知道它的 id ✓。
   * 判据与自校验见 `pickCurrentRowAnchor` ✓（任一条件不满足就不采用 ✓）。
   *
   * ⚠️ 必须在**补缺之前**加进 `anchorIndexById` ✓ —— 它要作为一个**已知锚点**
   * 参与后面的缺口计算 ✓（只加 `idByRow` 就只能救这一行，帮不了邻居 ✗）。
   */
  {
    const activeIndex = rows.findIndex(
      (r) =>
        r.getAttribute('aria-selected') === 'true' || r.getAttribute('aria-current') === 'true',
    )
    const anchor = pickCurrentRowAnchor(
      rows.map((r) => idByRow.get(r)),
      activeIndex >= 0 ? activeIndex : undefined,
      snapshot?.current,
    )
    if (anchor) {
      const row = rows[anchor.index]
      if (row) {
        idByRow.set(row, anchor.id)
        anchorIndexById.set(anchor.index, anchor.id)
      }
    }
  }

  // 3) 锚点之间「排除法补缺」。
  //
  // 为什么需要：会话一开始跑回复就变成「活跃」，官方会用状态点**顶掉**我们的
  // 标记槽位（文档明说 "mounted only by a row whose primary state is idle"），
  // 那一行突然没了 id → 竖线断掉；跑完恢复 idle，线又回来。
  // 用户观察到的「运行回复时连线短暂消失」就是这个。
  //
  // 做法：侧栏渲染的是 ids 的**保序视图**（过滤/分组但相对顺序不变）。
  // 两个已知锚点之间的缺口，其候选 = ids 里落在两锚点之间、且没被别的行认领的条目。
  // 只有候选数**恰好等于**缺口行数时才采用 —— 这是唯一能确定的情况，
  // 其余一律放弃：宁可少画一条线，也不把线连到错误的会话上。
  if (anchorIndexById.size > 0) {
    const idIndexById = new Map<string, number>()
    ids.forEach((id, i) => { if (!idIndexById.has(id)) idIndexById.set(id, i) })

    const claimedIdIndexes = new Set<number>()
    for (const id of idByRow.values()) {
      const i = idIndexById.get(id)
      if (i !== undefined) claimedIdIndexes.add(i)
    }

    // 锚点按 DOM 序号排序
    const anchors = [...anchorIndexById.entries()]
      .map(([domIndex, id]) => ({ domIndex, idIndex: idIndexById.get(id) ?? -1 }))
      .filter((a) => a.idIndex >= 0)
      .sort((a, b) => a.domIndex - b.domIndex)

    /** 在 (loId, hiId) 区间内给 (loDom, hiDom) 的空档补 id。 */
    const fillGap = (
      loDom: number,
      hiDom: number,
      loIdIndex: number,
      hiIdIndex: number,
    ): void => {
      const gapDoms: number[] = []
      for (let i = loDom + 1; i < hiDom; i++) {
        if (!idByRow.has(rows[i])) gapDoms.push(i)
      }
      if (gapDoms.length === 0) return

      const candidates: number[] = []
      for (let k = loIdIndex + 1; k < hiIdIndex; k++) {
        if (!claimedIdIndexes.has(k)) candidates.push(k)
      }
      // 唯一解才采用
      if (candidates.length !== gapDoms.length) return

      gapDoms.forEach((domIndex, n) => {
        const id = ids[candidates[n]]
        if (!id) return
        idByRow.set(rows[domIndex], id)
        claimedIdIndexes.add(candidates[n])
      })
    }

    // 相邻锚点之间
    for (let i = 0; i + 1 < anchors.length; i++) {
      fillGap(anchors[i].domIndex, anchors[i + 1].domIndex, anchors[i].idIndex, anchors[i + 1].idIndex)
    }
    // 头部（第一个锚点之前）与尾部（最后一个锚点之后）
    if (anchors.length > 0) {
      fillGap(-1, anchors[0].domIndex, -1, anchors[0].idIndex)
      fillGap(anchors[anchors.length - 1].domIndex, rows.length, anchors[anchors.length - 1].idIndex, ids.length)
    }
  }

  // 4) 兜底：行数与会话数完全相等时按序号直配
  if (ids.length === rows.length) {
    rows.forEach((row, i) => {
      const candidate = ids[i]
      if (candidate && !idByRow.has(row)) idByRow.set(row, candidate)
    })
  }

  const result: SessionRowInfo[] = []
  for (const row of rows) {
    const id = idByRow.get(row)
    if (!id) continue
    const rect = row.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    result.push({
      element: row,
      id,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    })
  }
  result.sort((a, b) => a.top - b.top)
  return result
}

/**
 * 命中坐标下的会话行信息；没有可靠映射时返回 null。
 *
 * ## ⚠️ 这里曾经只认"全量映射"，导致落点判定整条链失效（2026-10-02 修）
 *
 * 旧实现是：
 *
 *     const row = el?.closest('[role="treeitem"]')
 *     return collectSessionRows(snapshot).find((info) => info.element === row) ?? null
 *
 * 也就是**先找到行，再问"这一行在不在全量映射表里"**。
 * 而 `collectSessionRows` 的映射不可能覆盖每一行 —— 它靠
 * ① `data-ccr-session` 标记（官方槽位**只在行 idle 时挂载**，跑着的行没有）
 * ② 锚点间插值（**只在唯一解时采用**）
 * ③ 兜底 `ids.length === rows.length`（侧栏只显示子集时**必然不成立**）
 *
 * 实测现场：`ids=110 rows=23 marked=17` —— 有 6 行映射不上（文件夹行、
 * 以及自插件加载起从未 idle 过的会话行）。用户拖到这些行上就得到
 * `no-row-under-cursor`，体感是"拖不出线"。
 *
 * **关键认识：命中一行跟映射全表是两件事。** 只要指针下确实有一行，
 * 就该尽力算出它的会话 id，而不是因为"它在全表里没有"就当作没命中。
 *
 * ## 现在的三层
 *
 *   1. 全量映射命中 → 直接返回（最可信）
 *   2. **邻居夹逼**：取该行上下最近的**已映射**行，在快照 id 序列里取它们之间
 *      唯一未被占用的 id（与 collectSessionRows 的 fillGap 同一思路，但只针对这一行）
 *   3. 都不行 → 返回 null，并**带上原因**（供诊断区分"没命中行"与"命中但认不出"）
 */
export interface RowHit {
  info: SessionRowInfo | null
  /** 指针下确实有一行（`role="treeitem"`）。 */
  hitRow: boolean
  /** 命中的 DOM 元素描述（诊断用，如 `div.ccr-page` / `div[role=treeitem]`）。 */
  elementDesc: string
  /** 为什么没解析出会话 id（`info` 非空时为 undefined）。 */
  missReason?: string
  /**
   * 这个 id 是**靠邻居夹逼推出来**的（不是全量映射直接命中的）。
   *
   * ⚠️ 为什么要标出来：夹逼是"算"出来的，不是"读"出来的 ——
   * **算错的后果是连到错误的会话上，比连不上更糟**（用户可能不会立刻发现）。
   * 标出来之后，诊断日志里能看出哪些连接是推出来的，出了问题可回溯。
   */
  inferred?: boolean
}

/** 元素的简短描述，用于诊断日志。 */
function describeElement(el: Element | null): string {
  if (!el) return 'null'
  const tag = el.tagName.toLowerCase()
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
  const role = el.getAttribute('role')
  return `${tag}${cls ? `.${cls}` : ''}${role ? `[role=${role}]` : ''}`
}

/**
 * 栈里某一层的描述：元素 + **`pointer-events` 计算值** + 是否会话行。
 *
 * 为什么要 `pointer-events`：它是区分两种病因的关键判据 ——
 * `elementsFromPoint` **会跳过 `pointer-events: none` 的元素**，
 * 所以"栈里没有真实行"到底是"行不在那个位置"还是"行被关了指针事件"，
 * 不看这个值就只能猜。
 */
function describeStackLayer(el: Element): string {
  let pe = '?'
  try {
    pe = window.getComputedStyle(el).pointerEvents || '?'
  } catch {
    /* 拿不到就算了 */
  }
  const isRow = el.closest?.('[role="treeitem"]') ? ' ✓row' : ''
  return `${describeElement(el)}(pe=${pe}${isRow})`
}

/**
 * 对一个**具体的行元素**解析会话 id —— 不要求它在全量映射表里。
 *
 * @param row - `role="treeitem"` 的行元素
 * @param snapshot - 会话快照（提供 id 顺序）
 * @param mapped - 已经全量映射出来的行（用来做邻居夹逼）
 */
function resolveRowId(
  row: Element,
  snapshot: SessionSnapshotLike | null,
  mapped: SessionRowInfo[],
): { id?: string; reason?: string } {
  const ids = snapshot?.ids ?? []
  if (ids.length === 0) return { reason: '快照没有会话 id' }

  // 全部 treeitem，按文档顺序 —— 用来算"这一行是第几行"
  const allRows = Array.from(document.querySelectorAll('[role="treeitem"]'))
  const myIndex = allRows.indexOf(row)
  if (myIndex < 0) return { reason: '行不在 treeitem 列表里' }

  const indexById = new Map(ids.map((id, i) => [id, i]))
  const claimed = new Set<number>()
  const domIndexById = new Map<number, number>()
  for (const info of mapped) {
    const di = allRows.indexOf(info.element)
    const ii = indexById.get(info.id)
    if (di >= 0 && ii !== undefined) {
      claimed.add(ii)
      domIndexById.set(di, ii)
    }
  }

  // 邻居夹逼：找上下最近的已映射行
  let loDom = -1
  let loId = -1
  let hiDom = allRows.length
  let hiId = ids.length
  for (const [di, ii] of domIndexById) {
    if (di < myIndex && di > loDom) {
      loDom = di
      loId = ii
    }
    if (di > myIndex && di < hiDom) {
      hiDom = di
      hiId = ii
    }
  }
  if (loDom < 0 && hiDom >= allRows.length) {
    return { reason: '上下都没有已映射的行可作锚点' }
  }

  // 我这一行与 lo 锚点之间隔了几行；那些行里未映射的才可能是我
  const gapDoms: number[] = []
  for (let i = loDom + 1; i < myIndex; i++) {
    if (!mapped.some((m) => m.element === allRows[i])) gapDoms.push(i)
  }
  const candidates: number[] = []
  for (let k = loId + 1; k < hiId; k++) {
    if (!claimed.has(k)) candidates.push(k)
  }
  // 唯一解才采用（与 collectSessionRows 的 fillGap 同一条纪律：不猜）
  if (candidates.length === 1 && gapDoms.length === 0) {
    const id = ids[candidates[0]!]
    if (id) return { id }
  }
  if (candidates.length !== gapDoms.length + 1) {
    return {
      reason: `候选不唯一（缺口 ${gapDoms.length + 1} 行 / 候选 ${candidates.length} 个 id）`,
    }
  }
  const id = ids[candidates[gapDoms.length]!]
  if (!id) return { reason: '候选 id 为空' }
  return { id }
}

/**
 * 命中坐标下的会话行（含诊断信息）。
 *
 * 与 `sessionRowAtPoint` 的区别：**即使这一行不在全量映射表里也会尽力解析**，
 * 并把失败原因带出来。拖拽落点用这个版本。
 *
 * ## 两层鲁棒性
 *
 * **① 穿透式取元素**（2026-10-02 加，有实证支撑）：
 * 用 `elementsFromPoint`（复数）从栈顶往下找**第一个会话行**，而不是只看栈顶那一个。
 *
 * 为什么必须这样：用户实际遇到过「拖不出线」，最后定位到是**皮肤插件
 * （`web-ui-skin-center`）关掉就恢复正常** —— 皮肤的全屏叠加层挡住了指针，
 * 单数版 `elementFromPoint` 只会返回那层叠加层，`closest('[role="treeitem"]')`
 * 自然为空 → 一律 `no-row-under-cursor`。
 *
 * 语义上也更对：用户**看得见**那一行才往那儿拖，叠加层是透明的装饰，
 * 不该改变"我指的是哪一行"。
 *
 * **② 不要求全量映射**：见 `resolveRowId` 的说明。
 */
export function sessionRowHitAtPoint(
  x: number,
  y: number,
  snapshot: SessionSnapshotLike | null,
): RowHit {
  if (typeof document === 'undefined') {
    return { info: null, hitRow: false, elementDesc: 'no-document' }
  }

  const mapped = collectSessionRows(snapshot)

  /*
   * ── ① 几何命中：**首选**，因为它对叠加层免疫 ──
   *
   * 实测证据：装上 `web-ui-skin-center` 后，`elementsFromPoint` **走完整条栈
   * （13–25 层）却一个会话行都没有**，而关掉皮肤就正常。
   * 两种可能（皮肤给真实 UI 关了 `pointer-events`／皮肤渲染了自己的视觉副本）
   * **DOM 栈都救不了** —— 复数版会跳过 `pointer-events:none` 的元素，
   * 视觉副本则根本不是 `[role="treeitem"]`。只有几何能救。
   *
   * 这也正是用户的心智模型：**我看得见那一行，就该能拖上去。**
   *
   * 与 `collectSessionRows` 的 `fillGap` 同纪律：**唯一解才采用**。
   * 行之间本不该重叠；真重叠了说明有状况，那时不猜，退到 DOM 栈。
   */
  const inside = mapped.filter(
    (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
  )
  if (inside.length === 1) {
    const only = inside[0]!
    return {
      info: only,
      hitRow: true,
      elementDesc: `几何命中 ${describeElement(only.element)}`,
    }
  }

  // ── ② DOM 栈穿透：处理几何没覆盖到的情形 ──
  const stack: Element[] =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(x, y)
      : ([document.elementFromPoint(x, y)].filter(Boolean) as Element[])

  // 诊断：前 3 层的 pointer-events 与是否行 —— 区分 H1 与 H2 的关键证据
  const top3 = stack.slice(0, 3).map(describeStackLayer).join(' | ')

  let row: Element | null = null
  for (const el of stack) {
    const candidate = el.closest?.('[role="treeitem"]')
    if (candidate) {
      row = candidate
      break
    }
  }

  if (!row) {
    /*
     * 栈里一个会话行都没有 —— 最深那一层的现场。
     *
     * 诊断给全 **指针坐标 / 最近行的矩形与方向 / 已知行的视口可见比例**，
     * 因为这三样合起来才能区分剩下的几种可能：
     *
     *   · 最近行距离 ≈ 0（指针就在某行矩形里）却不进栈
     *     → **H1**：皮肤把真实 UI 的 pointer-events 关了（配 `pe=` 一起看）
     *   · 距离很大（半屏以上）、栈里是输入框/markdown 之类
     *     → **指针根本不在会话列表上**（用户在别处松手），或
     *       **H2 的位置变体**：皮肤改写了布局，插件认识的行与用户看到的位置不重合
     *   · 视口内行 ≈ 0/N（行全零尺寸或全在视口外）
     *     → 行被藏起来/被挪走了 → 属于**皮肤侧必须修**
     */
    let nearest = 'n/a'
    let visible = 'n/a'
    if (mapped.length > 0) {
      let best = Infinity
      let bestId = ''
      let bestRect = ''
      let bestDir = ''
      for (const r of mapped) {
        const dxL = r.left - x
        const dxR = x - r.right
        const dyT = r.top - y
        const dyB = y - r.bottom
        const dx = dxL > 0 ? dxL : dxR > 0 ? dxR : 0
        const dy = dyT > 0 ? dyT : dyB > 0 ? dyB : 0
        const d = Math.hypot(dx, dy)
        if (d < best) {
          best = d
          bestId = r.id
          bestRect = `{x:${Math.round(r.left)},y:${Math.round(r.top)},w:${Math.round(
            r.right - r.left,
          )},h:${Math.round(r.bottom - r.top)}}`
          const vs = dyT > 0 ? '上' : dyB > 0 ? '下' : ''
          const hs = dxL > 0 ? '左' : dxR > 0 ? '右' : ''
          bestDir = `${vs}${hs}` || '内'
        }
      }
      nearest = `${bestId.slice(0, 8)} rect=${bestRect} 距 ${Math.round(best)}px(向:${bestDir})`

      // 视口可见比例：区分"行被藏起来"与"行在别处"
      const vw = window.innerWidth
      const vh = window.innerHeight
      let vis = 0
      for (const r of mapped) {
        const w = r.right - r.left
        const h = r.bottom - r.top
        if (w <= 0 || h <= 0) continue
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue
        vis++
      }
      visible = `${vis}/${mapped.length}`
    }
    const head = `xy=(${Math.round(x)},${Math.round(y)})`
    return {
      info: null,
      hitRow: false,
      elementDesc:
        stack.length > 0
          ? `${head} 栈 ${stack.length} 层均非行(命中行 ${inside.length} 个) [${top3}] ` +
            `最近行=${nearest} 视口内行=${visible}`
          : `${head} 空栈 视口内行=${visible}`,
    }
  }

  const direct = mapped.find((info) => info.element === row)
  if (direct) {
    return { info: direct, hitRow: true, elementDesc: `栈命中 ${describeElement(row)}` }
  }

  const resolved = resolveRowId(row, snapshot, mapped)
  if (!resolved.id) {
    return {
      info: null,
      hitRow: true,
      elementDesc: describeElement(row),
      missReason: resolved.reason ?? '未知',
    }
  }

  const rect = row.getBoundingClientRect()
  return {
    info: {
      element: row,
      id: resolved.id,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    },
    hitRow: true,
    elementDesc: describeElement(row),
    // 标出来：这个 id 是推出来的，不是直接读到的
    inferred: true,
  }
}

/**
 * 命中坐标下的会话行信息；没有可靠映射时返回 null。
 *
 * 保留这个签名是为了兼容既有调用方 —— 内部已改为走 `sessionRowHitAtPoint`
 * （也就是**不再要求这一行在全量映射表里**）。
 */
export function sessionRowAtPoint(
  x: number,
  y: number,
  snapshot: SessionSnapshotLike | null,
): SessionRowInfo | null {
  return sessionRowHitAtPoint(x, y, snapshot).info
}

