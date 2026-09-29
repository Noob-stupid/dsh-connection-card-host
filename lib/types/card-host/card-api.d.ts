/**
 * CardAPI 实现 — 卡片运行时获得的受限接口。
 * 卡片只通过此 API 与宿主交互，不 import 任何 @deepseek-ai/* 包。
 */
import type { CardAPI, CardInstance } from '../types/index.js';
import type { ConnectionEventBus } from '../core/event-bus.js';
import type { DSHAdapter } from '../adapter/dsh-adapter.js';
export interface CardApiDeps {
    instance: CardInstance;
    eventBus: ConnectionEventBus;
    adapter: DSHAdapter;
}
/**
 * 构造一个绑定到特定卡片实例 + 连接的 CardAPI。
 * - on/emit 走连接事件总线（命名空间 conn:<connectionId>:<event>）
 * - requestRemote 走 DSHAdapter 白名单（30s 超时，不自动重试）
 * - registerTool 注册对端可调用的工具
 * - mountUI 渲染卡片 UI
 */
export declare function createCardApi(deps: CardApiDeps): CardAPI;
