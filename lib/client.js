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
		* AnchorCircle — 输入框工具行左侧的连接锚点。
		*
		* 规格书：默认 12px / 悬停 14px / 拖拽时脉冲光环。
		*
		* 两个必须守住的点：
		*  1. 关键几何走内联样式 —— 空 div 一旦 CSS 没加载就是 0 尺寸的不可见元素。
		*  2. `dragging` 由**父组件**传入，不在内部自持。
		*     早期版本内部 setState('dragging') 后没有任何地方复位，
		*     于是点过一次就永远停在拖拽态、脉冲动画一直闪。
		*/
		function AnchorCircle({ onDragStart, onTouchStart, onTouchMove, onTouchEnd, dragging = false }) {
			const [hover, setHover] = (0, react.useState)(false);
			const anchorRef = (0, react.useRef)(null);
			const handleMouseEnter = (0, react.useCallback)(() => setHover(true), []);
			const handleMouseLeave = (0, react.useCallback)(() => setHover(false), []);
			const handleMouseDown = (0, react.useCallback)((e) => {
				e.preventDefault();
				e.stopPropagation();
				onDragStart(e.clientX, e.clientY);
			}, [onDragStart]);
			/** 阻止浏览器把这次按压升级成原生 HTML5 拖拽（否则会拖动/重排元素）。 */
			const handleNativeDragStart = (0, react.useCallback)((e) => {
				e.preventDefault();
			}, []);
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
				if (onTouchMove(t.clientX, t.clientY)) e.preventDefault();
			}, [onTouchMove]);
			const handleTouchEnd = (0, react.useCallback)(() => {
				onTouchEnd?.();
			}, [onTouchEnd]);
			const idleColor = "var(--dsw-alias-label-secondary, #9CA3AF)";
			const activeColor = "var(--ccr-flow-color, #60A5FA)";
			const size = hover || dragging ? 13 : 11;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: anchorRef,
				className: `ccr-anchor${dragging ? " ccr-anchor--dragging" : ""}`,
				style: {
					width: size,
					height: size,
					minWidth: size,
					borderRadius: "50%",
					background: dragging ? activeColor : idleColor,
					opacity: dragging ? .9 : hover ? .85 : .32,
					cursor: dragging ? "grabbing" : "pointer",
					position: "relative",
					flexShrink: 0,
					display: "inline-block",
					transition: "width 140ms ease, height 140ms ease, opacity 140ms ease, background 140ms ease",
					touchAction: "none",
					boxShadow: hover && !dragging ? "0 0 0 2px rgba(128,128,128,0.18)" : "none"
				},
				onMouseEnter: handleMouseEnter,
				onMouseLeave: handleMouseLeave,
				onMouseDown: handleMouseDown,
				onDragStart: handleNativeDragStart,
				draggable: false,
				onTouchStart: handleTouchStart,
				onTouchMove: handleTouchMove,
				onTouchEnd: handleTouchEnd,
				role: "button",
				"aria-label": "发起会话连接（拖到左侧会话列表）",
				title: "按住拖到左侧任意会话，建立连接",
				tabIndex: 0,
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						const rect = e.target.getBoundingClientRect();
						onDragStart(rect.left + rect.width / 2, rect.top + rect.height / 2);
					}
				},
				children: dragging && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "ccr-anchor__pulse" })
			});
		}
		//#endregion
		//#region src/ui/DragLine.tsx
		/**
		* DragLine — 拖拽时的「水流」连接线。
		*
		* 视觉：白色半透明、像水在流（用户要求），四层叠加：
		*   1. 光晕   宽描边 + 高斯模糊 + 极低透明 → 水汽感
		*   2. 主线   沿线渐变（两端淡出）的半透明主体
		*   3. 流带   短划线沿路径滑动 → 「在流」而不是「虚线在抖」
		*   4. 水珠   9 颗不同大小/速度/透明度的粒子顺流而下
		*
		* 颜色取 CSS 变量 --ccr-flow-color（默认映射到 DSH 主题 token，
		* 深色主题下即白色；纯白在浅色主题会消失，所以不写死）。
		*
		* 时序：dragging → (松手) → shrinking(200ms) → pulsing(300ms) → onComplete
		*/
		const FLOW_COLOR = "var(--ccr-flow-color, #ffffff)";
		const BASE_SPEED = 300;
		const WATER_BASE_MS = 200;
		const WATER_PULSE_MS = 300;
		/** 9 颗水珠的确定性参数（不用随机，避免每帧抖动）。 */
		const PARTICLE_PROFILES = Array.from({ length: 9 }, (_, i) => ({
			offset: i / 9,
			size: .7 + i * 37 % 100 / 100 * 1.6,
			speed: .72 + i * 53 % 100 / 100 * .7,
			opacity: .3 + i * 71 % 100 / 100 * .6
		}));
		/** 唯一 id：同一时刻只应有一个 DragLine，但用计数器更稳。 */
		let gradientSeq = 0;
		function buildBezierPath(start, end) {
			const dx = end.x - start.x;
			const nx = -(end.y - start.y);
			const ny = dx;
			const len = Math.hypot(nx, ny) || 1;
			const bulge = Math.min(60, len * .22);
			const cx = (start.x + end.x) / 2 + nx / len * bulge;
			const cy = (start.y + end.y) / 2 + ny / len * bulge;
			return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
		}
		function DragLine({ start, end, releasing = false, onComplete }) {
			const [phase, setPhase] = (0, react.useState)("dragging");
			const [particles, setParticles] = (0, react.useState)([]);
			const pathRef = (0, react.useRef)(null);
			const rafRef = (0, react.useRef)(0);
			const gradId = (0, react.useMemo)(() => `ccr-flow-grad-${++gradientSeq}`, []);
			const blurId = (0, react.useMemo)(() => `ccr-flow-blur-${gradientSeq}`, [gradientSeq]);
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
				let totalLength = 0;
				try {
					totalLength = pathEl.getTotalLength();
				} catch {
					return;
				}
				if (!Number.isFinite(totalLength) || totalLength <= 0) return;
				setParticles(PARTICLE_PROFILES.map((p) => ({ t: p.offset * totalLength })));
				let last = performance.now();
				const tick = (now) => {
					const dt = Math.min((now - last) / 1e3, .1);
					last = now;
					setParticles((prev) => prev.map((p, i) => ({ t: (p.t + BASE_SPEED * PARTICLE_PROFILES[i].speed * dt) % totalLength })));
					rafRef.current = requestAnimationFrame(tick);
				};
				rafRef.current = requestAnimationFrame(tick);
				return () => cancelAnimationFrame(rafRef.current);
			}, [phase, path]);
			(0, react.useEffect)(() => {
				if (phase === "shrinking") {
					const timer = setTimeout(() => setPhase("pulsing"), WATER_BASE_MS);
					return () => clearTimeout(timer);
				}
				if (phase === "pulsing") {
					const timer = setTimeout(() => onComplete?.(), WATER_PULSE_MS);
					return () => clearTimeout(timer);
				}
			}, [phase, onComplete]);
			const pulsing = phase === "pulsing";
			const coreStyle = {
				stroke: `url(#${gradId})`,
				strokeWidth: pulsing ? 3.5 : 2,
				strokeOpacity: pulsing ? .3 : .9,
				transition: "stroke-width 200ms ease, stroke-opacity 200ms ease"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "ccr-drag-line",
				"aria-hidden": "true",
				style: {
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					pointerEvents: "none",
					zIndex: 9999,
					overflow: "visible"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("defs", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("linearGradient", {
						id: gradId,
						gradientUnits: "userSpaceOnUse",
						x1: start.x,
						y1: start.y,
						x2: end.x,
						y2: end.y,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
								offset: "0%",
								stopColor: FLOW_COLOR,
								stopOpacity: "0"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
								offset: "18%",
								stopColor: FLOW_COLOR,
								stopOpacity: "0.55"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
								offset: "50%",
								stopColor: FLOW_COLOR,
								stopOpacity: "0.95"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
								offset: "82%",
								stopColor: FLOW_COLOR,
								stopOpacity: "0.55"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
								offset: "100%",
								stopColor: FLOW_COLOR,
								stopOpacity: "0"
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("filter", {
						id: blurId,
						x: "-30%",
						y: "-30%",
						width: "160%",
						height: "160%",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("feGaussianBlur", { stdDeviation: "3" })
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: path,
						className: "ccr-flow__glow",
						filter: `url(#${blurId})`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						ref: pathRef,
						d: path,
						className: "ccr-flow__core",
						style: coreStyle
					}),
					!pulsing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: path,
						className: "ccr-flow__band"
					}),
					!pulsing && phase === "dragging" && particles.map((p, i) => {
						const pathEl = pathRef.current;
						if (!pathEl) return null;
						const profile = PARTICLE_PROFILES[i];
						let point;
						try {
							point = pathEl.getPointAtLength(p.t);
						} catch {
							return null;
						}
						const total = pathEl.getTotalLength() || 1;
						const progress = p.t / total;
						const edgeFade = Math.sin(progress * Math.PI);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							className: "ccr-flow__particle",
							cx: point.x,
							cy: point.y,
							r: profile.size,
							opacity: profile.opacity * edgeFade,
							style: { filter: "blur(0.6px)" }
						}, i);
					})
				]
			});
		}
		//#endregion
		//#region src/types/permission.ts
		const PERMISSION_ORDER = {
			read: 0,
			suggest: 1,
			write: 2
		};
		function permValue(level) {
			return PERMISSION_ORDER[level];
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
			listCardTemplates: "cards/templates",
			renderCardPanel: "cards/panel",
			listWhitelist: "whitelist/list",
			listSessions: "sessions/list",
			/** 浏览器半的诊断上报通道（宿主落到 client-debug.log）。 */
			debugLog: "debug/log",
			/**
			* 调试用：向连接的 eventBus 发一个事件，用来手动触发卡片逻辑。
			* 卡片订阅的是连接级事件，没有这个入口就没法在不接入真实 DSH 事件源的情况下测试。
			*/
			debugEmit: "debug/emit",
			/** 待确认的权限升级请求。 */
			listUpgradeRequests: "permission/pending",
			/** 协商连接的可远程调用方法白名单。 */
			negotiateWhitelist: "whitelist/negotiate",
			/** 读取连接的交流记录。 */
			listMessages: "messages/list",
			/** 以某一端的身份发一条连接消息。 */
			sendMessage: "messages/send",
			/**
			* 调试用：直接往某个会话投递一段文本（验证「A 说话 B 能感知」的最后一跳）。
			* 目标会话必须有 live agent，否则返回失败原因。
			*/
			debugDeliver: "debug/deliver",
			/** 会话桥的能力探测结果。 */
			relayCapabilities: "relay/capabilities"
		};
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
		//#region src/client/sessions-bridge.ts
		/**
		* sessions-bridge — 读取 DSH 客户端的会话列表（`ctx.sessions`）。
		*
		* 为什么需要它：会话行的 DOM 里**没有 id**（只有 `role="treeitem"` 和标题文本），
		* 所以「拖到哪个会话」「左侧竖线连哪两行」都必须靠真实会话列表来定位。
		*
		* 契约（来自 dsh-client-runtime 的 ISessions）：
		*   ctx.sessions.list : ObservableSnapshot<{ ids, byId, current, phase }>
		*   ctx.sessions.open(id)
		*
		* 字段逐层防御式读取：拿不到就返回 null，宁可功能不出现，也不要出错的线。
		*/
		const EMPTY$1 = {
			ids: [],
			byId: {},
			current: void 0
		};
		function normalize(raw) {
			const s = raw;
			if (!s || typeof s !== "object") return EMPTY$1;
			const ids = Array.isArray(s.ids) ? s.ids.filter((x) => typeof x === "string") : [];
			const byId = {};
			if (s.byId && typeof s.byId === "object") for (const [key, value] of Object.entries(s.byId)) {
				const v = value;
				byId[key] = {
					title: typeof v?.title === "string" ? v.title : void 0,
					updatedAt: typeof v?.updatedAt === "number" ? v.updatedAt : void 0
				};
			}
			return {
				ids,
				byId,
				current: typeof s.current === "string" ? s.current : void 0
			};
		}
		/** 从 cordis 上下文取会话桥；不可用时返回 null。 */
		function resolveSessions(ctx) {
			const sessions = safeCtxGet(ctx, "sessions");
			const list = sessions?.list;
			if (!list || typeof list.getSnapshot !== "function") return null;
			return {
				getSnapshot: () => normalize(list.getSnapshot()),
				subscribe: (listener) => {
					try {
						const off = list.subscribe?.(listener);
						return typeof off === "function" ? off : () => {};
					} catch {
						return () => {};
					}
				},
				open: (id) => {
					try {
						sessions?.open?.(id);
					} catch {}
				}
			};
		}
		/** 会话的展示名：标题优先，否则截断 id。 */
		function sessionLabel(bridge, id, snapshot) {
			const title = (snapshot ?? bridge?.getSnapshot())?.byId[id]?.title;
			if (typeof title === "string" && title.trim().length > 0) return title.trim();
			return id.length > 12 ? `${id.slice(0, 12)}…` : id;
		}
		//#endregion
		//#region src/ui/hooks/useSessionList.ts
		/**
		* useSessionList — 订阅 DSH 的真实会话列表。
		*
		* 数据源是 `ctx.sessions.list`（ObservableSnapshot），不是 DOM。
		* 早期版本读 `[data-session-id]`，但 DSH 的会话行**根本没有这个属性**，
		* 所以选择器一直是空的、拖拽也永远命中不了目标。
		*/
		const EMPTY = {
			ids: [],
			byId: {},
			current: void 0
		};
		function useSessionList(bridge) {
			const [snapshot, setSnapshot] = (0, react.useState)(EMPTY);
			(0, react.useEffect)(() => {
				if (!bridge) {
					setSnapshot(EMPTY);
					return;
				}
				let alive = true;
				const sync = () => {
					if (!alive) return;
					const next = bridge.getSnapshot();
					setSnapshot((prev) => {
						if (prev.current === next.current && prev.ids.length === next.ids.length && prev.ids.every((id, i) => id === next.ids[i])) return prev;
						return next;
					});
				};
				sync();
				const off = bridge.subscribe(sync);
				const timer = window.setInterval(sync, 3e3);
				return () => {
					alive = false;
					off();
					window.clearInterval(timer);
				};
			}, [bridge]);
			const labelOf = (0, react.useCallback)((id) => sessionLabel(bridge, id, snapshot), [bridge, snapshot]);
			return {
				options: snapshot.ids.map((id) => ({
					id,
					label: labelOf(id),
					isCurrent: snapshot.current === id
				})),
				snapshot,
				labelOf,
				ready: bridge !== null && snapshot.ids.length > 0
			};
		}
		//#endregion
		//#region src/ui/CardStack.tsx
		/**
		* CardStack — 一条连接下的卡片区。
		*
		* 两部分：
		*   1. 已装载的卡片：名称 + 状态 + 「重载」「移除」，并渲染卡片面板；
		*   2. 添加卡片：列出可用模板（内置 + 已安装），一键加到这条连接上。
		*
		* 卡片面板 HTML 由**宿主**渲染好后传过来 —— 卡片模块跑在宿主进程里
		* （apply 要订阅事件、注册工具），宿主没有 DOM，用 dom-shim 取 innerHTML。
		*/
		const HEALTH_COLOR$1 = {
			green: "#10B981",
			yellow: "#F59E0B",
			red: "#EF4444"
		};
		function CardStack({ connection, client, onChanged }) {
			const [templates, setTemplates] = (0, react.useState)([]);
			const [panels, setPanels] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [picking, setPicking] = (0, react.useState)(false);
			const cards = connection.cards;
			const cardKey = cards.map((c) => c.instanceId).join(",");
			/** 拉模板清单 + 渲染每张已装载卡片的面板。 */
			const load = (0, react.useCallback)(async () => {
				if (!client) return;
				try {
					setTemplates(await client.listCardTemplates(connection.id));
					setError(null);
					const ids = cardKey ? cardKey.split(",") : [];
					const next = {};
					for (const id of ids) try {
						next[id] = await client.renderCardPanel(id);
					} catch {
						next[id] = null;
					}
					setPanels(next);
				} catch (e) {
					setError(e instanceof Error ? e.message : String(e));
				}
			}, [
				client,
				connection.id,
				cardKey
			]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const add = (0, react.useCallback)(async (templateId) => {
				if (!client) return;
				setBusy(templateId);
				try {
					await client.loadCard(templateId, connection.id);
					setPicking(false);
					await load();
					onChanged?.();
				} catch (e) {
					setError(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [
				client,
				connection.id,
				load,
				onChanged
			]);
			const remove = (0, react.useCallback)(async (instanceId) => {
				if (!client) return;
				setBusy(instanceId);
				try {
					await client.unloadCard(instanceId);
					await load();
					onChanged?.();
				} catch (e) {
					setError(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [
				client,
				load,
				onChanged
			]);
			const reload = (0, react.useCallback)(async (instanceId) => {
				if (!client) return;
				setBusy(instanceId);
				try {
					await client.reloadCard(instanceId);
					await load();
					onChanged?.();
				} catch (e) {
					setError(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [
				client,
				load,
				onChanged
			]);
			const installed = new Set(cards.map((c) => c.templateId));
			const available = templates.filter((t) => !installed.has(t.templateId));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ccr-cards",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ccr-cards__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ccr-field__label",
								children: "卡片"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ccr-count",
								children: cards.length
							}),
							client && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ccr-link ccr-cards__add",
								onClick: () => setPicking((v) => !v),
								children: picking ? "取消" : "+ 添加卡片"
							})
						]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-error",
						children: error
					}),
					picking && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ccr-cards__picker",
						children: [available.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ccr-panel__empty",
							children: templates.length === 0 ? "没有发现任何卡片模板" : "所有卡片都已添加"
						}), available.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "ccr-card-option",
							disabled: busy === t.templateId,
							onClick: () => void add(t.templateId),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ccr-card-option__name",
								children: t.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "ccr-card-option__meta",
								children: [
									t.source === "builtin" ? "内置" : "已安装",
									" · v",
									t.version,
									t.events.length > 0 && ` · ${t.events.length} 事件`
								]
							})]
						}, t.templateId))]
					}),
					cards.length === 0 && !picking && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-panel__empty",
						children: "这条连接还没有卡片"
					}),
					cards.map((card) => {
						const template = templates.find((t) => t.templateId === card.templateId);
						const html = panels[card.instanceId] ?? null;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ccr-card",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ccr-card__head",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-dot",
										style: { background: HEALTH_COLOR$1[connection.health] ?? "#10B981" }
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-card__name",
										children: template?.name ?? card.templateId
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-card__meta",
										children: card.templateId
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "ccr-link",
										disabled: busy === card.instanceId,
										onClick: () => void reload(card.instanceId),
										children: "重载"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "ccr-link",
										disabled: busy === card.instanceId,
										onClick: () => void remove(card.instanceId),
										children: "移除"
									})
								]
							}), html && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ccr-card__panel",
								dangerouslySetInnerHTML: { __html: html }
							})]
						}, card.instanceId);
					})
				]
			});
		}
		//#endregion
		//#region src/ui/ConnectionPanel.tsx
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
		/** 用户视角的权限名称（不是 read/write 这种内部词）。 */
		const PERMISSION_CHOICES = [
			{
				value: "read",
				label: "只读",
				hint: "只能观察对方状态，不能改动"
			},
			{
				value: "suggest",
				label: "可建议",
				hint: "可以发建议，但不会自动执行"
			},
			{
				value: "write",
				label: "可写入",
				hint: "可以在对方会话里执行操作"
			}
		];
		const HEALTH_COLOR = {
			green: "#10B981",
			yellow: "#F59E0B",
			red: "#EF4444"
		};
		const HEALTH_TEXT = {
			green: "正常",
			yellow: "注意",
			red: "异常"
		};
		function ConnectionPanel({ client, sessions, prefs }) {
			const { connections, error, loaded, refresh } = useConnections(client);
			const { options: sessionOptions, labelOf, ready: sessionsReady } = useSessionList(sessions);
			/**
			* 新建连接用的会话槽位。
			* 默认两个；点中间的箭头可以加第三个 —— 三个会**两两相连**（3 条连接）。
			*/
			const [picks, setPicks] = (0, react.useState)(["", ""]);
			const [manual, setManual] = (0, react.useState)(false);
			const [expandedId, setExpandedId] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)([]);
			/** 视图偏好（lane 上限），改完立刻广播给轨道 */
			const [prefsState, setPrefsState] = (0, react.useState)(() => prefs.get());
			(0, react.useEffect)(() => prefs.subscribe(() => setPrefsState(prefs.get())), [prefs]);
			const setPick = (0, react.useCallback)((index, value) => {
				setPicks((prev) => prev.map((v, i) => i === index ? value : v));
			}, []);
			const flash = (0, react.useCallback)((message) => {
				setNotice(message);
				window.setTimeout(() => setNotice((prev) => prev === message ? null : prev), 4e3);
			}, []);
			(0, react.useEffect)(() => {
				if (!client) return;
				let alive = true;
				const poll = async () => {
					try {
						const list = await client.listPendingUpgrades();
						if (alive) setPending(list);
					} catch {}
				};
				poll();
				const timer = window.setInterval(poll, 2e3);
				return () => {
					alive = false;
					window.clearInterval(timer);
				};
			}, [client]);
			const acceptUpgrade = (0, react.useCallback)(async (requestId) => {
				if (!client) return;
				setBusy(requestId);
				try {
					if (!await client.acceptPermissionUpgrade(requestId, "party-A")) flash(await client.acceptPermissionUpgrade(requestId, "party-B") ? "权限已升级" : "确认失败");
					else flash("权限已升级");
					await refresh();
					setPending(await client.listPendingUpgrades());
				} catch (e) {
					flash(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [
				client,
				refresh,
				flash
			]);
			const rejectUpgrade = (0, react.useCallback)(async (requestId) => {
				if (!client) return;
				setBusy(requestId);
				try {
					await client.rejectPermissionUpgrade(requestId, "party-A");
					flash("已拒绝升级");
					setPending(await client.listPendingUpgrades());
				} catch (e) {
					flash(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [client, flash]);
			/**
			* 建立连接。选了 N 个会话就**两两相连**（C(N,2) 条）。
			* 三个会话 = 3 条连接，四张卡片式地互相都通。
			*/
			const connect = (0, react.useCallback)(async () => {
				if (!client) return;
				const chosen = picks.map((p) => p.trim()).filter((p) => p.length > 0);
				if (chosen.length < 2) {
					flash("请至少选择两个会话");
					return;
				}
				const unique = Array.from(new Set(chosen));
				if (unique.length !== chosen.length) {
					flash("同一个会话只能选一次");
					return;
				}
				setBusy("create");
				try {
					const pairs = [];
					for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) pairs.push([unique[i], unique[j]]);
					for (const [a, b] of pairs) await client.createConnection(a, b);
					setPicks(["", ""]);
					flash(pairs.length === 1 ? "已建立连接" : `已建立 ${pairs.length} 条两两连接`);
					await refresh();
				} catch (e) {
					flash(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [
				client,
				picks,
				refresh,
				flash
			]);
			/**
			* 设置**某一个方向**的权限。
			*
			* 两个方向本来就是分开的（aToB / bToA），可以做成不对称：
			* 例如「A 可读写 B，但 B 对 A 只能只读」。
			* 界面用真实会话名而不是 A/B 字母，避免看不懂。
			*/
			const applyPermission = (0, react.useCallback)(async (conn, direction, level) => {
				if (!client) return;
				setBusy(conn.id);
				try {
					const isUpgrade = permValue(level) > permValue(conn.permission[direction]);
					await client.requestPermissionUpgrade(conn.id, direction, level);
					await refresh();
					flash(isUpgrade ? "已发出升级请求：需要被授权的一方确认（面板上会出现待确认）" : "权限已更新");
				} catch (e) {
					flash(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [
				client,
				refresh,
				flash
			]);
			const disconnect = (0, react.useCallback)(async (id) => {
				if (!client) return;
				setBusy(id);
				try {
					await client.disconnect(id);
					setExpandedId((prev) => prev === id ? null : prev);
					await refresh();
					flash("已断开");
				} catch (e) {
					flash(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [
				client,
				refresh,
				flash
			]);
			const ready = Boolean(client);
			const noSessions = sessionOptions.length === 0;
			const useManualInput = manual || noSessions;
			const orderedOptions = (0, react.useMemo)(() => sessionOptions.slice().sort((a, b) => a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1), [sessionOptions]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ccr-page",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "ccr-page__head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: "ccr-page__title",
							children: "会话连接"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "ccr-page__sub",
							children: "在两个会话之间建立有状态连接，连接上可以挂载卡片。 也可以在输入框左侧按住圆点，直接拖到左侧会话上建立。"
						})]
					}),
					!ready && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-empty",
						children: "连接宿主通道未就绪"
					}),
					ready && error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ccr-error",
						children: ["宿主通信失败：", error]
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-notice",
						children: notice
					}),
					ready && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "ccr-block",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: "ccr-block__title",
								children: "新建连接"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ccr-form",
								children: [picks.map((value, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [index > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "ccr-form__join",
									title: picks.length >= 3 ? "去掉第三个会话（回到两两相连）" : "再加一个会话：三个会两两相连（共 3 条连接）",
									onClick: () => setPicks((prev) => prev.length >= 3 ? ["", ""] : [...prev, ""]),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-form__join-arrow",
										"aria-hidden": "true",
										children: "↔"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-form__join-mark",
										"aria-hidden": "true",
										children: picks.length >= 3 ? "−" : "+"
									})]
								}), useManualInput ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "ccr-input",
									placeholder: index === 0 ? "会话 ID 1" : `会话 ID ${index + 1}`,
									value,
									onChange: (e) => setPick(index, e.target.value.trim())
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "ccr-select",
									value,
									onChange: (e) => setPick(index, e.target.value),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "选择会话…"
									}), orderedOptions.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: s.id,
										children: s.isCurrent ? `● ${s.label}（当前）` : s.label
									}, s.id))]
								})] }, index)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ccr-btn ccr-btn--primary",
									disabled: busy === "create",
									onClick: () => void connect(),
									children: "建立连接"
								})]
							}),
							picks.length >= 3 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "ccr-hint",
								children: [
									"三个会话会两两相连（共 ",
									picks.length * (picks.length - 1) / 2,
									" 条连接）。"
								]
							}),
							noSessions && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "ccr-hint",
								children: [sessionsReady ? "会话列表暂时为空。" : "读不到会话列表，可以直接填会话 ID。", "也可以直接在输入框左侧按住圆点，拖到左侧会话上建立连接。"]
							}),
							!noSessions && !manual && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ccr-link",
								onClick: () => setManual(true),
								children: "改用会话 ID 手动输入"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "ccr-block",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
								className: "ccr-block__title",
								children: [
									"已有连接",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-count",
										children: connections.length
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "ccr-link ccr-rail-toggle",
										title: prefsState.railVisible ? "隐藏会话列表上的连接线路" : "在会话列表上显示连接线路",
										onClick: () => prefs.set({ railVisible: !prefsState.railVisible }),
										children: prefsState.railVisible ? "隐藏线路" : "显示线路"
									})
								]
							}),
							ready && loaded && connections.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ccr-empty",
								children: "还没有连接。选两个会话建立一条，或直接用拖拽。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ccr-list",
								children: connections.map((conn) => {
									const health = conn.health ?? "green";
									const label = (l) => PERMISSION_CHOICES.find((c) => c.value === l)?.label ?? l;
									const aToB = conn.permission.aToB;
									const bToA = conn.permission.bToA;
									const symmetric = aToB === bToA;
									/**
									* 权限摘要。不对称时给两个方向的值（顺序同展开后的两行），
									* 具体哪个方向是哪一行由展开区呈现。
									*/
									const permSummary = symmetric ? label(aToB) : `${label(aToB)} / ${label(bToA)}`;
									const open = expandedId === conn.id;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
										className: `ccr-conn${open ? " ccr-conn--open" : ""}`,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "ccr-conn__head",
											onClick: () => setExpandedId(open ? null : conn.id),
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "ccr-dot",
													style: { background: HEALTH_COLOR[health] }
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "ccr-conn__pair",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "ccr-conn__session",
															children: labelOf(conn.sessionA)
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "ccr-conn__arrow",
															children: "↔"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "ccr-conn__session",
															children: labelOf(conn.sessionB)
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "ccr-conn__meta",
													title: symmetric ? "两个方向权限相同" : "两个方向权限不同（顺序与展开后的两行一致），点开可分别设置",
													children: [
														HEALTH_TEXT[health] ?? health,
														" · ",
														permSummary,
														" · ",
														conn.cards.length,
														" 卡片"
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "ccr-chevron",
													children: open ? "▾" : "▸"
												})
											]
										}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "ccr-conn__body",
											children: [
												pending.filter((p) => p.connectionId === conn.id).map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "ccr-pending",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "ccr-pending__text",
														children: [
															"待确认：权限升到「",
															PERMISSION_CHOICES.find((c) => c.value === p.to)?.label ?? p.to,
															"」　（已确认 ",
															p.acceptedCount,
															"/",
															p.requiredAccepts,
															"）"
														]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "ccr-conn__actions",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "ccr-btn ccr-btn--primary",
															disabled: busy === p.id,
															onClick: () => void acceptUpgrade(p.id),
															children: "同意"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "ccr-btn",
															disabled: busy === p.id,
															onClick: () => void rejectUpgrade(p.id),
															children: "拒绝"
														})]
													})]
												}, p.id)),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "ccr-field",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "ccr-field__label",
															children: "权限（两个方向可分别设置）"
														}),
														[{
															direction: "aToB",
															fromLabel: labelOf(conn.sessionA),
															toLabel: labelOf(conn.sessionB),
															current: conn.permission.aToB
														}, {
															direction: "bToA",
															fromLabel: labelOf(conn.sessionB),
															toLabel: labelOf(conn.sessionA),
															current: conn.permission.bToA
														}].map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "ccr-perm-row",
															children: [
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																	className: "ccr-perm-row__who",
																	title: `${row.fromLabel} → ${row.toLabel}`,
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "ccr-perm-row__name",
																		children: row.fromLabel
																	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "ccr-perm-row__verb",
																		"aria-hidden": "true",
																		children: "→"
																	})]
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																	className: "ccr-seg",
																	children: PERMISSION_CHOICES.map((choice) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																		type: "button",
																		className: `ccr-seg__item${row.current === choice.value ? " ccr-seg__item--active" : ""}`,
																		disabled: busy === conn.id,
																		title: choice.hint,
																		onClick: () => void applyPermission(conn, row.direction, choice.value),
																		children: choice.label
																	}, choice.value))
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																	className: "ccr-perm-row__target",
																	title: row.toLabel,
																	children: row.toLabel
																})
															]
														}, row.direction)),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "ccr-field__hint",
															children: "提高权限需要**被授权的一方**确认，面板上会出现待确认； 降低权限立即生效。两个方向互不影响，可以做成一端可读写、另一端只读。"
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardStack, {
													connection: conn,
													client,
													onChanged: refresh
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "ccr-conn__actions",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "ccr-btn ccr-btn--danger",
														disabled: busy === conn.id,
														onClick: () => void disconnect(conn.id),
														children: "断开连接"
													})
												})
											]
										})]
									}, conn.id);
								})
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/ui/ConnectionPanelIcon.tsx
		function ConnectionPanelIcon({ size, active }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				style: {
					display: "block",
					opacity: active ? 1 : .75
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "6",
						cy: "7",
						r: "2.6",
						stroke: "currentColor",
						strokeWidth: "1.7"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "18",
						cy: "17",
						r: "2.6",
						stroke: "currentColor",
						strokeWidth: "1.7"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M6 9.6 C6 14, 10 12, 12 12 S 18 10, 18 14.4",
						stroke: "currentColor",
						strokeWidth: "1.7",
						strokeLinecap: "round",
						strokeDasharray: "3 2.5",
						opacity: "0.95"
					})
				]
			});
		}
		//#endregion
		//#region src/core/lane-allocator.ts
		function allocateLanes(connections, sessionOrder) {
			const intervals = connections.map((c) => {
				const idxA = sessionOrder.indexOf(c.sessionA);
				const idxB = sessionOrder.indexOf(c.sessionB);
				if (idxA === -1 || idxB === -1) return null;
				const start = Math.min(idxA, idxB);
				const end = Math.max(idxA, idxB);
				return {
					id: c.id,
					start,
					end
				};
			}).filter((x) => x !== null).sort((a, b) => a.start - b.start);
			const lanes = [];
			const assignments = /* @__PURE__ */ new Map();
			for (const interval of intervals) {
				let placed = false;
				for (let i = 0; i < lanes.length; i++) {
					const lane = lanes[i];
					if (!lane.connections.some((cid) => {
						const other = assignments.get(cid);
						return !(interval.end <= other.startIndex || interval.start >= other.endIndex);
					})) {
						lane.connections.push(interval.id);
						assignments.set(interval.id, {
							connectionId: interval.id,
							laneIndex: i,
							startIndex: interval.start,
							endIndex: interval.end
						});
						placed = true;
						break;
					}
				}
				if (!placed) {
					const newLane = {
						index: lanes.length,
						connections: [interval.id]
					};
					lanes.push(newLane);
					assignments.set(interval.id, {
						connectionId: interval.id,
						laneIndex: newLane.index,
						startIndex: interval.start,
						endIndex: interval.end
					});
				}
			}
			return {
				lanes,
				connections: assignments
			};
		}
		//#endregion
		//#region src/ui/SessionRowMarker.tsx
		/**
		* SessionRowMarker — 把会话 id 写到会话行元素上的不可见标记。
		*
		* 背景：DSH 的会话行 DOM **没有任何 id 属性**（只有 `role="treeitem"` 和标题文本），
		* 所以「拖到哪个会话」「左侧竖线连哪两行」都缺一个 DOM → id 的映射。
		*
		* 官方给了入口：`sidebar.session.row.leading` 槽位的 ownerProps 是
		* `{ sessionId }`，挂进去就能知道自己在哪一行。
		* 这里渲染一个 `display:none` 的 span，并在 effect 里给祖先行元素打上
		* `data-ccr-session="<id>"` —— 于是 `[data-ccr-session]` 就成了可靠选择器。
		*
		* 注意：该槽位在「行处于非 idle 状态」时会被状态点顶掉（官方文档明说），
		* 因此不是每一行都有标记；调用方需容忍缺失（见 client/row-map.ts 的对齐逻辑）。
		*/
		/** 行元素上承载会话 id 的属性名。 */
		const ROW_ID_ATTR = "data-ccr-session";
		function SessionRowMarker({ sessionId }) {
			const ref = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const row = ref.current?.closest("[role=\"treeitem\"]");
				if (!row) return;
				row.setAttribute(ROW_ID_ATTR, sessionId);
			}, [sessionId]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref,
				style: { display: "none" },
				"aria-hidden": "true"
			});
		}
		//#endregion
		//#region src/client/row-map.ts
		/**
		* row-map — DOM 会话行 → 会话 id 的映射。
		*
		* 三个来源，按可靠度递减：
		*   1. `[data-ccr-session]` —— SessionRowMarker 写在行上。
		*      最可靠，但官方文档明说该槽位会被「状态点」顶掉，只有 idle 行会挂载
		*      （实测 18 行里 12 行有标记）。
		*   2. **标题匹配** —— 用行文本比对会话标题；只接受唯一命中，避免重名误判。
		*   3. **序号对齐** —— DOM 顺序与宿主会话列表顺序一致时按序号补；
		*      只在行数与会话数相等时启用（实测 94 vs 18，通常不成立）。
		*
		* 安全策略：三种都拿不到就放弃这一行。宁可少认几行，
		* 也绝不把连接建到错误的会话上。
		*/
		/** 行文本归一化：压空白 + 转小写。 */
		function normalizeText(text) {
			return text.replace(/\s+/g, " ").trim().toLowerCase();
		}
		/**
		* 收集当前 DOM 里能确定 id 的会话行（按视觉顺序）。
		* @param snapshot - 会话快照（提供 id 顺序与标题，用于兜底匹配）
		*/
		function collectSessionRows(snapshot) {
			if (typeof document === "undefined") return [];
			const rows = Array.from(document.querySelectorAll("[role=\"treeitem\"]"));
			if (rows.length === 0) return [];
			const ids = snapshot?.ids ?? [];
			const byId = snapshot?.byId ?? {};
			const idByRow = /* @__PURE__ */ new Map();
			const anchorIndexById = /* @__PURE__ */ new Map();
			rows.forEach((row, index) => {
				const id = row.getAttribute(ROW_ID_ATTR);
				if (id) {
					idByRow.set(row, id);
					anchorIndexById.set(index, id);
				}
			});
			const idsByTitle = /* @__PURE__ */ new Map();
			for (const id of ids) {
				const title = byId[id]?.title;
				if (typeof title !== "string") continue;
				const key = normalizeText(title);
				if (key.length === 0) continue;
				const bucket = idsByTitle.get(key);
				if (bucket) bucket.push(id);
				else idsByTitle.set(key, [id]);
			}
			if (idsByTitle.size > 0) for (const row of rows) {
				if (idByRow.has(row)) continue;
				const text = normalizeText(row.textContent ?? "");
				if (text.length === 0) continue;
				for (const [title, bucket] of idsByTitle) {
					if (bucket.length !== 1) continue;
					if (text === title || text.startsWith(title)) {
						idByRow.set(row, bucket[0]);
						break;
					}
				}
			}
			if (anchorIndexById.size > 0) {
				const idIndexById = /* @__PURE__ */ new Map();
				ids.forEach((id, i) => {
					if (!idIndexById.has(id)) idIndexById.set(id, i);
				});
				const claimedIdIndexes = /* @__PURE__ */ new Set();
				for (const id of idByRow.values()) {
					const i = idIndexById.get(id);
					if (i !== void 0) claimedIdIndexes.add(i);
				}
				const anchors = [...anchorIndexById.entries()].map(([domIndex, id]) => ({
					domIndex,
					idIndex: idIndexById.get(id) ?? -1
				})).filter((a) => a.idIndex >= 0).sort((a, b) => a.domIndex - b.domIndex);
				/** 在 (loId, hiId) 区间内给 (loDom, hiDom) 的空档补 id。 */
				const fillGap = (loDom, hiDom, loIdIndex, hiIdIndex) => {
					const gapDoms = [];
					for (let i = loDom + 1; i < hiDom; i++) if (!idByRow.has(rows[i])) gapDoms.push(i);
					if (gapDoms.length === 0) return;
					const candidates = [];
					for (let k = loIdIndex + 1; k < hiIdIndex; k++) if (!claimedIdIndexes.has(k)) candidates.push(k);
					if (candidates.length !== gapDoms.length) return;
					gapDoms.forEach((domIndex, n) => {
						const id = ids[candidates[n]];
						if (!id) return;
						idByRow.set(rows[domIndex], id);
						claimedIdIndexes.add(candidates[n]);
					});
				};
				for (let i = 0; i + 1 < anchors.length; i++) fillGap(anchors[i].domIndex, anchors[i + 1].domIndex, anchors[i].idIndex, anchors[i + 1].idIndex);
				if (anchors.length > 0) {
					fillGap(-1, anchors[0].domIndex, -1, anchors[0].idIndex);
					fillGap(anchors[anchors.length - 1].domIndex, rows.length, anchors[anchors.length - 1].idIndex, ids.length);
				}
			}
			if (ids.length === rows.length) rows.forEach((row, i) => {
				const candidate = ids[i];
				if (candidate && !idByRow.has(row)) idByRow.set(row, candidate);
			});
			const result = [];
			for (const row of rows) {
				const id = idByRow.get(row);
				if (!id) continue;
				const rect = row.getBoundingClientRect();
				if (rect.width === 0 && rect.height === 0) continue;
				result.push({
					element: row,
					id,
					top: rect.top,
					bottom: rect.bottom,
					left: rect.left,
					right: rect.right
				});
			}
			result.sort((a, b) => a.top - b.top);
			return result;
		}
		/** 命中坐标下的会话行信息；没有可靠映射时返回 null。 */
		function sessionRowAtPoint(x, y, snapshot) {
			if (typeof document === "undefined") return null;
			const row = document.elementFromPoint(x, y)?.closest("[role=\"treeitem\"]");
			if (!row) return null;
			return collectSessionRows(snapshot).find((info) => info.element === row) ?? null;
		}
		//#endregion
		//#region src/ui/SessionRailOverlay.tsx
		/**
		* SessionRailOverlay — 会话列表上的「垂直连接」。
		*
		* 用户要求：
		*   - 连上后拖拽线消失，改为在会话列表里保留竖线；
		*   - 风格与拖拽的「水流」线近似（白色半透明 + 光晕 + 微流动）；
		*   - **画在会话行上**，不要挤到最左侧的窄边沟里。
		*
		* 实现：挂 `shell.overlay`（root/list/replaceRisk none，纯覆盖不抢槽位），
		* 测量会话行实际坐标后作画 —— DSH 没暴露行坐标接口，只能实测。
		* id 的来源见 client/row-map.ts。
		*/
		/** 每条 lane 的水平间距（px）。多条连接并行时靠它拉开。 */
		const LANE_WIDTH = 9;
		/** 竖线相对会话行**右边缘**内缩多少（贴行画，不占左侧窄沟）。 */
		const ROW_RIGHT_INSET = 14;
		/** 会话行位置的采样间隔。DOM 没有坐标接口，只能定期量。 */
		const MEASURE_INTERVAL_MS = 400;
		const PERMISSION_COLOR = {
			read: "#9CA3AF",
			suggest: "#3B82F6",
			write: "#F97316"
		};
		function SessionRailOverlay({ client, sessions, prefs }) {
			const { connections } = useConnections(client);
			const { snapshot } = useSessionList(sessions);
			const [rows, setRows] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				const lastSeen = /* @__PURE__ */ new Map();
				const HOLD_MS = 1500;
				const measure = () => {
					const fresh = collectSessionRows(snapshot);
					const now = Date.now();
					for (const info of fresh) lastSeen.set(info.id, {
						info,
						at: now
					});
					for (const [id, entry] of lastSeen) if (now - entry.at > HOLD_MS) lastSeen.delete(id);
					const merged = [];
					const seen = /* @__PURE__ */ new Set();
					for (const info of fresh) {
						merged.push(info);
						seen.add(info.id);
					}
					for (const [id, entry] of lastSeen) {
						if (seen.has(id)) continue;
						merged.push(entry.info);
					}
					merged.sort((a, b) => a.top - b.top);
					setRows((prev) => {
						if (prev.length === merged.length) {
							let same = true;
							for (let i = 0; i < merged.length; i++) {
								const a = prev[i];
								const b = merged[i];
								if (a.id !== b.id || Math.abs(a.top - b.top) > .5 || Math.abs(a.bottom - b.bottom) > .5 || Math.abs(a.right - b.right) > .5) {
									same = false;
									break;
								}
							}
							if (same) return prev;
						}
						return merged;
					});
				};
				measure();
				const timer = window.setInterval(measure, MEASURE_INTERVAL_MS);
				window.addEventListener("scroll", measure, true);
				window.addEventListener("resize", measure);
				return () => {
					window.clearInterval(timer);
					window.removeEventListener("scroll", measure, true);
					window.removeEventListener("resize", measure);
				};
			}, [snapshot]);
			const rail = (0, react.useMemo)(() => {
				if (rows.length < 2 || connections.length === 0) return null;
				const layout = allocateLanes(connections, rows.map((r) => r.id));
				const rowById = new Map(rows.map((r) => [r.id, r]));
				const baseX = Math.max(...rows.map((r) => r.right)) - ROW_RIGHT_INSET;
				const segments = [];
				for (const conn of connections) {
					const assignment = layout.connections.get(conn.id);
					if (!assignment) continue;
					const a = rowById.get(conn.sessionA);
					const b = rowById.get(conn.sessionB);
					if (!a || !b) continue;
					const y1 = (a.top + a.bottom) / 2;
					const y2 = (b.top + b.bottom) / 2;
					const x = baseX - assignment.laneIndex * LANE_WIDTH;
					const level = conn.permission.aToB;
					segments.push({
						id: conn.id,
						laneIndex: assignment.laneIndex,
						x,
						y1,
						y2,
						top: Math.min(y1, y2),
						bottom: Math.max(y1, y2),
						color: PERMISSION_COLOR[level] ?? "#9CA3AF",
						broken: conn.status === "broken"
					});
				}
				if (segments.length === 0) return null;
				return {
					segments,
					bounds: {
						left: Math.min(...segments.map((s) => s.x)) - 8,
						right: Math.max(...segments.map((s) => s.x)) + 8,
						top: Math.min(...segments.map((s) => s.top)) - 8,
						bottom: Math.max(...segments.map((s) => s.bottom)) + 8
					}
				};
			}, [rows, connections]);
			(0, react.useEffect)(() => {
				if (!client) return;
				const short = (s) => s.replace(/^session-/, "").slice(0, 8);
				const needed = Array.from(new Set(connections.flatMap((c) => [c.sessionA, c.sessionB])));
				const mappedIds = new Set(rows.map((r) => r.id));
				const missing = needed.filter((id) => !mappedIds.has(id));
				client.report(`rail conns=${connections.length} rows=${rows.length} segments=${rail?.segments.length ?? 0} missing=[${missing.map(short).join(",") || "无"}] mapped=[${rows.map((r) => short(r.id)).join(",")}]`);
			}, [
				rail,
				rows,
				connections,
				client
			]);
			/** 视图偏好：整条轨道可以一键隐藏（只影响观感，连接本身不动）。 */
			const [railVisible, setRailVisible] = (0, react.useState)(() => prefs.get().railVisible);
			(0, react.useEffect)(() => prefs.subscribe(() => setRailVisible(prefs.get().railVisible)), [prefs]);
			if (!railVisible) return null;
			if (!rail) return null;
			const { segments, bounds } = rail;
			const width = bounds.right - bounds.left;
			const height = bounds.bottom - bounds.top;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "ccr-rail-overlay",
				"aria-hidden": "true",
				style: {
					position: "fixed",
					left: bounds.left,
					top: bounds.top,
					width,
					height,
					pointerEvents: "none",
					zIndex: 5,
					overflow: "visible"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("filter", {
					id: "ccr-rail-glow",
					x: "-80%",
					y: "-30%",
					width: "260%",
					height: "160%",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("feGaussianBlur", { stdDeviation: "2" })
				}) }), segments.map((seg) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
					opacity: seg.broken ? .35 : 1,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: seg.x - bounds.left,
							y1: seg.y1 - bounds.top,
							x2: seg.x - bounds.left,
							y2: seg.y2 - bounds.top,
							stroke: "var(--ccr-flow-color, #fff)",
							strokeWidth: 5,
							strokeOpacity: .14,
							strokeLinecap: "round",
							filter: "url(#ccr-rail-glow)"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: seg.x - bounds.left,
							y1: seg.y1 - bounds.top,
							x2: seg.x - bounds.left,
							y2: seg.y2 - bounds.top,
							stroke: "var(--ccr-flow-color, #fff)",
							strokeWidth: 2,
							strokeOpacity: .55,
							strokeLinecap: "round"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: seg.x - bounds.left,
							y1: seg.y1 - bounds.top,
							x2: seg.x - bounds.left,
							y2: seg.y2 - bounds.top,
							stroke: "var(--ccr-flow-color, #fff)",
							strokeWidth: 1.2,
							strokeOpacity: .45,
							strokeLinecap: "round",
							strokeDasharray: "10 26",
							className: "ccr-rail__flow"
						}),
						[seg.y1, seg.y2].map((y, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: seg.x - bounds.left,
							cy: y - bounds.top,
							r: 4.5,
							fill: seg.color,
							fillOpacity: .22,
							filter: "url(#ccr-rail-glow)"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: seg.x - bounds.left,
							cy: y - bounds.top,
							r: 2.6,
							fill: seg.color,
							fillOpacity: .9
						})] }, i))
					]
				}, seg.id))]
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
				listCardTemplates: (connectionId) => invoke(RPC_ENDPOINTS.listCardTemplates, connectionId ? { connectionId } : {}),
				renderCardPanel: (instanceId) => invoke(RPC_ENDPOINTS.renderCardPanel, { instanceId }),
				listPendingUpgrades: (connectionId) => invoke(RPC_ENDPOINTS.listUpgradeRequests, connectionId ? { connectionId } : {}),
				negotiateWhitelist: (connectionId, methods) => invoke(RPC_ENDPOINTS.negotiateWhitelist, {
					connectionId,
					methods
				}),
				listWhitelistedMethods: (connectionId) => invoke(RPC_ENDPOINTS.listWhitelist, { connectionId }),
				listSessions: () => invoke(RPC_ENDPOINTS.listSessions),
				report: (message) => {
					rpc.call(RPC_CHANNEL, RPC_ENDPOINTS.debugLog, { message }).catch(() => {});
				}
			};
		}
		//#endregion
		//#region src/client/view-prefs.ts
		const STORAGE_KEY = "dsh-connection-card-host/view-prefs";
		const DEFAULT_PREFS = { railVisible: true };
		function load() {
			try {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (!raw) return { ...DEFAULT_PREFS };
				const parsed = JSON.parse(raw);
				return { railVisible: typeof parsed.railVisible === "boolean" ? parsed.railVisible : DEFAULT_PREFS.railVisible };
			} catch {
				return { ...DEFAULT_PREFS };
			}
		}
		/** 建一个视图偏好 store（浏览器半共用同一个实例）。 */
		function createViewPrefs() {
			let prefs = load();
			const listeners = /* @__PURE__ */ new Set();
			return {
				get: () => prefs,
				set: (patch) => {
					prefs = {
						...prefs,
						...patch
					};
					try {
						localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
					} catch {}
					for (const listener of [...listeners]) try {
						listener();
					} catch {}
				},
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				}
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
  /* 拉线「水流」主色。
     用户要求白色半透明；但纯白在浅色主题下不可见，
     因此取 DSH 的主题 token（深色主题=白，浅色主题=深），保证两个主题都看得见。
     想强制纯白就把这里改成 #ffffff。 */
  --ccr-flow-color: var(--dsw-alias-label-primary, #ffffff);
  --ccr-fast: 150ms cubic-bezier(0.2, 0, 0, 1);
  --ccr-panel-highlight: rgba(96, 165, 250, 0.12);
}

/* ═══ AnchorCircle（几何在内联样式里，这里只补动效） ═══ */
.ccr-anchor {
  animation: none;
}

.ccr-anchor__pulse {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid var(--ccr-flow-color);
  opacity: 0;
  pointer-events: none;
}

.ccr-anchor--dragging .ccr-anchor__pulse {
  animation: ccr-anchor-pulse 1200ms ease-out infinite;
}

/* 幅度收小：1 → 1.45（原来 2 太大，观感"一直闪"） */
@keyframes ccr-anchor-pulse {
  0% { transform: scale(1); opacity: 0.5; }
  100% { transform: scale(1.45); opacity: 0; }
}

/* ═══ DragLine：水流效果 ═══
   三层叠加：
     1. ccr-flow__glow   宽 + 高斯模糊 + 极低透明 → 水汽光晕
     2. ccr-flow__core   渐变白主线（两端淡出，不是硬邦邦的线）
     3. ccr-flow__band   短划线沿路径滑动 → 水在流
   粒子（水珠）由组件内联渲染。 */
.ccr-drag-line {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  overflow: visible;
}

.ccr-flow__glow {
  fill: none;
  stroke: var(--ccr-flow-color);
  stroke-width: 7px;
  stroke-opacity: 0.16;
  stroke-linecap: round;
}

.ccr-flow__core {
  fill: none;
  stroke-linecap: round;
}

.ccr-flow__band {
  fill: none;
  stroke: var(--ccr-flow-color);
  stroke-width: 1.2px;
  stroke-opacity: 0.5;
  stroke-linecap: round;
  stroke-dasharray: 34 58;
  animation: ccr-water-flow 1100ms linear infinite;
}

@keyframes ccr-water-flow {
  to { stroke-dashoffset: -92; }
}

.ccr-flow__particle {
  fill: var(--ccr-flow-color);
}

/* ═══ SessionRail：会话行上的竖线（风格对齐拖拽的水流线） ═══ */
.ccr-rail__flow {
  animation: ccr-rail-flow 2600ms linear infinite;
}

@keyframes ccr-rail-flow {
  to { stroke-dashoffset: -36; }
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

/* ═══ 拖拽落点提示（命中左侧会话行） ═══ */
.ccr-target {
  background: var(--ccr-panel-highlight) !important;
  box-shadow: inset 2px 0 0 var(--ccr-flow-color) !important;
}

/* 已连的目标：松手会断开，用红调区分于「会连接」 */
.ccr-target--disconnect {
  background: rgba(239, 68, 68, 0.13) !important;
  box-shadow: inset 2px 0 0 #EF4444 !important;
}

/* ═══ 面板（main 槽位，整页宽度） ═══ */
.ccr-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 40px;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
}

.ccr-page__head { margin-bottom: 20px; }

.ccr-page__title {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 600;
}

.ccr-page__sub {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #888);
}

.ccr-block {
  margin-bottom: 22px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  border-radius: 10px;
}

.ccr-block__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
}

