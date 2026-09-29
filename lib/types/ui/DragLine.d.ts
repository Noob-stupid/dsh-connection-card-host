interface Point {
    x: number;
    y: number;
}
interface DragLineProps {
    start: Point;
    end: Point;
    /** 松手后置 true，触发退出动效。 */
    releasing?: boolean;
    /** 退出动效结束（父组件据此卸载）。 */
    onComplete?: () => void;
}
export declare function DragLine({ start, end, releasing, onComplete }: DragLineProps): import("react").JSX.Element;
export {};
