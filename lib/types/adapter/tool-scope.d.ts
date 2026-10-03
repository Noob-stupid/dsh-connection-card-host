/**
 * 桥接工具的**命名**与**可见性判定**。
 *
 * ## 为什么两件事要在同一个文件里
 *
 * 可见性判定必须被**两处**使用，而且必须**完全一致**：
 *
 *   1. **下发时**：`system-prompt/assemble` 瀑布里，把不该看见的工具从装配体摘掉
 *   2. **调用时**：工具自己的 `execute` 里再校验一次
 *
 * 护栏③说得很清楚：**只藏不校验是不够的** —— 别的路径（其它插件、API、模型误触）
 * 仍可能调到它。而如果两处各写一份判定，它们迟早会分叉，
 * 分叉的表现是"藏了但能调"或"能调却报不可见"，两种都极难查。
 *
 * 所以判定**只有这一份**，两处都调它。
 *
 * ## 命名
 *
 * 全局工具注册表里撞名是真实风险（两张卡都可能注册 `search`），
 * 因此桥接工具一律带卡片前缀：`card_<cardId>_<tool>`（补充④）。
 * 前缀同时让"这个工具从哪来"在模型看到的名字里就能读出来。
 */
import type { CardScope } from '../types/index.js';
import type { Connection } from '../types/index.js';
/** 桥接工具的统一前缀。 */
export declare const BRIDGE_PREFIX = "card_";
/**
 * 卡片 id → 可用在工具名里的片段。
 *
 * 模型看到的工具名要稳定、可读；只保留字母数字与下划线，
 * 其余（`@`、`/`、`.`、`-`）一律换成下划线。
 */
export declare function sanitizeCardId(cardId: string): string;
/** 桥接后的工具名：`card_<cardId>_<tool>`。 */
export declare function bridgedToolName(cardId: string, toolName: string): string;
/**
 * 这个工具名是不是本适配层桥接出来的。
 *
 * ⚠️ 只用于**诊断与列举**，不要用于权限判断 —— 权限一律走
 * `decideBridgedVisibility`（名字可以被伪造，可见性判定不能）。
 */
export declare function isBridgedToolName(name: string): boolean;
/** 某个会话在连接里的位置。 */
export type SessionSide = 'a' | 'b';
/** 判定结果。 */
export interface VisibilityDecision {
    visible: boolean;
    /** 说清为什么 —— 调用被拒时这段文案要能直接回答"为什么"。 */
    reason: string;
    /** 该会话在这条连接的哪一端；不在这条连接里时为 null。 */
    side: SessionSide | null;
}
/**
 * 某会话是否该看见 / 能调用**这张卡片**桥接出来的工具。
 *
 * 规则（与卡片自身的可见性一致，不引入第二套语义）：
 *   · 会话不在这条连接里            → 不可见
 *   · scope = 'both'                → 两端都可见
 *   · scope = 'a' | 'b'             → 只有那一端可见
 *
 * @param scope 卡片的可见范围
 * @param connection 卡片所在的连接
 * @param sessionId 发起方（下发时 = 正在装配的会话；调用时 = `exec.agent` 的会话）
 */
export declare function decideBridgedVisibility(scope: CardScope | undefined, connection: Pick<Connection, 'sessionA' | 'sessionB'>, sessionId: string | null | undefined): VisibilityDecision;
