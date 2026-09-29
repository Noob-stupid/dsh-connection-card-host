/**
 * sessions-bridge — 读取 DSH 客户端的会话列表（`ctx.sessions`）。
 *
 * 为什么需要它：会话行的 DOM 里**没有 id**（只有 `role="treeitem"` 和标题文本），
 * 所以「拖到哪个会话」「左侧竖线连哪两行」都必须靠真实会话列表来定位。
 *
 * 契约（来自 dsh-client-runtime 的 ISessions）：
 *   ctx.sessions.list : ObservableSnapshot<{ ids, byId, current, phase }>
 *   ctx.sessions.open(id)
 *
 * 字段逐层防御式读取：拿不到就返回 null，宁可功能不出现，也不要出错的线。
 */
import { safeCtxGet } from '../safe-ctx.js'

export interface SessionSummaryLite {
  title?: string
  updatedAt?: number
}

export interface SessionListSnapshot {
  /** 宿主列表顺序的会话 id。 */
  ids: string[]
  byId: Record<string, SessionSummaryLite>
  /** 当前选中的会话。 */
  current: string | undefined
}

export interface SessionsBridge {
  getSnapshot(): SessionListSnapshot
  subscribe(listener: () => void): () => void
  /** 选中某个会话（侧栏点击等价）。 */
  open(id: string): void
}

const EMPTY: SessionListSnapshot = { ids: [], byId: {}, current: undefined }

function normalize(raw: unknown): SessionListSnapshot {
  const s = raw as { ids?: unknown; byId?: unknown; current?: unknown } | null | undefined
  if (!s || typeof s !== 'object') return EMPTY

  const ids = Array.isArray(s.ids) ? s.ids.filter((x): x is string => typeof x === 'string') : []
  const byId: Record<string, SessionSummaryLite> = {}
  if (s.byId && typeof s.byId === 'object') {
    for (const [key, value] of Object.entries(s.byId as Record<string, unknown>)) {
      const v = value as SessionSummaryLite | null | undefined
      byId[key] = {
        title: typeof v?.title === 'string' ? v.title : undefined,
        updatedAt: typeof v?.updatedAt === 'number' ? v.updatedAt : undefined,
      }
    }
  }
  const current = typeof s.current === 'string' ? s.current : undefined
  return { ids, byId, current }
}

/** 从 cordis 上下文取会话桥；不可用时返回 null。 */
export function resolveSessions(ctx: unknown): SessionsBridge | null {
  const sessions = safeCtxGet<{
    list?: { getSnapshot?(): unknown; subscribe?(fn: () => void): () => void }
    open?(id: string): void
  }>(ctx, 'sessions')

  const list = sessions?.list
  if (!list || typeof list.getSnapshot !== 'function') return null

  return {
    getSnapshot: () => normalize(list.getSnapshot!()),
    subscribe: (listener) => {
      try {
        const off = list.subscribe?.(listener)
        return typeof off === 'function' ? off : () => {}
      } catch {
        return () => {}
      }
    },
    open: (id) => {
      try {
        sessions?.open?.(id)
      } catch {
        /* 打不开就算了，不影响连接管理 */
      }
    },
  }
}

/** 会话的展示名：标题优先，否则截断 id。 */
export function sessionLabel(
  bridge: SessionsBridge | null,
  id: string,
  snapshot?: SessionListSnapshot,
): string {
  const title = (snapshot ?? bridge?.getSnapshot())?.byId[id]?.title
  if (typeof title === 'string' && title.trim().length > 0) return title.trim()
  return id.length > 12 ? `${id.slice(0, 12)}…` : id
}
