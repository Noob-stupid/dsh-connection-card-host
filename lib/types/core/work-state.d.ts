/**
 * WorkStateTracker —— 采集会话的「工作状态」。
 *
 * ## 这一层解决什么
 *
 * 消息传递回答的是「A 说了什么」；这一层回答的是「**A 在干什么**」。
 * 两个会话联通后，光能互相说话不够 —— 真正高水平的配合来自
 * 「我知道你正在动水面网格，所以我这边船体的坐标系先按你的来」，
 * 而不是等你专门说一句。
 *
 * ## 原料来自哪
 *
 * 全部从 `session/event` 里提取，不额外要模型产出任何东西：
 *
 * | 事件 | 提取出 |
 * |---|---|
 * | `tool/call` name=`todo_write` | **计划与进度**（最好用，因为是模型主动写的） |
 * | `tool/call` name=`edit`/`write`/`read` | **在动哪些文件**（`arguments.file_path`） |
 * | `tool/call` 任意 | 最近用了什么工具（判断在做哪类活） |
 * | `step/start` / `turn/start` | 推进到第几轮第几步 |
 *
 * ## 为什么要单独一层而不是塞进消息流
 *
 * 状态是**易变、连续、量大**的（一次编辑就变一次），消息是**离散、有意义**的。
 * 把状态当消息发出去会把对方淹没，也会烧掉它的上下文。
 * 所以状态**只存不发**，由对端按需拉取（工具查询 / 面板显示）。
 */
/** 一条待办（直接来自 todo_write 的参数）。 */
export interface TodoItem {
    content: string;
    status: string;
}
/** 某个会话当前的工作状态快照。 */
export interface WorkState {
    sessionId: string;
    /** 计划与进度。模型自己写的，是最能说明"在做什么"的信号。 */
    todos: TodoItem[];
    /** 最近动过的文件（绝对路径，去重，新的在前）。 */
    files: string[];
    /** 最近用过的工具名（去重，新的在前）。 */
    recentTools: string[];
    /** 最近一次动作的类型描述，如「正在编辑 src/ui/CardStack.tsx」。 */
    lastAction: string;
    /**
     * 有工具**正在执行**（`tool/call` 已发、`tool/result` 未回）时记在这里。
     *
     * 用途只有一个：**抢占式中断前判断能不能安全打断** ——
     * 工具跑一半被 cancel 会留下悬空调用，所以那时必须等它跑完。
     */
    inFlight?: {
        callId: string;
        name: string;
        since: number;
    };
    /** 推进到第几轮第几步。 */
    turn: number;
    step: number;
    /** 最后一次状态更新时刻。 */
    updatedAt: number;
}
/** 取路径最后两段，够辨认又不啰嗦。 */
export declare function shortPath(p: string): string;
export declare class WorkStateTracker {
    private states;
    private auditLog;
    constructor(auditLog: (msg: string) => void);
    /** 喂一条原始会话事件。不认识的类型直接忽略。 */
    ingest(sessionId: string, event: unknown): void;
    get(sessionId: string): WorkState | undefined;
    /**
     * 此刻**能不能安全地抢占式中断**这个会话。
     *
     * 判据不是"它忙不忙"，而是"**有没有工具正在执行**"：
     * cancel 打断一个跑一半的工具会留下悬空调用，那时必须等它跑完再动手。
     *
     * ⚠️ 三种情况都返回 true（= **不能打断**）：
     *   · 有工具在飞
     *   · 拿不到会话的工作状态（**未知 = 保守，不猜"它应该空闲"**）
     *
     * 也就是说这个函数的语义是 **fail-safe**：任何不确定都倾向于"别打断"。
     * 宁可不打断（退化成 steer，效果差一点），也不要在工具执行中 cancel（可能留悬空调用）。
     */
    busyWithTool(sessionId: string): boolean;
    /** 有工具在飞时的可读描述（写进审计/诊断）。 */
    inFlightOf(sessionId: string): {
        name: string;
        ms: number;
    } | undefined;
    /** 给工具/面板用的紧凑文本。没人看时返回 null。 */
    summarize(sessionId: string, label: string): string | null;
    /** 清掉某个会话的状态（连接断开时不必清，留着无害；会话结束时可清）。 */
    forget(sessionId: string): void;
    private ensure;
}
