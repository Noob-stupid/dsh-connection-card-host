# 可适配插件能力矩阵（调研产出 · 第一批）

> 配套文档：[adapter-design.md](./adapter-design.md)　回退：[REVERT.md](../REVERT.md)
>
> 调研方法：对每个候选的真实源码/制品跑统一体检 ——
> ① 是否模块级 import `@deepseek-ai/*`（F1 判据）
> ② `ctx.*` 接口用量（依赖面）
> ③ 全局副作用（`setInterval` / `ctx.set` / 写文件 / `process.on`）
> ④ 是否有 client 制品（UI 捕获工作量）
>
> **体检脚本**：[`scripts/audit-plugins.ps1`](../scripts/audit-plugins.ps1)（只读，可复跑）

---

## 1. 矩阵

| 插件 | 版本 | 类型 | UI | `ctx.*` 依赖面 | 全局副作用 | 适配判定 |
|:--|:--|:--|:--|:--|:--|:--|
| **`dsh-browser`** | 0.1.0 | **纯能力（工具）** | **无** | `tools`×12, `effect`×1 | 无 | ✅ **最容易 —— 首选试点** |
| `@openviking/dsh-memory-plugin` | 0.5.11 | 能力（记忆） | **有**（`client.mjs`） | `on`×7, `effect`×3, **`plugin`×2**, `logger`×1, **`provide`×1**, `skills`×1 | `setInterval`, **写文件**, `process.on` | ⚠️ 依赖 `dsh-llm` / `dsh-mcp-client` / `dsh-skill-filesystem` → **B1 依赖图**；且 `provide` 是**向全局提供服务** |
| `dsh-graded-mode（社区样本）` | 0.0.1-rc1 | 能力 + UI | **有**（`immediately: true`） | `effect`×5, `webServer`×4, `on`×3, `userQuestions`×2, `commands`×1, `tools`×1 | **写文件** | ⚠️ 中等 —— 多服务 + 需捕获 UI |
| `dsh-super-injector（社区样本）` | 0.3.5 | **宿主手术刀** | 有 | `loader`×38, `effect`×22, `logger`×16, `get`×14, `fiber`×13, `reflect`×12, `registry`×9, `systemPrompt`×8, `slots`×8, `tools`×7 | `setInterval`, **写文件**, `process.on` | ❌ **不可适配**（脚本已自动判定） |

> **体检脚本的一处自身缺陷，已修**：脚本原先用**绝对路径**判断是否落在 `node_modules` 里，
> 而 profile 装的插件**本身就住在 `node_modules` 下** ⇒ 整个插件被排除、扫到 0 个文件
> （`dsh-browser` 第一轮就假阴了）。改成按**相对路径**判断后恢复正常（4 个文件、`tools`×12）。
> 教训与主项目一致：**体检工具本身也要能被交叉核对**，否则假绿/假阴会直接污染矩阵。

---

## 2. 逐条结论

### 2.1 `dsh-browser` —— ✅ 首选试点

- `dsh.bundle.patch` 只有宿主侧，**没有 client 制品** → 适配后**天然不涉及 UI 捕获**，可先把"能力桥接"这条链单独打通
- 依赖面极窄：`ctx.tools.register(defineTool({…}))` + 一个 `ctx.effect`
- **关键（F2 的第三方验证）**：它的工具签名里有 `async execute(args, exec)` —— **`exec` 拿得到**，
  说明"调用时按会话校验 scope"（护栏③）对**别人的插件**同样可行，不只是我们自己的工具

**适配器需要申报的能力**：`tools`（+ `effect`）。
**首版验证目标**：挂上去之后，A 端会话能调到、B 端会话调不到，卸载后工具消失。

> 注意：`dsh-browser` 的 peers 是 `@deepseek-ai/cordis@^4.0.1`，与我方 `>=4.0.1 <4.1.0` 兼容 ✓

### 2.2 `@openviking/dsh-memory-plugin` —— ⚠️ 第二批（依赖图最重）

