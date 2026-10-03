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
  /*
   * ⚠️ 这里一度加过 --ccr-rail-color / --ccr-drag-color 两个「中间调」令牌，
   * 目的是让线在明亮壁纸上可见。**已全部删除** ——
   *
   * 用户明确裁定：「我们只是解决**怎么显现**，并不是颜色问题！」
   * 线的外观（颜色、线宽、透明度）保持初版原样；
   * 「看不见」一律走**显现**那条路解决 = 挂到 body 末子节点上的共用宿主
   * （见 src/ui/overlay-host.ts）—— 那才是真正的病因所在（堆叠上下文）。
   *
   * ⚠️ 本文件整体是一个模板字符串 —— 注释里不要写反引号（会截断字符串）。
   */
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

/* ═══ SessionRailOverlay：会话行上的竖线（风格对齐拖拽的水流线） ═══
 *
 * 只有流动动画和 keyframes 是活的 —— 下面的 .ccr-rail / .ccr-rail__overflow /
 * .ccr-lane* 属于已删除的 SessionRail/RailLane 组件（那套用绝对定位的
 * div 画线，早已被 SVG 的 SessionRailOverlay 取代），留着只会误导人。 */
.ccr-rail__flow {
  animation: ccr-rail-flow 2600ms linear infinite;
}

@keyframes ccr-rail-flow {
  to { stroke-dashoffset: -36; }
}

/* ═══ 拖拽落点提示（命中左侧会话行） ═══ */
.ccr-target {
  background: var(--ccr-panel-highlight) !important;
  box-shadow: inset 2px 0 0 var(--ccr-flow-color) !important;
}

/* 已连的目标：松手会断开，用红调区分于「会连接」 */
.ccr-target--disconnect {
  background: rgba(239, 68, 68, 0.13) !important;
  box-shadow: inset 2px 0 0 #EF4444 !important;
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
  /*
   * 面板自己做滚动容器。
   *
   * 为什么必须：内容会超过一屏（连接多了、每条展开还有卡片+感知区），
   * 而宿主的 main 区**不保证是滚动容器** —— 之前没有高度约束也没 overflow，
   * 于是超出部分直接被裁掉，滚轮完全没反应。
   *
   * height/max-height 都写：父级若是定高 flex/grid 项，height:100% 生效；
   * 若是自动高度，两者都退化成 auto，行为与修复前一致（不会更糟）。
   */
  height: 100%;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
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

/* 新建连接中间的可点连接符。
   默认外观与普通 ↔ 分隔符一致（无框、无底色）；
   悬浮时出现边框与底色，并浮出一个 + / − 提示可以增删一个会话槽位。 */
.ccr-form__join {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: none;
  padding: 2px 5px;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  color: inherit;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.ccr-form__join-arrow { opacity: 0.5; }

.ccr-form__join-mark {
  font-size: 11px;
  opacity: 0;
  transform: translateX(-2px);
  transition: opacity 120ms ease, transform 120ms ease;
}

.ccr-form__join:hover {
  background: var(--ccr-panel-highlight);
  border-color: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
}

.ccr-form__join:hover .ccr-form__join-arrow { opacity: 0.9; }

.ccr-form__join:hover .ccr-form__join-mark {
  opacity: 1;
  transform: translateX(0);
}

/* 小号分段控件（轨道线路开关） */
.ccr-seg--small .ccr-seg__item {
  padding: 2px 8px;
  font-size: 11px;
}

.ccr-rail-toggle { margin-left: auto; }

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

/*
 * 适配卡（普通 DSH 插件挂成连接能力）—— 用户裁决 D6：
 * **照常列出 + 「适配」标注**；未就绪时置灰（沿用上面的 :disabled 样式）并保留悬停说明。
 * 置灰而不是隐藏：让用户知道"东西在这儿、需要开一下"，而不是以为没装上。
 */
.ccr-card-option--blocked { border-style: dashed; }
.ccr-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 500;
  line-height: 15px;
  vertical-align: 1px;
  border-radius: 4px;
  /* 与主题一致：用边框层级色，不写死具体颜色 */
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.35));
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.75));
}
.ccr-badge--adapter { letter-spacing: 0.5px; }
.ccr-card-option__name { font-size: 12px; font-weight: 500; }
/* 卡片更新入口（已安装卡片才有）：点一次检查，有新版再点一次更新 */
.ccr-card-option__upd {
  flex: none;
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  opacity: 0.7;
  background: rgba(128, 128, 128, 0.16);
  cursor: pointer;
  white-space: nowrap;
}
.ccr-card-option__upd:hover { opacity: 1; background: rgba(128, 128, 128, 0.28); }

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

