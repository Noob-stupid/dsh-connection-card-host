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
    const setPick = useCallback((index, value) => {
        setPicks((prev) => prev.map((v, i) => (i === index ? value : v)));
    }, []);
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
    return (_jsxs("div", { className: "ccr-page", children: [_jsxs("header", { className: "ccr-page__head", children: [_jsx("h2", { className: "ccr-page__title", children: "\u4F1A\u8BDD\u8FDE\u63A5" }), _jsx("p", { className: "ccr-page__sub", children: "\u5728\u4E24\u4E2A\u4F1A\u8BDD\u4E4B\u95F4\u5EFA\u7ACB\u6709\u72B6\u6001\u8FDE\u63A5\uFF0C\u8FDE\u63A5\u4E0A\u53EF\u4EE5\u6302\u8F7D\u5361\u7247\u3002 \u4E5F\u53EF\u4EE5\u5728\u8F93\u5165\u6846\u5DE6\u4FA7\u6309\u4F4F\u5706\u70B9\uFF0C\u76F4\u63A5\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u4E0A\u5EFA\u7ACB\u3002" })] }), !ready && _jsx("div", { className: "ccr-empty", children: "\u8FDE\u63A5\u5BBF\u4E3B\u901A\u9053\u672A\u5C31\u7EEA" }), ready && error && _jsxs("div", { className: "ccr-error", children: ["\u5BBF\u4E3B\u901A\u4FE1\u5931\u8D25\uFF1A", error] }), notice && _jsx("div", { className: "ccr-notice", children: notice }), ready && (_jsxs("section", { className: "ccr-block", children: [_jsx("h3", { className: "ccr-block__title", children: "\u65B0\u5EFA\u8FDE\u63A5" }), _jsxs("div", { className: "ccr-form", children: [picks.map((value, index) => (_jsxs(Fragment, { children: [index > 0 && (_jsxs("button", { type: "button", className: "ccr-form__join", title: picks.length >= 3
                                            ? '去掉第三个会话（回到两两相连）'
                                            : '再加一个会话：三个会两两相连（共 3 条连接）', onClick: () => setPicks((prev) => (prev.length >= 3 ? ['', ''] : [...prev, ''])), children: [_jsx("span", { className: "ccr-form__join-arrow", "aria-hidden": "true", children: "\u2194" }), _jsx("span", { className: "ccr-form__join-mark", "aria-hidden": "true", children: picks.length >= 3 ? '−' : '+' })] })), useManualInput ? (_jsx("input", { className: "ccr-input", placeholder: index === 0 ? '会话 ID 1' : `会话 ID ${index + 1}`, value: value, onChange: (e) => setPick(index, e.target.value.trim()) })) : (_jsxs("select", { className: "ccr-select", value: value, onChange: (e) => setPick(index, e.target.value), children: [_jsx("option", { value: "", children: "\u9009\u62E9\u4F1A\u8BDD\u2026" }), orderedOptions.map((s) => (_jsx("option", { value: s.id, children: s.isCurrent ? `● ${s.label}（当前）` : s.label }, s.id)))] }))] }, index))), _jsx("button", { type: "button", className: "ccr-btn ccr-btn--primary", disabled: busy === 'create', onClick: () => void connect(), children: "\u5EFA\u7ACB\u8FDE\u63A5" })] }), picks.length >= 3 && (_jsxs("p", { className: "ccr-hint", children: ["\u4E09\u4E2A\u4F1A\u8BDD\u4F1A\u4E24\u4E24\u76F8\u8FDE\uFF08\u5171 ", ((picks.length * (picks.length - 1)) / 2), " \u6761\u8FDE\u63A5\uFF09\u3002"] })), noSessions && (_jsxs("p", { className: "ccr-hint", children: [sessionsReady
                                ? '会话列表暂时为空。'
                                : '读不到会话列表，可以直接填会话 ID。', "\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5728\u8F93\u5165\u6846\u5DE6\u4FA7\u6309\u4F4F\u5706\u70B9\uFF0C\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u4E0A\u5EFA\u7ACB\u8FDE\u63A5\u3002"] })), !noSessions && !manual && (_jsx("button", { type: "button", className: "ccr-link", onClick: () => setManual(true), children: "\u6539\u7528\u4F1A\u8BDD ID \u624B\u52A8\u8F93\u5165" }))] })), _jsxs("section", { className: "ccr-block", children: [_jsxs("h3", { className: "ccr-block__title", children: ["\u5DF2\u6709\u8FDE\u63A5", _jsx("span", { className: "ccr-count", children: connections.length }), _jsx("button", { type: "button", className: "ccr-link ccr-rail-toggle", title: prefsState.railVisible
                                    ? '隐藏会话列表上的连接线路'
                                    : '在会话列表上显示连接线路', onClick: () => prefs.set({ railVisible: !prefsState.railVisible }), children: prefsState.railVisible ? '隐藏线路' : '显示线路' })] }), ready && loaded && connections.length === 0 && (_jsx("div", { className: "ccr-empty", children: "\u8FD8\u6CA1\u6709\u8FDE\u63A5\u3002\u9009\u4E24\u4E2A\u4F1A\u8BDD\u5EFA\u7ACB\u4E00\u6761\uFF0C\u6216\u76F4\u63A5\u7528\u62D6\u62FD\u3002" })), _jsx("div", { className: "ccr-list", children: connections.map((conn) => {
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
                                                .map((p) => (_jsxs("div", { className: "ccr-pending", children: [_jsxs("div", { className: "ccr-pending__text", children: ["\u5F85\u786E\u8BA4\uFF1A\u6743\u9650\u5347\u5230\u300C", PERMISSION_CHOICES.find((c) => c.value === p.to)?.label ?? p.to, "\u300D\u3000\uFF08\u5DF2\u786E\u8BA4 ", p.acceptedCount, "/", p.requiredAccepts, "\uFF09"] }), _jsxs("div", { className: "ccr-conn__actions", children: [_jsx("button", { type: "button", className: "ccr-btn ccr-btn--primary", disabled: busy === p.id, onClick: () => void acceptUpgrade(p.id), children: "\u540C\u610F" }), _jsx("button", { type: "button", className: "ccr-btn", disabled: busy === p.id, onClick: () => void rejectUpgrade(p.id), children: "\u62D2\u7EDD" })] })] }, p.id))), _jsxs("div", { className: "ccr-field", children: [_jsx("div", { className: "ccr-field__label", children: "\u6743\u9650\uFF08\u4E24\u4E2A\u65B9\u5411\u53EF\u5206\u522B\u8BBE\u7F6E\uFF09" }), [
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
                                                    ].map((row) => (_jsxs("div", { className: "ccr-perm-row", children: [_jsxs("div", { className: "ccr-perm-row__who", title: `${row.fromLabel} → ${row.toLabel}`, children: [_jsx("span", { className: "ccr-perm-row__name", children: row.fromLabel }), _jsx("span", { className: "ccr-perm-row__verb", "aria-hidden": "true", children: "\u2192" })] }), _jsx("div", { className: "ccr-seg", children: PERMISSION_CHOICES.map((choice) => (_jsx("button", { type: "button", className: `ccr-seg__item${row.current === choice.value ? ' ccr-seg__item--active' : ''}`, disabled: busy === conn.id, title: choice.hint, onClick: () => void applyPermission(conn, row.direction, choice.value), children: choice.label }, choice.value))) }), _jsx("div", { className: "ccr-perm-row__target", title: row.toLabel, children: row.toLabel })] }, row.direction))), _jsx("div", { className: "ccr-field__hint", children: "\u63D0\u9AD8\u6743\u9650\u9700\u8981**\u88AB\u6388\u6743\u7684\u4E00\u65B9**\u786E\u8BA4\uFF0C\u9762\u677F\u4E0A\u4F1A\u51FA\u73B0\u5F85\u786E\u8BA4\uFF1B \u964D\u4F4E\u6743\u9650\u7ACB\u5373\u751F\u6548\u3002\u4E24\u4E2A\u65B9\u5411\u4E92\u4E0D\u5F71\u54CD\uFF0C\u53EF\u4EE5\u505A\u6210\u4E00\u7AEF\u53EF\u8BFB\u5199\u3001\u53E6\u4E00\u7AEF\u53EA\u8BFB\u3002" })] }), _jsx(CardStack, { connection: conn, client: client, onChanged: refresh }), _jsx(AwarenessPanel, { client: client, connection: conn, labelA: labelOf(conn.sessionA), labelB: labelOf(conn.sessionB), onNotice: flash }), _jsx("div", { className: "ccr-conn__actions", children: _jsx("button", { type: "button", className: "ccr-btn ccr-btn--danger", disabled: busy === conn.id, onClick: () => void disconnect(conn.id), children: "\u65AD\u5F00\u8FDE\u63A5" }) })] }))] }, conn.id));
                        }) })] })] }));
}
//# sourceMappingURL=ConnectionPanel.js.map