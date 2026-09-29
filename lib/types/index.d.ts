import type { Context } from '@deepseek-ai/cordis';
import { type ConnectionCardHostService } from './adapter/stable-api.js';
export declare const name = "connection-card-host";
/**
 * 不声明必需依赖：核心能力（连接管理/持久化/卡片宿主）独立于 connection 服务，
 * 只有 RPC 桥需要它。用 ctx.inject() 延迟注册，避免 connection 缺席时整个插件不加载。
 */
export declare const inject: string[];
/**
 * 对外提供的服务名。必须在此声明，否则 `ctx.provide()` 会抛
 * `cannot set property "x" without provide`。
 */
export declare const provide: string[];
type HostContext = Context & {
    connectionCardHost?: ConnectionCardHostService;
};
export declare function apply(ctx: HostContext, _config?: Record<string, unknown>): void;
export {};
