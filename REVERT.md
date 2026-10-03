# 回退手册 — `feat/plugin-adapter`

> 用户要求：**留痕迹**，做不好要能**全部回退**。本文件就是那份清单，**每次提交后更新 §2**。

---

## 1. 隔离结构（为什么回退很容易）

| 位置 | 内容 | 与实验的关系 |
|:--|:--|:--|
| `D:\dsh-link\dsh-connection-card-host` | 主工作树 = **线上插件**（master，v1.0.18） | **从未包含本分支任何内容** |
| `D:\dsh-link\ccr-adapter` | 本分支工作树 `feat/plugin-adapter` | 实验全在这里 |
| 远端 `master` | 预览线发布分支 | **未被本分支改动** |
| 远端 `feat/plugin-adapter` | 本分支（已推送，留档） | 可删可留 |

**关键性质**：实验代码**不在**线上插件目录里，所以"回退"不需要动线上任何东西 ——
最坏情况也只是"多了一个没人用的分支和一个多余的工作树目录"。

---

## 2. 提交清单（逐条可回退）

| # | 提交 | 内容 | 是否含运行代码 |
|:--|:--|:--|:--|
| 1 | （本次） | `docs/adapter-design.md` + `REVERT.md` | **否**，纯文档 |

> 后续每加一条都追加一行，并注明"是否含运行代码"。

---

## 3. 三种回退场景

### 场景 A —— 只是不想要了（最可能）

实验**从未合并进 master**，且从未装进用户 profile。回退 = 什么都不做，或清理痕迹：

```powershell
cd D:\dsh-link\dsh-connection-card-host
git worktree remove D:\dsh-link\ccr-adapter        # 删工作树目录
git branch -D feat/plugin-adapter                  # 删本地分支（未合并分支需 -D）
git push origin --delete feat/plugin-adapter       # 可选：删远端留档
```

**注意**：删分支不属于铁律保护范围（铁律保护的是 **tag**：永不移动、永不删除）。
若想留档，**远端分支不删即可**，代价只是仓库里多一个分支。

### 场景 B —— 已经合并进 master，但没发版

用**前进式回退**（`git revert`），**绝不用 force-push**：

```powershell
cd D:\dsh-link\dsh-connection-card-host
git log --oneline                      # 找到适配层相关提交
git revert --no-commit <c1> <c2> ...   # 一批一起回退
git commit -F <说明文件>
```

回退后 master 仍是"可发布"状态；**历史保留**，符合"永不改写历史"。

### 场景 C —— 已经发版（最坏情况）

1. **不撤回 npm 已发布版本**（铁律：绝不 unpublish）
2. 在预览线打出**回退版本**（如 v1.0.N+1，内容 = 去掉适配层），照常打 annotated tag
3. 通知对端：新版本即回退版；门面按正常流程晋它
4. 旧 tag 全保留

---

## 4. 运行时痕迹（写代码阶段要遵守）

以下是**实现阶段**的硬要求，先记在这里，实现时逐条对照：

| 要求 | 形态 |
|:--|:--|
| 开关默认 **OFF** | 模块级 `let enabled = false`，需显式开启（照 preempt 的四道闸门写法） |
| 显式申报才生效 | 卡片 package.json 里必须有 `dshCard.adapter`，否则行为与今天完全一致 |
| 每次动作留审计 | 安装 / 加载 / apply / 工具注册 / 卸载，全部 `auditLog('[adapter] …')` |
| 拒绝要说明原因 | 不可适配的插件，拒绝文案写清**为什么**（照 `validateCardPackage` 的写法） |
| 卸载即净 | disposer 绑定 unloadCard / 连接删除 / restoreAll，不留幽灵工具 |
| 不碰 master 的稳定面 | 能只加文件就不改文件；必须改的地方单独成条、单独提交，便于 `git revert` 单点回退 |

---

## 5. 与对端的约定

- **适配层绝不进入门面/npm，直到用户明确放行**（对端只晋我们打 tag 的版本）
- 本分支存在期间，master 的版本号照常递增（正常修复不受影响）
- 若本分支被放弃，**无需通知对端做任何事**（因为从未发布）
