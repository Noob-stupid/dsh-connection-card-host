# 兼容性、失败降级与性能边界

## DSH 兼容性

### 真正的门控是 `peerDependencies`，不是 `dshEngines`

运行时（0.2.0-rc.2）的 `evaluatePluginCompatibility`（`@dsh-app-boot/lib/index.js:286-314`）
**只挑两类 peer** 来对照运行时版本：

- 恰好是 `@deepseek-ai/dsh`
- 或以 `@deepseek-ai/dsh-` 开头

**`engines.dsh` 与 `dsh.manifestVersion` 运行时零处读取**
（README 原话：*"These checks use peer declarations, not `engines.dsh`"*）。
本项目早期用的 `dshEngines.framework` 字段**没有任何代码读它** —— 已移除。

| 组件 | 兼容范围 | 谁在读 |
|:---|:---|:---|
| `@deepseek-ai/dsh` | `>=0.2.0-rc.1 <0.3.0` | **DSH 的兼容门控**（对照运行时版本） |
| `@deepseek-ai/dsh-client-ui-slots` | `>=0.2.0-rc.1 <0.3.0` | 同上 + 浏览器端槽位注入 API |
| `@deepseek-ai/dsh-client-runtime` | `>=0.2.0-rc.1 <0.3.0` | 同上 + 浏览器端运行时 |
| `@deepseek-ai/cordis` | `>=4.0.1 <4.1.0` | **仅包管理器解析用**（前缀不匹配，DSH 不检查） |

> ⚠️ 早期版本写的是 `>=0.1.1-rc.2 <0.2.0`。它在 0.2.0-rc.2 上"碰巧能用"——
> semver 里预发布版排在正式版之前，所以 `0.2.0-rc.2 < 0.2.0` 成立。
> 这种**隐式通过**很危险：它看起来像门控，实际测的是别的包，
> 且一旦 DSH 发布 0.2.0 正式版就会被拒。现已改成显式标注真实支持范围。

### peer 为什么全部标了 `optional`

`peerDependenciesMeta` 把四个 peer 全部标成 `optional: true`
（**依赖区间一个字没改**）。两条独立的理由：

**(1) 有一个 peer 在公开 registry 上无解** —— 不标就装不上：

| peer | 区间 | registry 上的最高版本 | 可解析 |
|:---|:---|:---|:---|
| `@deepseek-ai/cordis` | `>=4.0.1 <4.1.0` | 4.0.4 | ✅ |
| `@deepseek-ai/dsh` | `>=0.2.0-rc.1 <0.3.0` | 0.2.0-rc.2 | ✅ |
| `@deepseek-ai/dsh-client-ui-slots` | `>=0.2.0-rc.1 <0.3.0` | 0.2.0-rc.2 | ✅ |
| `@deepseek-ai/dsh-client-runtime` | `>=0.2.0-rc.1 <0.3.0` | **0.1.1-rc.2** | ❌ **无解** |

`autoInstallPeers: false` 只在 peer **完全不存在**时跳过；这个包名存在（11 个版本，
`latest` 停在 0.0.1-rc.1），只是没有满足区间的版本，pnpm 因此**硬报错**
`ERR_PNPM_NO_MATCHING_VERSION` —— 整个安装失败（v1.0.1 起一直如此，与改名无关）。

**(2) 可解析的 peer 也会被真装进来** —— 实测（pnpm 9.15.9，`nodeLinker: hoisted` +
`autoInstallPeers: false`，装本包）：

| 标法 | 结果 |
|:---|:---|
| 只把 `dsh-client-runtime` 标 optional | ✅ 装上，但**用时 1 分 36 秒、拉进 602 个包** —— 整棵 `@deepseek-ai/dsh` 依赖树（`node-pty`、`koffi`、`protobufjs`…） |
| **四个全标 optional** | ✅ **612 毫秒、只加 1 个包** |

把整棵 DSH 框架拖进用户的 profile，正是 `autoInstallPeers: false` 要避免的事
（会和用户正在跑的 DSH 抢依赖）。而本包**运行时一个 `@deepseek-ai/*` 都不 import**
（`lib/` 全树 grep 无命中；浏览器端两个包由 DSH 的 `__ModuleLoader__` 注入），
所以"声明契约但不强制安装"才是准确的表达。

**这不影响版本门控**：`evaluatePluginCompatibility` 只读 `manifest.peerDependencies`，
从不读 `peerDependenciesMeta`（见 `@dsh-app-boot/lib/index.js`：按 `@deepseek-ai/dsh`
与 `@deepseek-ai/dsh-` 前缀筛选后逐条 `semver.satisfies`）。表里的区间照旧生效 ——
DSH 版本不匹配仍然会被拒绝并说明原因。

**两道防线，各管各的**：

1. **安装/加载期** —— DSH 的 peer 门控（上面这张表），不满足则拒绝加载
2. **运行期** —— 本插件自己的 `checkVersion()`（`src/adapter/version-guard.ts`），
   拿不到版本时 **fail-open**，改由**能力探测**决定（例如 `ctx.sessionController`
   是否存在、`ctx.connection.rpc` 是否可用）。宁可放行后降级，
   也不要因版本探测失败就整体禁用。

