/**
 * CardHost — 卡片宿主。
 *
 * 对照 docs/card-protocol.md 实现：
 *   - 模板发现：内置（随插件发布的 cards/）+ 已安装（$DSH_HOME/connection-cards/cards/）
 *   - 一键加到连接：loadCard(templateId, connectionId)
 *   - 面板渲染：renderPanel(api) 优先；否则用 DOM 替身调 mountPanel 取 innerHTML
 *   - 启动重放：已持久化在连接上的卡片重新 import + apply
 *
 * 卡片模块跑在**宿主进程**（Node），浏览器只拿渲染好的 HTML —— 因为卡片的
 * apply 要订阅事件、注册工具，这些都在宿主侧；而 mountPanel 需要 DOM，
 * 宿主没有 DOM，所以给一个只支持 innerHTML 的替身。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { CardInstance, CardManifest, CardAPI } from '../types/index.js'
import type { ConnectionManager } from '../core/connection-manager.js'
import type { ConnectionEventBus } from '../core/event-bus.js'
import type { DSHAdapter } from '../adapter/dsh-adapter.js'
import { CardRegistry, type CardTemplate } from './registry.js'
import { importCardModule, resolveCardEntry } from './sandbox.js'
import { createCardApi } from './card-api.js'
import { createShimElement } from './dom-shim.js'

export interface CardHostOptions {
  /** 内置卡片根目录（随插件包发布的 cards/）。 */
  builtinRoot?: string
  /** 已安装卡片的根目录（$DSH_HOME/connection-cards/cards/）。 */
  installedRoot?: string
}

/** 面板里展示的模板摘要。 */
export interface CardTemplateInfo {
  templateId: string
  name: string
  version: string
  source: 'builtin' | 'installed'
  requires: { read: string[]; write: string[] }
  events: string[]
  /** 是否提供面板 UI。 */
  hasPanel: boolean
  /** 已加到当前连接的实例数（由调用方填充）。 */
  loadedCount: number
}

export class CardHost {
  private registry = new CardRegistry()
  private manager: ConnectionManager
  private eventBus: ConnectionEventBus
  private adapter: DSHAdapter
  private options: CardHostOptions
  /** instanceId → CardAPI。 */
  private apiByInstance = new Map<string, CardAPI>()
  private scanned = false

  constructor(
    manager: ConnectionManager,
    eventBus: ConnectionEventBus,
    adapter: DSHAdapter,
    options: CardHostOptions = {},
  ) {
    this.manager = manager
    this.eventBus = eventBus
    this.adapter = adapter
    this.options = options
  }

  /**
   * 默认根目录：内置取本包同级 `cards/`；已安装取 `$DSH_HOME/connection-cards/cards/`。
   * `lib/card-host/loader.js` → 上溯两级到包根。
   */
  private builtinRoot(): string {
    if (this.options.builtinRoot) return this.options.builtinRoot
    try {
      const here = fileURLToPath(import.meta.url)
      return join(here, '..', '..', '..', 'cards')
    } catch {
      return 'cards'
    }
  }

  private installedRoot(): string {
    if (this.options.installedRoot) return this.options.installedRoot
    return join(process.cwd(), 'cards')
  }

  /** 扫描两个根目录下的卡片包（幂等）。 */
  scanTemplates(force = false): void {
    if (this.scanned && !force) return
    this.scanned = true
    this.scanRoot(this.builtinRoot(), 'builtin')
    this.scanRoot(this.installedRoot(), 'installed')
  }

