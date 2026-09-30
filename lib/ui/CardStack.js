import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * CardStack — 一条连接下的卡片区。
 *
 * 两部分：
 *   1. 已装载的卡片：名称 + 状态 + 「重载」「移除」，并渲染卡片面板；
 *   2. 添加卡片：列出可用模板（内置 + 已安装），一键加到这条连接上。
 *
 * 卡片面板 HTML 由**宿主**渲染好后传过来 —— 卡片模块跑在宿主进程里
 * （apply 要订阅事件、注册工具），宿主没有 DOM，用 dom-shim 取 innerHTML。
 */
import { useCallback, useEffect, useState } from 'react';
const HEALTH_COLOR = {
    green: '#10B981',
    yellow: '#F59E0B',
    red: '#EF4444',
};
/**
 * 卡片可见范围。
 *
 * 「两端通用」= 这条连接上的两端都能收到它的事件、都能看到它的面板；
 * 「仅 A / 仅 B」= 只挂在某一端（另一端连它的存在都感知不到）。
 * 这正是用户要的「卡片是两端共享的，或者可以只给一端」。
 */
const SCOPE_CHOICES = [
    { value: 'both', label: '两端', hint: '连接的两端都能收到这张卡片的事件与面板' },
    { value: 'a', label: '仅 A', hint: '只挂在 A 端（B 端感知不到这张卡片）' },
    { value: 'b', label: '仅 B', hint: '只挂在 B 端（A 端感知不到这张卡片）' },
];
export function CardStack({ connection, client, onChanged }) {
    const [templates, setTemplates] = useState([]);
    const [panels, setPanels] = useState({});
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [picking, setPicking] = useState(false);
    /** 加卡时选的可见范围（只作用于"下一次添加"）。 */
    const [scope, setScope] = useState('both');
    const cards = connection.cards;
    // 依赖用长度与 id 串，避免每次渲染都重新拉取
    const cardKey = cards.map((c) => c.instanceId).join(',');
    /** 拉模板清单 + 渲染每张已装载卡片的面板。 */
    const load = useCallback(async () => {
        if (!client)
            return;
        try {
            const list = await client.listCardTemplates(connection.id);
            setTemplates(list);
            setError(null);
            const ids = cardKey ? cardKey.split(',') : [];
            const next = {};
            for (const id of ids) {
                try {
                    next[id] = await client.renderCardPanel(id);
                }
                catch {
                    next[id] = null;
                }
            }
            setPanels(next);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [client, connection.id, cardKey]);
    useEffect(() => {
        void load();
    }, [load]);
    const add = useCallback(async (templateId) => {
        if (!client)
            return;
        setBusy(templateId);
        try {
            await client.loadCard(templateId, connection.id, scope);
            setPicking(false);
            await load();
            onChanged?.();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, connection.id, scope, load, onChanged]);
    /** 改一张已装载卡片的可见范围。 */
    const changeScope = useCallback(async (instanceId, next) => {
        if (!client)
            return;
        setBusy(instanceId);
        try {
            await client.setCardScope(instanceId, next);
            await load();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, load]);
    const remove = useCallback(async (instanceId) => {
        if (!client)
            return;
        setBusy(instanceId);
        try {
            await client.unloadCard(instanceId);
            await load();
            onChanged?.();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, load, onChanged]);
    const reload = useCallback(async (instanceId) => {
        if (!client)
            return;
        setBusy(instanceId);
        try {
            await client.reloadCard(instanceId);
            await load();
            onChanged?.();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, load, onChanged]);
    const installed = new Set(cards.map((c) => c.templateId));
    const available = templates.filter((t) => !installed.has(t.templateId));
    return (_jsxs("div", { className: "ccr-cards", children: [_jsxs("div", { className: "ccr-cards__head", children: [_jsx("span", { className: "ccr-field__label", children: "\u5361\u7247" }), _jsx("span", { className: "ccr-count", children: cards.length }), client && (_jsx("button", { type: "button", className: "ccr-link ccr-cards__add", onClick: () => setPicking((v) => !v), children: picking ? '取消' : '+ 添加卡片' }))] }), error && _jsx("div", { className: "ccr-error", children: error }), picking && (_jsxs("div", { className: "ccr-cards__picker", children: [_jsxs("div", { className: "ccr-scope-pick", children: [_jsx("span", { className: "ccr-scope-pick__label", children: "\u52A0\u5230" }), _jsx("div", { className: "ccr-seg ccr-seg--small", children: SCOPE_CHOICES.map((s) => (_jsx("button", { type: "button", className: `ccr-seg__item${scope === s.value ? ' ccr-seg__item--active' : ''}`, title: s.hint, onClick: () => setScope(s.value), children: s.label }, s.value))) })] }), available.length === 0 && (_jsx("div", { className: "ccr-panel__empty", children: templates.length === 0 ? '没有发现任何卡片模板' : '所有卡片都已添加' })), available.map((t) => (_jsxs("button", { type: "button", className: "ccr-card-option", disabled: busy === t.templateId, onClick: () => void add(t.templateId), children: [_jsx("span", { className: "ccr-card-option__name", children: t.name }), _jsxs("span", { className: "ccr-card-option__meta", children: [t.source === 'builtin' ? '内置' : '已安装', " \u00B7 v", t.version, t.events.length > 0 && ` · ${t.events.length} 事件`, t.scope && ` · 固定仅${t.scope === 'a' ? 'A' : 'B'}端`] })] }, t.templateId)))] })), cards.length === 0 && !picking && (_jsx("div", { className: "ccr-panel__empty", children: "\u8FD9\u6761\u8FDE\u63A5\u8FD8\u6CA1\u6709\u5361\u7247" })), cards.map((card) => {
                const template = templates.find((t) => t.templateId === card.templateId);
                const html = panels[card.instanceId] ?? null;
                return (_jsxs("div", { className: "ccr-card", children: [_jsxs("div", { className: "ccr-card__head", children: [_jsx("span", { className: "ccr-dot", style: { background: HEALTH_COLOR[connection.health] ?? '#10B981' } }), _jsx("span", { className: "ccr-card__name", children: template?.name ?? card.templateId }), template?.scope ? (_jsxs("span", { className: "ccr-card__scope-fixed", title: "\u6A21\u677F\u56FA\u5B9A\u4E86\u8FD9\u4E00\u7AEF\uFF0C\u4E0D\u53EF\u66F4\u6539", children: ["\u4EC5", template.scope === 'a' ? 'A' : 'B', "\u7AEF"] })) : (_jsx("div", { className: "ccr-seg ccr-seg--small ccr-card__scope", children: SCOPE_CHOICES.map((s) => (_jsx("button", { type: "button", className: `ccr-seg__item${(card.scope ?? 'both') === s.value ? ' ccr-seg__item--active' : ''}`, disabled: busy === card.instanceId, title: s.hint, onClick: () => void changeScope(card.instanceId, s.value), children: s.label }, s.value))) })), _jsx("span", { className: "ccr-card__meta", children: card.templateId }), _jsx("button", { type: "button", className: "ccr-link", disabled: busy === card.instanceId, onClick: () => void reload(card.instanceId), children: "\u91CD\u8F7D" }), _jsx("button", { type: "button", className: "ccr-link", disabled: busy === card.instanceId, onClick: () => void remove(card.instanceId), children: "\u79FB\u9664" })] }), html && (_jsx("div", { className: "ccr-card__panel", 
                            // 卡片面板 HTML 由宿主渲染；卡片本来就在宿主跑任意代码，
                            // 这里注入不构成新的权限边界。
                            dangerouslySetInnerHTML: { __html: html } }))] }, card.instanceId));
            })] }));
}
//# sourceMappingURL=CardStack.js.map