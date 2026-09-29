import { jsx as _jsx } from "react/jsx-runtime";
/**
 * AnchorCircle — 输入框工具行左侧的连接锚点。
 *
 * 规格书：默认 12px / 悬停 14px / 拖拽时脉冲光环。
 *
 * 两个必须守住的点：
 *  1. 关键几何走内联样式 —— 空 div 一旦 CSS 没加载就是 0 尺寸的不可见元素。
 *  2. `dragging` 由**父组件**传入，不在内部自持。
 *     早期版本内部 setState('dragging') 后没有任何地方复位，
 *     于是点过一次就永远停在拖拽态、脉冲动画一直闪。
 */
import { useState, useCallback, useRef } from 'react';
export function AnchorCircle({ onDragStart, onTouchStart, onTouchMove, onTouchEnd, dragging = false, }) {
    const [hover, setHover] = useState(false);
    const anchorRef = useRef(null);
    const handleMouseEnter = useCallback(() => setHover(true), []);
    const handleMouseLeave = useCallback(() => setHover(false), []);
    const handleMouseDown = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragStart(e.clientX, e.clientY);
    }, [onDragStart]);
    /** 阻止浏览器把这次按压升级成原生 HTML5 拖拽（否则会拖动/重排元素）。 */
    const handleNativeDragStart = useCallback((e) => {
        e.preventDefault();
    }, []);
    const handleTouchStart = useCallback((e) => {
        if (!onTouchStart)
            return;
        const t = e.touches[0];
        const rect = anchorRef.current?.getBoundingClientRect();
        const anchorX = (rect?.left ?? t.clientX) + (rect?.width ?? 0) / 2;
        const anchorY = (rect?.top ?? t.clientY) + (rect?.height ?? 0) / 2;
        onTouchStart(t.clientX, t.clientY, anchorX, anchorY);
    }, [onTouchStart]);
    const handleTouchMove = useCallback((e) => {
        if (!onTouchMove)
            return;
        const t = e.touches[0];
        if (onTouchMove(t.clientX, t.clientY))
            e.preventDefault();
    }, [onTouchMove]);
    const handleTouchEnd = useCallback(() => {
        onTouchEnd?.();
    }, [onTouchEnd]);
    // 配色刻意「贴着背景」：默认几乎融进背景，悬停才明显。
    // 颜色跟随主题（深色主题下是浅灰，浅色主题下是深灰），避免白/黑在某个主题下消失。
    const idleColor = 'var(--dsw-alias-label-secondary, #9CA3AF)';
    const activeColor = 'var(--ccr-flow-color, #60A5FA)';
    const size = hover || dragging ? 13 : 11;
    const style = {
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        background: dragging ? activeColor : idleColor,
        // 默认很淡（偏背景），悬停/拖拽才提起来
        opacity: dragging ? 0.9 : hover ? 0.85 : 0.32,
        cursor: dragging ? 'grabbing' : 'pointer',
        position: 'relative',
        flexShrink: 0,
        display: 'inline-block',
        transition: 'width 140ms ease, height 140ms ease, opacity 140ms ease, background 140ms ease',
        touchAction: 'none',
        // 悬停时才给一点点光晕，幅度也压小
        boxShadow: hover && !dragging ? '0 0 0 2px rgba(128,128,128,0.18)' : 'none',
    };
    return (_jsx("div", { ref: anchorRef, className: `ccr-anchor${dragging ? ' ccr-anchor--dragging' : ''}`, style: style, onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave, onMouseDown: handleMouseDown, onDragStart: handleNativeDragStart, draggable: false, onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd, role: "button", "aria-label": "\u53D1\u8D77\u4F1A\u8BDD\u8FDE\u63A5\uFF08\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u5217\u8868\uFF09", title: "\u6309\u4F4F\u62D6\u5230\u5DE6\u4FA7\u4EFB\u610F\u4F1A\u8BDD\uFF0C\u5EFA\u7ACB\u8FDE\u63A5", tabIndex: 0, onKeyDown: (e) => {
            if (e.key === 'Enter') {
                const rect = e.target.getBoundingClientRect();
                onDragStart(rect.left + rect.width / 2, rect.top + rect.height / 2);
            }
        }, children: dragging && _jsx("div", { className: "ccr-anchor__pulse" }) }));
}
//# sourceMappingURL=AnchorCircle.js.map