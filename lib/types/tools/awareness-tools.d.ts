/**
 * 协作感知工具 —— 让参与的会话能「看到对方在干什么」和「查到我们说好了什么」。
 *
 * ## 为什么是工具（拉），不是消息（推）
 *
 * 状态和约定如果靠推送，会把对方上下文慢慢填满，而且**大部分时候它根本用不上**。
 * 做成工具则是：**工具 schema 常驻上下文（零成本），内容按需拉取（想不起来就不拉）**。
 * 模型每次思考都看得到「有这么个东西可以查」——这本身就是最好的提醒。
 *
 * ## 怎么知道是谁在问
 *
 * `exec.agent`（`ToolExecutionInput.agent`，「set by the agent loop」）就是调用者，
 * `agent.id` 即会话 id。有了它才能反查「这个会话参与了哪些连接」。
 *
 * ## 为什么手搓 ToolDefinition 而不 import defineTool
 *
 * `ToolSchema.parameters` 的类型就是 `Record<string, unknown>`（原始 JSON Schema），
 * 手搓零依赖、跨版本最稳。`defineTool` 是另一套 schema DSL，版本差异会直接炸在注册时。
 */
import type { ConnectionCardHostService } from '../adapter/stable-api.js';
export interface AwarenessToolDeps {
    service: ConnectionCardHostService;
    auditLog: (msg: string) => void;
}
/**
 * 注册三个感知工具，返回卸载函数。
 *
 * `tools.register` 返回的是 dispose 函数，必须挂到 ctx.effect 上，
 * 否则插件卸载后工具还留在注册表里（会指向已释放的闭包）。
 */
export declare function registerAwarenessTools(tools: {
    register(definition: unknown): () => void;
}, deps: AwarenessToolDeps): () => void;
