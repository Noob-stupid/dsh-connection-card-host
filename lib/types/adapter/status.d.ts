/**
 * 适配卡的**状态判定** —— 候选列表要据此决定"能不能点"。
 *
 * 用户裁决 D6：适配卡在候选列表里**照常显示、带「适配」标注**；
 * 未就绪时**置灰并说明原因**。理由：让用户看见"这东西在这儿、需要开一下"，
 * 而不是点了撞墙（选项 1）或以为"下载没成功"（选项 3）。
 *
 * 这里是**纯函数**：宿主侧的 `listTemplates` 调它填状态，离线测试直接断言它。
 * 状态判定散进 UI 的话，改一处忘一处，用户看到的标注就会与实际行为不符。
 */
/** 适配卡在候选列表里的就绪状态。 */
export type AdapterStatus = 
/** 申报齐全、能力都实现了，且适配层已开启 —— 可以挂载。 */
'ready'
/** 一切齐全，但**总开关没开**（默认 OFF）。 */
 | 'off'
/** 申报里含**本版本尚未实现**的能力 —— 即使开了也挂不上。 */
 | 'unsupported';
/** 判定结果（直接喂给 UI）。 */
export interface AdapterStatusInfo {
    status: AdapterStatus;
    /** 申报的能力清单（已归一化）。 */
    capabilities: string[];
    /** 面向用户的一句话说明（置灰时的悬停提示）。 */
    reason: string;
    /** 该插件是否为适配卡（即清单里有没有 adapter 段）。 */
    isAdapter: boolean;
}
/**
 * 判定一张适配卡的就绪状态。
 *
 * @param adapterManifest `dshCard.adapter` 段；没有则不是适配卡
 * @param enabled 适配层总开关（默认读全局，测试可注入）
 */
export declare function adapterStatusOf(adapterManifest: {
    capabilities?: unknown;
} | undefined, enabled?: boolean): AdapterStatusInfo;
/** 候选列表里该不该让用户点。 */
export declare function canMountByStatus(status: AdapterStatus): boolean;
