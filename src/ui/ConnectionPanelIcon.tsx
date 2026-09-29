/**
 * ConnectionPanelIcon — sidebar.panellist 里的图标。
 *
 * 这个槽位**只放图标**（ownerProps 是 `{ size, active }`），点击由侧栏
 * 自己负责——它用 list 的 `id` 去 `main` 槽位找同名面板并切换过去。
 * 早期版本把整个面板塞进这里，于是侧栏出现溢出文案，是错的。
 *
 * 颜色用 currentColor，跟随侧栏的行内/悬停/选中配色。
 */
interface ConnectionPanelIconProps {
  /** 请求的方形边长（px），由侧栏给出。 */
  size: number
  /** 该面板当前是否被选中。 */
  active: boolean
}

export function ConnectionPanelIcon({ size, active }: ConnectionPanelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', opacity: active ? 1 : 0.75 }}
    >
      {/* 两个节点 + 中间的连接线：直观表达"会话连接" */}
      <circle cx="6" cy="7" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M6 9.6 C6 14, 10 12, 12 12 S 18 10, 18 14.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeDasharray="3 2.5"
        opacity="0.95"
      />
    </svg>
  )
}
