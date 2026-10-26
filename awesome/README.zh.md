# Awesome DSH 连接卡片

> 给 [`dsh-connection-card-host`](../README.zh.md) 用的**卡片**与**卡片适配插件**清单。

**卡片**是一份带 `dshCard` 清单的小包，挂到**某一条连接**上 ✓。它能给那条连接的会话提供工具、
订阅事件，或者在连接面板里渲染自己的界面 ✓。

**你不用从零写卡片**：任何**普通 DSH 插件都能当卡片挂**（见
[卡片能做什么 · 不能做什么](../README.zh.md#卡片能做什么--不能做什么)）✓。
所以下面两类都收：**卡片**，以及**当卡片好用的插件** ✓。

## 目录

- [内置卡片](#内置卡片)
- [社区卡片](#社区卡片)
- [卡片适配插件](#卡片适配插件)
- [已知不兼容](#已知不兼容)
- [怎么提交](#怎么提交)

## 内置卡片

随插件分发 —— 不用安装，在卡片候选列表里直接选 ✓。

| 卡片 | 它做什么 | 需要（读 / 写） | 事件 |
|---|---|---|---|
| **目标中继**（`goal-relay-card`） | 把目标与状态同步给对端，两边对"我们在做什么"有同一份认知 | `goal_status` / `relay_goal` | `goal_updated`、`goal_completed` |
| **监控**（`monitor-card`） | 盯对端的预设状态与会话活动，抛出 `preset_error` / `session_idle` | `preset_status`、`session_log` / — | `preset_error`、`session_idle` |
| **自愈**（`self-heal-card`） | 收到 `preset_error` 就让对端修预设，并把结果回报 | `preset_status` / `repair_preset` | `preset_error`、`preset_repaired` |
| **连接礼仪**（`connection-etiquette`） | 把四档紧急度（`quiet` / `normal` / `urgent` / `preempt`）讲给两边，并按你选的档位转发附注 | — / `send_message` | — |

## 社区卡片

_还没有条目 —— 第一个可以是你 ✓_ 见[怎么提交](#怎么提交)。

## 卡片适配插件

普通 DSH 插件，但当卡片挂 ✓。"状态"写的是**真机上实际观察到的** ✓。

| 插件 | 它给这条连接带来什么 | 状态 |
|---|---|---|
| [`dsh-client-ui-voice`](https://github.com/hajixiaolei-art/dsh-client-ui-voice) | 一个按住说话的语音输入控件 | ✅ 挂得上 · UI **捕获并渲染成功** · 1 个槽位 |
| [`gal-view`](https://github.com/Ayase34/gal-view) | 模型/场景查看面板 | ⚠️ 挂得上 · 槽位注册成功 · 渲染要客户端 hook —— 已记录，见 issue |

## 已知不兼容

列出来是为了**省你一个晚上** ✓。面板里的拒绝会写清确切原因 ✓。

| 插件 | 为什么今天挂不上 |
|---|---|
| [`dsh-usage`](https://github.com/linxin666/dsh-usage) | 它的宿主半边 import 了 11 个本插件不提供的包（`credentials`、`webServer`、`session`、`settings`…）⇒ 它需要的是**另一种宿主**，不是卡片 ✓ |
| 侧栏 / 主题 / 布局类替换 | 它们是**全局** UI，不是连接级的 ✓。这类是"装到 App 上"用的，挂到某条连接上没有落点 ✓ —— 候选列表会把它们标成 `全局` ✓ |

## 怎么提交

**一个 PR 一行** ✓。**卡片**和**当卡片好用的插件**都欢迎 ✓。
格式与要求见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

能让 PR **很快合入**的两件事：

1. **它真的能跑** ✓ —— 写明你试的 DSH 版本，贴出面板里那一行卡片行
   （有 UI 的再贴 `client-debug.log` 里 `[ui-capture]` 开头那行 ✓）
2. **那一行是诚实的** ✓ —— 如果只有你能渲染，就写只有你能 ✓。
   "在我这能跑，日志在这" 比"能用"三个字值钱得多 ✓

---

<sub>MIT · 与 DSH 官方无隶属关系</sub>
