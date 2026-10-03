/**
 * overlay-host — 插件自绘覆盖层的共用宿主。
 *
 * ## 为什么需要它
 *
 * **`z-index` 只在同一个堆叠上下文（stacking context）里可比。**
 * 插件的槽位（`shell.overlay`、`conversation.input.left` 等）各自渲染在
 * DSH 不同的容器里 —— 容器不同就是堆叠上下文不同，于是：
 *
 *   · 别人（皮肤/叠加层）只要把**自己那个容器**排在我们容器之上，
 *     我们无论把**元素自身**的 z-index 抬到多高都赢不了：比的是"容器 vs 容器"；
 *   · 而皮肤若用了 `transform` / `filter` / `will-change`，还会造出新的堆叠上下文，
 *     任何 z-index 都可能失效。
 *
 * 实测现场：装 `web-ui-skin-center` 时"看不见线"，关掉就正常 ——
 * 轨道线与拖拽线**各自都栽过一次**，症状一模一样。
 *
 * ## 做法
 *
 * 建一个宿主 `div`，**追加为 `document.body` 的最后一个子节点**：
 *
 *   · 挂在 `body` 上 → 堆叠直接相对 body，**与"哪个槽位容器在上面"彻底解耦**；
 *   · **排在最后** → 同层级下后者胜。若应用根节点自身建立了堆叠上下文或带 z-index，
 *     **先挂上去的 body 子节点仍会被它盖住** —— 所以"排在它后面"与"高 z-index"一样重要；
 *   · 接近上限的 z-index（留出调试余量）。
 *
 * 宿主与其中的内容都应由调用方设 `pointer-events: none`，以免挡住交互。
 *
 * ## 层次约定
 *
 * 共用**一个**宿主（避免多个宿主之间又要比层级），层内用 z-index 排：
 *
 *   · 轨道线   `z-index: 9998`（在会话列表区域）
 *   · 拖拽线   `z-index: 9999`（全程跟随指针，应在最上）
 *
 * ⚠️ 这与"弹窗必须最上层"是同一类问题：宿主在 body 层级，
 * 将来若有全屏模态，这两条线会画在它上面。当前靠 `pointer-events: none`
 * 保证不挡交互。要收的话，判据见 README 的「已知未做」。
 */
/**
 * 取（必要时创建）共用宿主。
 *
 * 宿主**在文档生命周期内常驻**，不随单个组件卸载而移除 ——
 * 因为两条线可能交替挂载/卸载，反复增删宿主会让"最后一个子节点"这个
 * 关键性质变得不稳定。它没有事件监听、没有状态，留着无成本。
 */
export declare function getOverlayHost(): HTMLDivElement | null;
export declare function flashHint(text: string, ms?: number): void;
/** 供诊断用：宿主当前的层级信息（z-index / 是否在 DOM / 在 body 子节点里的索引）。 */ export declare function describeOverlayHost(): string;
