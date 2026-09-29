# 卡片协议（Card Protocol）

## 概述

卡片是「连接级插件」——只在某条会话连接内生效，不注册到 DSH 全局 Loader。
模板是分发单位，实例是运行时单位。安装模板后可一键加到多条连接上。

## Manifest

放在卡片包 `package.json` 的 `dshCard` 字段：

```json
{
  "name": "monitor-card",
  "version": "1.0.0",
  "main": "dist/index.js",
  "dshCard": {
    "id": "monitor-card",
    "name": "监控卡片",
    "requires": {
      "read": ["preset_status", "session_log"],
      "write": []
    },
    "events": ["preset_error", "session_idle"],
    "ui": {
      "icon": "assets/icon.svg",
      "panel": "dist/panel.js"
    }
  }
}
```

### Manifest 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 卡片模板唯一标识（模板注册表 key） |
| `name` | string | 人类可读名称（面板显示） |
| `requires.read` | string[] | 读权限所需的 DSH 资源（如 `preset_status`） |
| `requires.write` | string[] | 写权限所需的 DSH 操作（如 `repair_preset`） |
| `events` | string[] | 卡片可订阅/发布的事件名列表 |
| `ui.icon` | string | 图标资源相对路径（SVG） |
| `ui.panel` | string | 面板入口文件相对路径（默认 `dist/index.js`） |

## 入口

卡片入口导出两个函数：

```js
// dist/index.js

/**
 * 卡片初始化：订阅事件、注册工具、设置状态。
 * 在 CardHost.loadCard() 时调用。
 * @param {CardAPI} api - 卡片受限接口
 */
export function apply(api) {
  api.on('preset_error', (data) => {
    api.log('preset error detected', data)
    api.emit('health_changed', { health: 'red' })
  })

  api.on('session_idle', (data) => {
    api.log('session idle', data)
    api.emit('health_changed', { health: 'yellow' })
  })

  api.registerTool('get_status', async () => {
    return { ok: true, uptime: process.uptime() }
  })
}

/**
 * 面板 UI 渲染（可选）。
 * 浏览器端在 ConnectionPanel 展开卡片时调用。
 * @param {HTMLElement} element - 挂载容器
 * @param {CardAPI} api - 卡片受限接口
 */
export function mountPanel(element, api) {
  element.innerHTML = '<div class="monitor-card">监控中...</div>'
}
```

## CardAPI 完整接口

| 方法 | 签名 | 说明 |
|---|---|---|
| `on` | `(event: string, handler: (data) => void) => () => void` | 订阅本连接事件（命名空间 `conn:<connectionId>:<event>`），返回取消函数 |
| `emit` | `(event: string, data: unknown) => void` | 向本连接发布事件 |
| `registerTool` | `(name: string, fn: (params) => Promise<unknown>) => void` | 注册工具（白名单协商后对端可调用） |
| `mountUI` | `(element: HTMLElement) => void` | 渲染卡片 UI 到面板容器 |
| `requestRemote` | `(method: string, params: unknown) => Promise<unknown>` | 请求对端执行操作（30s 超时，不自动重试，白名单校验） |
| `log` | `(...args: unknown[]) => void` | 写日志（控制台 + 审计日志） |

### requestRemote 返回值

```ts
// 成功
{ ...对端返回数据 }

// 失败
{ error: 'timeout' }              // 30s 超时
{ error: 'whitelist_violation' }  // 方法不在白名单
{ error: 'not_available' }        // 对端不可达
```

## 事件命名规范

所有事件在连接命名空间内：`conn:<connectionId>:<event>`

### 内置事件

| 事件 | 触发者 | 负载 | 说明 |
|---|---|---|---|
| `health_changed` | 卡片 | `{ health: 'green' \| 'yellow' \| 'red' }` | 卡片健康状态变更 |
| `permission_upgrade_requested` | 宿主 | `PermissionUpgradeRequest` | 权限升级请求发起 |
| `permission_upgrade_accepted` | 宿主 | `{ id, direction, from, to }` | 权限升级生效 |
| `permission_upgrade_rejected` | 宿主 | `{ id, rejectedBy }` | 权限升级被拒 |
| `permission_upgrade_expired` | 宿主 | `{ id }` | 权限升级超时过期 |
| `whitelist_negotiated` | 宿主 | `{ methods: string[] }` | 白名单协商完成 |
| `whitelist_add_requested` | 宿主 | `{ method, description }` | 白名单新增请求 |
| `whitelist_added` | 宿主 | `{ method }` | 白名单新增确认 |

## 权限模型

### 权限级别

| 级别 | 值 | 说明 |
|---|---|---|
| `read` | 0 | 只读，可观察对端状态 |
| `suggest` | 1 | 建议，可向对端发送建议但不强制执行 |
| `write` | 2 | 写入，可通过 requestRemote 在对端执行操作 |

### 升级规则

- **高→低（降级）**：直接生效，无需确认
- **低→高（升级）**：需双方确认（双端同意才生效），60s 超时自动过期
- 升级请求通过 `permission_upgrade_requested` 事件通知两端
- 确认后自动更新连接权限并广播 `permission_upgrade_accepted`

