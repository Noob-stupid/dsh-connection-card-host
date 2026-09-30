import { permValue } from '../types/permission.js';
/** 同一个连接在每个时间窗内最多转发多少条，超过就丢弃（防对刷）。 */
const MAX_RELAY_PER_WINDOW = 12;
const RELAY_WINDOW_MS = 10_000;
/** 只读权限下不转发任何内容 —— 连接仅用于观察挂载，不做交流。 */
const MIN_LEVEL_FOR_SAY = 'suggest';
/**
 * 中继链的最大跳数。
 *
 * ## 为什么必须有
 *
 * agent 收到 user 消息就会自动回复，而**助手回复也会被中继** ——
 * 它的 `source.kind` 是 `model`，不是 plugin，光看 source 挡不住。没有上限就是无限乒乓：
 *
 *   A 回复 → 投递 B → B 自动回复 → 投递 A → A 自动回复 → …
 *
 * 频控（12 条/10 秒）只能限速、**停不下来**，所以必须用跳数硬截断：
 *   1 = 只允许 A 说的传给 B（B 的回复不外传）
 *   2 = 允许一个来回 A→B→A，之后停（默认）
 *
 * 计数是**每连接**的，且在「真实用户亲自发言」时重置 ——
 * 用户每说一句就重新获得一整条链的额度。
 */
const MAX_RELAY_HOPS = 2;
/** 投递记忆：判断后续跳属于哪条链、链走了多远。 */
const RELAY_MEMO_MS = 5 * 60_000;
/**
 * 是否把中继内容**注入**对端会话。
 *
 * ## 为什么这里需要一个开关
 *
 * 2026-09-30 事故：手搓的 message `source` 写成 V3 形状
 * `{ kind: 'plugin', plugin }`，被运行时 V4 会话格式拒绝：
 *   `format v4 message requires a producer-owned source kind`
 * 后果不是"这条消息失败"，而是**对端会话每一轮都失败**——写句柄把整批事件
 * 塞回缓冲并置 `drainPaused = true`，之后每次发言都重试同一批、每次都失败。
 *
 * 现已改为 producer-owned kind（见 session-bridge.ts 的 PLUGIN_SOURCE_KIND），
 * 并经只读巡检确认 5 个 live 会话 `badLog=0 / buffered=0 / drainPaused=false`。
 *
 * 保留这个开关的意义：注入是**能弄坏用户会话**的操作。
 * 以后若要改 source 形状，先把这里置 false 验证，再打开。
 */
