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
    // 3) 锚点之间「排除法补缺」。
    //
    // 为什么需要：会话一开始跑回复就变成「活跃」，官方会用状态点**顶掉**我们的
    // 标记槽位（文档明说 "mounted only by a row whose primary state is idle"），
    // 那一行突然没了 id → 竖线断掉；跑完恢复 idle，线又回来。
    // 用户观察到的「运行回复时连线短暂消失」就是这个。
    //
    // 做法：侧栏渲染的是 ids 的**保序视图**（过滤/分组但相对顺序不变）。
    // 两个已知锚点之间的缺口，其候选 = ids 里落在两锚点之间、且没被别的行认领的条目。
    // 只有候选数**恰好等于**缺口行数时才采用 —— 这是唯一能确定的情况，
    // 其余一律放弃：宁可少画一条线，也不把线连到错误的会话上。
    if (anchorIndexById.size > 0) {
        const idIndexById = new Map();
        ids.forEach((id, i) => { if (!idIndexById.has(id))
            idIndexById.set(id, i); });
        const claimedIdIndexes = new Set();
        for (const id of idByRow.values()) {
            const i = idIndexById.get(id);
            if (i !== undefined)
                claimedIdIndexes.add(i);
        }
        // 锚点按 DOM 序号排序
        const anchors = [...anchorIndexById.entries()]
            .map(([domIndex, id]) => ({ domIndex, idIndex: idIndexById.get(id) ?? -1 }))
            .filter((a) => a.idIndex >= 0)
            .sort((a, b) => a.domIndex - b.domIndex);
        /** 在 (loId, hiId) 区间内给 (loDom, hiDom) 的空档补 id。 */
        const fillGap = (loDom, hiDom, loIdIndex, hiIdIndex) => {
            const gapDoms = [];
            for (let i = loDom + 1; i < hiDom; i++) {
                if (!idByRow.has(rows[i]))
                    gapDoms.push(i);
            }
            if (gapDoms.length === 0)
                return;
            const candidates = [];
            for (let k = loIdIndex + 1; k < hiIdIndex; k++) {
                if (!claimedIdIndexes.has(k))
                    candidates.push(k);
            }
            // 唯一解才采用
            if (candidates.length !== gapDoms.length)
                return;
            gapDoms.forEach((domIndex, n) => {
                const id = ids[candidates[n]];
                if (!id)
                    return;
                idByRow.set(rows[domIndex], id);
                claimedIdIndexes.add(candidates[n]);
            });
        };
        // 相邻锚点之间
        for (let i = 0; i + 1 < anchors.length; i++) {
            fillGap(anchors[i].domIndex, anchors[i + 1].domIndex, anchors[i].idIndex, anchors[i + 1].idIndex);
        }
        // 头部（第一个锚点之前）与尾部（最后一个锚点之后）
        if (anchors.length > 0) {
            fillGap(-1, anchors[0].domIndex, -1, anchors[0].idIndex);
            fillGap(anchors[anchors.length - 1].domIndex, rows.length, anchors[anchors.length - 1].idIndex, ids.length);
        }
    }
    // 4) 兜底：行数与会话数完全相等时按序号直配
    if (ids.length === rows.length) {
        rows.forEach((row, i) => {
            const candidate = ids[i];
            if (candidate && !idByRow.has(row))
                idByRow.set(row, candidate);
        });
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
/** 元素的简短描述，用于诊断日志。 */
function describeElement(el) {
    if (!el)
        return 'null';
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const role = el.getAttribute('role');
    return `${tag}${cls ? `.${cls}` : ''}${role ? `[role=${role}]` : ''}`;
}
/**
 * 对一个**具体的行元素**解析会话 id —— 不要求它在全量映射表里。
 *
 * @param row - `role="treeitem"` 的行元素
 * @param snapshot - 会话快照（提供 id 顺序）
 * @param mapped - 已经全量映射出来的行（用来做邻居夹逼）
 */
function resolveRowId(row, snapshot, mapped) {
    const ids = snapshot?.ids ?? [];
    if (ids.length === 0)
        return { reason: '快照没有会话 id' };
    // 全部 treeitem，按文档顺序 —— 用来算"这一行是第几行"
    const allRows = Array.from(document.querySelectorAll('[role="treeitem"]'));
    const myIndex = allRows.indexOf(row);
    if (myIndex < 0)
        return { reason: '行不在 treeitem 列表里' };
    const indexById = new Map(ids.map((id, i) => [id, i]));
    const claimed = new Set();
    const domIndexById = new Map();
    for (const info of mapped) {
        const di = allRows.indexOf(info.element);
        const ii = indexById.get(info.id);
        if (di >= 0 && ii !== undefined) {
            claimed.add(ii);
            domIndexById.set(di, ii);
        }
    }
    // 邻居夹逼：找上下最近的已映射行
    let loDom = -1;
    let loId = -1;
    let hiDom = allRows.length;
    let hiId = ids.length;
    for (const [di, ii] of domIndexById) {
        if (di < myIndex && di > loDom) {
            loDom = di;
            loId = ii;
        }
        if (di > myIndex && di < hiDom) {
            hiDom = di;
            hiId = ii;
        }
    }
    if (loDom < 0 && hiDom >= allRows.length) {
        return { reason: '上下都没有已映射的行可作锚点' };
    }
    // 我这一行与 lo 锚点之间隔了几行；那些行里未映射的才可能是我
    const gapDoms = [];
    for (let i = loDom + 1; i < myIndex; i++) {
        if (!mapped.some((m) => m.element === allRows[i]))
            gapDoms.push(i);
    }
    const candidates = [];
    for (let k = loId + 1; k < hiId; k++) {
        if (!claimed.has(k))
            candidates.push(k);
    }
    // 唯一解才采用（与 collectSessionRows 的 fillGap 同一条纪律：不猜）
    if (candidates.length === 1 && gapDoms.length === 0) {
        const id = ids[candidates[0]];
        if (id)
            return { id };
    }
    if (candidates.length !== gapDoms.length + 1) {
        return {
            reason: `候选不唯一（缺口 ${gapDoms.length + 1} 行 / 候选 ${candidates.length} 个 id）`,
        };
    }
    const id = ids[candidates[gapDoms.length]];
    if (!id)
        return { reason: '候选 id 为空' };
    return { id };
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
export function sessionRowHitAtPoint(x, y, snapshot) {
    if (typeof document === 'undefined') {
        return { info: null, hitRow: false, elementDesc: 'no-document' };
    }
    /*
     * 从栈顶往下逐层找第一个会话行。
     *
     * `elementsFromPoint` 在个别环境可能不存在（老 WebView）→ 退回单数版，
     * 至少不比原来差。
     */
    const stack = typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint(x, y)].filter(Boolean);
    let row = null;
    let topDesc = 'null';
    for (let i = 0; i < stack.length; i++) {
        const el = stack[i];
        if (i === 0)
            topDesc = describeElement(el);
        const candidate = el.closest?.('[role="treeitem"]');
        if (candidate) {
            row = candidate;
            break;
        }
    }
    if (!row) {
        // 一个会话行都没穿到。诊断里要能看出"栈顶是什么"以及"穿了几层"
        return {
            info: null,
            hitRow: false,
            elementDesc: stack.length > 0 ? `${topDesc} (栈 ${stack.length} 层均非行)` : '空栈',
        };
    }
    const mapped = collectSessionRows(snapshot);
    const direct = mapped.find((info) => info.element === row);
    if (direct)
        return { info: direct, hitRow: true, elementDesc: describeElement(row) };
    const resolved = resolveRowId(row, snapshot, mapped);
    if (!resolved.id) {
        return {
            info: null,
            hitRow: true,
            elementDesc: describeElement(row),
            missReason: resolved.reason ?? '未知',
        };
    }
    const rect = row.getBoundingClientRect();
    return {
        info: {
            element: row,
            id: resolved.id,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
        },
        hitRow: true,
        elementDesc: describeElement(row),
        // 标出来：这个 id 是推出来的，不是直接读到的
        inferred: true,
    };
}
/**
 * 命中坐标下的会话行信息；没有可靠映射时返回 null。
 *
 * 保留这个签名是为了兼容既有调用方 —— 内部已改为走 `sessionRowHitAtPoint`
 * （也就是**不再要求这一行在全量映射表里**）。
 */
export function sessionRowAtPoint(x, y, snapshot) {
    return sessionRowHitAtPoint(x, y, snapshot).info;
}
//# sourceMappingURL=row-map.js.map