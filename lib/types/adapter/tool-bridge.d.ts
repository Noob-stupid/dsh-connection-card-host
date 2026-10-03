/**
 * 工具桥接层 —— 把**挂载进来的插件工具**接到 DSH 的工具面上，并限定可见范围。
 *
 * ## 三件事
 *
 * 1. **注册**：捕获到的工具以 `card_<cardId>_<tool>` 注册进 DSH 工具服务（补充④防撞名）
 * 2. **下发时过滤**：`system-prompt/assemble` 里把"这个会话看不见"的桥接工具摘掉
 * 3. **调用时校验**：工具自己的 `execute` 再校验一次（护栏③：**只藏不校验是不够的**）
 *
 * 2 与 3 共用 `tool-scope.ts` 的同一个纯函数 —— 两份判定迟早分叉，
 * 而分叉的表现是"藏了但能调"或"能调却报不可见"，两种都极难查。
 *
 * ## ⚠️ 注册份数：**一个工具名注册一次**，实例用「绑定」表达（D2 裁决）
 *
 * 第一版写成了"每个卡片实例注册一次"，结果**同一插件挂到两条连接上直接撞名** ——
 * 由离线测试抓到（DSH 的注册表对同名会抛 `already registered`）。
 * 正确形态是按 D2：
 *
 *     card_<cardId>_<tool>            ← 全局**只注册一份**
 *       └─ bindings: [ {instanceId, connectionId, scope}, … ]   ← 每挂一处加一条
 *
 * 调用时按**调用者会话**在 bindings 里解析出该用哪个实例（`resolveBinding`）。
 * 这样注册表不会随连接数膨胀，也不会撞名。
 *
 * ## 调用被拒时**返回文字而不是抛异常**
 *
 * 照 `awareness-tools.ts` 的既有做法（那里写明：工具不该把异常抛回模型 ——
 * 那会让整个回合以 error 结束）。被拒是一次**正常结果**，把原因说清楚即可。
 *
 * ## 过滤的 fail-open 取向
 *
 * 拿不准时**保留**工具（与 `tool-scoping.ts` 同取向）。理由：调用时校验才是真正的闸门，
 * 过滤只是省 token 与避免误导；而误删一个该有的工具，用户看到的是"能力凭空消失"。
 */
import type { CardScope } from '../types/index.js';
import type { ToolDefinition } from './facade.js';
import type { MountedPlugin } from './mount.js';
/** 桥接层需要的宿主能力（依赖注入，便于离线测试）。 */
export interface BridgeDeps {
    /** DSH 的工具注册表：注册一个定义，返回注销函数。 */
    registerTool: (definition: unknown) => () => void;
    /** 按 id 取连接（拿两端会话 id 用）。 */
    getConnection: (connectionId: string) => {
        sessionA: string;
        sessionB: string;
    } | undefined;
    /** 审计。 */
    audit: (message: string) => void;
}
/** 一个工具名下的一个实例绑定。 */
export interface ToolBinding {
    cardId: string;
    instanceId: string;
    connectionId: string;
    scope: CardScope | undefined;
    /** 该实例的工具实现（每个挂载各有自己的状态）。 */
    definition: ToolDefinition;
    pluginId: string;
}
/** 一个桥接工具（全局唯一名字 + 若干实例绑定）。 */
export interface BridgeTool {
    cardId: string;
    bridgedName: string;
    originalName: string;
    bindings: ToolBinding[];
    /** 登记过的注销函数。 */
    unregister: () => void;
}
/** 从 exec 里取调用者会话 id（与 awareness-tools 一致：`exec.agent.id`）。 */
export declare function callerSessionId(exec: unknown): string | null;
/** 桥接层。 */
export declare class ToolBridge {
    private deps;
    /** 工具名 → 桥接工具（**全局一份**）。 */
    private byName;
    /** 实例 id → 它参与了哪些工具名（卸载时按实例收口）。 */
    private namesByInstance;
    constructor(deps: BridgeDeps);
    /** 当前全部桥接工具。 */
    tools(): BridgeTool[];
    /** 全部绑定（拍平，便于计数与诊断）。 */
    bindings(): ToolBinding[];
    /**
     * 把一次挂载捕获到的工具接到 DSH 工具面上。
     *
     * 同一 `cardId` 的重复挂载**不会重复注册** —— 只往已有工具的 `bindings` 里加一条。
     *
     * @returns 本次涉及的桥接工具（无工具时为 `[]`）
     */
    add(mounted: MountedPlugin, target: {
        cardId: string;
        instanceId: string;
        connectionId: string;
        scope?: CardScope;
    }): BridgeTool[];
    /**
     * 卸载一张卡片实例：摘掉它的绑定；某个工具**没有绑定剩下**时才真正注销。
     *
     * @returns 注销的工具数
     */
    remove(instanceId: string): number;
    /**
     * 按调用者解析该用哪条绑定（**D2 的动态解析**）。
     *
     * @returns 命中的绑定；`null` 时 `reason` 说明为什么都不能用
     */
    resolveBinding(tool: BridgeTool, sessionId: string | null): {
        binding: ToolBinding;
        reason: string;
    } | {
        binding: null;
        reason: string;
    };
    /**
     * 某个会话**看得见**的桥接工具名（供 `system-prompt/assemble` 过滤）。
     *
     * 与调用时校验共用 `decideBridgedVisibility`。
     */
    visibleToolNamesForSession(sessionId: string | null): Set<string>;
    /** 已知的桥接工具名（过滤时"只动自己的工具"）。 */
    knownToolNames(): Set<string>;
    /** 诊断摘要。 */
    describe(): string;
    /** 包一层：名字/描述换成桥接版，`execute` 里做调用时校验与实例解析。 */
    private makeBridgedDefinition;
}
/**
 * 下发时过滤：把该会话看不见的**桥接**工具从装配体里摘掉。
 *
 * ⚠️ 只动**自己知道的**桥接工具 —— 别人的工具一个都不碰。
 * 认不出会话时**保留**（fail-open，见文件头取向），并记审计。
 */
export declare function filterBridgedTools(assembly: {
    tools?: {
        name?: string;
    }[];
    [k: string]: unknown;
}, sessionId: string | null, bridge: ToolBridge, audit: (message: string) => void): {
    assembly: typeof assembly;
    removed: number;
};
