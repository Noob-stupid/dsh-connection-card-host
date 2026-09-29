/**
 * CardHost — 卡片宿主。
 * 从 tarball 下载/解压 → 读取 manifest → 受限 import → apply(api) → 实例登记。
 * 阶段 2：内置卡片（cards/ 目录）+ 本地方便加载路径；npm registry/URL 下载为后续扩展。
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CardInstance, CardManifest, CardAPI } from '../types/index.js'
import type { ConnectionManager } from '../core/connection-manager.js'
import type { ConnectionEventBus } from '../core/event-bus.js'
import type { DSHAdapter } from '../adapter/dsh-adapter.js'
import { CardRegistry, type CardTemplate } from './registry.js'
import { importCardModule, resolveCardEntry } from './sandbox.js'
import { createCardApi } from './card-api.js'

export interface CardHostOptions {
  /** 内置卡片根目录（随插件包发布，位于 cards/） */
  builtinRoot?: string
  /** 卡片专用目录（$DSH_HOME/connection-cards/<card-id>/plugins/） */
  cardHomeRoot?: string
}

export class CardHost {
  private registry = new CardRegistry()
  private manager: ConnectionManager
  private eventBus: ConnectionEventBus
  private adapter: DSHAdapter
  private options: CardHostOptions
  /** instanceId → CardAPI（供 reload/unload 释放） */
  private apiByInstance = new Map<string, CardAPI>()

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
   * 在目标连接上加载一张卡片实例。
   * @param templateId 卡片模板 id
   * @param connectionId 目标连接 id
   */
  async loadCard(
    templateId: string,
    connectionId: string,
  ): Promise<CardInstance> {
    const conn = this.manager.getById(connectionId)
    if (!conn) throw new Error(`连接不存在: ${connectionId}`)

    // 1. 确保模板已注册（内置 / 本地目录）
    let template = this.registry.getTemplate(templateId)
    if (!template) {
      template = await this.resolveBuiltinTemplate(templateId)
    }
    if (!template) throw new Error(`卡片模板未找到: ${templateId}`)

    // 2. 导入卡片模块（含崩溃隔离）
    const entry = resolveCardEntry(template.dir, template.manifest.ui?.panel)
    const mod = await importCardModule(entry)
    this.registry.setModule(templateId, mod)

    // 3. 创建实例
    const now = Date.now()
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

    // 4. 挂到连接上
    if (!conn.cards.some((c) => c.instanceId === instance.instanceId)) {
      conn.cards.push(instance)
      conn.updatedAt = now
    }

    // 5. 构造 CardAPI 并调用卡片 apply(api)
    const api = createCardApi({
      instance,
      eventBus: this.eventBus,
      adapter: this.adapter,
    })
    this.apiByInstance.set(instance.instanceId, api)
    try {
      mod.apply?.(api)
    } catch (e) {
      // 卡片 apply 崩溃隔离
      console.error(`[CardHost] 卡片 ${templateId} apply 失败:`, e)
    }

    return instance
  }

  async unloadCard(instanceId: string): Promise<void> {
    const instance = this.registry.getInstance(instanceId)
    if (instance) {
      // 从连接上移除
      const conn = this.manager.getById(instance.connectionId)
      if (conn) {
        conn.cards = conn.cards.filter((c) => c.instanceId !== instanceId)
      }
      this.registry.removeInstance(instanceId)
      this.apiByInstance.delete(instanceId)
    }
  }

  async reloadCard(instanceId: string): Promise<void> {
    const instance = this.registry.getInstance(instanceId)
    if (!instance) return
    const templateId = instance.templateId
    const connectionId = instance.connectionId
    // 清模块缓存重新 import（热重载）
    this.registry.removeModule(templateId)
    await this.unloadCard(instanceId)
    await this.loadCard(templateId, connectionId)
  }

  getCardApi(instanceId: string): CardAPI | undefined {
    return this.apiByInstance.get(instanceId)
  }

  /**
   * 加载内置模板（cards/<card-id>/ 目录）。
   * 从 package.json 读取 dshCard 字段作为 manifest。
   */
  private async resolveBuiltinTemplate(
    templateId: string,
  ): Promise<CardTemplate | undefined> {
    const roots = [
      this.options.builtinRoot,
      join(process.env.DSH_CHECKOUT || '.', '..'),
    ].filter(Boolean) as string[]

    // 候选目录：随插件包发布的 cards/ 目录
    const pluginRoot = this.options.cardHomeRoot
      ? dirname(dirname(this.options.cardHomeRoot))
      : undefined

    // 直接扫描 cards/ 子目录（内置卡片）
    const candidates = [this.options.builtinRoot]
    // 插件自身目录下的 cards/
    try {
      const selfDir = new URL('../../../', import.meta.url)
      candidates.push(join(selfDir.pathname.replace(/^\//, ''), 'cards', templateId))
    } catch { /* ignore */ }

    for (const root of roots) {
      if (!root || !existsSync(root)) continue
      const cardDir = join(root, templateId)
      if (this.tryRegisterTemplate(templateId, cardDir)) {
        return this.registry.getTemplate(templateId)
      }
    }
    return undefined
  }

  private tryRegisterTemplate(
    templateId: string,
    cardDir: string,
  ): boolean {
    try {
      const pkgPath = join(cardDir, 'package.json')
      if (!existsSync(pkgPath)) return false
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const manifest = pkg.dshCard as CardManifest | undefined
      if (!manifest) return false
      this.registry.registerTemplate({
        templateId: manifest.id || templateId,
        version: pkg.version || '0.0.0',
        dir: cardDir,
        manifest,
      })
      return true
    } catch {
      return false
    }
  }

  /** 手动注册内置模板目录（供宿主启动时扫描内置卡片） */
  registerBuiltinTemplate(templateId: string, cardDir: string): boolean {
    return this.tryRegisterTemplate(templateId, cardDir)
  }
}