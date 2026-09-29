import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * DragLine — 拉线动效。
 *
 * 底层：虚线流动线（stroke-dashoffset 动画）
 * 上层：4 个粒子沿贝塞尔曲线匀速流动（getPointAtLength）
 * 松手：shrinking(200ms) → pulsing(300ms) → onComplete
 *
 * ⚠️ 定位/穿透全部内联：SVG 覆盖整屏，若样式表没加载而 pointer-events
 * 又不是 none，会把整个界面点穿 —— 这种失败模式必须由内联样式兜住。
 */
import { useState, useEffect, useRef, useMemo } from 'react';
const LINE_COLOR = '#60A5FA';
const PARTICLE_COUNT = 4;
const PARTICLE_SPEED = 320; // px/s
const SHRINK_MS = 200;
const PULSE_MS = 300;
function buildBezierPath(start, end) {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    return `M ${start.x} ${start.y} Q ${midX} ${midY - 20} ${end.x} ${end.y}`;
}
export function DragLine({ start, end, releasing = false, onComplete }) {
    const [phase, setPhase] = useState('dragging');
    const [particles, setParticles] = useState([]);
    const pathRef = useRef(null);
    const rafRef = useRef(0);
    const path = useMemo(() => buildBezierPath(start, end), [start, end]);
    // 松手 → 进入退出动效
    useEffect(() => {
        if (releasing && phase === 'dragging') {
            cancelAnimationFrame(rafRef.current);
            setPhase('shrinking');
        }
    }, [releasing, phase]);
    // 粒子流动（仅拖拽中）
    useEffect(() => {
        if (phase !== 'dragging')
            return;
        const pathEl = pathRef.current;
        if (!pathEl)
            return;
        const totalLength = pathEl.getTotalLength();
        if (!Number.isFinite(totalLength) || totalLength <= 0)
            return;
        setParticles(Array.from({ length: PARTICLE_COUNT }, (_, i) => ({ t: (i / PARTICLE_COUNT) * totalLength })));
        let last = performance.now();
        const tick = (now) => {
            const dt = Math.min((now - last) / 1000, 0.1); // 夹住后台切回的巨帧
            last = now;
            setParticles((prev) => prev.map((p) => ({ t: (p.t + PARTICLE_SPEED * dt) % totalLength })));
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [phase, path]);
    // 退出动效时序
    useEffect(() => {
        if (phase === 'shrinking') {
            const timer = setTimeout(() => setPhase('pulsing'), SHRINK_MS);
            return () => clearTimeout(timer);
        }
        if (phase === 'pulsing') {
            const timer = setTimeout(() => onComplete?.(), PULSE_MS);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [phase, onComplete]);
    const pathStyle = {
        fill: 'none',
        stroke: LINE_COLOR,
        strokeWidth: phase === 'pulsing' ? 4 : 2,
        strokeOpacity: phase === 'pulsing' ? 0.35 : 0.75,
        strokeDasharray: '6 4',
        strokeLinecap: 'round',
    };
    return (_jsxs("svg", { className: "ccr-drag-line", "aria-hidden": "true", style: {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none', // 内联兜底：绝不能挡住交互
            zIndex: 9999,
            overflow: 'visible',
        }, children: [_jsx("path", { ref: pathRef, d: path, style: pathStyle }), phase === 'dragging' &&
                particles.map((p, i) => {
                    const pathEl = pathRef.current;
                    if (!pathEl)
                        return null;
                    const point = pathEl.getPointAtLength(p.t);
                    const totalLen = pathEl.getTotalLength() || 1;
                    const progress = p.t / totalLen;
                    const opacity = Math.sin(progress * Math.PI) * 0.8 + 0.3;
                    return (_jsx("circle", { cx: point.x, cy: point.y, r: 1.5, fill: LINE_COLOR, opacity: opacity, style: { filter: 'blur(1px)' } }, i));
                })] }));
}
//# sourceMappingURL=DragLine.js.map