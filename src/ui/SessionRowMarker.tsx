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

/**
 * 行元素上承载会话 id 的属性名。
 *
 * ⚠️ **这个常量住在这里是错的** ✗ —— 它被 `src/client/row-map.ts` 用 ✓，
 * 而那个模块是**纯逻辑**（跑在 Node 测试里 ✓）。
 * 把常量定义在一个 `import react` 的文件里 ✗ ⇒ 任何加载 `row-map` 的地方
 * 都**被迫拉起 react** ✓ —— 裸 runner（CI）没有 react ⇒ 测试连**加载**都失败 ✓：
 *
 *     Cannot find package 'react' imported from .../lib/ui/SessionRowMarker.js
 *
 * ⇒ 现在常量**下沉到 `row-map.ts`** ✓（无 react 依赖 ✓），这里改为**从那边引入** ✓。
 * 一条判据：**常量要住在"最先需要它的、依赖最少的那一层"** ✓ ——
 * 住在组件里就等于给纯逻辑绑上了 UI 依赖 ✗。
 */
export { ROW_ID_ATTR } from '../client/row-map.js'
import { ROW_ID_ATTR } from '../client/row-map.js'

interface SessionRowMarkerProps {
  sessionId: string
}

export function SessionRowMarker({ sessionId }: SessionRowMarkerProps) {
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const row = ref.current?.closest('[role="treeitem"]')
    if (!row) return
    row.setAttribute(ROW_ID_ATTR, sessionId)

    // ⚠️ 卸载时**故意不删**这个属性。
    //
    // 会话一开始跑回复就变「活跃」，官方立刻用状态点顶掉本槽位
    //（文档原话 "mounted only by a row whose primary state is idle"），
    // 组件随之卸载。若在这里 removeAttribute，那一行的 id 就没了 →
    // 认不出它 → 连线在对方跑回复期间整段消失、跑完才回来。
    // 这正是用户观察到的「运行回复时连线短暂消失」。
    //
    // 留着是安全的：侧栏以 session id 作 key，React 复用**同一行**的 DOM 节点，
    // 属性不会串到别的会话；会话被删时节点整体丢弃。
    // 行再次回到 idle 时组件重新挂载，写入同样的值。
    return undefined
  }, [sessionId])

  return <span ref={ref} style={{ display: 'none' }} aria-hidden="true" />
}
