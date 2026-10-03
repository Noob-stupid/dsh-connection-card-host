/**
 * **卡片的适格性**：这张卡"是不是当卡片的材料"（用户在候选列表里要能一眼看出）。
 *
 * ## 为什么需要它（用户点出的第三条判据轴）
 *
 * 用户原话：
 *
 * > 「`omdsh-dev/DSH-better-sidebar` 这种插件一看就是**为了全局而生的**啊」
 *
 * 也就是说：**星多 ≠ 适合当卡片** ✗。
 * `DSH-better-sidebar`（3979★）是**替换/接管整个侧栏的全局 UI** ——
 * 它天生属于"**装到 App 上**"，不属于"**挂到某条连接上**" ✗。
 * 这类插件**即使能挂上也没意义**（全局 UI 塞进连接级面板既装不下，也会和 App 自己的布局打架）。
 *
 * ⇒ 判定要**三条轴**（前两条在别处已实现，这里是第三条 + 汇总）：
 *
 *     ① 模块门：入口 import 闭包内的依赖可解析   （`shim.ts` 的 planShims）
 *     ② 能力门：inject ⊆ {tools, effect, llm, prompt}
 *     ③ **作用域门**：全局型 ⇒ 「不建议当卡片」
 *
 * ## 判据（**静态可读**，不用挂载）
 *
 * · 注册到 **App 级**槽位/布局/设置页/主题（`sidebar` / `layout` / `settings` / `theme` /
 *   `ui-settings-*` 这类）⇒ **全局型** ✗
 * · 注册到**局部**位置（如 `conversation.input.right`）⇒ **局部/连接级** ✓
 * · **没有 `dsh.client`**（纯能力）⇒ **能力型** ✓
 *
 * ## ⚠️ 它是**启发式**，不是裁决
 *
 * 只读客户端源码里的**槽位名字符串** ⇒ 会漏判/误判 ✓。
 * 所以它只用来**标注**（"不建议"），**不用来阻断** ✗ ——
 * 用户仍可以挂，只是事先知道"这张卡天生不是卡片材料" ✓。
 * （对端点明：**用户看不出"哪张卡天生不是卡片材料"，逐个试才发现的成本最高** ✓。）
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readClientArtifact } from './client-artifact.js';
/**
 * **App 级（全局）槽位名**：命中这些 ⇒ 这张卡是"为全局而生"的 ✗。
 *
 * 判据保守：只认**能明确指向 App 级布局/设置/主题**的名字 ✓，
 * 拿不准的一律不判全局（宁可漏判，也不要把局部挂件误标成全局 ✗）。
 */
const GLOBAL_SLOT_HINTS = [
    'sidebar',
    'layout',
    'titlebar',
    'statusbar',
    'menubar',
    'theme',
    'ui-settings',
    'settings',
    'app.',
    'workspace.tab',
    'nav.',
];
/** 局部（连接级）槽位名的一眼可辨前缀。 */
const LOCAL_SLOT_HINTS = ['conversation.', 'message.', 'input.', 'session.', 'composer.', 'card.'];
/**
 * 从客户端源码里抠出"像槽位名"的字符串字面量。
 *
 * ⚠️ **两条来源缺一不可**（负控抓出来的）：
 *
 *   ① **注册调用位置**的字符串：`slots.register('sidebar', …)` / `slots.get('x')` 之类 ✓
 *      —— 这一条能抓到**单词槽位名**（`sidebar`）✗
 *   ② 形如 `a.b` 的**带点小写标识符** ✓ —— 抓那些不以调用形式出现、直接写在配置里的名字 ✓
 *
 * 第一版**只有第 ② 条** ⇒ `'sidebar'`（无点）被整类漏掉 ✗ ⇒
 * 用户点名的那张全局卡会被判成 `unclear` ✗。
 * 是**负控**（"应当不通过"的样本）把它照出来的 ✓ —— 与 `import '@pkg/x'` 那次同一个形状 ✓。
 */
