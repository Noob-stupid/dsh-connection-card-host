import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * DragLine — 拖拽时的「水流」连接线。
 *
 * 视觉：白色半透明、像水在流（用户要求），四层叠加：
 *   1. 光晕   宽描边 + 高斯模糊 + 极低透明 → 水汽感
 *   2. 主线   沿线渐变（两端淡出）的半透明主体
 *   3. 流带   短划线沿路径滑动 → 「在流」而不是「虚线在抖」
 *   4. 水珠   9 颗不同大小/速度/透明度的粒子顺流而下
 *
 * 颜色取 CSS 变量 --ccr-flow-color（默认映射到 DSH 主题 token，
 * 深色主题下即白色；纯白在浅色主题会消失，所以不写死）。
 *
 * 时序：dragging → (松手) → shrinking(200ms) → pulsing(300ms) → onComplete
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getOverlayHost } from './overlay-host.js';
/*
 * 拖拽线的颜色。
 *
 * ⚠️ 原来是 var(--ccr-flow-color, #ffffff) —— 那条链的最后一跳是
 * DSH 的「文字色」令牌 --dsw-alias-label-primary，实测会解析成**纯白**，
 * 白线落在**明亮壁纸**上 ＝ 隐形（用户报的「拉线看不见」正是这个）。
 *
 * 改用轨道同款的**中间调**令牌：中等明度的蓝在亮底与暗底上都够读。
 * 主题仍可覆盖 --ccr-drag-color 换色。
 *
 * ⚠️ 用户裁定：可见性靠**选对颜色**解决，**不要**靠加粗/描边/黑边晕。
 */
