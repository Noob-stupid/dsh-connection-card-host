import type { ConnectionCardHostClient } from '../client/host-client.js';
import type { SessionsBridge } from '../client/sessions-bridge.js';
import type { ViewPrefsStore } from '../client/view-prefs.js';
interface SessionRailOverlayProps {
    client: ConnectionCardHostClient | null;
    sessions: SessionsBridge | null;
    /** 视图偏好（lane 上限等），与面板共享同一实例。 */
    prefs: ViewPrefsStore;
}
export declare function SessionRailOverlay({ client, sessions, prefs }: SessionRailOverlayProps): import("react").JSX.Element | null;
export {};
