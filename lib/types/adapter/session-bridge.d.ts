/**
 * SessionBridge — 宿主 ↔ 会话 的桥。
 *
 * 这是「A 说话 B 能感知」的实现层。两个方向：
 *   - observe：`ctx.on('session/event', (session, event) => ...)`
 *     宿主级监听**收到所有会话**的事件（无 scope 的监听器 = 全局）。
 *   - deliver：`ctx.agents.get(sessionId)` → `agent.followup(msg)` 投递并唤醒；
 *     只想让对方"看到但先别动"用 `agent.inject(msg)`（不唤醒 driver）。
 *
 * ## 为什么全部走 safeCtxGet + 形状探测，而不是 import
 *
 * 本插件不 import 任何 `@deepseek-ai/*` 运行时代码（除了 cordis 类型），
 * 原因是**开发用的 checkout 与真实运行时差一个大版本**（0.1.0-rc.5 vs 0.2.0-rc.2），
 * 硬 import 会在另一边直接崩。实测差异包括：
 *   - `session.events`       → runtime 已删，改 `snapshotEvents()`
 *   - `assistant/chunk`      → runtime 已删，改 `assistant/attempt`
 *   - `ctx.sessionController`→ 仅 runtime 有
 * 所以这里只按"两个版本的交集 + 形状探测"写，拿不到就诚实报错，绝不猜。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 观察到的会话活动。 */
export interface SessionActivity {
    sessionId: string;
    /** 谁说的：user=用户输入，assistant=模型输出 */
    role: 'user' | 'assistant';
    text: string;
    /** 事件序号（会话内单调递增），用于去重/断点续读。 */
    seq: number;
    /** 这条消息的来源是不是本插件投递的（防回环用）。 */
    fromPlugin: boolean;
    /**
     * 这轮回复是否由本插件投递的消息触发 —— 即它处在中继链的后续跳上。
     *
     * 为什么需要单独一个标志：助手消息的 `source.kind` 是 `model`，不是 plugin，
     * 所以光看 source 挡不住「收到中继消息后自动回复、回复又被中继出去」的无限乒乓。
     * 判据是**该会话最近一条 user 消息是不是我们投递的**。
     */
    relayTriggered: boolean;
}
export interface DeliverResult {
    ok: boolean;
    /** 实际走通的通道，便于诊断。 */
    via?: 'sessionController' | 'agents.steer' | 'agents.followup' | 'agents.inject';
    /** 实际使用的投递模式：steer=即时插话，queue=排队到下一轮。 */
    mode?: 'steer' | 'queue';
    /** 投递时对端是否处于活跃状态（false = 把它冷启动唤醒了）。 */
    live?: boolean;
    reason?: string;
}
/** 投递时写的 source.plugin 标识，用于回环识别。 */
export declare const PLUGIN_SOURCE = "dsh-connection-card-host";
/**
 * 投递时写进 `source.kind` 的 **producer-owned kind**。
 *
 * 会话消息格式升到 V4 后（框架 0.1.7-rc.1 起），每条被解释的消息 source
 * 都必须带一个「生产方自己的 kind」——非空、且**不能**是字面量 `'plugin'`
 * （那是已退役的 V3 包装）。写错这一个字，收端一开会话就报
 * `format v4 message requires a producer-owned source kind`，整个会话卡死。
 * 第三方插件的规范形状是 `plugin:<包名>`，与框架自带的 V3→V4 迁移器一致。
 */
export declare const PLUGIN_SOURCE_KIND = "plugin:dsh-connection-card-host";
export declare class SessionBridge {
    private ctx;
    private listeners;
    private off;
    private auditLog;
    /** 记录本插件投递过的 sessionId，投递瞬间到达的 session/event 据此忽略。 */
    private delivering;
    /**
     * 能读到 `sessionController` 的上下文。
     *
     * 为什么要单独存一个 ctx：cordis 是 Proxy，**没在 inject 里声明的服务读不到**。
     * `sessionController` 只在 runtime 0.2+ 有，不能放进静态 inject 数组
     * （那会让插件在旧版本上直接不加载），只能用 `ctx.inject([...], cb)` 拿一个
     * 已声明该服务的 scope，再从这里做查找。
     *
     * 它值钱的地方：`sessionController.prompt()` 是「**活则复用、冷则 resume**」——
     * 对端没打开时能把它**唤醒**，而不是投递失败。
     */
    private controllerCtx;
    /** 原始会话事件订阅者（不过滤事件类型）。 */
    private rawHandlers;
    /**
     * 订阅**全部**会话事件（含 tool/call、step/start 等）。
     *
     * 与 `observe()` 的区别：那个只放行 user/assistant **消息**（"发言"），
     * 这个放行一切（"工作状态"的原料：在调什么工具、动哪个文件、走到第几步）。
     * 两条流互不影响。
     */
    observeRaw(handler: (sessionId: string, event: unknown) => void): () => void;
    /** 接入一个声明了 sessionController 的上下文（冷会话唤醒通道）。 */
    attachControllerContext(ctx: Context): void;
    constructor(ctx: Context, auditLog?: (msg: string) => void);
    /** 能力探测：投递通道是否可用。 */
    capabilities(): {
        observe: boolean;
        deliver: boolean;
        via: string[];
        notes: string[];
    };
    /**
     * 开始观察所有会话的用户/助手消息。
     * @param handler 每条消息回调一次
     * @returns 停止观察
     */
    observe(handler: (activity: SessionActivity) => void): () => void;
    /**
     * 该会话**最近一条 user 消息**是不是本插件投递的。
     *
     * 用来判断"这一轮助手回复是不是中继链的后续跳" —— 助手消息自身的 source
     * 永远是 model，看不出它是不是被中继消息触发的，只能回溯它回应的是谁。
     *
     * 判据可靠的原因：投递的 user 消息会先被 append 进会话日志，agent 才会开始跑这一轮；
     * 所以 assistant/message 事件到达时，那条 user 消息一定已经在了。
     */
    private lastUserWasFromPlugin;
    /**
     * 把一段文本投递给某个会话，使其 agent 能感知。
     *
     * 三条路径按可靠性依次尝试：
     *   1. `ctx.sessionController.prompt({...})` —— runtime 官方入口，活/冷会话统一
     *   2. `ctx.agents.get(id).followup(msg)` —— 两个版本都有，但只对**内存里活着**的会话有效
     *   3. `agent.inject(msg)` —— 只入上下文不唤醒（followup 不可用时的兜底）
     *
     * @param sessionId 目标会话
     * @param text 文本
     * @param wake 是否唤醒对方（false = 只让它下次被唤醒时看到）
     */
    deliver(sessionId: string, text: string, wake?: boolean): Promise<DeliverResult>;
    /** 读取某会话最近的消息历史（诊断/工具用）。 */
    readRecent(sessionId: string, limit?: number): {
        role: string;
        text: string;
    }[];
    dispose(): void;
}
