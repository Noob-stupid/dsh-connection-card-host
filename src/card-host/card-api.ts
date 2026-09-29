/**
 * CardAPI 实现 — 卡片运行时获得的受限接口。
 * 卡片只通过此 API 与宿主交互，不 import 任何 @deepseek-ai/* 包。
 */
import type { CardAPI, CardInstance } from '../types/index.js'
import type { ConnectionEventBus } from '../core/event-bus.js'
import type { DSHAdapter } from '../adapter/dsh-adapter.js'

export interface CardApiDeps {
  instance: CardInstance
  eventBus: ConnectionEventBus
  adapter: DSHAdapter
}

/**
 * 构造一个绑定到特定卡片实例 + 连接的 CardAPI。
 * - on/emit 走连接事件总线（命名空间 conn:<connectionId>:<event>）
 * - requestRemote 走 DSHAdapter 白名单（30s 超时，不自动重试）
 * - registerTool 注册对端可调用的工具
 * - mountUI 渲染卡片 UI
 */
export function createCardApi(deps: CardApiDeps): CardAPI {
  const { instance, eventBus, adapter } = deps
  const connectionId = instance.connectionId
  const tools = new Map<string, (params: unknown) => Promise<unknown>>()

  const api: CardAPI = {
    on(event, handler) {
      return eventBus.subscribe(connectionId, event, handler)
    },
    emit(event, data) {
      eventBus.emit(connectionId, event, data)
    },
    registerTool(name, fn) {
      tools.set(name, fn)
    },
    mountUI(element) {
      // 浏览器端调用：标记挂载目标（由 client 侧 panel 渲染接管）
      // 这里仅做占位，真实挂载由 ConnectionPanel/CardStack 处理
      element.dataset.cardInstanceId = instance.instanceId
    },
    async requestRemote(method, params) {
      // 传入 connectionId 用于白名单校验
      // 实际对端 session 由 DSHAdapter 内部解析（阶段 3 占位：用 connectionId）
      return adapter.requestRemote(connectionId, method, params, connectionId)
    },
    log(...args) {
      console.log(`[card:${instance.templateId}]`, ...args)
    },
  }

  // 暴露工具表供宿主按白名单转发调用
  ;(api as CardAPI & { _tools: Map<string, (p: unknown) => Promise<unknown>> })._tools = tools

  return api
}