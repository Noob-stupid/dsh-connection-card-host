/**
 * ViewPrefs — 浏览器半的视图偏好（面板与轨道共享）。
 *
 * 为什么需要：`ConnectionPanel`（main 槽位）和 `SessionRailOverlay`
 * （shell.overlay 槽位）是两个互不相识的槽位组件，但它们要共享
 * 「左侧连线是否显示」这类设置。用一个模块级的小 store + 订阅解决，
 * 并持久化到 localStorage（刷新后保留）。
 */
export interface ViewPrefs {
    /** 是否在会话列表上显示连接线路。关掉只影响观感，不影响连接本身。 */
    railVisible: boolean;
    /**
     * 协作感知两块的展开状态。
     *
     * 默认**收起**：两块都摊开会让连接面板显得很杂（用户原话
     * 「看着面板太杂了，根本不想仔细看」）。收起时标题行仍显示一行摘要，
     * 所以不展开也能看到要点。
     */
    workOpen: boolean;
    boxOpen: boolean;
}
export interface ViewPrefsStore {
    get(): ViewPrefs;
    set(patch: Partial<ViewPrefs>): void;
    subscribe(listener: () => void): () => void;
}
/** 建一个视图偏好 store（浏览器半共用同一个实例）。 */
export declare function createViewPrefs(): ViewPrefsStore;
