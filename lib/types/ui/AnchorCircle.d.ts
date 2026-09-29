interface AnchorCircleProps {
    onDragStart: (x: number, y: number) => void;
    onTouchStart?: (x: number, y: number, anchorX: number, anchorY: number) => void;
    onTouchMove?: (x: number, y: number) => boolean;
    onTouchEnd?: () => void;
    /** 由父组件控制的拖拽态（单一数据源）。 */
    dragging?: boolean;
}
export declare function AnchorCircle({ onDragStart, onTouchStart, onTouchMove, onTouchEnd, dragging, }: AnchorCircleProps): import("react").JSX.Element;
export {};
