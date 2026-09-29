/**
 * useSessionOptions — 面板里会话选择器的候选项。
 *
 * 来源优先级：
 *   1. 侧栏 DOM 里实际渲染的会话行（`[data-session-id]`）——
 *      用户看到什么就能选什么，标题直接取行文本，最直观；
 *   2. 宿主 `sessions/list`（内存会话存储）作为补充 ——
 *      能把不在当前侧栏可见范围内的会话也补进来。
 *
 * 之所以读 DOM：DSH 未公开「会话列表」的客户端 API 给我等第三方插件，
 * 而 `[data-session-id]` 是会话行的既有属性（拖拽建连接也用同一个选择器）。
 */
import { useEffect, useState } from 'react';
const MEASURE_INTERVAL_MS = 1500;
/** 把会话行的文本压成一行短标签。 */
function labelFromRow(el, id) {
    const raw = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (raw.length === 0)
        return shortId(id);
    return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
}
function shortId(id) {
    return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}
export function useSessionOptions(client) {
    const [options, setOptions] = useState([]);
    useEffect(() => {
        if (typeof document === 'undefined')
            return;
        let alive = true;
        const collect = async () => {
            const byId = new Map();
            // 1) 侧栏可见的会话行
            for (const node of Array.from(document.querySelectorAll('[data-session-id]'))) {
                const id = node.getAttribute('data-session-id');
                if (!id)
                    continue;
                byId.set(id, { id, label: labelFromRow(node, id), source: 'sidebar' });
            }
            // 2) 宿主内存里的会话（补上侧栏没渲染的）
            if (client) {
                try {
                    const hostSessions = await client.listSessions();
                    for (const s of hostSessions) {
                        if (byId.has(s.id))
                            continue;
                        byId.set(s.id, {
                            id: s.id,
                            label: s.title?.trim() || shortId(s.id),
                            source: 'host',
                        });
                    }
                }
                catch {
                    // 宿主列表不可用不影响侧栏来源
                }
            }
            if (!alive)
                return;
            const next = Array.from(byId.values());
            setOptions((prev) => {
                if (prev.length === next.length) {
                    let same = true;
                    for (let i = 0; i < next.length; i++) {
                        if (prev[i].id !== next[i].id || prev[i].label !== next[i].label) {
                            same = false;
                            break;
                        }
                    }
                    if (same)
                        return prev;
                }
                return next;
            });
        };
        void collect();
        const timer = window.setInterval(() => void collect(), MEASURE_INTERVAL_MS);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, [client]);
    return options;
}
//# sourceMappingURL=useSessionOptions.js.map