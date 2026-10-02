import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * SessionRailOverlay — 会话列表上的「垂直连接」。
 *
 * 用户要求：
 *   - 连上后拖拽线消失，改为在会话列表里保留竖线；
 *   - 风格与拖拽的「水流」线近似（白色半透明 + 光晕 + 微流动）；
 *   - **画在会话行上**，不要挤到最左侧的窄边沟里。
 *
 * 实现：挂 `shell.overlay`（root/list/replaceRisk none，纯覆盖不抢槽位），
 * 测量会话行实际坐标后作画 —— DSH 没暴露行坐标接口，只能实测。
 * id 的来源见 client/row-map.ts。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { allocateLanes } from '../core/lane-allocator.js';
import { sessionLabel } from '../client/sessions-bridge.js';
import { collectSessionRows } from '../client/row-map.js';
import { useConnections } from './hooks/useConnections.js';
import { useSessionList } from './hooks/useSessionList.js';
/** 每条 lane 的水平间距（px）。多条连接并行时靠它拉开。 */
const LANE_WIDTH = 9;
/** 竖线相对会话行**右边缘**内缩多少（贴行画，不占左侧窄沟）。 */
const ROW_RIGHT_INSET = 14;
/** 会话行位置的采样间隔。DOM 没有坐标接口，只能定期量。 */
const MEASURE_INTERVAL_MS = 400;
const PERMISSION_COLOR = {
    read: '#9CA3AF',
    suggest: '#3B82F6',
    write: '#F97316',
};
/** 权限色对应的文字 —— 悬停提示里用，光有颜色说不清。 */
const PERMISSION_TEXT = {
    read: '只读（只能感知，不能收发消息）',
    suggest: '可建议（能发言，不能派活）',
    write: '可写入（能发言，也能请求对方做事）',
};
/**
 * 会话列表的可见矩形（= 它最近的可滚动祖先的可视区）。
 *
 * ## 为什么需要它
 *
 * 轨道是 `position: fixed`，线段坐标取自会话行的 `getBoundingClientRect()`。
 * 但**行滚出列表可视区后，它的 rect 依然存在**（只是被祖先的 overflow 裁掉了
 * 显示）。于是线会被画到列表之外 —— 用户滚动时看到连线浮在最上层、
 * 压在导航区和「工作区」标题上。
 *
 * 可滚动祖先的 rect 就是行的**可见边界**。把线段裁进去，线就绝不会越界。
 *
 * 顺带的要求：JS 里读不到"元素当前被裁成什么样"，所以只能自己往上找
 * 滚动祖先。
 *
 * ## 为什么不返回 null（2026-09-30 复核修正）
 *
 * 早先版本"找不到滚动祖先就返回 null，调用方按不裁剪处理" —— 那条路径
 * **正好把 bug 原样放回来**：列表当前不可滚（会话少）、或滚动容器是更外层的
 * 祖先时，线又会画到列表外面。现在：
 *   1. 「能滚」的祖先优先（那才是列表视口）；
 *   2. 退而求其次用「会裁」的祖先（overflow 不是 visible 就构成可见边界）；
 *   3. 都没有就用**窗口视口**；
 *   4. 最后再与窗口视口求交 —— 列表本身也可能被窗口裁掉一截。
 * 即：**永远返回一个矩形**，不存在"不裁剪"的分支。
 */
