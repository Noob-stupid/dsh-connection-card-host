import type { ConnectionCardHostClient } from '../client/host-client.js';
import type { SessionsBridge } from '../client/sessions-bridge.js';
interface SessionRailOverlayProps {
    client: ConnectionCardHostClient | null;
    sessions: SessionsBridge | null;
}
export declare function SessionRailOverlay({ client, sessions }: SessionRailOverlayProps): import("react").JSX.Element | null;
export {};
