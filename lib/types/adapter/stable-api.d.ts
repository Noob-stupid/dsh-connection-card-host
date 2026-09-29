/**
 * Stable API — 对外暴露的稳定接口层。
 * 浏览器端和卡片通过此接口与宿主交互，隔离内部实现变化。
 */
import type { Connection, PermissionLevel, CardInstance } from '../types/index.js';
import type { ConnectionManager } from '../core/connection-manager.js';
import type { ConnectionEventBus } from '../core/event-bus.js';
import type { CardHost } from '../card-host/loader.js';
import type { DSHAdapter, KnownSession } from './dsh-adapter.js';
export type { KnownSession };
export interface ConnectionCardHostService {
    createConnection(sessionA: string, sessionB: string): Connection;
    disconnect(id: string): void;
    updatePermission(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): void;
    requestPermissionUpgrade(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): string | null;
    acceptPermissionUpgrade(requestId: string, acceptorId: string): boolean;
    rejectPermissionUpgrade(requestId: string, rejectorId: string): void;
    getConnectionsBySession(sessionId: string): Connection[];
    getConnectionById(id: string): Connection | undefined;
    getAllConnections(): Connection[];
    onConnectionEvent(event: 'created' | 'updated' | 'disconnected', handler: (conn: Connection) => void): () => void;
    subscribeConnectionEvent(connectionId: string, event: string, handler: (data: unknown) => void): () => void;
    emitConnectionEvent(connectionId: string, event: string, data: unknown): void;
    loadCard(templateId: string, connectionId: string): Promise<CardInstance>;
    unloadCard(instanceId: string): Promise<void>;
    reloadCard(instanceId: string): Promise<void>;
    negotiateWhitelist(connectionId: string, methods: {
        method: string;
        description: string;
    }[]): void;
    isWhitelisted(connectionId: string, method: string): boolean;
    listWhitelistedMethods(connectionId: string): {
        method: string;
        description: string;
        approvedBy: string[];
    }[];
    listSessions(): KnownSession[];
}
export declare function createStableApi(manager: ConnectionManager, eventBus: ConnectionEventBus, cardHost?: CardHost, adapter?: DSHAdapter): ConnectionCardHostService;
