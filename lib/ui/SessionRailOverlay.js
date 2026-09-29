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
import { useEffect, useMemo, useState } from 'react';
import { allocateLanes } from '../core/lane-allocator.js';
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
export function SessionRailOverlay({ client, sessions }) {
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
        // 画在会话行上：贴着行的右边缘往左排 lane
        const baseX = Math.max(...rows.map((r) => r.right)) - ROW_RIGHT_INSET;
        const segments = [];
        for (const conn of connections) {
            const assignment = layout.connections.get(conn.id);
            if (!assignment)
                continue;
            const a = rowById.get(conn.sessionA);
            const b = rowById.get(conn.sessionB);
            if (!a || !b)
                continue;
            const y1 = (a.top + a.bottom) / 2;
            const y2 = (b.top + b.bottom) / 2;
            const x = baseX - assignment.laneIndex * LANE_WIDTH;
            const level = conn.permission.aToB;
            segments.push({
                id: conn.id,
                x,
                y1,
                y2,
                top: Math.min(y1, y2),
                bottom: Math.max(y1, y2),
                color: PERMISSION_COLOR[level] ?? '#9CA3AF',
                broken: conn.status === 'broken',
            });
        }
        if (segments.length === 0)
            return null;
        return {
            segments,
            bounds: {
                left: Math.min(...segments.map((s) => s.x)) - 8,
                right: Math.max(...segments.map((s) => s.x)) + 8,
                top: Math.min(...segments.map((s) => s.top)) - 8,
                bottom: Math.max(...segments.map((s) => s.bottom)) + 8,
            },
        };
    }, [rows, connections]);
    if (!rail)
        return null;
    const { segments, bounds } = rail;
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    return (_jsxs("svg", { className: "ccr-rail-overlay", "aria-hidden": "true", style: {
            position: 'fixed',
            left: bounds.left,
            top: bounds.top,
            width,
            height,
            pointerEvents: 'none',
            zIndex: 5,
            overflow: 'visible',
        }, children: [_jsx("defs", { children: _jsx("filter", { id: "ccr-rail-glow", x: "-80%", y: "-30%", width: "260%", height: "160%", children: _jsx("feGaussianBlur", { stdDeviation: "2" }) }) }), segments.map((seg) => (_jsxs("g", { opacity: seg.broken ? 0.35 : 1, children: [_jsx("line", { x1: seg.x - bounds.left, y1: seg.y1 - bounds.top, x2: seg.x - bounds.left, y2: seg.y2 - bounds.top, stroke: "var(--ccr-flow-color, #fff)", strokeWidth: 5, strokeOpacity: 0.14, strokeLinecap: "round", filter: "url(#ccr-rail-glow)" }), _jsx("line", { x1: seg.x - bounds.left, y1: seg.y1 - bounds.top, x2: seg.x - bounds.left, y2: seg.y2 - bounds.top, stroke: "var(--ccr-flow-color, #fff)", strokeWidth: 2, strokeOpacity: 0.55, strokeLinecap: "round" }), _jsx("line", { x1: seg.x - bounds.left, y1: seg.y1 - bounds.top, x2: seg.x - bounds.left, y2: seg.y2 - bounds.top, stroke: "var(--ccr-flow-color, #fff)", strokeWidth: 1.2, strokeOpacity: 0.45, strokeLinecap: "round", strokeDasharray: "10 26", className: "ccr-rail__flow" }), [seg.y1, seg.y2].map((y, i) => (_jsxs("g", { children: [_jsx("circle", { cx: seg.x - bounds.left, cy: y - bounds.top, r: 4.5, fill: seg.color, fillOpacity: 0.22, filter: "url(#ccr-rail-glow)" }), _jsx("circle", { cx: seg.x - bounds.left, cy: y - bounds.top, r: 2.6, fill: seg.color, fillOpacity: 0.9 })] }, i)))] }, seg.id)))] }));
}
//# sourceMappingURL=SessionRailOverlay.js.map