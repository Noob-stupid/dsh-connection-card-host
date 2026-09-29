interface Point {
    x: number;
    y: number;
}
interface DragLineProps {
    start: Point;
    end: Point;
    onComplete?: () => void;
}
export declare function DragLine({ start, end, onComplete }: DragLineProps): import("react").JSX.Element;
export {};
