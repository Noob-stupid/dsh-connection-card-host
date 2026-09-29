import type { Context } from '@deepseek-ai/cordis';
import { type ConnectionCardHostService } from './adapter/stable-api.js';
export declare const name = "connection-card-host";
/**
 * 必需依赖。
 *
 * ⚠️ cordis 的 Context 是 Proxy：**未在此声明的服务读不到**（读会抛，
 * safeCtxGet 会把它变成 undefined）。所以要用 ctx.agents / ctx.sessions /
 * ctx.tools 就必须在这里声明，否则能力探测会误报"不可用"。
 *
 * `agents` 与 `sessions` 两个版本都有；`sessionController` 仅 runtime 0.2+ 有，
 * 因此**不放进这个数组**（否则 checkout 上插件直接不加载），
 * 改用 ctx.inject(['sessionController'], ...) 作可选增强。
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
