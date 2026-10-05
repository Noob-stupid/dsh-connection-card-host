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
 *     **先挂上去的 body 子节点仍会被它盖住** —— 所以"排在它后面"与"z-index"一样重要；
 *   · **z-index 取一个小值**（见下）。
 *
 * ## ⚠️ z-index 为什么**不再**取接近上限的值（用户实测反馈）
 *
 * 原先这里是 `2147483000`（近上限）✗，理由是"保证不被任何容器盖住"。
 * 但用户实测发现它的**代价**：
 *
 * > 「这个连接管道……**怎么在很多地方之上都显示呢**？」
 *
 * —— 连线/拖拽线**盖在了 DSH 自己的菜单与弹层之上** ✗。
 * 也就是说，那条理由只算了一半：**"不被盖住"和"不盖别人"是两件事** ✓。
 *
 * ## 正确的层次定位
 *
 * 连线是**内容层的装饰**，不是系统层的东西：
 *
 *     普通内容（会话列表、面板） < **我们的连线** < DSH 的菜单 / 弹层 / 对话框
 *
 * ⇒ 取 **100**：足以压住普通内容 ✓，又**远低于**任何应用级弹层（菜单类通常 ≥1000 ✓）。
 * 连接线的用途是"把会话行和卡片面板连起来"，它**没有理由**出现在菜单上面 ✓。
 *
 * ⚠️ 若将来发现它被某个 DSH 容器盖住了 ✗，**先查那个容器的 z-index**，
 * 再把这里调高到"刚好超过它" ✓ —— 不要一把调回上限 ✗（那会把菜单又盖住 ✓）。
 *
 * ## 层次约定
 *
 * 共用**一个**宿主（避免多个宿主之间又要比层级），层内用 z-index 排：
 *
 *   · 轨道线   `z-index: 9998`（在会话列表区域）
 *   · 拖拽线   `z-index: 9999`（全程跟随指针，应在最上）
 *
 * ⚠️ 这两个值是**宿主内部**的相对次序 ✓ —— 它们**不会**超出宿主自身的层级 ✓
 * （宿主建立了堆叠上下文 ✓），所以调宿主的 `HOST_Z` 就够 ✓。
 *
 * ⚠️ 这与"弹窗必须最上层"是同一类问题：宿主在 body 层级，
 * 将来若有全屏模态，这两条线会画在它上面。当前靠 `pointer-events: none`
 * 保证不挡交互。要收的话，判据见 README 的「已知未做」。
 */
const HOST_CLASS = 'ccr-overlay-host';
/** 宿主自身的层级 —— 接近 32 位上限但留了余量。 */
/**
 * 宿主层级：**压住普通内容，但必须在 DSH 自己的菜单/弹层之下** ✓。
 *
 * ⚠️ 曾经是 `2147483000`（近上限）✗ —— 结果连线盖在了 DSH 菜单之上，
 * 用户实测报"怎么在很多地方之上都显示呢" ✓。
 * 取值理由与调整方法见文件头的「z-index 为什么不再取接近上限的值」✓。
 */
const HOST_Z = 100;
let host = null;
/**
 * 取（必要时创建）共用宿主。
 *
 * 宿主**在文档生命周期内常驻**，不随单个组件卸载而移除 ——
 * 因为两条线可能交替挂载/卸载，反复增删宿主会让"最后一个子节点"这个
 * 关键性质变得不稳定。它没有事件监听、没有状态，留着无成本。
 */
export function getOverlayHost() {
    if (typeof document === 'undefined')
        return null;
    // 宿主被外力移除（或热重载换过文档）时重建
    if (host && host.isConnected)
        return host;
    const el = document.createElement('div');
    el.className = HOST_CLASS;
    el.style.cssText =
        `position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:${HOST_Z};`;
    document.body.appendChild(el);
    host = el;
    return host;
}
/**
 * 显示一条**短暂的操作提示**（2.6 秒后自动消失）。
 *
 * ## 为什么需要它（现场诊断逼出来的）
 *
 * 用户从锚点拖出一条线、松手时**没命中任何会话行**（例如松在连接面板上）——
 * 旧的实现只是 `clearHighlight()`，**屏幕上什么都不发生** ✗。
 * 用户于是问"那个新插件还没搞好吗" ✗ —— 他把"**没有反馈**"读成了"**功能坏了**"。
 *
 * 这就是"沉默的失败"最典型的代价：**功能是对的，但用户不知道它是对的**。
 *
 * ## 文案规范（与对端对齐的同一套）
 *
 * **第一句先答"我该做什么"**，并且要让用户**一眼看出"这不是坏了"** ——
 * 所以统一用「**操作没生效**」开头 + 随后的指令，而不是先解释机制。
 *
 * ## 合并连续相同提示
 *
 * 同一句话在短时间内反复触发（用户连拖几次）⇒ **复用同一条**，不叠加、不闪弹幕。
 * 成本极低，但不做的话连拖三次就能把屏幕刷满。
 */
let lastHint = null;
export function flashHint(text, ms = 2600) {
    const host = getOverlayHost();
    if (!host)
        return;
    const now = Date.now();
    /** 2.5 秒内的**同一句**提示：复用现有那条（刷新计时），不再新建。 */
    if (lastHint && lastHint.text === text && now - lastHint.at < ms) {
        lastHint.at = now;
        return;
    }
    const tip = document.createElement('div');
    tip.className = 'ccr-hint';
    tip.textContent = text;
    tip.style.cssText =
        'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);' +
            'pointer-events:none;padding:8px 14px;border-radius:8px;font-size:12px;' +
            /**
             * ⚠️ 这个 `z-index` 是**宿主内部**的次序 ✓ —— 它**不会**超出宿主自身的层级 ✓
             * （宿主 `z-index: 100` 建立了堆叠上下文 ✓），所以写多少都不会盖住 DSH 的菜单 ✓。
             * 原来是 `2147483647`（32 位上限）✗ —— 虽然效果一样，但**读起来像"要盖住一切"** ✗，
             * 会诱导后人把宿主层级也一起调上去 ✗。改成与轨道/拖拽线同一量级 ✓。
             */
            'background:rgba(20,20,20,.86);color:#fff;z-index:9999;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.28);white-space:nowrap;';
    host.appendChild(tip);
    lastHint = { el: tip, text, at: now };
    window.setTimeout(() => {
        try {
            tip.remove();
        }
        catch {
            /* 已经被移除：正常 */
        }
        if (lastHint?.el === tip)
            lastHint = null;
    }, ms);
}
/** 供诊断用：宿主当前的层级信息（z-index / 是否在 DOM / 在 body 子节点里的索引）。 */ export function describeOverlayHost() {
    if (typeof document === 'undefined')
        return 'host[n/a]';
    const el = getOverlayHost();
    if (!el)
        return 'host[n/a]';
    const cs = window.getComputedStyle(el);
    const idx = Array.prototype.indexOf.call(document.body.children, el);
    return `host[z=${cs.zIndex} conn=${el.isConnected} idx=${idx}/${document.body.children.length - 1}]`;
}
//# sourceMappingURL=overlay-host.js.map