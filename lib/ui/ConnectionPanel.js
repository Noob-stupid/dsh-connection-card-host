import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { permValue } from '../types/index.js';
import { useConnections } from './hooks/useConnections.js';
import { useSessionList } from './hooks/useSessionList.js';
import { CardStack } from './CardStack.js';
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
export function ConnectionPanel({ client, sessions }) {
    const { connections, error, loaded, refresh } = useConnections(client);
    const { options: sessionOptions, labelOf, ready: sessionsReady } = useSessionList(sessions);
    const [sessionA, setSessionA] = useState('');
    const [sessionB, setSessionB] = useState('');
    const [manual, setManual] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const [busy, setBusy] = useState(null);
    const [notice, setNotice] = useState(null);
    const [pending, setPending] = useState([]);
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
    const connect = useCallback(async () => {
        if (!client)
            return;
        if (!sessionA || !sessionB) {
            flash('请选择两个会话');
            return;
        }
        if (sessionA === sessionB) {
            flash('不能把会话连到它自己');
            return;
        }
        setBusy('create');
        try {
            await client.createConnection(sessionA, sessionB);
            setSessionA('');
            setSessionB('');
            flash('已建立连接');
            await refresh();
        }
        catch (e) {
            flash(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(null);
        }
    }, [client, sessionA, sessionB, refresh, flash]);
    /** 设置权限：双向一起设（用户看到的是一个「权限」）。 */
    const applyPermission = useCallback(async (conn, level) => {
        if (!client)
            return;
        setBusy(conn.id);
        try {
            const isUpgrade = permValue(level) > permValue(conn.permission.aToB) ||
                permValue(level) > permValue(conn.permission.bToA);
            await client.requestPermissionUpgrade(conn.id, 'aToB', level);
            await client.requestPermissionUpgrade(conn.id, 'bToA', level);
            await refresh();
            flash(isUpgrade ? '已发出升级请求（需双方确认，60 秒内有效）' : '权限已更新');
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
    return (_jsxs("div", { className: "ccr-page", children: [_jsxs("header", { className: "ccr-page__head", children: [_jsx("h2", { className: "ccr-page__title", children: "\u4F1A\u8BDD\u8FDE\u63A5" }), _jsx("p", { className: "ccr-page__sub", children: "\u5728\u4E24\u4E2A\u4F1A\u8BDD\u4E4B\u95F4\u5EFA\u7ACB\u6709\u72B6\u6001\u8FDE\u63A5\uFF0C\u8FDE\u63A5\u4E0A\u53EF\u4EE5\u6302\u8F7D\u5361\u7247\u3002 \u4E5F\u53EF\u4EE5\u5728\u8F93\u5165\u6846\u5DE6\u4FA7\u6309\u4F4F\u5706\u70B9\uFF0C\u76F4\u63A5\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u4E0A\u5EFA\u7ACB\u3002" })] }), !ready && _jsx("div", { className: "ccr-empty", children: "\u8FDE\u63A5\u5BBF\u4E3B\u901A\u9053\u672A\u5C31\u7EEA" }), ready && error && _jsxs("div", { className: "ccr-error", children: ["\u5BBF\u4E3B\u901A\u4FE1\u5931\u8D25\uFF1A", error] }), notice && _jsx("div", { className: "ccr-notice", children: notice }), ready && (_jsxs("section", { className: "ccr-block", children: [_jsx("h3", { className: "ccr-block__title", children: "\u65B0\u5EFA\u8FDE\u63A5" }), _jsxs("div", { className: "ccr-form", children: [useManualInput ? (_jsxs(_Fragment, { children: [_jsx("input", { className: "ccr-input", placeholder: "\u4F1A\u8BDD ID A", value: sessionA, onChange: (e) => setSessionA(e.target.value.trim()) }), _jsx("span", { className: "ccr-form__sep", children: "\u2194" }), _jsx("input", { className: "ccr-input", placeholder: "\u4F1A\u8BDD ID B", value: sessionB, onChange: (e) => setSessionB(e.target.value.trim()) })] })) : (_jsxs(_Fragment, { children: [_jsxs("select", { className: "ccr-select", value: sessionA, onChange: (e) => setSessionA(e.target.value), children: [_jsx("option", { value: "", children: "\u9009\u62E9\u4F1A\u8BDD\u2026" }), orderedOptions.map((s) => (_jsx("option", { value: s.id, children: s.isCurrent ? `● ${s.label}（当前）` : s.label }, s.id)))] }), _jsx("span", { className: "ccr-form__sep", children: "\u2194" }), _jsxs("select", { className: "ccr-select", value: sessionB, onChange: (e) => setSessionB(e.target.value), children: [_jsx("option", { value: "", children: "\u9009\u62E9\u4F1A\u8BDD\u2026" }), orderedOptions.map((s) => (_jsx("option", { value: s.id, children: s.isCurrent ? `● ${s.label}（当前）` : s.label }, s.id)))] })] })), _jsx("button", { type: "button", className: "ccr-btn ccr-btn--primary", disabled: busy === 'create', onClick: () => void connect(), children: "\u5EFA\u7ACB\u8FDE\u63A5" })] }), noSessions && (_jsxs("p", { className: "ccr-hint", children: [sessionsReady
                                ? '会话列表暂时为空。'
                                : '读不到会话列表，可以直接填会话 ID。', "\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5728\u8F93\u5165\u6846\u5DE6\u4FA7\u6309\u4F4F\u5706\u70B9\uFF0C\u62D6\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u4E0A\u5EFA\u7ACB\u8FDE\u63A5\u3002"] })), !noSessions && !manual && (_jsx("button", { type: "button", className: "ccr-link", onClick: () => setManual(true), children: "\u6539\u7528\u4F1A\u8BDD ID \u624B\u52A8\u8F93\u5165" }))] })), _jsxs("section", { className: "ccr-block", children: [_jsxs("h3", { className: "ccr-block__title", children: ["\u5DF2\u6709\u8FDE\u63A5", _jsx("span", { className: "ccr-count", children: connections.length })] }), ready && loaded && connections.length === 0 && (_jsx("div", { className: "ccr-empty", children: "\u8FD8\u6CA1\u6709\u8FDE\u63A5\u3002\u9009\u4E24\u4E2A\u4F1A\u8BDD\u5EFA\u7ACB\u4E00\u6761\uFF0C\u6216\u76F4\u63A5\u7528\u62D6\u62FD\u3002" })), _jsx("div", { className: "ccr-list", children: connections.map((conn) => {
                            const health = conn.health ?? 'green';
                            const level = conn.permission.aToB;
                            const symmetric = conn.permission.aToB === conn.permission.bToA;
                            const open = expandedId === conn.id;
                            return (_jsxs("article", { className: `ccr-conn${open ? ' ccr-conn--open' : ''}`, children: [_jsxs("button", { type: "button", className: "ccr-conn__head", onClick: () => setExpandedId(open ? null : conn.id), children: [_jsx("span", { className: "ccr-dot", style: { background: HEALTH_COLOR[health] } }), _jsxs("span", { className: "ccr-conn__pair", children: [_jsx("span", { className: "ccr-conn__session", children: labelOf(conn.sessionA) }), _jsx("span", { className: "ccr-conn__arrow", children: "\u2194" }), _jsx("span", { className: "ccr-conn__session", children: labelOf(conn.sessionB) })] }), _jsxs("span", { className: "ccr-conn__meta", children: [HEALTH_TEXT[health] ?? health, " \u00B7", ' ', symmetric
                                                        ? PERMISSION_CHOICES.find((c) => c.value === level)?.label ?? level
                                                        : '权限不一致', ' ', "\u00B7 ", conn.cards.length, " \u5361\u7247"] }), _jsx("span", { className: "ccr-chevron", children: open ? '▾' : '▸' })] }), open && (_jsxs("div", { className: "ccr-conn__body", children: [pending
                                                .filter((p) => p.connectionId === conn.id)
                                                .map((p) => (_jsxs("div", { className: "ccr-pending", children: [_jsxs("div", { className: "ccr-pending__text", children: ["\u5F85\u786E\u8BA4\uFF1A\u6743\u9650\u5347\u5230\u300C", PERMISSION_CHOICES.find((c) => c.value === p.to)?.label ?? p.to, "\u300D\u3000\uFF08\u5DF2\u786E\u8BA4 ", p.acceptedCount, "/", p.requiredAccepts, "\uFF09"] }), _jsxs("div", { className: "ccr-conn__actions", children: [_jsx("button", { type: "button", className: "ccr-btn ccr-btn--primary", disabled: busy === p.id, onClick: () => void acceptUpgrade(p.id), children: "\u540C\u610F" }), _jsx("button", { type: "button", className: "ccr-btn", disabled: busy === p.id, onClick: () => void rejectUpgrade(p.id), children: "\u62D2\u7EDD" })] })] }, p.id))), _jsxs("div", { className: "ccr-field", children: [_jsx("div", { className: "ccr-field__label", children: "\u6743\u9650" }), _jsx("div", { className: "ccr-seg", children: PERMISSION_CHOICES.map((choice) => (_jsx("button", { type: "button", className: `ccr-seg__item${level === choice.value && symmetric ? ' ccr-seg__item--active' : ''}`, disabled: busy === conn.id, title: choice.hint, onClick: () => void applyPermission(conn, choice.value), children: choice.label }, choice.value))) }), _jsxs("div", { className: "ccr-field__hint", children: [PERMISSION_CHOICES.find((c) => c.value === level)?.hint, "\uFF08\u53CC\u5411\u540C\u65F6\u8BBE\u7F6E\uFF1B\u5347\u7EA7\u9700\u8981\u53CC\u65B9\u786E\u8BA4\uFF09"] })] }), _jsx(CardStack, { connection: conn, client: client, onChanged: refresh }), _jsx("div", { className: "ccr-conn__actions", children: _jsx("button", { type: "button", className: "ccr-btn ccr-btn--danger", disabled: busy === conn.id, onClick: () => void disconnect(conn.id), children: "\u65AD\u5F00\u8FDE\u63A5" }) })] }))] }, conn.id));
                        }) })] })] }));
}
//# sourceMappingURL=ConnectionPanel.js.map