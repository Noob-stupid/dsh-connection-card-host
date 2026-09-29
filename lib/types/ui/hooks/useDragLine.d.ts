interface Point {
    x: number;
    y: number;
}
export interface DragLineState {
    dragging: boolean;
    start: Point | null;
    current: Point | null;
}
export declare function useDragLine(): {
    state: DragLineState;
    onMouseDown: (x: number, y: number) => void;
    onMouseMove: (x: number, y: number) => void;
    onMouseUp: () => void;
    onTouchStart: (x: number, y: number, anchorX: number, anchorY: number) => void;
    onTouchMove: (x: number, y: number) => boolean;
    onTouchEnd: () => Point | null;
};
export {};
