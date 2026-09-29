# 兼容性、失败降级与性能边界

## DSH 兼容性

| 组件 | 兼容范围 | 说明 |
|:---|:---|:---|
| `dshEngines.framework` | `>=0.1.1-rc.2 <0.2.0` | 主框架版本，决定槽位 API 和事件系统 |
| `@deepseek-ai/cordis` | `>=4.0.1 <4.1.0` | Cordis loader 运行时（对应 framework 0.1.x） |
| `@deepseek-ai/dsh-client-ui-slots` | `>=0.1.1-rc.2 <0.2.0` | 浏览器端槽位注入 API |
| `@deepseek-ai/dsh-client-runtime` | `>=0.1.1-rc.2 <0.2.0` | 浏览器端运行时 |

**验证方式**: 启动时调用 `adapter.init()` 检查 `VersionCheckResult.supported`。不支持时进入降级模式。

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
