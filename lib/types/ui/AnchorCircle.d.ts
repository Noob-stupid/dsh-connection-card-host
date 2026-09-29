interface AnchorCircleProps {
    onDragStart: (x: number, y: number) => void;
    onTouchStart?: (x: number, y: number, anchorX: number, anchorY: number) => void;
    onTouchMove?: (x: number, y: number) => boolean;
    onTouchEnd?: () => void;
}
export declare function AnchorCircle({ onDragStart, onTouchStart, onTouchMove, onTouchEnd, }: AnchorCircleProps): import("react").JSX.Element;
export {};
