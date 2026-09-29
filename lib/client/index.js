import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * dsh-connection-card-host — 浏览器端入口。
 *
 * 槽位注册（都挑 kind=list / replaceRisk=none 的追加位，不抢出厂 UI）：
 *   - conversation.input.left : 输入框工具行左侧的连接锚点（小圆点）
 *   - sidebar.panellist       : 侧栏图标 —— **只放图标**，点击由侧栏负责切主面板
 *   - main (key=同 id)        : 真正的连接管理面板
 *   - shell.overlay           : 左侧会话列表上的竖直连接线（覆盖层）
 *
 * 宿主数据经 DSH 官方 Connection RPC 通道读取（ctx.connection.rpc）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnchorCircle } from '../ui/AnchorCircle.js';
import { DragLine } from '../ui/DragLine.js';
import { ConnectionPanel } from '../ui/ConnectionPanel.js';
import { ConnectionPanelIcon } from '../ui/ConnectionPanelIcon.js';
import { SessionRailOverlay } from '../ui/SessionRailOverlay.js';
import { SessionRowMarker } from '../ui/SessionRowMarker.js';
import { useDragLine } from '../ui/hooks/useDragLine.js';
import { createHostClient, resolveRpcCaller } from './host-client.js';
import { resolveSessions } from './sessions-bridge.js';
import { createViewPrefs } from './view-prefs.js';
import { sessionRowAtPoint } from './row-map.js';
import { injectStyles } from '../styles/tokens.js';
import { safeCtxGet } from '../safe-ctx.js';
/** 侧栏图标 id 与主面板 key 必须一致，侧栏才能找到对应面板。 */
const PANEL_ID = 'connection-panel';
/** 需要 slots 注入 UI，connection 提供宿主 RPC，sessions 提供会话身份。 */
export const inject = ['slots', 'connection', 'sessions'];
const STYLE_TAG_ID = 'dsh-connection-card-host-styles';
/**
 * 布局探针：把锚点往上 5 层祖先的尺寸记下来。
 *
 * 用户反馈「拖拽时整个输入区域在动」，但看不到屏幕，只能靠这个定位
 * 究竟是哪一层盒子被撑开/移位（例如脉冲光环没被绝对定位、样式表丢失等）。
 */
