/**
 * 权限校验 + 升级协商。
 * 规格书第 11 节：
 * - 权限升级（低→高）需双方确认（双端同意才生效）
 * - requestRemote 白名单协商（连接建立时协商，白名单修改需双方确认）
 * - 所有 requestRemote 调用记录审计日志
 * - 防提权：白名单外方法拒绝；白名单修改需双方确认；全部审计日志
 */
import type { PermissionLevel } from '../types/permission.js';
import type { CardInstance, Connection } from '../types/index.js';
import type { ConnectionEventBus } from './event-bus.js';
/**
 * 检查卡片是否有权执行某操作。
 * read 取双向最高权限；write 仅看 aToB（发起方→对端方向）。
 */
export declare function canExecute(card: CardInstance, connection: Connection, action: 'read' | 'write'): boolean;
export type UpgradeStatus = 'pending' | 'accepted' | 'rejected' | 'expired';
export interface PermissionUpgradeRequest {
    id: string;
    connectionId: string;
    direction: 'aToB' | 'bToA';
    from: PermissionLevel;
    to: PermissionLevel;
    status: UpgradeStatus;
    createdAt: number;
    acceptedBy: Set<string>;
    requiredAccepts: number;
}
export declare class PermissionUpgradeManager {
    private pendingRequests;
    private eventBus;
    private auditLog;
    constructor(eventBus: ConnectionEventBus, auditLog?: (msg: string) => void);
    /**
     * 发起权限升级请求。
     * 低→高需要双方确认；高→低直接生效（无需确认）。
     */
    requestUpgrade(connectionId: string, direction: 'aToB' | 'bToA', from: PermissionLevel, to: PermissionLevel): PermissionUpgradeRequest;
    /**
     * 确认权限升级请求。
     * @returns true 表示已收到全部确认，升级可以生效
     */
    acceptUpgrade(requestId: string, acceptorId: string): boolean;
    /** 拒绝权限升级请求 */
    rejectUpgrade(requestId: string, rejectorId: string): void;
    /** 查询待决请求 */
    getPendingRequests(connectionId?: string): PermissionUpgradeRequest[];
}
export interface WhitelistEntry {
    method: string;
    description: string;
    addedAt: number;
    approvedBy: string[];
}
export declare class RemoteMethodWhitelist {
    private whitelist;
    private eventBus;
    private auditLog;
    constructor(eventBus: ConnectionEventBus, auditLog?: (msg: string) => void);
    /**
     * 协商白名单：连接建立时调用。
     * 对端声明可被调用的方法列表。
     */
    negotiate(connectionId: string, methods: {
        method: string;
        description: string;
    }[]): void;
    /** 检查方法是否在白名单中 */
    isAllowed(connectionId: string, method: string): boolean;
    /** 新增白名单方法（需双方确认，阶段 3 占位） */
    requestAdd(connectionId: string, method: string, description: string): void;
    /** 确认白名单新增 */
    confirmAdd(connectionId: string, method: string, description: string, approvedBy: string): void;
    /** 清除连接的白名单（断开时调用） */
    clearConnection(connectionId: string): void;
    /** 列出连接的白名单 */
    listMethods(connectionId: string): WhitelistEntry[];
}
