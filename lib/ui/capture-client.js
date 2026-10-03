/**
 * 客户端 UI 捕获 —— 把**普通 DSH 插件**的 UI 拿到我们的面板里渲染。
 *
 * ## 依据：客户端制品的真实形态（已核实）
 *
 * 官方模板与**我们自己的** `lib/client.js` 是同一形状：
 *
 * ```js
 * window.__ModuleLoader__.load({
 *   id: '@local/my-decoration',
 *   factory(require) {           // ← 普通函数，返回 { inject, apply(ctx) }
 *     const React = require('react')
 *     return { inject: ['slots'], apply(ctx) { ctx.slots.register({…}, Component) } }
 *   },
 * })
 * ```
 *
 * 关键点：**factory 是普通函数**，不是必须由 DSH 加载器实例化的黑盒。
 * 所以我们可以自己调它、自己给影子 ctx，把它的槽位注册**捕获**下来。
 *
 * ## 四步（与 adapter-design.md §4 对应）
 *
 * 1. 宿主把客户端制品源码送到浏览器（RPC，见 card-host/client-artifact.ts）
 * 2. **临时替换** `__ModuleLoader__` 为捕获桩，执行源码 → 拿到 `{ id, factory }` → **立刻还原**
 * 3. 用**我们自己的 `require`** 调 factory（同一份 React 实例），
 *    再给它一个**影子 client ctx**（只有 `slots`/`effect`，其余访问当场抛错）
 * 4. 把捕获到的组件交给面板渲染；卸载时执行登记的清理
 *
 * ## 不做的事（划清边界）
 *
 * · **不加载它的 client 入口到 DSH 的全局槽位** —— 那样 UI 就会出现在全局界面，
 *   而用户要的正是"只在连接面板里"
 * · 不碰 app root（官方 UI 指引明确禁止）
 * · 服务依赖拿不到就**明确失败**，不"忽略后祈祷不崩"
 */
/** 捕获 factory：临时换掉 __ModuleLoader__，执行源码，然后还原。 */
export function captureFactory(source, target = globalThis) {
    const previous = target.__ModuleLoader__;
    let captured;
    const stub = {
        load(entry) {
            const e = entry;
            if (!e || typeof e.factory !== 'function') {
                throw new Error('客户端制品调用了 __ModuleLoader__.load，但没给出 factory 函数');
            }
            captured = { id: String(e.id ?? '(未命名)'), factory: e.factory };
        },
    };
    target.__ModuleLoader__ = stub;
    try {
        // 用 Function 而不是 <script>：不污染文档、不受 CSP inline 脚本策略影响
        // eslint-disable-next-line no-new-func
        const run = new Function('window', 'globalThis', source);
        run(target, target);
    }
    finally {
        // ⚠️ 无论成败都要还原：这个全局是 DSH 加载器的命脉
        if (previous === undefined)
            delete target.__ModuleLoader__;
        else
            target.__ModuleLoader__ = previous;
    }
    if (!captured) {
        throw new Error('这段源码没有调用 __ModuleLoader__.load —— 它可能不是 DSH 的客户端制品' +
            '（官方约定：浏览器制品必须注册一个 id 等于包名的懒工厂）。');
    }
    return captured;
}
/**
 * 用影子 client ctx 实例化捕获到的 factory。
 *
 * @param require 浏览器模块表（**用我们自己的** —— 保证 React 等是同一个实例）
 * @param onWarn 拿不到的服务等情况的说明（走审计/诊断，不静默）
 */
export function instantiateCaptured(captured, require, onWarn = () => { }) {
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
            void name;
            const result = cb();
            /**
             * ⚠️ 去重：`register()` 自己也返回 disposer，而官方写法里
             * `inject(name, () => register(...))` 会把这个返回值当清理 ——
             * 于是同一个函数被记两次，清理时执行两遍（`disposeCaptured` 逆序跑）。
             * 记一次就够。
             */
            if (typeof result === 'function' && !disposers.some((d) => d.fn === result)) {
                disposers.push({ label: `slots.inject(${name})`, fn: result });
            }
        },
        /** `register({ name, id, … }, Component)` —— 捕获，不真的注册到 DSH 槽位。 */
        register(spec, component) {
            const s = (spec ?? {});
            const slot = typeof s.name === 'string' ? s.name : '';
            if (!slot)
                throw new Error('ctx.slots.register 缺少 name');
            if (typeof component !== 'function' && typeof component !== 'object') {
                throw new Error(`ctx.slots.register(${slot}) 的组件不是函数/对象`);
            }
            const reg = {
                slot,
                ...(typeof s.id === 'string' ? { id: s.id } : {}),
                component,
            };
            registrations.push(reg);
            return () => {
                const i = registrations.indexOf(reg);
                if (i >= 0)
                    registrations.splice(i, 1);
            };
        },
    };
    const effect = (cb, label) => {
        const result = cb();
        if (typeof result === 'function') {
            disposers.push({ label: label ?? '(未命名 effect)', fn: result });
        }
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
    const services = { slots, effect };
    services.get = (name) => typeof name === 'string' && name in services ? services[name] : undefined;
    const seenMisses = new Set();
    const ctx = new Proxy({}, {
        get(_t, prop) {
            if (typeof prop === 'symbol')
                return undefined;
            if (prop === 'then' || prop === 'toJSON' || prop === 'constructor')
                return undefined;
            if (prop === 'toString' || prop === 'valueOf')
                return () => '[shadow-client-ctx]';
            if (prop in services)
                return services[prop];
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
            throw new Error(`${m} —— 适配层目前只提供 slots 与 effect。` +
                `若该插件的 UI 依赖它，请在卡片清单里说明，或让它的 UI 保持纯渲染。`);
        },
        set() {
            throw new Error('影子 client ctx 是只读的');
        },
    });
    let plugin;
    try {
        plugin = captured.factory(require);
    }
    catch (e) {
        throw new Error(`调用客户端 factory 失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!plugin || typeof plugin.apply !== 'function') {
        throw new Error(`客户端 factory 没有返回 { apply } —— 它的 id 是「${captured.id}」`);
    }
    /**
     * 插件声明的 inject 与实际提供的能力对账。
     *
     * ⚠️ 声明了、但我们没有的，**只告警不拒绝** —— 这一点是**拿真插件实测后改的**：
     * 生态里的 UI 插件普遍声明一长串客户端服务（`locale` / `configForms` / `uiWorkspace` …），
     * 而它们**未必每条路径都用到**。一律拒绝 = "因为声明太全而装不上"；
     * 放它跑、在**真正访问**时由 Proxy 抛出点名的错误，既不放宽边界也不误伤。
     */
    const injects = Array.isArray(plugin.inject) ? plugin.inject.map(String) : [];
    const missing = injects.filter((i) => i !== 'slots' && i !== 'effect');
    if (missing.length > 0) {
        warn(`客户端插件声明了 [${missing.join(', ')}]，适配层只提供 slots / effect（外加可转交的宿主服务）。` +
            `真正访问到没有的那个时才会失败。`);
    }
    plugin.apply(ctx);
    return {
        registrations,
        disposers,
        warnings,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    };
}
/** 执行全部清理（逆序）。 */
export function disposeCaptured(shadow) {
    for (const d of [...shadow.disposers].reverse()) {
        try {
            d.fn();
        }
        catch {
            /* 清理途中的错误不该阻断其余清理 */
        }
    }
    shadow.disposers = [];
    shadow.registrations = [];
}
//# sourceMappingURL=capture-client.js.map