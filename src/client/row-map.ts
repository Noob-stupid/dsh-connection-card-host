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
 */
import { ROW_ID_ATTR } from '../ui/SessionRowMarker.js'

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
}

/** 行文本归一化：压空白 + 转小写。 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
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
    for (const row of rows) {
      if (idByRow.has(row)) continue
      const text = normalizeText(row.textContent ?? '')
      if (text.length === 0) continue
      for (const [title, bucket] of idsByTitle) {
        if (bucket.length !== 1) continue
        if (text === title || text.startsWith(title)) {
          idByRow.set(row, bucket[0])
          break
        }
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

/** 命中坐标下的会话行信息；没有可靠映射时返回 null。 */
export function sessionRowAtPoint(
  x: number,
  y: number,
  snapshot: SessionSnapshotLike | null,
): SessionRowInfo | null {
  if (typeof document === 'undefined') return null
  const el = document.elementFromPoint(x, y)
  const row = el?.closest('[role="treeitem"]')
  if (!row) return null
  return collectSessionRows(snapshot).find((info) => info.element === row) ?? null
}
