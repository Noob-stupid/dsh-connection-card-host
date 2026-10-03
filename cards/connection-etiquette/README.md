# connection-etiquette —— 连接礼仪（紧急度）卡片

**一句话**：这是一张「连接级卡片」——挂上之后，它会用 `quiet` 档向对端宣告一份
紧急度四档策略（幂等 + 惰性，失败会补），并给本端会话提供一个只转发、不判语义的工具
`report_connection_note(text, urgency, evidence)`；紧急度语义由调用方决定，本卡只负责按档送达并留审计。

---

## 1. 默认关闭：怎么挂、在哪挂

**不挂 = 完全不生效**（不订阅事件、不注册工具、不投递任何东西）。

挂载位置：**连接面板 → 展开某条连接 → 卡片区 → 从候选列表里添加 `连接礼仪（紧急度）`**。
卡片只在**被挂上的那条连接**内生效，不进 DSH 全局 Loader（协议：卡片是「连接级插件」，见
`docs/card-protocol.md` 概述与「分发来源」）。

## 2. ⚠️ 挂载时请选 `a` 或 `b`；选 `both` 则插话会被宿主拒绝

- 本卡清单里**刻意不写 `scope`** —— 写了会把可见方向锁死在某一端，也就选不了了。
- 宿主侧 `sendMessage` 的目标端判定：`scope='a'` → 对端 = B；`scope='b'` → 对端 = A；
  **`scope='both'` → 判不出"该对哪一端说话" ⇒ 返回 `{ ok:false, reason:'…挂在两端（scope=both）…' }`，不发送**。
- 所以选 `both` 时：策略宣告和插话**都会被拒**（卡片不谎报成功，日志里会写明原因）。

## 3. 策略宣告是「幂等 + 惰性」的

宿主语义：**`quiet` + 对端冷会话 = 不投递**（quiet 不唤醒，而投递必然唤醒 ⇒ 宁可跳过 + 审计）。
因此「装载时宣告一次」在对端当时不在线时会**静默失效**。

本卡的做法：

| 时点 | 行为 |
|---|---|
| `apply`（装载/重放） | 尝试宣告一次：`sendMessage(POLICY_TEXT, {urgency:'quiet', kind:'say'})` |
| 宣告成功（`ok===true`） | 状态记为「已宣告」，**之后一次都不再发**（幂等） |
| 宣告失败 | **状态保持「未宣告」**，`api.log` 如实写下宿主给的原因；**不阻断装载、不抛异常** |
| 每次工具调用 | 若「未宣告」→ 先补一次宣告，**再**发本次消息（惰性补救） |

- 状态**只在内存、不落盘**（宿主重启后自然重新宣告一次）。
- **不谎报**：`ok !== true`（未授权、`scope=both` 被拒、对端冷会话…）时绝不会把
  「我以为发了」写成「已宣告」；日志里能看到真实原因。
- 不依赖事件、不轮询、不重试风暴：**只在 `apply` 与工具被调用的时刻各尝试一次**。

## 4. 唯一工具：`report_connection_note`

入参：

```jsonc
{
  "text": "要说的话（原样转发，卡片不改写）",
  "urgency": "quiet | normal | urgent | preempt",
  "evidence": { "peerTask": "…", "sameArea": true, "supplement": "…", "duplicateOf": "…" }
}
```

- `urgency` 非法（含缺失）⇒ 直接返回 `{ ok: false, reason: 'bad-urgency' }`，**不产生任何投递**。
- 合法 ⇒ `evidence` 整份写进 `api.log`（审计要看得到"凭什么插话"），然后
  `api.sendMessage(text, { urgency, kind: 'say' })`，**原样返回宿主的结构化结果**
  （`{ok:true, via?, live?}` 或 `{ok:false, reason}`；不抛异常、不重试、不放宽、不改写）。
- 本卡**不判断**该不该插话 —— 那是调用方的判断；卡片只提供送达与审计。

## 5. 本卡**不做**什么

- **没有面板**：不导出 `renderPanel`/`mountPanel`，清单里不写 `ui`。
- **不订阅任何事件**（`events: []`）、不轮询、不设定时器。
- **不判语义**：不改写 `text`、不替调用方决定紧急度、不做"补充报错去重"（去重是调用方/模型的事，
  策略文本里已写明规则）。
- 不落盘自己的状态、不 import 任何 `@deepseek-ai/*` 包（协议安全约束 1）。

## 6. 已知限制与代价（如实写清）

1. **`kind` 目前被宿主忽略**：`CardAPI.sendMessage` 只读 `options.urgency`；
   `kind:'say'` 是**照约定保留**传参（本卡不擅自增删）。
2. **宣告文本会被宿主加来源前缀**：实际送达对端的文本是
   `【卡片 · connection-etiquette】<策略全文>` —— 前缀由宿主 `sendMessage` 添加，卡片控制不了。
3. **对端长期不在线时**：每次工具调用都会补试一次宣告（惰性补救的代价）；
   不会变成轮询或重试风暴，但日志里会累积"未送达"记录。
4. **宣告状态按实例分桶**（`WeakMap<api, true>`，而非 module 级裸 boolean）：
   同一模板挂在多条连接上时，模块只 import 一次、`apply` 被调用多次，
   裸 boolean 会让"连接 C1 宣告成功"吃掉 C2 的宣告 —— 那正是本卡要修的静默失效换维度复发。
5. **加载时 Node 会打一条 `MODULE_TYPELESS_PACKAGE_JSON` 警告**（本机 Node v24）：
   按给定清单**照抄**，没有擅自加 `"type": "module"`；要消除警告可在 `package.json` 加该字段。
6. **改了卡片代码请重新安装**（不要只靠宿主 `reload`）：同目录 reload 只能让入口新鲜，
   子模块仍会命中 ESM 缓存（见 `lib/card-host/sandbox.js` 的说明）。
7. **宿主列表里 `hasPanel` 恒为 `true`**：那是宿主 `listTemplates()` 自己的一行
   （`Boolean(manifest.ui?.panel) || true`），不是本卡声明的。本卡没导出
   `renderPanel`/`mountPanel`，所以真去渲染时宿主会拿到 `null`（没有面板内容）。

## 7. 文件

| 文件 | 作用 |
|---|---|
| `package.json` | `dshCard` 清单 + `main: index.js`（入口按 `join(cardDir, main)` 解析） |
| `index.js` | `apply(api)`：注册工具 + 幂等惰性宣告；导出 `POLICY_TEXT` |
| `SKILL.md` | 策略全文（人读的那份；与 `index.js` 内联文本**逐字一致**，`test.mjs` ⑧ 校验） |
| `test.mjs` | 假 api 离线单测（8 组，含惰性补救与幂等） |
| `README.md` | 本文件 |

## 8. 自测

```powershell
cd D:\dsh\our-cards\connection-etiquette
node --check index.js
node -e "console.log(require('./package.json').dshCard.id)"
node test.mjs
```

`test.mjs` 全部离线（假 `api`），**不投递任何真实消息、不接触宿主状态**。
