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
		//#region src/ui/hooks/useConnections.ts
		/**
		* useConnections — 从宿主拉取连接列表并保持刷新。
		*
		* 浏览器半拿不到宿主的推送事件（连接级事件总线在宿主进程内），
		* 所以这里用轮询：轻量、无额外协议，2s 间隔对本地 HTTP 完全够用。
		* 后续要降到推送可以接 DSH 的 websocket downlink。
		*/
		const POLL_INTERVAL_MS = 2e3;
		function useConnections(client) {
			const [connections, setConnections] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)(null);
			const [loaded, setLoaded] = (0, react.useState)(false);
			const aliveRef = (0, react.useRef)(true);
			const refresh = (0, react.useCallback)(async () => {
				if (!client) return;
				try {
					const next = await client.listConnections();
					if (!aliveRef.current) return;
					setConnections(next);
					setError(null);
				} catch (e) {
					if (!aliveRef.current) return;
					setError(e instanceof Error ? e.message : String(e));
				} finally {
					if (aliveRef.current) setLoaded(true);
				}
			}, [client]);
			(0, react.useEffect)(() => {
				aliveRef.current = true;
				if (!client) return;
				refresh();
				const timer = setInterval(() => {
					refresh();
				}, POLL_INTERVAL_MS);
				return () => {
					aliveRef.current = false;
					clearInterval(timer);
				};
			}, [client, refresh]);
			return {
				connections,
				error,
				loaded,
				refresh
			};
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
		* ConnectionPanel — 连接卡片面板。
		* 入口：sidebar.panellist 槽位。
		* 结构：顶部 tab（全部/正常/告警）→ 连接行（可展开卡片列表）。
		*
		* 数据来自宿主（经 Connection RPC），用 useConnections 轮询刷新。
		*/
		const PERM_LABELS = {
			read: "只读",
			suggest: "建议",
			write: "写入"
		};
		const PERM_CYCLE = [
			"read",
			"suggest",
			"write"
		];
		function ConnectionPanel({ client }) {
			const { connections, error, loaded, refresh } = useConnections(client);
			const [expandedId, setExpandedId] = (0, react.useState)(null);
			const [tab, setTab] = (0, react.useState)("all");
			const [busy, setBusy] = (0, react.useState)(null);
			const toggleExpand = (0, react.useCallback)((id) => {
				setExpandedId((prev) => prev === id ? null : id);
			}, []);
			/** 权限升级：低→高走协商（需双方确认），高→低直接生效。 */
			const cyclePermission = (0, react.useCallback)(async (conn, direction) => {
				if (!client) return;
				const current = conn.permission[direction];
				const next = PERM_CYCLE[(PERM_CYCLE.indexOf(current) + 1) % PERM_CYCLE.length];
				setBusy(conn.id);
				try {
					await client.requestPermissionUpgrade(conn.id, direction, next);
					await refresh();
				} catch (e) {
					console.error("[connection-panel] 权限变更失败:", e);
				} finally {
					setBusy(null);
				}
			}, [client, refresh]);
			const disconnect = (0, react.useCallback)(async (id) => {
				if (!client) return;
				setBusy(id);
				try {
					await client.disconnect(id);
					await refresh();
				} catch (e) {
					console.error("[connection-panel] 断开失败:", e);
				} finally {
					setBusy(null);
				}
			}, [client, refresh]);
			const filtered = connections.filter((c) => {
				if (tab === "all") return true;
				if (tab === "normal") return c.health === "green" && c.status !== "broken";
				return c.health !== "green" || c.status === "broken";
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "connection-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
					}),
					!client && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: 16,
							opacity: .6
						},
						children: "连接宿主通道未就绪"
					}),
					client && error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "8px 12px",
							color: "#EF4444",
							fontSize: 12
						},
						children: ["宿主通信失败：", error]
					}),
					client && !error && loaded && filtered.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: 16,
							opacity: .5
						},
						children: "暂无连接"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "connection-panel__list",
						children: filtered.map((conn) => {
							const aToB = conn.permission.aToB;
							const bToA = conn.permission.bToA;
							const permLabel = aToB === bToA ? PERM_LABELS[aToB] : `${PERM_LABELS[aToB]}↔${PERM_LABELS[bToA]}`;
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
							}), expandedId === conn.id && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardStack, { connection: conn }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 8,
									padding: "6px 12px",
									fontSize: 12
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										disabled: busy === conn.id,
										onClick: (e) => {
											e.stopPropagation();
											cyclePermission(conn, "aToB");
										},
										children: ["权限 A→B: ", PERM_LABELS[aToB]]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										disabled: busy === conn.id,
										onClick: (e) => {
											e.stopPropagation();
											cyclePermission(conn, "bToA");
										},
										children: ["权限 B→A: ", PERM_LABELS[bToA]]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: busy === conn.id,
										onClick: (e) => {
											e.stopPropagation();
											disconnect(conn.id);
										},
										children: "断开"
									})
								]
							})] })] }, conn.id);
						})
					})
				]
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
		//#region src/types/rpc.ts
		/**
		* 宿主 ↔ 浏览器 RPC 契约（两半共享）。
		*
		* 走 DSH 官方的 Connection 通道：宿主 `ctx.connection.rpc.handle()` 注册，
		* 浏览器 `ctx.connection.rpc.call()` 调用。
		*
		* 这个模块必须保持零 Node 依赖 —— 它会被打进 client bundle。
		*/
		/** RPC 通道前缀（绝对路径，须匹配 /^\/[A-Za-z0-9._~-]+$/）。 */
		const RPC_CHANNEL = "/connection-card";
		/**
		* 端点名。宿主 handler 收到的 `endpoint` 是通道相对路径，
		* 例如 `connections/list`（每段须匹配 /^[A-Za-z0-9_$.-]+$/）。
		*/
		const RPC_ENDPOINTS = {
			health: "health",
			listConnections: "connections/list",
			connectionsBySession: "connections/bySession",
			createConnection: "connections/create",
			disconnect: "connections/disconnect",
			updatePermission: "permission/update",
			requestPermissionUpgrade: "permission/request",
			acceptPermissionUpgrade: "permission/accept",
			rejectPermissionUpgrade: "permission/reject",
			loadCard: "cards/load",
			unloadCard: "cards/unload",
			reloadCard: "cards/reload",
			listWhitelist: "whitelist/list"
		};
		//#endregion
		//#region src/safe-ctx.ts
		/**
		* cordis 上下文的安全读取。
		*
		* cordis 的 Context 是 Proxy：读取**未在 `inject` 中声明**的服务属性会
		* 抛出 `cannot get property "x" without inject`，而不是返回 `undefined`。
		* 因此 `ctx.x?.y` 这种写法同样会抛 —— 必须用 try/catch 包住。
		*
		* 纯 JS，无 Node 依赖，宿主半与浏览器半共用。
		*/
		/**
		* 读取上下文上的一个属性；属性不存在或未声明时返回 undefined。
		*
		* @param ctx - cordis 上下文（或任意对象）
		* @param key - 属性/服务名
		*/
		function safeCtxGet(ctx, key) {
			try {
				const holder = ctx;
				if (!holder) return void 0;
				return holder[key] ?? void 0;
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/client/host-client.ts
		/** 从 cordis 上下文中取 ctx.connection.rpc；不可用时返回 null。 */
		function resolveRpcCaller(ctx) {
			const rpc = safeCtxGet(ctx, "connection")?.rpc;
			return rpc && typeof rpc.call === "function" ? rpc : null;
		}
		/**
		* 用 RPC 调用器构造宿主客户端。
		* @param rpc - ctx.connection.rpc
		*/
		function createHostClient(rpc) {
			const invoke = async (endpoint, payload = {}) => {
				const result = await rpc.call(RPC_CHANNEL, endpoint, payload);
				if (!result || typeof result !== "object" || !("ok" in result)) throw new Error(`RPC 响应形状非法（${endpoint}）`);
				if (!result.ok) throw new Error(result.error?.message ?? `RPC 调用失败（${endpoint}）`);
				return result.value;
			};
			return {
				health: () => invoke(RPC_ENDPOINTS.health),
				listConnections: () => invoke(RPC_ENDPOINTS.listConnections),
				connectionsBySession: (sessionId) => invoke(RPC_ENDPOINTS.connectionsBySession, { sessionId }),
				createConnection: (sessionA, sessionB) => invoke(RPC_ENDPOINTS.createConnection, {
					sessionA,
					sessionB
				}),
				disconnect: (id) => invoke(RPC_ENDPOINTS.disconnect, { id }),
				updatePermission: (id, direction, level) => invoke(RPC_ENDPOINTS.updatePermission, {
					id,
					direction,
					level
				}),
				requestPermissionUpgrade: (id, direction, level) => invoke(RPC_ENDPOINTS.requestPermissionUpgrade, {
					id,
					direction,
					level
				}),
				acceptPermissionUpgrade: (requestId, acceptorId) => invoke(RPC_ENDPOINTS.acceptPermissionUpgrade, {
					requestId,
					acceptorId
				}),
				rejectPermissionUpgrade: (requestId, rejectorId) => invoke(RPC_ENDPOINTS.rejectPermissionUpgrade, {
					requestId,
					rejectorId
				}),
				loadCard: (templateId, connectionId) => invoke(RPC_ENDPOINTS.loadCard, {
					templateId,
					connectionId
				}),
				unloadCard: (instanceId) => invoke(RPC_ENDPOINTS.unloadCard, { instanceId }),
				reloadCard: (instanceId) => invoke(RPC_ENDPOINTS.reloadCard, { instanceId }),
				listWhitelistedMethods: (connectionId) => invoke(RPC_ENDPOINTS.listWhitelist, { connectionId })
			};
		}
		//#endregion
		//#region src/client/index.tsx
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
		/** 需要 slots 注入 UI，需要 connection 提供宿主 RPC 通道。 */
		const inject = ["slots", "connection"];
		/** 读取当前激活会话 id（拖拽起点）。 */
		function findSourceSession() {
			const direct = document.querySelector("[data-current-session]")?.getAttribute("data-current-session");
			if (direct) return direct;
			const m = location.href.match(/session[=/]([^&#]+)/i);
			return m ? m[1] : null;
		}
		/** 命中松手位置下的会话列表项。 */
		function sessionIdAtPoint(x, y) {
			return (document.elementFromPoint(x, y)?.closest("[data-session-id]"))?.getAttribute("data-session-id") ?? null;
		}
		function apply(ctx) {
			const rpc = resolveRpcCaller(ctx);
			const client = rpc ? createHostClient(rpc) : null;
			if (!rpc) ctx.logger?.warn?.("[connection-card-host] ctx.connection.rpc 不可用；面板将无法读取宿主连接");
			const AnchorWidget = () => {
				const drag = useDragLine();
				(0, react.useEffect)(() => {
					if (!drag.state.dragging) return;
					const onMove = (e) => drag.onMouseMove(e.clientX, e.clientY);
					const onUp = (e) => {
						const targetId = sessionIdAtPoint(e.clientX, e.clientY);
						const sourceId = findSourceSession();
						if (targetId && sourceId && sourceId !== targetId) client?.createConnection(sourceId, targetId).catch((err) => {
							console.error("[connection-card-host] 建立连接失败:", err);
						});
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
						if (t && drag.onTouchMove(t.clientX, t.clientY)) e.preventDefault();
					};
					const onEnd = (e) => {
						const t = e.changedTouches[0];
						if (t) {
							const targetId = sessionIdAtPoint(t.clientX, t.clientY);
							const sourceId = findSourceSession();
							if (targetId && sourceId && sourceId !== targetId) client?.createConnection(sourceId, targetId).catch((err) => {
								console.error("[connection-card-host] 建立连接失败:", err);
							});
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
					end: drag.state.current
				})] });
			};
			const PanelWidget = () => {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectionPanel, { client: (0, react.useMemo)(() => client, []) });
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
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map