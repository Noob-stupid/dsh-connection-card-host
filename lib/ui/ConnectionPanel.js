import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ConnectionPanel — 卡片面板。
 * 入口：sidebar.panellist 槽位。
 * 结构：顶部 tab（全部/正常/告警）→ 连接行（可展开卡片列表）。
 * 悬停连接行 → 轨道对应高亮；悬停轨道 → 面板行背景填充。
 */
import { useState, useEffect, useCallback } from 'react';
import { CardStack } from './CardStack.js';
const PERM_LABELS = { read: '只读', suggest: '建议', write: '写入' };
export function ConnectionPanel({ host }) {
    const [connections, setConnections] = useState([]);
    const [expandedId, setExpandedId] = useState(null);
    const [tab, setTab] = useState('all');
    // 订阅连接变更，实时刷新
    useEffect(() => {
        const refresh = () => setConnections(host.getAllConnections());
        refresh();
        const off1 = host.onConnectionEvent('created', refresh);
        const off2 = host.onConnectionEvent('updated', refresh);
        const off3 = host.onConnectionEvent('disconnected', refresh);
        return () => { off1(); off2(); off3(); };
    }, [host]);
    const toggleExpand = useCallback((id) => {
        setExpandedId((prev) => (prev === id ? null : id));
    }, []);
    const filtered = connections.filter((c) => {
        if (tab === 'all')
            return true;
        if (tab === 'normal')
            return c.health === 'green' && c.status !== 'broken';
        return c.health !== 'green' || c.status === 'broken';
    });
    return (_jsxs("div", { className: "connection-panel", children: [_jsx("div", { className: "connection-panel__tabs", children: ['all', 'normal', 'alert'].map((t) => (_jsx("div", { className: `connection-panel__tab${tab === t ? ' connection-panel__tab--active' : ''}`, onClick: () => setTab(t), children: t === 'all' ? '全部' : t === 'normal' ? '正常' : '告警' }, t))) }), _jsxs("div", { className: "connection-panel__list", children: [filtered.length === 0 && (_jsx("div", { style: { padding: 16, opacity: 0.5 }, children: "\u6682\u65E0\u8FDE\u63A5" })), filtered.map((conn) => {
                        const permLabel = conn.permission.aToB === conn.permission.bToA
                            ? PERM_LABELS[conn.permission.aToB]
                            : `${PERM_LABELS[conn.permission.aToB]}↔${PERM_LABELS[conn.permission.bToA]}`;
                        const healthColor = conn.health === 'green' ? '#10B981' : conn.health === 'yellow' ? '#F59E0B' : '#EF4444';
                        return (_jsxs("div", { children: [_jsxs("div", { className: `connection-row${expandedId === conn.id ? ' connection-row--highlighted' : ''}`, onClick: () => toggleExpand(conn.id), children: [_jsx("span", { style: { color: healthColor }, children: "\u25CF" }), ' ', conn.sessionA.slice(0, 6), " \u2194 ", conn.sessionB.slice(0, 6), ' ', permLabel, " [", conn.cards.length, " \u5F20\u5361\u7247]"] }), expandedId === conn.id && _jsx(CardStack, { connection: conn })] }, conn.id));
                    })] })] }));
}
//# sourceMappingURL=ConnectionPanel.js.map