.ccr-count {
  padding: 0 6px;
  border-radius: 8px;
  background: var(--ccr-panel-highlight);
  font-size: 11px;
  font-weight: 500;
}

/* ─── 表单 ─── */
.ccr-form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ccr-select,
.ccr-input {
  flex: 1 1 160px;
  min-width: 0;
  box-sizing: border-box;
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08));
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  border-radius: 6px;
}

.ccr-form__sep { opacity: 0.5; }

/* 新建连接中间的可点连接符。
   默认外观与普通 ↔ 分隔符一致（无框、无底色）；
   悬浮时出现边框与底色，并浮出一个 + / − 提示可以增删一个会话槽位。 */
.ccr-form__join {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: none;
  padding: 2px 5px;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  color: inherit;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.ccr-form__join-arrow { opacity: 0.5; }

.ccr-form__join-mark {
  font-size: 11px;
  opacity: 0;
  transform: translateX(-2px);
  transition: opacity 120ms ease, transform 120ms ease;
}

.ccr-form__join:hover {
  background: var(--ccr-panel-highlight);
  border-color: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
}

.ccr-form__join:hover .ccr-form__join-arrow { opacity: 0.9; }

.ccr-form__join:hover .ccr-form__join-mark {
  opacity: 1;
  transform: translateX(0);
}

/* 小号分段控件（轨道线路开关） */
.ccr-seg--small .ccr-seg__item {
  padding: 2px 8px;
  font-size: 11px;
}

.ccr-rail-toggle { margin-left: auto; }

.ccr-btn {
  padding: 6px 14px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4));
  border-radius: 6px;
  cursor: pointer;
}

