import type { Context } from '@deepseek-ai/cordis';
type ClientContext = Context & {
    slots: {
        inject(slotName: string, factory: () => any): void;
        register(spec: {
            name: string;
            id: string;
            order?: number;
        }, componentFactory: () => any): any;
    };
};
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
