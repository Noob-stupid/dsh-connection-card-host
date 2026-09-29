import type { Context } from '@deepseek-ai/cordis';
type ClientContext = Context & {
    slots: {
        inject(slotName: string, callback: () => unknown): void;
        register(spec: {
            name: string;
            id: string;
            order?: number;
        }, componentFactory: () => unknown): unknown;
    };
};
/** 需要 slots 注入 UI，需要 connection 提供宿主 RPC 通道。 */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