/* 「卡片」+ 右侧小三角：点文字或三角都收起/展开整个卡片区 */
.ccr-cards__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ccr-cards__toggle:hover .ccr-field__label { opacity: 1; }
.ccr-cards__tri {
  font-size: 9px;
  line-height: 1;
  opacity: 0.65;
}
.ccr-cards__toggle:hover .ccr-cards__tri { opacity: 1; }

/* 收起时只剩标题那一行 —— 去掉多余的上下留白 */
.ccr-cards--folded { margin-bottom: 12px; }

/*
 * 卡片区标题行：卡片 ▸ 3 ………………………… + 添加卡片
 *
 * ⚠️ display:flex 是**必需**的 —— 「+ 添加卡片」靠 margin-left:auto 顶到右边，
 * 而 auto 外边距只在 flex/grid 容器里生效。少了它，按钮会挤在计数后面
 * （用户截图里就是这样）。
 */
/*
 * 可关闭的说明块（DismissibleHint）—— 右上角一个 ×，关掉后不再显示。
 * 外层 relative，× 绝对定位到右上角；正文留出右上角空间，别顶到 × 底下。
 */
.ccr-dismissible { position: relative; }
.ccr-dismissible__close {
  position: absolute;
  top: -2px;
  right: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  opacity: 0.4;
  cursor: pointer;
}
.ccr-dismissible__close:hover { opacity: 0.9; background: rgba(128, 128, 128, 0.18); }
.ccr-dismissible .ccr-field__hint { padding-right: 22px; }
.ccr-cards__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ccr-cards__add { margin-left: auto; }

/* 卡片面板的收起/展开箭头（默认收起，见 CardStack 的 expandedCards） */
.ccr-card__toggle {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 10px;
  line-height: 1;
  opacity: 0.6;
  cursor: pointer;
}
.ccr-card__toggle:hover:not(:disabled) { opacity: 1; }
.ccr-card__toggle:disabled { opacity: 0.2; cursor: default; }

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

/* ═══ 权限（两个方向可分别设置） ═══ */
.ccr-perm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  min-width: 0;
}

.ccr-perm-row__who {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  flex: 1 1 auto;
}

.ccr-perm-row__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 42%;
  font-size: 12px;
}

.ccr-perm-row__verb {
  flex: none;
  font-size: 13px;
  line-height: 1;
  opacity: 0.45;
}

.ccr-perm-row__target {
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 42%;
  font-size: 12px;
  opacity: 0.85;
}

.ccr-perm-row .ccr-seg { flex: none; }

/* ═══ 转发中警告（权限高于只读时常驻） ═══
   理由：用户抬权限时以为"这是让对方能干活"，实际是"两边说的话开始互相灌"。
   2026-09-30 因此连着两次被意外打扰，所以这个状态必须显眼。 */
.ccr-forward-warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 10px 0;
  padding: 9px 11px;
  font-size: 12px;
  line-height: 1.55;
  border-radius: 7px;
  background: rgba(249, 115, 22, 0.13);
  border: 1px solid rgba(249, 115, 22, 0.35);
}

.ccr-forward-warn__dot {
  flex: none;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: #F97316;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
}

/* ═══ 卡片安装（装到我们自己的目录） ═══ */
.ccr-install {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
}

.ccr-install__row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ccr-install__row .ccr-input { flex: 1 1 auto; min-width: 0; }

/* 目录路径可能很长，允许折行且用等宽字体，避免看成一串糊字 */
.ccr-install code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  word-break: break-all;
}

/* ═══ 卡片可见范围（两端 / 仅 A / 仅 B） ═══ */
.ccr-scope-pick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 2px 8px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2));
}

.ccr-scope-pick__label {
  flex: none;
  font-size: 11px;
  opacity: 0.65;
}

