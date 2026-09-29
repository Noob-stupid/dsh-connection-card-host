# 适配层 API（DSHAdapter）

## 职责

所有 DSH 扩展点调用集中在 `src/adapter/dsh-adapter.ts`。
DSH 升级时只改此文件；启动时检查版本，不支持则降级并提示。
卡片永远不直接调用 DSH。

## 接口

```ts
interface DSHAdapter {
  // 版本守卫
  init(): VersionCheckResult
  getVersionCheck(): VersionCheckResult

  // DSH 数据查询
  getSessionStatus(sessionId: string): Promise<SessionStatus>
  getSessionLog(sessionId: string): Promise<SessionLogEntry[]>
  getPresetStatus(sessionId: string): Promise<PresetStatus>

  // 安全远程执行
  requestRemote(
    sessionId: string,
    method: string,
    params: unknown,
    connectionId?: string,
  ): Promise<unknown>

  // 预设修复
  repairPreset(sessionId: string): Promise<RepairResult>

  // 会话事件订阅
  onSessionEvent(handler: (sessionId: string, event: string, data: unknown) => void): () => void
}
```

## 版本守卫

兼容范围：`>=0.1.1-rc.2 <0.2.0`（见 package.json `dshEngines.framework`）。
不在范围内时进入降级模式：连接 UI 正常显示，但 `requestRemote` / 事件订阅返回 `not_available`，面板顶部提示用户。

```ts
interface VersionCheckResult {
  supported: boolean
  current: string
  range: string  // '>=0.1.1-rc.2 <0.2.0'
}
```

## requestRemote 安全机制

```
卡片调用 api.requestRemote(method, params)
         │
         ▼
    ┌─ 白名单校验 ─┐
    │  在白名单？   │──否──▶ { error: 'whitelist_violation' }
    └──────┬──────┘
           │是
           ▼
    ┌─ 审计日志 ──┐
    │ 记录调用    │
    └──────┬─────┘
           │
           ▼
    ┌─ 远程执行 ──┐
    │ 30s 超时    │──超时──▶ { error: 'timeout' }
    │ 不自动重试  │
    └──────┬─────┘
           │成功
           ▼
    ┌─ 审计日志 ──┐
    │ 记录结果    │
    └──────┬─────┘
           │
           ▼
       返回结果
```

### 安全规则

1. **白名单**：对端声明可被调用的方法列表，连接建立时协商
2. **权限上下文**：对端执行用自身会话权限，不用连接权限
3. **超时**：默认 30s，超时返回 `{ error: 'timeout' }`，不自动重试
4. **防提权**：白名单外方法拒绝；白名单修改需双方确认；全部审计日志

## 白名单协商流程

```
连接建立
    │
    ▼
对端声明可被调用方法
    │
    ▼
whitelist.negotiate(connectionId, methods)
    │
    ▼
emit('whitelist_negotiated', { methods })
    │
    ▼
卡片可在白名单内调用 requestRemote
    │
    ▼
新增方法需双方确认
    requestAdd → emit('whitelist_add_requested')
    confirmAdd → emit('whitelist_added')
```

## 审计日志

所有 `requestRemote` 调用记录到 `$DSH_HOME/connection-cards/audit.log`：

```
[2026-09-29T07:20:00.000Z] requestRemote 调用: session-abc.repair_preset
[2026-09-29T07:20:01.234Z] requestRemote 成功: session-abc.repair_preset
[2026-09-29T07:20:05.000Z] requestRemote 拒绝（白名单外）: conn-xyz.delete_file
```

## Stable API（对外暴露）

浏览器端和卡片通过 `ctx.connectionCardHost` 获取的稳定接口：

```ts
interface ConnectionCardHostService {
  // 连接管理
  createConnection(sessionA: string, sessionB: string): Connection
  disconnect(id: string): void
  updatePermission(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): void
  requestPermissionUpgrade(id: string, direction: 'aToB' | 'bToA', level: PermissionLevel): string | null
  acceptPermissionUpgrade(requestId: string, acceptorId: string): boolean
  rejectPermissionUpgrade(requestId: string, rejectorId: string): void
  getConnectionsBySession(sessionId: string): Connection[]
  getConnectionById(id: string): Connection | undefined
  getAllConnections(): Connection[]

  // 事件订阅
  onConnectionEvent(event: 'created' | 'updated' | 'disconnected', handler: (conn: Connection) => void): () => void
  subscribeConnectionEvent(connectionId: string, event: string, handler: (data: unknown) => void): () => void
  emitConnectionEvent(connectionId: string, event: string, data: unknown): void

  // 卡片管理
  loadCard(templateId: string, connectionId: string): Promise<CardInstance>
  unloadCard(instanceId: string): Promise<void>
  reloadCard(instanceId: string): Promise<void>

  // 白名单管理
  negotiateWhitelist(connectionId: string, methods: { method: string; description: string }[]): void
  isWhitelisted(connectionId: string, method: string): boolean
  listWhitelistedMethods(connectionId: string): { method: string; description: string; approvedBy: string[] }[]
}
```
