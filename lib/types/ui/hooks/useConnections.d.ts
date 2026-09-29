import type { ConnectionCardHostClient } from '../../client/host-client.js';
import type { Connection } from '../../types/index.js';
export interface UseConnectionsResult {
    connections: Connection[];
    /** 最近一次拉取的错误；成功后清空。 */
    error: string | null;
    /** 是否已完成首次拉取。 */
    loaded: boolean;
    refresh: () => Promise<void>;
}
export declare function useConnections(client: ConnectionCardHostClient | null): UseConnectionsResult;
