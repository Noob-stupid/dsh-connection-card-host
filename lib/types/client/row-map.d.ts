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
 *
 * ## ⚠️ 本模块**不依赖 React**（这是刻意的 ✓）
 *
 * 它是**纯逻辑** ✓，跑在 Node 测试里 ✓。行标记属性名原先定义在
 * `ui/SessionRowMarker.tsx` ✗ ⇒ 任何加载本模块的地方都会被**连带拉起 react** ✗ ⇒
 * 裸 runner（CI）上测试连加载都失败 ✓：
 *
 *     Cannot find package 'react' imported from .../lib/ui/SessionRowMarker.js
 *
 * ⇒ 属性名**下沉到这里** ✓，由组件那边反过来引 ✓。
 * 判据：**常量住在"最先需要它、依赖最少"的那一层** ✓。
 */
/** 行元素上承载会话 id 的属性名（`SessionRowMarker` 与映射器共用 ✓）。 */
export declare const ROW_ID_ATTR = "data-ccr-session";
export interface SessionRowInfo {
    element: Element;
    id: string;
    top: number;
    bottom: number;
    left: number;
    right: number;
}
export interface SessionSnapshotLike {
    ids: readonly string[];
    byId: Record<string, {
        title?: string;
    }>;
    /**
     * **当前会话** id（可选 ✓）。
     *
     * 用途：给"当前会话那一行"做**结构锚点** ✓ —— 见 `pickCurrentRowAnchor` ✓。
     * 声明为可选 ✓：老调用方/旧版本快照可能没有它 ✓，那时锚点自动不启用 ✓（不报错 ✓）。
     */
    current?: string;
}
/**
 * **行文本 ↔ 会话标题**是否算同一个会话（标题匹配的唯一判据，导出供测试）。
 *
 * ## ⚠️ 为什么必须**双向**前缀（真机 bug 的根因）
 *
 * 旧判据是单向的：
 *
 *     text === title || text.startsWith(title)     // 要求"行文本包含**完整**标题" ✗
 *
 * 而会话行里的长标题会被 UI **截断成省略号** ✓（这类标题常见于以路径命名的会话：
 * `@~/Downloads/DSH 嵌入式…` ✓）—— 此时
 *
 *     行文本 = "@~/downloads/dsh 嵌入式"   （**比标题短** ✗）
 *     标题   = "@~/downloads/dsh 嵌入式 runtime"
 *
 * ⇒ `text.startsWith(title)` **永远为假** ✗ ⇒ 这个会话**永远认不出来** ✗
 * ⇒ 它的行拿不到 id ⇒ 连线配不上对 ⇒ **线画不出来** ✓（用户看到的就是这个 ✓）。
 *
 * 旁证：同一现场里**短标题**的会话（`准备协作` ✓）能匹配上 ✓，
 * 所以诊断里 `missing` **恰好只有一个** ✓ —— 正是"长标题被截断"的形状 ✓。
 *
 * ## 为什么仍然安全（不放松"不猜"这条纪律）
 *
 * · 仍是**前缀关系**（不是子串 ✓）—— 避免"标题是别人行文本中间一段"的误配 ✓
 * · 行文本至少 **4** 个字符才允许"行更短"的方向 ✓（1–2 个字符的前缀能撞上一堆标题 ✗）
 * · 调用方仍要求**唯一命中** ✓（bucket 长度必须为 1 ✓）
 * · 末尾的省略号先剥掉 ✓（`…` / `...` 两种写法 ✓）
 */
export declare function titleMatchesRowText(rowText: string, title: string): boolean;
/**
 * 标题候选里的**一条**：`[标题, 该标题对应的唯一 id]`。
 *
 * ⚠️ 每条的 id 必须**唯一** ✓（同名会话不进候选 ✓ —— 承认分不清比猜一个强 ✓）。
 */
export type TitleEntry = readonly [title: string, id: string];
/**
 * 从一行的文本里挑出**它所属的会话 id** —— 行级判据（导出供测试）。
 *
 * ## ⚠️ 为什么必须有"行级"这一层（负控抓出来的）
 *
 * 光有 `titleMatchesRowText` 不够 ✗：**一行可能同时匹配多个标题** ✓，例如
 *
 *     行文本 = "准备协作"     （4 个字符）
 *     标题   = "准备协作"     ← 精确匹配 ✓
 *              "准备协作二号" ← 前缀匹配也成立 ✓（行文本是它的前缀 ✓）
 *
 * 若按"第一个匹配上的就用"✗，就可能**连到错误的会话上** ✗ ——
 * 那比连不上更糟 ✓（用户未必立刻发现 ✓）。
 *
 * ## 规则（顺序即优先级）
 *
 *   1. **精确匹配**（行文本 == 标题 ✓）⇒ 直接采用 ✓（无歧义 ✓）
 *   2. 否则收集**所有**前缀匹配 ⇒ **恰好一个**才采用 ✓
 *   3. 零个或多个 ⇒ 返回 undefined ✓（**不猜** ✓）
 */
