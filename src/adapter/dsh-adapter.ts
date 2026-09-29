/**
 * DSHAdapter — 所有 DSH 交互的中间层。
 * 卡片永远不直接调用 DSH；DSH 升级时只改此文件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { checkVersion, type VersionCheckResult } from './version-guard.js'
import { safeCtxGet, safeCtxMethod } from '../safe-ctx.js'

export interface SessionStatus {
  id: string
  title: string
  status: string
  updatedAt: number
}

export interface SessionLogEntry {
  timestamp: number
  role: string
  content: string
}

export interface PresetStatus {
  presetId: string
  healthy: boolean
  errors: string[]
}

export interface RepairResult {
  success: boolean
  message: string
}

/** 列表用的会话摘要（面板里的会话选择器）。 */
export interface KnownSession {
  id: string
  title: string
  updatedAt: number
}

type SessionEventHandler = (sessionId: string, event: string, data: unknown) => void

export class DSHAdapter {
  private ctx: Context
  private versionResult: VersionCheckResult | null = null
  private whitelistCheck?: (connectionId: string, method: string) => boolean
  private auditLog?: (msg: string) => void

  constructor(ctx: Context, options?: {
    whitelistCheck?: (connectionId: string, method: string) => boolean
    auditLog?: (msg: string) => void
  }) {
    this.ctx = ctx
    this.whitelistCheck = options?.whitelistCheck
    this.auditLog = options?.auditLog
  }

  /**
   * 启动时调用，检查 DSH 版本兼容性。
   *
   * ⚠️ 不要在 cordis 上下文上直接读未声明的服务：Context 是 Proxy，
   * 读未 inject 的属性会抛 `cannot get property "x" without inject`。
   * 一律经 safeCtxGet。
   */
  init(): VersionCheckResult {
    this.versionResult = checkVersion(this.detectVersion())
    if (!this.versionResult.supported) {
      console.warn(
        `[DSHAdapter] DSH version ${this.versionResult.current} not in supported range ${this.versionResult.range}. Running in degraded mode.`,
      )
    }
    return this.versionResult
  }

  /** 尽力探测 DSH 版本；拿不到就返回 undefined（守卫会 fail-open）。 */
  private detectVersion(): string | undefined {
    const fromDsh = safeCtxGet<{ version?: unknown }>(this.ctx, 'dsh')?.version
    if (typeof fromDsh === 'string' && fromDsh) return fromDsh

    const fromLoader = safeCtxGet<{ version?: unknown }>(this.ctx, 'loader')?.version
    if (typeof fromLoader === 'string' && fromLoader) return fromLoader

    return undefined
  }

  getVersionCheck(): VersionCheckResult {
    return this.versionResult ?? this.init()
  }

  /**
   * 列出宿主当前已知的会话（面板的会话选择器用）。
   *
   * 走宿主 `ctx.sessions.list()`（其目录里确有该方法）。
   * Session 的字段形状未在我们的依赖里声明，因此**逐字段防御式提取**，
   * 拿不到标题就退回 id —— 绝不因为字段名猜错而整体失败。
   */
  listSessions(): KnownSession[] {
    const sessions = safeCtxGet<{ list?(): unknown[] }>(this.ctx, 'sessions')
    if (!sessions?.list) return []

    let raw: unknown[]
    try {
      const result = sessions.list()
      if (!Array.isArray(result)) return []
      raw = result
    } catch (e) {
      console.error('[DSHAdapter] listSessions failed:', e)
      return []
    }

    const pickString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.length > 0 ? value : undefined

    return raw
      .map((entry): KnownSession | null => {
        const s = entry as Record<string, unknown> | null
        if (!s || typeof s !== 'object') return null

        const id =
          pickString(s.id) ??
          pickString(s.sessionId) ??
          pickString((s.header as Record<string, unknown> | undefined)?.id)
        if (!id) return null

        const header = s.header as Record<string, unknown> | undefined
        const meta = s.meta as Record<string, unknown> | undefined
        const title =
          pickString(s.title) ??
          pickString(header?.title) ??
          pickString(meta?.title) ??
          ''

        const updatedAtRaw =
          s.updatedAt ?? s.lastActiveAt ?? header?.updatedAt ?? s.createdAt
        const updatedAt = typeof updatedAtRaw === 'number' ? updatedAtRaw : 0

        return { id, title, updatedAt }
      })
      .filter((s): s is KnownSession => s !== null)
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    try {
      const sessions = safeCtxGet<{
        get?(id: string): Promise<{ title?: string; status?: string; updatedAt?: number } | undefined>
      }>(this.ctx, 'sessions')
      if (sessions?.get) {
        const s = await sessions.get(sessionId)
        if (s) return { id: sessionId, title: s.title ?? '', status: s.status ?? 'unknown', updatedAt: s.updatedAt ?? 0 }
      }
    } catch (e) {
      console.error('[DSHAdapter] getSessionStatus failed:', e)
    }
    return { id: sessionId, title: '', status: 'unknown', updatedAt: 0 }
  }