const DELIVERY_ENABLED = true;
export class ConnectionRelay {
    manager;
    bridge;
    options;
    auditLog;
    off;
    /** connectionId → 时间窗内的转发时间戳。 */
    relayTimes = new Map();
    /** connectionId → 当前中继链已走的跳数（真实用户发言时归零）。 */
    hops = new Map();
    /** sessionId → 最近一次投递给它的时刻，用于判断后续跳归属。 */
    deliveredAt = new Map();
    constructor(manager, bridge, auditLog, options = {}) {
        this.manager = manager;
        this.bridge = bridge;
        this.auditLog = auditLog;
        /**
         * ⚠️⚠️ **两个都默认 false —— 中继默认不自动转发任何东西。**
         *
         * ## 为什么最终关掉了自动转发（三次同源事故之后）
         *
         * 中继只会"转发助手输出/用户输入"，但它**没有任何信息判断这条内容是不是
         * 说给对端听的**。于是它只能全发，而"全发"就等于"大部分是垃圾"：
         *
         *   1. **用户给 A 下的指令被镜像给 B** → B 当成自己的任务去做（用户报的）
         *   2. **我的助手汇报被镜像** → 对端当成用户指令去响应（对端报的）
         *   3. **我对用户说的旁白被镜像** → 对端界面显示「收到执行请求」并**真的跑了一轮**
         *      （用户截图指出：「你这段为啥要发过去？」）
         *
         * 对端量化过代价：**30 条 / 12,765 字的镜像占它会话"用户侧字符"的 77.8%**
         *（它自己真人的输入才 3,653 字），而其中大部分与它无关。
         *
         * 前两次我都在"标注"上打补丁（先把 relayUser 关掉、再加 form 字段与提示前缀），
         * 但那都只是**告诉接收方"这条不是给你的"** —— 它**仍然会收到、仍然被唤醒、仍然烧上下文**。
         * 第三次用户直接问"为啥要发过去"，答案是不发才对。
         *
         * ## 那跨会话传话怎么办
         *
         * 走**显式发送**（`messages/send` / 面板发送框 / 助手调工具）：
         * 你想发才发，发完即止。**感知**则由 A 层（工作状态）与 B 层（公约盒）承担 ——
         * 两者都是**拉取式、0 上下文成本、不会迫使对方行动**。
         *
         * 真正的"两个会话自由对话"是另一个形态（要显式的开始/结束与边界），
         * 不该以"常驻静默转发"的形式存在。
         *
         * 需要临时打开自动转发时，构造时显式传 `{ relayAssistant: true }`。
         */
        this.options = { relayAssistant: false, relayUser: false, ...options };
    }
    start() {
        if (this.off)
            return;
        this.off = this.bridge.observe((activity) => {
            void this.onActivity(activity);
        });
        this.auditLog(`中继已启动（自动转发：助手=${this.options.relayAssistant ? '开' : '关'} ` +
            `用户=${this.options.relayUser ? '开' : '关'}）`);
    }
    /**
     * 当前的中继配置（面板据此判断"到底有没有在自动转发"）。
     *
     * 为什么需要：面板的警告条早先是按**权限档位**判断的，但自动转发在
     * 2026-10-01 已默认关闭 —— 两者解耦了。只看权限会让 UI 喊狼来了
     *（显示"正在互相转发消息"而实际什么都没转发）。
     */
    config() {
        return {
            relayAssistant: this.options.relayAssistant === true,
            relayUser: this.options.relayUser === true,
        };
    }
    stop() {
        this.off?.();
        this.off = undefined;
        this.auditLog('中继已停止');
    }
    /** 一条会话活动 → 可能触发多条连接的中继。 */
    async onActivity(activity) {
        if (activity.role === 'user' && !this.options.relayUser)
            return;
        if (activity.role === 'assistant' && !this.options.relayAssistant)
            return;
        if (activity.fromPlugin)
            return; // 防回环：本插件投递进来的不再外传
        // 这个会话参与的所有连接
        const connections = this.manager.getBySession(activity.sessionId);
        for (const conn of connections) {
            // 判断说话的是哪一端
            const from = conn.sessionA === activity.sessionId
                ? 'a'
                : conn.sessionB === activity.sessionId
                    ? 'b'
                    : null;
            if (!from)
                continue;
            const peerSessionId = from === 'a' ? conn.sessionB : conn.sessionA;
            const direction = from === 'a' ? 'aToB' : 'bToA';
            const level = conn.permission[direction];
            // ── 跳数控制：防止「A 回复→B 自动回复→投递 A→…」的无限乒乓 ──
            // 助手回复的 source 是 model 不是 plugin，光看 source 挡不住，必须计数。
            // 真实用户亲自发言 → 链归零，这一跳算第 1 跳；
            // 由中继消息触发的回复 → 链上后续跳，累加。
            const isChainReply = activity.role === 'assistant' && activity.relayTriggered;
            const justDeliveredTo = (this.deliveredAt.get(activity.sessionId) ?? 0) > Date.now() - RELAY_MEMO_MS;
            let hop;
            if (isChainReply && justDeliveredTo) {
                hop = (this.hops.get(conn.id) ?? 0) + 1;
            }
            else {
                hop = 1;
                this.hops.set(conn.id, 0);
            }
            if (hop > MAX_RELAY_HOPS) {
                this.auditLog(`中继停止（已达 ${MAX_RELAY_HOPS} 跳上限，避免无限乒乓）: ${conn.id}`);
                continue;
            }
            // 权限闸门：读权限不外传（连接仅用于挂载观察，不做交流）
            if (permValue(level) < permValue(MIN_LEVEL_FOR_SAY)) {
                this.auditLog(`中继跳过（${direction}=${level} 低于 ${MIN_LEVEL_FOR_SAY}）: ${conn.id}`);
                continue;
            }
            // 频控
            if (!this.withinRate(conn.id)) {
                this.auditLog(`中继节流: ${conn.id}`);
                continue;
            }
            // 写入连接交流记录（两端共享，面板能看到）
            //
            // ⚠️ 一律用 `say`：中继转发的是**发言**，不是"请求对方执行动作"。
            // 之前按角色分 kind（user→say、assistant→reply），而 reply 在
            // messages 的闸门里要求 write 权限 —— 结果 relay 闸门（suggest）放行了，
            // 写日志时又被拒，两个阈值打架，中继永远写不进去。
            // `ask`/`reply` 留给卡片/工具显式发起的结构化请求（那才需要 write）。
            const kind = 'say';
            const label = activity.role === 'assistant' ? '对方助手' : '对方用户';
            const result = this.manager.messages.append(conn, from, kind, `【${label}】${activity.text}`, 
            // ⚠️ 必须标 origin='relay'：频控按来源分桶。
            // 否则中继自己这条写入会刷新"手动发送"的间隔时间戳，
            // 用户紧接着只按一次发送就可能被误判成"发送过于频繁"。
            { origin: 'relay' });
            if (!result.ok) {
                this.auditLog(`中继写入被拒（${result.reason}）: ${conn.id}`);
                continue;
            }
            this.manager.persistMessages(conn.id);
            // 投递给对端会话，让它的 agent 能感知
            if (!DELIVERY_ENABLED) {
                this.auditLog(`中继已记录但未注入（DELIVERY_ENABLED=false）: ${conn.id} ${from}→${from === 'a' ? 'b' : 'a'}`);
                continue;
            }
            const delivered = await this.bridge.deliver(peerSessionId, 
            // 前缀必须让**接收方一眼看出这是信息不是任务** —— 对端会话曾把镜像
            // 过来的汇报当成"用户对我的指令"去做（见 deliver() 的 form 说明）。
            `[对方进展 · 自动同步，不是派给你的活] ${activity.text}`, 
            // 自动同步一律走「排队」：它是信息不是急事，不该打断对端（也不该不唤醒 ——
            // 那样它就永远看不到了）。
            'normal', 'mirror');
            if (delivered.ok) {
                // 记录链进度与投递时刻：后续跳据此判断归属与是否越界
                this.hops.set(conn.id, hop);
                this.deliveredAt.set(peerSessionId, Date.now());
                this.auditLog(`中继 ${conn.id} ${from}→${from === 'a' ? 'b' : 'a'} hop=${hop} via=${delivered.via}: ${activity.text.slice(0, 60)}`);
            }
            else {
                this.auditLog(`中继投递失败（对端感知不到）: ${delivered.reason}`);
            }
        }
    }
    /** 滑动窗口频控。 */
    withinRate(connectionId) {
        const now = Date.now();
        const times = (this.relayTimes.get(connectionId) ?? []).filter((t) => now - t < RELAY_WINDOW_MS);
        if (times.length >= MAX_RELAY_PER_WINDOW) {
            this.relayTimes.set(connectionId, times);
            return false;
        }
        times.push(now);
        this.relayTimes.set(connectionId, times);
        return true;
    }
}
//# sourceMappingURL=relay.js.map