/**
 * 安装包体检 —— **两种来源都要能装**。
 *
 * ## 为什么要支持两种
 *
 * 用户的原话点破了这件事：
 *
 *   > 肯定是要可以装普通 dsh 插件包啊，因为你经常搜到的会话能力相关的就是普通插件包啊
 *
 * 也就是说：**"能提升会话能力的东西"绝大多数就是普通 DSH 插件**，
 * 而不是专门为我们协议写的卡片包。只收 `dshCard` 等于把最有用的一类挡在门外。
 *
 * ## 两种来源
 *
 * | 来源 | 判别 | 处理 |
 * |:--|:--|:--|
 * | **卡片包** | 自带 `dshCard` 字段 | 照原样（现状不动） |
 * | **普通 DSH 插件包** | 没有 `dshCard`，但像 DSH 插件 | **合成适配清单**，按**适配卡**装载 |
 *
 * ## "像 DSH 插件"的判据（任一命中）
 *
 *   1. 有 `dsh` 字段（dsh.bundle.patch —— 官方插件形态）
 *   2. peerDependencies 里声明了 `@deepseek-ai/*`
 *   3. 入口源码里 import 了 `@deepseek-ai/*`
 *
 * 第 3 条是**最实在**的一条：前两条是"自称"，这一条是"实际依赖"。
 *
 * ## 合成出来的清单长什么样
 *
 * ```jsonc
 * "dshCard": {
 *   "id": "<包名>",
 *   "name": "<包名>",
 *   "entry": "<main 或 lib/index.js>",
 *   "adapter": { "capabilities": ["tools", "effect"] }   // 最小能力面
 * }
 * ```
 *
 * 能力面**只报最小集**（`tools` + `effect`）是刻意的：
 * 我们无法静态推断插件要用什么，与其猜一个大集合，不如报最小的、
 * 让**装载时的申报对账**去拒绝它（`reconcileInjects` 会明确说缺哪个服务）。
 * 那时用户看到的是一句人话，而不是"运行到某一行才炸"。
 */
/** 体检结果。 */
export interface PackageCheck {
    ok: boolean;
    reason?: string;
    id?: string;
    name?: string;
    version?: string;
    entry?: string;
    /** 来源形态：卡片包 / 普通 DSH 插件包（后者要合成适配清单）。 */
    kind?: 'card' | 'dsh-plugin';
}
/** 合成适配卡清单时用的**最小能力面**（见文件头说明）。 */
export declare const ADAPTER_DEFAULT_CAPABILITIES: readonly ["tools", "effect"];
interface PackageJson {
    name?: string;
    version?: string;
    main?: string;
    dsh?: unknown;
    dshCard?: {
        id?: string;
        name?: string;
        entry?: string;
        adapter?: unknown;
    };
    peerDependencies?: Record<string, string>;
}
/** 这个包像不像一个普通 DSH 插件（见文件头三条判据）。 */
export declare function looksLikeDshPlugin(dir: string, pkg: PackageJson, entry: string): boolean;
/**
 * 体检一个安装来源目录。
 *
 * 两种来源都接受；都不是则给出**能指导下一步**的拒绝理由。
 */
export declare function checkPackage(dir: string): PackageCheck;
/**
 * 把合成的适配清单写进**已安装的副本**。
 *
 * ⚠️ 只动 `destDir` —— 也就是我们拷贝出来的那一份；**原始来源一个字节都不碰**。
 * 版本化目录名由来源指纹决定，改副本不影响幂等判断（指纹取自来源，不是副本）。
 *
 * @returns 是否真的写了（已经是适配卡则不动）
 */
export declare function ensureAdapterManifest(destDir: string, synth: {
    id: string;
    name: string;
    entry: string;
}): {
    patched: boolean;
    reason?: string;
};
export {};