function layoutSnapshot() {
    const parts = [];
    const styleTag = document.getElementById(STYLE_TAG_ID);
    parts.push(`style=${styleTag ? 'yes' : 'MISSING'}`);
    const anchor = document.querySelector('.ccr-anchor');
    if (!anchor) {
        parts.push('anchor=absent');
        return parts.join(' ');
    }
    const fmt = (el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`;
    };
    parts.push(`anchor=${fmt(anchor)}`);
    // 脉冲元素是否存在、是否脱离文档流（position:absolute 才算正常）
    const pulse = anchor.querySelector('.ccr-anchor__pulse');
    parts.push(pulse
        ? `pulse=${fmt(pulse)}/${window.getComputedStyle(pulse).position}`
        : 'pulse=none');
    let node = anchor.parentElement;
    for (let i = 0; node && i < 5; i++) {
        parts.push(`up${i + 1}=${node.tagName.toLowerCase()}.${(node.className || '').toString().split(' ')[0]}:${fmt(node)}`);
        node = node.parentElement;
    }
    return parts.join(' ');
}
export function apply(ctx) {
    const rpc = resolveRpcCaller(ctx);
    const client = rpc ? createHostClient(rpc) : null;
    const sessions = resolveSessions(ctx);
    if (!rpc) {
        ctx.logger?.warn?.('[connection-card-host] ctx.connection.rpc 不可用；面板将无法读取宿主连接');
    }
    if (!sessions) {
        ctx.logger?.warn?.('[connection-card-host] ctx.sessions 不可用；拖拽落点与会话选择器将受限');
    }
    // 样式注入：CSS 作为字符串打进 bundle，运行时挂 <style>。
    // 关键几何另有内联兜底，注入失败也不会出现"看不见的控件"。
    try {
        const removeStyles = injectStyles();
        const effect = safeCtxGet(ctx, 'effect');
        if (typeof effect === 'function')
            effect(() => removeStyles, 'connection-card-host: styles');
    }
    catch (e) {
        ctx.logger?.warn?.(`[connection-card-host] 样式注入失败: ${String(e)}`);
    }
    // ═══ 小圆点 + 拖拽拉线 ═══
    //
    // `sessionId` 来自槽位的 standardProps —— conversation.input.left 是 session 作用域，
    // 官方直接把当前会话 id 传进来了。**不要**去读 ctx.sessions 快照的 current 字段：
    // 实测该字段在当前 DSH 构建里是 undefined（详见 client-debug.log 的 current=none）。
    const AnchorWidget = ({ sessionId }) => {
        const drag = useDragLine();
        const [lineDone, setLineDone] = useState(false);
        // 当前被高亮的会话行（拖拽落点提示）
        const highlightedRef = useRef(null);
        /** 当前落点是「会连接」还是「会断开」，用于避免无谓的 class 抖动。 */
        const highlightModeRef = useRef(null);
        const clearHighlight = useCallback(() => {
            highlightedRef.current?.classList.remove('ccr-target', 'ccr-target--disconnect');
            highlightedRef.current = null;
            highlightModeRef.current = null;
        }, []);
        /** 拖拽开始时缓存的连接表，用于落点提示与「连上则断」判定。 */
        const connsRef = useRef([]);
        /** 两个会话之间是否已有连接。 */
        const findExisting = useCallback((list, a, b) => list.find((c) => (c.sessionA === a && c.sessionB === b) || (c.sessionA === b && c.sessionB === a)), []);
        /** 落点解析：目标会话 + 起点会话 + 是否已连 + 失败原因（诊断用）。 */
        const resolveDrop = useCallback((x, y) => {
            const snap = sessions?.getSnapshot();
            const hit = sessionRowAtPoint(x, y, snap ?? null);
            // 起点优先用槽位给的 sessionId，快照 current 只作兜底
            const sourceId = sessionId ?? snap?.current ?? null;
            const existing = hit && sourceId ? findExisting(connsRef.current, sourceId, hit.id) : undefined;
            let reason;
            if (!sessions)
                reason = 'no-sessions-bridge';
            else if (!hit)
                reason = 'no-row-under-cursor';
            else if (!sourceId)
                reason = 'no-current-session';
            else if (hit.id === sourceId)
                reason = 'same-session';
            else
                reason = 'ok';
            return { hit, sourceId, reason, existing, idCount: snap?.ids?.length ?? 0 };
        }, [sessions, sessionId, findExisting]);
        const beginDrag = useCallback((x, y) => {
            setLineDone(false);
            // 抓一份连接表：落点提示要知道「这一拖是连上还是断开」
            connsRef.current = [];
            if (client) {
                void client
                    .listConnections()
                    .then((list) => {
                    connsRef.current = list;
                })
                    .catch(() => {
                    connsRef.current = [];
                });
            }
            if (client) {
                const snap = sessions?.getSnapshot();
                client.report(`dragStart slotSessionId=${sessionId ?? 'none'} snapshotCurrent=${snap?.current ?? 'none'} ` +
                    `ids=${snap?.ids?.length ?? 0} ` +
                    `rows=${document.querySelectorAll('[role="treeitem"]').length} ` +
                    `marked=${document.querySelectorAll('[data-ccr-session]').length}`);
            }
            drag.onMouseDown(x, y);
        }, [drag, client, sessions, sessionId]);
        /**
         * 松手：**开关语义** —— 已连则断开，未连则连接。
         * 这样不必专门跑面板去断。
         */
        const finishAt = useCallback((x, y) => {
            const { hit, sourceId, reason } = resolveDrop(x, y);
            if (reason !== 'ok' || !hit || !sourceId) {
                if (client)
                    client.report(`dragEnd reason=${reason} hit=${hit?.id ?? 'none'}`);
                clearHighlight();
                return;
            }
            clearHighlight();
            void (async () => {
                try {
                    // 决策前重新取一次，避免用拖拽开始时的旧快照误判
                    const list = client ? await client.listConnections() : [];
                    const existing = findExisting(list, sourceId, hit.id);
                    if (existing) {
                        await client?.disconnect(existing.id);
                        client?.report(`dragEnd toggled-OFF ${sourceId} <-> ${hit.id}`);
                    }
                    else {
                        await client?.createConnection(sourceId, hit.id);
                        client?.report(`dragEnd toggled-ON ${sourceId} <-> ${hit.id}`);
                    }
                }
                catch (err) {
                    client?.report(`dragEnd toggle-failed ${String(err)}`);
                    console.error('[connection-card-host] 连接开关失败:', err);
                }
            })();
        }, [client, resolveDrop, findExisting, clearHighlight]);
        /** 拖拽中的落点高亮。已连的目标用「断开」样式区分。 */
        const trackTarget = useCallback((x, y) => {
            const { hit, sourceId, existing } = resolveDrop(x, y);
            const next = hit && hit.id !== sourceId ? hit.element : null;
            const mode = existing ? 'disconnect' : 'connect';
            if (next !== highlightedRef.current || mode !== highlightModeRef.current) {
                highlightedRef.current?.classList.remove('ccr-target', 'ccr-target--disconnect');
                if (next)
                    next.classList.add(mode === 'disconnect' ? 'ccr-target--disconnect' : 'ccr-target');
                highlightedRef.current = next;
                highlightModeRef.current = next ? mode : null;
            }
        }, [resolveDrop]);
        // 把最新的处理函数放进 ref：下面的全局监听只依赖 `dragging` 一个开关。
        // ⚠️ 之前把整个 `drag` 对象放进依赖数组 —— useDragLine 每次渲染都返回新对象，
        // 于是每次 mousemove 都触发 effect 清理+重挂，cleanup 里的 clearHighlight()
        // 刚加上高亮就把它抹掉，落点提示永远看不见。
        const handlersRef = useRef({ drag, trackTarget, finishAt, clearHighlight });
        handlersRef.current = { drag, trackTarget, finishAt, clearHighlight };
        // 鼠标拖拽
        useEffect(() => {
            if (!drag.state.dragging)
                return;
            const onMove = (e) => {
                const h = handlersRef.current;
                h.drag.onMouseMove(e.clientX, e.clientY);
                h.trackTarget(e.clientX, e.clientY);
            };
            const onUp = (e) => {
                const h = handlersRef.current;
                h.finishAt(e.clientX, e.clientY);
                h.drag.onMouseUp();
            };
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    handlersRef.current.clearHighlight();
                    handlersRef.current.drag.onMouseUp();
                }
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('keydown', onKey);
            // 拖拽期间锁住文本选择：否则鼠标划过页面会选中文字、触发自动滚动，
            // 观感就是「一拖拽整个界面在跑」。
            const prevUserSelect = document.body.style.userSelect;
            const prevCursor = document.body.style.cursor;
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'grabbing';
            return () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('keydown', onKey);
                document.body.style.userSelect = prevUserSelect;
                document.body.style.cursor = prevCursor;
                // 故意不在这里 clearHighlight：这个 cleanup 会在拖拽期间反复触发
            };
        }, [drag.state.dragging]);
        // 拖拽结束才清高亮（单独一个 effect，与监听生命周期解耦）
        useEffect(() => {
            if (!drag.state.dragging)
                clearHighlight();
        }, [drag.state.dragging, clearHighlight]);
        // 触屏拖拽（8px 阈值 + 16px 锚点半径在 useDragLine 内判定）
        useEffect(() => {
            if (!drag.state.dragging)
                return;
            const onMove = (e) => {
                const t = e.touches[0];
                if (!t)
                    return;
                const h = handlersRef.current;
                if (h.drag.onTouchMove(t.clientX, t.clientY))
                    e.preventDefault();
                h.trackTarget(t.clientX, t.clientY);
            };
            const onEnd = (e) => {
                const t = e.changedTouches[0];
                const h = handlersRef.current;
                if (t)
                    h.finishAt(t.clientX, t.clientY);
                h.drag.onTouchEnd();
            };
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onEnd);
            return () => {
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('touchend', onEnd);
            };
        }, [drag.state.dragging]);
        const showLine = Boolean(drag.state.start && drag.state.current && !lineDone);
        return (_jsxs(_Fragment, { children: [_jsx(AnchorCircle, { dragging: drag.state.dragging, onDragStart: beginDrag, onTouchStart: drag.onTouchStart, onTouchMove: drag.onTouchMove, onTouchEnd: drag.onTouchEnd }), showLine && drag.state.start && drag.state.current && (_jsx(DragLine, { start: drag.state.start, end: drag.state.current, releasing: !drag.state.dragging, onComplete: () => setLineDone(true) }))] }));
    };
    const stableClient = client;
    const stableSessions = sessions;
    // 视图偏好：面板与轨道共享（lane 上限等），持久化到 localStorage
    const prefs = createViewPrefs();
    // ═══ 槽位注册 ═══
    //
    // conversation.input.left：composer 工具行左侧的紧凑控件区。
    //   kind=list / replaceRisk=none —— 自己的 id 会被「追加」在出厂控件旁边。
    //   ⚠️ 不要用 conversation.input.activity：single + shadows-shipped-ui，
    //   占位即替换出厂的活动指示器，且出厂 UI 先注册时会直接抛异常。
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'connection-anchor', order: 100, label: '连接' }, 
    // standardProps 里有 sessionId（session 作用域槽位）—— 当前会话 id 由官方传入
    (props) => AnchorWidget({ sessionId: props?.sessionId })));
    // sidebar.panellist：**只放图标**。文档明确："Each list id addresses the
    // matching main panel; the sidebar owns the button"。塞整个面板进来会导致侧栏溢出。
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 200, label: '连接' }, () => ConnectionPanelIcon({ size: 18, active: false })));
    // main（keyed）：真正的面板，key 必须与上面的 list id 相同。
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, () => ConnectionPanel({ client: stableClient, sessions: stableSessions, prefs })));
    // shell.overlay：左侧会话列表上的竖直连接线（纯覆盖，不抢任何槽位）。
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'connection-rail', order: 50, label: '连接轨道' }, () => SessionRailOverlay({ client: stableClient, sessions: stableSessions, prefs })));
    // sidebar.session.row.leading：每行挂一个不可见标记，把会话 id 写到行元素上。
    // 这是 DOM 里唯一能拿到会话身份的地方（会话行本身没有 id 属性）。
    ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({ name: 'sidebar.session.row.leading', id: 'connection-row-marker', order: 100 }, 
    // 该槽位的 ownerProps 是 { sessionId }，由行本身传入
    (props) => {
        const sessionId = props?.sessionId;
        return sessionId ? SessionRowMarker({ sessionId }) : null;
    }));
}
//# sourceMappingURL=index.js.map