/**
 * 客户端 UI 捕获 —— 把**普通 DSH 插件**的 UI 拿到我们的面板里渲染。
 *
 * ## 依据：客户端制品的真实形态（已核实）
 *
 * 官方模板与**我们自己的** `lib/client.js` 是同一形状：
 *
 * ```js
 * window.__ModuleLoader__.load({
 *   id: '@local/my-decoration',
 *   factory(require) {           // ← 普通函数，返回 { inject, apply(ctx) }
 *     const React = require('react')
 *     return { inject: ['slots'], apply(ctx) { ctx.slots.register({…}, Component) } }
 *   },
 * })
 * ```
 *
 * 关键点：**factory 是普通函数**，不是必须由 DSH 加载器实例化的黑盒。
 * 所以我们可以自己调它、自己给影子 ctx，把它的槽位注册**捕获**下来。
 *
 * ## 四步（与 adapter-design.md §4 对应）
 *
 * 1. 宿主把客户端制品源码送到浏览器（RPC，见 card-host/client-artifact.ts）
 * 2. **临时替换** `__ModuleLoader__` 为捕获桩，执行源码 → 拿到 `{ id, factory }` → **立刻还原**
 * 3. 用**我们自己的 `require`** 调 factory（同一份 React 实例），
 *    再给它一个**影子 client ctx**（只有 `slots`/`effect`，其余访问当场抛错）
 * 4. 把捕获到的组件交给面板渲染；卸载时执行登记的清理
 *
 * ## 不做的事（划清边界）
 *
 * · **不加载它的 client 入口到 DSH 的全局槽位** —— 那样 UI 就会出现在全局界面，
 *   而用户要的正是"只在连接面板里"
 * · 不碰 app root（官方 UI 指引明确禁止）
 * · 服务依赖拿不到就**明确失败**，不"忽略后祈祷不崩"
 */
/** 客户端制品里的一个槽位注册。 */
export interface CapturedRegistration {
    /** 槽位名（插件写死的那个，例如 `sidebar.panellist`）。 */
    slot: string;
    /** 注册 id（插件给的）。 */
    id?: string;
    /** 组件（React 组件或渲染函数，原样交给面板）。 */
    component: unknown;
    /** 该次注册返回的清理函数（如果有）。 */
    dispose?: () => void;
}
/** factory 的形态。 */
export interface CapturedFactory {
    id: string;
    factory: (require: (spec: string) => unknown) => unknown;
}
/** 捕获 factory：临时换掉 __ModuleLoader__，执行源码，然后还原。 */
export declare function captureFactory(source: string, target?: Record<string, unknown>): CapturedFactory;
/** 影子 client ctx 的界面。 */
export interface ShadowClientCtx {
    registrations: CapturedRegistration[];
    disposers: {
        label: string;
        fn: () => void;
    }[];
    warnings: string[];
}
/**
 * 用影子 client ctx 实例化捕获到的 factory。
 *
 * @param require 浏览器模块表（**用我们自己的** —— 保证 React 等是同一个实例）
 * @param onWarn 拿不到的服务等情况的说明（走审计/诊断，不静默）
 */
export declare function instantiateCaptured(captured: CapturedFactory, require: (spec: string) => unknown, onWarn?: (message: string) => void): ShadowClientCtx;
/** 执行全部清理（逆序）。 */
export declare function disposeCaptured(shadow: ShadowClientCtx): void;
