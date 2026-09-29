import type { PermissionLevel } from './permission.js';
export interface CardInstance {
    instanceId: string;
    templateId: string;
    connectionId: string;
    config: Record<string, unknown>;
    state: Record<string, unknown>;
    permissions: PermissionLevel;
    priority: number;
    enabled: boolean;
}
export interface CardManifest {
    id: string;
    name: string;
    requires: {
        read: string[];
        write: string[];
    };
    events: string[];
    ui?: {
        icon?: string;
        panel?: string;
    };
}
/**
 * CardAPI — 卡片在运行时获得的受限接口。
 * 卡片代码绝不 import @deepseek-ai/* ，只通过此 API 与宿主交互。
 */
export interface CardAPI {
    on(event: string, handler: (data: unknown) => void): () => void;
    emit(event: string, data: unknown): void;
    registerTool(name: string, fn: (params: unknown) => Promise<unknown>): void;
    mountUI(element: HTMLElement): void;
    requestRemote(method: string, params: unknown): Promise<unknown>;
    log(...args: unknown[]): void;
}
