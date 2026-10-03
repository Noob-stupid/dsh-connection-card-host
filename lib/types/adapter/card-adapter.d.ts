/**
 * 卡片适配宿主 —— 把"挂载一个普通 DSH 插件"这件事接到**卡片生命周期**上。
 *
 * 它是适配层与既有卡片系统之间的**唯一接缝**：
 *
 *     面板点「添加卡片」 → CardHost.loadCard()
 *        └─ 这张卡片的清单里有 `dshCard.adapter` 吗？
 *             有 → 交给本文件（挂载插件 + 桥接工具）
 *             没有 → 走原来的卡片路径（完全不变）
 *
 * 接缝只有这一处，是**刻意的**：适配层出问题时，能一眼看出影响面在哪；
 * 回退时也只需要拿掉这一个接缝（见 REVERT.md）。
 *
 * ## 三层闸门（缺一不可）
 *
 * 1. **总开关**（`flags.ts`，默认 OFF）—— 没开就完全不参与
 * 2. **卡片申报** —— 清单里必须有 `adapter` 段；没有的卡片行为与今天完全一致
 * 3. **能力清单** —— 逐个校验，未申报的访问当场抛错（影子 ctx）
 *
 * ## 为什么不用 CardAPI
 *
 * 普通卡片拿到的是 `CardAPI`（`api.send/on/registerTool` 那套，宿主自研协议）；
 * 而适配卡拿到的是**影子 ctx**（模拟 DSH 的插件上下文）。
 * 两者刻意不混：硬把 DSH 插件塞进 CardAPI 只会让两边语义都变形。
 */
import { ToolBridge, type BridgeDeps } from './tool-bridge.js';
import type { CardScope } from '../types/index.js';
export interface CardAdapterHostOptions extends BridgeDeps {
    /** 垫片根：其下会建 `node_modules`（= 卡片根，插件的向上查找才会命中）。 */
    shimRoot: string;
    /** 门面模块所在目录（`lib/adapter`）。 */
    facadeBaseDir: string;
    /** 调试日志（默认静默）。 */
    debug?: (message: string) => void;
}
/** 一次挂载的请求（由 CardHost 在装载适配卡时给出）。 */
export interface AdapterMountRequest {
    instanceId: string;
    cardId: string;
    /** 插件目录（卡片目录）。 */
    pluginDir: string;
    /** 能力申报（`dshCard.adapter.capabilities`）。 */
    capabilities: unknown;
    connectionId: string;
    scope?: CardScope;
    /** 第三方依赖从哪儿解析（卡片被拷进 cards/ 后，通常要从原安装位置解析）。 */
    depSourceDir?: string;
}
export declare class CardAdapterHost {
    private options;
    readonly bridge: ToolBridge;
    /** instanceId → 已挂载的插件（卸载时要 dispose）。 */
    private mounted;
    constructor(options: CardAdapterHostOptions);
    /** 总开关状态（宿主侧判定用；UI 的标注走 `adapter/status.ts`）。 */
    enabled(): boolean;
    /**
     * 挂载一张适配卡。
     *
     * @throws Error 一切可预期的拒绝都带明确原因（开关没开 / 依赖缺 / 申报缺 / apply 失败）
     */
    mount(request: AdapterMountRequest): Promise<{
        tools: number;
        pluginId: string;
    }>;
    /** 卸载一张适配卡：先摘工具（无幽灵），再释放插件资源。 */
    unmount(instanceId: string): void;
    /** 某个会话看得见的桥接工具名（供下发过滤）。 */
    visibleToolNamesForSession(sessionId: string | null): Set<string>;
    /** 插件卸载时收口：把所有适配卡卸掉。 */
    disposeAll(): void;
    /** 诊断摘要。 */
    describe(): string;
}
