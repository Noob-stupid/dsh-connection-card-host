import type { ConnectionCardHostClient } from '../client/host-client.js';
interface ConnectionPanelProps {
    client: ConnectionCardHostClient | null;
}
export declare function ConnectionPanel({ client }: ConnectionPanelProps): import("react").JSX.Element;
export {};
