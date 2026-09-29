/**
 * dsh-connection-card-host — 宿主端入口。
 * 挂载连接管理器、事件总线、适配层，暴露 ctx.connectionCardHost 服务供浏览器端调用。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ConnectionCardHostService } from './adapter/stable-api.js';
export declare const name = "connection-card-host";
export declare const inject: string[];
type HostContext = Context & {
    connectionCardHost?: ConnectionCardHostService;
};
export declare function apply(ctx: HostContext, _config?: Record<string, unknown>): void;
export {};
