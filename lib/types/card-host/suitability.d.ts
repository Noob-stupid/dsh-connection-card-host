/** 卡片适格性（面板据此标注）。 */
export interface CardSuitability {
    /** `capability` 纯能力 / `local` 局部 UI / `global` 全局 UI / `unclear` 判不出。 */
    scope: 'capability' | 'local' | 'global' | 'unclear';
    /** 给人看的一句理由（面板 tooltip 用）。 */
    why: string;
    /** 命中的全局槽位名（诊断用；空数组表示没命中）。 */
    globalHits: string[];
}
/** 判定一张卡片的适格性（**只读**：不动磁盘、不挂载、不联网）。 */
export declare function analyzeSuitability(cardDir: string, hasClient?: boolean): CardSuitability;
/** 面板徽标的文案与语气（**一处定义**，避免 UI 与判定脱节）。 */
export declare function suitabilityBadge(s: CardSuitability): {
    text: string;
    kind: 'ok' | 'warn' | 'muted';
};
/** 诊断用：这张卡目录里有没有构建产物（`src/` 有、`lib/` 无 ⇒ 源码包）。 */
export declare function looksLikeSourceOnly(dir: string): boolean;
/** 读一个小文件的安全包装（判定用，失败就当读不到）。 */
export declare function readIfExists(file: string): string | undefined;
