import type { ConnectionCardHostClient } from '../client/host-client.js';
import type { Connection } from '../types/index.js';
interface AwarenessPanelProps {
    client: ConnectionCardHostClient | null;
    connection: Connection;
    labelA: string;
    labelB: string;
    onNotice: (msg: string) => void;
}
export declare function AwarenessPanel({ client, connection, labelA, labelB, onNotice, }: AwarenessPanelProps): import("react").JSX.Element;
export {};
