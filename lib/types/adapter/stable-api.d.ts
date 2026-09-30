/**
 * Stable API — 对外暴露的稳定接口层。
 * 浏览器端和卡片通过此接口与宿主交互，隔离内部实现变化。
 */
import type { Connection, PermissionLevel, CardInstance, ConnectionMessage, MessageKind, SendGate, CardScope } from '../types/index.js';
import type { ConnectionManager } from '../core/connection-manager.js';
import type { ConnectionEventBus } from '../core/event-bus.js';
import type { CardHost, CardTemplateInfo } from '../card-host/loader.js';
import type { DSHAdapter, KnownSession } from './dsh-adapter.js';
import type { SessionBridge } from './session-bridge.js';
import type { WorkState, WorkStateTracker } from '../core/work-state.js';
import type { AddResult, Convention, ConventionBox } from '../core/box.js';
import { type InstallResult } from '../card-host/installer.js';
export type { KnownSession, CardTemplateInfo, WorkState, Convention, AddResult, InstallResult };
/** 协作感知两层的依赖（由 index.ts 装配后注入）。 */
export interface AwarenessDeps {
    workState: WorkStateTracker;
    box: ConventionBox;
}
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
    loadCard(templateId: string, connectionId: string, scope?: CardScope): Promise<CardInstance>;
    unloadCard(instanceId: string): Promise<void>;
    reloadCard(instanceId: string): Promise<void>;
    /** 改已装载卡片的可见范围（两端 / 仅 A / 仅 B）。返回 false = 模板钉死了或实例不存在。 */
    setCardScope(instanceId: string, scope: CardScope): boolean;
    /** 可用卡片模板（含在当前连接上已装载的数量）。 */
    listCardTemplates(connectionId?: string): CardTemplateInfo[];
    /** 渲染卡片面板 HTML（宿主侧跑 renderPanel/mountPanel，取回 HTML）。 */
    renderCardPanel(instanceId: string): Promise<string | null>;
    /**
     * 安装一张卡片。spec 支持：本地目录 / 本地 tgz / npm 包名 / HTTP tgz 地址。
     * 装到 `$DSH_HOME/connection-cards/cards/<id>/`，不跑 pnpm、不动 profile。
     */
    installCard(spec: string): Promise<InstallResult>;
    /** 卸载一张已安装的卡片（只删我们目录下的）。 */
    uninstallCard(cardId: string): {
        ok: boolean;
        reason?: string;
    };
    /** 已安装卡片的根目录（面板显示给用户看，让"装到哪儿了"是透明的）。 */
    cardsRoot(): string;
    /**
     * 中继运行诊断（**可查询，不靠翻日志**）。
     *
     * 目前暴露"被挡下的非真人来源计数"。存在的理由：日志会被清空/滚动，
     * 只写一次的信号一旦滚掉就永久消失；放进可查询的状态面才可靠 ——
     * 这也顺带补上"状态靠翻日志猜"这个协作感知缺口。
     */
    relayDiagnostics(): {
        skipped: {
            sessionId: string;
            kind: string;
            count: number;
            lastSeenAt: number;
            lastDropped: string;
        }[];
        total: number;
    };
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
    /** 某会话当前在干什么（采集自工具事件）。未采集到时返回 null。 */
    peerWork(sessionId: string, label: string): string | null;
    /** 某会话的工作状态原始快照（面板用）。 */
    workSnapshot(sessionId: string): WorkState | undefined;
    /** 本连接两端的工作状态对照文本。 */
    connectionWork(connectionId: string): {
        a: WorkState | undefined;
        b: WorkState | undefined;
    };
    listConventions(connectionId: string, includeSuperseded?: boolean): Convention[];
    searchConventions(connectionId: string, keyword: string): Convention[];
    /** 声明一条约定。supersedes 用于取代旧约定（保留追溯）。 */
    declareConvention(connectionId: string, by: 'a' | 'b' | 'user', topic: string, text: string, supersedes?: string): AddResult;
    removeConvention(connectionId: string, id: string): boolean;
    /** 渲染公约盒文本（给模型看）。aLabel/bLabel 必须按连接自己的端点定义传。 */
    renderConventions(connectionId: string, aLabel: string, bLabel: string): string;
    /** 会话桥能力探测。 */
    relayCapabilities(): {
        observe: boolean;
        deliver: boolean;
        via: string[];
        notes: string[];
    };
    /** 直接往某个会话投递文本（目标必须有 live agent）。 */
    deliverToSession(sessionId: string, text: string, wake?: boolean, form?: 'mirror' | 'handoff'): Promise<{
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
export declare function createStableApi(manager: ConnectionManager, eventBus: ConnectionEventBus, cardHost?: CardHost, adapter?: DSHAdapter, bridge?: SessionBridge, awareness?: AwarenessDeps, auditLog?: (msg: string) => void): ConnectionCardHostService;
