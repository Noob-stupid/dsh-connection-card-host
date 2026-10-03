import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
    /**
     * 卡片更新状态：templateId → 检查结论。
     *
     * **`hasUpdate` 与 `reason` 要分开呈现** —— "无法检查"和"已是最新"是两回事，
     * 混在一起就是谎报（"检查更新"按钮点了却什么也没查，却显示"已是最新"）。
     */
    const [upd, setUpd] = useState({});
    const [updBusy, setUpdBusy] = useState(null);
    /**
     * 哪些卡片实例的面板是展开的。
     *
     * **默认全部收起** —— 卡片面板是卡片自己渲染的 HTML，高度不可控，
     * 几张一起展开会把卡片区顶得很长（用户截图反馈"太占地方"）。
     * 收起时卡片名/可见范围/重载/移除照常显示，操作入口不藏。
     */
    const [expandedCards, setExpandedCards] = useState({});
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [picking, setPicking] = useState(false);
    /** 加卡时选的可见范围（只作用于"下一次添加"）。 */
    const [scope, setScope] = useState('both');
    /** 安装：来源输入、进行中标志、回执/错误文本、已安装卡片根目录。 */
    const [spec, setSpec] = useState('');
    const [installing, setInstalling] = useState(false);
    const [installMsg, setInstallMsg] = useState(null);
    const [root, setRoot] = useState('');
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
    // 已安装卡片的根目录：显示给用户看，让"装到哪儿了"是透明的
    useEffect(() => {
        if (!client)
            return;
        void client
            .cardsRoot()
            .then((r) => setRoot(r))
            .catch(() => { });
    }, [client]);
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
    /** 装一张卡片到我们自己的目录，然后重扫模板。 */
    /**
     * 检查某张已安装卡片有没有更新。
     *
     * 结论**原样保留 `reason`** —— 面板会区分"有更新 / 已是最新 / 无法检查"三态。
     */
    const doCheckUpdate = useCallback(async (templateId) => {
        if (!client)
            return;
        setUpdBusy(templateId);
        try {
            const r = await client.checkCardUpdate(templateId);
            setUpd((prev) => ({ ...prev, [templateId]: r }));
            if (r.reason)
                setInstallMsg(`检查更新：${r.reason}`);
        }
        catch (e) {
            setUpd((prev) => ({
                ...prev,
                [templateId]: { reason: e instanceof Error ? e.message : String(e) },
            }));
        }
        finally {
            setUpdBusy(null);
        }
    }, [client]);
    /**
     * 更新一张已安装卡片：照着**记录的来源**重装，并让已装载的实例重载。
     *
     * 装载中也能更新，靠的是版本化目录（新版本写新目录，不碰被锁的旧目录）。
     */
    const doUpdate = useCallback(async (templateId) => {
        if (!client)
            return;
        setUpdBusy(templateId);
        setInstallMsg(null);
        try {
            const r = await client.updateCard(templateId);
            if (r.ok) {
                setInstallMsg(`已更新：v${r.version ?? '?'}${r.reloaded ? `（重载 ${r.reloaded} 个实例）` : ''}`);
                setUpd((prev) => ({ ...prev, [templateId]: {} }));
                await load();
            }
            else {
                setInstallMsg(`更新失败：${r.reason ?? '未知原因'}`);
            }
        }
        catch (e) {
            setInstallMsg(e instanceof Error ? e.message : String(e));
        }
        finally {
            setUpdBusy(null);
        }
    }, [client, load]);
    const doInstall = useCallback(async () => {
        if (!client)
            return;
        const s = spec.trim();
        if (s.length === 0)
            return;
        setInstalling(true);
        setInstallMsg(null);
        try {
            const r = await client.installCard(s);
            if (r.ok) {
                setInstallMsg(`已安装：${r.name ?? r.cardId}${r.version ? ` v${r.version}` : ''}`);
                setSpec('');
                // 重扫后新卡片会出现在上面的可选列表里
                await load();
            }
            else {
                setInstallMsg(`安装失败：${r.reason ?? '未知原因'}`);
            }
        }
        catch (e) {
            setInstallMsg(e instanceof Error ? e.message : String(e));
        }
        finally {
            setInstalling(false);
        }
    }, [client, spec, load]);
    /** 改一张已装载卡片的可见范围。 */ const changeScope = useCallback(async (instanceId, next) => {
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
    /**
     * 整个「卡片」区域的收起/展开。
     *
     * **保留原来那一行的样式**，只在「卡片」两个字右侧加一个小三角：
     *   收起 = 只剩这一行（卡片 ▸ 3                  + 添加卡片）
     *   展开 = 下面列出全部卡片
     *
     * 逐张卡片的面板各由**卡片自己那行的 ▸** 控制（`expandedCards`）。
     * **不做"全部展开"这种批量开关** —— 用户明确要求去掉：
     * 卡片本来就不多，两层"展开"并排反而读不出谁管谁。
     */
    const [sectionOpen, setSectionOpen] = useState(true);
    return (_jsxs("div", { className: `ccr-cards${sectionOpen ? '' : ' ccr-cards--folded'}`, children: [_jsxs("div", { className: "ccr-cards__head", children: [_jsxs("button", { type: "button", className: "ccr-cards__toggle", title: sectionOpen ? '收起卡片区' : '展开卡片区', onClick: () => setSectionOpen((v) => !v), children: [_jsx("span", { className: "ccr-field__label", children: "\u5361\u7247" }), _jsx("span", { className: "ccr-cards__tri", children: sectionOpen ? '▾' : '▸' })] }), _jsx("span", { className: "ccr-count", children: cards.length }), client && (_jsx("button", { type: "button", className: "ccr-link ccr-cards__add", onClick: () => setPicking((v) => !v), children: picking ? '取消' : '+ 添加卡片' }))] }), sectionOpen && (_jsxs(_Fragment, { children: [error && _jsx("div", { className: "ccr-error", children: error }), picking && (_jsxs("div", { className: "ccr-cards__picker", children: [_jsxs("div", { className: "ccr-scope-pick", children: [_jsx("span", { className: "ccr-scope-pick__label", children: "\u52A0\u5230" }), _jsx("div", { className: "ccr-seg ccr-seg--small", children: SCOPE_CHOICES.map((s) => (_jsx("button", { type: "button", className: `ccr-seg__item${scope === s.value ? ' ccr-seg__item--active' : ''}`, title: s.hint, onClick: () => setScope(s.value), children: s.label }, s.value))) })] }), available.length === 0 && (_jsx("div", { className: "ccr-panel__empty", children: templates.length === 0 ? '没有发现任何卡片模板' : '所有卡片都已添加' })), "          ", available.map((t) => {
                                /*
                                 * 适配卡（把一个普通 DSH 插件挂成连接上的能力）：照常列出，但带「适配」标注；
                                 * 未就绪时**置灰并说明原因**（用户裁决 D6）。
                                 *
                                 * 三条理由：让用户知道"这东西在这儿"（不是没装上）、知道"要开一下"
                                 * （而不是点了撞墙）、也不会以为"下载失败"。状态由宿主侧判定后下发
                                 * （`src/adapter/status.ts`），这里**不做二次判断** ——
                                 * 判定分散是"标注与实际行为脱节"的根源。
                                 */
                                const ad = t.adapter;
                                const blocked = Boolean(ad && ad.status !== 'ready');
                                return (_jsxs("button", { type: "button", className: `ccr-card-option${blocked ? ' ccr-card-option--blocked' : ''}`, disabled: busy === t.templateId || blocked, title: ad ? ad.reason : undefined, onClick: () => {
                                        if (blocked)
                                            return;
                                        void add(t.templateId);
                                    }, children: [_jsxs("span", { className: "ccr-card-option__name", children: [t.name, ad && _jsx("span", { className: "ccr-badge ccr-badge--adapter", children: "\u9002\u914D" }), t.suitability && (_jsx("span", { className: `ccr-badge ccr-badge--scope${t.suitability.scope === 'global' ? ' ccr-badge--warn' : ''}`, title: t.suitability.why, children: t.suitability.scope === 'capability'
                                                        ? '能力'
                                                        : t.suitability.scope === 'local'
                                                            ? '局部'
                                                            : t.suitability.scope === 'global'
                                                                ? '全局'
                                                                : '未判定' }))] }), _jsxs("span", { className: "ccr-card-option__meta", children: [t.source === 'builtin' ? '内置' : '已安装', " \u00B7 v", t.version, t.events.length > 0 && ` · ${t.events.length} 事件`, t.suitability?.scope === 'global' && ' · 全局 UI，不建议当卡片', t.suitability?.scope === 'unclear' && ' · 作用域未判定', t.scope && ` · 固定仅${t.scope === 'a' ? 'A' : 'B'}端`, ad && ad.capabilities.length > 0 && ` · 能力 ${ad.capabilities.join('/')}`, ad?.status === 'off' && ' · 需开启适配层', ad?.status === 'unsupported' && ' · 本版本不支持'] }), t.source === 'installed' && (_jsx("span", { className: "ccr-card-option__upd", onClick: (e) => {
                                                // 别触发外层的"装载"按钮
                                                e.stopPropagation();
                                                if (upd[t.templateId]?.hasUpdate)
                                                    void doUpdate(t.templateId);
                                                else
                                                    void doCheckUpdate(t.templateId);
                                            }, children: updBusy === t.templateId
                                                ? '…'
                                                : upd[t.templateId]?.hasUpdate
                                                    ? `↑ 更新到 ${upd[t.templateId]?.latestVersion ?? '新版'}`
                                                    : upd[t.templateId]?.reason
                                                        ? '无法检查'
                                                        : upd[t.templateId]
                                                            ? '已是最新'
                                                            : '检查更新' }))] }, t.templateId));
                            })] })), picking && (_jsxs("div", { className: "ccr-install", children: [_jsxs("div", { className: "ccr-install__row", children: [_jsx("input", { className: "ccr-input", placeholder: "\u5305\u540D / \u4ED3\u5E93 tgz \u5730\u5740 / \u672C\u5730\u76EE\u5F55\u8DEF\u5F84", value: spec, onChange: (e) => setSpec(e.target.value), onKeyDown: (e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                void doInstall();
                                            }
                                        } }), _jsx("button", { type: "button", className: "ccr-btn", disabled: installing || spec.trim().length === 0, onClick: () => void doInstall(), children: installing ? '安装中…' : '安装' })] }), _jsx("div", { className: "ccr-field__hint", children: installMsg ?? (_jsxs(_Fragment, { children: ["\u652F\u6301 npm \u5305\u540D\u3001tgz \u5730\u5740\u3001\u672C\u5730\u76EE\u5F55\u3002\u88C5\u5230 ", _jsx("code", { children: root || '…' }), "\uFF0C", _jsx("strong", { children: "\u4E0D\u5199\u5165 DSH \u7684 profile" }), "\uFF0C\u6240\u4EE5\u4E0D\u4F1A\u5F71\u54CD DSH \u672C\u8EAB\u3001\u4E5F\u4E0D\u4F1A\u88AB\u5B83\u7684\u66F4\u65B0\u7834\u574F\u3002"] })) })] })), cards.length === 0 && !picking && (_jsx("div", { className: "ccr-panel__empty", children: "\u8FD9\u6761\u8FDE\u63A5\u8FD8\u6CA1\u6709\u5361\u7247" })), cards.map((card) => {
                        const template = templates.find((t) => t.templateId === card.templateId);
                        const html = panels[card.instanceId] ?? null;
                        // 收起/展开：**默认收起**。卡片面板是卡片自己渲染的 HTML，高度不可控，
                        // 几张卡一起展开会把整个卡片区顶得很长（用户截图反馈过"太占地方"）。
                        // 收起时仍然显示卡片名/范围/重载/移除 —— 操作入口不藏。
                        const expanded = expandedCards[card.instanceId] === true;
                        return (_jsxs("div", { className: "ccr-card", children: [_jsxs("div", { className: "ccr-card__head", children: [_jsx("button", { type: "button", className: "ccr-card__toggle", title: expanded ? '收起' : '展开面板', disabled: !html, onClick: () => setExpandedCards((prev) => ({ ...prev, [card.instanceId]: !expanded })), children: html ? (expanded ? '▾' : '▸') : '·' }), _jsx("span", { className: "ccr-dot", style: { background: HEALTH_COLOR[connection.health] ?? '#10B981' } }), _jsx("span", { className: "ccr-card__name", children: template?.name ?? card.templateId }), template?.scope ? (_jsxs("span", { className: "ccr-card__scope-fixed", title: "\u6A21\u677F\u56FA\u5B9A\u4E86\u8FD9\u4E00\u7AEF\uFF0C\u4E0D\u53EF\u66F4\u6539", children: ["\u4EC5", template.scope === 'a' ? 'A' : 'B', "\u7AEF"] })) : (_jsx("div", { className: "ccr-seg ccr-seg--small ccr-card__scope", children: SCOPE_CHOICES.map((s) => (_jsx("button", { type: "button", className: `ccr-seg__item${(card.scope ?? 'both') === s.value ? ' ccr-seg__item--active' : ''}`, disabled: busy === card.instanceId, title: s.hint, onClick: () => void changeScope(card.instanceId, s.value), children: s.label }, s.value))) })), _jsx("span", { className: "ccr-card__meta", children: card.templateId }), _jsx("button", { type: "button", className: "ccr-link", disabled: busy === card.instanceId, onClick: () => void reload(card.instanceId), children: "\u91CD\u8F7D" }), _jsx("button", { type: "button", className: "ccr-link", disabled: busy === card.instanceId, onClick: () => void remove(card.instanceId), children: "\u79FB\u9664" })] }), html && expanded && (_jsx("div", { className: "ccr-card__panel", 
                                    // 卡片面板 HTML 由宿主渲染；卡片本来就在宿主跑任意代码，
                                    // 这里注入不构成新的权限边界。
                                    dangerouslySetInnerHTML: { __html: html } }))] }, card.instanceId));
                    })] }))] }));
}
//# sourceMappingURL=CardStack.js.map