- 布局与常规插件不同：**包根直接是 `.mjs`**（`index.mjs` / `runtime.mjs` / `mcp.mjs` / `skills.mjs` / `client.mjs`），没有 `lib/`。
  体检脚本已改成"`src/` → `lib/` → 包根"三级回退，现在能扫到 **32 个文件** ✓
- `dsh` 段只有 `bundle.patch`、**没有 client 段**，但根目录有 `client.mjs` → **UI 存在但声明方式不同**，
  是 UI 捕获的第二个样本（待查它怎么被加载）
- 真实依赖面：`on`×7, `effect`×3, **`plugin`×2**, `logger`×1, **`provide`×1**, `skills`×1
  - **`provide`×1** —— 它**向全局注册了一个服务**。这是护栏②要正面回答的情形：
    在卡片作用域里"提供全局服务"是**语义冲突**，适配层要么按作用域提供、要么拒绝
  - **`plugin`×2** —— 它自己**加载子插件**，依赖图更深一层
- peers 声明了 `dsh-llm` / `dsh-mcp-client` / `dsh-skill-filesystem` → 典型 **B1**：
  适配时要明确"这些依赖从哪来"，拿不到就**明确拒绝**，不静默降级

### 2.3 `dsh-graded-mode（社区样本）` —— ⚠️ UI 捕获的第一个真实样本

- **它是唯一同时具备"能力 + client UI"的候选** —— 正好用来验证 §4 的四步捕获机制
- 依赖面比 `dsh-browser` 宽：`webServer` / `commands` / `userQuestions` / `on` —— 适配器要逐个申报
- 有**写文件**副作用 → 走护栏②的判定：**这是它的功能还是越界**？（写自己的数据目录属功能；写别人的属越界）
- `immediately: true`：它声明了立即加载 —— 适配后这个开关由**我们**决定，不再由它自己决定

### 2.4 `dsh-super-injector（社区样本）` —— ❌ 不可适配（**范本级的反例**）

它的 `ctx.*` 用量把不可适配的理由写得清清楚楚：
`loader`×38 / `reflect`×12 / `fiber`×13 / `registry`×9 —— **这些是宿主内部机制**，
而它的功能本身就是"**给运行中的宿主做手术**"（运行时注入、热重载、改别人）。

**把它挂进卡片的语义是矛盾的**：卡片要的是"这条连接上的能力"，
而它要的是"改整个宿主"。⇒ 明确列入**不可适配**，并作为判定表里的头号反例。

> 这条也顺带验证了范围界定（`adapter-design.md` §0.1）的必要性：
> 若不划界，"任意 DSH 插件都能挂"会把这种宿主手术刀也当成目标。

---

## 3. 从矩阵读出的三条规律（供协议草案采用）

1. **能力面越窄越可适配** —— `tools` + `effect` 是"纯能力插件"的最小公共面
   （`dsh-browser` 就是它）。协议的能力清单应以这个最小面为 v1 核心，其余按需扩展。
2. **`ctx.*` 里凡出现 `loader` / `reflect` / `fiber` / `registry` 者，一律不可适配** ——
   这几个名字代表"直接操作宿主内部"，是比 import `@deepseek-ai/*` 更硬的判据
   （可以作为协议的**自动预检**：体检脚本扫到这些就拒绝）。
3. **`exec` 在第三方插件里同样可用**（`dsh-browser` 证实）——
   护栏③的调用时校验不是我们独有，**是通用可行的**。

---

## 4. 实验计划（用户要求：**真找几个增强能力的普通 DSH 插件实验**）

### 4.0 实验用插件池（全部是**真实存在、可复跑**的）

