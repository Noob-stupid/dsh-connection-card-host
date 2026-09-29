/**
 * 浏览器半的宿主客户端 —— 通过 DSH 的 Connection RPC 通道调用宿主服务。
 *
 * 这是浏览器访问宿主的唯一途径：`ctx.connection.rpc.call(channel, endpoint, payload)`。
 * 每个方法返回 Promise，失败时抛 Error（而不是静默返 null）。
 */
import type { Connection, CardInstance, PermissionLevel } from '../types/index.js';
import { type RpcResult } from '../types/rpc.js';
/** 浏览器半收到的 Connection 视图（与宿主类型同构）。 */
export type RemoteConnection = Connection;
export type RemoteCardInstance = CardInstance;
export interface WhitelistEntryView {
    method: string;
    description: string;
    approvedBy: string[];
}
/** 会话摘要（面板的会话选择器）。 */
export interface KnownSessionView {
    id: string;
    title: string;
    updatedAt: number;
}
/** 可用卡片模板（面板的卡片装载区）。 */
export interface CardTemplateView {
    templateId: string;
    name: string;
    version: string;
    source: 'builtin' | 'installed';
    requires: {
        read: string[];
        write: string[];
    };
    events: string[];
    hasPanel: boolean;
    loadedCount: number;
}
export interface ConnectionCardHostClient {
    health(): Promise<{
        ready: boolean;
        connections: number;
    }>;
    listConnections(): Promise<RemoteConnection[]>;
    connectionsBySession(sessionId: string): Promise<RemoteConnection[]>;
    createConnection(sessionA: string, sessionB: string): Promise<RemoteConnection>;
    disconnect(id: string): Promise<void>;
    updatePermission(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): Promise<void>;
    requestPermissionUpgrade(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): Promise<string | null>;
    acceptPermissionUpgrade(requestId: string, acceptorId: string): Promise<boolean>;
    rejectPermissionUpgrade(requestId: string, rejectorId: string): Promise<void>;
    loadCard(templateId: string, connectionId: string): Promise<RemoteCardInstance>;
    unloadCard(instanceId: string): Promise<void>;
    reloadCard(instanceId: string): Promise<void>;
    listCardTemplates(connectionId?: string): Promise<CardTemplateView[]>;
    renderCardPanel(instanceId: string): Promise<string | null>;
    listWhitelistedMethods(connectionId: string): Promise<WhitelistEntryView[]>;
    listSessions(): Promise<KnownSessionView[]>;
    /** 诊断上报（浏览器里读不到 console，只能借 RPC 落盘）。 */
    report(message: string): void;
}
/** RPC 调用器的形状（取自 ctx.connection.rpc）。 */
export interface RpcCaller {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>>;
}
/** 从 cordis 上下文中取 ctx.connection.rpc；不可用时返回 null。 */
export declare function resolveRpcCaller(ctx: unknown): RpcCaller | null;
/**
 * 用 RPC 调用器构造宿主客户端。
 * @param rpc - ctx.connection.rpc
 */
export declare function createHostClient(rpc: RpcCaller): ConnectionCardHostClient;
