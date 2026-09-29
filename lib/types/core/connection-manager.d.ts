import type { Connection, PermissionLevel } from '../types/index.js';
import { Persistence } from './persistence.js';
import { ConnectionEventBus } from './event-bus.js';
import { PermissionUpgradeManager, RemoteMethodWhitelist } from './permission.js';
type EventHandler = (conn: Connection) => void;
export declare class ConnectionManager {
    private connections;
    private persistence;
    private eventBus;
    private listeners;
    readonly upgradeManager: PermissionUpgradeManager;
    readonly whitelist: RemoteMethodWhitelist;
    constructor(persistence: Persistence, eventBus: ConnectionEventBus);
    /**
     * 创建连接。若同一对会话已存在连接，返回已有连接。
     * 默认权限 aToB = 'read', bToA = 'read'。
     */
    create(sessionA: string, sessionB: string): Connection;
    /**
     * 权限升级：低→高需双方确认；高→低直接生效。
     * 返回升级请求 id；accepted 后自动调用 updatePermission。
     */
    requestPermissionUpgrade(id: string, direction: 'aToB' | 'bToA', to: PermissionLevel): string | null;
    /** 确认权限升级请求 */
    acceptPermissionUpgrade(requestId: string, acceptorId: string): boolean;
    /** 拒绝权限升级请求 */
    rejectPermissionUpgrade(requestId: string, rejectorId: string): void;
    updatePermission(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): void;
    disconnect(id: string): void;
    getBySession(sessionId: string): Connection[];
    getById(id: string): Connection | undefined;
    getAll(): Connection[];
    on(event: 'created' | 'updated' | 'disconnected', handler: EventHandler): () => void;
    private emit;
}
export {};
