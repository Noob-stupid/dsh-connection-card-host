import { permValue } from '../types/permission.js';
// ═══ 权限校验 ═══
/**
 * 检查卡片是否有权执行某操作。
 * read 取双向最高权限；write 仅看 aToB（发起方→对端方向）。
 */
export function canExecute(card, connection, action) {
    const required = permValue(card.permissions);
    if (action === 'read') {
        const current = Math.max(permValue(connection.permission.aToB), permValue(connection.permission.bToA));
        return current >= required;
    }
    // write: 只看 aToB 方向
    return permValue(connection.permission.aToB) >= required;
}
const UPGRADE_EXPIRE_MS = 60_000; // 60s 过期
export class PermissionUpgradeManager {
    pendingRequests = new Map();
    eventBus;
    auditLog;
    constructor(eventBus, auditLog) {
        this.eventBus = eventBus;
        this.auditLog = auditLog ?? ((msg) => console.log('[PermissionUpgrade]', msg));
    }
    /**
     * 发起权限升级请求。
     * 低→高需要双方确认；高→低直接生效（无需确认）。
     */
    requestUpgrade(connectionId, direction, from, to) {
        const id = `upgrade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // 高→低：直接生效，无需确认
        if (permValue(to) <= permValue(from)) {
            this.auditLog(`降级直接生效: ${connectionId} ${direction} ${from}→${to}`);
            return {
                id,
                connectionId,
                direction,
                from,
                to,
                status: 'accepted',
                createdAt: Date.now(),
                acceptedBy: new Set(['auto']),
                requiredAccepts: 0,
            };
        }
        // 低→高：需要双方确认
        const req = {
            id,
            connectionId,
            direction,
            from,
            to,
            status: 'pending',
            createdAt: Date.now(),
            acceptedBy: new Set(),
            requiredAccepts: 2,
        };
        this.pendingRequests.set(id, req);
        this.auditLog(`升级请求: ${connectionId} ${direction} ${from}→${to}（需双方确认）`);
        this.eventBus.emit(connectionId, 'permission_upgrade_requested', req);
        // 60s 后自动过期
        setTimeout(() => {
            if (this.pendingRequests.has(id) && this.pendingRequests.get(id).status === 'pending') {
                req.status = 'expired';
                this.pendingRequests.delete(id);
                this.auditLog(`升级请求过期: ${id}`);
                this.eventBus.emit(connectionId, 'permission_upgrade_expired', { id });
            }
        }, UPGRADE_EXPIRE_MS);
        return req;
    }
    /**
     * 确认权限升级请求。
     * @returns true 表示已收到全部确认，升级可以生效
     */
    acceptUpgrade(requestId, acceptorId) {
        const req = this.pendingRequests.get(requestId);
        if (!req || req.status !== 'pending')
            return false;
        req.acceptedBy.add(acceptorId);
        this.auditLog(`升级确认: ${requestId} by ${acceptorId}（${req.acceptedBy.size}/${req.requiredAccepts}）`);
        if (req.acceptedBy.size >= req.requiredAccepts) {
            req.status = 'accepted';
            this.pendingRequests.delete(requestId);
            this.eventBus.emit(req.connectionId, 'permission_upgrade_accepted', {
                id: req.id,
                direction: req.direction,
                from: req.from,
                to: req.to,
            });
            this.auditLog(`升级生效: ${req.connectionId} ${req.direction} ${req.from}→${req.to}`);
            return true;
        }
        return false;
    }
    /** 拒绝权限升级请求 */
    rejectUpgrade(requestId, rejectorId) {
        const req = this.pendingRequests.get(requestId);
        if (!req || req.status !== 'pending')
            return;
        req.status = 'rejected';
        this.pendingRequests.delete(requestId);
        this.eventBus.emit(req.connectionId, 'permission_upgrade_rejected', {
            id: req.id,
            rejectedBy: rejectorId,
        });
        this.auditLog(`升级拒绝: ${requestId} by ${rejectorId}`);
    }
    /** 查询待决请求 */
    getPendingRequests(connectionId) {
        const all = Array.from(this.pendingRequests.values());
        if (connectionId)
            return all.filter((r) => r.connectionId === connectionId);
        return all;
    }
}
export class RemoteMethodWhitelist {
    whitelist = new Map(); // connectionId → method → entry
    eventBus;
    auditLog;
    constructor(eventBus, auditLog) {
        this.eventBus = eventBus;
        this.auditLog = auditLog ?? ((msg) => console.log('[RemoteWhitelist]', msg));
    }
    /**
     * 协商白名单：连接建立时调用。
     * 对端声明可被调用的方法列表。
     */
    negotiate(connectionId, methods) {
        let connMap = this.whitelist.get(connectionId);
        if (!connMap) {
            connMap = new Map();
            this.whitelist.set(connectionId, connMap);
        }
        for (const m of methods) {
            connMap.set(m.method, {
                method: m.method,
                description: m.description,
                addedAt: Date.now(),
                approvedBy: ['init'],
            });
        }
        this.auditLog(`白名单协商: ${connectionId} +${methods.length} 方法`);
        this.eventBus.emit(connectionId, 'whitelist_negotiated', { methods: methods.map((m) => m.method) });
    }
    /** 检查方法是否在白名单中 */
    isAllowed(connectionId, method) {
        return this.whitelist.get(connectionId)?.has(method) ?? false;
    }
    /** 新增白名单方法（需双方确认，阶段 3 占位） */
    requestAdd(connectionId, method, description) {
        this.auditLog(`白名单新增请求: ${connectionId} +${method}（需双方确认）`);
        this.eventBus.emit(connectionId, 'whitelist_add_requested', { method, description });
    }
    /** 确认白名单新增 */
    confirmAdd(connectionId, method, description, approvedBy) {
        const connMap = this.whitelist.get(connectionId);
        if (!connMap)
            return;
        const existing = connMap.get(method);
        if (existing) {
            existing.approvedBy.push(approvedBy);
        }
        else {
            connMap.set(method, { method, description, addedAt: Date.now(), approvedBy: [approvedBy] });
        }
        this.auditLog(`白名单新增确认: ${connectionId} +${method} by ${approvedBy}`);
        this.eventBus.emit(connectionId, 'whitelist_added', { method });
    }
    /** 清除连接的白名单（断开时调用） */
    clearConnection(connectionId) {
        this.whitelist.delete(connectionId);
    }
    /** 列出连接的白名单 */
    listMethods(connectionId) {
        return Array.from(this.whitelist.get(connectionId)?.values() ?? []);
    }
}
//# sourceMappingURL=permission.js.map