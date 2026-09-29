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
		* AnchorCircle — 输入框工具行左侧的连接锚点小圆圈。
		*
		* 规格书：默认 12px / 悬停 14px / 拖拽时脉冲光环。
		*
		* ⚠️ 关键几何全部走**内联样式**，不依赖外部样式表 —— 空 div 没有内容，
		* 一旦 CSS 没加载就是 0 尺寸的不可见元素（本项目踩过这个坑）。
		* 动画（脉冲）才交给注入的样式表，缺失也不影响可用性。
		*/
		const BASE_COLOR = "#60A5FA";
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
			const size = state === "hover" ? 14 : 12;
			const style = {
				width: size,
				height: size,
				minWidth: size,
				borderRadius: "50%",
				background: BASE_COLOR,
				opacity: state === "idle" ? .45 : state === "hover" ? .9 : 1,
				cursor: state === "dragging" ? "grabbing" : "pointer",
				position: "relative",
				flexShrink: 0,
				display: "inline-block",
				transition: "width 120ms ease, height 120ms ease, opacity 120ms ease",
				boxShadow: state === "hover" ? "0 0 0 3px rgba(96,165,250,0.22)" : "none",
				touchAction: "none"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: anchorRef,
				className: `ccr-anchor ccr-anchor--${state}`,
				style,
				onMouseEnter: handleMouseEnter,
				onMouseLeave: handleMouseLeave,
				onMouseDown: handleMouseDown,
				onTouchStart: handleTouchStart,
				onTouchMove: handleTouchMove,
				onTouchEnd: handleTouchEnd,
				role: "button",
				"aria-label": "发起会话连接（拖到左侧会话列表）",
				title: "按住拖到左侧会话，建立连接",
				tabIndex: 0,
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						const rect = e.target.getBoundingClientRect();
						setState("dragging");
						onDragStart(rect.left + rect.width / 2, rect.top + rect.height / 2);
					}
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ccr-anchor__pulse" })
			});
		}
		//#endregion
		//#region src/ui/DragLine.tsx
		/**
		* DragLine — 拉线动效。
		*
		* 底层：虚线流动线（stroke-dashoffset 动画）
		* 上层：4 个粒子沿贝塞尔曲线匀速流动（getPointAtLength）
		* 松手：shrinking(200ms) → pulsing(300ms) → onComplete
		*
		* ⚠️ 定位/穿透全部内联：SVG 覆盖整屏，若样式表没加载而 pointer-events
		* 又不是 none，会把整个界面点穿 —— 这种失败模式必须由内联样式兜住。
		*/
		const LINE_COLOR = "#60A5FA";
		const PARTICLE_COUNT = 4;
		const PARTICLE_SPEED = 320;
		const SHRINK_MS = 200;
		const PULSE_MS = 300;
		function buildBezierPath(start, end) {
			const midX = (start.x + end.x) / 2;
			const midY = (start.y + end.y) / 2;
			return `M ${start.x} ${start.y} Q ${midX} ${midY - 20} ${end.x} ${end.y}`;
		}
		function DragLine({ start, end, releasing = false, onComplete }) {
			const [phase, setPhase] = (0, react.useState)("dragging");
			const [particles, setParticles] = (0, react.useState)([]);
			const pathRef = (0, react.useRef)(null);
			const rafRef = (0, react.useRef)(0);
			const path = (0, react.useMemo)(() => buildBezierPath(start, end), [start, end]);
			(0, react.useEffect)(() => {
				if (releasing && phase === "dragging") {
					cancelAnimationFrame(rafRef.current);
					setPhase("shrinking");
				}
			}, [releasing, phase]);
			(0, react.useEffect)(() => {
				if (phase !== "dragging") return;
				const pathEl = pathRef.current;
				if (!pathEl) return;
				const totalLength = pathEl.getTotalLength();
				if (!Number.isFinite(totalLength) || totalLength <= 0) return;
				setParticles(Array.from({ length: PARTICLE_COUNT }, (_, i) => ({ t: i / PARTICLE_COUNT * totalLength })));
				let last = performance.now();
				const tick = (now) => {
					const dt = Math.min((now - last) / 1e3, .1);
					last = now;
					setParticles((prev) => prev.map((p) => ({ t: (p.t + PARTICLE_SPEED * dt) % totalLength })));
					rafRef.current = requestAnimationFrame(tick);
				};
				rafRef.current = requestAnimationFrame(tick);
				return () => cancelAnimationFrame(rafRef.current);
			}, [phase, path]);
			(0, react.useEffect)(() => {
				if (phase === "shrinking") {
					const timer = setTimeout(() => setPhase("pulsing"), SHRINK_MS);
					return () => clearTimeout(timer);
				}
				if (phase === "pulsing") {
					const timer = setTimeout(() => onComplete?.(), PULSE_MS);
					return () => clearTimeout(timer);
				}
			}, [phase, onComplete]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "ccr-drag-line",
				"aria-hidden": "true",
				style: {
					position: "fixed",
					top: 0,
					left: 0,
					width: "100vw",
					height: "100vh",
					pointerEvents: "none",
					zIndex: 9999,
					overflow: "visible"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					ref: pathRef,
					d: path,
					style: {
						fill: "none",
						stroke: LINE_COLOR,
						strokeWidth: phase === "pulsing" ? 4 : 2,
						strokeOpacity: phase === "pulsing" ? .35 : .75,
						strokeDasharray: "6 4",
						strokeLinecap: "round"
					}
				}), phase === "dragging" && particles.map((p, i) => {
					const pathEl = pathRef.current;
					if (!pathEl) return null;
					const point = pathEl.getPointAtLength(p.t);
					const totalLen = pathEl.getTotalLength() || 1;
					const progress = p.t / totalLen;
					const opacity = Math.sin(progress * Math.PI) * .8 + .3;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: point.x,
						cy: point.y,
						r: 1.5,
						fill: LINE_COLOR,
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
				className: "ccr-card-stack",
				children: connection.cards.map((card) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "ccr-card-row",
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
				className: "ccr-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-panel__tabs",
						children: [
							"all",
							"normal",
							"alert"
						].map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: `ccr-panel__tab${tab === t ? " ccr-panel__tab--active" : ""}`,
							onClick: () => setTab(t),
							children: t === "all" ? "全部" : t === "normal" ? "正常" : "告警"
						}, t))
					}),
					!client && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-panel__empty",
						children: "连接宿主通道未就绪"
					}),
					client && error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ccr-panel__error",
						children: ["宿主通信失败：", error]
					}),
					client && !error && loaded && filtered.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-panel__empty",
						children: "暂无连接（按住输入框左侧小圆点拖到会话上）"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-panel__list",
						children: filtered.map((conn) => {
							const aToB = conn.permission.aToB;
							const bToA = conn.permission.bToA;
							const permLabel = aToB === bToA ? PERM_LABELS[aToB] : `${PERM_LABELS[aToB]}↔${PERM_LABELS[bToA]}`;
							const healthColor = conn.health === "green" ? "#10B981" : conn.health === "yellow" ? "#F59E0B" : "#EF4444";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `ccr-row${expandedId === conn.id ? " ccr-row--open" : ""}`,
								onClick: () => toggleExpand(conn.id),
								title: conn.id,
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
									" 卡片]"
								]
							}), expandedId === conn.id && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardStack, { connection: conn }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ccr-actions",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										disabled: busy === conn.id,
										onClick: (e) => {
											e.stopPropagation();
											cyclePermission(conn, "aToB");
										},
										children: ["A→B ", PERM_LABELS[aToB]]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										disabled: busy === conn.id,
										onClick: (e) => {
											e.stopPropagation();
											cyclePermission(conn, "bToA");
										},
										children: ["B→A ", PERM_LABELS[bToA]]
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
		//#region src/styles/tokens.ts
		/**
		* 样式：CSS 文本 + 运行时注入。
		*
		* 为什么不用 `.css` 文件：DSH 客户端插件包由 tsdown 打成单个 JS，
		* 没有 CSS sidecar 加载通道（生态里的客户端插件一律用
		* `document.createElement('style')` 注入）。把 CSS 作为字符串放进 TS，
		* 保证它一定被打进 client bundle。
		*
		* 与此同时，关键几何（小圆圈的尺寸/颜色）在组件里用**内联样式**兜底：
		* 即使样式注入失败，控件仍然可见 —— 只有动画会缺失。
		*/
		/** 设计 tokens + 组件样式。 */
		const CONNECTION_CARD_CSS = `
:root {
  --ccr-rail-width: 24px;
  --ccr-rail-lane-gap: 8px;
  --ccr-rail-node-size: 8px;
  --ccr-perm-read: #9CA3AF;
  --ccr-perm-suggest: #3B82F6;
  --ccr-perm-write: #F97316;
  --ccr-health-green: #10B981;
  --ccr-health-yellow: #F59E0B;
  --ccr-health-red: #EF4444;
  --ccr-line-color: #60A5FA;
  --ccr-fast: 150ms cubic-bezier(0.2, 0, 0, 1);
  --ccr-panel-highlight: rgba(96, 165, 250, 0.12);
}

/* ═══ AnchorCircle（几何在内联样式里，这里只补动效） ═══ */
.ccr-anchor {
  animation: none;
}

.ccr-anchor__pulse {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid var(--ccr-line-color);
  opacity: 0;
  pointer-events: none;
}

.ccr-anchor--dragging .ccr-anchor__pulse {
  animation: ccr-anchor-pulse 900ms ease-out infinite;
}

@keyframes ccr-anchor-pulse {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(2); opacity: 0; }
}

/* ═══ DragLine ═══ */
.ccr-drag-line {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  overflow: visible;
}

.ccr-drag-line__path {
  fill: none;
  stroke: var(--ccr-line-color);
  stroke-width: 2px;
  stroke-opacity: 0.75;
  stroke-dasharray: 6 4;
  stroke-linecap: round;
  animation: ccr-dash-flow 600ms linear infinite;
}

@keyframes ccr-dash-flow {
  to { stroke-dashoffset: -20; }
}

.ccr-drag-line__particle {
  fill: var(--ccr-line-color);
}

/* ═══ SessionRail ═══ */
.ccr-rail {
  position: relative;
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;
}

.ccr-rail__overflow {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  opacity: 0.6;
}

/* ═══ RailLane ═══ */
.ccr-lane {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}

.ccr-lane__line {
  stroke-linecap: round;
  transition: stroke-width var(--ccr-fast), opacity var(--ccr-fast);
}

.ccr-lane__line--dimmed { opacity: 0.2; }

/* ═══ 拖拽目标高亮 ═══ */
.ccr-target-highlight {
  background: var(--ccr-panel-highlight) !important;
  box-shadow: inset 2px 0 0 var(--ccr-line-color) !important;
}

/* ═══ ConnectionPanel ═══ */
.ccr-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 13px;
  min-width: 220px;
}

.ccr-panel__tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.ccr-panel__tab {
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity var(--ccr-fast);
  user-select: none;
}

.ccr-panel__tab--active {
  opacity: 1;
  background: var(--ccr-panel-highlight);
}

.ccr-panel__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.ccr-panel__empty,
.ccr-panel__error {
  padding: 12px;
  opacity: 0.6;
}

.ccr-panel__error { color: #EF4444; opacity: 1; }

.ccr-row {
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--ccr-fast);
  border-left: 2px solid transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ccr-row:hover { background: var(--ccr-panel-highlight); }
.ccr-row--open { background: var(--ccr-panel-highlight); }

.ccr-card-row {
  padding: 4px 12px 4px 28px;
  font-size: 12px;
  opacity: 0.85;
}

.ccr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px 10px;
}

.ccr-actions button {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ccr-actions button:hover:not(:disabled) { background: var(--ccr-panel-highlight); }
.ccr-actions button:disabled { opacity: 0.45; cursor: default; }

/* ═══ 无障碍 / 降低动效 ═══ */
@media (prefers-reduced-motion: reduce) {
  .ccr-drag-line__path,
  .ccr-anchor--dragging .ccr-anchor__pulse { animation: none !important; }
  .ccr-drag-line__particle { display: none !important; }
}
`;
		const STYLE_ELEMENT_ID = "dsh-connection-card-host-styles";
		/**
		* 把样式注入 document.head（幂等）。
		*
		* @returns 注销函数；非浏览器环境下返回空操作。
		*/
		function injectStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.getElementById(STYLE_ELEMENT_ID)) return () => {};
			const tag = document.createElement("style");
			tag.id = STYLE_ELEMENT_ID;
			tag.textContent = CONNECTION_CARD_CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
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
			try {
				const removeStyles = injectStyles();
				const effect = safeCtxGet(ctx, "effect");
				if (typeof effect === "function") effect(() => removeStyles, "connection-card-host: styles");
			} catch (e) {
				ctx.logger?.warn?.(`[connection-card-host] 样式注入失败: ${String(e)}`);
			}
			const AnchorWidget = () => {
				const drag = useDragLine();
				const [lineDone, setLineDone] = (0, react.useState)(false);
				const beginDrag = (0, react.useCallback)((x, y) => {
					setLineDone(false);
					drag.onMouseDown(x, y);
				}, [drag]);
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
				const showLine = Boolean(drag.state.start && drag.state.current && !lineDone);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnchorCircle, {
					onDragStart: beginDrag,
					onTouchStart: drag.onTouchStart,
					onTouchMove: drag.onTouchMove,
					onTouchEnd: drag.onTouchEnd
				}), showLine && drag.state.start && drag.state.current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DragLine, {
					start: drag.state.start,
					end: drag.state.current,
					releasing: !drag.state.dragging,
					onComplete: () => setLineDone(true)
				})] });
			};
			const PanelWidget = () => {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectionPanel, { client: (0, react.useMemo)(() => client, []) });
			};
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "connection-anchor",
				order: 100,
				label: "连接"
			}, () => AnchorWidget()));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: "connection-panel",
				order: 200,
				label: "连接"
			}, () => PanelWidget()));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map