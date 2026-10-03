window.__ModuleLoader__.load({
	id: "@noob-stupid/dsh-connection-card-host",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		react_jsx_runtime = __toESM(react_jsx_runtime, 1);
		let react_dom = require("react-dom");
		react_dom = __toESM(react_dom, 1);
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
		//#region src/ui/overlay-host.ts
		/**
		* overlay-host — 插件自绘覆盖层的共用宿主。
		*
		* ## 为什么需要它
		*
		* **`z-index` 只在同一个堆叠上下文（stacking context）里可比。**
		* 插件的槽位（`shell.overlay`、`conversation.input.left` 等）各自渲染在
		* DSH 不同的容器里 —— 容器不同就是堆叠上下文不同，于是：
		*
		*   · 别人（皮肤/叠加层）只要把**自己那个容器**排在我们容器之上，
		*     我们无论把**元素自身**的 z-index 抬到多高都赢不了：比的是"容器 vs 容器"；
		*   · 而皮肤若用了 `transform` / `filter` / `will-change`，还会造出新的堆叠上下文，
		*     任何 z-index 都可能失效。
		*
		* 实测现场：装 `web-ui-skin-center` 时"看不见线"，关掉就正常 ——
		* 轨道线与拖拽线**各自都栽过一次**，症状一模一样。
		*
		* ## 做法
		*
		* 建一个宿主 `div`，**追加为 `document.body` 的最后一个子节点**：
		*
		*   · 挂在 `body` 上 → 堆叠直接相对 body，**与"哪个槽位容器在上面"彻底解耦**；
		*   · **排在最后** → 同层级下后者胜。若应用根节点自身建立了堆叠上下文或带 z-index，
		*     **先挂上去的 body 子节点仍会被它盖住** —— 所以"排在它后面"与"高 z-index"一样重要；
		*   · 接近上限的 z-index（留出调试余量）。
		*
		* 宿主与其中的内容都应由调用方设 `pointer-events: none`，以免挡住交互。
		*
		* ## 层次约定
		*
		* 共用**一个**宿主（避免多个宿主之间又要比层级），层内用 z-index 排：
		*
		*   · 轨道线   `z-index: 9998`（在会话列表区域）
		*   · 拖拽线   `z-index: 9999`（全程跟随指针，应在最上）
		*
		* ⚠️ 这与"弹窗必须最上层"是同一类问题：宿主在 body 层级，
		* 将来若有全屏模态，这两条线会画在它上面。当前靠 `pointer-events: none`
		* 保证不挡交互。要收的话，判据见 README 的「已知未做」。
		*/
		const HOST_CLASS = "ccr-overlay-host";
		/** 宿主自身的层级 —— 接近 32 位上限但留了余量。 */
		const HOST_Z = 2147483e3;
		let host = null;
		/**
		* 取（必要时创建）共用宿主。
		*
		* 宿主**在文档生命周期内常驻**，不随单个组件卸载而移除 ——
		* 因为两条线可能交替挂载/卸载，反复增删宿主会让"最后一个子节点"这个
		* 关键性质变得不稳定。它没有事件监听、没有状态，留着无成本。
		*/
		function getOverlayHost() {
			if (typeof document === "undefined") return null;
			if (host && host.isConnected) return host;
			const el = document.createElement("div");
			el.className = HOST_CLASS;
			el.style.cssText = `position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:${HOST_Z};`;
			document.body.appendChild(el);
			host = el;
			return host;
		}
		/**
		* 显示一条**短暂的操作提示**（2.6 秒后自动消失）。
		*
		* ## 为什么需要它（现场诊断逼出来的）
		*
		* 用户从锚点拖出一条线、松手时**没命中任何会话行**（例如松在连接面板上）——
		* 旧的实现只是 `clearHighlight()`，**屏幕上什么都不发生** ✗。
		* 用户于是问"那个新插件还没搞好吗" ✗ —— 他把"**没有反馈**"读成了"**功能坏了**"。
		*
		* 这就是"沉默的失败"最典型的代价：**功能是对的，但用户不知道它是对的**。
		*
		* ## 文案规范（与对端对齐的同一套）
		*
		* **第一句先答"我该做什么"**，并且要让用户**一眼看出"这不是坏了"** ——
		* 所以统一用「**操作没生效**」开头 + 随后的指令，而不是先解释机制。
		*
		* ## 合并连续相同提示
		*
		* 同一句话在短时间内反复触发（用户连拖几次）⇒ **复用同一条**，不叠加、不闪弹幕。
		* 成本极低，但不做的话连拖三次就能把屏幕刷满。
		*/
		let lastHint = null;
		function flashHint(text, ms = 2600) {
			const host = getOverlayHost();
			if (!host) return;
			const now = Date.now();
			/** 2.5 秒内的**同一句**提示：复用现有那条（刷新计时），不再新建。 */
			if (lastHint && lastHint.text === text && now - lastHint.at < ms) {
				lastHint.at = now;
				return;
			}
			const tip = document.createElement("div");
			tip.className = "ccr-hint";
			tip.textContent = text;
			tip.style.cssText = "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);pointer-events:none;padding:8px 14px;border-radius:8px;font-size:12px;background:rgba(20,20,20,.86);color:#fff;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.28);white-space:nowrap;";
			host.appendChild(tip);
			lastHint = {
				el: tip,
				text,
				at: now
			};
			window.setTimeout(() => {
				try {
					tip.remove();
				} catch {}
				if (lastHint?.el === tip) lastHint = null;
			}, ms);
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
			const svg = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
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
			const host = getOverlayHost();
			return host ? (0, react_dom.createPortal)(svg, host) : svg;
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
			/** 读取卡片的**客户端制品源码**（面板据此捕获插件的 UI）。 */
			readCardClientSource: "cards/clientSource",
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
			/** 清空某条连接的交流记录（连接本身不动）。 */
			clearMessages: "messages/clear",
			/**
			* 调试用：直接往某个会话投递一段文本（验证「A 说话 B 能感知」的最后一跳）。
			* 目标会话必须有 live agent，否则返回失败原因。
			*/
			debugDeliver: "debug/deliver",
			/** 会话桥的能力探测结果。 */
			relayCapabilities: "relay/capabilities",
			/** 改已装载卡片的可见范围（两端 / 仅 A / 仅 B）。 */
			setCardScope: "cards/set-scope",
			/** 安装一张卡片（本地目录 / tgz / npm 包名 / HTTP tgz）。 */
			installCard: "cards/install",
			/** 卸载一张已安装的卡片。 */
			uninstallCard: "cards/uninstall",
			/** 已安装卡片的根目录（面板显示，让"装到哪儿"透明）。 */
			cardsRoot: "cards/root",
			/** 某连接上、**对某一端可见**的卡片工具（卡片给会话提供的能力）。 */
			listCardTools: "cards/tools",
			/** 调用某张卡片的工具（**带可见范围校验**）。 */
			callCardTool: "cards/call",
			/** 检查某张已安装卡片有没有更新（判断不了时带 reason，**不谎报"已是最新"**）。 */
			checkCardUpdate: "cards/check-update",
			/** 按记录的来源更新一张卡片（装载中也能更新，靠版本化目录）。 */
			updateCard: "cards/update",
			/** 某条连接两端的工作状态快照。 */
			connectionWork: "awareness/work",
			/** 中继运行诊断（被挡下的非真人来源计数）—— 可查询，不靠翻日志。 */
			relayDiagnostics: "awareness/diagnostics",
			/** 列出某条连接的共享约定。 */
			listConventions: "conventions/list",
			/** 声明一条约定（用户在面板里手填）。 */
			declareConvention: "conventions/declare",
			/** 删除一条约定。 */
			removeConvention: "conventions/remove",
			/** 渲染公约盒文本（调试/预览用）。 */
			renderConventions: "conventions/render"
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
		//#region src/ui/capture-client.ts
		/** 捕获 factory：临时换掉 __ModuleLoader__，执行源码，然后还原。 */
		function captureFactory(source, target = globalThis) {
			const previous = target.__ModuleLoader__;
			let captured;
			target.__ModuleLoader__ = { load(entry) {
				const e = entry;
				if (!e || typeof e.factory !== "function") throw new Error("客户端制品调用了 __ModuleLoader__.load，但没给出 factory 函数");
				captured = {
					id: String(e.id ?? "(未命名)"),
					factory: e.factory
				};
			} };
			try {
				new Function("window", "globalThis", source)(target, target);
			} finally {
				if (previous === void 0) delete target.__ModuleLoader__;
				else target.__ModuleLoader__ = previous;
			}
			if (!captured) throw new Error("这段源码没有调用 __ModuleLoader__.load —— 它可能不是 DSH 的客户端制品（官方约定：浏览器制品必须注册一个 id 等于包名的懒工厂）。");
			return captured;
		}
		/**
		* 用影子 client ctx 实例化捕获到的 factory。
		*
		* @param require 浏览器模块表（**用我们自己的** —— 保证 React 等是同一个实例）
		* @param onWarn 拿不到的服务等情况的说明（走审计/诊断，不静默）
		*/
		function instantiateCaptured(captured, require, onWarn = () => {}) {
			const registrations = [];
			const disposers = [];
			const warnings = [];
			const warn = (m) => {
				warnings.push(m);
				onWarn(m);
			};
			const slots = {
				/** 官方语义：`inject(name, cb)` 在服务可用时立刻执行 cb，并采用其返回值作为清理。 */
				inject(name, cb) {
					const result = cb();
					/**
					* ⚠️ 去重：`register()` 自己也返回 disposer，而官方写法里
					* `inject(name, () => register(...))` 会把这个返回值当清理 ——
					* 于是同一个函数被记两次，清理时执行两遍（`disposeCaptured` 逆序跑）。
					* 记一次就够。
					*/
					if (typeof result === "function" && !disposers.some((d) => d.fn === result)) disposers.push({
						label: `slots.inject(${name})`,
						fn: result
					});
				},
				/** `register({ name, id, … }, Component)` —— 捕获，不真的注册到 DSH 槽位。 */
				register(spec, component) {
					const s = spec ?? {};
					const slot = typeof s.name === "string" ? s.name : "";
					if (!slot) throw new Error("ctx.slots.register 缺少 name");
					if (typeof component !== "function" && typeof component !== "object") throw new Error(`ctx.slots.register(${slot}) 的组件不是函数/对象`);
					const reg = {
						slot,
						...typeof s.id === "string" ? { id: s.id } : {},
						component
					};
					registrations.push(reg);
					return () => {
						const i = registrations.indexOf(reg);
						if (i >= 0) registrations.splice(i, 1);
					};
				}
			};
			const effect = (cb, label) => {
				const result = cb();
				if (typeof result === "function") disposers.push({
					label: label ?? "(未命名 effect)",
					fn: result
				});
			};
			/**
			* 影子 ctx 提供的服务。
			*
			* ⚠️ `get` 是**必须**的：生态里的 UI 插件普遍这么拿服务
			* （实测 `dsh-client-ui-voice` 全文只有一处依赖：`ctx.get('slots')`）。
			* 而 cordis 的 `get` 契约是**未知服务返回 undefined**（插件自己判空，例如
			* `if (slots === undefined) return`）—— 所以这里返回 undefined 是**符合契约**，
			* 不是"静默降级"：真正的护栏是下面的 `ctx.<name>` 直接访问（那条会抛错）。
			*/
			const services = {
				slots,
				effect
			};
			services.get = (name) => typeof name === "string" && name in services ? services[name] : void 0;
			const seenMisses = /* @__PURE__ */ new Set();
			const ctx = new Proxy({}, {
				get(_t, prop) {
					if (typeof prop === "symbol") return void 0;
					if (prop === "then" || prop === "toJSON" || prop === "constructor") return void 0;
					if (prop === "toString" || prop === "valueOf") return () => "[shadow-client-ctx]";
					if (prop in services) return services[prop];
					/**
					* ⚠️ 明确失败，但**记一次警告**：客户端插件的依赖面比宿主侧杂
					* （locale / store / theme…），我们要能在日志里看清"它想要什么"，
					* 而不是只看到一句异常。
					*/
					const m = `客户端插件访问了未提供的能力「${String(prop)}」`;
					if (!seenMisses.has(m)) {
						seenMisses.add(m);
						warn(m);
					}
					throw new Error(`${m} —— 适配层目前只提供 slots 与 effect。若该插件的 UI 依赖它，请在卡片清单里说明，或让它的 UI 保持纯渲染。`);
				},
				set() {
					throw new Error("影子 client ctx 是只读的");
				}
			});
			let plugin;
			try {
				plugin = captured.factory(require);
			} catch (e) {
				throw new Error(`调用客户端 factory 失败：${e instanceof Error ? e.message : String(e)}`);
			}
			if (!plugin || typeof plugin.apply !== "function") throw new Error(`客户端 factory 没有返回 { apply } —— 它的 id 是「${captured.id}」`);
			const missing = (Array.isArray(plugin.inject) ? plugin.inject.map(String) : []).filter((i) => i !== "slots" && i !== "effect");
			if (missing.length > 0) warn(`客户端插件声明了 [${missing.join(", ")}]，适配层只提供 slots / effect（外加可转交的宿主服务）。真正访问到没有的那个时才会失败。`);
			plugin.apply(ctx);
			return {
				registrations,
				disposers,
				warnings
			};
		}
		/** 执行全部清理（逆序）。 */
		function disposeCaptured(shadow) {
			for (const d of [...shadow.disposers].reverse()) try {
				d.fn();
			} catch {}
			shadow.disposers = [];
			shadow.registrations = [];
		}
		//#endregion
		//#region src/ui/CapturedCardUi.tsx
		/**
		* 把**适配卡插件自带的 UI** 渲染进我们的面板（而不是 DSH 全局界面）。
		*
		* ## 它怎么拿到 UI
		*
		*   1. 经 RPC 取卡片的客户端制品**源码**（宿主读文件，浏览器只拿文本）
		*   2. `captureFactory()`：临时换掉 `__ModuleLoader__`、执行源码、拿 `{ id, factory }`，**立刻还原**
		*   3. `instantiateCaptured()`：用**我们自己的 React** 调 factory，给它影子 client ctx，
		*      把它的槽位注册**捕获**下来（不注册进 DSH 的全局槽位）
		*   4. 在这里把捕获到的组件渲染出来
		*
		* ## 两个刻意的设计
		*
		* ### `require` 用我们自己的模块，不转交 DSH 的模块表
		*
		* 插件 factory 里 `require('react')` 必须拿到**同一个 React 实例**，否则 hooks 会炸。
		* 我们自己就是 DSH 的客户端插件 —— 我们 `import` 到的 React 与 DSH 交给我们的
		* 是同一份。所以只转交我们确实有的那几个（react / react/jsx-runtime / react-dom），
		* 别的**明确拒绝**并说清，而不是给个假对象让它跑到一半崩。
		*
		* ### 出错边界（ErrorBoundary）
		*
		* 渲染的是**第三方代码**。它抛错不能让整个面板白屏 —— 所以每个卡片外面包一层边界，
		* 只把这张卡片的 UI 换成一句错误说明（并记审计），面板其余部分照常。
		*/
		/**
		* 交给第三方 factory 的 `require`。
		*
		* ⚠️ 只转交我们**确实持有**的模块；未知说明符**抛错**（说清我们有什么）——
		* 给假对象会让它在更远的地方崩，那时更难查。
		*/
		function makeMiniRequire() {
			const table = {
				react,
				"react/jsx-runtime": react_jsx_runtime,
				"react-dom": react_dom,
				/**
				* `react-dom/client` 也要给：实测生态里的 UI 插件（`@linxin666/dsh-pet`、
				* `dsh-usage` 等）都会 require 它（`createRoot`）。而且它们**只** require
				* React 三件套 —— 其余 DSH 能力全走 ctx 服务。所以"转交 React"这一件事特别关键。
				*/
				"react-dom/client": react_dom
			};
			return (spec) => {
				if (spec in table) return table[spec];
				throw new Error(`客户端插件 require('${spec}')：适配层只转交 react / react/jsx-runtime / react-dom / react-dom/client。（转交别的会拿到假对象，跑起来只会更难查）`);
			};
		}
		/** 出错边界：第三方 UI 抛错不该带走整个面板。 */
		var CapturedErrorBoundary = class extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(e) {
				return { error: e instanceof Error ? e.message : String(e) };
			}
			componentDidCatch(e) {
				this.props.onError(`${this.props.label} 渲染失败：${e instanceof Error ? e.message : String(e)}`);
			}
			render() {
				if (this.state.error) return (0, react.createElement)("div", { className: "ccr-captured__error" }, `这张卡片的 UI 渲染失败：${this.state.error}`);
				return this.props.children;
			}
		};
		/**
		* 渲染一张适配卡的 UI（捕获后）。
		*
		* 拿不到 UI 时**安静地不渲染**（纯能力型插件本来就没有 UI）——
		* 但"声明了却没有文件"这类矛盾会显示出来，因为那是需要人看一眼的。
		*/
		function CapturedCardUi({ client, instanceId, label, onDiagnostic }) {
			const [regs, setRegs] = (0, react.useState)(null);
			const [note, setNote] = (0, react.useState)(null);
			const shadowRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				let alive = true;
				const diag = (m) => onDiagnostic?.(`[ui-capture] ${m}`);
				(async () => {
					try {
						const artifact = await client.readCardClientSource(instanceId);
						if (!alive) return;
						if (!artifact.ok || !artifact.source) {
							if (artifact.reason && /声明了 dsh\.client/.test(artifact.reason)) setNote(artifact.reason);
							else diag(`${instanceId}：${artifact.reason ?? "没有客户端制品"}`);
							return;
						}
						const captured = captureFactory(artifact.source);
						const shadow = instantiateCaptured(captured, makeMiniRequire(), diag);
						if (!alive) {
							disposeCaptured(shadow);
							return;
						}
						shadowRef.current = shadow;
						diag(`${instanceId}：捕获到 ${shadow.registrations.length} 条槽位注册（来源 ${captured.id}）`);
						setRegs(shadow.registrations);
					} catch (e) {
						if (!alive) return;
						setNote(e instanceof Error ? e.message : String(e));
						diag(`${instanceId}：UI 捕获失败 —— ${e instanceof Error ? e.message : String(e)}`);
					}
				})();
				return () => {
					alive = false;
					if (shadowRef.current) {
						disposeCaptured(shadowRef.current);
						shadowRef.current = null;
					}
				};
			}, [
				client,
				instanceId,
				onDiagnostic
			]);
			if (note) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "ccr-captured__note",
				children: `${label}：${note}`
			});
			if (!regs || regs.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "ccr-captured",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "ccr-captured__head",
					children: label
				}), regs.map((reg, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CapturedErrorBoundary, {
					label: `${label}（槽位 ${reg.slot}）`,
					onError: (m) => onDiagnostic?.(`[ui-capture] ${m}`),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-captured__slot",
						children: reg.slot
					}), (0, react.createElement)(reg.component, {})]
				}, `${reg.slot}-${reg.id ?? i}`))]
			});
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
		/**
		* 卡片可见范围。
		*
		* 「两端通用」= 这条连接上的两端都能收到它的事件、都能看到它的面板；
		* 「仅 A / 仅 B」= 只挂在某一端（另一端连它的存在都感知不到）。
		* 这正是用户要的「卡片是两端共享的，或者可以只给一端」。
		*/
		const SCOPE_CHOICES = [
			{
				value: "both",
				label: "两端",
				hint: "连接的两端都能收到这张卡片的事件与面板"
			},
			{
				value: "a",
				label: "仅 A",
				hint: "只挂在 A 端（B 端感知不到这张卡片）"
			},
			{
				value: "b",
				label: "仅 B",
				hint: "只挂在 B 端（A 端感知不到这张卡片）"
			}
		];
		function CardStack({ connection, client, onChanged }) {
			const [templates, setTemplates] = (0, react.useState)([]);
			const [panels, setPanels] = (0, react.useState)({});
			/**
			* 卡片更新状态：templateId → 检查结论。
			*
			* **`hasUpdate` 与 `reason` 要分开呈现** —— "无法检查"和"已是最新"是两回事，
			* 混在一起就是谎报（"检查更新"按钮点了却什么也没查，却显示"已是最新"）。
			*/
			const [upd, setUpd] = (0, react.useState)({});
			const [updBusy, setUpdBusy] = (0, react.useState)(null);
			/** 卸载进行中的模板 id（与 updBusy 分开：两个入口可以同时在跑，不要互相盖掉）。 */
			const [unBusy, setUnBusy] = (0, react.useState)(null);
			/**
			* 哪些卡片实例的面板是展开的。
			*
			* **默认全部收起** —— 卡片面板是卡片自己渲染的 HTML，高度不可控，
			* 几张一起展开会把卡片区顶得很长（用户截图反馈"太占地方"）。
			* 收起时卡片名/可见范围/重载/移除照常显示，操作入口不藏。
			*/
			const [expandedCards, setExpandedCards] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [picking, setPicking] = (0, react.useState)(false);
			/** 加卡时选的可见范围（只作用于"下一次添加"）。 */
			const [scope, setScope] = (0, react.useState)("both");
			/** 安装：来源输入、进行中标志、回执/错误文本、已安装卡片根目录。 */
			const [spec, setSpec] = (0, react.useState)("");
			const [installing, setInstalling] = (0, react.useState)(false);
			const [installMsg, setInstallMsg] = (0, react.useState)(null);
			const [root, setRoot] = (0, react.useState)("");
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
			(0, react.useEffect)(() => {
				if (!client) return;
				client.cardsRoot().then((r) => setRoot(r)).catch(() => {});
			}, [client]);
			const add = (0, react.useCallback)(async (templateId) => {
				if (!client) return;
				setBusy(templateId);
				try {
					await client.loadCard(templateId, connection.id, scope);
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
				scope,
				load,
				onChanged
			]);
			/** 装一张卡片到我们自己的目录，然后重扫模板。 */
			/**
			* 检查某张已安装卡片有没有更新。
			*
			* 结论**原样保留 `reason`** —— 面板会区分"有更新 / 已是最新 / 无法检查"三态。
			*/
			/**
			* **卸载一张已安装的卡片**（用户报的缺口：能力一直在，入口没给 ✗）。
			*
			* 三条都要做到（缺一条就是"半吊子入口" ✗）：
			*   ① 调既有 RPC ✓（不新增通道）
			*   ② 结果**如实回报** —— 宿主侧文案会说清"清了什么 / 什么被占用没清掉" ✓
			*   ③ **卸载后立刻刷新列表** ✓ —— 否则用户会对着已经删掉的项再点一次 ✗
			*      （这一步容易被漏：RPC 成功 ≠ 界面更新 ✓）
			*/
			const doUninstall = (0, react.useCallback)(async (templateId) => {
				if (!client) return;
				setUnBusy(templateId);
				setInstallMsg(null);
				try {
					const r = await client.uninstallCard(templateId);
					setInstallMsg(r.ok ? r.reason ?? `已卸载「${templateId}」✓` : `卸载失败：${r.reason ?? "未说明"}`);
					/** ③ 无论成败都刷新：成功的要消失 ✓；失败的也可能已经部分清掉 ✓。 */
					await load();
				} catch (e) {
					setInstallMsg(`卸载出错：${e instanceof Error ? e.message : String(e)}`);
				} finally {
					setUnBusy(null);
				}
			}, [client, load]);
			const doCheckUpdate = (0, react.useCallback)(async (templateId) => {
				if (!client) return;
				setUpdBusy(templateId);
				try {
					const r = await client.checkCardUpdate(templateId);
					setUpd((prev) => ({
						...prev,
						[templateId]: r
					}));
					if (r.reason) setInstallMsg(`检查更新：${r.reason}`);
				} catch (e) {
					setUpd((prev) => ({
						...prev,
						[templateId]: { reason: e instanceof Error ? e.message : String(e) }
					}));
				} finally {
					setUpdBusy(null);
				}
			}, [client]);
			/**
			* 更新一张已安装卡片：照着**记录的来源**重装，并让已装载的实例重载。
			*
			* 装载中也能更新，靠的是版本化目录（新版本写新目录，不碰被锁的旧目录）。
			*/
			const doUpdate = (0, react.useCallback)(async (templateId) => {
				if (!client) return;
				setUpdBusy(templateId);
				setInstallMsg(null);
				try {
					const r = await client.updateCard(templateId);
					if (r.ok) {
						setInstallMsg(`已更新：v${r.version ?? "?"}${r.reloaded ? `（重载 ${r.reloaded} 个实例）` : ""}`);
						setUpd((prev) => ({
							...prev,
							[templateId]: {}
						}));
						await load();
					} else setInstallMsg(`更新失败：${r.reason ?? "未知原因"}`);
				} catch (e) {
					setInstallMsg(e instanceof Error ? e.message : String(e));
				} finally {
					setUpdBusy(null);
				}
			}, [client, load]);
			const doInstall = (0, react.useCallback)(async () => {
				if (!client) return;
				const s = spec.trim();
				if (s.length === 0) return;
				setInstalling(true);
				setInstallMsg(null);
				try {
					const r = await client.installCard(s);
					if (r.ok) {
						setInstallMsg(`已安装：${r.name ?? r.cardId}${r.version ? ` v${r.version}` : ""}`);
						setSpec("");
						await load();
					} else setInstallMsg(`安装失败：${r.reason ?? "未知原因"}`);
				} catch (e) {
					setInstallMsg(e instanceof Error ? e.message : String(e));
				} finally {
					setInstalling(false);
				}
			}, [
				client,
				spec,
				load
			]);
			/** 改一张已装载卡片的可见范围。 */ const changeScope = (0, react.useCallback)(async (instanceId, next) => {
				if (!client) return;
				setBusy(instanceId);
				try {
					await client.setCardScope(instanceId, next);
					await load();
				} catch (e) {
					setError(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(null);
				}
			}, [client, load]);
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
			/**
			* 整个「卡片」区域的收起/展开。
			*
			* **保留原来那一行的样式**，只在「卡片」两个字右侧加一个小三角：
			*   收起 = 只剩这一行（卡片 ▸ 3                  + 添加卡片）
			*   展开 = 下面列出全部卡片
			*
			* 逐张卡片的面板各由**卡片自己那行的 ▸** 控制（`expandedCards`）。
			* **不做"全部展开"这种批量开关** —— 用户明确要求去掉：
			* 卡片本来就不多，两层"展开"并排反而读不出谁管谁。
			*/
			const [sectionOpen, setSectionOpen] = (0, react.useState)(true);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `ccr-cards${sectionOpen ? "" : " ccr-cards--folded"}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "ccr-cards__head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "ccr-cards__toggle",
							title: sectionOpen ? "收起卡片区" : "展开卡片区",
							onClick: () => setSectionOpen((v) => !v),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ccr-field__label",
								children: "卡片"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ccr-cards__tri",
								children: sectionOpen ? "▾" : "▸"
							})]
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
				}), sectionOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-error",
						children: error
					}),
					picking && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ccr-cards__picker",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ccr-scope-pick",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ccr-scope-pick__label",
									children: "加到"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "ccr-seg ccr-seg--small",
									children: SCOPE_CHOICES.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: `ccr-seg__item${scope === s.value ? " ccr-seg__item--active" : ""}`,
										title: s.hint,
										onClick: () => setScope(s.value),
										children: s.label
									}, s.value))
								})]
							}),
							available.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ccr-panel__empty",
								children: templates.length === 0 ? "没有发现任何卡片模板" : "所有卡片都已添加"
							}),
							"          ",
							available.map((t) => {
								const ad = t.adapter;
								const blocked = Boolean(ad && ad.status !== "ready");
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: `ccr-card-option${blocked ? " ccr-card-option--blocked" : ""}`,
									disabled: busy === t.templateId || blocked,
									title: ad ? ad.reason : void 0,
									onClick: () => {
										if (blocked) return;
										add(t.templateId);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "ccr-card-option__name",
											children: [
												t.name,
												ad && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "ccr-badge ccr-badge--adapter",
													children: "适配"
												}),
												t.suitability && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `ccr-badge ccr-badge--scope${t.suitability.scope === "global" ? " ccr-badge--warn" : ""}`,
													title: t.suitability.why,
													children: t.suitability.scope === "capability" ? "能力" : t.suitability.scope === "local" ? "局部" : t.suitability.scope === "global" ? "全局" : "未判定"
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "ccr-card-option__meta",
											children: [
												t.source === "builtin" ? "内置" : "已安装",
												" · v",
												t.version,
												t.events.length > 0 && ` · ${t.events.length} 事件`,
												t.suitability?.scope === "global" && " · 全局 UI，不建议当卡片",
												t.suitability?.scope === "unclear" && " · 作用域未判定",
												t.scope && ` · 固定仅${t.scope === "a" ? "A" : "B"}端`,
												ad && ad.capabilities.length > 0 && ` · 能力 ${ad.capabilities.join("/")}`,
												ad?.status === "off" && " · 需开启适配层",
												ad?.status === "unsupported" && " · 本版本不支持"
											]
										}),
										t.source === "installed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ccr-card-option__upd",
											onClick: (e) => {
												e.stopPropagation();
												if (upd[t.templateId]?.hasUpdate) doUpdate(t.templateId);
												else doCheckUpdate(t.templateId);
											},
											children: updBusy === t.templateId ? "…" : upd[t.templateId]?.hasUpdate ? `↑ 更新到 ${upd[t.templateId]?.latestVersion ?? "新版"}` : upd[t.templateId]?.reason ? "无法检查" : upd[t.templateId] ? "已是最新" : "检查更新"
										}),
										t.source === "installed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ccr-card-option__upd ccr-card-option__del",
											onClick: (e) => {
												e.stopPropagation();
												const mounted = t.loadedCount > 0 ? `\n它当前挂在 ${t.loadedCount} 条连接上，` : "\n";
												if (window.confirm(`卸载「${t.name}」？${mounted}卸载会连同它的卡片实例一起移除。\n（模板目录与来源记录会一并清掉；清不掉的会如实告诉你。）`)) doUninstall(t.templateId);
											},
											children: unBusy === t.templateId ? "…" : "卸载"
										})
									]
								}, t.templateId);
							})
						]
					}),
					picking && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ccr-install",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ccr-install__row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "ccr-input",
								placeholder: "包名 / 仓库 tgz 地址 / 本地目录路径",
								value: spec,
								onChange: (e) => setSpec(e.target.value),
								onKeyDown: (e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										doInstall();
									}
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "ccr-btn",
								disabled: installing || spec.trim().length === 0,
								onClick: () => void doInstall(),
								children: installing ? "安装中…" : "安装"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ccr-field__hint",
							children: installMsg ?? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								"支持 npm 包名、tgz 地址、本地目录。装到 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: root || "…" }),
								"，",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "不写入 DSH 的 profile" }),
								"，所以不会影响 DSH 本身、也不会被它的更新破坏。"
							] })
						})]
					}),
					cards.length === 0 && !picking && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-panel__empty",
						children: "这条连接还没有卡片"
					}),
					cards.map((card) => {
						const template = templates.find((t) => t.templateId === card.templateId);
						const html = panels[card.instanceId] ?? null;
						const expanded = expandedCards[card.instanceId] === true;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ccr-card",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ccr-card__head",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "ccr-card__toggle",
										title: expanded ? "收起" : "展开面板",
										disabled: !html,
										onClick: () => setExpandedCards((prev) => ({
											...prev,
											[card.instanceId]: !expanded
										})),
										children: html ? expanded ? "▾" : "▸" : "·"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-dot",
										style: { background: HEALTH_COLOR$1[connection.health] ?? "#10B981" }
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-card__name",
										children: template?.name ?? card.templateId
									}),
									template?.scope ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "ccr-card__scope-fixed",
										title: "模板固定了这一端，不可更改",
										children: [
											"仅",
											template.scope === "a" ? "A" : "B",
											"端"
										]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "ccr-seg ccr-seg--small ccr-card__scope",
										children: SCOPE_CHOICES.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: `ccr-seg__item${(card.scope ?? "both") === s.value ? " ccr-seg__item--active" : ""}`,
											disabled: busy === card.instanceId,
											title: s.hint,
											onClick: () => void changeScope(card.instanceId, s.value),
											children: s.label
										}, s.value))
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
							}), html && expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ccr-card__panel",
								dangerouslySetInnerHTML: { __html: html }
							})]
						}, card.instanceId);
					})
				] })]
			});
		}
		//#endregion
		//#region src/ui/AwarenessPanel.tsx
		/**
		* AwarenessPanel —— 一条连接上的「协作感知」区块。
		*
		* 两块内容，对应两层：
		*
		*   A. 工作状态 —— **自动采集**：两边各自在改什么文件、计划进行到哪一步。
		*      只读。这是「我知道你在干什么」。
		*
		*   B. 公约盒   —— **显式声明**：双方说好了什么（接口、坐标、单位、命名、分工）。
		*      可增可删。这是「我们说好了什么」。
		*
		* ## 两块默认收起
		*
		* 用户反馈两块都摊开「看着面板太杂了，根本不想仔细看」。
		* 所以默认折叠 —— 但**标题行始终显示一行摘要**（谁在干什么 / 有几条约定、
		* 都是什么主题），不展开也能拿到要点，展开才看细节。
		* 展开状态存进视图偏好，跨会话保持。
		*/
		/** 工作状态的新鲜度：多久没更新就算"停下来了"。 */
		const STALE_MS = 3 * 6e4;
		function ago(ts) {
			if (!ts) return "未知";
			const s = Math.round((Date.now() - ts) / 1e3);
			if (s < 60) return `${s} 秒前`;
			if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
			return `${Math.round(s / 3600)} 小时前`;
		}
		function shortPath(p) {
			return p.replace(/\\/g, "/").split("/").slice(-2).join("/");
		}
		/** 收起状态下的一行摘要：谁在干什么。 */
		function workDigest(work, labelA, labelB) {
			const parts = [];
			for (const [label, st] of [[labelA, work.a], [labelB, work.b]]) if (st && st.updatedAt > 0) {
				const stale = Date.now() - st.updatedAt > STALE_MS;
				parts.push(`${label} ${st.lastAction || "空闲"}${stale ? "（久未更新）" : ""}`);
			} else parts.push(`${label} 未采集`);
			return parts.join(" · ");
		}
		/** 收起状态下的一行摘要：有几条约定、都是什么主题。 */
		function boxDigest(conventions) {
			if (conventions.length === 0) return "还没有约定";
			const topics = Array.from(new Set(conventions.map((c) => c.topic))).slice(0, 4);
			return `${conventions.length} 条 · ${topics.join("、")}`;
		}
		function AwarenessPanel({ client, connection, labelA, labelB, prefs, onNotice }) {
			const [work, setWork] = (0, react.useState)({
				a: null,
				b: null
			});
			const [conventions, setConventions] = (0, react.useState)([]);
			const [draft, setDraft] = (0, react.useState)("");
			const [topic, setTopic] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			/** 中继诊断：被挡下的非真人来源计数（可查询，不怕日志滚动）。 */
			const [diagnostics, setDiagnostics] = (0, react.useState)([]);
			const [open, setOpen] = (0, react.useState)(() => ({
				work: prefs.get().workOpen,
				box: prefs.get().boxOpen
			}));
			(0, react.useEffect)(() => prefs.subscribe(() => {
				const p = prefs.get();
				setOpen({
					work: p.workOpen,
					box: p.boxOpen
				});
			}), [prefs]);
			const toggle = (0, react.useCallback)((which) => {
				const p = prefs.get();
				prefs.set(which === "work" ? { workOpen: !p.workOpen } : { boxOpen: !p.boxOpen });
			}, [prefs]);
			const load = (0, react.useCallback)(async () => {
				if (!client) return;
				try {
					const [w, c] = await Promise.all([client.connectionWork(connection.id), client.listConventions(connection.id)]);
					setWork(w);
					setConventions(c);
					client.relayDiagnostics().then((d) => setDiagnostics(d.skipped)).catch(() => {});
				} catch {}
			}, [client, connection.id]);
			(0, react.useEffect)(() => {
				load();
				const period = open.work ? 3e3 : 8e3;
				const timer = window.setInterval(() => void load(), period);
				return () => window.clearInterval(timer);
			}, [load, open.work]);
			const declare = (0, react.useCallback)(async () => {
				if (!client) return;
				const text = draft.trim();
				if (text.length === 0) return;
				setBusy(true);
				try {
					const r = await client.declareConvention(connection.id, "user", topic.trim() || "一般", text);
					if (r.ok) {
						setDraft("");
						setTopic("");
						onNotice("已放入公约盒");
						await load();
					} else onNotice(`声明失败：${r.reason ?? "未知原因"}`);
				} catch (e) {
					onNotice(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(false);
				}
			}, [
				client,
				connection.id,
				draft,
				topic,
				load,
				onNotice
			]);
			const remove = (0, react.useCallback)(async (id) => {
				if (!client) return;
				try {
					await client.removeConvention(connection.id, id);
					await load();
				} catch (e) {
					onNotice(e instanceof Error ? e.message : String(e));
				}
			}, [
				client,
				connection.id,
				load,
				onNotice
			]);
			const someoneActive = [work.a, work.b].some((s) => s && s.updatedAt > 0 && Date.now() - s.updatedAt < STALE_MS);
			/**
			* 中继诊断：被挡下的非真人来源。
			*
			* 放这里而不是只写日志，是因为**日志会被清空/滚动** —— 只写一次的信号
			* 一旦滚掉就永久消失。可查询的东西不怕滚动。
			* （这条建议来自对端会话，同时补上"状态靠翻日志猜"这个缺口。）
			*/
			const skipped = diagnostics.filter((d) => d.sessionId === connection.sessionA || d.sessionId === connection.sessionB);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: `ccr-fold${open.work ? " ccr-fold--open" : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "ccr-fold__head",
					onClick: () => toggle("work"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ccr-fold__chevron",
							children: open.work ? "▾" : "▸"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ccr-fold__title",
							children: "对方在做什么"
						}),
						someoneActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ccr-fold__live",
							title: "对方正在活动"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ccr-fold__digest",
							title: workDigest(work, labelA, labelB),
							children: workDigest(work, labelA, labelB)
						})
					]
				}), open.work && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "ccr-fold__body",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ccr-work",
						children: [[
							"a",
							labelA,
							work.a,
							connection.sessionA
						], [
							"b",
							labelB,
							work.b,
							connection.sessionB
						]].map(([side, name, state, fullId]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ccr-work__row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ccr-work__head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ccr-work__name",
									title: fullId,
									children: name
								}), state && state.updatedAt > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `ccr-work__age${Date.now() - state.updatedAt > STALE_MS ? " ccr-work__age--stale" : ""}`,
									children: ago(state.updatedAt)
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ccr-work__age",
									children: "未采集"
								})]
							}), state && state.updatedAt > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "ccr-work__action",
									children: state.lastAction || "空闲"
								}),
								state.todos.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: "ccr-work__todos",
									children: state.todos.map((t, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: `ccr-work__todo ccr-work__todo--${t.status}`,
										title: t.content,
										children: [
											t.status === "completed" ? "✓" : t.status === "in_progress" ? "▶" : "·",
											" ",
											t.content
										]
									}, i))
								}),
								state.files.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "ccr-work__files",
									title: state.files.join("\n"),
									children: state.files.slice(0, 4).map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-work__file",
										children: shortPath(f)
									}, f))
								}),
								state.turn > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ccr-work__progress",
									children: [
										"第 ",
										state.turn,
										" 轮 · 第 ",
										state.step,
										" 步"
									]
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ccr-work__action ccr-work__action--empty",
								children: "还没采集到 —— 对方开始干活后这里会自动出现"
							})]
						}, side))
					}), skipped.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ccr-work__diag",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ccr-work__diag-head",
							title: "跨会话通道只放行真人发言；宿主通知（任务完成、模型切换等）一律挡下",
							children: ["已挡下非发言来源：", skipped.map((d) => ` ${d.kind}×${d.count}`).join(" · ")]
						}), skipped.slice(0, 2).map((d) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ccr-work__diag-item",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ccr-work__diag-kind",
									children: d.kind
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ccr-work__diag-preview",
									title: d.lastDropped,
									children: d.lastDropped || "(无内容)"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ccr-work__diag-age",
									children: ago(d.lastSeenAt)
								})
							]
						}, `${d.sessionId}:${d.kind}`))]
					})]
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: `ccr-fold${open.box ? " ccr-fold--open" : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "ccr-fold__head",
					onClick: () => toggle("box"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ccr-fold__chevron",
							children: open.box ? "▾" : "▸"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ccr-fold__title",
							children: "共享约定"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ccr-fold__digest",
							title: boxDigest(conventions),
							children: boxDigest(conventions)
						})
					]
				}), open.box && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "ccr-fold__body",
					children: [
						conventions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ccr-box__empty",
							children: "还没有约定。放「对方不知道就会做错的东西」——接口、坐标、单位、命名、分工边界。"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "ccr-box",
							children: conventions.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "ccr-box__item",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-box__topic",
										children: c.topic
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-box__text",
										children: c.text
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "ccr-box__who",
										title: c.by === "user" ? "你在面板里直接添加的" : c.by === "a" ? connection.sessionA : connection.sessionB,
										children: c.by === "user" ? "你" : c.by === "a" ? labelA : labelB
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "ccr-box__del",
										title: "删除这条约定",
										onClick: () => void remove(c.id),
										children: "×"
									})
								]
							}, c.id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ccr-box__add",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "ccr-input ccr-input--topic",
									placeholder: "分类",
									value: topic,
									onChange: (e) => setTopic(e.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "ccr-input",
									placeholder: "约定内容（对方不知道就会做错的事）",
									value: draft,
									onChange: (e) => setDraft(e.target.value),
									onKeyDown: (e) => {
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault();
											declare();
										}
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "ccr-btn",
									disabled: busy || draft.trim().length === 0,
									onClick: () => void declare(),
									children: "放入"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ccr-field__hint",
							children: [
								"约定",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "只存不发" }),
								"，不占对方上下文；参与连接的会话可用 connection_conventions 工具随时查到。"
							]
						})
					]
				})]
			})] });
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
			/**
			* **适配卡**的模板 id 集合 —— 只有这些卡片才有"插件自带 UI"可捕获。
			*
			* 取不到就当作空集：侧栏不显示，面板其余部分照常（UI 捕获是附加能力，
			* 不该因为一次列表请求失败而影响主流程）。
			*/
			const [adapterTemplates, setAdapterTemplates] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			(0, react.useEffect)(() => {
				if (!client) return;
				let alive = true;
				(async () => {
					try {
						const list = await client.listCardTemplates();
						if (!alive) return;
						setAdapterTemplates(new Set(list.filter((t) => t.adapter).map((t) => t.templateId)));
					} catch {}
				})();
				return () => {
					alive = false;
				};
			}, [client]);
			const { options: sessionOptions, labelOf, ready: sessionsReady } = useSessionList(sessions);
			/**
			* 新建连接用的会话槽位。
			* 默认两个；点中间的箭头可以加第三个 —— 三个会**两两相连**（3 条连接）。
			*/
			const [picks, setPicks] = (0, react.useState)(["", ""]);
			const [manual, setManual] = (0, react.useState)(false);
			const [expandedId, setExpandedId] = (0, react.useState)(null);
			/**
			* 侧栏要渲染的卡片：**只属于"当前展开的那条连接"** 的适配卡。
			*
			* ## ⚠️ 这里原先是**遍历所有连接** —— 用户报的行为缺陷（现场："固定位置呆着不动"）
			*
			* 用户原话：
			*
			* > 「应该展开对应的连接右侧才会展现，**而不是固定位置呆着不动** ——
			* >   因为如果有多个连接，**展开哪个右侧就显示哪个**。」
			*
			* 原来的写法把**所有连接**上挂的适配卡都收进来 ⇒
			*   ① 右侧**不跟随**展开态（看起来"钉在原地"✗）
			*   ② 多连接时**重复挂载 + 白渲染** ✗
			*   ③ 切换连接时旧组件**不卸载** ⇒ **Y 会看到 X 的组件状态** ✗（React 组件带 state）
			*
			* 现在：`expandedId` 决定一切 ✓ ——
			*   · 展开 X ⇒ 只收 X 的卡 ✓
			*   · 没展开任何连接（`null`）⇒ 列表为空 ⇒ 右侧**整个不渲染**（不残留上一条 ✗）
			*   · 从 X 切到 Y ⇒ 列表成员整体换掉 ⇒ React **卸载旧的、重挂新的** ✓
			*     （`key` 里带上连接 id ⇒ 即使两张卡的 `instanceId` 撞了也不会复用 X 的实例 ✓）
			*/
			const capturedCards = (0, react.useMemo)(() => {
				const out = [];
				if (!expandedId) return out;
				const conn = connections.find((c) => c.id === expandedId);
				if (!conn) return out;
				for (const card of conn.cards ?? []) {
					if (!adapterTemplates.has(card.templateId)) continue;
					out.push({
						/** **连接 id + 实例 id** 一起做 key：换连接 ⇒ 必然卸载重挂 ✓。 */
						key: `${conn.id}:${card.instanceId}`,
						instanceId: card.instanceId,
						label: `${card.templateId} · ${conn.id.slice(0, 8)}`
					});
				}
				return out;
			}, [
				connections,
				adapterTemplates,
				expandedId
			]);
			const [busy, setBusy] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)([]);
			/** 视图偏好（lane 上限），改完立刻广播给轨道 */
			const [prefsState, setPrefsState] = (0, react.useState)(() => prefs.get());
			(0, react.useEffect)(() => prefs.subscribe(() => setPrefsState(prefs.get())), [prefs]);
			/**
			* 中继**是否真的在自动转发**。
			*
			* ⚠️ 不能用权限档位判断 —— 两者在 2026-10-01 之后已解耦：
			* 自动转发默认关闭，权限只影响**显式发送**能发哪类消息。
			* 只看权限会让警告条喊狼来了（显示"正在互相转发"而实际什么都没转发）。
			*/
			const [relayOn, setRelayOn] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!client) return;
				let alive = true;
				const check = () => client.relayDiagnostics().then((d) => {
					if (alive) setRelayOn(d.relayConfig.relayAssistant || d.relayConfig.relayUser);
				}).catch(() => {});
				check();
				const timer = window.setInterval(check, 5e3);
				return () => {
					alive = false;
					window.clearInterval(timer);
				};
			}, [client]);
			const setPick = (0, react.useCallback)((index, value) => {
				setPicks((prev) => prev.map((v, i) => i === index ? value : v));
			}, []);
			/**
			* 一次性诊断：面板滚不动时，需要知道**到底是谁在裁**。
			*
			* 从面板根节点往上走，把每个祖先的 overflow / height 记下来。
			*
			* ⚠️ **两种坏形态都要报**（第二种是后补的，正是它漏掉过一次真实回归）：
			*
			*   ① 内容超出 + 自身不可滚 —— 直观的那种
			*   ② **自身比视口还高**（说明它"长高了"而不是在滚动）——
			*      这种 `scrollHeight == clientHeight`，旧诊断直接 return，**一声不吭**。
			*      实测踩到：给面板加了一层 flex 外层，`.ccr-page` 的 `height:100%` 落空 ⇒
			*      退化成 auto ⇒ 不再是滚动容器、内容把页面撑高 ⇒ 滚轮没反应且无日志。
			*/
			(0, react.useEffect)(() => {
				if (!client) return;
				const timer = window.setTimeout(() => {
					const root = document.querySelector(".ccr-page");
					if (!root) return;
					const selfOvf = window.getComputedStyle(root).overflowY;
					const selfScrollable = selfOvf === "auto" || selfOvf === "scroll";
					const overflowing = root.scrollHeight > root.clientHeight + 1;
					const tallerThanViewport = root.getBoundingClientRect().height > window.innerHeight + 8;
					if (!(overflowing && !selfScrollable || tallerThanViewport && !overflowing)) return;
					const chain = [];
					let el = root;
					for (let i = 0; el && i < 6; i++) {
						const cs = window.getComputedStyle(el);
						chain.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0] || "-"}[h=${cs.height} ovf=${cs.overflowY} pos=${cs.position}]`);
						el = el.parentElement;
					}
					client.report(`panel 滚不动（${tallerThanViewport && !overflowing ? "长高了没滚" : "内容超出不可滚"}）client=${root.clientHeight} scroll=${root.scrollHeight} box=${Math.round(root.getBoundingClientRect().height)} vh=${window.innerHeight} selfOvf=${selfOvf} :: ${chain.join(" <- ")}`);
				}, 1500);
				return () => window.clearTimeout(timer);
			}, [client]);
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
				className: "ccr-page-wrap",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								ready && relayOn && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ccr-forward-warn",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "ccr-forward-warn__dot" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										"中继正在",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "自动转发会话消息" }),
										"—— 你在任一端说的话都会送进另一端，并",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "让对方被唤醒去回应" }),
										"。 这是非默认行为，通常应该关掉。"
									] })]
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
																children: "消息转发权限（两个方向可分别设置）"
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
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DismissibleHint, {
																hintKey: `perm:${conn.id}`,
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																	className: "ccr-field__hint",
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "这个开关控制的是「允许发哪类消息」，不是「对方能不能干活」" }), "—— 对方任何时候都能自己做事，与这里无关。两个方向互不影响， 可以做成一端可写入、另一端只读。"]
																}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																	className: "ccr-field__hint",
																	children: [
																		"只读",
																		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "不影响感知" }),
																		"：工作状态与公约盒都是对端主动查询的， 与权限无关。降低权限立即生效；提高权限需要被授权的一方确认。"
																	]
																})]
															})
														]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardStack, {
														connection: conn,
														client,
														onChanged: refresh
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AwarenessPanel, {
														client,
														connection: conn,
														labelA: labelOf(conn.sessionA),
														labelB: labelOf(conn.sessionB),
														prefs,
														onNotice: flash
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
				}), client && capturedCards.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("aside", {
					className: "ccr-page__side",
					"aria-label": "卡片界面",
					children: capturedCards.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapturedCardUi, {
						client,
						instanceId: c.instanceId,
						label: c.label,
						onDiagnostic: (m) => {
							try {
								client.report(m);
							} catch {}
						}
					}, c.key))
				})]
			});
		}
		/**
		* 可关闭的说明块 —— 「教一次就够」的文案用它包起来。
		*
		* ## 为什么按 `hintKey` 记、存在 localStorage
		*
		* 用户的要求是：**关掉后不再显示，除非新建连接**。
		* 把 connectionId 编进键里，新建的连接 id 不同 → 查不到"已关闭"记录 → 自动重新显示。
		* 正好是这个语义，不需要额外的"新建连接时重置"逻辑。
		*
		* 存本地而不是存进连接数据：这是**这一台浏览器上的阅读偏好**，
		* 不是连接本身的属性 —— 没必要同步给对端，也没必要进持久化文件。
		*/
		function DismissibleHint({ hintKey, children }) {
			const storageKey = `ccr-hint-dismissed:${hintKey}`;
			const [dismissed, setDismissed] = (0, react.useState)(() => {
				try {
					return localStorage.getItem(storageKey) === "1";
				} catch {
					return false;
				}
			});
			if (dismissed) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ccr-dismissible",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "ccr-hint__close",
					title: "关闭后不再显示（新建连接时会重新出现）",
					onClick: () => {
						setDismissed(true);
						try {
							localStorage.setItem(storageKey, "1");
						} catch {}
					},
					children: "×"
				}), children]
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
		/** 元素的简短描述，用于诊断日志。 */
		function describeElement(el) {
			if (!el) return "null";
			const tag = el.tagName.toLowerCase();
			const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
			const role = el.getAttribute("role");
			return `${tag}${cls ? `.${cls}` : ""}${role ? `[role=${role}]` : ""}`;
		}
		/**
		* 栈里某一层的描述：元素 + **`pointer-events` 计算值** + 是否会话行。
		*
		* 为什么要 `pointer-events`：它是区分两种病因的关键判据 ——
		* `elementsFromPoint` **会跳过 `pointer-events: none` 的元素**，
		* 所以"栈里没有真实行"到底是"行不在那个位置"还是"行被关了指针事件"，
		* 不看这个值就只能猜。
		*/
		function describeStackLayer(el) {
			let pe = "?";
			try {
				pe = window.getComputedStyle(el).pointerEvents || "?";
			} catch {}
			const isRow = el.closest?.("[role=\"treeitem\"]") ? " ✓row" : "";
			return `${describeElement(el)}(pe=${pe}${isRow})`;
		}
		/**
		* 对一个**具体的行元素**解析会话 id —— 不要求它在全量映射表里。
		*
		* @param row - `role="treeitem"` 的行元素
		* @param snapshot - 会话快照（提供 id 顺序）
		* @param mapped - 已经全量映射出来的行（用来做邻居夹逼）
		*/
		function resolveRowId(row, snapshot, mapped) {
			const ids = snapshot?.ids ?? [];
			if (ids.length === 0) return { reason: "快照没有会话 id" };
			const allRows = Array.from(document.querySelectorAll("[role=\"treeitem\"]"));
			const myIndex = allRows.indexOf(row);
			if (myIndex < 0) return { reason: "行不在 treeitem 列表里" };
			const indexById = new Map(ids.map((id, i) => [id, i]));
			const claimed = /* @__PURE__ */ new Set();
			const domIndexById = /* @__PURE__ */ new Map();
			for (const info of mapped) {
				const di = allRows.indexOf(info.element);
				const ii = indexById.get(info.id);
				if (di >= 0 && ii !== void 0) {
					claimed.add(ii);
					domIndexById.set(di, ii);
				}
			}
			let loDom = -1;
			let loId = -1;
			let hiDom = allRows.length;
			let hiId = ids.length;
			for (const [di, ii] of domIndexById) {
				if (di < myIndex && di > loDom) {
					loDom = di;
					loId = ii;
				}
				if (di > myIndex && di < hiDom) {
					hiDom = di;
					hiId = ii;
				}
			}
			if (loDom < 0 && hiDom >= allRows.length) return { reason: "上下都没有已映射的行可作锚点" };
			const gapDoms = [];
			for (let i = loDom + 1; i < myIndex; i++) if (!mapped.some((m) => m.element === allRows[i])) gapDoms.push(i);
			const candidates = [];
			for (let k = loId + 1; k < hiId; k++) if (!claimed.has(k)) candidates.push(k);
			if (candidates.length === 1 && gapDoms.length === 0) {
				const id = ids[candidates[0]];
				if (id) return { id };
			}
			if (candidates.length !== gapDoms.length + 1) return { reason: `候选不唯一（缺口 ${gapDoms.length + 1} 行 / 候选 ${candidates.length} 个 id）` };
			const id = ids[candidates[gapDoms.length]];
			if (!id) return { reason: "候选 id 为空" };
			return { id };
		}
		/**
		* 命中坐标下的会话行（含诊断信息）。
		*
		* 与 `sessionRowAtPoint` 的区别：**即使这一行不在全量映射表里也会尽力解析**，
		* 并把失败原因带出来。拖拽落点用这个版本。
		*
		* ## 两层鲁棒性
		*
		* **① 穿透式取元素**（2026-10-02 加，有实证支撑）：
		* 用 `elementsFromPoint`（复数）从栈顶往下找**第一个会话行**，而不是只看栈顶那一个。
		*
		* 为什么必须这样：用户实际遇到过「拖不出线」，最后定位到是**皮肤插件
		* （`web-ui-skin-center`）关掉就恢复正常** —— 皮肤的全屏叠加层挡住了指针，
		* 单数版 `elementFromPoint` 只会返回那层叠加层，`closest('[role="treeitem"]')`
		* 自然为空 → 一律 `no-row-under-cursor`。
		*
		* 语义上也更对：用户**看得见**那一行才往那儿拖，叠加层是透明的装饰，
		* 不该改变"我指的是哪一行"。
		*
		* **② 不要求全量映射**：见 `resolveRowId` 的说明。
		*/
		function sessionRowHitAtPoint(x, y, snapshot) {
			if (typeof document === "undefined") return {
				info: null,
				hitRow: false,
				elementDesc: "no-document"
			};
			const mapped = collectSessionRows(snapshot);
			const inside = mapped.filter((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
			if (inside.length === 1) {
				const only = inside[0];
				return {
					info: only,
					hitRow: true,
					elementDesc: `几何命中 ${describeElement(only.element)}`
				};
			}
			const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)].filter(Boolean);
			const top3 = stack.slice(0, 3).map(describeStackLayer).join(" | ");
			let row = null;
			for (const el of stack) {
				const candidate = el.closest?.("[role=\"treeitem\"]");
				if (candidate) {
					row = candidate;
					break;
				}
			}
			if (!row) {
				let nearest = "n/a";
				let visible = "n/a";
				if (mapped.length > 0) {
					let best = Infinity;
					let bestId = "";
					let bestRect = "";
					let bestDir = "";
					for (const r of mapped) {
						const dxL = r.left - x;
						const dxR = x - r.right;
						const dyT = r.top - y;
						const dyB = y - r.bottom;
						const d = Math.hypot(dxL > 0 ? dxL : dxR > 0 ? dxR : 0, dyT > 0 ? dyT : dyB > 0 ? dyB : 0);
						if (d < best) {
							best = d;
							bestId = r.id;
							bestRect = `{x:${Math.round(r.left)},y:${Math.round(r.top)},w:${Math.round(r.right - r.left)},h:${Math.round(r.bottom - r.top)}}`;
							bestDir = `${dyT > 0 ? "上" : dyB > 0 ? "下" : ""}${dxL > 0 ? "左" : dxR > 0 ? "右" : ""}` || "内";
						}
					}
					nearest = `${bestId.slice(0, 8)} rect=${bestRect} 距 ${Math.round(best)}px(向:${bestDir})`;
					const vw = window.innerWidth;
					const vh = window.innerHeight;
					let vis = 0;
					for (const r of mapped) {
						const w = r.right - r.left;
						const h = r.bottom - r.top;
						if (w <= 0 || h <= 0) continue;
						if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
						vis++;
					}
					visible = `${vis}/${mapped.length}`;
				}
				const head = `xy=(${Math.round(x)},${Math.round(y)})`;
				return {
					info: null,
					hitRow: false,
					elementDesc: stack.length > 0 ? `${head} 栈 ${stack.length} 层均非行(命中行 ${inside.length} 个) [${top3}] 最近行=${nearest} 视口内行=${visible}` : `${head} 空栈 视口内行=${visible}`
				};
			}
			const direct = mapped.find((info) => info.element === row);
			if (direct) return {
				info: direct,
				hitRow: true,
				elementDesc: `栈命中 ${describeElement(row)}`
			};
			const resolved = resolveRowId(row, snapshot, mapped);
			if (!resolved.id) return {
				info: null,
				hitRow: true,
				elementDesc: describeElement(row),
				missReason: resolved.reason ?? "未知"
			};
			const rect = row.getBoundingClientRect();
			return {
				info: {
					element: row,
					id: resolved.id,
					top: rect.top,
					bottom: rect.bottom,
					left: rect.left,
					right: rect.right
				},
				hitRow: true,
				elementDesc: describeElement(row),
				inferred: true
			};
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
		/** 权限色对应的文字 —— 悬停提示里用，光有颜色说不清。 */
		const PERMISSION_TEXT = {
			read: "只读（只能感知，不能收发消息）",
			suggest: "可建议（能发言，不能派活）",
			write: "可写入（能发言，也能请求对方做事）"
		};
		/**
		* 会话列表的可见矩形（= 它最近的可滚动祖先的可视区）。
		*
		* ## 为什么需要它
		*
		* 轨道是 `position: fixed`，线段坐标取自会话行的 `getBoundingClientRect()`。
		* 但**行滚出列表可视区后，它的 rect 依然存在**（只是被祖先的 overflow 裁掉了
		* 显示）。于是线会被画到列表之外 —— 用户滚动时看到连线浮在最上层、
		* 压在导航区和「工作区」标题上。
		*
		* 可滚动祖先的 rect 就是行的**可见边界**。把线段裁进去，线就绝不会越界。
		*
		* 顺带的要求：JS 里读不到"元素当前被裁成什么样"，所以只能自己往上找
		* 滚动祖先。
		*
		* ## 为什么不返回 null（2026-09-30 复核修正）
		*
		* 早先版本"找不到滚动祖先就返回 null，调用方按不裁剪处理" —— 那条路径
		* **正好把 bug 原样放回来**：列表当前不可滚（会话少）、或滚动容器是更外层的
		* 祖先时，线又会画到列表外面。现在：
		*   1. 「能滚」的祖先优先（那才是列表视口）；
		*   2. 退而求其次用「会裁」的祖先（overflow 不是 visible 就构成可见边界）；
		*   3. 都没有就用**窗口视口**；
		*   4. 最后再与窗口视口求交 —— 列表本身也可能被窗口裁掉一截。
		* 即：**永远返回一个矩形**，不存在"不裁剪"的分支。
		*/
		function sessionListRect() {
			const viewport = {
				top: 0,
				left: 0,
				right: window.innerWidth,
				bottom: window.innerHeight
			};
			const row = document.querySelector("[role=\"treeitem\"]");
			if (!row) return viewport;
			let scrollable = null;
			let clipping = null;
			let el = row.parentElement;
			while (el && el !== document.body) {
				const cs = window.getComputedStyle(el);
				const oy = cs.overflowY;
				if (oy !== "visible" || cs.overflowX !== "visible") {
					const r = el.getBoundingClientRect();
					if (scrollable === null && (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) scrollable = {
						top: r.top,
						left: r.left,
						right: r.right,
						bottom: r.bottom
					};
					if (clipping === null) clipping = {
						top: r.top,
						left: r.left,
						right: r.right,
						bottom: r.bottom
					};
				}
				el = el.parentElement;
			}
			const own = scrollable ?? clipping ?? viewport;
			const merged = {
				top: Math.max(own.top, viewport.top),
				left: Math.max(own.left, viewport.left),
				right: Math.min(own.right, viewport.right),
				bottom: Math.min(own.bottom, viewport.bottom)
			};
			if (merged.right - merged.left < 1 || merged.bottom - merged.top < 1) return viewport;
			return merged;
		}
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
				/**
				* 裁剪矩形：会话列表的**滚动容器**可视区。
				*
				* 为什么必须有：轨道是 `position: fixed`，坐标取自行的
				* `getBoundingClientRect()` —— 而**行滚出列表可视区后它的 rect 依然存在**。
				* 于是线会被画到列表外面：用户滚动时看到连线"浮在最上层"，
				* 压在导航区/工作区标题上（2026-09-30 用户报告）。
				*
				* 滚动容器的 rect 就是行的**可见边界**：行滚出去，它的 rect 就在这个矩形外。
				* 把线段裁进它，线就永远不会画到列表之外。
				*/
				const clip = sessionListRect();
				const baseX = Math.max(...rows.map((r) => r.right)) - ROW_RIGHT_INSET;
				const segments = [];
				/**
				* 被跳过的连接及其**原因**。
				*
				* 为什么要有它：原来诊断只报 `segments=0`，但**五个 `continue` 哪个中的无从得知** ——
				* 2026-10-02 那份 1806 条 `conns=3 rows=18 segments=0 missing=[无]` 的日志
				* 就是这个毛病：证据齐全、但指不出病灶，只能靠猜。
				*
				* 现在把每条被跳过的连接连同**判定时的实际数字**记下来
				* （clip / x / yTop / yBot），下次出现就能直接定位。
				*/
				const skips = [];
				const shortId = (s) => s.replace(/^session-/, "").slice(0, 8);
				for (const conn of connections) {
					const assignment = layout.connections.get(conn.id);
					if (!assignment) {
						skips.push(`${shortId(conn.id)}:未分到 lane`);
						continue;
					}
					const a = rowById.get(conn.sessionA);
					const b = rowById.get(conn.sessionB);
					if (!a || !b) {
						skips.push(`${shortId(conn.id)}:行未映射(${a ? "" : shortId(conn.sessionA)}${!a && !b ? "+" : ""}${b ? "" : shortId(conn.sessionB)})`);
						continue;
					}
					const rawY1 = (a.top + a.bottom) / 2;
					const rawY2 = (b.top + b.bottom) / 2;
					const x = baseX - assignment.laneIndex * LANE_WIDTH;
					let yTop = Math.min(rawY1, rawY2);
					let yBot = Math.max(rawY1, rawY2);
					yTop = Math.max(yTop, clip.top);
					yBot = Math.min(yBot, clip.bottom);
					if (yBot - yTop < 1) {
						skips.push(`${shortId(conn.id)}:纵向裁没(y=${Math.round(rawY1)}→${Math.round(rawY2)} clip=${Math.round(clip.top)}~${Math.round(clip.bottom)})`);
						continue;
					}
					if (x < clip.left - 8 || x > clip.right + 8) {
						skips.push(`${shortId(conn.id)}:横向出界(x=${Math.round(x)} clip=${Math.round(clip.left)}~${Math.round(clip.right)})`);
						continue;
					}
					const upward = rawY1 <= rawY2;
					const y1 = upward ? yTop : yBot;
					const y2 = upward ? yBot : yTop;
					/**
					* 两端圆点各自显示**自己那个方向**的权限。
					*
					* ⚠️ 原来两端都用 `aToB` —— 那是错的：不对称连接下，B 端的点会显示
					* A→B 的权限，等于告诉你一个跟这一端无关的数字。
					* 正确语义：**这个点代表"这一端能对对方做什么"**。
					*
					* 谁是 A 端：`conn.sessionA` 那一行（上行 = y1 那一端）。
					*/
					const aOnTop = upward;
					const topLevel = aOnTop ? conn.permission.aToB : conn.permission.bToA;
					const bottomLevel = aOnTop ? conn.permission.bToA : conn.permission.aToB;
					const peerOfTop = aOnTop ? conn.sessionB : conn.sessionA;
					const peerOfBottom = aOnTop ? conn.sessionA : conn.sessionB;
					segments.push({
						id: conn.id,
						laneIndex: assignment.laneIndex,
						x,
						y1,
						y2,
						top: yTop,
						bottom: yBot,
						/**
						* 端点圆点画在**行的真实中心**，不是被收窄过的区间端点。
						*
						* 为什么区分（2026-09-30 复核修正）：线收窄到边界在视觉上等于裁剪，
						* 但**圆点不行** —— 收窄会把圆点钉在列表边界上，看起来像"线的端点标记"，
						* 而它本该标记的是那一行。行滚出去时它应当跟着走、并被裁掉。
						* 真实坐标 + 画布裁剪 = 圆点随行移动、越界自然消失。
						*/
						dotTop: Math.min(rawY1, rawY2),
						dotBottom: Math.max(rawY1, rawY2),
						/** 两个端点各自的颜色与提示（分方向，不再是同一个值）。 */
						topColor: PERMISSION_COLOR[topLevel] ?? "#9CA3AF",
						bottomColor: PERMISSION_COLOR[bottomLevel] ?? "#9CA3AF",
						topTip: `与「${sessionLabel(sessions, peerOfTop, snapshot)}」相连 · ${PERMISSION_TEXT[topLevel] ?? topLevel}`,
						bottomTip: `与「${sessionLabel(sessions, peerOfBottom, snapshot)}」相连 · ${PERMISSION_TEXT[bottomLevel] ?? bottomLevel}`,
						broken: conn.status === "broken"
					});
				}
				if (segments.length === 0) return null;
				/**
				* 画布 = 内容真实外接矩形 ∩ 列表可视区。
				*
				* 与可视区求交之后配合 `overflow: hidden`，**任何**越出列表的形状都被统一
				* 裁掉（滚出去的端点圆点、光晕的模糊外溢、以及以后新加的形状），
				* 不依赖"每个形状各自记得裁剪"。留 8px 内边距给光晕，只在边界处切断。
				*/
				const MARGIN = 8;
				const bounds = {
					left: Math.max(Math.min(...segments.map((s) => s.x)) - MARGIN, clip.left),
					right: Math.min(Math.max(...segments.map((s) => s.x)) + MARGIN, clip.right),
					top: Math.max(Math.min(...segments.map((s) => s.dotTop)) - MARGIN, clip.top),
					bottom: Math.min(Math.max(...segments.map((s) => s.dotBottom)) + MARGIN, clip.bottom)
				};
				if (bounds.bottom - bounds.top < 1 || bounds.right - bounds.left < 1) return {
					segments: [],
					bounds: null,
					skips: [...skips, `边界退化(bounds=${Math.round(bounds.left)}~${Math.round(bounds.right)},${Math.round(bounds.top)}~${Math.round(bounds.bottom)} clip=${Math.round(clip.left)}~${Math.round(clip.right)})`]
				};
				return {
					segments,
					bounds,
					skips
				};
			}, [rows, connections]);
			(0, react.useEffect)(() => {
				if (!client) return;
				if (connections.length === 0) return;
				if (rows.length === 0) return;
				const short = (s) => s.replace(/^session-/, "").slice(0, 8);
				const needed = Array.from(new Set(connections.flatMap((c) => [c.sessionA, c.sessionB])));
				const mappedIds = new Set(rows.map((r) => r.id));
				const missing = needed.filter((id) => !mappedIds.has(id));
				const segments = rail?.segments.length ?? 0;
				if (missing.length === 0 && segments >= connections.length) return;
				client.report(`rail 异常 conns=${connections.length} rows=${rows.length} segments=${segments} missing=[${missing.map(short).join(",") || "无"}] skips=[${(rail?.skips ?? []).join(" | ") || "无"}] mapped=[${rows.map((r) => short(r.id)).join(",")}]`);
			}, [
				rail,
				rows,
				connections,
				client
			]);
			/**
			* 是否已上报过遮挡诊断 —— **每次挂载只打一行**，不刷屏。
			*
			* （原来是"段数变化就打"，但那会在 1→2→1 这种抖动下重复。
			* 这条诊断的使命是"确认一次绘制顺序"，一次就够。）
			*/
			const railDiagRef = (0, react.useRef)(false);
			/**
			* 共用覆盖层宿主的引用。
			*
			* ⚠️ **两条线（轨道 + 拖拽）共用同一个宿主** —— 见 `overlay-host.ts`。
			* 各建各的会在"谁是 body 最后一个子节点"上互相竞争（后者胜的规则下，
			* 两者挂载顺序一变，层级就翻转），共用一个宿主后层内用 z-index 排定：
			* 轨道 9998、拖拽 9999。
			*
			* 宿主挂在 body 上 → 堆叠与"哪个槽位容器在上面"彻底解耦，
			* 不会被别人的皮肤/叠加层按堆叠上下文压住（那正是"看不见线"的成因之一）。
			*/
			const hostRef = (0, react.useRef)(null);
			if (!hostRef.current) hostRef.current = getOverlayHost();
			/** 视图偏好：整条轨道可以一键隐藏（只影响观感，连接本身不动）。 */
			const [railVisible, setRailVisible] = (0, react.useState)(() => prefs.get().railVisible);
			(0, react.useEffect)(() => prefs.subscribe(() => setRailVisible(prefs.get().railVisible)), [prefs]);
			/**
			* 遮挡诊断：**画出来了但看不见**时用。
			*
			* 与 rail 的 `skips=` 诊断互补 —— 那个答的是"为什么没算出来"，
			* 这个答的是"算出来了为什么看不到"。
			*
			* ## ⚠️ 方法论（这一条我和对端各栽过一次，留给后来人）
			*
			* **测「绘制顺序」不能用 `elementsFromPoint`** ——
			* 它会**跳过 `pointer-events: none` 的元素**，而我们的宿主与 svg 恰恰都是 `none`。
			* 于是那个栈测的是「**谁能被点到**」而不是「**谁画在上面**」，
			* 轨道**再高也永远不会出现在里面**。
			*
			* 这个盲点害我们下过**两次错误结论**：
			*   ① 见栈顶是 `div.skin-wallpaper` → 断定"轨道被壁纸遮住"（据此还改了宿主）
			*   ② 见栈顶是 `div.hIlkoa_sessionRow` → 断定"轨道输给了会话行"
			* 两次都不成立 —— 栈里出现谁，只说明"谁能被点到"。
			*
			* **正确做法二选一**：
			*   · **临时放开命中**：测量瞬间置 `pointerEvents='auto'` → 取栈 → `finally` 恢复
			*     （本函数采用的就是这条）
			*   · **纯计算**：逐级比较两元素所在堆叠上下文链的 `z-index / position / transform`
			*
			* 记住一句话：**命中测试的栈 ≠ 绘制顺序的栈。**
			*
			* 触发时机：每次挂载**只打一行**（它的使命是"确认一次绘制顺序"）。
			* 内容：画布 rect / 计算样式 z-index-opacity-display / 段数与首段端点 /
			* 宿主与应用根的层级 / 首段中点的 `elementsFromPoint` 栈顶 3 层。
			*/
			(0, react.useEffect)(() => {
				if (!client) return;
				const n = rail?.segments.length ?? 0;
				if (n === 0) return;
				if (railDiagRef.current) return;
				railDiagRef.current = true;
				const seg = rail.segments[0];
				const midX = seg.x;
				const midY = (seg.y1 + seg.y2) / 2;
				let top3 = "n/a";
				let svgStyle = "n/a";
				/** 宿主与"应用根"的层级对比 —— 谁在谁上面要完全可见。 */
				let hostInfo = "n/a";
				/** 线自身样式的读数 —— 见下面那段说明。 */
				let lineStyleDiag = "n/a";
				try {
					const svgEl = document.querySelector(".ccr-rail-overlay");
					const hostEl = hostRef.current;
					const hostPe = hostEl?.style.pointerEvents ?? "";
					const svgPe = svgEl?.style.pointerEvents ?? "";
					if (hostEl) hostEl.style.pointerEvents = "auto";
					if (svgEl) svgEl.style.pointerEvents = "auto";
					try {
						top3 = document.elementsFromPoint(midX, midY).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}${e.getAttribute("class") ? `.${(e.getAttribute("class") ?? "").split(/\s+/)[0]}` : ""}`).join(" | ");
					} finally {
						if (hostEl) hostEl.style.pointerEvents = hostPe;
						if (svgEl) svgEl.style.pointerEvents = svgPe;
					}
					if (svgEl) {
						const cs = window.getComputedStyle(svgEl);
						svgStyle = `z=${cs.zIndex} op=${cs.opacity} disp=${cs.display}`;
					}
					try {
						const lines = document.querySelectorAll(".ccr-rail-overlay line");
						const first = lines[0];
						if (first) {
							const lcs = window.getComputedStyle(first);
							const rootCs = window.getComputedStyle(document.documentElement);
							const varChain = `--ccr-flow-color=[${rootCs.getPropertyValue("--ccr-flow-color").trim() || "未定义"}] --dsw-alias-label-primary=[${rootCs.getPropertyValue("--dsw-alias-label-primary").trim() || "未定义"}]`;
							lineStyleDiag = `rail 线样式 diag lines=${lines.length} stroke=${lcs.stroke} strokeWidth=${lcs.strokeWidth} strokeOpacity=${lcs.strokeOpacity} visibility=${lcs.visibility} opacity=${lcs.opacity} mixBlendMode=${lcs.mixBlendMode} color=${lcs.color} ${varChain}`;
						} else lineStyleDiag = "rail 线样式 diag lines=0（没有 <line> 元素 —— 段没渲染出来）";
					} catch (e) {
						lineStyleDiag = `rail 线样式 diag 取值失败：${e instanceof Error ? e.message : String(e)}`;
					}
					const host = hostRef.current;
					if (host) {
						const hcs = window.getComputedStyle(host);
						const idx = Array.prototype.indexOf.call(document.body.children, host);
						hostInfo = `host[z=${hcs.zIndex} conn=${host.isConnected} idx=${idx}/${document.body.children.length - 1}]`;
					}
					const root = document.querySelector("#root,#app,[data-reactroot]");
					if (root) {
						const rcs = window.getComputedStyle(root);
						hostInfo += ` root[z=${rcs.zIndex} pos=${rcs.position} tf=${rcs.transform === "none" ? "none" : "yes"}]`;
					}
				} catch {}
				const r = rail.bounds;
				client.report(`rail 遮挡诊断 segs=${n} bounds={x:${Math.round(r?.left ?? 0)},y:${Math.round(r?.top ?? 0)},w:${Math.round((r?.right ?? 0) - (r?.left ?? 0))},h:${Math.round((r?.bottom ?? 0) - (r?.top ?? 0))}} ${svgStyle} 首段=(${Math.round(seg.x)},${Math.round(seg.y1)})~(${Math.round(seg.x)},${Math.round(seg.y2)}) ${hostInfo} 中点栈顶3层=[${top3}] ${lineStyleDiag}`);
			}, [client, rail]);
			if (!railVisible) return null;
			if (!rail) return null;
			const { segments, bounds } = rail;
			if (!bounds) return null;
			const width = bounds.right - bounds.left;
			const height = bounds.bottom - bounds.top;
			const svg = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "ccr-rail-overlay",
				"aria-hidden": "true",
				style: {
					position: "fixed",
					left: bounds.left,
					top: bounds.top,
					width,
					height,
					pointerEvents: "none",
					zIndex: 9998,
					overflow: "hidden"
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
						[[
							seg.dotTop,
							seg.topColor,
							seg.topTip
						], [
							seg.dotBottom,
							seg.bottomColor,
							seg.bottomTip
						]].map(([y, color, tip], i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("title", { children: tip }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: seg.x - bounds.left,
								cy: y - bounds.top,
								r: 4.5,
								fill: color,
								fillOpacity: .22,
								filter: "url(#ccr-rail-glow)"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: seg.x - bounds.left,
								cy: y - bounds.top,
								r: 2.6,
								fill: color,
								fillOpacity: .9
							})
						] }, i))
					]
				}, seg.id))]
			});
			const host = hostRef.current;
			if (!host) return null;
			return (0, react_dom.createPortal)(svg, host);
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
				loadCard: (templateId, connectionId, scope) => invoke(RPC_ENDPOINTS.loadCard, {
					templateId,
					connectionId,
					...scope ? { scope } : {}
				}),
				unloadCard: (instanceId) => invoke(RPC_ENDPOINTS.unloadCard, { instanceId }),
				reloadCard: (instanceId) => invoke(RPC_ENDPOINTS.reloadCard, { instanceId }),
				setCardScope: (instanceId, scope) => invoke(RPC_ENDPOINTS.setCardScope, {
					instanceId,
					scope
				}),
				installCard: (spec) => invoke(RPC_ENDPOINTS.installCard, { spec }),
				uninstallCard: (cardId) => invoke(RPC_ENDPOINTS.uninstallCard, { cardId }),
				cardsRoot: () => invoke(RPC_ENDPOINTS.cardsRoot),
				checkCardUpdate: (cardId) => invoke(RPC_ENDPOINTS.checkCardUpdate, { cardId }),
				updateCard: (cardId) => invoke(RPC_ENDPOINTS.updateCard, { cardId }),
				relayDiagnostics: () => invoke(RPC_ENDPOINTS.relayDiagnostics),
				listCardTemplates: (connectionId) => invoke(RPC_ENDPOINTS.listCardTemplates, connectionId ? { connectionId } : {}),
				renderCardPanel: (instanceId) => invoke(RPC_ENDPOINTS.renderCardPanel, { instanceId }),
				readCardClientSource: (instanceId) => invoke(RPC_ENDPOINTS.readCardClientSource, { instanceId }),
				listPendingUpgrades: (connectionId) => invoke(RPC_ENDPOINTS.listUpgradeRequests, connectionId ? { connectionId } : {}),
				negotiateWhitelist: (connectionId, methods) => invoke(RPC_ENDPOINTS.negotiateWhitelist, {
					connectionId,
					methods
				}),
				listWhitelistedMethods: (connectionId) => invoke(RPC_ENDPOINTS.listWhitelist, { connectionId }),
				listSessions: () => invoke(RPC_ENDPOINTS.listSessions),
				connectionWork: (connectionId) => invoke(RPC_ENDPOINTS.connectionWork, { connectionId }),
				listConventions: (connectionId, all) => invoke(RPC_ENDPOINTS.listConventions, all ? {
					connectionId,
					all
				} : { connectionId }),
				declareConvention: (connectionId, by, topic, text) => invoke(RPC_ENDPOINTS.declareConvention, {
					connectionId,
					by,
					topic,
					text
				}),
				removeConvention: (connectionId, id) => invoke(RPC_ENDPOINTS.removeConvention, {
					connectionId,
					id
				}),
				report: (message) => {
					rpc.call(RPC_CHANNEL, RPC_ENDPOINTS.debugLog, { message }).catch(() => {});
				}
			};
		}
		//#endregion
		//#region src/client/view-prefs.ts
		const STORAGE_KEY = "dsh-connection-card-host/view-prefs";
		const DEFAULT_PREFS = {
			railVisible: true,
			workOpen: false,
			boxOpen: false
		};
		function load() {
			try {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (!raw) return { ...DEFAULT_PREFS };
				const parsed = JSON.parse(raw);
				const bool = (v, fallback) => typeof v === "boolean" ? v : fallback;
				return {
					railVisible: bool(parsed.railVisible, DEFAULT_PREFS.railVisible),
					workOpen: bool(parsed.workOpen, DEFAULT_PREFS.workOpen),
					boxOpen: bool(parsed.boxOpen, DEFAULT_PREFS.boxOpen)
				};
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
  /*
   * ⚠️ 这里一度加过 --ccr-rail-color / --ccr-drag-color 两个「中间调」令牌，
   * 目的是让线在明亮壁纸上可见。**已全部删除** ——
   *
   * 用户明确裁定：「我们只是解决**怎么显现**，并不是颜色问题！」
   * 线的外观（颜色、线宽、透明度）保持初版原样；
   * 「看不见」一律走**显现**那条路解决 = 挂到 body 末子节点上的共用宿主
   * （见 src/ui/overlay-host.ts）—— 那才是真正的病因所在（堆叠上下文）。
   *
   * ⚠️ 本文件整体是一个模板字符串 —— 注释里不要写反引号（会截断字符串）。
   */
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

/* ═══ SessionRailOverlay：会话行上的竖线（风格对齐拖拽的水流线） ═══
 *
 * 只有流动动画和 keyframes 是活的 —— 下面的 .ccr-rail / .ccr-rail__overflow /
 * .ccr-lane* 属于已删除的 SessionRail/RailLane 组件（那套用绝对定位的
 * div 画线，早已被 SVG 的 SessionRailOverlay 取代），留着只会误导人。 */
.ccr-rail__flow {
  animation: ccr-rail-flow 2600ms linear infinite;
}

@keyframes ccr-rail-flow {
  to { stroke-dashoffset: -36; }
}

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
/*
 * 外层：主内容 + 右侧插件 UI 侧栏。
 *
 * 面板主体仍是 ccr-page（720 居中），侧栏占用右边的留白 ——
 * 适配卡插件的 UI 就渲染在那儿（而不是 DSH 全局界面）。
 * 没有适配卡时侧栏不渲染，布局与以前**完全一致**（justify-content: center 让主体居中）。
 *
 * ⚠️⚠️ height:100% 与 min-height:0 **必须留着**。
 *
 * 这层是怎么来的：以前 ccr-page 是宿主 main 区的**直接子项**，靠 height:100%
 * 拿到定高、成为滚动容器。加了这层之后 ccr-page 变成**它的**子项 ——
 * 而它默认高度 auto，于是 ccr-page 的 height:100% 退化成 auto、
 * **不再是滚动容器**，外层也不滚 ⇒ **滚轮完全没反应**（用户实测报上来的回归）。
 *
 * 所以这里要把宿主给的高度**接住再往下传**；flex 项还要 min-height:0
 * 才能收缩（否则内容把它撑高，一样滚不动）。
 */
.ccr-page-wrap {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
  height: 100%;
  min-height: 0;
}
/* 窄屏时侧栏换行到下方，避免把主内容挤窄 */
@media (max-width: 1100px) {
  .ccr-page-wrap { flex-wrap: wrap; height: auto; }
  .ccr-page__side { width: 100%; max-width: 720px; margin: 0 auto 24px; height: auto; }
}
.ccr-page__side {
  box-sizing: border-box;
  width: 300px;
  padding: 24px 12px 40px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 侧栏自己也滚：插件 UI 可能很高，不能把面板撑成不可滚 */
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* 捕获到的插件 UI：与面板同用主题令牌，不写死颜色 */
.ccr-captured {
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.25));
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--dsw-alias-bg-l1, transparent);
}
.ccr-captured__head {
  font-size: 11px;
  opacity: 0.65;
  margin-bottom: 8px;
  word-break: break-all;
}
.ccr-captured__slot {
  font-size: 10px;
  opacity: 0.45;
  margin: 8px 0 4px;
}
.ccr-captured__note,
.ccr-captured__error {
  font-size: 11px;
  opacity: 0.7;
  padding: 8px 10px;
  border: 1px dashed var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.35));
  border-radius: 8px;
  word-break: break-word;
}
.ccr-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 40px;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
  /*
   * 面板自己做滚动容器。
   *
   * 为什么必须：内容会超过一屏（连接多了、每条展开还有卡片+感知区），
   * 而宿主的 main 区**不保证是滚动容器** —— 之前没有高度约束也没 overflow，
   * 于是超出部分直接被裁掉，滚轮完全没反应。
   *
   * height/max-height 都写：父级若是定高 flex/grid 项，height:100% 生效；
   * 若是自动高度，两者都退化成 auto，行为与修复前一致（不会更糟）。
   */
  height: 100%;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
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

/*
 * 适配卡（普通 DSH 插件挂成连接能力）—— 用户裁决 D6：
 * **照常列出 + 「适配」标注**；未就绪时置灰（沿用上面的 :disabled 样式）并保留悬停说明。
 * 置灰而不是隐藏：让用户知道"东西在这儿、需要开一下"，而不是以为没装上。
 */
.ccr-card-option--blocked { border-style: dashed; }
.ccr-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 500;
  line-height: 15px;
  vertical-align: 1px;
  border-radius: 4px;
  /* 与主题一致：用边框层级色，不写死具体颜色 */
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.35));
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.75));
}
.ccr-badge--adapter { letter-spacing: 0.5px; }
.ccr-card-option__name { font-size: 12px; font-weight: 500; }
/* 卡片更新入口（已安装卡片才有）：点一次检查，有新版再点一次更新 */
.ccr-card-option__upd {
  flex: none;
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  opacity: 0.7;
  background: rgba(128, 128, 128, 0.16);
  cursor: pointer;
  white-space: nowrap;
}
.ccr-card-option__upd:hover { opacity: 1; background: rgba(128, 128, 128, 0.28); }

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

/* 「卡片」+ 右侧小三角：点文字或三角都收起/展开整个卡片区 */
.ccr-cards__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ccr-cards__toggle:hover .ccr-field__label { opacity: 1; }
.ccr-cards__tri {
  font-size: 9px;
  line-height: 1;
  opacity: 0.65;
}
.ccr-cards__toggle:hover .ccr-cards__tri { opacity: 1; }

/* 收起时只剩标题那一行 —— 去掉多余的上下留白 */
.ccr-cards--folded { margin-bottom: 12px; }

/*
 * 卡片区标题行：卡片 ▸ 3 ………………………… + 添加卡片
 *
 * ⚠️ display:flex 是**必需**的 —— 「+ 添加卡片」靠 margin-left:auto 顶到右边，
 * 而 auto 外边距只在 flex/grid 容器里生效。少了它，按钮会挤在计数后面
 * （用户截图里就是这样）。
 */
/*
 * 可关闭的说明块（DismissibleHint）—— 右上角一个 ×，关掉后不再显示。
 * 外层 relative，× 绝对定位到右上角；正文留出右上角空间，别顶到 × 底下。
 */
.ccr-dismissible { position: relative; }
.ccr-dismissible__close {
  position: absolute;
  top: -2px;
  right: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  opacity: 0.4;
  cursor: pointer;
}
.ccr-dismissible__close:hover { opacity: 0.9; background: rgba(128, 128, 128, 0.18); }
.ccr-dismissible .ccr-field__hint { padding-right: 22px; }
.ccr-cards__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ccr-cards__add { margin-left: auto; }

/* 卡片面板的收起/展开箭头（默认收起，见 CardStack 的 expandedCards） */
.ccr-card__toggle {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 10px;
  line-height: 1;
  opacity: 0.6;
  cursor: pointer;
}
.ccr-card__toggle:hover:not(:disabled) { opacity: 1; }
.ccr-card__toggle:disabled { opacity: 0.2; cursor: default; }

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

/* ═══ 转发中警告（权限高于只读时常驻） ═══
   理由：用户抬权限时以为"这是让对方能干活"，实际是"两边说的话开始互相灌"。
   2026-09-30 因此连着两次被意外打扰，所以这个状态必须显眼。 */
.ccr-forward-warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 10px 0;
  padding: 9px 11px;
  font-size: 12px;
  line-height: 1.55;
  border-radius: 7px;
  background: rgba(249, 115, 22, 0.13);
  border: 1px solid rgba(249, 115, 22, 0.35);
}

.ccr-forward-warn__dot {
  flex: none;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: #F97316;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
}

/* ═══ 卡片安装（装到我们自己的目录） ═══ */
.ccr-install {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
}

.ccr-install__row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ccr-install__row .ccr-input { flex: 1 1 auto; min-width: 0; }

/* 目录路径可能很长，允许折行且用等宽字体，避免看成一串糊字 */
.ccr-install code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  word-break: break-all;
}

/* ═══ 卡片可见范围（两端 / 仅 A / 仅 B） ═══ */
.ccr-scope-pick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 2px 8px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2));
}

.ccr-scope-pick__label {
  flex: none;
  font-size: 11px;
  opacity: 0.65;
}

/* 卡片头里的范围切换：靠右挤在重载/移除前，不与名字抢宽度 */
.ccr-card__scope { flex: none; }

.ccr-card__scope-fixed {
  flex: none;
  padding: 1px 6px;
  font-size: 10px;
  line-height: 15px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.2);
  opacity: 0.8;
}

/* ═══ 可折叠区块（协作感知的两块） ═══ */
.ccr-fold {
  margin-top: 10px;
  border-radius: 7px;
  background: var(--ccr-panel-highlight);
  overflow: hidden;
}

.ccr-fold__head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 10px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.ccr-fold__head:hover { background: rgba(128, 128, 128, 0.08); }

.ccr-fold__chevron {
  flex: none;
  width: 10px;
  font-size: 10px;
  opacity: 0.6;
}

.ccr-fold__title {
  flex: none;
  font-weight: 600;
}

/* 「对方正在活动」的小圆点 —— 收起状态下也能一眼看出对方在忙 */
.ccr-fold__live {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22C55E;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
}

/* 收起时的摘要：占满剩余宽度、超出省略，不换行（保证标题行永远只占一行） */
.ccr-fold__digest {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  opacity: 0.6;
}

.ccr-fold__body {
  padding: 2px 10px 10px;
}

/* ═══ 协作感知 A：工作状态 ═══ */
.ccr-field__auto,
.ccr-field__count {
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10px;
  line-height: 15px;
  border-radius: 4px;
  opacity: 0.7;
  background: var(--ccr-panel-highlight);
}

.ccr-work {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.ccr-work__row {
  padding: 7px 9px;
  border-radius: 7px;
  background: var(--ccr-panel-highlight);
}

.ccr-work__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 3px;
}

.ccr-work__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 600;
}

.ccr-work__age {
  flex: none;
  font-size: 10px;
  opacity: 0.6;
}

/* 太久没更新：状态可能已经不代表现状了，弱化它 */
.ccr-work__age--stale { opacity: 0.4; }

.ccr-work__action {
  font-size: 12px;
  opacity: 0.9;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ccr-work__action--empty { opacity: 0.45; font-style: italic; }

.ccr-work__todos {
  margin: 5px 0 0;
  padding: 0;
  list-style: none;
}

.ccr-work__todo {
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.8;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ccr-work__todo--completed { opacity: 0.4; text-decoration: line-through; }
.ccr-work__todo--in_progress { opacity: 1; font-weight: 600; }

.ccr-work__files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.ccr-work__file {
  padding: 1px 5px;
  font-size: 10px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.18);
  opacity: 0.85;
}

.ccr-work__progress {
  margin-top: 4px;
  font-size: 10px;
  opacity: 0.55;
}

/* 中继诊断：被挡下的非真人来源（平时不显示，有东西被挡才出现） */
.ccr-work__diag {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  font-size: 10px;
  opacity: 0.55;
}

.ccr-work__diag-head { word-break: break-word; }

.ccr-work__diag-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 3px;
}

.ccr-work__diag-kind {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.22);
}

/* 内容预览：这是"误挡会当场现形"的关键，所以给它主位、允许省略号 */
.ccr-work__diag-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ccr-work__diag-age { flex: none; opacity: 0.7; }

/* ═══ 协作感知 B：公约盒 ═══ */
.ccr-box {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ccr-box__item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--ccr-panel-highlight);
  font-size: 12px;
}

.ccr-box__topic {
  flex: none;
  padding: 0 5px;
  font-size: 10px;
  line-height: 15px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.22);
  opacity: 0.9;
}

.ccr-box__text {
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-word;
}

.ccr-box__who {
  flex: none;
  max-width: 26%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 10px;
  opacity: 0.55;
}

.ccr-box__del {
  flex: none;
  padding: 0 4px;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
  opacity: 0.35;
}

.ccr-box__del:hover { opacity: 1; }

.ccr-box__empty {
  margin-top: 4px;
  padding: 8px;
  font-size: 11px;
  opacity: 0.55;
  border-radius: 6px;
  background: var(--ccr-panel-highlight);
}

.ccr-box__add {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.ccr-input--topic { flex: none; width: 72px; }

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
				/**
				* **落空计数**（reason → 窗口内次数 / 最近一次时间）。
				*
				* 用途：把"拖着玩"与"真想连"分开 —— 单次落空只记日志，同一原因 30 秒内 ≥3 次才提示一次。
				* 见 `finishAt` 里那段说明（提示的成本 = 误报概率 × 打扰强度）。
				*/
				const missRef = (0, react.useRef)(/* @__PURE__ */ new Map());
				/** 两个会话之间是否已有连接。 */
				const findExisting = (0, react.useCallback)((list, a, b) => list.find((c) => c.sessionA === a && c.sessionB === b || c.sessionA === b && c.sessionB === a), []);
				/** 落点解析：目标会话 + 起点会话 + 是否已连 + 失败原因（诊断用）。 */
				const resolveDrop = (0, react.useCallback)((x, y) => {
					const snap = sessions?.getSnapshot();
					const hitInfo = sessionRowHitAtPoint(x, y, snap ?? null);
					const hit = hitInfo.info;
					const sourceId = sessionId ?? snap?.current ?? null;
					const existing = hit && sourceId ? findExisting(connsRef.current, sourceId, hit.id) : void 0;
					let reason;
					if (!sessions) reason = "no-sessions-bridge";
					else if (!hitInfo.hitRow) reason = "no-row-under-cursor";
					else if (!hit) reason = "row-unresolved";
					else if (!sourceId) reason = "no-current-session";
					else if (hit.id === sourceId) reason = "same-session";
					else reason = "ok";
					return {
						hit,
						sourceId,
						reason,
						existing,
						idCount: snap?.ids?.length ?? 0,
						hitInfo
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
					const r = resolveDrop(x, y);
					const { hit, sourceId, reason } = r;
					if (reason !== "ok" || !hit || !sourceId) {
						if (client) client.report(`dragEnd reason=${reason} hit=${hit?.id ?? "none"} at=[${r.hitInfo.elementDesc}] rowHit=${r.hitInfo.hitRow} ` + (r.hitInfo.missReason ? `未解析=[${r.hitInfo.missReason}] ` : "") + `rows=${document.querySelectorAll("[role=\"treeitem\"]").length} marked=${document.querySelectorAll("[data-ccr-session]").length}`);
						const hint = {
							"no-row-under-cursor": "操作没生效 —— 请拖到左侧会话列表的某一行上",
							"row-unresolved": "操作没生效 —— 这一行认不出是哪个会话，换一行或等它空闲后再试",
							"no-current-session": "操作没生效 —— 请从输入框左侧的圆点开始拖",
							"same-session": "操作没生效 —— 不能连到自己，拖到另一行上",
							"no-sessions-bridge": "操作没生效 —— 会话列表还没就绪，稍后再试"
						}[reason];
						if (hint) {
							const now = Date.now();
							const rec = missRef.current.get(reason);
							const n = rec && now - rec.at < 3e4 ? rec.n + 1 : 1;
							missRef.current.set(reason, {
								n,
								at: now
							});
							if (n >= 3) {
								flashHint(hint);
								missRef.current.set(reason, {
									n: 0,
									at: now
								});
							}
						} else
 /** 未知原因：**只进日志**（这一条是给开发者的，不是给屏幕的）。 */
						client?.report(`dragEnd 未知 reason=${reason}（未上屏，见设计注释）`);
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