function sessionListRect() {
    const viewport = {
        top: 0,
        left: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
    };
    // 拿任一行往上走；行本身就是树项
    const row = document.querySelector('[role="treeitem"]');
    if (!row)
        return viewport;
    let scrollable = null;
    let clipping = null;
    let el = row.parentElement;
    while (el && el !== document.body) {
        const cs = window.getComputedStyle(el);
        const oy = cs.overflowY;
        const clips = oy !== 'visible' || cs.overflowX !== 'visible';
        if (clips) {
            const r = el.getBoundingClientRect();
            if (scrollable === null &&
                (oy === 'auto' || oy === 'scroll') &&
                el.scrollHeight > el.clientHeight + 1) {
                scrollable = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
            }
            if (clipping === null) {
                clipping = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
            }
        }
        el = el.parentElement;
    }
    const own = scrollable ?? clipping ?? viewport;
    const merged = {
        top: Math.max(own.top, viewport.top),
        left: Math.max(own.left, viewport.left),
        right: Math.min(own.right, viewport.right),
        bottom: Math.min(own.bottom, viewport.bottom),
    };
    /*
     * ⚠️ 退化护栏（2026-10-02 加）。
     *
     * `own` 可能是**零宽/零高**，或者整个跑到屏幕外 —— 那时 `merged` 会**反向**
     * （right < left 或 bottom < top）。反向的 clip 会把**每一条**线段都判成
     * "裁没了"或"横向出界"，而下游还会因为 `bounds` 退化成 < 1 而返回 null
     * —— 表现就是**连接都在、行也都在、却一条线都不画**，
     * 正好是 2026-10-02 那 1806 条 `conns=3 rows=18 segments=0 missing=[无]`。
     *
     * 拿不准就退回 viewport：宁可画到列表外（有 overflow:hidden 兜着），
     * 也不要整层空白。
     */
    if (merged.right - merged.left < 1 || merged.bottom - merged.top < 1) {
        return viewport;
    }
    return merged;
}
export function SessionRailOverlay({ client, sessions, prefs }) {
    const { connections } = useConnections(client);
    const { snapshot } = useSessionList(sessions);
    const [rows, setRows] = useState([]);
    // 量会话行的位置（滚动/缩放/列表变化都要跟上）
    useEffect(() => {
        if (typeof document === 'undefined')
            return;
        // 最近一次「见过」的行位置。某个会话行因状态变化被顶掉标记、或列表重排
        // 造成瞬时缺失时，短时间内仍沿用旧坐标，避免竖线闪断。
        const lastSeen = new Map();
        const HOLD_MS = 1500;
        const measure = () => {
            const fresh = collectSessionRows(snapshot);
            const now = Date.now();
            for (const info of fresh)
                lastSeen.set(info.id, { info, at: now });
            for (const [id, entry] of lastSeen) {
                if (now - entry.at > HOLD_MS)
                    lastSeen.delete(id);
            }
            // 用「新鲜 + 仍在保鲜期」的并集作图
            const merged = [];
            const seen = new Set();
            for (const info of fresh) {
                merged.push(info);
                seen.add(info.id);
            }
            for (const [id, entry] of lastSeen) {
                if (seen.has(id))
                    continue;
                merged.push(entry.info);
            }
            merged.sort((a, b) => a.top - b.top);
            setRows((prev) => {
                if (prev.length === merged.length) {
                    let same = true;
                    for (let i = 0; i < merged.length; i++) {
                        const a = prev[i];
                        const b = merged[i];
                        if (a.id !== b.id ||
                            Math.abs(a.top - b.top) > 0.5 ||
                            Math.abs(a.bottom - b.bottom) > 0.5 ||
                            Math.abs(a.right - b.right) > 0.5) {
                            same = false;
                            break;
                        }
                    }
                    if (same)
                        return prev;
                }
                return merged;
            });
        };
        measure();
        const timer = window.setInterval(measure, MEASURE_INTERVAL_MS);
        window.addEventListener('scroll', measure, true);
        window.addEventListener('resize', measure);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('scroll', measure, true);
            window.removeEventListener('resize', measure);
        };
    }, [snapshot]);
    const rail = useMemo(() => {
        if (rows.length < 2 || connections.length === 0)
            return null;
        const sessionOrder = rows.map((r) => r.id);
        const layout = allocateLanes(connections, sessionOrder);
        const rowById = new Map(rows.map((r) => [r.id, r]));
        /**
         * 裁剪矩形：会话列表的**滚动容器**可视区。
         *
         * 为什么必须有：轨道是 `position: fixed`，坐标取自行的
         * `getBoundingClientRect()` —— 而**行滚出列表可视区后它的 rect 依然存在**。
         * 于是线会被画到列表外面：用户滚动时看到连线"浮在最上层"，
         * 压在导航区/工作区标题上（2026-09-30 用户报告）。
         *
         * 滚动容器的 rect 就是行的**可见边界**：行滚出去，它的 rect 就在这个矩形外。
         * 把线段裁进它，线就永远不会画到列表之外。
         */
        const clip = sessionListRect();
        // 画在会话行上：贴着行的右边缘往左排 lane
        const baseX = Math.max(...rows.map((r) => r.right)) - ROW_RIGHT_INSET;
        const segments = [];
        /**
         * 被跳过的连接及其**原因**。
         *
         * 为什么要有它：原来诊断只报 `segments=0`，但**五个 `continue` 哪个中的无从得知** ——
         * 2026-10-02 那份 1806 条 `conns=3 rows=18 segments=0 missing=[无]` 的日志
         * 就是这个毛病：证据齐全、但指不出病灶，只能靠猜。
         *
         * 现在把每条被跳过的连接连同**判定时的实际数字**记下来
         * （clip / x / yTop / yBot），下次出现就能直接定位。
         */
        const skips = [];
        const shortId = (s) => s.replace(/^session-/, '').slice(0, 8);
        for (const conn of connections) {
            const assignment = layout.connections.get(conn.id);
            if (!assignment) {
                skips.push(`${shortId(conn.id)}:未分到 lane`);
                continue;
            }
            const a = rowById.get(conn.sessionA);
            const b = rowById.get(conn.sessionB);
            if (!a || !b) {
                skips.push(`${shortId(conn.id)}:行未映射(${a ? '' : shortId(conn.sessionA)}${!a && !b ? '+' : ''}${b ? '' : shortId(conn.sessionB)})`);
                continue;
            }
            const rawY1 = (a.top + a.bottom) / 2;
            const rawY2 = (b.top + b.bottom) / 2;
            const x = baseX - assignment.laneIndex * LANE_WIDTH;
            // 线：裁到列表可视区（保留原始上下方向，只收窄区间）。
            // 竖直直线的「裁」与「端点收到边界」像素等价，所以线这一段是对的。
            let yTop = Math.min(rawY1, rawY2);
            let yBot = Math.max(rawY1, rawY2);
            yTop = Math.max(yTop, clip.top);
            yBot = Math.min(yBot, clip.bottom);
            // 裁没了就整段丢弃 —— 这正是不该画到列表外的那些
            if (yBot - yTop < 1) {
                skips.push(`${shortId(conn.id)}:纵向裁没(y=${Math.round(rawY1)}→${Math.round(rawY2)} ` +
                    `clip=${Math.round(clip.top)}~${Math.round(clip.bottom)})`);
                continue;
            }
            // 水平方向同理：lane 排到可视区外（列表横向滚过）也不画
            if (x < clip.left - 8 || x > clip.right + 8) {
                skips.push(`${shortId(conn.id)}:横向出界(x=${Math.round(x)} ` +
                    `clip=${Math.round(clip.left)}~${Math.round(clip.right)})`);
                continue;
            }
            const upward = rawY1 <= rawY2;
            const y1 = upward ? yTop : yBot;
            const y2 = upward ? yBot : yTop;
            /**
             * 两端圆点各自显示**自己那个方向**的权限。
             *
             * ⚠️ 原来两端都用 `aToB` —— 那是错的：不对称连接下，B 端的点会显示
             * A→B 的权限，等于告诉你一个跟这一端无关的数字。
             * 正确语义：**这个点代表"这一端能对对方做什么"**。
             *
             * 谁是 A 端：`conn.sessionA` 那一行（上行 = y1 那一端）。
             */
            const aOnTop = upward;
            const topLevel = aOnTop ? conn.permission.aToB : conn.permission.bToA;
            const bottomLevel = aOnTop ? conn.permission.bToA : conn.permission.aToB;
            const peerOfTop = aOnTop ? conn.sessionB : conn.sessionA;
            const peerOfBottom = aOnTop ? conn.sessionA : conn.sessionB;
            segments.push({
                id: conn.id,
                laneIndex: assignment.laneIndex,
                x,
                y1,
                y2,
                top: yTop,
                bottom: yBot,
                /**
                 * 端点圆点画在**行的真实中心**，不是被收窄过的区间端点。
                 *
                 * 为什么区分（2026-09-30 复核修正）：线收窄到边界在视觉上等于裁剪，
                 * 但**圆点不行** —— 收窄会把圆点钉在列表边界上，看起来像"线的端点标记"，
                 * 而它本该标记的是那一行。行滚出去时它应当跟着走、并被裁掉。
                 * 真实坐标 + 画布裁剪 = 圆点随行移动、越界自然消失。
                 */
                dotTop: Math.min(rawY1, rawY2),
                dotBottom: Math.max(rawY1, rawY2),
                /** 两个端点各自的颜色与提示（分方向，不再是同一个值）。 */
                topColor: PERMISSION_COLOR[topLevel] ?? '#9CA3AF',
                bottomColor: PERMISSION_COLOR[bottomLevel] ?? '#9CA3AF',
                topTip: `与「${sessionLabel(sessions, peerOfTop, snapshot)}」相连 · ${PERMISSION_TEXT[topLevel] ?? topLevel}`,
                bottomTip: `与「${sessionLabel(sessions, peerOfBottom, snapshot)}」相连 · ${PERMISSION_TEXT[bottomLevel] ?? bottomLevel}`,
                broken: conn.status === 'broken',
            });
        }
        if (segments.length === 0)
            return null;
        /**
         * 画布 = 内容真实外接矩形 ∩ 列表可视区。
         *
         * 与可视区求交之后配合 `overflow: hidden`，**任何**越出列表的形状都被统一
         * 裁掉（滚出去的端点圆点、光晕的模糊外溢、以及以后新加的形状），
         * 不依赖"每个形状各自记得裁剪"。留 8px 内边距给光晕，只在边界处切断。
         */
        const MARGIN = 8;
        const bounds = {
            left: Math.max(Math.min(...segments.map((s) => s.x)) - MARGIN, clip.left),
            right: Math.min(Math.max(...segments.map((s) => s.x)) + MARGIN, clip.right),
            top: Math.max(Math.min(...segments.map((s) => s.dotTop)) - MARGIN, clip.top),
            bottom: Math.min(Math.max(...segments.map((s) => s.dotBottom)) + MARGIN, clip.bottom),
        };
        // 内容与可视区完全不相交（全滚出去了）：不必渲染
        if (bounds.bottom - bounds.top < 1 || bounds.right - bounds.left < 1) {
            /*
             * ⚠️ 这里返回 null，而诊断读的是 `rail?.segments.length ?? 0` ——
             * 所以 **null 和"线段数组为空"在日志里长得一模一样**（都是 segments=0）。
             * 那正是 2026-10-02 那批日志指不出病灶的原因之一：把 `skips` 一起带出去，
             * 至少能区分"被逐条跳过"和"算出来了但边界退化"。
             */
            return { segments: [], bounds: null, skips: [...skips, `边界退化(bounds=${Math.round(bounds.left)}~${Math.round(bounds.right)},${Math.round(bounds.top)}~${Math.round(bounds.bottom)} clip=${Math.round(clip.left)}~${Math.round(clip.right)})`] };
        }
        return { segments, bounds, skips };
    }, [rows, connections]);
    // 诊断：**只在出问题时上报**。
    //
    // 早先是无条件每 2 秒报一条，把日志刷爆了。而它已经完成了使命 ——
    // 连续多条 `segments=2 missing=[无]` 证明「运行回复时连线消失」
    // （标记属性被卸载时擦掉）那个 bug 确实修好了。
    // 现在只在「有会话没映射上」或「段数少于连接数」时才报，那才是要查的信号。
    useEffect(() => {
        if (!client)
            return;
        if (connections.length === 0)
            return;
        // rows=0 是渲染的**瞬时状态**（重挂载、切换工作区等），报它没有意义 ——
        // 会喊狼来了的诊断比没有诊断更糟。
        if (rows.length === 0)
            return;
        const short = (s) => s.replace(/^session-/, '').slice(0, 8);
        const needed = Array.from(new Set(connections.flatMap((c) => [c.sessionA, c.sessionB])));
        const mappedIds = new Set(rows.map((r) => r.id));
        const missing = needed.filter((id) => !mappedIds.has(id));
        const segments = rail?.segments.length ?? 0;
        if (missing.length === 0 && segments >= connections.length)
            return;
        client.report(`rail 异常 conns=${connections.length} rows=${rows.length} segments=${segments} ` +
            `missing=[${missing.map(short).join(',') || '无'}] ` +
            // 关键：把"为什么画不出来"一起报出去（原来只有数字，指不出病灶）
            `skips=[${(rail?.skips ?? []).join(' | ') || '无'}] ` +
            `mapped=[${rows.map((r) => short(r.id)).join(',')}]`);
    }, [rail, rows, connections, client]);
    /** 上次已上报诊断的段数 —— 只在「0 → 非 0」那一次打一行，不刷屏。 */
    const railDiagRef = useRef(0);
    /** 视图偏好：整条轨道可以一键隐藏（只影响观感，连接本身不动）。 */
    const [railVisible, setRailVisible] = useState(() => prefs.get().railVisible);
    useEffect(() => prefs.subscribe(() => setRailVisible(prefs.get().railVisible)), [prefs]);
    /**
     * 遮挡诊断：**画出来了但看不见**时用（2026-10-02 加）。
     *
     * 与 rail 的 `skips=` 诊断互补 —— 那个答的是"为什么没算出来"，
     * 这个答的是"算出来了为什么看不到"。两者都是"一次定位"的思路。
     *
     * 触发时机：段数从 0 变成 >0 的那一次（**只在首次出现时打一行**，不刷屏）。
     * 内容：
     *   · 画布 rect / 计算样式的 z-index、opacity、display
     *   · 段数 + 首段两端坐标
     *   · **在首段中点做一次 `elementsFromPoint`** —— 若栈顶不是我们自己的 SVG，
     *     而是别人的元素，就是被遮住了（这条一行定性）
     */
    useEffect(() => {
        if (!client)
            return;
        const n = rail?.segments.length ?? 0;
        if (n === 0)
            return;
        if (railDiagRef.current === n)
            return;
        railDiagRef.current = n;
        const seg = rail.segments[0];
        const midX = seg.x;
        const midY = (seg.y1 + seg.y2) / 2;
        let top3 = 'n/a';
        let svgStyle = 'n/a';
        try {
            const stack = document.elementsFromPoint(midX, midY).slice(0, 3);
            top3 = stack
                .map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('class') ? `.${(e.getAttribute('class') ?? '').split(/\s+/)[0]}` : ''}`)
                .join(' | ');
            const svg = document.querySelector('.ccr-rail-overlay');
            if (svg) {
                const cs = window.getComputedStyle(svg);
                svgStyle = `z=${cs.zIndex} op=${cs.opacity} disp=${cs.display}`;
            }
        }
        catch {
            /* 诊断失败不影响渲染 */
        }
        const r = rail.bounds;
        client.report(`rail 遮挡诊断 segs=${n} bounds={x:${Math.round(r?.left ?? 0)},y:${Math.round(r?.top ?? 0)},w:${Math.round((r?.right ?? 0) - (r?.left ?? 0))},h:${Math.round((r?.bottom ?? 0) - (r?.top ?? 0))}} ${svgStyle} 首段=(${Math.round(seg.x)},${Math.round(seg.y1)})~(${Math.round(seg.x)},${Math.round(seg.y2)}) 中点栈顶3层=[${top3}]`);
    }, [client, rail]);
    if (!railVisible)
        return null;
    if (!rail)
        return null;
    const { segments, bounds } = rail;
    // bounds 为 null = 边界退化（见 useMemo 里的说明）→ 没东西可画
    if (!bounds)
        return null;
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    return (_jsxs("svg", { className: "ccr-rail-overlay", "aria-hidden": "true", style: {
            position: 'fixed',
            left: bounds.left,
            top: bounds.top,
            width,
            height,
            pointerEvents: 'none',
            /*
             * ⚠️ z-index 从 5 提到 9999（2026-10-02）。
             *
             * 现场：用户装 `web-ui-skin-center` 时**看不到连线，却看得到拖拽线** ——
             * 而拖拽线是 `z-index: 9999`、轨道原来是 `5`。
             * **同一个界面里一个可见一个不可见，差别就是这个层级**：
             * 皮肤的壁纸/叠加层落在 5 之上、9999 之下。
             *
             * 提到与拖拽线同级（两者不重叠：轨道只在会话列表区域，拖拽线是全程跟随）。
             * `pointer-events: none` 已保证它不挡交互 —— 所以抬高只是"画得更靠前"。
             */
            zIndex: 9999,
            // hidden（不是 visible）：画布已经是「内容 ∩ 列表可视区」，
            // 越界的形状（尤其滚出去的端点圆点）必须在这里被统一裁掉 ——
            // 这就是"线永远不会画到列表之外"的最后一道保证。
            overflow: 'hidden',
        }, children: [_jsx("defs", { children: _jsx("filter", { id: "ccr-rail-glow", x: "-80%", y: "-30%", width: "260%", height: "160%", children: _jsx("feGaussianBlur", { stdDeviation: "2" }) }) }), segments.map((seg) => (_jsxs("g", { opacity: seg.broken ? 0.35 : 1, children: [_jsx("line", { x1: seg.x - bounds.left, y1: seg.y1 - bounds.top, x2: seg.x - bounds.left, y2: seg.y2 - bounds.top, stroke: "var(--ccr-flow-color, #fff)", strokeWidth: 5, strokeOpacity: 0.14, strokeLinecap: "round", filter: "url(#ccr-rail-glow)" }), _jsx("line", { x1: seg.x - bounds.left, y1: seg.y1 - bounds.top, x2: seg.x - bounds.left, y2: seg.y2 - bounds.top, stroke: "var(--ccr-flow-color, #fff)", strokeWidth: 2, strokeOpacity: 0.55, strokeLinecap: "round" }), _jsx("line", { x1: seg.x - bounds.left, y1: seg.y1 - bounds.top, x2: seg.x - bounds.left, y2: seg.y2 - bounds.top, stroke: "var(--ccr-flow-color, #fff)", strokeWidth: 1.2, strokeOpacity: 0.45, strokeLinecap: "round", strokeDasharray: "10 26", className: "ccr-rail__flow" }), [
                        [seg.dotTop, seg.topColor, seg.topTip],
                        [seg.dotBottom, seg.bottomColor, seg.bottomTip],
                    ].map(([y, color, tip], i) => (_jsxs("g", { children: [_jsx("title", { children: tip }), _jsx("circle", { cx: seg.x - bounds.left, cy: y - bounds.top, r: 4.5, fill: color, fillOpacity: 0.22, filter: "url(#ccr-rail-glow)" }), _jsx("circle", { cx: seg.x - bounds.left, cy: y - bounds.top, r: 2.6, fill: color, fillOpacity: 0.9 })] }, i)))] }, seg.id)))] }));
}
//# sourceMappingURL=SessionRailOverlay.js.map