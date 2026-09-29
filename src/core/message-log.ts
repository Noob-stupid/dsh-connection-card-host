/**
 * ConnectionMessageLog — 连接两端之间的规范交流记录。
 *
 * 这是「双方开启可读写后能规范交流配合」的底座：
 *   - 追加即广播（两端订阅同一连接的 eventBus 都能收到）
 *   - 发送前过权限闸门（见 gateSend）
 *   - 有界（每条连接保留最近 N 条），随连接持久化
 *
 * 设计取舍：消息是**连接级**的，不属于某一个会话。
 * 谁"感知"到取决于谁在听：卡片订阅连接事件，会话则通过工具（见 tools 层）。
 */
import { randomUUID } from 'node:crypto'
import type { ConnectionMessage, MessageKind } from '../types/index.js'
import type { ConnectionEventBus } from './event-bus.js'
import type { Connection } from '../types/index.js'
import { permValue } from '../types/permission.js'

/** 每条连接保留的消息上限（超出丢弃最旧的）。 */
const MAX_MESSAGES_PER_CONNECTION = 200
/** 单条消息长度上限（防止把日志刷爆）。 */
const MAX_TEXT_LENGTH = 4000
/** 同一条连接的最小发送间隔（ms），抑制刷屏。 */
const MIN_SEND_INTERVAL_MS = 200

export interface SendResult {
  ok: boolean
  reason?: string
  message?: ConnectionMessage
}

/** 哪些 kind 需要写权限。read 只能观察，连 say 都不该发。 */
const WRITE_REQUIRED: Record<MessageKind, boolean> = {
  // 发言：需要"建议"级别（能表达但不能要求执行）
  say: false,
  // 请求/回复：需要写权限（对方可能据此执行动作）
  ask: true,
  reply: true,
  // 系统消息由宿主自己发，不走这个闸门
  system: true,
}

export class ConnectionMessageLog {
  private messages = new Map<string, ConnectionMessage[]>()
  private lastSendAt = new Map<string, number>()
  private eventBus: ConnectionEventBus
  private auditLog: (msg: string) => void

  constructor(eventBus: ConnectionEventBus, auditLog?: (msg: string) => void) {
    this.eventBus = eventBus
    this.auditLog = auditLog ?? (() => {})
  }

  /**
   * 发送前的准入判定。
   *
   * 规则（"规范交流"）：
   *   1. 连接必须存在且未断开
   *   2. `say` 需要发送方向权限 ≥ suggest；`ask`/`reply` 需要 = write
   *   3. 文本非空且不超长
   *   4. 同一连接两次发送之间有最小间隔（抑制刷屏）
   *
   * @param conn 目标连接
   * @param from 发送端
   * @param kind 消息类型
   * @param text 文本
   */
  gateSend(conn: Connection | undefined, from: 'a' | 'b', kind: MessageKind, text: string): { ok: boolean; reason?: string } {
    if (!conn) return { ok: false, reason: '连接不存在' }
    if (conn.status === 'broken') return { ok: false, reason: '连接已断开' }

    const trimmed = text.trim()
    if (trimmed.length === 0) return { ok: false, reason: '消息内容为空' }
    if (trimmed.length > MAX_TEXT_LENGTH) {
      return { ok: false, reason: `消息过长（上限 ${MAX_TEXT_LENGTH} 字）` }
    }

    // 发送方向：a 发给 b 用 aToB，b 发给 a 用 bToA
    const direction = from === 'a' ? 'aToB' : 'bToA'
    const level = permValue(conn.permission[direction])
    const needWrite = WRITE_REQUIRED[kind]

    if (needWrite) {
      if (level < permValue('write')) {
        return {
          ok: false,
          reason: `发送「${kind}」需要写权限（当前 ${conn.permission[direction]}）`,
        }
      }
    } else if (level < permValue('suggest')) {
      return {
        ok: false,
        reason: `发送消息需要至少「可建议」权限（当前 ${conn.permission[direction]}）`,
      }
    }

    const last = this.lastSendAt.get(conn.id) ?? 0
    const now = Date.now()
    if (now - last < MIN_SEND_INTERVAL_MS) {
      return { ok: false, reason: '发送过于频繁' }
    }

    return { ok: true }
  }

  /**
   * 追加一条消息并广播。
   * 调用方应先用 gateSend 判定；这里再判一次以防漏网。
   */
  append(
    conn: Connection | undefined,
    from: 'a' | 'b',
    kind: MessageKind,
    text: string,
    options: { replyTo?: string; bypassGate?: boolean } = {},
  ): SendResult {
    if (!options.bypassGate) {
      const gate = this.gateSend(conn, from, kind, text)
      if (!gate.ok) {
        this.auditLog(`消息被拒（${gate.reason}）: ${conn?.id ?? '?'} ${from} ${kind}`)
        return gate
      }
    }
    if (!conn) return { ok: false, reason: '连接不存在' }

    const message: ConnectionMessage = {
      id: randomUUID(),
      connectionId: conn.id,
      from,
      kind,
      text: text.trim().slice(0, MAX_TEXT_LENGTH),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      createdAt: Date.now(),
    }

    const list = this.messages.get(conn.id) ?? []
    list.push(message)
    if (list.length > MAX_MESSAGES_PER_CONNECTION) {
      list.splice(0, list.length - MAX_MESSAGES_PER_CONNECTION)
    }
    this.messages.set(conn.id, list)
    this.lastSendAt.set(conn.id, message.createdAt)

    this.auditLog(`消息 ${conn.id} ${from}→${kind}: ${message.text.slice(0, 80)}`)

    // 广播给两端：卡片 / 工具层都靠这个事件
    this.eventBus.emit(conn.id, 'message', message)
    return { ok: true, message }
  }

  /** 读取消息（默认全部，可按时间过滤）。 */
  list(connectionId: string, options: { since?: number; limit?: number } = {}): ConnectionMessage[] {
    let list = this.messages.get(connectionId) ?? []
    if (typeof options.since === 'number') {
      list = list.filter((m) => m.createdAt > options.since!)
    }
    if (typeof options.limit === 'number' && options.limit > 0) {
      list = list.slice(-options.limit)
    }
    return list
  }

  /** 装配/恢复时灌入历史。 */
  hydrate(connectionId: string, messages: ConnectionMessage[]): void {
    this.messages.set(
      connectionId,
      messages.slice(-MAX_MESSAGES_PER_CONNECTION),
    )
  }

  /** 取某连接的全部消息（用于持久化）。 */
  dump(connectionId: string): ConnectionMessage[] {
    return this.messages.get(connectionId) ?? []
  }

  clear(connectionId: string): void {
    this.messages.delete(connectionId)
    this.lastSendAt.delete(connectionId)
  }
}
