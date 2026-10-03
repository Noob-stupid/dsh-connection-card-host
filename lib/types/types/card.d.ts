import type { PermissionLevel } from './permission.js';
/**
 * 卡片作用域 —— 卡片作用于连接的哪一端。
 *
 * 连接有 a / b 两端（对应两个会话）。
 *   - `both`：两端通用，双向事件都送达（默认）
 *   - `a` / `b`：只服务其中一端，只收该端方向的事件
 *
 * 用途：同一张卡片可能只想代表一方说话（例如"以 A 的身份向 B 提请求"），
 * 或者只观察某一端的状态。
 */
export type CardScope = 'both' | 'a' | 'b';
export interface CardInstance {
    instanceId: string;
    templateId: string;
    connectionId: string;
    /** 作用于哪一端。 */
    scope: CardScope;
    config: Record<string, unknown>;
    state: Record<string, unknown>;
    permissions: PermissionLevel;
    priority: number;
    enabled: boolean;
}
export interface CardManifest {
    id: string;
    name: string;
    requires: {
        read: string[];
        write: string[];
    };
    events: string[];
    /**
     * 模板允许的作用域。缺省 `both`。
     * 若为 `both`，装载时可由用户选 a / b / both；
     * 若为 `a` 或 `b`，则强制固定在该端（用户不可改）。
     */
    scope?: CardScope;
    ui?: {
        icon?: string;
        panel?: string;
    };
    /**
     * 卡片需要的 **CardAPI 版本**（缺省视为 1）。
     *
     * 这是**我们自己的兼容性护栏**，DSH 的版本门控管不到它 ——
     * 卡片不依赖任何 `@deepseek-ai/*`（协议禁止），所以 DSH 升级不影响卡片；
     * 但**我们改 `CardAPI` 就会影响卡片**。声明版本后宿主才能在装载时判断兼容性，
     * 而不是等卡片跑到某个分支才炸。
     *
     * 规则：**加东西不升版本，删或改语义才升**。
     */
    api?: number;
    /**
     * ⚠️ **适配卡**声明：这张"卡片"其实是一个**普通 DSH 插件包**，
     * 由适配层在受限作用域里挂载它（见 `docs/adapter-design.md`）。
     *
     * 有这一段的包与普通卡片**走同一套安装/候选/挂载流程**，
     * 但它不能直接 `apply`（它是给 DSH 全局设计的），必须先过适配层。
     *
     * ```jsonc
     * "dshCard": {
     *   "adapter": { "capabilities": ["tools", "effect"] }
     * }
     * ```
     *
     * `capabilities` 是**申报制**的清单：适配层只提供申报过的能力，
     * 访问未申报的能力会**当场抛错**（不静默放行、也不静默忽略）。
     */
    adapter?: {
        /** 申报需要的能力（合法值见 `src/adapter/capabilities.ts`）。 */
        capabilities?: string[];
        /** 该插件的入口（相对包根）；缺省用 package.json 的 main。 */
        entry?: string;
    };
}
/** 连接消息 —— 两端之间的规范交流记录。 */
export type MessageKind = 'say' | 'ask' | 'reply' | 'system';
export interface ConnectionMessage {
    id: string;
    connectionId: string;
    /** 从哪一端发出。 */
    from: 'a' | 'b';
    kind: MessageKind;
    text: string;
    /** 回复哪条消息。 */
    replyTo?: string;
    createdAt: number;
}
/**
 * 发送前的准入判定结果。
 * `ok: false` 时 `reason` 说明为什么不允许发。
 */
export interface SendGate {
    ok: boolean;
    reason?: string;
}
/**
 * CardAPI — 卡片在运行时获得的受限接口。
 * 卡片代码绝不 import @deepseek-ai/* ，只通过此 API 与宿主交互。
 */
export interface CardAPI {
    on(event: string, handler: (data: unknown) => void): () => void;
    emit(event: string, data: unknown): void;
    registerTool(name: string, fn: (params: unknown) => Promise<unknown>): void;
    mountUI(element: HTMLElement): void;
    requestRemote(method: string, params: unknown): Promise<unknown>;
    log(...args: unknown[]): void;
    /** 本卡片实例作用于哪一端（`both` 表示双向通用）。 */
    readonly scope: CardScope;
    /**
     * 以某一端的身份发一条连接消息。
     * `both` 作用域的卡片必须显式指定 from；单端卡片可省略（用自己那一端）。
     */
    send(kind: MessageKind, text: string, options?: {
        from?: 'a' | 'b';
        replyTo?: string;
    }): SendGate;
    /** 读取本连接的消息（默认只读新的）。 */
    read(options?: {
        since?: number;
        limit?: number;
    }): ConnectionMessage[];
    /**
     * **卡片代用户向对端投递一条消息**（走宿主既有的会话投递路径）。
     *
     * `urgency` 四档与宿主侧连接消息**同一套语义**：
     * `quiet` 只告知不唤醒 / `normal` 排队 / `urgent` 插话 / `preempt` 抢占插话。
     *
     * ⚠️ 两个 **fail-closed** 前提（未满足就**直接拒绝**，不静默、不降级）：
     *   · 卡片 manifest 的 `requires.write` 必须声明 `"send_message"`（**用户授权**，不是默认权利）
     *   · `scope` 为 `both` 时**无法判定该对哪一端说话** ⇒ 拒绝
     *
     * 不重试；失败以**结构化结果**返回，不抛异常。preempt 的既有约束
     * （默认关闭 / 需写权限 / 每连接 5 分钟 1 次 / 不满足自动退化为 urgent）由宿主自动生效 ——
     * 卡片侧不必也不应自己实现一套。
     */
    sendMessage(text: string, options?: {
        urgency?: 'quiet' | 'normal' | 'urgent' | 'preempt';
        kind?: 'say' | 'ask' | 'reply';
    }): Promise<{
        ok: boolean;
        via?: string;
        live?: boolean;
        /** 结构化失败码（**永久 vs 暂时**由 permanent 区分）—— 别去解析
    eason 文本。 */
        code?: 'not-authorized' | 'scope-ambiguous' | 'no-peer-session' | 'no-channel' | 'deliver-refused' | 'threw';
        /** 	rue ⇒ 重试也没用（如未授权 / scope=both）；alse/缺省 ⇒ 下次可再试。 */
        permanent?: boolean;
        reason?: string;
    }>;
}
