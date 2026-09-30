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
/** 每个会话最多记多少个文件 / 工具，避免无界增长。 */
const MAX_FILES = 12;
const MAX_TOOLS = 10;
/** 从 arguments 里安全取出 file_path（各工具的字段名可能不同）。 */
function filePathOf(args) {
    let obj = args;
    if (typeof args === 'string') {
        try {
            obj = JSON.parse(args);
        }
        catch {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object')
        return null;
    const rec = obj;
    for (const key of ['file_path', 'filePath', 'path', 'notebook_path']) {
        const v = rec[key];
        if (typeof v === 'string' && v.length > 0)
            return v;
    }
    return null;
}
/** 从 arguments 里解析 todo_write 的 todos。 */
function todosOf(args) {
    let obj = args;
    if (typeof args === 'string') {
        try {
            obj = JSON.parse(args);
        }
        catch {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object')
        return null;
    const raw = obj.todos;
    if (!Array.isArray(raw))
        return null;
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object')
            continue;
        const rec = item;
        if (typeof rec.content !== 'string')
            continue;
        out.push({
            content: rec.content,
            status: typeof rec.status === 'string' ? rec.status : 'pending',
        });
    }
    return out.length > 0 ? out : null;
}
/** 取路径最后两段，够辨认又不啰嗦。 */
export function shortPath(p) {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.slice(-2).join('/');
}
export class WorkStateTracker {
    states = new Map();
    auditLog;
    constructor(auditLog) {
        this.auditLog = auditLog;
    }
    /** 喂一条原始会话事件。不认识的类型直接忽略。 */
    ingest(sessionId, event) {
        const ev = event;
        const type = ev?.type;
        if (typeof type !== 'string')
            return;
        const state = this.ensure(sessionId);
        const data = ev?.data;
        if (type === 'turn/start') {
            state.turn = num(data?.turn) ?? state.turn + 1;
            state.step = 0;
            state.updatedAt = Date.now();
            return;
        }
        if (type === 'step/start') {
            state.turn = num(data?.turn) ?? state.turn;
            state.step = num(data?.step) ?? state.step;
            state.updatedAt = Date.now();
            return;
        }
        if (type !== 'tool/call')
            return;
        const name = typeof data?.name === 'string' ? data.name : '';
        if (name.length === 0)
            return;
        state.turn = num(data?.turn) ?? state.turn;
        state.step = num(data?.step) ?? state.step;
        state.updatedAt = Date.now();
        // 工具名：去重，新的在前
        if (state.recentTools[0] !== name) {
            state.recentTools = [name, ...state.recentTools.filter((t) => t !== name)].slice(0, MAX_TOOLS);
        }
        // 计划与进度（最有价值的信号）
        if (name === 'todo_write') {
            const todos = todosOf(data?.arguments);
            if (todos) {
                state.todos = todos;
                const done = todos.filter((t) => t.status === 'completed').length;
                const now = todos.find((t) => t.status === 'in_progress');
                state.lastAction = now
                    ? `更新计划（${done}/${todos.length} 完成）：正在做「${now.content}」`
                    : `更新计划（${done}/${todos.length} 完成）`;
            }
            return;
        }
        // 文件动作
        const fp = filePathOf(data?.arguments);
        if (fp) {
            state.files = [fp, ...state.files.filter((f) => f !== fp)].slice(0, MAX_FILES);
            const verb = name === 'edit'
                ? '正在编辑'
                : name === 'write'
                    ? '正在写入'
                    : name === 'read'
                        ? '正在查看'
                        : `正在对 ${name} 操作`;
            state.lastAction = `${verb} ${shortPath(fp)}`;
            return;
        }
        // 其他工具：给个动作描述
        if (name === 'pwsh' || name === 'bash') {
            state.lastAction = '正在执行命令';
        }
        else if (name === 'grep' || name === 'glob') {
            state.lastAction = '正在搜索代码';
        }
        else {
            state.lastAction = `正在调用 ${name}`;
        }
    }
    get(sessionId) {
        return this.states.get(sessionId);
    }
    /** 给工具/面板用的紧凑文本。没人看时返回 null。 */
    summarize(sessionId, label) {
        const s = this.states.get(sessionId);
        if (!s || s.updatedAt === 0)
            return null;
        const lines = [`【${label}】`];
        const age = Math.round((Date.now() - s.updatedAt) / 1000);
        lines.push(age < 60
            ? `状态：${s.lastAction || '空闲'}（${age} 秒前）`
            : `状态：${s.lastAction || '空闲'}（${Math.round(age / 60)} 分钟前）`);
        if (s.todos.length > 0) {
            const done = s.todos.filter((t) => t.status === 'completed').length;
            lines.push(`计划（${done}/${s.todos.length}）：`);
            // 只列未完成的，最多 6 条 —— 完成的没必要占地方
            const open = s.todos.filter((t) => t.status !== 'completed').slice(0, 6);
            for (const t of open) {
                lines.push(`  ${t.status === 'in_progress' ? '▶' : '·'} ${t.content}`);
            }
            if (open.length === 0)
                lines.push('  （全部完成）');
        }
        if (s.files.length > 0) {
            lines.push(`最近动过的文件：${s.files.slice(0, 6).map(shortPath).join('、')}`);
        }
        if (s.turn > 0)
            lines.push(`进度：第 ${s.turn} 轮 / 第 ${s.step} 步`);
        return lines.join('\n');
    }
    /** 清掉某个会话的状态（连接断开时不必清，留着无害；会话结束时可清）。 */
    forget(sessionId) {
        this.states.delete(sessionId);
    }
    ensure(sessionId) {
        let s = this.states.get(sessionId);
        if (!s) {
            s = {
                sessionId,
                todos: [],
                files: [],
                recentTools: [],
                lastAction: '',
                turn: 0,
                step: 0,
                updatedAt: 0,
            };
            this.states.set(sessionId, s);
        }
        return s;
    }
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
//# sourceMappingURL=work-state.js.map