import type { CardInstance, CardAPI } from '../types/index.js';
import type { ConnectionManager } from '../core/connection-manager.js';
import type { ConnectionEventBus } from '../core/event-bus.js';
import type { DSHAdapter } from '../adapter/dsh-adapter.js';
export interface CardHostOptions {
    /** 内置卡片根目录（随插件包发布，位于 cards/） */
    builtinRoot?: string;
    /** 卡片专用目录（$DSH_HOME/connection-cards/<card-id>/plugins/） */
    cardHomeRoot?: string;
}
export declare class CardHost {
    private registry;
    private manager;
    private eventBus;
    private adapter;
    private options;
    /** instanceId → CardAPI（供 reload/unload 释放） */
    private apiByInstance;
    constructor(manager: ConnectionManager, eventBus: ConnectionEventBus, adapter: DSHAdapter, options?: CardHostOptions);
    /**
     * 在目标连接上加载一张卡片实例。
     * @param templateId 卡片模板 id
     * @param connectionId 目标连接 id
     */
    loadCard(templateId: string, connectionId: string): Promise<CardInstance>;
    unloadCard(instanceId: string): Promise<void>;
    reloadCard(instanceId: string): Promise<void>;
    getCardApi(instanceId: string): CardAPI | undefined;
    /**
     * 加载内置模板（cards/<card-id>/ 目录）。
     * 从 package.json 读取 dshCard 字段作为 manifest。
     */
    private resolveBuiltinTemplate;
    private tryRegisterTemplate;
    /** 手动注册内置模板目录（供宿主启动时扫描内置卡片） */
    registerBuiltinTemplate(templateId: string, cardDir: string): boolean;
}
