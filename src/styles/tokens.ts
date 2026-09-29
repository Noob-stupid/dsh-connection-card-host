/**
 * 样式：CSS 文本 + 运行时注入。
 *
 * 为什么不用 `.css` 文件：DSH 客户端插件包由 tsdown 打成单个 JS，
 * 没有 CSS sidecar 加载通道（生态里的客户端插件一律用
 * `document.createElement('style')` 注入）。把 CSS 作为字符串放进 TS，
 * 保证它一定被打进 client bundle。
 *
 * 与此同时，关键几何（小圆圈的尺寸/颜色）在组件里用**内联样式**兜底：
 * 即使样式注入失败，控件仍然可见 —— 只有动画会缺失。
 */

/** 设计 tokens + 组件样式。 */
export const CONNECTION_CARD_CSS = `
:root {
  --ccr-rail-width: 24px;
  --ccr-rail-lane-gap: 8px;
  --ccr-rail-node-size: 8px;
  --ccr-perm-read: #9CA3AF;
  --ccr-perm-suggest: #3B82F6;
  --ccr-perm-write: #F97316;
  --ccr-health-green: #10B981;
  --ccr-health-yellow: #F59E0B;
  --ccr-health-red: #EF4444;
  --ccr-line-color: #60A5FA;
  /* 拉线「水流」主色。
     用户要求白色半透明；但纯白在浅色主题下不可见，
     因此取 DSH 的主题 token（深色主题=白，浅色主题=深），保证两个主题都看得见。
     想强制纯白就把这里改成 #ffffff。 */
  --ccr-flow-color: var(--dsw-alias-label-primary, #ffffff);
  --ccr-fast: 150ms cubic-bezier(0.2, 0, 0, 1);
  --ccr-panel-highlight: rgba(96, 165, 250, 0.12);
}

/* ═══ AnchorCircle（几何在内联样式里，这里只补动效） ═══ */
.ccr-anchor {
  animation: none;
}

.ccr-anchor__pulse {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid var(--ccr-flow-color);
  opacity: 0;
  pointer-events: none;
}

.ccr-anchor--dragging .ccr-anchor__pulse {
  animation: ccr-anchor-pulse 1200ms ease-out infinite;
}

/* 幅度收小：1 → 1.45（原来 2 太大，观感"一直闪"） */
@keyframes ccr-anchor-pulse {
  0% { transform: scale(1); opacity: 0.5; }
  100% { transform: scale(1.45); opacity: 0; }
}

/* ═══ DragLine：水流效果 ═══
   三层叠加：
     1. ccr-flow__glow   宽 + 高斯模糊 + 极低透明 → 水汽光晕
     2. ccr-flow__core   渐变白主线（两端淡出，不是硬邦邦的线）
     3. ccr-flow__band   短划线沿路径滑动 → 水在流
   粒子（水珠）由组件内联渲染。 */
.ccr-drag-line {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  overflow: visible;
}

.ccr-flow__glow {
  fill: none;
  stroke: var(--ccr-flow-color);
  stroke-width: 7px;
  stroke-opacity: 0.16;
  stroke-linecap: round;
}

.ccr-flow__core {
  fill: none;
  stroke-linecap: round;
}

.ccr-flow__band {
  fill: none;
  stroke: var(--ccr-flow-color);
  stroke-width: 1.2px;
  stroke-opacity: 0.5;
  stroke-linecap: round;
  stroke-dasharray: 34 58;
  animation: ccr-water-flow 1100ms linear infinite;
}

@keyframes ccr-water-flow {
  to { stroke-dashoffset: -92; }
}

.ccr-flow__particle {
  fill: var(--ccr-flow-color);
}

/* ═══ SessionRail：会话行上的竖线（风格对齐拖拽的水流线） ═══ */
.ccr-rail__flow {
  animation: ccr-rail-flow 2600ms linear infinite;
}

@keyframes ccr-rail-flow {
  to { stroke-dashoffset: -36; }
}

/* ═══ SessionRail ═══ */
.ccr-rail {
  position: relative;
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;
}

.ccr-rail__overflow {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  opacity: 0.6;
}

/* ═══ RailLane ═══ */
.ccr-lane {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}

.ccr-lane__line {
  stroke-linecap: round;
  transition: stroke-width var(--ccr-fast), opacity var(--ccr-fast);
}

.ccr-lane__line--dimmed { opacity: 0.2; }

/* ═══ 拖拽落点提示（命中左侧会话行） ═══ */
.ccr-target {
  background: var(--ccr-panel-highlight) !important;
  box-shadow: inset 2px 0 0 var(--ccr-flow-color) !important;
}

/* ═══ 面板（main 槽位，整页宽度） ═══ */
.ccr-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 40px;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
}

.ccr-page__head { margin-bottom: 20px; }

.ccr-page__title {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 600;
}

.ccr-page__sub {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #888);
}

.ccr-block {
  margin-bottom: 22px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  border-radius: 10px;
}

.ccr-block__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
}

.ccr-count {
  padding: 0 6px;
  border-radius: 8px;
  background: var(--ccr-panel-highlight);
  font-size: 11px;
  font-weight: 500;
}

/* ─── 表单 ─── */
.ccr-form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ccr-select,
.ccr-input {
  flex: 1 1 160px;
  min-width: 0;
  box-sizing: border-box;
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08));
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  border-radius: 6px;
}

.ccr-form__sep { opacity: 0.5; }

.ccr-btn {
  padding: 6px 14px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4));
  border-radius: 6px;
  cursor: pointer;
}

.ccr-btn:hover:not(:disabled) { background: var(--ccr-panel-highlight); }
.ccr-btn:disabled { opacity: 0.45; cursor: default; }

.ccr-btn--primary {
  border-color: var(--ccr-flow-color);
  background: var(--ccr-panel-highlight);
}

.ccr-btn--danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.14);
  border-color: #EF4444;
}

.ccr-link {
  margin-top: 8px;
  padding: 0;
  font: inherit;
  font-size: 11px;
  color: inherit;
  opacity: 0.6;
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
}

.ccr-hint,
.ccr-field__hint {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #888);
  opacity: 0.85;
}

/* ─── 提示条 ─── */
.ccr-notice,
.ccr-empty,
.ccr-error {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
}

.ccr-notice { background: var(--ccr-panel-highlight); }
.ccr-empty { color: var(--dsw-alias-label-secondary, #888); padding-left: 0; }
.ccr-error { color: #EF4444; padding-left: 0; }

/* ─── 连接卡片 ─── */
.ccr-list { display: flex; flex-direction: column; gap: 6px; }

.ccr-conn {
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  border-radius: 8px;
  overflow: hidden;
}

.ccr-conn--open { background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.05)); }

.ccr-conn__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}

.ccr-conn__head:hover { background: var(--ccr-panel-highlight); }

.ccr-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.ccr-conn__pair {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ccr-conn__session {
  max-width: 180px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ccr-conn__arrow { opacity: 0.45; }

.ccr-conn__meta {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #888);
}

.ccr-chevron { flex: none; opacity: 0.45; font-size: 10px; }

.ccr-conn__body {
  padding: 4px 12px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2));
}

.ccr-field { margin: 12px 0; }

.ccr-field__label {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
}

.ccr-seg {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  border-radius: 6px;
  overflow: hidden;
}

.ccr-seg__item {
  padding: 5px 14px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: none;
  border: 0;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  cursor: pointer;
  opacity: 0.7;
}

.ccr-seg__item:last-child { border-right: 0; }
.ccr-seg__item:hover:not(:disabled) { background: var(--ccr-panel-highlight); }
.ccr-seg__item--active { background: var(--ccr-panel-highlight); opacity: 1; font-weight: 500; }
.ccr-seg__item:disabled { cursor: default; opacity: 0.4; }

.ccr-conn__actions { display: flex; gap: 8px; margin-top: 12px; }

.ccr-card-stack { margin: 12px 0; }

/* ═══ 卡片区 ═══ */
.ccr-cards { margin: 12px 0; }

.ccr-cards__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.ccr-cards__add { margin-left: auto; margin-top: 0; }

.ccr-cards__picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.4));
  border-radius: 8px;
}

.ccr-card-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  font: inherit;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  border-radius: 6px;
  cursor: pointer;
}

.ccr-card-option:hover:not(:disabled) { background: var(--ccr-panel-highlight); }
.ccr-card-option:disabled { opacity: 0.45; cursor: default; }
.ccr-card-option__name { font-size: 12px; font-weight: 500; }
.ccr-card-option__meta { font-size: 11px; opacity: 0.6; }

.ccr-card {
  margin-top: 6px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  border-radius: 8px;
  overflow: hidden;
}

.ccr-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.ccr-card__name { font-weight: 500; }

.ccr-card__meta {
  font-size: 11px;
  opacity: 0.5;
  margin-right: auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 40%;
}

.ccr-card__panel {
  padding: 8px 10px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18));
  font-size: 12px;
}

/* ═══ 待确认的权限升级 ═══ */
.ccr-pending {
  margin: 10px 0;
  padding: 10px;
  border: 1px solid var(--ccr-flow-color);
  border-radius: 8px;
  background: var(--ccr-panel-highlight);
}

.ccr-pending__text {
  font-size: 12px;
  line-height: 1.5;
}

/* ═══ ConnectionPanel ═══ */
.ccr-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 13px;
  min-width: 220px;
}

.ccr-panel__tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.ccr-panel__tab {
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity var(--ccr-fast);
  user-select: none;
}

.ccr-panel__tab--active {
  opacity: 1;
  background: var(--ccr-panel-highlight);
}

.ccr-panel__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.ccr-panel__empty,
.ccr-panel__error {
  padding: 12px;
  opacity: 0.6;
}

.ccr-panel__error { color: #EF4444; opacity: 1; }

.ccr-row {
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--ccr-fast);
  border-left: 2px solid transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ccr-row:hover { background: var(--ccr-panel-highlight); }
.ccr-row--open { background: var(--ccr-panel-highlight); }

.ccr-card-row {
  padding: 4px 12px 4px 28px;
  font-size: 12px;
  opacity: 0.85;
}

.ccr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px 10px;
}

.ccr-actions button {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ccr-actions button:hover:not(:disabled) { background: var(--ccr-panel-highlight); }
.ccr-actions button:disabled { opacity: 0.45; cursor: default; }

/* ═══ 无障碍 / 降低动效 ═══ */
@media (prefers-reduced-motion: reduce) {
  .ccr-flow__band,
  .ccr-rail__flow,
  .ccr-anchor--dragging .ccr-anchor__pulse { animation: none !important; }
  .ccr-flow__particle { display: none !important; }
}
`

const STYLE_ELEMENT_ID = 'dsh-connection-card-host-styles'

/**
 * 把样式注入 document.head（幂等）。
 *
 * @returns 注销函数；非浏览器环境下返回空操作。
 */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}

  const existing = document.getElementById(STYLE_ELEMENT_ID)
  if (existing) {
    // 已注入：保留原标签，卸载时不要误删别人（或旧代）的样式
    return () => {}
  }

  const tag = document.createElement('style')
  tag.id = STYLE_ELEMENT_ID
  tag.textContent = CONNECTION_CARD_CSS
  document.head.appendChild(tag)

  return () => {
    tag.remove()
  }
}