.ccr-btn:hover:not(:disabled) { background: var(--ccr-panel-highlight); }
.ccr-btn:disabled { opacity: 0.45; cursor: default; }

.ccr-btn--primary {
  border-color: var(--ccr-flow-color);
  background: var(--ccr-panel-highlight);
}

.ccr-btn--danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.14);
  border-color: #EF4444;
}

.ccr-link {
  margin-top: 8px;
  padding: 0;
  font: inherit;
  font-size: 11px;
  color: inherit;
  opacity: 0.6;
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
}

.ccr-hint,
.ccr-field__hint {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #888);
  opacity: 0.85;
}

/* ─── 提示条 ─── */
.ccr-notice,
.ccr-empty,
.ccr-error {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
}

.ccr-notice { background: var(--ccr-panel-highlight); }
.ccr-empty { color: var(--dsw-alias-label-secondary, #888); padding-left: 0; }
.ccr-error { color: #EF4444; padding-left: 0; }

/* ─── 连接卡片 ─── */
.ccr-list { display: flex; flex-direction: column; gap: 6px; }

.ccr-conn {
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  border-radius: 8px;
  overflow: hidden;
}

.ccr-conn--open { background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.05)); }

.ccr-conn__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}

.ccr-conn__head:hover { background: var(--ccr-panel-highlight); }

