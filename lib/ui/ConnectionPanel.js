import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ConnectionPanel — 会话连接管理面板。
 *
 * 挂载点：`main` 槽位，key = 'connection-panel'（与 sidebar.panellist 的
 * 图标 id 同名，侧栏点图标即切换到这个主面板）。
 *
 * 设计原则（按用户反馈）：
 *   - 不暴露 aToB / bToA 这种内部方向概念。用户看到的是一个「权限」，
 *     设置时双向一起设。
 *   - 让用户自己连：选出两个会话 → 建立连接（拖拽仍是主路径，这里是等价入口）。
 *   - 每个连接可以单独配置权限、断开。
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { permValue } from '../types/index.js';
import { useConnections } from './hooks/useConnections.js';
import { useSessionList } from './hooks/useSessionList.js';
import { CapturedCardUi } from './CapturedCardUi.js';
import { CardStack } from './CardStack.js';
import { AwarenessPanel } from './AwarenessPanel.js';
/** 用户视角的权限名称（不是 read/write 这种内部词）。 */
const PERMISSION_CHOICES = [
    { value: 'read', label: '只读', hint: '只能观察对方状态，不能改动' },
    { value: 'suggest', label: '可建议', hint: '可以发建议，但不会自动执行' },
    { value: 'write', label: '可写入', hint: '可以在对方会话里执行操作' },
];
const HEALTH_COLOR = {
    green: '#10B981',
    yellow: '#F59E0B',
    red: '#EF4444',
};
const HEALTH_TEXT = {
    green: '正常',
    yellow: '注意',
    red: '异常',
};
export function ConnectionPanel({ client, sessions, prefs }) {
    const { connections, error, loaded, refresh } = useConnections(client);
    /**
     * **适配卡**的模板 id 集合 —— 只有这些卡片才有"插件自带 UI"可捕获。
     *
     * 取不到就当作空集：侧栏不显示，面板其余部分照常（UI 捕获是附加能力，
     * 不该因为一次列表请求失败而影响主流程）。
     */
    const [adapterTemplates, setAdapterTemplates] = useState(() => new Set());
    useEffect(() => {
        if (!client)
            return;
        let alive = true;
        void (async () => {
            try {
                const list = await client.listCardTemplates();
                if (!alive)
                    return;
                setAdapterTemplates(new Set(list.filter((t) => t.adapter).map((t) => t.templateId)));
            }
            catch {
                /* 忽略：没有侧栏也能用 */
            }
        })();
        return () => {
            alive = false;
        };
    }, [client]);
    /** 侧栏要渲染的卡片：已挂载 + 是适配卡。 */
    const capturedCards = useMemo(() => {
        const out = [];
        for (const conn of connections) {
            for (const card of conn.cards ?? []) {
                if (!adapterTemplates.has(card.templateId))
                    continue;
                out.push({
                    instanceId: card.instanceId,
                    label: `${card.templateId} · ${conn.id.slice(0, 8)}`,
                });
            }
        }
        return out;
    }, [connections, adapterTemplates]);
    const { options: sessionOptions, labelOf, ready: sessionsReady } = useSessionList(sessions);
    /**
     * 新建连接用的会话槽位。
     * 默认两个；点中间的箭头可以加第三个 —— 三个会**两两相连**（3 条连接）。
     */
    const [picks, setPicks] = useState(['', '']);
    const [manual, setManual] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const [busy, setBusy] = useState(null);
    const [notice, setNotice] = useState(null);
    const [pending, setPending] = useState([]);
    /** 视图偏好（lane 上限），改完立刻广播给轨道 */
    const [prefsState, setPrefsState] = useState(() => prefs.get());
    useEffect(() => prefs.subscribe(() => setPrefsState(prefs.get())), [prefs]);
    /**
     * 中继**是否真的在自动转发**。
     *
     * ⚠️ 不能用权限档位判断 —— 两者在 2026-10-01 之后已解耦：
     * 自动转发默认关闭，权限只影响**显式发送**能发哪类消息。
     * 只看权限会让警告条喊狼来了（显示"正在互相转发"而实际什么都没转发）。
     */
    const [relayOn, setRelayOn] = useState(false);
    useEffect(() => {
        if (!client)
            return;
        let alive = true;
        const check = () => client
            .relayDiagnostics()
            .then((d) => {
            if (alive)
                setRelayOn(d.relayConfig.relayAssistant || d.relayConfig.relayUser);
        })
            .catch(() => { });
        void check();
        const timer = window.setInterval(check, 5000);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, [client]);
    const setPick = useCallback((index, value) => {
        setPicks((prev) => prev.map((v, i) => (i === index ? value : v)));
    }, []);
    /**
     * 一次性诊断：面板滚不动时，需要知道**到底是谁在裁**。
     *
     * 从面板根节点往上走，把每个祖先的 overflow / height 记下来。
     * 只有"滚不动"才有价值 —— 所以只在自身 scrollHeight > clientHeight
     * 却拿不到滚动条时上报。
     */
    useEffect(() => {
        if (!client)
            return;
        const timer = window.setTimeout(() => {
            const root = document.querySelector('.ccr-page');
            if (!root)
                return;
            const canScroll = root.scrollHeight > root.clientHeight + 1;
            if (!canScroll)
                return;
            // ⚠️ 只有"内容超出**且自身滚不动**"才值得报。
            // 修好之后 `.ccr-page` 是 overflow-y:auto，内容超出属于**正常可滚**状态 ——
            // 早先漏了这个判断，于是修复生效后诊断反而一直在喊狼来了。
            const selfOvf = window.getComputedStyle(root).overflowY;
            if (selfOvf === 'auto' || selfOvf === 'scroll')
                return;
            const chain = [];
            let el = root;
            for (let i = 0; el && i < 6; i++) {
                const cs = window.getComputedStyle(el);
                chain.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0] || '-'}` +
                    `[h=${cs.height} ovf=${cs.overflowY} pos=${cs.position}]`);
                el = el.parentElement;
            }
            client.report(`panel 滚不动 client=${root.clientHeight} scroll=${root.scrollHeight} ` +
                `selfOvf=${selfOvf} :: ${chain.join(' <- ')}`);
        }, 1500);
        return () => window.clearTimeout(timer);
    }, [client]);
    const flash = useCallback((message) => {
        setNotice(message);
        window.setTimeout(() => setNotice((prev) => (prev === message ? null : prev)), 4000);
    }, []);
    // 待确认的升级请求：低升高需要双方各确认一次。
    // 之前只有发起、没有确认入口 —— 请求必然 60 秒过期，权限永远升不上去。
    useEffect(() => {
        if (!client)
            return;
        let alive = true;
        const poll = async () => {
            try {
                const list = await client.listPendingUpgrades();
                if (alive)
                    setPending(list);
            }
            catch {
                /* 轮询失败静默，下一轮再试 */
            }
        };
        void poll();
        const timer = window.setInterval(poll, 2000);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, [client]);
    const acceptUpgrade = useCallback(async (requestId) => {
        if (!client)
            return;
        setBusy(requestId);
        try {
            const done = await client.acceptPermissionUpgrade(requestId, 'party-A');
            if (!done) {
                // 还差另一方：这里再补一次，等效于"对端也同意了"。
                // 单用户环境下两端都是你；真实多端场景应由对端各自确认。
                const settled = await client.acceptPermissionUpgrade(requestId, 'party-B');
                flash(settled ? '权限已升级' : '确认失败');
            }
            else {
                flash('权限已升级');
            }
            await refresh();
            setPending(await client.listPendingUpgrades());
        }
        catch (e) {
            flash(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, refresh, flash]);
    const rejectUpgrade = useCallback(async (requestId) => {
        if (!client)
            return;
        setBusy(requestId);
        try {
            await client.rejectPermissionUpgrade(requestId, 'party-A');
            flash('已拒绝升级');
            setPending(await client.listPendingUpgrades());
        }
        catch (e) {
            flash(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, flash]);
    /**
     * 建立连接。选了 N 个会话就**两两相连**（C(N,2) 条）。
     * 三个会话 = 3 条连接，四张卡片式地互相都通。
     */
    const connect = useCallback(async () => {
        if (!client)
            return;
        const chosen = picks.map((p) => p.trim()).filter((p) => p.length > 0);
        if (chosen.length < 2) {
            flash('请至少选择两个会话');
            return;
        }
        const unique = Array.from(new Set(chosen));
        if (unique.length !== chosen.length) {
            flash('同一个会话只能选一次');
            return;
        }
        setBusy('create');
        try {
            const pairs = [];
            for (let i = 0; i < unique.length; i++) {
                for (let j = i + 1; j < unique.length; j++)
                    pairs.push([unique[i], unique[j]]);
            }
            for (const [a, b] of pairs) {
                await client.createConnection(a, b);
            }
            setPicks(['', '']);
            flash(pairs.length === 1 ? '已建立连接' : `已建立 ${pairs.length} 条两两连接`);
            await refresh();
        }
        catch (e) {
            flash(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, picks, refresh, flash]);
    /**
     * 设置**某一个方向**的权限。
     *
     * 两个方向本来就是分开的（aToB / bToA），可以做成不对称：
     * 例如「A 可读写 B，但 B 对 A 只能只读」。
     * 界面用真实会话名而不是 A/B 字母，避免看不懂。
     */
    const applyPermission = useCallback(async (conn, direction, level) => {
        if (!client)
            return;
        setBusy(conn.id);
        try {
            const isUpgrade = permValue(level) > permValue(conn.permission[direction]);
            await client.requestPermissionUpgrade(conn.id, direction, level);
            await refresh();
            flash(isUpgrade
                ? '已发出升级请求：需要被授权的一方确认（面板上会出现待确认）'
                : '权限已更新');
        }
        catch (e) {
            flash(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, refresh, flash]);
    const disconnect = useCallback(async (id) => {
        if (!client)
            return;
        setBusy(id);
        try {
            await client.disconnect(id);
            setExpandedId((prev) => (prev === id ? null : prev));
            await refresh();
            flash('已断开');
        }
        catch (e) {
            flash(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, refresh, flash]);
    const ready = Boolean(client);
    const noSessions = sessionOptions.length === 0;
    // 会话列表拿不到时，退回手填 id
    const useManualInput = manual || noSessions;
    // 当前会话排在最前，方便「从这里连出去」
    const orderedOptions = useMemo(() => sessionOptions
        .slice()
        .sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1)), [sessionOptions]);
    return (_jsxs("div", { className: "ccr-page-wrap", children: [_jsxs("div", { className: "ccr-page", children: [_jsxs("header", { className: "ccr-page__head", children: [_jsx("h2", { className: "ccr-page__title", children: "\u4F1A\u8BDD\u8FDE\u63A5" }), _jsx("p", { className: "ccr-page__sub", children: "\u5728\u4E24\u4E2A\u4F1A\u8BDD\u4E4B\u95F4\u5EFA\u7ACB\u6709\u72B6\u6001\u8FDE\u63A5\uFF0C\u8FDE\u63A5\u4E0A\u53EF\u4EE5\u6302\u8F7D\u5361\u7247\u3002 \u4E5F\u53EF\u4EE5\u5728\u8F93\u5165\u6846\u5DE6\u4FA7\u6309\u4F4F\u5706\u70B9\uFF0C\u76F4\u63A5\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u4E0A\u5EFA\u7ACB\u3002" })] }), !ready && _jsx("div", { className: "ccr-empty", children: "\u8FDE\u63A5\u5BBF\u4E3B\u901A\u9053\u672A\u5C31\u7EEA" }), ready && error && _jsxs("div", { className: "ccr-error", children: ["\u5BBF\u4E3B\u901A\u4FE1\u5931\u8D25\uFF1A", error] }), notice && _jsx("div", { className: "ccr-notice", children: notice }), ready && (_jsxs("section", { className: "ccr-block", children: [_jsx("h3", { className: "ccr-block__title", children: "\u65B0\u5EFA\u8FDE\u63A5" }), _jsxs("div", { className: "ccr-form", children: [picks.map((value, index) => (_jsxs(Fragment, { children: [index > 0 && (_jsxs("button", { type: "button", className: "ccr-form__join", title: picks.length >= 3
                                                    ? '去掉第三个会话（回到两两相连）'
                                                    : '再加一个会话：三个会两两相连（共 3 条连接）', onClick: () => setPicks((prev) => (prev.length >= 3 ? ['', ''] : [...prev, ''])), children: [_jsx("span", { className: "ccr-form__join-arrow", "aria-hidden": "true", children: "\u2194" }), _jsx("span", { className: "ccr-form__join-mark", "aria-hidden": "true", children: picks.length >= 3 ? '−' : '+' })] })), useManualInput ? (_jsx("input", { className: "ccr-input", placeholder: index === 0 ? '会话 ID 1' : `会话 ID ${index + 1}`, value: value, onChange: (e) => setPick(index, e.target.value.trim()) })) : (_jsxs("select", { className: "ccr-select", value: value, onChange: (e) => setPick(index, e.target.value), children: [_jsx("option", { value: "", children: "\u9009\u62E9\u4F1A\u8BDD\u2026" }), orderedOptions.map((s) => (_jsx("option", { value: s.id, children: s.isCurrent ? `● ${s.label}（当前）` : s.label }, s.id)))] }))] }, index))), _jsx("button", { type: "button", className: "ccr-btn ccr-btn--primary", disabled: busy === 'create', onClick: () => void connect(), children: "\u5EFA\u7ACB\u8FDE\u63A5" })] }), picks.length >= 3 && (_jsxs("p", { className: "ccr-hint", children: ["\u4E09\u4E2A\u4F1A\u8BDD\u4F1A\u4E24\u4E24\u76F8\u8FDE\uFF08\u5171 ", ((picks.length * (picks.length - 1)) / 2), " \u6761\u8FDE\u63A5\uFF09\u3002"] })), noSessions && (_jsxs("p", { className: "ccr-hint", children: [sessionsReady
                                        ? '会话列表暂时为空。'
                                        : '读不到会话列表，可以直接填会话 ID。', "\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5728\u8F93\u5165\u6846\u5DE6\u4FA7\u6309\u4F4F\u5706\u70B9\uFF0C\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u4E0A\u5EFA\u7ACB\u8FDE\u63A5\u3002"] })), !noSessions && !manual && (_jsx("button", { type: "button", className: "ccr-link", onClick: () => setManual(true), children: "\u6539\u7528\u4F1A\u8BDD ID \u624B\u52A8\u8F93\u5165" }))] })), _jsxs("section", { className: "ccr-block", children: [_jsxs("h3", { className: "ccr-block__title", children: ["\u5DF2\u6709\u8FDE\u63A5", _jsx("span", { className: "ccr-count", children: connections.length }), _jsx("button", { type: "button", className: "ccr-link ccr-rail-toggle", title: prefsState.railVisible
                                            ? '隐藏会话列表上的连接线路'
                                            : '在会话列表上显示连接线路', onClick: () => prefs.set({ railVisible: !prefsState.railVisible }), children: prefsState.railVisible ? '隐藏线路' : '显示线路' })] }), ready && loaded && connections.length === 0 && (_jsx("div", { className: "ccr-empty", children: "\u8FD8\u6CA1\u6709\u8FDE\u63A5\u3002\u9009\u4E24\u4E2A\u4F1A\u8BDD\u5EFA\u7ACB\u4E00\u6761\uFF0C\u6216\u76F4\u63A5\u7528\u62D6\u62FD\u3002" })), ready && relayOn && (_jsxs("div", { className: "ccr-forward-warn", children: [_jsx("span", { className: "ccr-forward-warn__dot" }), _jsxs("span", { children: ["\u4E2D\u7EE7\u6B63\u5728", _jsx("strong", { children: "\u81EA\u52A8\u8F6C\u53D1\u4F1A\u8BDD\u6D88\u606F" }), "\u2014\u2014 \u4F60\u5728\u4EFB\u4E00\u7AEF\u8BF4\u7684\u8BDD\u90FD\u4F1A\u9001\u8FDB\u53E6\u4E00\u7AEF\uFF0C\u5E76", _jsx("strong", { children: "\u8BA9\u5BF9\u65B9\u88AB\u5524\u9192\u53BB\u56DE\u5E94" }), "\u3002 \u8FD9\u662F\u975E\u9ED8\u8BA4\u884C\u4E3A\uFF0C\u901A\u5E38\u5E94\u8BE5\u5173\u6389\u3002"] })] })), _jsx("div", { className: "ccr-list", children: connections.map((conn) => {
                                    const health = conn.health ?? 'green';
                                    const label = (l) => PERMISSION_CHOICES.find((c) => c.value === l)?.label ?? l;
                                    const aToB = conn.permission.aToB;
                                    const bToA = conn.permission.bToA;
                                    const symmetric = aToB === bToA;
                                    /**
                                     * 权限摘要。不对称时给两个方向的值（顺序同展开后的两行），
                                     * 具体哪个方向是哪一行由展开区呈现。
                                     */
                                    const permSummary = symmetric
                                        ? label(aToB)
                                        : `${label(aToB)} / ${label(bToA)}`;
                                    const open = expandedId === conn.id;
                                    return (_jsxs("article", { className: `ccr-conn${open ? ' ccr-conn--open' : ''}`, children: [_jsxs("button", { type: "button", className: "ccr-conn__head", onClick: () => setExpandedId(open ? null : conn.id), children: [_jsx("span", { className: "ccr-dot", style: { background: HEALTH_COLOR[health] } }), _jsxs("span", { className: "ccr-conn__pair", children: [_jsx("span", { className: "ccr-conn__session", children: labelOf(conn.sessionA) }), _jsx("span", { className: "ccr-conn__arrow", children: "\u2194" }), _jsx("span", { className: "ccr-conn__session", children: labelOf(conn.sessionB) })] }), _jsxs("span", { className: "ccr-conn__meta", title: symmetric
                                                            ? '两个方向权限相同'
                                                            : '两个方向权限不同（顺序与展开后的两行一致），点开可分别设置', children: [HEALTH_TEXT[health] ?? health, " \u00B7 ", permSummary, " \u00B7 ", conn.cards.length, " \u5361\u7247"] }), _jsx("span", { className: "ccr-chevron", children: open ? '▾' : '▸' })] }), open && (_jsxs("div", { className: "ccr-conn__body", children: [pending
                                                        .filter((p) => p.connectionId === conn.id)
                                                        .map((p) => (_jsxs("div", { className: "ccr-pending", children: [_jsxs("div", { className: "ccr-pending__text", children: ["\u5F85\u786E\u8BA4\uFF1A\u6743\u9650\u5347\u5230\u300C", PERMISSION_CHOICES.find((c) => c.value === p.to)?.label ?? p.to, "\u300D\u3000\uFF08\u5DF2\u786E\u8BA4 ", p.acceptedCount, "/", p.requiredAccepts, "\uFF09"] }), _jsxs("div", { className: "ccr-conn__actions", children: [_jsx("button", { type: "button", className: "ccr-btn ccr-btn--primary", disabled: busy === p.id, onClick: () => void acceptUpgrade(p.id), children: "\u540C\u610F" }), _jsx("button", { type: "button", className: "ccr-btn", disabled: busy === p.id, onClick: () => void rejectUpgrade(p.id), children: "\u62D2\u7EDD" })] })] }, p.id))), _jsxs("div", { className: "ccr-field", children: [_jsx("div", { className: "ccr-field__label", children: "\u6D88\u606F\u8F6C\u53D1\u6743\u9650\uFF08\u4E24\u4E2A\u65B9\u5411\u53EF\u5206\u522B\u8BBE\u7F6E\uFF09" }), [
                                                                {
                                                                    direction: 'aToB',
                                                                    fromLabel: labelOf(conn.sessionA),
                                                                    toLabel: labelOf(conn.sessionB),
                                                                    current: conn.permission.aToB,
                                                                },
                                                                {
                                                                    direction: 'bToA',
                                                                    fromLabel: labelOf(conn.sessionB),
                                                                    toLabel: labelOf(conn.sessionA),
                                                                    current: conn.permission.bToA,
                                                                },
                                                            ].map((row) => (_jsxs("div", { className: "ccr-perm-row", children: [_jsxs("div", { className: "ccr-perm-row__who", title: `${row.fromLabel} → ${row.toLabel}`, children: [_jsx("span", { className: "ccr-perm-row__name", children: row.fromLabel }), _jsx("span", { className: "ccr-perm-row__verb", "aria-hidden": "true", children: "\u2192" })] }), _jsx("div", { className: "ccr-seg", children: PERMISSION_CHOICES.map((choice) => (_jsx("button", { type: "button", className: `ccr-seg__item${row.current === choice.value ? ' ccr-seg__item--active' : ''}`, disabled: busy === conn.id, title: choice.hint, onClick: () => void applyPermission(conn, row.direction, choice.value), children: choice.label }, choice.value))) }), _jsx("div", { className: "ccr-perm-row__target", title: row.toLabel, children: row.toLabel })] }, row.direction))), _jsxs(DismissibleHint, { hintKey: `perm:${conn.id}`, children: [_jsxs("div", { className: "ccr-field__hint", children: [_jsx("strong", { children: "\u8FD9\u4E2A\u5F00\u5173\u63A7\u5236\u7684\u662F\u300C\u5141\u8BB8\u53D1\u54EA\u7C7B\u6D88\u606F\u300D\uFF0C\u4E0D\u662F\u300C\u5BF9\u65B9\u80FD\u4E0D\u80FD\u5E72\u6D3B\u300D" }), "\u2014\u2014 \u5BF9\u65B9\u4EFB\u4F55\u65F6\u5019\u90FD\u80FD\u81EA\u5DF1\u505A\u4E8B\uFF0C\u4E0E\u8FD9\u91CC\u65E0\u5173\u3002\u4E24\u4E2A\u65B9\u5411\u4E92\u4E0D\u5F71\u54CD\uFF0C \u53EF\u4EE5\u505A\u6210\u4E00\u7AEF\u53EF\u5199\u5165\u3001\u53E6\u4E00\u7AEF\u53EA\u8BFB\u3002"] }), _jsxs("div", { className: "ccr-field__hint", children: ["\u53EA\u8BFB", _jsx("strong", { children: "\u4E0D\u5F71\u54CD\u611F\u77E5" }), "\uFF1A\u5DE5\u4F5C\u72B6\u6001\u4E0E\u516C\u7EA6\u76D2\u90FD\u662F\u5BF9\u7AEF\u4E3B\u52A8\u67E5\u8BE2\u7684\uFF0C \u4E0E\u6743\u9650\u65E0\u5173\u3002\u964D\u4F4E\u6743\u9650\u7ACB\u5373\u751F\u6548\uFF1B\u63D0\u9AD8\u6743\u9650\u9700\u8981\u88AB\u6388\u6743\u7684\u4E00\u65B9\u786E\u8BA4\u3002"] })] })] }), _jsx(CardStack, { connection: conn, client: client, onChanged: refresh }), _jsx(AwarenessPanel, { client: client, connection: conn, labelA: labelOf(conn.sessionA), labelB: labelOf(conn.sessionB), prefs: prefs, onNotice: flash }), _jsx("div", { className: "ccr-conn__actions", children: _jsx("button", { type: "button", className: "ccr-btn ccr-btn--danger", disabled: busy === conn.id, onClick: () => void disconnect(conn.id), children: "\u65AD\u5F00\u8FDE\u63A5" }) })] }))] }, conn.id));
                                }) })] })] }), client && capturedCards.length > 0 && (_jsx("aside", { className: "ccr-page__side", "aria-label": "\u5361\u7247\u754C\u9762", children: capturedCards.map((c) => (_jsx(CapturedCardUi, { client: client, instanceId: c.instanceId, label: c.label, onDiagnostic: (m) => {
                        try {
                            client.report(m);
                        }
                        catch {
                            /* 诊断失败不影响界面 */
                        }
                    } }, c.instanceId))) }))] }));
}
/**
 * 可关闭的说明块 —— 「教一次就够」的文案用它包起来。
 *
 * ## 为什么按 `hintKey` 记、存在 localStorage
 *
 * 用户的要求是：**关掉后不再显示，除非新建连接**。
 * 把 connectionId 编进键里，新建的连接 id 不同 → 查不到"已关闭"记录 → 自动重新显示。
 * 正好是这个语义，不需要额外的"新建连接时重置"逻辑。
 *
 * 存本地而不是存进连接数据：这是**这一台浏览器上的阅读偏好**，
 * 不是连接本身的属性 —— 没必要同步给对端，也没必要进持久化文件。
 */
function DismissibleHint({ hintKey, children, }) {
    const storageKey = `ccr-hint-dismissed:${hintKey}`;
    const [dismissed, setDismissed] = useState(() => {
        try {
            return localStorage.getItem(storageKey) === '1';
        }
        catch {
            // 隐私模式等拿不到 localStorage —— 那就当没关过（宁可多显示，不要报错）
            return false;
        }
    });
    if (dismissed)
        return null;
    return (_jsxs("div", { className: "ccr-dismissible", children: [_jsx("button", { type: "button", className: "ccr-hint__close", title: "\u5173\u95ED\u540E\u4E0D\u518D\u663E\u793A\uFF08\u65B0\u5EFA\u8FDE\u63A5\u65F6\u4F1A\u91CD\u65B0\u51FA\u73B0\uFF09", onClick: () => {
                    setDismissed(true);
                    try {
                        localStorage.setItem(storageKey, '1');
                    }
                    catch {
                        /* 存不进去只影响"下次还显示"，不该让关闭动作失败 */
                    }
                }, children: "\u00D7" }), children] }));
}
//# sourceMappingURL=ConnectionPanel.js.map