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
  --ccr-fast: 150ms cubic-bezier(0.2, 0, 0, 1);
  --ccr-panel-highlight: rgba(96, 165, 250, 0.12);
}

/* ═══ AnchorCircle（几何在内联样式里，这里只补动效） ═══ */
.ccr-anchor {
  animation: none;
}

.ccr-anchor__pulse {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid var(--ccr-line-color);
  opacity: 0;
  pointer-events: none;
}

.ccr-anchor--dragging .ccr-anchor__pulse {
  animation: ccr-anchor-pulse 900ms ease-out infinite;
}

@keyframes ccr-anchor-pulse {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(2); opacity: 0; }
}

/* ═══ DragLine ═══ */
.ccr-drag-line {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  overflow: visible;
}

.ccr-drag-line__path {
  fill: none;
  stroke: var(--ccr-line-color);
  stroke-width: 2px;
  stroke-opacity: 0.75;
  stroke-dasharray: 6 4;
  stroke-linecap: round;
  animation: ccr-dash-flow 600ms linear infinite;
}

@keyframes ccr-dash-flow {
  to { stroke-dashoffset: -20; }
}

.ccr-drag-line__particle {
  fill: var(--ccr-line-color);
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

/* ═══ 拖拽目标高亮 ═══ */
.ccr-target-highlight {
  background: var(--ccr-panel-highlight) !important;
  box-shadow: inset 2px 0 0 var(--ccr-line-color) !important;
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
  .ccr-drag-line__path,
  .ccr-anchor--dragging .ccr-anchor__pulse { animation: none !important; }
  .ccr-drag-line__particle { display: none !important; }
}
`;
const STYLE_ELEMENT_ID = 'dsh-connection-card-host-styles';
/**
 * 把样式注入 document.head（幂等）。
 *
 * @returns 注销函数；非浏览器环境下返回空操作。
 */
export function injectStyles() {
    if (typeof document === 'undefined')
        return () => { };
    const existing = document.getElementById(STYLE_ELEMENT_ID);
    if (existing) {
        // 已注入：保留原标签，卸载时不要误删别人（或旧代）的样式
        return () => { };
    }
    const tag = document.createElement('style');
    tag.id = STYLE_ELEMENT_ID;
    tag.textContent = CONNECTION_CARD_CSS;
    document.head.appendChild(tag);
    return () => {
        tag.remove();
    };
}
//# sourceMappingURL=tokens.js.map