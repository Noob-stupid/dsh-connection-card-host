/** 行元素上承载会话 id 的属性名。 */
export declare const ROW_ID_ATTR = "data-ccr-session";
interface SessionRowMarkerProps {
    sessionId: string;
}
export declare function SessionRowMarker({ sessionId }: SessionRowMarkerProps): import("react").JSX.Element;
export {};
