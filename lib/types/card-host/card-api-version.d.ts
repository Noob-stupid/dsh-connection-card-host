/**
 * CardAPI 版本 —— **我们自己的兼容性护栏**。
 *
 * ## 为什么需要它（用户提出的问题）
 *
 * > 我们不是那种可挂载官方版本更新后只需要更新适配我们的插件吗，
 * > 别的插件卡片不影响？
 *
 * **一半对**：
 *
 * | | DSH 插件 | 我们的卡片 |
 * |:---|:---|:---|
 * | 依赖 | `@deepseek-ai/dsh-*` 内部包 | **不依赖任何 DSH 包**（卡片协议禁止） |
 * | DSH 升级时 | 可能全坏（所以有版本门控） | **不受影响** |
 * | 谁要适配 | 每个插件作者各自适配 | **只有我们插件适配一次** |
 *
 * **但另一半是我们要自己守的**：卡片依赖的是 **`CardAPI`**（我们定的接口）。
 * DSH 升级不影响卡片，**可我们一改 `CardAPI`，卡片就会坏** ——
 * 而 DSH 的版本门控管不到这一层（它只看 `@deepseek-ai/*` 的 peerDeps）。
 *
 * 所以卡片要**声明它需要的 CardAPI 版本**，我们在改动时才能判断兼容性。
 *
 * ## 规则
 *
 * - **加**东西（新方法/新字段）→ 不升版本，老卡片照常跑
 * - **删或改语义**（改签名、改默认行为、改事件方向）→ **升版本**
 * - 卡片不声明 → 当作 `1`（约定出现前的卡片都是 v1）
 * - 卡片声明高于当前 → **拒绝装载并说清原因**（不是静默降级 ——
 *   静默降级会让卡片在运行到某个分支时才炸，比一开始就拒绝难查得多）
 */
/** 当前 CardAPI 版本。 */
export declare const CARD_API_VERSION = 1;
/**
 * 各版本的变化（升版本时在这里记一笔，卡片作者据此判断要不要改）。
 *
 * 只记**破坏性**变化；新增能力不升版本，所以不记在这儿。
 */
export declare const CARD_API_CHANGELOG: Record<number, string>;
/** 卡片在 `dshCard.api` 里声明的版本；没声明按 1 算。 */
export declare function declaredApiVersion(manifest: {
    api?: unknown;
} | undefined): number;
/**
 * 检查卡片声明的 CardAPI 版本能不能在当前宿主上跑。
 *
 * @returns `ok:false` 时 `reason` 是**给人看的**（面板会原样显示）
 */
export declare function checkApiVersion(manifest: {
    api?: unknown;
} | undefined, cardName: string): {
    ok: boolean;
    declared: number;
    reason?: string;
};
