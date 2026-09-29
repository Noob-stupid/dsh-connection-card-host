/**
 * CardStack — 连接下的卡片列表渲染。
 * Phase 1：静态展示卡片状态点（健康色）。
 * Phase 2：接入真实卡片 UI（mountPanel）。
 */
import type { Connection } from '../types/index.js';
interface CardStackProps {
    connection: Connection;
}
export declare function CardStack({ connection }: CardStackProps): import("react").JSX.Element | null;
export {};
