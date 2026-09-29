import type { ConnectionCardHostClient } from '../../client/host-client.js';
export interface SessionOption {
    id: string;
    label: string;
    /** 来源：侧栏可见 / 宿主内存 */
    source: 'sidebar' | 'host';
}
export declare function useSessionOptions(client: ConnectionCardHostClient | null): SessionOption[];
