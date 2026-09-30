/**
 * Stable API — 对外暴露的稳定接口层。
 * 浏览器端和卡片通过此接口与宿主交互，隔离内部实现变化。
 */
import type { Connection, PermissionLevel, CardInstance, ConnectionMessage, MessageKind, SendGate } from '../types/index.js';
import type { ConnectionManager } from '../core/connection-manager.js';
import type { ConnectionEventBus } from '../core/event-bus.js';
import type { CardHost, CardTemplateInfo } from '../card-host/loader.js';
import type { DSHAdapter, KnownSession } from './dsh-adapter.js';
import type { SessionBridge } from './session-bridge.js';
export type { KnownSession, CardTemplateInfo };
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
    /** 可用卡片模板（含在当前连接上已装载的数量）。 */
    listCardTemplates(connectionId?: string): CardTemplateInfo[];
    /** 渲染卡片面板 HTML（宿主侧跑 renderPanel/mountPanel，取回 HTML）。 */
    renderCardPanel(instanceId: string): Promise<string | null>;
    /** 待确认的权限升级请求（面板据此显示「待确认 + 同意/拒绝」）。 */
    listPendingUpgrades(connectionId?: string): {
        id: string;
        connectionId: string;
        direction: 'aToB' | 'bToA';
        from: PermissionLevel;
        to: PermissionLevel;
        acceptedCount: number;
        requiredAccepts: number;
    }[];
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
    listMessages(connectionId: string, options?: {
        since?: number;
        limit?: number;
    }): ConnectionMessage[];
    sendMessage(connectionId: string, from: 'a' | 'b', kind: MessageKind, text: string, options?: {
        replyTo?: string;
    }): SendGate & {
        message?: ConnectionMessage;
    };
    /** 清空某条连接的交流记录（连接本身不动）。 */
    clearMessages(connectionId: string): {
        ok: boolean;
        removed: number;
    };
    /** 会话桥能力探测。 */
    relayCapabilities(): {
        observe: boolean;
        deliver: boolean;
        via: string[];
        notes: string[];
    };
    /** 直接往某个会话投递文本（目标必须有 live agent）。 */
    deliverToSession(sessionId: string, text: string, wake?: boolean): Promise<{
        ok: boolean;
        via?: string;
        reason?: string;
    }>;
    /** 读取某会话最近的消息（诊断用）。 */
    readSessionRecent(sessionId: string, limit?: number): {
        role: string;
        text: string;
    }[];
}
export declare function createStableApi(manager: ConnectionManager, eventBus: ConnectionEventBus, cardHost?: CardHost, adapter?: DSHAdapter, bridge?: SessionBridge): ConnectionCardHostService;