export declare function pickRowTitleId(rowText: string, entries: readonly TitleEntry[]): string | undefined;
/**
 * **"当前会话那一行" 作为锚点** —— 用结构而不是文本（导出供测试）。
 *
 * ## 为什么需要它（比标题匹配可靠得多）
 *
 * 标题匹配天生脆 ✗：会截断 ✓、会重名 ✓、会改名 ✓。而"**当前会话**"是**结构事实** ✓：
 * DSH 会在当前会话那一行标 `aria-selected` / `aria-current` ✓（标准无障碍语义 ✓），
 * 而 `snapshot.current` 直接给出当前会话 id ✓ —— 这是**同一个事实的两个来源** ✓。
 *
 * 它恰好覆盖**旧实现翻车的那类行** ✓：当前会话行是**活跃**的 ✓ ⇒
 * 官方用自己的状态点**顶掉我们的标记槽位** ✗ ⇒ 这一行**没有标记** ✓、
 * 标题又可能被截断 ✓ ⇒ 两条老路都断 ✗ —— 而 `snapshot.current` 知道它是谁 ✓。
 *
 * ## 为什么安全（三条自校验，任一不满足就**不采用**）
 *
 *   1. 必须有 `currentId` ✓
 *   2. 那一行**还没有** id ✓（已知事实优先，不覆盖 ✓）
 *   3. **没有任何别的行**已被认成 `currentId` ✓（否则"活跃行 = 当前会话"这个假设
 *      在本次渲染里已被**证伪** ✗ ⇒ 不采用 ✓）
 *
 * ⇒ 这是"**用结构补充文本**"，不是"用猜测覆盖事实" ✓。
 */
export declare function pickCurrentRowAnchor(rowIds: readonly (string | undefined)[], activeIndex: number | undefined, currentId: string | undefined): {
    index: number;
    id: string;
} | undefined;
/**
 * 收集当前 DOM 里能确定 id 的会话行（按视觉顺序）。
 * @param snapshot - 会话快照（提供 id 顺序与标题，用于兜底匹配）
 */
export declare function collectSessionRows(snapshot: SessionSnapshotLike | null): SessionRowInfo[];
/**
 * 命中坐标下的会话行信息；没有可靠映射时返回 null。
 *
 * ## ⚠️ 这里曾经只认"全量映射"，导致落点判定整条链失效（2026-10-02 修）
 *
 * 旧实现是：
 *
 *     const row = el?.closest('[role="treeitem"]')
 *     return collectSessionRows(snapshot).find((info) => info.element === row) ?? null
 *
 * 也就是**先找到行，再问"这一行在不在全量映射表里"**。
 * 而 `collectSessionRows` 的映射不可能覆盖每一行 —— 它靠
 * ① `data-ccr-session` 标记（官方槽位**只在行 idle 时挂载**，跑着的行没有）
 * ② 锚点间插值（**只在唯一解时采用**）
 * ③ 兜底 `ids.length === rows.length`（侧栏只显示子集时**必然不成立**）
 *
 * 实测现场：`ids=110 rows=23 marked=17` —— 有 6 行映射不上（文件夹行、
 * 以及自插件加载起从未 idle 过的会话行）。用户拖到这些行上就得到
 * `no-row-under-cursor`，体感是"拖不出线"。
 *
 * **关键认识：命中一行跟映射全表是两件事。** 只要指针下确实有一行，
 * 就该尽力算出它的会话 id，而不是因为"它在全表里没有"就当作没命中。
 *
 * ## 现在的三层
 *
 *   1. 全量映射命中 → 直接返回（最可信）
 *   2. **邻居夹逼**：取该行上下最近的**已映射**行，在快照 id 序列里取它们之间
 *      唯一未被占用的 id（与 collectSessionRows 的 fillGap 同一思路，但只针对这一行）
 *   3. 都不行 → 返回 null，并**带上原因**（供诊断区分"没命中行"与"命中但认不出"）
 */
export interface RowHit {
    info: SessionRowInfo | null;
    /** 指针下确实有一行（`role="treeitem"`）。 */
    hitRow: boolean;
    /** 命中的 DOM 元素描述（诊断用，如 `div.ccr-page` / `div[role=treeitem]`）。 */
    elementDesc: string;
    /** 为什么没解析出会话 id（`info` 非空时为 undefined）。 */
    missReason?: string;
    /**
     * 这个 id 是**靠邻居夹逼推出来**的（不是全量映射直接命中的）。
     *
     * ⚠️ 为什么要标出来：夹逼是"算"出来的，不是"读"出来的 ——
     * **算错的后果是连到错误的会话上，比连不上更糟**（用户可能不会立刻发现）。
     * 标出来之后，诊断日志里能看出哪些连接是推出来的，出了问题可回溯。
     */
    inferred?: boolean;
}
/**
 * 命中坐标下的会话行（含诊断信息）。
 *
 * 与 `sessionRowAtPoint` 的区别：**即使这一行不在全量映射表里也会尽力解析**，
 * 并把失败原因带出来。拖拽落点用这个版本。
 *
 * ## 两层鲁棒性
 *
 * **① 穿透式取元素**（2026-10-02 加，有实证支撑）：
 * 用 `elementsFromPoint`（复数）从栈顶往下找**第一个会话行**，而不是只看栈顶那一个。
 *
 * 为什么必须这样：用户实际遇到过「拖不出线」，最后定位到是**皮肤插件
 * （`web-ui-skin-center`）关掉就恢复正常** —— 皮肤的全屏叠加层挡住了指针，
 * 单数版 `elementFromPoint` 只会返回那层叠加层，`closest('[role="treeitem"]')`
 * 自然为空 → 一律 `no-row-under-cursor`。
 *
 * 语义上也更对：用户**看得见**那一行才往那儿拖，叠加层是透明的装饰，
 * 不该改变"我指的是哪一行"。
 *
 * **② 不要求全量映射**：见 `resolveRowId` 的说明。
 */
export declare function sessionRowHitAtPoint(x: number, y: number, snapshot: SessionSnapshotLike | null): RowHit;
/**
 * 命中坐标下的会话行信息；没有可靠映射时返回 null。
 *
 * 保留这个签名是为了兼容既有调用方 —— 内部已改为走 `sessionRowHitAtPoint`
 * （也就是**不再要求这一行在全量映射表里**）。
 */
export declare function sessionRowAtPoint(x: number, y: number, snapshot: SessionSnapshotLike | null): SessionRowInfo | null;
