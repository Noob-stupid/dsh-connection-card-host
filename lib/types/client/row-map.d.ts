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