### 会话消息来源契约（V4 · 必读）

框架把会话消息格式升到 **v4**（0.1.7-rc.1 起）后，**每条被解释的消息**（`user/message`、
`assistant/message`、`tool/result`、`agent/inbox/spliced` 的 `inserted[]` 等）的 `source`
必须带一个 **producer-owned kind**：非空字符串，且**不能**是字面量 `plugin`
（那是已退役的 V3 包装 `{ kind: 'plugin', plugin: X }`）。第三方插件的规范形状是
`plugin:<包名>`，与框架自带 V3→V4 迁移器的映射一致。

```ts
// ❌ V3（已退役）：一发消息就报错，且整条会话卡死
source: { kind: 'plugin', plugin: 'dsh-connection-card-host' }
// ✅ V4：本插件投递中继消息时使用的形状
source: { kind: 'plugin:dsh-connection-card-host', form: 'relay', summary: '连接消息' }
```

失败形态（2026-09-30 真机事故）：中继投递 → `agent.followup(msg)` → agent 回合开始时
splice 进会话 → 落盘编码 `session-format-v3-to-v4` 的 `assertV4RowAdmission` 抛
`format v4 message requires a producer-owned source kind` → 回合以 error 结束；
坏事件**留在写句柄的缓冲里**（`JsonlSessionHandle.buffered` + `drainPaused`），
此后该会话每次发言都失败（磁盘上查不到坏行——它压根没落盘）。
修法：① 改生产方代码（`PLUGIN_SOURCE_KIND`）+ 重建 + 热重载；
② 已卡死的会话再清写缓冲：`sessionPersistence.tracker.writers.get(id)` → 把 `buffered`
里的坏 `source` 改成 producer-owned kind → `drainLive()` + `flush()`。
现场用的巡检/修复工具留在本机一次性目录 `_v4fix-2026-09-30\`（`wedge_probe` / `flush_repair2`，
经 `dsh-super-injector` 的 `dev_stage_call` 调用）。

## 失败降级行为

### 卡片加载失败

```
卡片模块 import → 抛出异常
         │
         ▼
    ┌─ 崩溃隔离 ─┐
    │ try/catch   │──捕获──▶ 记录错误日志
    └──────┬─────┘
           │
           ▼
    ┌─ 连接健康状态 ─┐
    │ health = 'red' │──广播──▶ health_changed 事件
    └────────────────┘
```

- 卡片 apply() 崩溃不会拖垮宿主
- 连接健康状态变为 red
- 用户可在面板中卸载故障卡片

### requestRemote 失败

| 错误类型 | 返回值 | 触发条件 |
|:---|:---|:---|
| `whitelist_violation` | `{ error: 'whitelist_violation', message }` | 方法不在白名单中 |
| `timeout` | `{ error: 'timeout' }` | 30s 超时 |
| `not_available` | `{ error: 'not_available' }` | 对端不可达或 adapter.call 不存在 |

### 持久化失败

- 写入 connections.json 失败时不抛异常
- 下次启动自动回退到 .bak 备份
- 审计日志文件写入失败静默忽略

## 性能边界

### 连接数限制

| 指标 | 值 | 说明 |
|:---|:---|:---|
| 单会话最大连接数 | 无硬限制 | 受内存和 UI 渲染能力影响 |
| 推荐上限 | 50 条活跃连接 | 超过后 UI 可能卡顿 |
| 内存占用 | ~5KB/连接 | Connection 对象 + 卡片实例 |

### 事件总线性能

| 操作 | 复杂度 | 说明 |
|:---|:---|:---|
| subscribe | O(1) | Map.set |
| emit | O(n) | n = 订阅者数量 |
| clearConnection | O(1) | Map.delete |

### 拉线动效

| 场景 | FPS | 说明 |
|:---|:---|:---|
| 鼠标拖拽 | 60fps | requestAnimationFrame + CSS transform |
| 触屏拖拽 | 60fps | touchmove + passive: false |
| prefers-reduced-motion | 关闭粒子 | 仅虚线流动，无动画 |

### Lane 分配算法

| 指标 | 值 | 说明 |
|:---|:---|:---|
| 时间复杂度 | O(n log n) | 排序 + 贪心着色 |
| 空间复杂度 | O(n) | lane 数组 |
| 适用规模 | ≤1000 个区间 | 实际使用通常 ≤50 |

## 已知限制

1. **DOM 属性依赖**: 拉线连接依赖 `[data-session-id]` 属性标识目标会话项。如果 DSH 未来移除该属性，需要适配新的选择器。
2. **槽位名变更**: 当前注册 `conversation.input.activity` 和 `sidebar.panellist`。这些是 DSH 实时槽位树中的名称，未来大版本可能变化。
3. **remote.call 可用性**: `requestRemote` 依赖 `(this.ctx as any).remote?.call`。某些环境（如测试沙箱）可能不提供此方法，此时返回 `not_available`。
4. **卡片模块缓存**: 热重载通过 `registry.removeModule(templateId)` 清缓存重新 import。但 Node.js ESM 缓存可能导致旧代码仍被引用，极端情况下需重启宿主。
