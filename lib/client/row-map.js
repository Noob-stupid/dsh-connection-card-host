/**
 * row-map — DOM 会话行 → 会话 id 的映射。
 *
 * 三个来源，按可靠度递减：
 *   1. `[data-ccr-session]` —— SessionRowMarker 写在行上。
 *      最可靠，但官方文档明说该槽位会被「状态点」顶掉，只有 idle 行会挂载
 *      （实测 18 行里 12 行有标记）。
 *   2. **标题匹配** —— 用行文本比对会话标题；只接受唯一命中，避免重名误判。
 *   3. **序号对齐** —— DOM 顺序与宿主会话列表顺序一致时按序号补；
 *      只在行数与会话数相等时启用（实测 94 vs 18，通常不成立）。
 *
 * 安全策略：三种都拿不到就放弃这一行。宁可少认几行，
 * 也绝不把连接建到错误的会话上。
 */
import { ROW_ID_ATTR } from '../ui/SessionRowMarker.js';
/** 行文本归一化：压空白 + 转小写。 */
function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}
/**
 * 收集当前 DOM 里能确定 id 的会话行（按视觉顺序）。
 * @param snapshot - 会话快照（提供 id 顺序与标题，用于兜底匹配）
 */
export function collectSessionRows(snapshot) {
    if (typeof document === 'undefined')
        return [];
    const rows = Array.from(document.querySelectorAll('[role="treeitem"]'));
    if (rows.length === 0)
        return [];
    const ids = snapshot?.ids ?? [];
    const byId = snapshot?.byId ?? {};
    const idByRow = new Map();
    const anchorIndexById = new Map();
    // 1) 标记属性（最可靠）
    rows.forEach((row, index) => {
        const id = row.getAttribute(ROW_ID_ATTR);
        if (id) {
            idByRow.set(row, id);
            anchorIndexById.set(index, id);
        }
    });
    // 2) 标题匹配：只接受唯一命中的标题，且标题须是行文本的前缀
    //    （行里还有时间等额外文本，用前缀判断更稳）
    const idsByTitle = new Map();
    for (const id of ids) {
        const title = byId[id]?.title;
        if (typeof title !== 'string')
            continue;
        const key = normalizeText(title);
        if (key.length === 0)
            continue;
        const bucket = idsByTitle.get(key);
        if (bucket)
            bucket.push(id);
        else
            idsByTitle.set(key, [id]);
    }
    if (idsByTitle.size > 0) {
        for (const row of rows) {
            if (idByRow.has(row))
                continue;
            const text = normalizeText(row.textContent ?? '');
            if (text.length === 0)
                continue;
            for (const [title, bucket] of idsByTitle) {
                if (bucket.length !== 1)
                    continue;
                if (text === title || text.startsWith(title)) {
                    idByRow.set(row, bucket[0]);
                    break;
                }
            }
        }
    }
    // 3) 序号对齐（仅在行数与会话数相等时可信）
    if (ids.length === rows.length && anchorIndexById.size > 0) {
        for (const [index, id] of anchorIndexById) {
            if (ids.indexOf(id) - index === 0) {
                rows.forEach((row, i) => {
                    const candidate = ids[i];
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
        result.push({
            element: row,
            id,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
        });
    }
    result.sort((a, b) => a.top - b.top);
    return result;
}
/** 命中坐标下的会话行信息；没有可靠映射时返回 null。 */
export function sessionRowAtPoint(x, y, snapshot) {
    if (typeof document === 'undefined')
        return null;
    const el = document.elementFromPoint(x, y);
    const row = el?.closest('[role="treeitem"]');
    if (!row)
        return null;
    return collectSessionRows(snapshot).find((info) => info.element === row) ?? null;
}
//# sourceMappingURL=row-map.js.map