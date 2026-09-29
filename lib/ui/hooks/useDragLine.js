/**
 * useDragLine — 管理拖拽拉线的状态机。
 * 鼠标：mousedown 立即进入拖拽（0ms）。
 * 触屏：touchstart 记录起点，移动 >8px 且在锚点 16px 内才进入拖拽。
 */
import { useState, useCallback, useRef } from 'react';
const DRAG_THRESHOLD = 8;
const ANCHOR_RADIUS = 16;
export function useDragLine() {
    const [state, setState] = useState({
        dragging: false,
        start: null,
        current: null,
    });
    const touchStartRef = useRef(null);
    const anchorCenterRef = useRef(null);
    /** 鼠标按下：立即进入拖拽 */
    const onMouseDown = useCallback((x, y) => {
        const point = { x, y };
        anchorCenterRef.current = point;
        setState({ dragging: true, start: point, current: point });
    }, []);
    /** 鼠标移动：更新终点 */
    const onMouseMove = useCallback((x, y) => {
        setState((prev) => {
            if (!prev.dragging || !prev.start)
                return prev;
            return { ...prev, current: { x, y } };
        });
    }, []);
    /** 鼠标松开：完成或取消 */
    const onMouseUp = useCallback(() => {
        setState((prev) => ({ ...prev, dragging: false }));
    }, []);
    /** 触屏开始：记录起点，不立即拖拽 */
    const onTouchStart = useCallback((x, y, anchorX, anchorY) => {
        touchStartRef.current = { x, y };
        anchorCenterRef.current = { x: anchorX, y: anchorY };
    }, []);
    /** 触屏移动：判断阈值 */
    const onTouchMove = useCallback((x, y) => {
        const ts = touchStartRef.current;
        const ac = anchorCenterRef.current;
        if (!ts || !ac)
            return false;
        const dx = x - ts.x;
        const dy = y - ts.y;
        const distance = Math.hypot(dx, dy);
        // 尚未进入拖拽
        if (!state.dragging) {
            if (distance > DRAG_THRESHOLD) {
                const stillNearAnchor = Math.hypot(x - ac.x, y - ac.y) < ANCHOR_RADIUS;
                if (stillNearAnchor) {
                    setState({ dragging: true, start: ts, current: { x, y } });
                    return true; // 调用方应 preventDefault
                }
                else {
                    touchStartRef.current = null;
                    return false;
                }
            }
            return false;
        }
        // 已在拖拽中
        setState((prev) => ({ ...prev, current: { x, y } }));
        return true;
    }, [state.dragging]);
    /** 触屏结束 */
    const onTouchEnd = useCallback(() => {
        const result = state.dragging ? state.current : null;
        touchStartRef.current = null;
        setState({ dragging: false, start: null, current: null });
        return result;
    }, [state.dragging, state.current]);
    return {
        state,
        onMouseDown,
        onMouseMove,
        onMouseUp,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
    };
}
//# sourceMappingURL=useDragLine.js.map