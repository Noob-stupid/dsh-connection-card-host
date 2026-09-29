import { jsx as _jsx } from "react/jsx-runtime";
/**
 * AnchorCircle — 输入框左侧小圆圈。
 * 位置：输入框左侧，垂直居中，距左边缘 8px。
 * 尺寸：默认 12px，悬停 14px。
 * 状态：idle(40%) → hover(80%) → dragging(100% + 脉冲光环)。
 */
import { useState, useCallback, useRef } from 'react';
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
    return (_jsx("div", { ref: anchorRef, className: `anchor-circle anchor-circle--${state}`, onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave, onMouseDown: handleMouseDown, onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd, role: "button", "aria-label": "\u53D1\u8D77\u4F1A\u8BDD\u8FDE\u63A5", tabIndex: 0, onKeyDown: (e) => {
            if (e.key === 'Enter') {
                const rect = e.target.getBoundingClientRect();
                setState('dragging');
                onDragStart(rect.left + rect.width / 2, rect.top + rect.height / 2);
            }
        }, children: _jsx("div", { className: "anchor-circle__pulse" }) }));
}
//# sourceMappingURL=AnchorCircle.js.map