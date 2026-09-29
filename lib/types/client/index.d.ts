import type { Context } from '@deepseek-ai/cordis';
type ClientContext = Context & {
    slots: {
        inject(slotName: string, callback: () => unknown): void;
        register(spec: {
            name: string;
            /** list 槽位的单元键 */
            id?: string;
            /** keyed 槽位的键（main 用） */
            key?: string;
            order?: number;
            label?: string | (() => string);
        }, componentFactory: (props?: unknown) => unknown): unknown;
    };
};
/** 需要 slots 注入 UI，connection 提供宿主 RPC，sessions 提供会话身份。 */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