| 插件 | 来源 | 形态 | 用它验证什么 |
|:--|:--|:--|:--|
| **`dsh-browser`** v0.1.0 | profile 安装 | 纯工具、无 UI | **实验一：能力桥接**（最小面：`tools`+`effect`） |
| **`dsh-graded-mode（社区样本）`** v0.0.1-rc1 | `plugin-src`（有源码） | 能力 + **client UI** | **实验二：UI 捕获**（唯一 UI 样本） |
| **`@openviking/dsh-memory-plugin`** v0.5.11 | `plugin-src`（有源码） | 能力 + 依赖图 + `provide` | **实验三：依赖图与拒绝路径** |
| `@deepseek-ai/dsh-experimental-auto-review` | profile 安装（官方实验） | 能力 | 备选：官方实验插件能否同样挂 |
| `@deepseek-ai/dsh-experimental-agent-team` | profile 安装（官方实验） | 能力 | 备选：同上 |
| `dsh-super-injector（社区样本）` v0.3.5 | `plugin-src` | 宿主手术刀 | **反例**：硬判据应自动拒绝 |
| `dsh-whale-widget` v0.3.16 | profile 安装 | 挂件/装饰 | **范围外**（装饰类，按 §0.1 不纳入） |

> 备注：profile 的 `@deepseek-ai` 下还装着 7 个官方实验包（全部构建完好），
> 其中 `dsh-experimental-auto-review` / `dsh-experimental-agent-team` 属**能力型**，可作第二梯队样本。

### 4.1 实验一 —— 能力桥接（`dsh-browser`）

- **做法**：把它挂成卡片 → 适配层提供 `tools` + `effect` 影子 ctx → 它的 `ctx.tools.register` 被捕获 →
  桥接进全局工具面 + 按会话过滤（复用 `tool-scoping` 的 waterfall，F4）
- **成功判据**（缺一不可）：
  1. A 端会话**能真正调到**它的工具（不是只在 schema 里出现 —— 要真跑一次）
  2. B 端会话**看不到也调不到**
  3. 卸载卡片后，工具从注册表消失（无幽灵工具，F3）
  4. **全局界面零变化**（它本来就没有 UI，正好先隔离变量）
- **前置**：垫片层（让 `@deepseek-ai/cordis` 解析）+ 影子 ctx + 工具桥接

### 4.2 实验二 —— UI 捕获（`dsh-graded-mode`）

- **做法**：取它的 client 制品 → 影子 `__ModuleLoader__` 捕获 factory → 影子 slots facade → 渲染进面板留白处
- **成功判据**：UI 出现在 **[连接] 面板**里且可交互；**全局界面一处都不出现**
- **额外观察**：它要 `webServer` / `commands` / `userQuestions` 等更多能力 → 记录"申报清单要写多长"
- **风险对照**：R1（构建产物同形性）/ R3（服务依赖）/ R4（交互是否真能用）

### 4.3 实验三 —— 依赖图与拒绝路径（`dsh-memory-plugin`）

- **做法**：尝试适配，重点看**拒绝路径**
- **成功判据**：对 `provide`（向全局提供服务）与 `dsh-llm` / `dsh-mcp-client` 依赖，
  适配层给出**明确拒绝 + 缺什么说清楚**，而**不是**崩溃、也不是静默降级
- **价值**：证明"不可适配"是一等公民的输出，而不是错误兜底

### 4.4 反例实验 —— 硬判据预检（`dsh-super-injector`）

- **做法**：直接让体检脚本判定 → 应在**安装/申报阶段**就被拒
- **成功判据**：拒绝文案指出是 `loader`/`fiber`/`reflect`/`registry` 触发了硬判据

---

## 5. 下一步

1. ~~修体检脚本支持"包根 `.mjs`"布局~~ ✅ 已做（`src/` → `lib/` → 包根三级回退）
2. ~~登记实验用的真实插件池~~ ✅ 见 §4.0
3. 按 §2.1 给 `dsh-browser` 写**第一份适配器草案**（含申报清单），作为协议章节的实例
4. 用 `dsh-graded-mode` 验证 `adapter-design.md` §4 的 **UI 捕获四步**（它是唯一的 UI 样本）
5. 产出协议章节 → 与对端对齐 → 再动实现代码

> **顺序理由**：先做**实验一（能力桥接）** —— `dsh-browser` 无 UI，可以把"UI 捕获"这个变量**隔离掉**，
> 单独验证"能力按端生效 + 生命周期干净"。等这条通了，再叠加 UI 捕获，出问题时故障面才不会混在一起。
