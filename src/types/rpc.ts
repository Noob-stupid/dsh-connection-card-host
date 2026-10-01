/**
 * 宿主 ↔ 浏览器 RPC 契约（两半共享）。
 *
 * 走 DSH 官方的 Connection 通道：宿主 `ctx.connection.rpc.handle()` 注册，
 * 浏览器 `ctx.connection.rpc.call()` 调用。
 *
 * 这个模块必须保持零 Node 依赖 —— 它会被打进 client bundle。
 */

/** RPC 通道前缀（绝对路径，须匹配 /^\/[A-Za-z0-9._~-]+$/）。 */
export const RPC_CHANNEL = '/connection-card'

/** 成功结果。 */
export interface RpcOk<T> {
  ok: true
  value: T
}

/** 失败结果（沿用 DSH 的 RpcResult 形状）。 */
export interface RpcFail {
  ok: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export type RpcResult<T> = RpcOk<T> | RpcFail

/**
 * 端点名。宿主 handler 收到的 `endpoint` 是通道相对路径，
 * 例如 `connections/list`（每段须匹配 /^[A-Za-z0-9_$.-]+$/）。
 */
export const RPC_ENDPOINTS = {
  health: 'health',
  listConnections: 'connections/list',
  connectionsBySession: 'connections/bySession',
  createConnection: 'connections/create',
  disconnect: 'connections/disconnect',
  updatePermission: 'permission/update',
  requestPermissionUpgrade: 'permission/request',
  acceptPermissionUpgrade: 'permission/accept',
  rejectPermissionUpgrade: 'permission/reject',
  loadCard: 'cards/load',
  unloadCard: 'cards/unload',
  reloadCard: 'cards/reload',
  listCardTemplates: 'cards/templates',
  renderCardPanel: 'cards/panel',
  listWhitelist: 'whitelist/list',
  listSessions: 'sessions/list',
  /** 浏览器半的诊断上报通道（宿主落到 client-debug.log）。 */
  debugLog: 'debug/log',
  /**
   * 调试用：向连接的 eventBus 发一个事件，用来手动触发卡片逻辑。
   * 卡片订阅的是连接级事件，没有这个入口就没法在不接入真实 DSH 事件源的情况下测试。
   */
  debugEmit: 'debug/emit',
  /** 待确认的权限升级请求。 */
  listUpgradeRequests: 'permission/pending',
  /** 协商连接的可远程调用方法白名单。 */
  negotiateWhitelist: 'whitelist/negotiate',
  /** 读取连接的交流记录。 */
  listMessages: 'messages/list',
  /** 以某一端的身份发一条连接消息。 */
  sendMessage: 'messages/send',
  /** 清空某条连接的交流记录（连接本身不动）。 */
  clearMessages: 'messages/clear',
  /**
   * 调试用：直接往某个会话投递一段文本（验证「A 说话 B 能感知」的最后一跳）。
   * 目标会话必须有 live agent，否则返回失败原因。
   */
  debugDeliver: 'debug/deliver',
  /** 会话桥的能力探测结果。 */
  relayCapabilities: 'relay/capabilities',

  /** 改已装载卡片的可见范围（两端 / 仅 A / 仅 B）。 */
  setCardScope: 'cards/set-scope',

  // ── 面板内安装（装到我们自己的目录，不碰 profile） ──
  /** 安装一张卡片（本地目录 / tgz / npm 包名 / HTTP tgz）。 */
  installCard: 'cards/install',
  /** 卸载一张已安装的卡片。 */
  uninstallCard: 'cards/uninstall',
  /** 已安装卡片的根目录（面板显示，让"装到哪儿"透明）。 */
  cardsRoot: 'cards/root',
  /** 某连接上、**对某一端可见**的卡片工具（卡片给会话提供的能力）。 */
  listCardTools: 'cards/tools',
  /** 调用某张卡片的工具（**带可见范围校验**）。 */
  callCardTool: 'cards/call',

  // ── 协作感知 A 层：工作状态（面板显示"两边各自在干什么"） ──
  /** 某条连接两端的工作状态快照。 */
  connectionWork: 'awareness/work',
  /** 中继运行诊断（被挡下的非真人来源计数）—— 可查询，不靠翻日志。 */
  relayDiagnostics: 'awareness/diagnostics',

  // ── 协作感知 B 层：公约盒（面板显示与编辑共享约定） ──
  /** 列出某条连接的共享约定。 */
  listConventions: 'conventions/list',
  /** 声明一条约定（用户在面板里手填）。 */
  declareConvention: 'conventions/declare',
  /** 删除一条约定。 */
  removeConvention: 'conventions/remove',
  /** 渲染公约盒文本（调试/预览用）。 */
  renderConventions: 'conventions/render',
} as const

export type RpcEndpoint = (typeof RPC_ENDPOINTS)[keyof typeof RPC_ENDPOINTS]