/* 卡片头里的范围切换：靠右挤在重载/移除前，不与名字抢宽度 */
.ccr-card__scope { flex: none; }

.ccr-card__scope-fixed {
  flex: none;
  padding: 1px 6px;
  font-size: 10px;
  line-height: 15px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.2);
  opacity: 0.8;
}

/* ═══ 可折叠区块（协作感知的两块） ═══ */
.ccr-fold {
  margin-top: 10px;
  border-radius: 7px;
  background: var(--ccr-panel-highlight);
  overflow: hidden;
}

.ccr-fold__head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 10px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.ccr-fold__head:hover { background: rgba(128, 128, 128, 0.08); }

.ccr-fold__chevron {
  flex: none;
  width: 10px;
  font-size: 10px;
  opacity: 0.6;
}

.ccr-fold__title {
  flex: none;
  font-weight: 600;
}

/* 「对方正在活动」的小圆点 —— 收起状态下也能一眼看出对方在忙 */
.ccr-fold__live {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22C55E;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
}

/* 收起时的摘要：占满剩余宽度、超出省略，不换行（保证标题行永远只占一行） */
.ccr-fold__digest {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  opacity: 0.6;
}

.ccr-fold__body {
  padding: 2px 10px 10px;
}

/* ═══ 协作感知 A：工作状态 ═══ */
.ccr-field__auto,
.ccr-field__count {
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10px;
  line-height: 15px;
  border-radius: 4px;
  opacity: 0.7;
  background: var(--ccr-panel-highlight);
}

.ccr-work {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.ccr-work__row {
  padding: 7px 9px;
  border-radius: 7px;
  background: var(--ccr-panel-highlight);
}

.ccr-work__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 3px;
}

.ccr-work__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 600;
}

.ccr-work__age {
  flex: none;
  font-size: 10px;
  opacity: 0.6;
}

/* 太久没更新：状态可能已经不代表现状了，弱化它 */
.ccr-work__age--stale { opacity: 0.4; }

.ccr-work__action {
  font-size: 12px;
  opacity: 0.9;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ccr-work__action--empty { opacity: 0.45; font-style: italic; }

.ccr-work__todos {
  margin: 5px 0 0;
  padding: 0;
  list-style: none;
}

.ccr-work__todo {
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.8;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ccr-work__todo--completed { opacity: 0.4; text-decoration: line-through; }
.ccr-work__todo--in_progress { opacity: 1; font-weight: 600; }

.ccr-work__files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.ccr-work__file {
  padding: 1px 5px;
  font-size: 10px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.18);
  opacity: 0.85;
}

.ccr-work__progress {
  margin-top: 4px;
  font-size: 10px;
  opacity: 0.55;
}

/* 中继诊断：被挡下的非真人来源（平时不显示，有东西被挡才出现） */
.ccr-work__diag {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  font-size: 10px;
  opacity: 0.55;
}

.ccr-work__diag-head { word-break: break-word; }

.ccr-work__diag-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 3px;
}

.ccr-work__diag-kind {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.22);
}

/* 内容预览：这是"误挡会当场现形"的关键，所以给它主位、允许省略号 */
.ccr-work__diag-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ccr-work__diag-age { flex: none; opacity: 0.7; }

/* ═══ 协作感知 B：公约盒 ═══ */
.ccr-box {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ccr-box__item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--ccr-panel-highlight);
  font-size: 12px;
}

.ccr-box__topic {
  flex: none;
  padding: 0 5px;
  font-size: 10px;
  line-height: 15px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.22);
  opacity: 0.9;
}

.ccr-box__text {
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-word;
}

.ccr-box__who {
  flex: none;
  max-width: 26%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 10px;
  opacity: 0.55;
}

.ccr-box__del {
  flex: none;
  padding: 0 4px;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
  opacity: 0.35;
}

.ccr-box__del:hover { opacity: 1; }

.ccr-box__empty {
  margin-top: 4px;
  padding: 8px;
  font-size: 11px;
  opacity: 0.55;
  border-radius: 6px;
  background: var(--ccr-panel-highlight);
}

.ccr-box__add {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.ccr-input--topic { flex: none; width: 72px; }

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
