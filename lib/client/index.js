import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * dsh-connection-card-host — 浏览器端入口。
 *
 * 通过 ctx.slots.inject() 向 DSH UI 槽位贡献组件：
 *   - conversation.input.activity：输入框左侧小圆圈（AnchorCircle）
 *   - sidebar.panellist：连接卡片面板（ConnectionPanel）
 *
 * 宿主数据通过 DSH 官方 Connection RPC 通道读取（ctx.connection.rpc）。
 * 作用域遵循 Cordis fiber 生命周期。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnchorCircle } from '../ui/AnchorCircle.js';
import { DragLine } from '../ui/DragLine.js';
import { ConnectionPanel } from '../ui/ConnectionPanel.js';
import { useDragLine } from '../ui/hooks/useDragLine.js';
import { createHostClient, resolveRpcCaller } from './host-client.js';
import { injectStyles } from '../styles/tokens.js';
import { safeCtxGet } from '../safe-ctx.js';
/** 需要 slots 注入 UI，需要 connection 提供宿主 RPC 通道。 */
export const inject = ['slots', 'connection'];
/** 读取当前激活会话 id（拖拽起点）。 */
function findSourceSession() {
    // DSH 会话列表项使用 data-session-id；当前激活会话在 composer 区标 data-current-session
    const current = document.querySelector('[data-current-session]');
    const direct = current?.getAttribute('data-current-session');
    if (direct)
        return direct;
    // 退化：从 URL 解析
    const m = location.href.match(/session[=/]([^&#]+)/i);
    return m ? m[1] : null;
}
/** 命中松手位置下的会话列表项。 */
function sessionIdAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const item = el?.closest('[data-session-id]');
    return item?.getAttribute('data-session-id') ?? null;
}
export function apply(ctx) {
    const rpc = resolveRpcCaller(ctx);
    // 客户端只构造一次；rpc 缺席时保持 null，面板显示"通道未就绪"
    const client = rpc ? createHostClient(rpc) : null;
    if (!rpc) {
        ctx.logger?.warn?.('[connection-card-host] ctx.connection.rpc 不可用；面板将无法读取宿主连接');
    }
    // 样式注入：CSS 作为字符串打进 bundle，运行时挂 <style>（生态通用做法）。
    // 关键几何另有内联兜底，注入失败也不会出现"看不见的控件"。
    try {
        const removeStyles = injectStyles();
        // ctx.effect(execute, label)：execute 返回 disposer
        const effect = safeCtxGet(ctx, 'effect');
        if (typeof effect === 'function')
            effect(() => removeStyles, 'connection-card-host: styles');
    }
    catch (e) {
        ctx.logger?.warn?.(`[connection-card-host] 样式注入失败: ${String(e)}`);
    }
    // ═══ 小圆圈（含拖拽拉线）═══
    const AnchorWidget = () => {
        const drag = useDragLine();
        // 拉线退出动效播完后置 true 才卸载（shrinking→pulsing 需要保持挂载）
        const [lineDone, setLineDone] = useState(false);
        const beginDrag = useCallback((x, y) => {
            setLineDone(false);
            drag.onMouseDown(x, y);
        }, [drag]);
        // 鼠标拖拽：全局 move/up。
        // 注意：onMouseUp 后 drag.state.start/current 仍保留（hook 有意保留终点），
        // 因此拉线不会瞬间消失，而是交给 DragLine 播退出动效。
        useEffect(() => {
            if (!drag.state.dragging)
                return;
            const onMove = (e) => drag.onMouseMove(e.clientX, e.clientY);
            const onUp = (e) => {
                const targetId = sessionIdAtPoint(e.clientX, e.clientY);
                const sourceId = findSourceSession();
                if (targetId && sourceId && sourceId !== targetId) {
                    void client?.createConnection(sourceId, targetId).catch((err) => {
                        console.error('[connection-card-host] 建立连接失败:', err);
                    });
                }
                drag.onMouseUp();
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            return () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
        }, [drag.state.dragging]);
        // 触屏拖拽：8px 阈值 + 16px 锚点半径在 useDragLine 内判定
        useEffect(() => {
            if (!drag.state.dragging)
                return;
            const onMove = (e) => {
                const t = e.touches[0];
                if (t && drag.onTouchMove(t.clientX, t.clientY))
                    e.preventDefault();
            };
            const onEnd = (e) => {
                const t = e.changedTouches[0];
                if (t) {
                    const targetId = sessionIdAtPoint(t.clientX, t.clientY);
                    const sourceId = findSourceSession();
                    if (targetId && sourceId && sourceId !== targetId) {
                        void client?.createConnection(sourceId, targetId).catch((err) => {
                            console.error('[connection-card-host] 建立连接失败:', err);
                        });
                    }
                }
                drag.onTouchEnd();
            };
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onEnd);
            return () => {
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('touchend', onEnd);
            };
        }, [drag.state.dragging]);
        const showLine = Boolean(drag.state.start && drag.state.current && !lineDone);
        return (_jsxs(_Fragment, { children: [_jsx(AnchorCircle, { onDragStart: beginDrag, onTouchStart: drag.onTouchStart, onTouchMove: drag.onTouchMove, onTouchEnd: drag.onTouchEnd }), showLine && drag.state.start && drag.state.current && (_jsx(DragLine, { start: drag.state.start, end: drag.state.current, releasing: !drag.state.dragging, onComplete: () => setLineDone(true) }))] }));
    };
    // ═══ 卡片面板 ═══
    const PanelWidget = () => {
        const stable = useMemo(() => client, []);
        return _jsx(ConnectionPanel, { client: stable });
    };
    // ═══ 槽位注册（inject 自动绑定 fiber 生命周期）═══
    //
    // conversation.input.left：composer 工具行左侧的紧凑控件区。
    //   kind=list / replaceRisk=none —— 用自己的 id 会被「追加」在出厂控件旁边，
    //   不会顶掉任何已有 UI。
    //   ⚠️ 不要用 conversation.input.activity：那是 single + shadows-shipped-ui，
    //   占位即替换出厂的活动指示器，且出厂 UI 先注册时会直接抛
    //   `single slot ... already has a registration`。
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'connection-anchor', order: 100, label: '连接' }, () => AnchorWidget()));
    // sidebar.panellist：侧栏全局面板图标列表（kind=list / replaceRisk=none）
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'connection-panel', order: 200, label: '连接' }, () => PanelWidget()));
}
//# sourceMappingURL=index.js.map