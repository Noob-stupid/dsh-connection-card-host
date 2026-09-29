import type { Context } from '@deepseek-ai/cordis';
type ClientContext = Context & {
    slots: {
        inject(slotName: string, callback: () => unknown): void;
        register(spec: {
            name: string;
            /** list 槽位的单元键：用自己的 id 会追加在出厂控件旁，复用它则替换该单元 */
            id: string;
            order?: number;
            label?: string | (() => string);
        }, componentFactory: () => unknown): unknown;
    };
};
/** 需要 slots 注入 UI，需要 connection 提供宿主 RPC 通道。 */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
