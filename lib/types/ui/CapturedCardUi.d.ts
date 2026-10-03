/**
 * 把**适配卡插件自带的 UI** 渲染进我们的面板（而不是 DSH 全局界面）。
 *
 * ## 它怎么拿到 UI
 *
 *   1. 经 RPC 取卡片的客户端制品**源码**（宿主读文件，浏览器只拿文本）
 *   2. `captureFactory()`：临时换掉 `__ModuleLoader__`、执行源码、拿 `{ id, factory }`，**立刻还原**
 *   3. `instantiateCaptured()`：用**我们自己的 React** 调 factory，给它影子 client ctx，
 *      把它的槽位注册**捕获**下来（不注册进 DSH 的全局槽位）
 *   4. 在这里把捕获到的组件渲染出来
 *
 * ## 两个刻意的设计
 *
 * ### `require` 用我们自己的模块，不转交 DSH 的模块表
 *
 * 插件 factory 里 `require('react')` 必须拿到**同一个 React 实例**，否则 hooks 会炸。
 * 我们自己就是 DSH 的客户端插件 —— 我们 `import` 到的 React 与 DSH 交给我们的
 * 是同一份。所以只转交我们确实有的那几个（react / react/jsx-runtime / react-dom），
 * 别的**明确拒绝**并说清，而不是给个假对象让它跑到一半崩。
 *
 * ### 出错边界（ErrorBoundary）
 *
 * 渲染的是**第三方代码**。它抛错不能让整个面板白屏 —— 所以每个卡片外面包一层边界，
 * 只把这张卡片的 UI 换成一句错误说明（并记审计），面板其余部分照常。
 */
import { type ReactNode } from 'react';
import type { ConnectionCardHostClient } from '../client/host-client.js';
/**
 * 交给第三方 factory 的 `require`。
 *
 * ⚠️ 只转交我们**确实持有**的模块；未知说明符**抛错**（说清我们有什么）——
 * 给假对象会让它在更远的地方崩，那时更难查。
 */
export declare function makeMiniRequire(): (spec: string) => unknown;
export interface CapturedCardUiProps {
    client: ConnectionCardHostClient;
    instanceId: string;
    /** 显示名（卡片名 + 连接信息），用于分组标题。 */
    label: string;
    /** 诊断上报（面板把它转成 client-debug 日志）。 */
    onDiagnostic?: (message: string) => void;
}
/**
 * 渲染一张适配卡的 UI（捕获后）。
 *
 * 拿不到 UI 时**安静地不渲染**（纯能力型插件本来就没有 UI）——
 * 但"声明了却没有文件"这类矛盾会显示出来，因为那是需要人看一眼的。
 */
export declare function CapturedCardUi({ client, instanceId, label, onDiagnostic }: CapturedCardUiProps): ReactNode;
