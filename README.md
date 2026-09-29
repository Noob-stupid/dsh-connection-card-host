# dsh-connection-card-host

> 在 DSH 会话之间建立有状态、可操作的连接；连接上挂载只在连接内生效的卡片插件。

## 核心模型

**会话是节点，连接是容器，卡片是连接级插件，插件只在连接内生效。**

- 不重写 DSH 的通信、权限、插件系统
- 不把卡片注册到 DSH 全局 Loader
- 画布上不画常驻连接线（拉线只在拖动时出现，松手后消失）
- 所有 DSH 交互走中间适配层（DSHAdapter）

## 项目结构

```
dsh-connection-card-host/
├── package.json              # peerDeps + dsh.client + dshEngines
├── tsconfig.json             # jsx: react-jsx
├── tsdown.config.ts          # client bundle (CJS + ModuleLoader)
├── scripts/build.sh          # host tsc + client tsdown
├── src/
│   ├── index.ts              # 宿主端入口
│   ├── client/index.tsx      # 浏览器端入口（槽位注入）
│   ├── adapter/
│   │   ├── dsh-adapter.ts    # DSH 中间层（requestRemote + 白名单 + 审计）
│   │   ├── version-guard.ts  # 版本守卫 (>=0.1.1-rc.2 <0.2.0)
│   │   └── stable-api.ts     # 对外稳定接口
│   ├── core/
│   │   ├── connection-manager.ts  # 连接生命周期 + 权限升级协商
│   │   ├── lane-allocator.ts      # 贪心区间着色 lane 分配
│   │   ├── event-bus.ts           # 连接级事件总线
│   │   ├── permission.ts          # 权限校验 + 升级 + 白名单
│   │   └── persistence.ts         # JSON 持久化 + .bak 恢复
│   ├── card-host/
│   │   ├── loader.ts         # CardHost（模板解析→import→apply(api)）
│   │   ├── registry.ts       # 模板/实例注册表
│   │   ├── sandbox.ts        # 崩溃隔离 + 动态 import
│   │   └── card-api.ts       # CardAPI 实现
│   ├── ui/
│   │   ├── AnchorCircle.tsx  # 输入框左侧小圆圈
│   │   ├── DragLine.tsx      # 拉线动效（虚线流动 + 粒子流）
│   │   ├── SessionRail.tsx   # 左侧轨道
│   │   ├── RailLane.tsx      # 单条 lane（双色渐变）
│   │   ├── ConnectionPanel.tsx # 卡片面板
│   │   ├── CardStack.tsx     # 卡片列表
│   │   └── hooks/
│   │       ├── useDragLine.ts     # 鼠标0ms + 触屏8px阈值
│   │       ├── useRailHover.ts    # 轨道悬停联动
│   │       └── useLaneLayout.ts   # lane 布局计算
│   ├── types/
│   │   ├── connection.ts     # Connection/Lane/LaneAssignment
│   │   ├── card.ts           # CardInstance/CardManifest/CardAPI
│   │   └── permission.ts     # PermissionLevel
│   └── styles/
│       └── tokens.css        # 设计 tokens（权限色、rail 尺寸、动效参数）
├── cards/
│   ├── monitor-card/         # 监控卡片（preset_error, session_idle）
│   ├── self-heal-card/       # 自愈卡片（preset_error→repair→repaired）
│   └── goal-relay-card/      # 目标中继卡片
└── docs/
    ├── card-protocol.md      # 卡片协议文档
    ├── adapter-api.md        # 适配层 API 文档
    └── compatibility.md      # DSH 兼容性、失败降级与性能边界
```

## 构建与注入

```bash
# 构建（host tsc + client tsdown）
DSH_CHECKOUT=<dsh-checkout> bash scripts/build.sh

# 注入器环境内
dev_inject_plugin <本目录>
```

## 交互参数（规格书第 8、15 节）

### 拖拽

| 输入 | 阈值 | 说明 |
|---|---|---|
| 鼠标 | 0ms | mousedown 立即进入拖拽 |
| 触屏 | 8px 移动 + 16px 锚点半径 | 超过 8px 且在锚点 16px 内才进入拖拽 |

### 拉线动效

- 底层：虚线流动线（`stroke-dashoffset` 动画，600ms 循环）
- 上层：4 个粒子沿贝塞尔曲线匀速流动（`getPointAtLength`）
- 松手：shrinking(200ms) → pulsing(300ms) → 移除
- `prefers-reduced-motion` 降级：关闭粒子流动

### 权限色

| 权限 | 颜色 |
|---|---|
| read | `#9CA3AF` |
| suggest | `#3B82F6` |
| write | `#F97316` |

### 健康状态色

| 状态 | 颜色 |
|---|---|
| green | `#10B981` |
| yellow | `#F59E0B` |
| red | `#EF4444` |

## DSH 兼容范围

| 组件 | 版本范围 |
|:---|:---|
| `dshEngines.framework` | `>=0.1.1-rc.2 <0.2.0` |
| `@deepseek-ai/cordis` | `>=4.0.1 <4.1.0` |

详细兼容性、失败降级与性能边界见 [docs/compatibility.md](docs/compatibility.md)。

## 关键约束

1. 卡片代码不 import 任何 `@deepseek-ai/*` 包
2. 所有 DSH 交互走 DSHAdapter
3. 画布上不画常驻连接线
4. 拉线只在拖动时出现，松手后消失
5. 宿主端与浏览器端通过 `ctx.set` / `ctx.get` 通信
6. 鼠标 0ms 进入拖拽；触屏 8px 阈值 + 16px 锚点半径判断
