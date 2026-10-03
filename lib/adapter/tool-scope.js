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
/** 桥接工具的统一前缀。 */
export const BRIDGE_PREFIX = 'card_';
/**
 * 卡片 id → 可用在工具名里的片段。
 *
 * 模型看到的工具名要稳定、可读；只保留字母数字与下划线，
 * 其余（`@`、`/`、`.`、`-`）一律换成下划线。
 */
export function sanitizeCardId(cardId) {
    return cardId.replace(/[^A-Za-z0-9_]/g, '_');
}
/** 桥接后的工具名：`card_<cardId>_<tool>`。 */
export function bridgedToolName(cardId, toolName) {
    return `${BRIDGE_PREFIX}${sanitizeCardId(cardId)}_${toolName}`;
}
/**
 * 这个工具名是不是本适配层桥接出来的。
 *
 * ⚠️ 只用于**诊断与列举**，不要用于权限判断 —— 权限一律走
 * `decideBridgedVisibility`（名字可以被伪造，可见性判定不能）。
 */
export function isBridgedToolName(name) {
    return name.startsWith(BRIDGE_PREFIX);
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
export function decideBridgedVisibility(scope, connection, sessionId) {
    if (!sessionId) {
        return {
            visible: false,
            side: null,
            reason: '认不出调用方是哪个会话（下发时缺 session scope，调用时缺 exec.agent）',
        };
    }
    const side = sessionId === connection.sessionA ? 'a' : sessionId === connection.sessionB ? 'b' : null;
    if (!side) {
        return {
            visible: false,
            side: null,
            reason: `会话 ${sessionId} 不在这条连接里`,
        };
    }
    const effective = scope ?? 'both';
    if (effective === 'both') {
        return { visible: true, side, reason: '卡片对两端可见' };
    }
    if (effective === side) {
        return { visible: true, side, reason: `卡片只对 ${effective.toUpperCase()} 端可见，调用方正是该端` };
    }
    return {
        visible: false,
        side,
        reason: `这张卡片只对 ${effective.toUpperCase()} 端可见，` +
            `而调用方在这条连接的 ${side.toUpperCase()} 端`,
    };
}
//# sourceMappingURL=tool-scope.js.map