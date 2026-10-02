/**
 * 抢占式中断（preempt）—— 让一个会话**停下当前回合**，先读你的消息。
 *
 * ## 它和现有三档的关系
 *
 * 原来只有三档，`urgent` 已经是 `steer`（在**下一个步骤边界**注入）。
 * 那已经覆盖了绝大多数"让它立刻看到"的需求 —— 所以**抢占不是拿来替代它的**。
 *
 * 抢占真正多出来的能力只有一个：**打断它正在跑的这一轮**。
 * 适用场景很窄 —— 它已经跑偏了、再跑一步就要出事，而你等不到下一步边界。
 *
 * ## 为什么默认关闭
 *
 * 因为它是**破坏性**的：被打断的那一轮，已经做的工作白费。
 * 这类能力不该默认开启 —— 你得先知道自己在要什么。
 *
 * ## 安全设计（每一条都对应一个具体的翻车方式）
 *
 * | 措施 | 防的是什么 |
 * |:---|:---|
 * | 默认关闭 | 破坏性能力不该默认开 |
 * | 需要 **write** 权限 | 只读连接不该能停别人的活 |
 * | 每连接 **5 分钟 1 次** | 防滥用、防两个会话互相打断死循环 |
 * | **`keepInbox: true`** | ⚠️ `cancel()` 默认**清空收件箱** —— 会把用户自己排队的输入 |
 * |                  | 和别的会话发来的消息**一起丢掉**。DSH 自己的停止按钮也带这个。 |
 * | 有工具在飞时不打断 | 跑一半的工具被 cancel 会留下悬空调用 |
 * | 状态未知时不打断 | **fail-safe**：不确定就退化成 steer，而不是赌一把 |
 * | 空闲时只 steer | 它本来就没在跑，cancel 无事可做 |
 *
 * ## 降级链（永远不失败）
 *
 *     空闲 / 未知 / 工具在飞  →  steer（照常投递，只是不打断）
 *     确认可安全打断          →  cancel(keepInbox) → steer
 *
 * 换句话说：**抢占失败时的行为 = 普通 urgent**，不会出现"消息发不出去"。
 */
import type { Connection } from '../types/index.js';
/** 抢占的最小间隔（毫秒）。同一个连接两次抢占之间至少要隔这么久。 */
export declare const PREEMPT_COOLDOWN_MS: number;
export declare function setPreemptEnabled(v: boolean): void;
export declare function isPreemptEnabled(): boolean;
/** 仅供测试：清掉频控记录。 */
export declare function resetPreemptCooldown(): void;
/** 放行一次抢占并记账；被频控挡住则返回还要等多久。 */
export declare function admitPreempt(connectionId: string, now?: number): {
    ok: true;
} | {
    ok: false;
    retryAfterMs: number;
};
/** 能不能对这条连接发起抢占（权限 + 开关 + 频控）。 */
export declare function canPreempt(conn: Connection, from: 'a' | 'b', now?: number): {
    ok: true;
} | {
    ok: false;
    reason: string;
    retryAfterMs?: number;
};
/**
 * 该不该真的 cancel。
 *
 * 拆成纯函数是为了**可离线断言** —— 这是整个机制里最危险的一个判断，
 * 必须有测试把每个分支钉住。
 *
 * @param phase - 对端此刻的相位
 * @returns `true` 才 cancel；`false` 一律退化成 steer
 */
export declare function shouldCancel(phase: {
    /** 对端有没有在跑（running = 有活动回合）。 */
    running: boolean;
    /** 有工具正在执行。 */
    busyWithTool: boolean;
}): {
    cancel: boolean;
    why: string;
};
/** 投递模式。 */
export type DeliverMode = 'inject' | 'queue' | 'steer';
/**
 * 紧急度 → 投递模式。
 *
 * **抽成纯函数是为了证明"新增 preempt 没有动原来三档"** ——
 * 这是用户明确问过的问题（"不会动我们之前的不紧急情况之类的消息吧"），
 * 口说无凭，用真值表钉住。
 *
 * 真值表（`running` = 对端正在跑）：
 *
 * | urgency   | running=true | running=false | 本轮是否新增 |
 * |:----------|:-------------|:--------------|:-------------|
 * | `quiet`   | inject       | inject        | 否（原样）    |
 * | `normal`  | queue        | queue         | 否（原样）    |
 * | `urgent`  | steer        | queue         | 否（原样）    |
 * | `preempt` | steer        | queue         | **是**（外加可选的 cancel） |
 *
 * 注意 `preempt` 的**投递模式与 urgent 完全相同** ——
 * 它多出来的只有 cancel 那一步，而那一步由 `shouldCancel` 单独把关。
 * 也就是说：**抢占失败时，它的行为就是 urgent，消息照样送得到。**
 */
export declare function deliverModeFor(urgency: string, running: boolean): DeliverMode;
