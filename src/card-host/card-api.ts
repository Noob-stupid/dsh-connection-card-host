/**
 * CardAPI 实现 — 卡片运行时获得的受限接口。
 * 卡片只通过此 API 与宿主交互，不 import 任何 @deepseek-ai/* 包。
 *
 * 作用域（scope）语义：
 *   - `both`：卡片代表整条连接，双向事件都送达；`send` 必须显式指定 from
 *   - `a`/`b`：卡片只服务某一端，只收该端方向的事件；`send` 默认以该端发言
 *
 * 「只收该端方向的事件」怎么判定：连接事件是双向共享的，
 * 但消息类事件带 `from` 字段，据此可以过滤掉不属于自己那一端的。
 */
import type {
  CardAPI,
  CardInstance,
  MessageKind,
  SendGate,
  ConnectionMessage,
} from '../types/index.js'
import type { ConnectionEventBus } from '../core/event-bus.js'
import type { ConnectionMessageLog } from '../core/message-log.js'
import type { ConnectionManager } from '../core/connection-manager.js'
import type { DSHAdapter } from '../adapter/dsh-adapter.js'

export interface CardApiDeps {
  instance: CardInstance
  eventBus: ConnectionEventBus
  adapter: DSHAdapter
  messageLog: ConnectionMessageLog
  manager: ConnectionManager
}

/** 判断一条事件是否应该送达某个作用域的卡片。 */
function reachesScope(scope: CardInstance['scope'], data: unknown): boolean {
  if (scope === 'both') return true
  const from = (data as { from?: unknown } | null | undefined)?.from
  // 没有 from 字段的事件（普通自定义事件）双向都送；
  // 有 from 的消息事件只送给对应端。
  if (from !== 'a' && from !== 'b') return true
  return from === scope
}

export function createCardApi(deps: CardApiDeps): CardAPI {
  const { instance, eventBus, adapter, messageLog, manager } = deps
  const connectionId = instance.connectionId
  const scope = instance.scope ?? 'both'
  const tools = new Map<string, (params: unknown) => Promise<unknown>>()

  const api: CardAPI = {
    scope,

    on(event, handler) {
      return eventBus.subscribe(connectionId, event, (data) => {
        if (!reachesScope(scope, data)) return
        handler(data)
      })
    },

    emit(event, data) {
      eventBus.emit(connectionId, event, data)
    },

    registerTool(name, fn) {
      tools.set(name, fn)
    },

    mountUI(element) {
      element.dataset.cardInstanceId = instance.instanceId
    },

    async requestRemote(method, params) {
      return adapter.requestRemote(connectionId, method, params, connectionId)
    },

    log(...args) {
      console.log(`[card:${instance.templateId}]`, ...args)
    },

    send(kind: MessageKind, text: string, options = {}): SendGate {
      // 单端卡片默认以自己那端发言；双向卡片必须显式指定
      const from = options.from ?? (scope === 'both' ? undefined : scope)
      if (from !== 'a' && from !== 'b') {
        return { ok: false, reason: '双向作用域的卡片必须显式指定 from（a 或 b）' }
      }

      const conn = manager.getById(connectionId)
      const result = messageLog.append(conn, from, kind, text, {
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      })
      if (result.ok) manager.persistMessages(connectionId)
      return result.ok ? { ok: true } : { ok: false, reason: result.reason }
    },

    read(options = {}): ConnectionMessage[] {
      return messageLog.list(connectionId, options)
    },
  }

  // 暴露工具表供宿主按白名单转发调用
  ;(api as CardAPI & { _tools: Map<string, (p: unknown) => Promise<unknown>> })._tools = tools

  return api
}
