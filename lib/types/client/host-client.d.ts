/**
 * 浏览器半的宿主客户端 —— 通过 DSH 的 Connection RPC 通道调用宿主服务。
 *
 * 这是浏览器访问宿主的唯一途径：`ctx.connection.rpc.call(channel, endpoint, payload)`。
 * 每个方法返回 Promise，失败时抛 Error（而不是静默返 null）。
 */
import type { Connection, CardInstance, CardScope, PermissionLevel } from '../types/index.js';
import { type RpcResult } from '../types/rpc.js';
/** 浏览器半收到的 Connection 视图（与宿主类型同构）。 */
export type RemoteConnection = Connection;
/** 某个会话的工作状态（协作感知 A 层）。 */
export interface WorkView {
    sessionId: string;
    todos: {
        content: string;
        status: string;
    }[];
    files: string[];
    recentTools: string[];
    lastAction: string;
    turn: number;
    step: number;
    updatedAt: number;
    /** 宿主渲染好的摘要文本（面板直接用）。 */
    summary: string;
}
/** 安装结果（面板据此给回执）。 */
export interface InstallResultView {
    ok: boolean;
    cardId?: string;
    dir?: string;
    name?: string;
    version?: string;
    reason?: string;
}
/** 一条共享约定（协作感知 B 层）。 */ export interface ConventionView {
    id: string;
    /** 谁声明的：连接的端点，或 'user'（人从面板直接写进来的）。 */
    by: 'a' | 'b' | 'user';
    topic: string;
    text: string;
    createdAt: number;
    supersededBy?: string;
}
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
/** 待确认的权限升级请求。 */
export interface PendingUpgradeView {
    id: string;
    connectionId: string;
    direction: 'aToB' | 'bToA';
    from: PermissionLevel;
    to: PermissionLevel;
    acceptedCount: number;
    requiredAccepts: number;
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
    /** 模板自己钉死的可见范围（有则用户不可改）。 */
    scope?: CardScope;
    /**
     * 适配卡状态（**只在是适配卡时出现**）—— 候选列表据此加「适配」标注、
     * 未就绪时置灰并说明原因（用户裁决 D6）。
     */
    adapter?: {
        status: 'ready' | 'off' | 'unsupported';
        capabilities: string[];
        reason: string;
    };
    /**
     * **适格性**（用户点出的第三条判据轴：**星多 ≠ 适合当卡片**）。
     *
     * `global` 型（替换/接管整个侧栏那种）是为"**装到 App 上**"生的 ✗ ——
     * 挂到某条连接上既装不下、也会和 App 布局打架 ⇒ 候选列表**提前**标出来 ✓。
     *
     * ⚠️ 这里是**结构化字段的原样转述**（不在 UI 侧做判断）——
     * 判定只有一处（宿主 `suitability.ts`），避免"标注与实际行为脱节" ✓。
     * ⚠️ 也**不要**在 UI 里 import 宿主那个模块：它依赖 `node:fs` ✗（会污染浏览器包 ✓）。
     */
    suitability?: {
        scope: 'capability' | 'local' | 'global' | 'unclear';
        why: string;
        globalHits: string[];
    };
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
    loadCard(templateId: string, connectionId: string, scope?: CardScope): Promise<RemoteCardInstance>;
    unloadCard(instanceId: string): Promise<void>;
    reloadCard(instanceId: string): Promise<void>;
    /** 改已装载卡片的可见范围。返回 false = 模板钉死了范围或实例不存在。 */
    setCardScope(instanceId: string, scope: CardScope): Promise<{
        ok: boolean;
    }>;
    /** 安装一张卡片：本地目录 / 本地 tgz / npm 包名 / HTTP tgz 地址。 */
    installCard(spec: string): Promise<InstallResultView>;
    /** 卸载一张已安装的卡片（只删我们目录下的）。 */
    uninstallCard(cardId: string): Promise<{
        ok: boolean;
        reason?: string;
    }>;
    /** 已安装卡片的根目录（面板显示用）。 */
    /** 检查已安装卡片有没有更新（判断不了时带 reason，不谎报"已是最新"）。 */
    checkCardUpdate(cardId: string): Promise<{
        cardId: string;
        spec: string;
        kind: string;
        dirName: string;
        currentVersion?: string;
        latestVersion?: string;
        hasUpdate?: boolean;
        reason?: string;
    }>;
    /** 按记录的来源更新一张卡片（装载中也能更新，靠版本化目录）。 */
    updateCard(cardId: string): Promise<{
        ok: boolean;
        version?: string;
        reloaded?: number;
        dir?: string;
        reason?: string;
    }>;
    cardsRoot(): Promise<string>;
    /**
     * 中继运行诊断。**可查询，不靠翻日志** —— 日志会被清空/滚动，
     * 只写一次的信号一旦滚掉就永久消失。
     */
    relayDiagnostics(): Promise<{
        skipped: {
            sessionId: string;
            kind: string;
            count: number;
            lastSeenAt: number;
            lastDropped: string;
        }[];
        total: number;
        /** 中继是否真的在自动转发（面板警告条据此判断，不能看权限档位）。 */
        relayConfig: {
            relayAssistant: boolean;
            relayUser: boolean;
        };
    }>;
    listCardTemplates(connectionId?: string): Promise<CardTemplateView[]>;
    renderCardPanel(instanceId: string): Promise<string | null>;
    /** 读卡片的客户端制品（UI 捕获用）。 */
    readCardClientSource(instanceId: string): Promise<{
        ok: boolean;
        entry?: string;
        source?: string;
        reason?: string;
    }>;
    /** 待确认的权限升级请求。 */
    listPendingUpgrades(connectionId?: string): Promise<PendingUpgradeView[]>;
    /** 协商可远程调用的方法白名单。 */
    negotiateWhitelist(connectionId: string, methods: {
        method: string;
        description: string;
    }[]): Promise<number>;
    listWhitelistedMethods(connectionId: string): Promise<WhitelistEntryView[]>;
    listSessions(): Promise<KnownSessionView[]>;
    /** 某条连接两端各自在干什么（自动采集，只读）。 */
    connectionWork(connectionId: string): Promise<{
        a: WorkView | null;
        b: WorkView | null;
    }>;
    listConventions(connectionId: string, all?: boolean): Promise<ConventionView[]>;
    declareConvention(connectionId: string, by: 'a' | 'b' | 'user', topic: string, text: string): Promise<{
        ok: boolean;
        reason?: string;
    }>;
    removeConvention(connectionId: string, id: string): Promise<{
        ok: boolean;
    }>;
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