const FLOW_COLOR = 'var(--ccr-drag-color, #60a5fa)';
const BASE_SPEED = 300; // px/s
const WATER_BASE_MS = 200;
const WATER_PULSE_MS = 300;
/** 9 颗水珠的确定性参数（不用随机，避免每帧抖动）。 */
const PARTICLE_PROFILES = Array.from({ length: 9 }, (_, i) => ({
    offset: i / 9,
    size: 0.7 + (((i * 37) % 100) / 100) * 1.6, // 0.7 – 2.3
    speed: 0.72 + (((i * 53) % 100) / 100) * 0.7, // 0.72 – 1.42
    opacity: 0.3 + (((i * 71) % 100) / 100) * 0.6, // 0.3 – 0.9
}));
/** 唯一 id：同一时刻只应有一个 DragLine，但用计数器更稳。 */
let gradientSeq = 0;
function buildBezierPath(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // 控制点沿法线方向偏移，形成柔和弧线（比固定 -20 更自然）
    const nx = -dy;
    const ny = dx;
    const len = Math.hypot(nx, ny) || 1;
    const bulge = Math.min(60, len * 0.22);
    const cx = (start.x + end.x) / 2 + (nx / len) * bulge;
    const cy = (start.y + end.y) / 2 + (ny / len) * bulge;
    return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
}
export function DragLine({ start, end, releasing = false, onComplete }) {
    const [phase, setPhase] = useState('dragging');
    const [particles, setParticles] = useState([]);
    const pathRef = useRef(null);
    const rafRef = useRef(0);
    const gradId = useMemo(() => `ccr-flow-grad-${++gradientSeq}`, []);
    const blurId = useMemo(() => `ccr-flow-blur-${gradientSeq}`, [gradientSeq]);
    const path = useMemo(() => buildBezierPath(start, end), [start, end]);
    // 松手 → 进入退出动效
    useEffect(() => {
        if (releasing && phase === 'dragging') {
            cancelAnimationFrame(rafRef.current);
            setPhase('shrinking');
        }
    }, [releasing, phase]);
    // 水珠流动
    useEffect(() => {
        if (phase !== 'dragging')
            return;
        const pathEl = pathRef.current;
        if (!pathEl)
            return;
        let totalLength = 0;
        try {
            totalLength = pathEl.getTotalLength();
        }
        catch {
            return;
        }
        if (!Number.isFinite(totalLength) || totalLength <= 0)
            return;
        setParticles(PARTICLE_PROFILES.map((p) => ({ t: p.offset * totalLength })));
        let last = performance.now();
        const tick = (now) => {
            const dt = Math.min((now - last) / 1000, 0.1); // 夹住后台切回的巨帧
            last = now;
            setParticles((prev) => prev.map((p, i) => ({
                t: (p.t + BASE_SPEED * PARTICLE_PROFILES[i].speed * dt) % totalLength,
            })));
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [phase, path]);
    // 退出动效时序
    useEffect(() => {
        if (phase === 'shrinking') {
            const timer = setTimeout(() => setPhase('pulsing'), WATER_BASE_MS);
            return () => clearTimeout(timer);
        }
        if (phase === 'pulsing') {
            const timer = setTimeout(() => onComplete?.(), WATER_PULSE_MS);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [phase, onComplete]);
    const pulsing = phase === 'pulsing';
    const coreStyle = {
        stroke: `url(#${gradId})`,
        strokeWidth: pulsing ? 3.5 : 2,
        strokeOpacity: pulsing ? 0.3 : 0.9,
        transition: 'stroke-width 200ms ease, stroke-opacity 200ms ease',
    };
    const svg = (_jsxs("svg", { className: "ccr-drag-line", "aria-hidden": "true", style: {
            position: 'fixed',
            // ⚠️ 绝不要用 100vw/100vh：vw 含纵向滚动条宽度，页面一有滚动条就撑出
            // 横向滚动条 → 整个布局被挤动 → 观感就是"输入框会跑"。
            // 用四边 inset 贴齐，尺寸自动等于视口内容区（不含滚动条）。
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none', // 内联兜底：绝不能挡住交互
            zIndex: 9999,
            overflow: 'visible',
        }, children: [_jsxs("defs", { children: [_jsxs("linearGradient", { id: gradId, gradientUnits: "userSpaceOnUse", x1: start.x, y1: start.y, x2: end.x, y2: end.y, children: [_jsx("stop", { offset: "0%", stopColor: FLOW_COLOR, stopOpacity: "0" }), _jsx("stop", { offset: "18%", stopColor: FLOW_COLOR, stopOpacity: "0.55" }), _jsx("stop", { offset: "50%", stopColor: FLOW_COLOR, stopOpacity: "0.95" }), _jsx("stop", { offset: "82%", stopColor: FLOW_COLOR, stopOpacity: "0.55" }), _jsx("stop", { offset: "100%", stopColor: FLOW_COLOR, stopOpacity: "0" })] }), _jsx("filter", { id: blurId, x: "-30%", y: "-30%", width: "160%", height: "160%", children: _jsx("feGaussianBlur", { stdDeviation: "3" }) })] }), _jsx("path", { d: path, className: "ccr-flow__glow", filter: `url(#${blurId})` }), _jsx("path", { ref: pathRef, d: path, className: "ccr-flow__core", style: coreStyle }), !pulsing && _jsx("path", { d: path, className: "ccr-flow__band" }), !pulsing &&
                phase === 'dragging' &&
                particles.map((p, i) => {
                    const pathEl = pathRef.current;
                    if (!pathEl)
                        return null;
                    const profile = PARTICLE_PROFILES[i];
                    let point;
                    try {
                        point = pathEl.getPointAtLength(p.t);
                    }
                    catch {
                        return null;
                    }
                    const total = pathEl.getTotalLength() || 1;
                    const progress = p.t / total;
                    // 两端淡出，避免水珠在端点突然出现/消失
                    const edgeFade = Math.sin(progress * Math.PI);
                    return (_jsx("circle", { className: "ccr-flow__particle", cx: point.x, cy: point.y, r: profile.size, opacity: profile.opacity * edgeFade, style: { filter: 'blur(0.6px)' } }, i));
                })] }));
    /*
     * ⚠️ **portal 到共用覆盖层宿主**（2026-10-02）。
     *
     * 这是"**拉线看不见**"（用户实际报的症状）两个病因里的**结构那一个**。
     *
     * 拖拽线原先渲染在槽位 `conversation.input.left` 的容器里 ——
     * 于是它的堆叠上下文就是**那个容器**。别人（皮肤/叠加层）只要把自己的容器
     * 排在它之上，**元素自身的 `z-index: 9999` 一点用都没有**：比的是"容器 vs 容器"。
     * 轨道线在同一个坑里栽过一次（读数：`div.skin-wallpaper` 在栈顶）。
     *
     * 挂到 `document.body` 的末子节点之后，堆叠直接相对 body，
     * 与"哪个槽位容器在上面"彻底解耦。层内 z-index 9999（高于轨道的 9998）。
     *
     * 坐标不受影响：svg 是 `position: fixed; inset: 0`，用的是
     * `MouseEvent.clientX/clientY` 的视口坐标，与父容器无关。
     * 详见 `overlay-host.ts`。
     */
    const host = getOverlayHost();
    return host ? createPortal(svg, host) : svg;
}
//# sourceMappingURL=DragLine.js.map