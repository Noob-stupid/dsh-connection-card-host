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
}
export declare function createCardApi(deps: CardApiDeps): CardAPI;
