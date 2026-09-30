import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * AwarenessPanel —— 一条连接上的「协作感知」区块。
 *
 * 两块内容，对应两层：
 *
 *   A. 工作状态 —— **自动采集**：两边各自在改什么文件、计划进行到哪一步。
 *      只读，刷新即可。这是「我知道你在干什么」。
 *
 *   B. 公约盒   —— **显式声明**：双方说好了什么（接口、坐标、单位、命名、分工）。
 *      可增可删。这是「我们说好了什么」。
 *
 * 为什么两者并列显示：它们回答的是不同问题，而且**状态会过期、公约不会** ——
 * 混在一起会让人分不清哪条是"此刻如此"、哪条是"一直如此"。
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
export function AwarenessPanel({ client, connection, labelA, labelB, onNotice, }) {
    const [work, setWork] = useState({
        a: null,
        b: null,
    });
    const [conventions, setConventions] = useState([]);
    const [draft, setDraft] = useState('');
    const [topic, setTopic] = useState('');
    const [busy, setBusy] = useState(false);
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
        }
        catch {
            /* 轮询失败静默，下一轮再试 */
        }
    }, [client, connection.id]);
    // 工作状态是**实时**的，所以要轮询；3 秒足够跟手，又不会打爆宿主
    useEffect(() => {
        void load();
        const timer = window.setInterval(() => void load(), 3000);
        return () => window.clearInterval(timer);
    }, [load]);
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
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "ccr-field", children: [_jsxs("div", { className: "ccr-field__label", children: ["\u5BF9\u65B9\u5728\u505A\u4EC0\u4E48", _jsx("span", { className: "ccr-field__auto", title: "\u7531\u4F1A\u8BDD\u4E8B\u4EF6\u81EA\u52A8\u91C7\u96C6\uFF0C\u5BF9\u65B9\u4E0D\u9700\u8981\u4E13\u95E8\u544A\u8BC9\u4F60", children: "\u81EA\u52A8" })] }), _jsx("div", { className: "ccr-work", children: [['a', labelA, work.a], ['b', labelB, work.b]].map(([side, name, state]) => (_jsxs("div", { className: "ccr-work__row", children: [_jsxs("div", { className: "ccr-work__head", children: [_jsx("span", { className: "ccr-work__name", title: side === 'a' ? connection.sessionA : connection.sessionB, children: name }), state && state.updatedAt > 0 ? (_jsx("span", { className: `ccr-work__age${Date.now() - state.updatedAt > STALE_MS ? ' ccr-work__age--stale' : ''}`, children: ago(state.updatedAt) })) : (_jsx("span", { className: "ccr-work__age", children: "\u672A\u91C7\u96C6" }))] }), state && state.updatedAt > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "ccr-work__action", children: state.lastAction || '空闲' }), state.todos.length > 0 && (_jsx("ul", { className: "ccr-work__todos", children: state.todos.map((t, i) => (_jsxs("li", { className: `ccr-work__todo ccr-work__todo--${t.status}`, title: t.content, children: [t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '·', ' ', t.content] }, i))) })), state.files.length > 0 && (_jsx("div", { className: "ccr-work__files", title: state.files.join('\n'), children: state.files.slice(0, 4).map((f) => (_jsx("span", { className: "ccr-work__file", children: f.replace(/\\/g, '/').split('/').slice(-2).join('/') }, f))) })), state.turn > 0 && (_jsxs("div", { className: "ccr-work__progress", children: ["\u7B2C ", state.turn, " \u8F6E \u00B7 \u7B2C ", state.step, " \u6B65"] }))] })) : (_jsx("div", { className: "ccr-work__action ccr-work__action--empty", children: "\u8FD8\u6CA1\u91C7\u96C6\u5230 \u2014\u2014 \u5BF9\u65B9\u5F00\u59CB\u5E72\u6D3B\u540E\u8FD9\u91CC\u4F1A\u81EA\u52A8\u51FA\u73B0" }))] }, side))) })] }), _jsxs("div", { className: "ccr-field", children: [_jsxs("div", { className: "ccr-field__label", children: ["\u5171\u4EAB\u7EA6\u5B9A", _jsx("span", { className: "ccr-field__count", children: conventions.length })] }), conventions.length === 0 ? (_jsx("div", { className: "ccr-box__empty", children: "\u8FD8\u6CA1\u6709\u7EA6\u5B9A\u3002\u653E\u300C\u5BF9\u65B9\u4E0D\u77E5\u9053\u5C31\u4F1A\u505A\u9519\u7684\u4E1C\u897F\u300D\u2014\u2014\u63A5\u53E3\u3001\u5750\u6807\u3001\u5355\u4F4D\u3001\u547D\u540D\u3001\u5206\u5DE5\u8FB9\u754C\u3002" })) : (_jsx("ul", { className: "ccr-box", children: conventions.map((c) => (_jsxs("li", { className: "ccr-box__item", children: [_jsx("span", { className: "ccr-box__topic", children: c.topic }), _jsx("span", { className: "ccr-box__text", children: c.text }), _jsx("span", { className: "ccr-box__who", title: c.by === 'user' ? '你在面板里直接添加的' : c.by === 'a' ? connection.sessionA : connection.sessionB, children: c.by === 'user' ? '你' : c.by === 'a' ? labelA : labelB }), _jsx("button", { type: "button", className: "ccr-box__del", title: "\u5220\u9664\u8FD9\u6761\u7EA6\u5B9A", onClick: () => void remove(c.id), children: "\u00D7" })] }, c.id))) })), _jsxs("div", { className: "ccr-box__add", children: [_jsx("input", { className: "ccr-input ccr-input--topic", placeholder: "\u5206\u7C7B", value: topic, onChange: (e) => setTopic(e.target.value) }), _jsx("input", { className: "ccr-input", placeholder: "\u7EA6\u5B9A\u5185\u5BB9\uFF08\u5BF9\u65B9\u4E0D\u77E5\u9053\u5C31\u4F1A\u505A\u9519\u7684\u4E8B\uFF09", value: draft, onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        void declare();
                                    }
                                } }), _jsx("button", { type: "button", className: "ccr-btn", disabled: busy || draft.trim().length === 0, onClick: () => void declare(), children: "\u653E\u5165" })] }), _jsx("div", { className: "ccr-field__hint", children: "\u7EA6\u5B9A**\u53EA\u5B58\u4E0D\u53D1**\uFF0C\u4E0D\u5360\u5BF9\u65B9\u4E0A\u4E0B\u6587\uFF1B\u53C2\u4E0E\u8FDE\u63A5\u7684\u4F1A\u8BDD\u53EF\u7528 connection_conventions \u5DE5\u5177\u968F\u65F6\u67E5\u5230\u3002" })] })] }));
}
//# sourceMappingURL=AwarenessPanel.js.map