  async getSessionLog(_sessionId: string): Promise<SessionLogEntry[]> {
    // TODO: 对接 DSH session log API
    return []
  }

  async getPresetStatus(_sessionId: string): Promise<PresetStatus> {
    // TODO: 对接 DSH preset status API
    return { presetId: '', healthy: true, errors: [] }
  }

  /**
   * requestRemote — 在对端会话执行操作（安全白名单机制）。
   * 超时 30s，不自动重试，白名单外方法拒绝，全部审计日志。
   */
  async requestRemote(
    sessionId: string,
    method: string,
    params: unknown,
    connectionId?: string,
  ): Promise<unknown> {
    // 白名单校验（如果提供了 connectionId 和白名单检查函数）
    if (connectionId && this.whitelistCheck) {
      if (!this.whitelistCheck(connectionId, method)) {
        this.auditLog?.(`requestRemote 拒绝（白名单外）: ${connectionId}.${method}`)
        return { error: 'whitelist_violation', message: `方法 ${method} 不在白名单中` }
      }
    }

    const timeoutMs = 30_000
    this.auditLog?.(`requestRemote 调用: ${sessionId}.${method}`)
    try {
      const remote = safeCtxGet<{
        call?(sid: string, m: string, p: unknown): Promise<unknown>
      }>(this.ctx, 'remote')
      if (remote?.call) {
        const result = await Promise.race([
          remote.call(sessionId, method, params),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeoutMs),
          ),
        ])
        this.auditLog?.(`requestRemote 成功: ${sessionId}.${method}`)
        return result
      }
    } catch (e) {
      if ((e as Error).message === 'timeout') {
        this.auditLog?.(`requestRemote 超时: ${sessionId}.${method}`)
        return { error: 'timeout' }
      }
      this.auditLog?.(`requestRemote 失败: ${sessionId}.${method} ${String(e)}`)
      console.error(`[DSHAdapter] requestRemote failed for ${sessionId}.${method}:`, e)
    }
    // 走到这里 = 宿主没有 remote 通道。必须记日志，否则调用方只看到"没反应"
    this.auditLog?.(
      `requestRemote 无通道（宿主无 ctx.remote）: ${sessionId}.${method} → not_available`,
    )
    return { error: 'not_available' }
  }

  async repairPreset(_sessionId: string): Promise<RepairResult> {
    // TODO: 对接 dsh-plugin-gating-hub 或内置修复逻辑
    return { success: false, message: 'repair not implemented' }
  }

  onSessionEvent(handler: SessionEventHandler): () => void {
    // ctx.on 是 cordis 事件总线混入的真实方法；仍用 safeCtxMethod 兜底。
    const on = safeCtxMethod<(event: string, cb: (data: { sessionId?: string; event?: string; payload?: unknown }) => void) => unknown>(
      this.ctx,
      'on',
    )
    if (!on) return () => {}
    try {
      const off = on('session/event', (data) => {
        if (data?.sessionId && data?.event) {
          handler(data.sessionId, data.event, data.payload)
        }
      })
      return typeof off === 'function' ? (off as () => void) : () => {}
    } catch (e) {
      console.warn('[DSHAdapter] onSessionEvent 订阅失败:', e)
      return () => {}
    }
  }
}
