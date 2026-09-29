# 适配层 API（DSHAdapter）

## 跨半通信（宿主 ↔ 浏览器）

**这是本项目最容易踩坑的地方，务必先读这一节。**

### 两个致命陷阱

cordis 的 `Context` 是 **Proxy**，它会让"看起来无害"的代码抛异常：

| 写法 | 结果 |
|:---|:---|
| `ctx.someService` | 若未在 `inject` 中声明 → **抛** `cannot get property "x" without inject` |
| `ctx.someService?.foo` | 同上，**依然抛**（`?.` 挡不住 Proxy 的 getter） |
| `ctx.myService = value` | **抛** `cannot set property "x" without provide` |

因此：

1. **读服务一律走 `safeCtxGet(ctx, name)`**（`src/safe-ctx.ts`），它用 try/catch 把
   未声明服务视同 `undefined`。
2. **暴露服务必须** (a) 在插件导出里声明 `export const provide = ['服务名']`，
   并 (b) 用 `ctx.provide(name, value)` —— 不能直接赋值。

> 历史教训：早期版本在 `apply()` 里写 `(ctx as any).dsh?.version`，
> 结果整个 `apply()` 在第一步就抛异常。外层 `try/catch` 把异常吞了，
> fiber 仍显示 `[active]`，UI 只表现为「连接宿主未就绪」——
> 排查成本极高。**永远不要吞掉 apply 的异常**，写诊断日志。

### 为什么不用 `ctx.connection.rpc.handle()`

DSH 有一个通用 RPC 通道接口，看起来正合适：

```ts
ctx.connection.rpc.handle(channel, handler, { authority: 'trusted-host' })
```

但它的 `register()` 内部执行 `owner.webServer.register(route)`，而 `owner` 是
**connection 服务自己的 ctx**，那个 ctx 并未注入 `webServer`，于是必然抛
`cannot get property "webServer" without inject`。
实测把 `webServer` 加进调用方 inject 也**无效** —— 因为 owner 不是调用方 ctx。

### 实际方案

宿主直接在 `ctx.webServer` 上注册一条 prefix 路由，自己实现 DSH 的**标准信封**：

```
请求   POST /connection-card/<endpoint>
       { "type": "client-request", "rpcId": "...", "method": "<endpoint>", "payload": {...} }

响应   { "type": "server-response", "rpcId": "...", "result": { "ok": true, "value": ... } }
                                       或 { "ok": false, "error": { code, message, details } }
```

浏览器侧**照常使用官方调用器**，线上格式完全一致：

```ts
const result = await ctx.connection.rpc.call('/connection-card', 'connections/list', {})
```

好处：宿主不依赖 connection 服务的内部实现，客户端仍走官方通道；
安全栅栏（loopback / 同源 / 反跨站）由我们自己实现，与 DSH 的
`api-request-trust` 语义对齐。

### 端到端验证

```bash
curl -X POST http://127.0.0.1:19387/connection-card/health \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"p1","method":"health","payload":{}}'
# → {"type":"server-response","rpcId":"p1","result":{"ok":true,"value":{"ready":true,"connections":0}}}
```

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
