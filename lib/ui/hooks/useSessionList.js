/**
 * useSessionList — 订阅 DSH 的真实会话列表。
 *
 * 数据源是 `ctx.sessions.list`（ObservableSnapshot），不是 DOM。
 * 早期版本读 `[data-session-id]`，但 DSH 的会话行**根本没有这个属性**，
 * 所以选择器一直是空的、拖拽也永远命中不了目标。
 */
import { useCallback, useEffect, useState } from 'react';
import { sessionLabel } from '../../client/sessions-bridge.js';
const EMPTY = { ids: [], byId: {}, current: undefined };
export function useSessionList(bridge) {
    const [snapshot, setSnapshot] = useState(EMPTY);
    useEffect(() => {
        if (!bridge) {
            setSnapshot(EMPTY);
            return;
        }
        let alive = true;
        const sync = () => {
            if (!alive)
                return;
            const next = bridge.getSnapshot();
            setSnapshot((prev) => {
                if (prev.current === next.current &&
                    prev.ids.length === next.ids.length &&
                    prev.ids.every((id, i) => id === next.ids[i])) {
                    return prev;
                }
                return next;
            });
        };
        sync();
        const off = bridge.subscribe(sync);
        // 订阅之外再兜一层轮询：不同 DSH 版本的 ObservableSnapshot 通知时机可能不同
        const timer = window.setInterval(sync, 3000);
        return () => {
            alive = false;
            off();
            window.clearInterval(timer);
        };
    }, [bridge]);
    const labelOf = useCallback((id) => sessionLabel(bridge, id, snapshot), [bridge, snapshot]);
    const options = snapshot.ids.map((id) => ({
        id,
        label: labelOf(id),
        isCurrent: snapshot.current === id,
    }));
    return {
        options,
        snapshot,
        labelOf,
        ready: bridge !== null && snapshot.ids.length > 0,
    };
}
//# sourceMappingURL=useSessionList.js.map