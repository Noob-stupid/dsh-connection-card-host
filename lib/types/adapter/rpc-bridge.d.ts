import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionCardHostService } from './stable-api.js';
export interface RpcBridgeOptions {
    /** 日志（缺省 console）。 */
    logger?: {
        info?(msg: string): void;
        warn?(msg: string): void;
    };
    /** 审计/诊断落盘（可选）。 */
    audit?(msg: string): void;
}
/**
 * 在 webServer 上注册 RPC 路由。
 *
 * 需要调用方 ctx 已注入 `webServer`；否则返回 undefined。
 *
 * @returns 注销函数；webServer 不可用时返回 undefined。
 */
export declare function registerRpcBridge(ctx: Context, service: ConnectionCardHostService, options?: RpcBridgeOptions): (() => void) | undefined;
