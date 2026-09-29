/**
 * SessionRowMarker — 把会话 id 写到会话行元素上的不可见标记。
 *
 * 背景：DSH 的会话行 DOM **没有任何 id 属性**（只有 `role="treeitem"` 和标题文本），
 * 所以「拖到哪个会话」「左侧竖线连哪两行」都缺一个 DOM → id 的映射。
 *
 * 官方给了入口：`sidebar.session.row.leading` 槽位的 ownerProps 是
 * `{ sessionId }`，挂进去就能知道自己在哪一行。
 * 这里渲染一个 `display:none` 的 span，并在 effect 里给祖先行元素打上
 * `data-ccr-session="<id>"` —— 于是 `[data-ccr-session]` 就成了可靠选择器。
 *
 * 注意：该槽位在「行处于非 idle 状态」时会被状态点顶掉（官方文档明说），
 * 因此不是每一行都有标记；调用方需容忍缺失（见 client/row-map.ts 的对齐逻辑）。
 */
import { useEffect, useRef } from 'react'

/** 行元素上承载会话 id 的属性名。 */
export const ROW_ID_ATTR = 'data-ccr-session'

interface SessionRowMarkerProps {
  sessionId: string
}

export function SessionRowMarker({ sessionId }: SessionRowMarkerProps) {
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const row = ref.current?.closest('[role="treeitem"]')
    if (!row) return
    row.setAttribute(ROW_ID_ATTR, sessionId)
    return () => {
      row.removeAttribute(ROW_ID_ATTR)
    }
  }, [sessionId])

  return <span ref={ref} style={{ display: 'none' }} aria-hidden="true" />
}
