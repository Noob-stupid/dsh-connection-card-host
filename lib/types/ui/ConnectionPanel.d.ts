import type { ConnectionCardHostClient } from '../client/host-client.js';
import type { SessionsBridge } from '../client/sessions-bridge.js';
interface ConnectionPanelProps {
    client: ConnectionCardHostClient | null;
    sessions: SessionsBridge | null;
}
export declare function ConnectionPanel({ client, sessions }: ConnectionPanelProps): import("react").JSX.Element;
export {};
