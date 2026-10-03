/**
 * 挂载器 —— 把一个**普通 DSH 插件**在卡片作用域里真正跑起来。
 *
 * 流程（每一步都可能明确拒绝，且拒绝理由必须能指导下一步）：
 *
 *   1. **解析入口**：package.json 的 main → dshCard.entry → lib/index.js
 *   2. **垫片**：规划 + 写入（拿不到的东西在这里就暴露，见 shim.ts）
 *   3. **申报对账**：插件 `export const inject = ['tools', …]` 要的服务，
 *      必须被适配层的能力申报覆盖 —— 这是护栏②的"申报制"落到具体一处
 *   4. **加载模块**：import 入口（崩溃隔离：加载失败不拖垮宿主）
 *   5. **apply**：用影子 ctx 调 `apply(ctx, config)`（崩溃隔离）
 *   6. **交出结果**：捕获的工具 + 全部 disposer，由桥接层接管
 *
 * ## 为什么"申报对账"要单独做一步
 *
 * 插件的 `inject` 是它**自己声明的依赖**，而能力申报是**我们答应的供给**。
 * 两者对不上就是"我答应给你 tools，你却要 webServer" —— 这种不匹配如果不在
 * 装载前查出来，就会在插件跑到某一行时以"undefined 上取属性"的形态炸掉，
 * 而那个报错跟真实原因（服务没提供）隔着好几层。
 */
import { type CapabilityDeclaration } from './capabilities.js';
import { type ShadowCapture } from './shadow-ctx.js';
import { type ShimPlan } from './shim.js';
/** 一次挂载的输入。 */
export interface MountRequest {
    /** 插件 id（卡片 id 或包名），用于命名、审计与错误文案。 */
    pluginId: string;
    /** 插件所在目录（卡片目录 / 已安装目录）。 */
    pluginDir: string;
    /** 能力申报（`dshCard.adapter.capabilities`）。 */
    capabilities: unknown;
    /** 传给插件 `apply` 的配置（默认 `{}`）。 */
    config?: unknown;
    /** 垫片根：其下会建 `node_modules`。 */
    shimRoot: string;
    /** 门面模块所在目录（`lib/adapter`）。 */
    facadeBaseDir: string;
    /** 第三方依赖从哪里解析；默认同 pluginDir。 */
    depSourceDir?: string;
    /**
     * 由适配宿主提供的服务实例（例如按卡片实例建的 `llm` 门面）。
     *
     * ⚠️ 影子 ctx 只会把**申报过**的名字交出去（见 shadow-ctx.ts）——
     * 这里塞进来不等于插件能用。
     */
    services?: Record<string, unknown>;
}
/** 挂载结果。 */
export interface MountedPlugin {
    pluginId: string;
    dir: string;
    entry: string;
    /** 插件 `inject` 声明的服务名。 */
    injects: string[];
    capture: ShadowCapture;
    shimPlan: ShimPlan;
    /** 卸载：逆序清理 + 清空工具表。 */
    dispose: () => void;
    describe: () => string;
}
/** 挂载失败（区分"能指导下一步"的原因）。 */
export declare class MountRefused extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** 插件入口解析：main → dshCard.entry → lib/index.js。 */
export declare function resolvePluginEntry(pluginDir: string): string | undefined;
/**
 * 插件 `inject` ↔ 能力申报 的对账。
 *
 * 规则：
 *   · 插件要的每个服务，都必须在**已实现**的能力里 —— 否则拒绝，并说清要哪个
 *   · 适配层已实现、但插件**没要**的能力无所谓（多给不算错）
 *   · `effect` 属于 ctx 核心，不需要写进 inject；我们按"总是可用"处理
 */
export declare function reconcileInjects(pluginId: string, injects: string[], declaration: CapabilityDeclaration): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/**
 * 执行一次挂载。
 *
 * @throws MountRefused 一切可预期的拒绝（含明确原因）；其它异常视为缺陷。
 */
export declare function mountPlugin(request: MountRequest, audit: (message: string) => void): Promise<MountedPlugin>;
