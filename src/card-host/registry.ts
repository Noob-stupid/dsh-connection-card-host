/**
 * 卡片注册表 — 模板/实例的查找与登记。
 * 模板是分发单位（tarball 解压后按 templateId 索引），实例是运行时单位。
 */
import type { CardInstance, CardManifest } from '../types/index.js'

export interface CardTemplate {
  templateId: string
  version: string
  dir: string          // 解压目录（绝对路径）
  /** 入口模块（package.json 的 main，缺省 dist/index.js）。 */
  entry: string
  /** 来源：随插件发布 / 用户安装。 */
  source: 'builtin' | 'installed'
  manifest: CardManifest
}

export interface CardModule {
  apply?: (api: unknown) => void
  /**
   * 面板渲染。宿主侧调用（卡片模块跑在宿主进程里），
   * `element` 是宿主提供的 DOM 替身，只取 innerHTML 结果。
   */
  mountPanel?: (element: unknown, api: unknown) => void
  /** 纯字符串面板（优先于 mountPanel；对宿主更友好，不需要 DOM 替身）。 */
  renderPanel?: (api: unknown) => string
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