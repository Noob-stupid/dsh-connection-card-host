/**
 * useLaneLayout — 根据连接和会话顺序计算 lane 布局。
 */
import { useMemo } from 'react';
import { allocateLanes } from '../../core/lane-allocator.js';
export function useLaneLayout(connections, sessionOrder) {
    return useMemo(() => allocateLanes(connections, sessionOrder), [connections, sessionOrder]);
}
//# sourceMappingURL=useLaneLayout.js.map