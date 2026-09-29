/**
 * 卡片注册表 — 模板/实例的查找与登记。
 * 模板是分发单位（tarball 解压后按 templateId 索引），实例是运行时单位。
 */
import type { CardInstance, CardManifest } from '../types/index.js';
export interface CardTemplate {
    templateId: string;
    version: string;
    dir: string;
    manifest: CardManifest;
}
export interface CardModule {
    apply?: (api: unknown) => void;
    mountPanel?: (element: HTMLElement, api: unknown) => void;
}
export declare class CardRegistry {
    private templates;
    private instances;
    private modules;
    registerTemplate(template: CardTemplate): void;
    getTemplate(templateId: string): CardTemplate | undefined;
    listTemplates(): CardTemplate[];
    registerInstance(instance: CardInstance): void;
    getInstance(instanceId: string): CardInstance | undefined;
    removeInstance(instanceId: string): void;
    listInstancesByConnection(connectionId: string): CardInstance[];
    /** 缓存动态 import 的卡片模块（templateId → apply/mountPanel）。 */
    setModule(templateId: string, mod: CardModule): void;
    getModule(templateId: string): CardModule | undefined;
    removeModule(templateId: string): void;
}
