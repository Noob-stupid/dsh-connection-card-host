window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-connection-card-host",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/ui/AnchorCircle.tsx
		/**
		* AnchorCircle — 输入框左侧小圆圈。
		* 位置：输入框左侧，垂直居中，距左边缘 8px。
		* 尺寸：默认 12px，悬停 14px。
		* 状态：idle(40%) → hover(80%) → dragging(100% + 脉冲光环)。
		*/
		function AnchorCircle({ onDragStart, onTouchStart, onTouchMove, onTouchEnd }) {
			const [state, setState] = (0, react.useState)("idle");
			const anchorRef = (0, react.useRef)(null);
			const handleMouseEnter = (0, react.useCallback)(() => {
				if (state !== "dragging") setState("hover");
			}, [state]);
			const handleMouseLeave = (0, react.useCallback)(() => {
				if (state !== "dragging") setState("idle");
			}, [state]);
			const handleMouseDown = (0, react.useCallback)((e) => {
				e.preventDefault();
				setState("dragging");
				onDragStart(e.clientX, e.clientY);
			}, [onDragStart]);
			const handleTouchStart = (0, react.useCallback)((e) => {
				if (!onTouchStart) return;
				const t = e.touches[0];
				const rect = anchorRef.current?.getBoundingClientRect();
				const anchorX = (rect?.left ?? t.clientX) + (rect?.width ?? 0) / 2;
				const anchorY = (rect?.top ?? t.clientY) + (rect?.height ?? 0) / 2;
				onTouchStart(t.clientX, t.clientY, anchorX, anchorY);
			}, [onTouchStart]);
			const handleTouchMove = (0, react.useCallback)((e) => {
				if (!onTouchMove) return;
				const t = e.touches[0];
				if (onTouchMove(t.clientX, t.clientY)) {
					e.preventDefault();
					if (state !== "dragging") setState("dragging");
				}
			}, [onTouchMove, state]);
			const handleTouchEnd = (0, react.useCallback)(() => {
				onTouchEnd?.();
				setState("idle");
			}, [onTouchEnd]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: anchorRef,
				className: `anchor-circle anchor-circle--${state}`,
				onMouseEnter: handleMouseEnter,
				onMouseLeave: handleMouseLeave,
				onMouseDown: handleMouseDown,
				onTouchStart: handleTouchStart,
				onTouchMove: handleTouchMove,
				onTouchEnd: handleTouchEnd,
				role: "button",
				"aria-label": "发起会话连接",
				tabIndex: 0,
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						const rect = e.target.getBoundingClientRect();
						setState("dragging");
						onDragStart(rect.left + rect.width / 2, rect.top + rect.height / 2);
					}
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "anchor-circle__pulse" })
			});
		}
		//#endregion
		//#region src/ui/DragLine.tsx
		/**
		* DragLine — 拉线动效（含粒子流动）。
		* 底层：虚线流动线（stroke-dashoffset 动画）。
		* 上层：4 个粒子沿贝塞尔曲线匀速流动（getPointAtLength）。
		* 松手：shrinking(200ms) → pulsing(300ms) → 移除。
		*/
		function buildBezierPath(start, end) {
			const midX = (start.x + end.x) / 2;
			const midY = (start.y + end.y) / 2;
			return `M ${start.x} ${start.y} Q ${midX} ${midY - 20} ${end.x} ${end.y}`;
		}
		function DragLine({ start, end, onComplete }) {
			const [phase, setPhase] = (0, react.useState)("dragging");
			const [particles, setParticles] = (0, react.useState)([]);
			const pathRef = (0, react.useRef)(null);
			const rafRef = (0, react.useRef)(0);
			const path = (0, react.useMemo)(() => buildBezierPath(start, end), [start, end]);
			(0, react.useEffect)(() => {
				if (phase !== "dragging") return;
				const pathEl = pathRef.current;
				if (!pathEl) return;
				const totalLength = pathEl.getTotalLength();
				const count = 4;
				const speed = 320;
				setParticles(Array.from({ length: count }, (_, i) => ({ t: i / count * totalLength })));
				let last = performance.now();
				const tick = (now) => {
					const dt = (now - last) / 1e3;
					last = now;
					setParticles((prev) => prev.map((p) => ({ t: (p.t + speed * dt) % totalLength })));
					rafRef.current = requestAnimationFrame(tick);
				};
				rafRef.current = requestAnimationFrame(tick);
				return () => cancelAnimationFrame(rafRef.current);
			}, [phase, path]);
			(0, react.useEffect)(() => {
				if (phase === "shrinking") {
					const timer = setTimeout(() => setPhase("pulsing"), 200);
					return () => clearTimeout(timer);
				}
				if (phase === "pulsing") {
					const timer = setTimeout(() => onComplete?.(), 300);
					return () => clearTimeout(timer);
				}
			}, [phase, onComplete]);
			/** 外部调用：触发松手动效 */
			const release = (0, react.useCallback)(() => {
				cancelAnimationFrame(rafRef.current);
				setPhase("shrinking");
			}, []);
			(0, react.useEffect)(() => {
				DragLine.__release = release;
			}, [release]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "drag-line",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					ref: pathRef,
					d: path,
					className: `drag-line__path drag-line__path--${phase}`,
					style: { strokeDasharray: "6 4" }
				}), phase === "dragging" && particles.map((p, i) => {
					const point = pathRef.current?.getPointAtLength(p.t);
					if (!point) return null;
					const totalLen = pathRef.current?.getTotalLength() ?? 1;
					const progress = p.t / totalLen;
					const opacity = Math.sin(progress * Math.PI) * .8 + .3;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						className: "drag-line__particle",
						cx: point.x,
						cy: point.y,
						r: 1.5,
						fill: "var(--line-drag-color)",
						opacity,
						style: { filter: "blur(1px)" }
					}, i);
				})]
			});
		}
		//#endregion
		//#region src/ui/CardStack.tsx
		const HEALTH_COLORS = {
			green: "#10B981",
			yellow: "#F59E0B",
			red: "#EF4444"
		};
		function CardStack({ connection }) {
			if (connection.cards.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "card-stack",
				children: connection.cards.map((card) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "card-row",
					children: [
						"├ ",
						card.templateId,
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: HEALTH_COLORS[connection.health],
								marginLeft: 6
							},
							children: "● 正常"
						})
					]
				}, card.instanceId))
			});
		}
		//#endregion
		//#region src/ui/ConnectionPanel.tsx
		/**
		* ConnectionPanel — 卡片面板。
		* 入口：sidebar.panellist 槽位。
		* 结构：顶部 tab（全部/正常/告警）→ 连接行（可展开卡片列表）。
		* 悬停连接行 → 轨道对应高亮；悬停轨道 → 面板行背景填充。
		*/
		const PERM_LABELS = {
			read: "只读",
			suggest: "建议",
			write: "写入"
		};
		function ConnectionPanel({ host }) {
			const [connections, setConnections] = (0, react.useState)([]);
			const [expandedId, setExpandedId] = (0, react.useState)(null);
			const [tab, setTab] = (0, react.useState)("all");
			(0, react.useEffect)(() => {
				const refresh = () => setConnections(host.getAllConnections());
				refresh();
				const off1 = host.onConnectionEvent("created", refresh);
				const off2 = host.onConnectionEvent("updated", refresh);
				const off3 = host.onConnectionEvent("disconnected", refresh);
				return () => {
					off1();
					off2();
					off3();
				};
			}, [host]);
			const toggleExpand = (0, react.useCallback)((id) => {
				setExpandedId((prev) => prev === id ? null : id);
			}, []);
			const filtered = connections.filter((c) => {
				if (tab === "all") return true;
				if (tab === "normal") return c.health === "green" && c.status !== "broken";
				return c.health !== "green" || c.status === "broken";
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "connection-panel",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "connection-panel__tabs",
					children: [
						"all",
						"normal",
						"alert"
					].map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `connection-panel__tab${tab === t ? " connection-panel__tab--active" : ""}`,
						onClick: () => setTab(t),
						children: t === "all" ? "全部" : t === "normal" ? "正常" : "告警"
					}, t))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "connection-panel__list",
					children: [filtered.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: 16,
							opacity: .5
						},
						children: "暂无连接"
					}), filtered.map((conn) => {
						const permLabel = conn.permission.aToB === conn.permission.bToA ? PERM_LABELS[conn.permission.aToB] : `${PERM_LABELS[conn.permission.aToB]}↔${PERM_LABELS[conn.permission.bToA]}`;
						const healthColor = conn.health === "green" ? "#10B981" : conn.health === "yellow" ? "#F59E0B" : "#EF4444";
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: `connection-row${expandedId === conn.id ? " connection-row--highlighted" : ""}`,
							onClick: () => toggleExpand(conn.id),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: healthColor },
									children: "●"
								}),
								" ",
								conn.sessionA.slice(0, 6),
								" ↔ ",
								conn.sessionB.slice(0, 6),
								" ",
								permLabel,
								" [",
								conn.cards.length,
								" 张卡片]"
							]
						}), expandedId === conn.id && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardStack, { connection: conn })] }, conn.id);
					})]
				})]
			});
		}
		//#endregion
		//#region src/ui/hooks/useDragLine.ts
		/**
		* useDragLine — 管理拖拽拉线的状态机。
		* 鼠标：mousedown 立即进入拖拽（0ms）。
		* 触屏：touchstart 记录起点，移动 >8px 且在锚点 16px 内才进入拖拽。
		*/
		const DRAG_THRESHOLD = 8;
		const ANCHOR_RADIUS = 16;
		function useDragLine() {
			const [state, setState] = (0, react.useState)({
				dragging: false,
				start: null,
				current: null
			});
			const touchStartRef = (0, react.useRef)(null);
			const anchorCenterRef = (0, react.useRef)(null);
			return {
				state,
				onMouseDown: (0, react.useCallback)((x, y) => {
					const point = {
						x,
						y
					};
					anchorCenterRef.current = point;
					setState({
						dragging: true,
						start: point,
						current: point
					});
				}, []),
				onMouseMove: (0, react.useCallback)((x, y) => {
					setState((prev) => {
						if (!prev.dragging || !prev.start) return prev;
						return {
							...prev,
							current: {
								x,
								y
							}
						};
					});
				}, []),
				onMouseUp: (0, react.useCallback)(() => {
					setState((prev) => ({
						...prev,
						dragging: false
					}));
				}, []),
				onTouchStart: (0, react.useCallback)((x, y, anchorX, anchorY) => {
					touchStartRef.current = {
						x,
						y
					};
					anchorCenterRef.current = {
						x: anchorX,
						y: anchorY
					};
				}, []),
				onTouchMove: (0, react.useCallback)((x, y) => {
					const ts = touchStartRef.current;
					const ac = anchorCenterRef.current;
					if (!ts || !ac) return false;
					const dx = x - ts.x;
					const dy = y - ts.y;
					const distance = Math.hypot(dx, dy);
					if (!state.dragging) {
						if (distance > DRAG_THRESHOLD) if (Math.hypot(x - ac.x, y - ac.y) < ANCHOR_RADIUS) {
							setState({
								dragging: true,
								start: ts,
								current: {
									x,
									y
								}
							});
							return true;
						} else {
							touchStartRef.current = null;
							return false;
						}
						return false;
					}
					setState((prev) => ({
						...prev,
						current: {
							x,
							y
						}
					}));
					return true;
				}, [state.dragging]),
				onTouchEnd: (0, react.useCallback)(() => {
					const result = state.dragging ? state.current : null;
					touchStartRef.current = null;
					setState({
						dragging: false,
						start: null,
						current: null
					});
					return result;
				}, [state.dragging, state.current])
			};
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* dsh-connection-card-host — 浏览器端入口。
		* 通过 ctx.slots.inject() 向 DSH UI 槽位贡献组件：
		*   - conversation.input.activity：输入框左侧小圆圈（AnchorCircle）
		*   - sidebar.panellist：卡片面板入口（ConnectionPanel）
		* 绝不导入其他功能插件的组件；作用域遵循 Cordis effect 生命周期。
		*/
		const inject = ["slots"];
		/** 从宿主服务获取连接列表（浏览器端经 Remote/API 调用） */
		function getHost(ctx) {
			try {
				return ctx.get?.("connectionCardHost") ?? null;
			} catch {
				return null;
			}
		}
		function apply(ctx) {
			const host = getHost(ctx);
			const AnchorWidget = () => {
				const drag = useDragLine();
				(0, react.useEffect)(() => {
					if (!drag.state.dragging) return;
					const onMove = (e) => drag.onMouseMove(e.clientX, e.clientY);
					const onUp = (e) => {
						const sessionItem = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-session-id]");
						if (sessionItem && drag.state.start) {
							const targetId = sessionItem.getAttribute("data-session-id");
							const sourceId = findSourceSession();
							if (sourceId && targetId && sourceId !== targetId) host?.createConnection(sourceId, targetId);
						}
						drag.onMouseUp();
					};
					window.addEventListener("mousemove", onMove);
					window.addEventListener("mouseup", onUp);
					return () => {
						window.removeEventListener("mousemove", onMove);
						window.removeEventListener("mouseup", onUp);
					};
				}, [drag.state.dragging]);
				(0, react.useEffect)(() => {
					if (!drag.state.dragging) return;
					const onMove = (e) => {
						const t = e.touches[0];
						if (drag.onTouchMove(t.clientX, t.clientY)) e.preventDefault();
					};
					const onEnd = (e) => {
						const touch = e.changedTouches[0];
						const sessionItem = document.elementFromPoint(touch.clientX, touch.clientY)?.closest("[data-session-id]");
						if (sessionItem && drag.state.start) {
							const targetId = sessionItem.getAttribute("data-session-id");
							const sourceId = findSourceSession();
							if (sourceId && targetId && sourceId !== targetId) host?.createConnection(sourceId, targetId);
						}
						drag.onTouchEnd();
					};
					window.addEventListener("touchmove", onMove, { passive: false });
					window.addEventListener("touchend", onEnd);
					return () => {
						window.removeEventListener("touchmove", onMove);
						window.removeEventListener("touchend", onEnd);
					};
				}, [drag.state.dragging]);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnchorCircle, {
					onDragStart: drag.onMouseDown,
					onTouchStart: drag.onTouchStart,
					onTouchMove: drag.onTouchMove,
					onTouchEnd: drag.onTouchEnd
				}), drag.state.dragging && drag.state.start && drag.state.current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DragLine, {
					start: drag.state.start,
					end: drag.state.current,
					onComplete: () => {}
				})] });
			};
			const PanelWidget = () => {
				if (!host) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						padding: 12,
						opacity: .6
					},
					children: "连接宿主未就绪"
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectionPanel, { host });
			};
			ctx.slots.inject("conversation.input.activity", () => ctx.slots.register({
				name: "conversation.input.activity",
				id: "connection-anchor",
				order: 100
			}, () => AnchorWidget()));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: "connection-panel",
				order: 200
			}, () => PanelWidget()));
		}
		/** 尝试从 DOM 推断当前会话 ID（宿主页面约定 data-current-session 或路由参数）
		* 注：DSH 会话列表项使用 data-session-id 属性，当前激活会话使用 data-current-session
		*/
		function findSourceSession() {
			const composer = document.querySelector("[data-current-session]");
			if (composer) return composer.getAttribute("data-current-session");
			const m = location.href.match(/session[=/]([^&#]+)/i);
			return m ? m[1] : null;
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map