.ccr-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.ccr-conn__pair {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ccr-conn__session {
  max-width: 180px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ccr-conn__arrow { opacity: 0.45; }

.ccr-conn__meta {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #888);
}

.ccr-chevron { flex: none; opacity: 0.45; font-size: 10px; }

.ccr-conn__body {
  padding: 4px 12px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2));
}

.ccr-field { margin: 12px 0; }

.ccr-field__label {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
}

.ccr-seg {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  border-radius: 6px;
  overflow: hidden;
}

.ccr-seg__item {
  padding: 5px 14px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: none;
  border: 0;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  cursor: pointer;
  opacity: 0.7;
}

.ccr-seg__item:last-child { border-right: 0; }
.ccr-seg__item:hover:not(:disabled) { background: var(--ccr-panel-highlight); }
.ccr-seg__item--active { background: var(--ccr-panel-highlight); opacity: 1; font-weight: 500; }
.ccr-seg__item:disabled { cursor: default; opacity: 0.4; }

.ccr-conn__actions { display: flex; gap: 8px; margin-top: 12px; }

.ccr-card-stack { margin: 12px 0; }

/* ═══ 卡片区 ═══ */
.ccr-cards { margin: 12px 0; }

.ccr-cards__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.ccr-cards__add { margin-left: auto; margin-top: 0; }

