import type { Connection } from '../types/index.js';
import type { ConnectionCardHostClient } from '../client/host-client.js';
interface CardStackProps {
    connection: Connection;
    client: ConnectionCardHostClient | null;
    /** 卡片增删后通知外层刷新连接列表 */
    onChanged?: () => void;
}
export declare function CardStack({ connection, client, onChanged }: CardStackProps): import("react").JSX.Element;
export {};
