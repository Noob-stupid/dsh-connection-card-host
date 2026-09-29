/**
 * row-map — DOM 会话行 → 会话 id 的映射。
 *
 * 两个来源合并：
 *   1. `[data-ccr-session]` —— 由 SessionRowMarker 写在行上（最可靠，但只有
 *      idle 行会挂载该槽位）；
 *   2. **序号对齐** —— 用任意一个标记行作为锚点，若 DOM 顺序与宿主会话列表
 *      顺序完全一致（offset === 0），就能给没有标记的行也补上 id。
 *
 * 安全策略：对齐条件不满足时**只保留有标记的行**。宁可少画几条，
 * 也绝不画出连错会话的线。
 */
import { ROW_ID_ATTR } from '../ui/SessionRowMarker.js';
/** 收集当前 DOM 里能确定 id 的会话行（按视觉顺序）。 */
export function collectSessionRows(sessionIds) {
    if (typeof document === 'undefined')
        return [];
    const rows = Array.from(document.querySelectorAll('[role="treeitem"]'));
    if (rows.length === 0)
        return [];
    const idByRow = new Map();
    const anchorIndexById = new Map();
    rows.forEach((row, index) => {
        const id = row.getAttribute(ROW_ID_ATTR);
        if (id) {
            idByRow.set(row, id);
            anchorIndexById.set(index, id);
        }
    });
    // 序号对齐：只要有一个锚点满足 offset === 0，就认为两边的顺序一致
    if (sessionIds.length === rows.length) {
        for (const [index, id] of anchorIndexById) {
            if (sessionIds.indexOf(id) - index === 0) {
                rows.forEach((row, i) => {
                    const candidate = sessionIds[i];
                    if (candidate && !idByRow.has(row))
                        idByRow.set(row, candidate);
                });
                break;
            }
        }
    }
    const result = [];
    for (const row of rows) {
        const id = idByRow.get(row);
        if (!id)
            continue;
        const rect = row.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0)
            continue;
        result.push({ element: row, id, top: rect.top, bottom: rect.bottom, left: rect.left });
    }
    result.sort((a, b) => a.top - b.top);
    return result;
}
/** 命中坐标下的会话行信息；没有可靠映射时返回 null。 */
export function sessionRowAtPoint(x, y, sessionIds) {
    if (typeof document === 'undefined')
        return null;
    const el = document.elementFromPoint(x, y);
    const row = el?.closest('[role="treeitem"]');
    if (!row)
        return null;
    return collectSessionRows(sessionIds).find((info) => info.element === row) ?? null;
}
//# sourceMappingURL=row-map.js.map