/**
 * 垫片层 —— 让**普通 DSH 插件**在卡片目录里能被 import。
 *
 * ## 为什么需要（F1，已用真运行验证）
 *
 * 卡片运行时是裸 `import(url)`，没有解析钩子。插件入口在模块顶层写
 * `import { defineTool } from '@deepseek-ai/dsh-tools'`，而卡片目录向上逐级找
 * `node_modules` 时**够不到 DSH 的包** ⇒ 直接 `ERR_MODULE_NOT_FOUND`。
 *
 * ## 做法：在 `cards/` 与插件之间插一层 `node_modules`
 *
 *     <cardsRoot>/node_modules/@deepseek-ai/dsh-tools/     ← 本文件生成
 *     <cardsRoot>/node_modules/playwright-core/            ← 指向真实副本
 *     <cardsRoot>/<id>@<ver>-<fp>/lib/index.js             ← 插件（已装好的卡片）
 *
 * Node 从插件文件向上找：`<卡片目录>/node_modules`（一般没有）→ **`<cardsRoot>/node_modules`** ✓
 *
 * 这一层对**所有**适配卡共用，装一次就够，且与 DSH 的 profile **毫无关系**
 * —— 隔离承诺不变（`adapter-design.md` 护栏①）。
 *
 * ## 三类说明符，三种处理
 *
 * | 类别 | 例子 | 处理 |
 * |:--|:--|:--|
 * | node 内置 | `node:fs` | 不处理，Node 自己认 |
 * | DSH 包 | `@deepseek-ai/dsh-tools` | **两档**：能拿到真模块就 `re-export`；拿不到就用能力门面 |
 * | 第三方包 | `playwright-core` | **链接真实副本**（没法造假对象）—— 从 `depSourceDir` 解析 |
 *
 * ## 拿不到的东西要**说出来**，不能装作没事
 *
 * 第三方依赖解析不到 ⇒ 记进 `unresolved`，由调用方**明确拒绝挂载**并说清缺什么。
 * 静默继续会让插件在用到那个依赖时才炸，而那时的报错与真实原因隔着好几层。
 */
/** 垫片的 `node_modules` 里的"这是我们的目录"标记 —— 没有它就不敢往里写。 */
export declare const SHIM_MARKER = ".ccr-shim.json";
/** 三类说明符。 */
export type SpecifierKind = 'builtin' | 'dsh' | 'third-party';
/** 一个 DSH 包的解析结果。 */
export interface DshShimEntry {
    /** 包名，如 `@deepseek-ai/dsh-tools`。 */
    pkg: string;
    /** `real` = 复用了真模块；`facade` = 用了能力门面。 */
    tier: 'real' | 'facade' | 'none';
    /** tier=real 时的真模块路径。 */
    realPath?: string;
    /** tier=none 时说明为什么（没有门面可用、也拿不到真模块）。 */
    reason?: string;
}
/** 一个第三方包的处理结果。 */
export interface ThirdPartyEntry {
    pkg: string;
    /** 解析到的真实目录；未解析到时为 undefined。 */
    resolvedDir?: string;
}
/** 一次垫片规划的结果。 */
export interface ShimPlan {
    /** 垫片根（`node_modules` 的父目录）。 */
    shimRoot: string;
    dsh: DshShimEntry[];
    thirdParty: ThirdPartyEntry[];
    /** 扫到的全部裸说明符（供审计）。 */
    scanned: string[];
}
/** 判断一个说明符属于哪一类。 */
export declare function classifySpecifier(spec: string): SpecifierKind | 'relative' | 'unknown';
/** 从包名取**包根名**（`@scope/pkg/sub` → `@scope/pkg`；`pkg/sub` → `pkg`）。 */
export declare function packageRootOf(spec: string): string;
/**
 * 扫一个插件目录里用到的**裸说明符**（去重）。
 *
 * 有界：跳过 `node_modules`、只扫代码文件、限制文件数与文件大小 ——
 * 这是个体检/规划用的扫描，不是打包器。
 *
 * ## ⚠️ 为什么要能**跳过客户端产物**（实测踩到的假拒绝）
 *
 * 浏览器产物（`lib/client.js` 之类）里的 `require('react')` 是给**浏览器的模块表**用的 ✗ ——
 * 在**宿主侧**解析它**没有意义** ✗。而本函数原先扫整个插件目录 ⇒ 把这类依赖也算成
 * "宿主侧必须可解析" ⇒ **两张完全正常的插件都被假拒绝**（`react（第三方依赖未解析到）`）✗✗。
 *
 * 症状极具误导性：它看起来像"依赖没装"，实际是"**我们在用错误的解析面要求它**" ✗。
 *
 * @param options.skip 相对 `pluginDir` 的文件路径（正斜杠），不参与扫描
 */
export declare function scanBareSpecifiers(pluginDir: string, options?: {
    maxFiles?: number;
    maxBytes?: number;
    skip?: Set<string>;
}): string[];
/**
 * 试着把一个 DSH 包解析到**真模块**。
 *
 * 从 `fromDir` 出发用 `createRequire` 解析（CJS 侧解析器，对已安装包最可靠），
 * 解析成功且目标文件存在才算 `real`。
 *
 * ⚠️ 解析到"源码检出"是常见的坑：路径存在、但 `lib/index.js` 没构建出来。
 * 所以这里**必须检查文件真的可读**，不能只看解析结果。
 */
export declare function resolveRealModule(pkg: string, fromDir: string): string | undefined;
/** 某个 DSH 包有没有门面。 */
export declare function hasFacade(pkg: string): boolean;
/**
 * 规划垫片：扫说明符 → 分类 → 逐个定档。
 *
 * @param pluginDir 插件的当前所在目录（用来解析它自己的依赖）
 * @param shimRoot  垫片根（其下的 `node_modules` 会被创建）
 * @param depSourceDir 第三方依赖从哪里解析；默认同 pluginDir
 *        —— 卡片被拷进 `cards/` 后，依赖往往要从**原安装位置**解析，故可分开指定。
 */
export declare function planShims(pluginDir: string, shimRoot: string, depSourceDir?: string): ShimPlan;
/** 规划里**没法解决**的东西（调用方据此拒绝挂载并说清缺什么）。 */
export declare function unresolvedOf(plan: ShimPlan): string[];
/**
 * 写垫片。
 *
 * 安全规则（都很实在）：
 *   1. `shimRoot` 已存在但**没有我们的标记** ⇒ **拒绝写入** ——
 *      绝不能往可能属于别人的目录里塞文件。
 *   2. 幂等：内容相同就不重写（避免无谓的 mtime 变动与文件锁）。
 *   3. 只动 `node_modules/<包名>` 这一层，不碰别的。
 */
export declare function writeShims(plan: ShimPlan, facadeBaseDir: string): {
    written: number;
    skipped: number;
    linked: number;
};
/** 一行摘要，供审计。 */
export declare function describePlan(plan: ShimPlan): string;
/** 清理垫片（回退/排错用）。只删带标记的 `node_modules`。 */
export declare function removeShimRoot(shimRoot: string): boolean;
