/**
 * 适配层开关的**磁盘形态** —— 宿主专用（本模块会 import `node:fs`）。
 *
 * ## 为什么单独一个文件
 *
 * `flags.ts` 被 `status.ts` 引用，而 `status.ts` 的判定结果要**下发给客户端** ——
 * 那条链上任何一个模块静态引入 `node:fs`，都会把宿主能力带进浏览器包。
 * 所以：内存开关在 `flags.ts`，读盘在**这里**，只有宿主的 `index.ts` 引它。
 *
 * ## 为什么用文件当开关
 *
 * 这是一个"要用户主动做一次动作"的开关。文件的好处是**看得见、可删除、可审计**：
 * `dir` 一眼就知道开没开，`del` 就是关掉，也不受配置合并规则的意外影响。
 * 面板将来做开关按钮时，写的就是这一个文件。
 *
 * ## 默认态
 *
 * **不存在 = 关闭**。这是刻意的：适配层会加载第三方代码并注册全局工具，
 * 属于"用户没要求就不该发生"的那类行为。
 */
/** 开关文件名（放在 `$DSH_HOME/connection-cards/` 下，卡片目录的旁边）。 */
export declare const ADAPTER_FLAG_FILE = "adapter.enabled";
/** 开关文件的完整路径。 */
export declare function adapterFlagPath(baseDir: string): string;
/**
 * 从磁盘读开关状态（并在开启时同步到内存开关）。
 *
 * 规则（刻意宽松而明确）：**文件存在**且内容不是 `false`/`0`/`off`/`no` 即视为开启。
 * 理由：用户创建这个文件的**动作本身**就是意图表达；
 * 再要求他写对内容，是把仪式感当安全。
 *
 * @returns 判定结果 + 依据（供审计输出）
 */
export declare function loadAdapterFlag(baseDir: string): {
    enabled: boolean;
    reason: string;
};
