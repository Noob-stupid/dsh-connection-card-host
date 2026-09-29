/**
 * 卡片注册表 — 模板/实例的查找与登记。
 * 模板是分发单位（tarball 解压后按 templateId 索引），实例是运行时单位。
 */
import type { CardInstance, CardManifest } from '../types/index.js'

export interface CardTemplate {
  templateId: string
  version: string
  dir: string          // 解压目录（绝对路径）
  manifest: CardManifest
}

export interface CardModule {
  apply?: (api: unknown) => void
  mountPanel?: (element: HTMLElement, api: unknown) => void
}

export class CardRegistry {
  private templates = new Map<string, CardTemplate>()
  private instances = new Map<string, CardInstance>()
  private modules = new Map<string, CardModule>()

  registerTemplate(template: CardTemplate): void {
    this.templates.set(template.templateId, template)
  }

  getTemplate(templateId: string): CardTemplate | undefined {
    return this.templates.get(templateId)
  }

  listTemplates(): CardTemplate[] {
    return Array.from(this.templates.values())
  }

  registerInstance(instance: CardInstance): void {
    this.instances.set(instance.instanceId, instance)
  }

  getInstance(instanceId: string): CardInstance | undefined {
    return this.instances.get(instanceId)
  }

  removeInstance(instanceId: string): void {
    this.instances.delete(instanceId)
  }

  listInstancesByConnection(connectionId: string): CardInstance[] {
    return Array.from(this.instances.values()).filter(
      (i) => i.connectionId === connectionId,
    )
  }

  /** 缓存动态 import 的卡片模块（templateId → apply/mountPanel）。 */
  setModule(templateId: string, mod: CardModule): void {
    this.modules.set(templateId, mod)
  }

  getModule(templateId: string): CardModule | undefined {
    return this.modules.get(templateId)
  }

  removeModule(templateId: string): void {
    this.modules.delete(templateId)
  }
}