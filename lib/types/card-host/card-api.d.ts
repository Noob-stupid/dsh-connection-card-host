/**
 * CardAPI 实现 — 卡片运行时获得的受限接口。
 * 卡片只通过此 API 与宿主交互，不 import 任何 @deepseek-ai/* 包。
 *
 * 作用域（scope）语义：
 *   - `both`：卡片代表整条连接，双向事件都送达；`send` 必须显式指定 from
 *   - `a`/`b`：卡片只服务某一端，只收该端方向的事件；`send` 默认以该端发言
 *
 * 「只收该端方向的事件」怎么判定：连接事件是双向共享的，
 * 但消息类事件带 `from` 字段，据此可以过滤掉不属于自己那一端的。
 */
import type { CardAPI, CardInstance } from '../types/index.js';
import type { ConnectionEventBus } from '../core/event-bus.js';
import type { ConnectionMessageLog } from '../core/message-log.js';
import type { ConnectionManager } from '../core/connection-manager.js';
import type { DSHAdapter } from '../adapter/dsh-adapter.js';
export interface CardApiDeps {
    instance: CardInstance;
    eventBus: ConnectionEventBus;
    adapter: DSHAdapter;
    messageLog: ConnectionMessageLog;
    manager: ConnectionManager;
    /**
     * **这张卡片是否被用户授权"代我对外说话"**。
     *
     * ⚠️ **fail-closed**：`undefined` 或返回 false ⇒ `sendMessage` **直接拒绝**。
     * "卡片代用户对外说话"是**能力**，不是默认权利 —— 授权来自
     * manifest 的 `requires.write` 里声明 `send_message`（由装载器判定后注入）。
     */
    canSendMessage?: () => boolean;
    /**
     * 解析"这条连接上、这张卡片该说话的那一端"的 sessionId。
     *
     * `scope` 为 `'a'`/`'b'` 时是**对端**；`'both'` 时**无法判定** ⇒ 返回 undefined ⇒ 拒绝
     * （fail-closed：宁可不说，也不要对着错的一端说话）。
     */
    resolvePeerSession?: () => string | undefined;
    /**
     * **宿主既有的投递路径**（`session-bridge.deliver`）。
     *
     * ⚠️ 刻意**复用**它而不是另写一套 —— 于是 preempt 的那套约束
     * （默认关闭、需写权限、每连接 5 分钟 1 次、不满足自动退化为 urgent）**全部自动生效** ✓。
     * 晚绑定（桥接在 CardHost 之后创建）⇒ 用取值函数而不是直接传实例。
     */
    deliver?: (sessionId: string, text: string, urgency: 'quiet' | 'normal' | 'urgent' | 'preempt') => Promise<{
        ok: boolean;
        via?: string;
        live?: boolean;
        reason?: string;
    }>;
}
export declare function createCardApi(deps: CardApiDeps): CardAPI;
