/**
 * ViewPrefs — 浏览器半的视图偏好（面板与轨道共享）。
 *
 * 为什么需要：`ConnectionPanel`（main 槽位）和 `SessionRailOverlay`
 * （shell.overlay 槽位）是两个互不相识的槽位组件，但它们要共享
 * 「左侧连线是否显示」这类设置。用一个模块级的小 store + 订阅解决，
 * 并持久化到 localStorage（刷新后保留）。
 */
const STORAGE_KEY = 'dsh-connection-card-host/view-prefs';
const DEFAULT_PREFS = {
    railVisible: true,
};
function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return { ...DEFAULT_PREFS };
        const parsed = JSON.parse(raw);
        return {
            railVisible: typeof parsed.railVisible === 'boolean' ? parsed.railVisible : DEFAULT_PREFS.railVisible,
        };
    }
    catch {
        return { ...DEFAULT_PREFS };
    }
}
/** 建一个视图偏好 store（浏览器半共用同一个实例）。 */
export function createViewPrefs() {
    let prefs = load();
    const listeners = new Set();
    return {
        get: () => prefs,
        set: (patch) => {
            prefs = { ...prefs, ...patch };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
            }
            catch {
                /* 存不下就算了，内存里仍然生效 */
            }
            for (const listener of [...listeners]) {
                try {
                    listener();
                }
                catch {
                    /* 单个订阅者抛错不影响其他 */
                }
            }
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}
//# sourceMappingURL=view-prefs.js.map