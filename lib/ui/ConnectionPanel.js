import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * ConnectionPanel — 连接卡片面板。
 * 入口：sidebar.panellist 槽位。
 * 结构：顶部 tab（全部/正常/告警）→ 连接行（可展开卡片列表）。
 *
 * 数据来自宿主（经 Connection RPC），用 useConnections 轮询刷新。
 */
import { useState, useCallback } from 'react';
import { useConnections } from './hooks/useConnections.js';
import { CardStack } from './CardStack.js';
const PERM_LABELS = {
    read: '只读',
    suggest: '建议',
    write: '写入',
};
const PERM_CYCLE = ['read', 'suggest', 'write'];
export function ConnectionPanel({ client }) {
    const { connections, error, loaded, refresh } = useConnections(client);
    const [expandedId, setExpandedId] = useState(null);
    const [tab, setTab] = useState('all');
    const [busy, setBusy] = useState(null);
    const toggleExpand = useCallback((id) => {
        setExpandedId((prev) => (prev === id ? null : id));
    }, []);
    /** 权限升级：低→高走协商（需双方确认），高→低直接生效。 */
    const cyclePermission = useCallback(async (conn, direction) => {
        if (!client)
            return;
        const current = conn.permission[direction];
        const next = PERM_CYCLE[(PERM_CYCLE.indexOf(current) + 1) % PERM_CYCLE.length];
        setBusy(conn.id);
        try {
            await client.requestPermissionUpgrade(conn.id, direction, next);
            await refresh();
        }
        catch (e) {
            console.error('[connection-panel] 权限变更失败:', e);
        }
        finally {
            setBusy(null);
        }
    }, [client, refresh]);
    const disconnect = useCallback(async (id) => {
        if (!client)
            return;
        setBusy(id);
        try {
            await client.disconnect(id);
            await refresh();
        }
        catch (e) {
            console.error('[connection-panel] 断开失败:', e);
        }
        finally {
            setBusy(null);
        }
    }, [client, refresh]);
    const filtered = connections.filter((c) => {
        if (tab === 'all')
            return true;
        if (tab === 'normal')
            return c.health === 'green' && c.status !== 'broken';
        return c.health !== 'green' || c.status === 'broken';
    });
    return (_jsxs("div", { className: "ccr-panel", children: [_jsx("div", { className: "ccr-panel__tabs", children: ['all', 'normal', 'alert'].map((t) => (_jsx("div", { className: `ccr-panel__tab${tab === t ? ' ccr-panel__tab--active' : ''}`, onClick: () => setTab(t), children: t === 'all' ? '全部' : t === 'normal' ? '正常' : '告警' }, t))) }), !client && _jsx("div", { className: "ccr-panel__empty", children: "\u8FDE\u63A5\u5BBF\u4E3B\u901A\u9053\u672A\u5C31\u7EEA" }), client && error && _jsxs("div", { className: "ccr-panel__error", children: ["\u5BBF\u4E3B\u901A\u4FE1\u5931\u8D25\uFF1A", error] }), client && !error && loaded && filtered.length === 0 && (_jsx("div", { className: "ccr-panel__empty", children: "\u6682\u65E0\u8FDE\u63A5\uFF08\u6309\u4F4F\u8F93\u5165\u6846\u5DE6\u4FA7\u5C0F\u5706\u70B9\u62D6\u5230\u4F1A\u8BDD\u4E0A\uFF09" })), _jsx("div", { className: "ccr-panel__list", children: filtered.map((conn) => {
                    const aToB = conn.permission.aToB;
                    const bToA = conn.permission.bToA;
                    const permLabel = aToB === bToA ? PERM_LABELS[aToB] : `${PERM_LABELS[aToB]}↔${PERM_LABELS[bToA]}`;
                    const healthColor = conn.health === 'green' ? '#10B981' : conn.health === 'yellow' ? '#F59E0B' : '#EF4444';
                    return (_jsxs("div", { children: [_jsxs("div", { className: `ccr-row${expandedId === conn.id ? ' ccr-row--open' : ''}`, onClick: () => toggleExpand(conn.id), title: conn.id, children: [_jsx("span", { style: { color: healthColor }, children: "\u25CF" }), ' ', conn.sessionA.slice(0, 6), " \u2194 ", conn.sessionB.slice(0, 6), " ", permLabel, " [", conn.cards.length, " \u5361\u7247]"] }), expandedId === conn.id && (_jsxs(_Fragment, { children: [_jsx(CardStack, { connection: conn }), _jsxs("div", { className: "ccr-actions", children: [_jsxs("button", { type: "button", disabled: busy === conn.id, onClick: (e) => {
                                                    e.stopPropagation();
                                                    void cyclePermission(conn, 'aToB');
                                                }, children: ["A\u2192B ", PERM_LABELS[aToB]] }), _jsxs("button", { type: "button", disabled: busy === conn.id, onClick: (e) => {
                                                    e.stopPropagation();
                                                    void cyclePermission(conn, 'bToA');
                                                }, children: ["B\u2192A ", PERM_LABELS[bToA]] }), _jsx("button", { type: "button", disabled: busy === conn.id, onClick: (e) => {
                                                    e.stopPropagation();
                                                    void disconnect(conn.id);
                                                }, children: "\u65AD\u5F00" })] })] }))] }, conn.id));
                }) })] }));
}
//# sourceMappingURL=ConnectionPanel.js.map