function slotNamesIn(source) {
    const out = new Set();
    /** ① 注册/取用调用的第一个参数（DSH 的槽位名就从这儿来）。 */
    for (const m of source.matchAll(/(?:slots?\s*\.\s*(?:register|add|get|contribute|mount)|register(?:Slot|UI)?|contributes?)\s*\(\s*['"`]([^'"`\r\n]+)['"`]/g)) {
        out.add(m[1]);
    }
    /** ② 带点的小写标识符（配置里直接写的槽位名）。 */
    for (const m of source.matchAll(/['"`]([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)['"`]/g)) {
        const name = m[1];
        /** 排除明显的非槽位（文件路径 / 扩展名 / 域名）。 */
        if (/\.(js|mjs|cjs|ts|tsx|json|css|png|svg|md)$/.test(name))
            continue;
        if (/^\d/.test(name) || name.includes('//'))
            continue;
        out.add(name);
    }
    return [...out];
}
/** 判定一张卡片的适格性（**只读**：不动磁盘、不挂载、不联网）。 */
export function analyzeSuitability(cardDir, hasClient) {
    const artifact = readClientArtifact(cardDir);
    const withClient = hasClient ?? artifact.ok;
    if (!withClient) {
        return {
            scope: 'capability',
            why: '纯能力卡（没有客户端 UI）—— 挂到连接上只提供工具/事件，正是卡片的本职 ✓',
            globalHits: [],
        };
    }
    /** 有客户端制品但读不到源码：判不出（诚实说"判不出"，不猜）。 */
    if (!artifact.ok) {
        return {
            scope: 'unclear',
            why: `这张卡声明了客户端 UI，但读不到它的源码（${artifact.reason}）—— 无法判断作用域`,
            globalHits: [],
        };
    }
    /** 走到这里 `ok === true` ⇒ `source` 一定有 ✓（上面的分支已排除）。 */
    const slots = slotNamesIn(artifact.source ?? '');
    const globalHits = slots.filter((s) => GLOBAL_SLOT_HINTS.some((h) => s === h || s.startsWith(h)));
    const localHits = slots.filter((s) => LOCAL_SLOT_HINTS.some((h) => s.startsWith(h)));
    if (globalHits.length > 0) {
        return {
            scope: 'global',
            why: `**全局 UI**（注册到 App 级位置：${globalHits.slice(0, 3).join(' / ')}）—— ` +
                `这类插件是为"装到 App 上"设计的，挂到**某条连接**上既装不下、也会和 App 布局打架。` +
                `挂得上也不建议 ✗`,
            globalHits,
        };
    }
    if (localHits.length > 0) {
        return {
            scope: 'local',
            why: `局部 UI（注册到连接级位置：${localHits.slice(0, 3).join(' / ')}）—— 适合当卡片 ✓`,
            globalHits: [],
        };
    }
    /** 有 UI、但槽位名既不像全局也不像局部 ⇒ **不猜**。 */
    return {
        scope: 'unclear',
        why: `有客户端 UI，但没读到能定作用域的槽位名` +
            (slots.length > 0 ? `（读到 ${slots.length} 个候选名，都不匹配已知模式）` : '') +
            ` —— 能不能当卡片要挂一次才知道`,
        globalHits: [],
    };
}
/** 面板徽标的文案与语气（**一处定义**，避免 UI 与判定脱节）。 */
export function suitabilityBadge(s) {
    switch (s.scope) {
        case 'capability':
            return { text: '能力', kind: 'ok' };
        case 'local':
            return { text: '局部', kind: 'ok' };
        case 'global':
            return { text: '全局', kind: 'warn' };
        default:
            return { text: '未判定', kind: 'muted' };
    }
}
/** 诊断用：这张卡目录里有没有构建产物（`src/` 有、`lib/` 无 ⇒ 源码包）。 */
export function looksLikeSourceOnly(dir) {
    try {
        return existsSync(join(dir, 'src')) && !existsSync(join(dir, 'lib'));
    }
    catch {
        return false;
    }
}
/** 读一个小文件的安全包装（判定用，失败就当读不到）。 */
export function readIfExists(file) {
    try {
        return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=suitability.js.map