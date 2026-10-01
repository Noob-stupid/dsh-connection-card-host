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

  /**
   * 只在「已安装」来源里清空模板，内置的保留。
   *
   * 用于重扫前剔除**已经消失**的卡片（卸载、目录被手工删掉）。
   * 不做这件事的话，scanTemplates 只增不减 —— 卸载掉的卡片会一直挂在
   * 列表里直到宿主重启，用户点了会得到一个"模板未找到"。
   *
   * 只清 installed：内置卡片随插件发布，不可能"在磁盘上消失"，
   * 清掉再重扫纯属浪费（而且内置根目录万一临时读不到就全没了）。
   */
  clearInstalledTemplates(): void {
    for (const [id, t] of [...this.templates]) {
      if (t.source === 'installed') {
        this.templates.delete(id)
        // 模块缓存也要清，否则重装同名卡片会命中旧代码
        this.modules.delete(id)
      }
    }
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

  /** 某个模板当前装载在哪些连接上（更新卡片后要逐个重载）。 */
  listInstancesByTemplate(templateId: string): CardInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.templateId === templateId)
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