## 面板 UI

```js
export function mountPanel(element, api) {
  element.innerHTML = '<div class="monitor-card">监控中...</div>'
}
```

面板 UI 在 ConnectionPanel 展开卡片行时渲染。`element` 是一个空的 `HTMLElement` 容器。

## 分发来源

- **内置**：随宿主插件发布，位于 `cards/` 目录（monitor-card、self-heal-card、goal-relay-card）
- **npm registry**：用户输入包名安装（`npm install <card-name>`）
- **自定义 URL**：用户输入 `.tgz` 地址（下载解压到 `$DSH_HOME/connection-cards/<card-id>/`）

## 安全约束

1. 卡片代码**绝不 import** 任何 `@deepseek-ai/*` 包
2. 所有 DSH 交互走中间适配层（DSHAdapter）
3. `requestRemote` 必须在对端声明的白名单方法内
4. 对端执行使用对端自身权限上下文，连接权限只决定能否发起请求
5. 所有 `requestRemote` 调用记录审计日志（`$DSH_HOME/connection-cards/audit.log`）
6. 白名单修改需双方确认（防提权）

## 官方示例卡片

| 卡片 | 功能 | 权限要求 | 事件 |
|---|---|---|---|
| monitor-card | 监控预设状态、会话空闲 | read | preset_error, session_idle |
| self-heal-card | 预设损坏时自动修复 | read + write | preset_error, preset_repaired |
| goal-relay-card | 在连接的会话间中继目标 | read + write | goal_updated, goal_completed |

---

## 实现状态

### 已实现（可用）

| 能力 | 入口 | 说明 |
|---|---|---|
| 模板发现 | `listTemplates()` / RPC `cards/templates` | 扫描两个根目录：内置（随插件发布的 `cards/`）+ 已安装（`$DSH_HOME/connection-cards/cards/`）。读每个包 `package.json` 的 `dshCard` 字段 |
| 装载到连接 | `loadCard()` / RPC `cards/load` | import 模块 → 建实例 → 挂到连接 → `apply(api)` → **立即落盘** |
| 卸载 | `unloadCard()` / RPC `cards/unload` | 从连接摘除 + 注销实例 + 落盘 |
| 重载 | `reloadCard()` / RPC `cards/reload` | 清模块缓存重新 import（改卡片代码后不用重启） |
| 面板渲染 | `renderCardPanel()` / RPC `cards/panel` | 见下方「面板渲染」 |
| 重启重放 | `restoreAll()`（宿主 apply 时自动调用） | 连接从 `connections.json` 恢复，但卡片 `apply()` 不会自动重跑 —— 不重放卡片就是「哑」的（事件订阅、工具注册全丢） |
| 崩溃隔离 | `sandbox.ts` | 卡片 import/apply 抛异常不会拖垮宿主 |
| 面板 UI | 连接面板 → 展开连接 → 卡片区 | 列出可用模板一键添加；已装载的可「重载」「移除」 |

### 面板渲染：为什么在宿主侧跑

卡片模块 **import 在宿主进程**（`apply` 要订阅连接事件、注册工具，这些都在宿主侧），
但协议里 `mountPanel(element, api)` 收的是 `HTMLElement`，而宿主没有 DOM。

所以宿主提供一个**只支持 `innerHTML` 的 DOM 替身**（`card-host/dom-shim.ts`），
调用 `mountPanel` 后取回 HTML 交给浏览器注入。

**优先建议新卡片导出 `renderPanel(api): string`** —— 纯字符串，不需要 DOM 替身，语义更干净：

```js
export function renderPanel(api) {
  return `<div class="my-card">状态：${api ? '正常' : '未知'}</div>`
}
```

**局限（务必知悉）**：`mountPanel` 里做真实 DOM 操作
（`appendChild`、`addEventListener`、`querySelector`）**不会生效** ——
替身只提供空实现。需要交互式面板的卡片必须导出 `renderPanel`，
或者等后续把卡片 UI 资源下发给浏览器执行。

### 未实现

| 能力 | 状态 |
|---|---|
| npm registry 安装 | 未实现。目前只能把卡片目录放到 `$DSH_HOME/connection-cards/cards/<id>/` |
| 自定义 URL 安装 | 未实现 |
| 卡片面板的浏览器侧执行 | 未实现（见上方局限） |
| `requestRemote` | **空壳**：宿主没有 `ctx.remote`，永远返回 `not_available`。白名单校验与审计日志已就绪，缺的是真正能打到对端会话的执行通道 |
| `repairPreset` | stub，未接真实修复逻辑 |

### 手动安装一张卡片

```powershell
# 卡片目录需含 package.json（带 dshCard 字段）与入口 JS
Copy-Item -Recurse .\my-card "$env:USERPROFILE\.dsh\connection-cards\cards\my-card"
```

宿主下次扫描模板时即可在面板里看到它（`scanTemplates()` 幂等，重载插件即刷新）。

