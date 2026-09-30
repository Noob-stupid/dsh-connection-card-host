import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * AwarenessPanel —— 一条连接上的「协作感知」区块。
 *
 * 两块内容，对应两层：
 *
 *   A. 工作状态 —— **自动采集**：两边各自在改什么文件、计划进行到哪一步。
 *      只读。这是「我知道你在干什么」。
 *
 *   B. 公约盒   —— **显式声明**：双方说好了什么（接口、坐标、单位、命名、分工）。
 *      可增可删。这是「我们说好了什么」。
 *
 * ## 两块默认收起
 *
 * 用户反馈两块都摊开「看着面板太杂了，根本不想仔细看」。
 * 所以默认折叠 —— 但**标题行始终显示一行摘要**（谁在干什么 / 有几条约定、
 * 都是什么主题），不展开也能拿到要点，展开才看细节。
 * 展开状态存进视图偏好，跨会话保持。
 */
import { useCallback, useEffect, useState } from 'react';
/** 工作状态的新鲜度：多久没更新就算"停下来了"。 */
const STALE_MS = 3 * 60_000;
function ago(ts) {
    if (!ts)
        return '未知';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60)
        return `${s} 秒前`;
    if (s < 3600)
        return `${Math.round(s / 60)} 分钟前`;
    return `${Math.round(s / 3600)} 小时前`;
}
function shortPath(p) {
    return p.replace(/\\/g, '/').split('/').slice(-2).join('/');
}
/** 收起状态下的一行摘要：谁在干什么。 */
function workDigest(work, labelA, labelB) {
    const parts = [];
    for (const [label, st] of [
        [labelA, work.a],
        [labelB, work.b],
    ]) {
        if (st && st.updatedAt > 0) {
            const stale = Date.now() - st.updatedAt > STALE_MS;
            parts.push(`${label} ${st.lastAction || '空闲'}${stale ? '（久未更新）' : ''}`);
        }
        else {
            parts.push(`${label} 未采集`);
        }
    }
    return parts.join(' · ');
}
/** 收起状态下的一行摘要：有几条约定、都是什么主题。 */
function boxDigest(conventions) {
    if (conventions.length === 0)
        return '还没有约定';
    const topics = Array.from(new Set(conventions.map((c) => c.topic))).slice(0, 4);
    return `${conventions.length} 条 · ${topics.join('、')}`;
}
export function AwarenessPanel({ client, connection, labelA, labelB, prefs, onNotice, }) {
    const [work, setWork] = useState({
        a: null,
        b: null,
    });
    const [conventions, setConventions] = useState([]);
    const [draft, setDraft] = useState('');
    const [topic, setTopic] = useState('');
    const [busy, setBusy] = useState(false);
    /** 中继诊断：被挡下的非真人来源计数（可查询，不怕日志滚动）。 */
    const [diagnostics, setDiagnostics] = useState([]);
    // 展开状态来自共享偏好（默认都收起）
    const [open, setOpen] = useState(() => ({
        work: prefs.get().workOpen,
        box: prefs.get().boxOpen,
    }));
    useEffect(() => prefs.subscribe(() => {
        const p = prefs.get();
        setOpen({ work: p.workOpen, box: p.boxOpen });
    }), [prefs]);
    const toggle = useCallback((which) => {
        const p = prefs.get();
        prefs.set(which === 'work' ? { workOpen: !p.workOpen } : { boxOpen: !p.boxOpen });
    }, [prefs]);
    const load = useCallback(async () => {
        if (!client)
            return;
        try {
            const [w, c] = await Promise.all([
                client.connectionWork(connection.id),
                client.listConventions(connection.id),
            ]);
            setWork(w);
            setConventions(c);
            // 诊断另算：它失败不该影响主内容
            client
                .relayDiagnostics()
                .then((d) => setDiagnostics(d.skipped))
                .catch(() => { });
        }
        catch {
            /* 轮询失败静默，下一轮再试 */
        }
    }, [client, connection.id]);
    // 工作状态是实时的，要轮询；收起时降到 8 秒（摘要也要新鲜，但不必那么勤）
    useEffect(() => {
        void load();
        const period = open.work ? 3000 : 8000;
        const timer = window.setInterval(() => void load(), period);
        return () => window.clearInterval(timer);
    }, [load, open.work]);
    const declare = useCallback(async () => {
        if (!client)
            return;
        const text = draft.trim();
        if (text.length === 0)
            return;
        setBusy(true);
        try {
            // by='user'：声明的是**人**，不是 A 也不是 B。
            // 早先硬编码成 'a'，会让人写的东西被算到 A 头上，对端看到会误判来源。
            const r = await client.declareConvention(connection.id, 'user', topic.trim() || '一般', text);
            if (r.ok) {
                setDraft('');
                setTopic('');
                onNotice('已放入公约盒');
                await load();
            }
            else {
                onNotice(`声明失败：${r.reason ?? '未知原因'}`);
            }
        }
        catch (e) {
            onNotice(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    }, [client, connection.id, draft, topic, load, onNotice]);
    const remove = useCallback(async (id) => {
        if (!client)
            return;
        try {
            await client.removeConvention(connection.id, id);
            await load();
        }
        catch (e) {
            onNotice(e instanceof Error ? e.message : String(e));
        }
    }, [client, connection.id, load, onNotice]);
    // 有"正在干活"的迹象时给标题加个小点，收起状态下也能一眼看出对方在忙
    const someoneActive = [work.a, work.b].some((s) => s && s.updatedAt > 0 && Date.now() - s.updatedAt < STALE_MS);
    /**
     * 中继诊断：被挡下的非真人来源。
     *
     * 放这里而不是只写日志，是因为**日志会被清空/滚动** —— 只写一次的信号
     * 一旦滚掉就永久消失。可查询的东西不怕滚动。
     * （这条建议来自对端会话，同时补上"状态靠翻日志猜"这个缺口。）
     */
    const skipped = diagnostics.filter((d) => d.sessionId === connection.sessionA || d.sessionId === connection.sessionB);
    return (_jsxs(_Fragment, { children: [_jsxs("section", { className: `ccr-fold${open.work ? ' ccr-fold--open' : ''}`, children: [_jsxs("button", { type: "button", className: "ccr-fold__head", onClick: () => toggle('work'), children: [_jsx("span", { className: "ccr-fold__chevron", children: open.work ? '▾' : '▸' }), _jsx("span", { className: "ccr-fold__title", children: "\u5BF9\u65B9\u5728\u505A\u4EC0\u4E48" }), someoneActive && _jsx("span", { className: "ccr-fold__live", title: "\u5BF9\u65B9\u6B63\u5728\u6D3B\u52A8" }), _jsx("span", { className: "ccr-fold__digest", title: workDigest(work, labelA, labelB), children: workDigest(work, labelA, labelB) })] }), open.work && (_jsxs("div", { className: "ccr-fold__body", children: [_jsx("div", { className: "ccr-work", children: [
                                    ['a', labelA, work.a, connection.sessionA],
                                    ['b', labelB, work.b, connection.sessionB],
                                ].map(([side, name, state, fullId]) => (_jsxs("div", { className: "ccr-work__row", children: [_jsxs("div", { className: "ccr-work__head", children: [_jsx("span", { className: "ccr-work__name", title: fullId, children: name }), state && state.updatedAt > 0 ? (_jsx("span", { className: `ccr-work__age${Date.now() - state.updatedAt > STALE_MS ? ' ccr-work__age--stale' : ''}`, children: ago(state.updatedAt) })) : (_jsx("span", { className: "ccr-work__age", children: "\u672A\u91C7\u96C6" }))] }), state && state.updatedAt > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "ccr-work__action", children: state.lastAction || '空闲' }), state.todos.length > 0 && (_jsx("ul", { className: "ccr-work__todos", children: state.todos.map((t, i) => (_jsxs("li", { className: `ccr-work__todo ccr-work__todo--${t.status}`, title: t.content, children: [t.status === 'completed'
                                                                ? '✓'
                                                                : t.status === 'in_progress'
                                                                    ? '▶'
                                                                    : '·', ' ', t.content] }, i))) })), state.files.length > 0 && (_jsx("div", { className: "ccr-work__files", title: state.files.join('\n'), children: state.files.slice(0, 4).map((f) => (_jsx("span", { className: "ccr-work__file", children: shortPath(f) }, f))) })), state.turn > 0 && (_jsxs("div", { className: "ccr-work__progress", children: ["\u7B2C ", state.turn, " \u8F6E \u00B7 \u7B2C ", state.step, " \u6B65"] }))] })) : (_jsx("div", { className: "ccr-work__action ccr-work__action--empty", children: "\u8FD8\u6CA1\u91C7\u96C6\u5230 \u2014\u2014 \u5BF9\u65B9\u5F00\u59CB\u5E72\u6D3B\u540E\u8FD9\u91CC\u4F1A\u81EA\u52A8\u51FA\u73B0" }))] }, side))) }), skipped.length > 0 && (_jsxs("div", { className: "ccr-work__diag", children: [_jsxs("div", { className: "ccr-work__diag-head", title: "\u8DE8\u4F1A\u8BDD\u901A\u9053\u53EA\u653E\u884C\u771F\u4EBA\u53D1\u8A00\uFF1B\u5BBF\u4E3B\u901A\u77E5\uFF08\u4EFB\u52A1\u5B8C\u6210\u3001\u6A21\u578B\u5207\u6362\u7B49\uFF09\u4E00\u5F8B\u6321\u4E0B", children: ["\u5DF2\u6321\u4E0B\u975E\u53D1\u8A00\u6765\u6E90\uFF1A", skipped.map((d) => ` ${d.kind}×${d.count}`).join(' · ')] }), skipped.slice(0, 2).map((d) => (_jsxs("div", { className: "ccr-work__diag-item", children: [_jsx("span", { className: "ccr-work__diag-kind", children: d.kind }), _jsx("span", { className: "ccr-work__diag-preview", title: d.lastDropped, children: d.lastDropped || '(无内容)' }), _jsx("span", { className: "ccr-work__diag-age", children: ago(d.lastSeenAt) })] }, `${d.sessionId}:${d.kind}`)))] }))] }))] }), _jsxs("section", { className: `ccr-fold${open.box ? ' ccr-fold--open' : ''}`, children: [_jsxs("button", { type: "button", className: "ccr-fold__head", onClick: () => toggle('box'), children: [_jsx("span", { className: "ccr-fold__chevron", children: open.box ? '▾' : '▸' }), _jsx("span", { className: "ccr-fold__title", children: "\u5171\u4EAB\u7EA6\u5B9A" }), _jsx("span", { className: "ccr-fold__digest", title: boxDigest(conventions), children: boxDigest(conventions) })] }), open.box && (_jsxs("div", { className: "ccr-fold__body", children: [conventions.length === 0 ? (_jsx("div", { className: "ccr-box__empty", children: "\u8FD8\u6CA1\u6709\u7EA6\u5B9A\u3002\u653E\u300C\u5BF9\u65B9\u4E0D\u77E5\u9053\u5C31\u4F1A\u505A\u9519\u7684\u4E1C\u897F\u300D\u2014\u2014\u63A5\u53E3\u3001\u5750\u6807\u3001\u5355\u4F4D\u3001\u547D\u540D\u3001\u5206\u5DE5\u8FB9\u754C\u3002" })) : (_jsx("ul", { className: "ccr-box", children: conventions.map((c) => (_jsxs("li", { className: "ccr-box__item", children: [_jsx("span", { className: "ccr-box__topic", children: c.topic }), _jsx("span", { className: "ccr-box__text", children: c.text }), _jsx("span", { className: "ccr-box__who", title: c.by === 'user'
                                                ? '你在面板里直接添加的'
                                                : c.by === 'a'
                                                    ? connection.sessionA
                                                    : connection.sessionB, children: c.by === 'user' ? '你' : c.by === 'a' ? labelA : labelB }), _jsx("button", { type: "button", className: "ccr-box__del", title: "\u5220\u9664\u8FD9\u6761\u7EA6\u5B9A", onClick: () => void remove(c.id), children: "\u00D7" })] }, c.id))) })), _jsxs("div", { className: "ccr-box__add", children: [_jsx("input", { className: "ccr-input ccr-input--topic", placeholder: "\u5206\u7C7B", value: topic, onChange: (e) => setTopic(e.target.value) }), _jsx("input", { className: "ccr-input", placeholder: "\u7EA6\u5B9A\u5185\u5BB9\uFF08\u5BF9\u65B9\u4E0D\u77E5\u9053\u5C31\u4F1A\u505A\u9519\u7684\u4E8B\uFF09", value: draft, onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                void declare();
                                            }
                                        } }), _jsx("button", { type: "button", className: "ccr-btn", disabled: busy || draft.trim().length === 0, onClick: () => void declare(), children: "\u653E\u5165" })] }), _jsx("div", { className: "ccr-field__hint", children: "\u7EA6\u5B9A**\u53EA\u5B58\u4E0D\u53D1**\uFF0C\u4E0D\u5360\u5BF9\u65B9\u4E0A\u4E0B\u6587\uFF1B\u53C2\u4E0E\u8FDE\u63A5\u7684\u4F1A\u8BDD\u53EF\u7528 connection_conventions \u5DE5\u5177\u968F\u65F6\u67E5\u5230\u3002" })] }))] })] }));
}
//# sourceMappingURL=AwarenessPanel.js.map