.ccr-cards__picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.4));
  border-radius: 8px;
}

.ccr-card-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  font: inherit;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  border-radius: 6px;
  cursor: pointer;
}

.ccr-card-option:hover:not(:disabled) { background: var(--ccr-panel-highlight); }
.ccr-card-option:disabled { opacity: 0.45; cursor: default; }
.ccr-card-option__name { font-size: 12px; font-weight: 500; }
.ccr-card-option__meta { font-size: 11px; opacity: 0.6; }

.ccr-card {
  margin-top: 6px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  border-radius: 8px;
  overflow: hidden;
}

.ccr-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.ccr-card__name { font-weight: 500; }

.ccr-card__meta {
  font-size: 11px;
  opacity: 0.5;
  margin-right: auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 40%;
}

.ccr-card__panel {
  padding: 8px 10px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18));
  font-size: 12px;
}

/* ═══ 权限（两个方向可分别设置） ═══ */
.ccr-perm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  min-width: 0;
}

.ccr-perm-row__who {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  flex: 1 1 auto;
}

.ccr-perm-row__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 42%;
  font-size: 12px;
}

.ccr-perm-row__verb {
  flex: none;
  font-size: 13px;
  line-height: 1;
  opacity: 0.45;
}

.ccr-perm-row__target {
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 42%;
  font-size: 12px;
  opacity: 0.85;
}

