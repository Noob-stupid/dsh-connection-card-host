import type { ConnectionCardHostClient } from '../client/host-client.js';
import type { ViewPrefsStore } from '../client/view-prefs.js';
import type { Connection } from '../types/index.js';
interface AwarenessPanelProps {
    client: ConnectionCardHostClient | null;
    connection: Connection;
    labelA: string;
    labelB: string;
    prefs: ViewPrefsStore;
    onNotice: (msg: string) => void;
}
export declare function AwarenessPanel({ client, connection, labelA, labelB, prefs, onNotice, }: AwarenessPanelProps): import("react").JSX.Element;
export {};