  private scanRoot(root: string, source: 'builtin' | 'installed'): void {
    if (!existsSync(root)) return
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      return
    }
    for (const name of entries) {
      this.registerTemplateDir(join(root, name), source, name)
    }
  }

  /** 读一个卡片目录的 package.json → 注册模板。 */
  private registerTemplateDir(
    dir: string,
    source: 'builtin' | 'installed',
    fallbackId: string,
  ): boolean {
    try {
      const pkgPath = join(dir, 'package.json')
      if (!existsSync(pkgPath)) return false
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        version?: string
        main?: string
        dshCard?: CardManifest
      }
      const manifest = pkg.dshCard
      if (!manifest) return false

      const templateId = manifest.id || fallbackId
      const template: CardTemplate = {
        templateId,
        version: pkg.version ?? '0.0.0',
        dir,
        // 入口：package.json main 优先，其次 manifest.ui.panel，最后 dist/index.js
        entry: resolveCardEntry(dir, pkg.main ?? manifest.ui?.panel),
        source,
        manifest,
      }
      this.registry.registerTemplate(template)
      return true
    } catch {
      // 坏掉的卡片包不应该拖垮扫描
      return false
    }
  }

  /** 可用模板清单（含在当前连接上已装载的数量）。 */
  listTemplates(connectionId?: string): CardTemplateInfo[] {
    this.scanTemplates()
    const conn = connectionId ? this.manager.getById(connectionId) : undefined

    return this.registry.listTemplates().map((t) => {
      const req = t.manifest.requires
      return {
        templateId: t.templateId,
        name: t.manifest.name || t.templateId,
        version: t.version,
        source: t.source,
        requires: {
          read: Array.isArray(req?.read) ? req.read : [],
          write: Array.isArray(req?.write) ? req.write : [],
        },
        events: Array.isArray(t.manifest.events) ? t.manifest.events : [],
        hasPanel: Boolean(t.manifest.ui?.panel) || true,
        loadedCount: conn
          ? conn.cards.filter((c) => c.templateId === t.templateId).length
          : 0,
      }
    })
  }

  /**
   * 在目标连接上装载一张卡片。
   * @param templateId 卡片模板 id
   * @param connectionId 目标连接 id
   */
  async loadCard(templateId: string, connectionId: string): Promise<CardInstance> {
    const conn = this.manager.getById(connectionId)
    if (!conn) throw new Error(`连接不存在: ${connectionId}`)

    this.scanTemplates()
    const template = this.registry.getTemplate(templateId)
    if (!template) throw new Error(`卡片模板未找到: ${templateId}`)

    // 导入卡片模块（含崩溃隔离）
    const mod = await importCardModule(template.entry)
    this.registry.setModule(templateId, mod)

    const instance: CardInstance = {
      instanceId: randomUUID(),
      templateId,
      connectionId,
      config: {},
      state: {},
      permissions: 'read',
      priority: 100,
      enabled: true,
    }
    this.registry.registerInstance(instance)
    conn.cards.push(instance)
    conn.updatedAt = Date.now()

    const api = createCardApi({
      instance,
      eventBus: this.eventBus,
      adapter: this.adapter,
    })
    this.apiByInstance.set(instance.instanceId, api)

    try {
      mod.apply?.(api)
    } catch (e) {
      // 卡片 apply 崩溃隔离：不让卡片拖垮宿主
      console.error(`[CardHost] 卡片 ${templateId} apply 失败:`, e)
    }

    // 落盘（卡片挂在连接上，随连接持久化）
    this.manager.persistConnection(connectionId)
    return instance
  }

  async unloadCard(instanceId: string): Promise<void> {
    const instance = this.registry.getInstance(instanceId)
    if (!instance) return
    const conn = this.manager.getById(instance.connectionId)
    if (conn) {
      conn.cards = conn.cards.filter((c) => c.instanceId !== instanceId)
      conn.updatedAt = Date.now()
      this.manager.persistConnection(conn.id)
    }
    this.registry.removeInstance(instanceId)
    this.apiByInstance.delete(instanceId)
  }

  async reloadCard(instanceId: string): Promise<void> {
    const instance = this.registry.getInstance(instanceId)
    if (!instance) return
    const { templateId, connectionId } = instance
    this.registry.removeModule(templateId)
    await this.unloadCard(instanceId)
    await this.loadCard(templateId, connectionId)
  }

  getCardApi(instanceId: string): CardAPI | undefined {
    return this.apiByInstance.get(instanceId)
  }

  /**
   * 渲染卡片面板 HTML。
   *
   * 优先 `renderPanel(api)`（纯字符串，宿主友好）；
   * 否则给 `mountPanel` 一个只支持 innerHTML 的 DOM 替身，取回结果。
   *
   * @returns HTML 字符串；卡片没有面板或渲染失败时返回 null。
   */
  async renderCardPanel(instanceId: string): Promise<string | null> {
    const instance = this.registry.getInstance(instanceId)
    if (!instance) return null

    try {
      // 确保模块已加载（重启后首次渲染时会走这里）
      let mod = this.registry.getModule(instance.templateId)
      if (!mod) {
        this.scanTemplates()
        const template = this.registry.getTemplate(instance.templateId)
        if (!template) return null
        mod = await importCardModule(template.entry)
        this.registry.setModule(instance.templateId, mod)
      }

      const api = this.apiByInstance.get(instanceId)
      if (typeof mod.renderPanel === 'function') {
        const html = mod.renderPanel(api)
        return typeof html === 'string' ? html : null
      }
      if (typeof mod.mountPanel === 'function') {
        const shim = createShimElement()
        mod.mountPanel(shim, api)
        return shim.innerHTML || null
      }
      return null
    } catch (e) {
      console.error(`[CardHost] 渲染面板失败 ${instanceId}:`, e)
      return null
    }
  }

  /**
   * 启动重放：把已持久化在连接上的卡片重新 import + apply。
   *
   * 连接是从 connections.json 恢复的，卡片的 apply（订阅/注册工具）不会自动重跑，
   * 不重放的话重启后卡片就"哑"了。
   *
   * @returns 成功重放的卡片数
   */
  async restoreAll(): Promise<number> {
    this.scanTemplates()
    let restored = 0

    for (const conn of this.manager.getAll()) {
      for (const instance of conn.cards) {
        try {
          const template = this.registry.getTemplate(instance.templateId)
          if (!template) {
            console.warn(
              `[CardHost] 重放跳过：模板 ${instance.templateId} 不存在（连接 ${conn.id}）`,
            )
            continue
          }
          const mod = await importCardModule(template.entry)
          this.registry.setModule(instance.templateId, mod)

          this.registry.registerInstance(instance)
          const api = createCardApi({
            instance,
            eventBus: this.eventBus,
            adapter: this.adapter,
          })
          this.apiByInstance.set(instance.instanceId, api)
          mod.apply?.(api)
          restored++
        } catch (e) {
          console.error(`[CardHost] 重放卡片失败 ${instance.instanceId}:`, e)
        }
      }
    }
    return restored
  }
}