.ccr-perm-row .ccr-seg { flex: none; }

/* ═══ 待确认的权限升级 ═══ */
.ccr-pending {
  margin: 10px 0;
  padding: 10px;
  border: 1px solid var(--ccr-flow-color);
  border-radius: 8px;
  background: var(--ccr-panel-highlight);
}

.ccr-pending__text {
  font-size: 12px;
  line-height: 1.5;
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
  .ccr-flow__band,
  .ccr-rail__flow,
  .ccr-anchor--dragging .ccr-anchor__pulse { animation: none !important; }
  .ccr-flow__particle { display: none !important; }
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
		* 槽位注册（都挑 kind=list / replaceRisk=none 的追加位，不抢出厂 UI）：
		*   - conversation.input.left : 输入框工具行左侧的连接锚点（小圆点）
		*   - sidebar.panellist       : 侧栏图标 —— **只放图标**，点击由侧栏负责切主面板
		*   - main (key=同 id)        : 真正的连接管理面板
		*   - shell.overlay           : 左侧会话列表上的竖直连接线（覆盖层）
		*
		* 宿主数据经 DSH 官方 Connection RPC 通道读取（ctx.connection.rpc）。
		*/
		/** 侧栏图标 id 与主面板 key 必须一致，侧栏才能找到对应面板。 */
		const PANEL_ID = "connection-panel";
		/** 需要 slots 注入 UI，connection 提供宿主 RPC，sessions 提供会话身份。 */
		const inject = [
			"slots",
			"connection",
			"sessions"
		];
		function apply(ctx) {
			const rpc = resolveRpcCaller(ctx);
			const client = rpc ? createHostClient(rpc) : null;
			const sessions = resolveSessions(ctx);
			if (!rpc) ctx.logger?.warn?.("[connection-card-host] ctx.connection.rpc 不可用；面板将无法读取宿主连接");
			if (!sessions) ctx.logger?.warn?.("[connection-card-host] ctx.sessions 不可用；拖拽落点与会话选择器将受限");
			try {
				const removeStyles = injectStyles();
				const effect = safeCtxGet(ctx, "effect");
				if (typeof effect === "function") effect(() => removeStyles, "connection-card-host: styles");
			} catch (e) {
				ctx.logger?.warn?.(`[connection-card-host] 样式注入失败: ${String(e)}`);
			}
			const AnchorWidget = ({ sessionId }) => {
				const drag = useDragLine();
				const [lineDone, setLineDone] = (0, react.useState)(false);
				const highlightedRef = (0, react.useRef)(null);
				/** 当前落点是「会连接」还是「会断开」，用于避免无谓的 class 抖动。 */
				const highlightModeRef = (0, react.useRef)(null);
				const clearHighlight = (0, react.useCallback)(() => {
					highlightedRef.current?.classList.remove("ccr-target", "ccr-target--disconnect");
					highlightedRef.current = null;
					highlightModeRef.current = null;
				}, []);
				/** 拖拽开始时缓存的连接表，用于落点提示与「连上则断」判定。 */
				const connsRef = (0, react.useRef)([]);
				/** 两个会话之间是否已有连接。 */
				const findExisting = (0, react.useCallback)((list, a, b) => list.find((c) => c.sessionA === a && c.sessionB === b || c.sessionA === b && c.sessionB === a), []);
				/** 落点解析：目标会话 + 起点会话 + 是否已连 + 失败原因（诊断用）。 */
				const resolveDrop = (0, react.useCallback)((x, y) => {
					const snap = sessions?.getSnapshot();
					const hit = sessionRowAtPoint(x, y, snap ?? null);
					const sourceId = sessionId ?? snap?.current ?? null;
					const existing = hit && sourceId ? findExisting(connsRef.current, sourceId, hit.id) : void 0;
					let reason;
					if (!sessions) reason = "no-sessions-bridge";
					else if (!hit) reason = "no-row-under-cursor";
					else if (!sourceId) reason = "no-current-session";
					else if (hit.id === sourceId) reason = "same-session";
					else reason = "ok";
					return {
						hit,
						sourceId,
						reason,
						existing,
						idCount: snap?.ids?.length ?? 0
					};
				}, [
					sessions,
					sessionId,
					findExisting
				]);
				const beginDrag = (0, react.useCallback)((x, y) => {
					setLineDone(false);
					connsRef.current = [];
					if (client) client.listConnections().then((list) => {
						connsRef.current = list;
					}).catch(() => {
						connsRef.current = [];
					});
					if (client) {
						const snap = sessions?.getSnapshot();
						client.report(`dragStart slotSessionId=${sessionId ?? "none"} snapshotCurrent=${snap?.current ?? "none"} ids=${snap?.ids?.length ?? 0} rows=${document.querySelectorAll("[role=\"treeitem\"]").length} marked=${document.querySelectorAll("[data-ccr-session]").length}`);
					}
					drag.onMouseDown(x, y);
				}, [
					drag,
					client,
					sessions,
					sessionId
				]);
				/**
				* 松手：**开关语义** —— 已连则断开，未连则连接。
				* 这样不必专门跑面板去断。
				*/
				const finishAt = (0, react.useCallback)((x, y) => {
					const { hit, sourceId, reason } = resolveDrop(x, y);
					if (reason !== "ok" || !hit || !sourceId) {
						if (client) client.report(`dragEnd reason=${reason} hit=${hit?.id ?? "none"}`);
						clearHighlight();
						return;
					}
					clearHighlight();
					(async () => {
						try {
							const existing = findExisting(client ? await client.listConnections() : [], sourceId, hit.id);
							if (existing) {
								await client?.disconnect(existing.id);
								client?.report(`dragEnd toggled-OFF ${sourceId} <-> ${hit.id}`);
							} else {
								await client?.createConnection(sourceId, hit.id);
								client?.report(`dragEnd toggled-ON ${sourceId} <-> ${hit.id}`);
							}
						} catch (err) {
							client?.report(`dragEnd toggle-failed ${String(err)}`);
							console.error("[connection-card-host] 连接开关失败:", err);
						}
					})();
				}, [
					client,
					resolveDrop,
					findExisting,
					clearHighlight
				]);
				/** 拖拽中的落点高亮。已连的目标用「断开」样式区分。 */
				const trackTarget = (0, react.useCallback)((x, y) => {
					const { hit, sourceId, existing } = resolveDrop(x, y);
					const next = hit && hit.id !== sourceId ? hit.element : null;
					const mode = existing ? "disconnect" : "connect";
					if (next !== highlightedRef.current || mode !== highlightModeRef.current) {
						highlightedRef.current?.classList.remove("ccr-target", "ccr-target--disconnect");
						if (next) next.classList.add(mode === "disconnect" ? "ccr-target--disconnect" : "ccr-target");
						highlightedRef.current = next;
						highlightModeRef.current = next ? mode : null;
					}
				}, [resolveDrop]);
				const handlersRef = (0, react.useRef)({
					drag,
					trackTarget,
					finishAt,
					clearHighlight
				});
				handlersRef.current = {
					drag,
					trackTarget,
					finishAt,
					clearHighlight
				};
				(0, react.useEffect)(() => {
					if (!drag.state.dragging) return;
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
						if (e.key === "Escape") {
							handlersRef.current.clearHighlight();
							handlersRef.current.drag.onMouseUp();
						}
					};
					window.addEventListener("mousemove", onMove);
					window.addEventListener("mouseup", onUp);
					window.addEventListener("keydown", onKey);
					const prevUserSelect = document.body.style.userSelect;
					const prevCursor = document.body.style.cursor;
					document.body.style.userSelect = "none";
					document.body.style.cursor = "grabbing";
					return () => {
						window.removeEventListener("mousemove", onMove);
						window.removeEventListener("mouseup", onUp);
						window.removeEventListener("keydown", onKey);
						document.body.style.userSelect = prevUserSelect;
						document.body.style.cursor = prevCursor;
					};
				}, [drag.state.dragging]);
				(0, react.useEffect)(() => {
					if (!drag.state.dragging) clearHighlight();
				}, [drag.state.dragging, clearHighlight]);
				(0, react.useEffect)(() => {
					if (!drag.state.dragging) return;
					const onMove = (e) => {
						const t = e.touches[0];
						if (!t) return;
						const h = handlersRef.current;
						if (h.drag.onTouchMove(t.clientX, t.clientY)) e.preventDefault();
						h.trackTarget(t.clientX, t.clientY);
					};
					const onEnd = (e) => {
						const t = e.changedTouches[0];
						const h = handlersRef.current;
						if (t) h.finishAt(t.clientX, t.clientY);
						h.drag.onTouchEnd();
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
					dragging: drag.state.dragging,
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
			const stableClient = client;
			const stableSessions = sessions;
			const prefs = createViewPrefs();
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "connection-anchor",
				order: 100,
				label: "连接"
			}, (props) => AnchorWidget({ sessionId: props?.sessionId })));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 200,
				label: "连接"
			}, () => ConnectionPanelIcon({
				size: 18,
				active: false
			})));
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID
			}, () => ConnectionPanel({
				client: stableClient,
				sessions: stableSessions,
				prefs
			})));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "connection-rail",
				order: 50,
				label: "连接轨道"
			}, () => SessionRailOverlay({
				client: stableClient,
				sessions: stableSessions,
				prefs
			})));
			ctx.slots.inject("sidebar.session.row.leading", () => ctx.slots.register({
				name: "sidebar.session.row.leading",
				id: "connection-row-marker",
				order: 100
			}, (props) => {
				const sessionId = props?.sessionId;
				return sessionId ? SessionRowMarker({ sessionId }) : null;
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map