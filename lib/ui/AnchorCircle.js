import { jsx as _jsx } from "react/jsx-runtime";
/**
 * AnchorCircle — 输入框工具行左侧的连接锚点小圆圈。
 *
 * 规格书：默认 12px / 悬停 14px / 拖拽时脉冲光环。
 *
 * ⚠️ 关键几何全部走**内联样式**，不依赖外部样式表 —— 空 div 没有内容，
 * 一旦 CSS 没加载就是 0 尺寸的不可见元素（本项目踩过这个坑）。
 * 动画（脉冲）才交给注入的样式表，缺失也不影响可用性。
 */
import { useState, useCallback, useRef } from 'react';
const BASE_COLOR = '#60A5FA';
export function AnchorCircle({ onDragStart, onTouchStart, onTouchMove, onTouchEnd, }) {
    const [state, setState] = useState('idle');
    const anchorRef = useRef(null);
    const handleMouseEnter = useCallback(() => {
        if (state !== 'dragging')
            setState('hover');
    }, [state]);
    const handleMouseLeave = useCallback(() => {
        if (state !== 'dragging')
            setState('idle');
    }, [state]);
    const handleMouseDown = useCallback((e) => {
        e.preventDefault();
        setState('dragging');
        onDragStart(e.clientX, e.clientY);
    }, [onDragStart]);
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
        if (onTouchMove(t.clientX, t.clientY)) {
            e.preventDefault();
            if (state !== 'dragging')
                setState('dragging');
        }
    }, [onTouchMove, state]);
    const handleTouchEnd = useCallback(() => {
        onTouchEnd?.();
        setState('idle');
    }, [onTouchEnd]);
    // 几何与配色内联，保证任何情况下都看得见
    const size = state === 'hover' ? 14 : 12;
    const style = {
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        background: BASE_COLOR,
        opacity: state === 'idle' ? 0.45 : state === 'hover' ? 0.9 : 1,
        cursor: state === 'dragging' ? 'grabbing' : 'pointer',
        position: 'relative',
        flexShrink: 0,
        display: 'inline-block',
        transition: 'width 120ms ease, height 120ms ease, opacity 120ms ease',
        boxShadow: state === 'hover' ? '0 0 0 3px rgba(96,165,250,0.22)' : 'none',
        touchAction: 'none',
    };
    return (_jsx("div", { ref: anchorRef, className: `ccr-anchor ccr-anchor--${state}`, style: style, onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave, onMouseDown: handleMouseDown, onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd, role: "button", "aria-label": "\u53D1\u8D77\u4F1A\u8BDD\u8FDE\u63A5\uFF08\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u5217\u8868\uFF09", title: "\u6309\u4F4F\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\uFF0C\u5EFA\u7ACB\u8FDE\u63A5", tabIndex: 0, onKeyDown: (e) => {
            if (e.key === 'Enter') {
                const rect = e.target.getBoundingClientRect();
                setState('dragging');
                onDragStart(rect.left + rect.width / 2, rect.top + rect.height / 2);
            }
        }, children: _jsx("div", { className: "ccr-anchor__pulse" }) }));
}
//# sourceMappingURL=AnchorCircle.js.map