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
import { isAdapterEnabled } from './flags.js';
import { isImplemented, PLANNED_CAPABILITIES } from './capabilities.js';
/**
 * 判定一张适配卡的就绪状态。
 *
 * @param adapterManifest `dshCard.adapter` 段；没有则不是适配卡
 * @param enabled 适配层总开关（默认读全局，测试可注入）
 */
export function adapterStatusOf(adapterManifest, enabled = isAdapterEnabled()) {
    if (!adapterManifest) {
        return { status: 'ready', capabilities: [], reason: '', isAdapter: false };
    }
    const raw = Array.isArray(adapterManifest.capabilities) ? adapterManifest.capabilities : [];
    const capabilities = [...new Set(raw.map(String))].sort();
    // 申报里含尚未实现的能力 ⇒ 开了也挂不上。这里就直说，别让用户白开一次开关。
    const unimplemented = capabilities.filter((c) => !isImplemented(c));
    if (unimplemented.length > 0) {
        return {
            status: 'unsupported',
            capabilities,
            isAdapter: true,
            reason: `这张卡片是**适配卡**，但它申报的能力里 [${unimplemented.join(', ')}] ` +
                `在本版本尚未实现（已实现的是 tools / effect）。` +
                (PLANNED_CAPABILITIES.length > 0
                    ? `已列入计划：${PLANNED_CAPABILITIES.join(' / ')}。`
                    : ''),
        };
    }
    if (!enabled) {
        return {
            status: 'off',
            capabilities,
            isAdapter: true,
            reason: `这张卡片是**适配卡**（把一个普通 DSH 插件挂成连接上的能力：${capabilities.join(' / ') || '无'}）。` +
                `适配层默认关闭，需要显式开启后才能挂载。`,
        };
    }
    return {
        status: 'ready',
        capabilities,
        isAdapter: true,
        reason: `适配卡：${capabilities.join(' / ') || '无'}（适配层已开启）`,
    };
}
/** 候选列表里该不该让用户点。 */
export function canMountByStatus(status) {
    return status === 'ready';
}
//# sourceMappingURL=status.js.map