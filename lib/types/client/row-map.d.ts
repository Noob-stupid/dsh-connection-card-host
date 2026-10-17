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
 * 而会话行里的长标题会被 UI **截断成省略号** ✓（现场例子：
 * `@C:\Users\花火\Downloads\DSH 嵌入式…` ✓）—— 此时
 *
 *     行文本 = "@c:\users\花火\downloads\dsh 嵌入式"   （**比标题短** ✗）
 *     标题   = "@c:\users\花火\downloads\dsh 嵌入式 runtime"
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
