/**
 * 下发时过滤的**安装器** —— 把桥接过滤挂到 `system-prompt/assemble` 瀑布上。
 *
 * 与既有的 `installToolScoping`（隐藏 `connection_*`）并列，**互不改动**：
 * 两个钩子各管各的工具前缀，顺序无关紧要（各自只动自己认识的名字）。
 * 这样做的理由是回退：适配层出问题时，删掉这一个钩子即可，
 * 不用碰已经稳定运行的 tool-scoping。
 *
 * ## 纪律
 *
 * · **fail-open**：任何一步拿不准（形态不对 / 抛错）都原样放行 ——
 *   过滤只是省 token 与避免误导，**真正的闸门是调用时校验**；
 *   而误删一个该有的工具，用户看到的是"能力凭空消失"，更难查。
 * · 只动**自己知道**的桥接工具名，别人的工具一个都不碰。
 */
import { type ToolBridge } from './tool-bridge.js';
/** 与既有 installer 相同的 `on` 签名（`ctx.on` 的绑定版）。 */
export type AssembleHook = (event: string, handler: (...args: unknown[]) => unknown) => () => void;
export interface BridgedFilterDeps {
    bridge: ToolBridge;
    audit: (message: string) => void;
    debug?: (message: string) => void;
}
/**
 * 挂上桥接过滤。
 *
 * @returns 卸载函数（挂到 `ctx.effect` 上，照既有做法）
 */
export declare function installBridgedFilter(on: AssembleHook, deps: BridgedFilterDeps): () => void;
