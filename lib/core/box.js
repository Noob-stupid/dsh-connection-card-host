/**
 * ConventionBox —— 连接级的「公约盒」。
 *
 * ## 与 WorkState 的区别（不要混）
 *
 * | | 工作状态 | 公约盒 |
 * |---|---|---|
 * | 内容 | 你现在在干嘛 | 我们说好了什么 |
 * | 来源 | **自动采集**（工具事件） | **显式声明**（有人郑重放进去） |
 * | 生命周期 | 易变，随会话活动滚动 | 持久，跨轮次保留 |
 * | 谁关心 | 对方想知道进展时 | 双方干活时必须遵守 |
 *
 * ## 为什么是「拉」不是「推」
 *
 * 约定如果靠推送（每更新一次就往对方上下文塞一条），会有两个问题：
 *   1. 对方上下文被慢慢填满，而且**大部分时候它根本用不上**
 *   2. 越堆越多，旧摘要会淹没新内容
 *
 * 所以约定**只存不发**，由使用方**需要时自己来查**。
 * 而"想不起来查"的问题由工具本身解决 —— 工具 schema 常驻在上下文里，
 * 模型每次思考都看得到「有个公约盒可以查」，这**不额外花一分上下文**。
 *
 * ## 什么该放进来
 *
 * 判断标准：**对方不知道就会做错的东西。**
 *   ✅ 接口/字段名、坐标约定、单位、命名规范、文件分工边界
 *   ❌ 进度、临时状态、寒暄
 */
/** 单个连接最多存多少条（超出丢最旧的、已被取代的优先丢）。 */
const MAX_CONVENTIONS = 80;
/** 单条正文上限。 */
const MAX_TEXT = 2000;
export class ConventionBox {
    byConnection = new Map();
    /** 载入持久化数据。 */
    hydrate(connectionId, list) {
        this.byConnection.set(connectionId, [...list]);
    }
    /** 导出某条连接的全部约定（用于持久化）。 */
    dump(connectionId) {
        return [...(this.byConnection.get(connectionId) ?? [])];
    }
    getAll() {
        const out = {};
        for (const [id, list] of this.byConnection) {
            if (list.length > 0)
                out[id] = [...list];
        }
        return out;
    }
    add(connectionId, by, topic, text, supersedes) {
        const clean = text.trim();
        if (clean.length === 0)
            return { ok: false, reason: '约定内容不能为空' };
        if (clean.length > MAX_TEXT) {
            return { ok: false, reason: `约定内容过长（上限 ${MAX_TEXT} 字）` };
        }
        const list = this.byConnection.get(connectionId) ?? [];
        const conv = {
            id: `cv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            by,
            topic: topic.trim() || '一般',
            text: clean,
            createdAt: Date.now(),
        };
        // 标记被取代的那条（不删，保留追溯）
        if (supersedes) {
            const old = list.find((c) => c.id === supersedes);
            if (old)
                old.supersededBy = conv.id;
        }
        list.push(conv);
        // 超限时优先丢「已被取代的」中最旧的
        if (list.length > MAX_CONVENTIONS) {
            const idx = list.findIndex((c) => c.supersededBy !== undefined);
            list.splice(idx >= 0 ? idx : 0, 1);
        }
        this.byConnection.set(connectionId, list);
        return { ok: true, convention: conv };
    }
    /** 列出约定；默认不含已被取代的。 */
    list(connectionId, options = {}) {
        const list = this.byConnection.get(connectionId) ?? [];
        return options.includeSuperseded ? [...list] : list.filter((c) => !c.supersededBy);
    }
    /** 按主题/正文关键词筛选（工具查询用）。 */
    search(connectionId, keyword) {
        const k = keyword.trim().toLowerCase();
        if (k.length === 0)
            return this.list(connectionId);
        return this.list(connectionId).filter((c) => c.topic.toLowerCase().includes(k) || c.text.toLowerCase().includes(k));
    }
    /** 删除一条（写错了的情况）。 */
    remove(connectionId, id) {
        const list = this.byConnection.get(connectionId) ?? [];
        const idx = list.findIndex((c) => c.id === id);
        if (idx < 0)
            return false;
        list.splice(idx, 1);
        this.byConnection.set(connectionId, list);
        return true;
    }
    /** 连接删除时一并清掉。 */
    drop(connectionId) {
        this.byConnection.delete(connectionId);
    }
    /** 渲染成给模型看的紧凑文本。aLabel/bLabel 必须按连接自己的端点定义传。 */
    render(connectionId, aLabel, bLabel) {
        const list = this.list(connectionId);
        if (list.length === 0) {
            return `本连接（${aLabel} ↔ ${bLabel}）的公约盒还是空的。`;
        }
        const lines = [`本连接的共享约定（${list.length} 条）：`];
        const byTopic = new Map();
        for (const c of list) {
            const bucket = byTopic.get(c.topic) ?? [];
            bucket.push(c);
            byTopic.set(c.topic, bucket);
        }
        for (const [topic, items] of byTopic) {
            lines.push(`\n【${topic}】`);
            for (const c of items) {
                // ⚠️ by 是**连接的端点或人**，不是"我/对方" —— 按来源取对应名字
                const who = c.by === 'a' ? aLabel : c.by === 'b' ? bLabel : '用户（人工添加）';
                lines.push(`- ${c.text}`);
                lines.push(`  （由 ${who} 声明，id=${c.id}）`);
            }
        }
        return lines.join('\n');
    }
}
//# sourceMappingURL=box.js.map