import type { Connection, PermissionLevel } from '../types/index.js';
import { Persistence } from './persistence.js';
import { ConnectionEventBus } from './event-bus.js';
import { PermissionUpgradeManager, RemoteMethodWhitelist } from './permission.js';
import { ConnectionMessageLog } from './message-log.js';
import type { ConventionBox } from './box.js';
type EventHandler = (conn: Connection) => void;
export declare class ConnectionManager {
    private connections;
    private persistence;
    private eventBus;
    private listeners;
    readonly upgradeManager: PermissionUpgradeManager;
    readonly whitelist: RemoteMethodWhitelist;
    /** 连接两端的规范交流记录（「交流配合」的底座）。 */
    readonly messages: ConnectionMessageLog;
    /** 公约盒（连接级共享约定）。由 index.ts 在构造后挂上并负责持久化。 */
    private box;
    /** 挂上公约盒，并把已持久化的约定载回来。 */
    attachBox(box: ConventionBox): void;
    /** 取公约盒（未挂上时返回 null，调用方需处理）。 */
    conventions(): ConventionBox | null;
    /** 把某连接的约定落盘。 */
    persistConventions(connectionId: string): void;
    constructor(persistence: Persistence, eventBus: ConnectionEventBus);
    /** 把某连接的交流记录落盘。 */
    persistMessages(connectionId: string): void;
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
    /**
     * 把某条连接的当前状态落盘。
     * 连接上的卡片增删不经过 create/updatePermission，需要显式调用。
     */
    persistConnection(id: string): void;
    updatePermission(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): void;
    disconnect(id: string): void;
    getBySession(sessionId: string): Connection[];
    getById(id: string): Connection | undefined;
    getAll(): Connection[];
    on(event: 'created' | 'updated' | 'disconnected', handler: EventHandler): () => void;
    private emit;
}
export {};
