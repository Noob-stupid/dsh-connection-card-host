/**
 * 垫片层 —— 让**普通 DSH 插件**在卡片目录里能被 import。
 *
 * ## 为什么需要（F1，已用真运行验证）
 *
 * 卡片运行时是裸 `import(url)`，没有解析钩子。插件入口在模块顶层写
 * `import { defineTool } from '@deepseek-ai/dsh-tools'`，而卡片目录向上逐级找
 * `node_modules` 时**够不到 DSH 的包** ⇒ 直接 `ERR_MODULE_NOT_FOUND`。
 *
 * ## 做法：在 `cards/` 与插件之间插一层 `node_modules`
 *
 *     <cardsRoot>/node_modules/@deepseek-ai/dsh-tools/     ← 本文件生成
 *     <cardsRoot>/node_modules/playwright-core/            ← 指向真实副本
 *     <cardsRoot>/<id>@<ver>-<fp>/lib/index.js             ← 插件（已装好的卡片）
 *
 * Node 从插件文件向上找：`<卡片目录>/node_modules`（一般没有）→ **`<cardsRoot>/node_modules`** ✓
 *
 * 这一层对**所有**适配卡共用，装一次就够，且与 DSH 的 profile **毫无关系**
 * —— 隔离承诺不变（`adapter-design.md` 护栏①）。
 *
 * ## 三类说明符，三种处理
 *
 * | 类别 | 例子 | 处理 |
 * |:--|:--|:--|
 * | node 内置 | `node:fs` | 不处理，Node 自己认 |
 * | DSH 包 | `@deepseek-ai/dsh-tools` | **两档**：能拿到真模块就 `re-export`；拿不到就用能力门面 |
 * | 第三方包 | `playwright-core` | **链接真实副本**（没法造假对象）—— 从 `depSourceDir` 解析 |
 *
 * ## 拿不到的东西要**说出来**，不能装作没事
 *
 * 第三方依赖解析不到 ⇒ 记进 `unresolved`，由调用方**明确拒绝挂载**并说清缺什么。
 * 静默继续会让插件在用到那个依赖时才炸，而那时的报错与真实原因隔着好几层。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';
import { readClientArtifact } from '../card-host/client-artifact.js';
import { pathToFileURL } from 'node:url';
/** 垫片的 `node_modules` 里的"这是我们的目录"标记 —— 没有它就不敢往里写。 */
export const SHIM_MARKER = '.ccr-shim.json';
/**
 * 有门面的 DSH 包。
 *
 * ⚠️ 这张表就是"我们替 DSH 提供了什么"的**白名单** —— 新增一项都要想清楚
 * 门面是否忠实（见 `facade.ts` 的忠实度说明）。表外的 DSH 包一律 `none`。
 */
const FACADE_MODULES = {
    // 包名 → 门面模块的相对路径（相对 lib/adapter/）
    '@deepseek-ai/dsh-tools': './facade.js',
    '@deepseek-ai/schemastery': './facade.js',
};
/** 门面模块里，各包对应的导出形态。 */
const FACADE_EXPORTS = {
    '@deepseek-ai/dsh-tools': { named: ['defineTool'], hasDefault: false },
    '@deepseek-ai/schemastery': { named: [], hasDefault: true },
};
const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
/** 判断一个说明符属于哪一类。 */
export function classifySpecifier(spec) {
    if (spec.startsWith('node:'))
        return 'builtin';
    if (BUILTIN.has(spec))
        return 'builtin';
    if (spec.startsWith('.'))
        return 'relative';
    if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec))
        return 'unknown';
    if (spec.startsWith('@deepseek-ai/'))
        return 'dsh';
    // `@scope/name` 或 `name`
    if (/^(@[^/]+\/)?[^/]+$/.test(spec))
        return 'third-party';
    return 'unknown';
}
/** 从包名取**包根名**（`@scope/pkg/sub` → `@scope/pkg`；`pkg/sub` → `pkg`）。 */
export function packageRootOf(spec) {
    const parts = spec.split('/');
    return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
/**
 * 扫一个插件目录里用到的**裸说明符**（去重）。
 *
 * 有界：跳过 `node_modules`、只扫代码文件、限制文件数与文件大小 ——
 * 这是个体检/规划用的扫描，不是打包器。
 *
 * ## ⚠️ 为什么要能**跳过客户端产物**（实测踩到的假拒绝）
 *
 * 浏览器产物（`lib/client.js` 之类）里的 `require('react')` 是给**浏览器的模块表**用的 ✗ ——
 * 在**宿主侧**解析它**没有意义** ✗。而本函数原先扫整个插件目录 ⇒ 把这类依赖也算成
 * "宿主侧必须可解析" ⇒ **两张完全正常的插件都被假拒绝**（`react（第三方依赖未解析到）`）✗✗。
 *
 * 症状极具误导性：它看起来像"依赖没装"，实际是"**我们在用错误的解析面要求它**" ✗。
 *
 * @param options.skip 相对 `pluginDir` 的文件路径（正斜杠），不参与扫描
 */
export function scanBareSpecifiers(pluginDir, options = {}) {
    const maxFiles = options.maxFiles ?? 400;
    const maxBytes = options.maxBytes ?? 512 * 1024;
    /** **跳过集合**：相对 `pluginDir` 的正斜杠路径（客户端产物走这里排除）。 */
    const skip = options.skip ?? new Set();
    const found = new Set();
    const walk = (dir, base) => {
        if (found.size > 200)
            return;
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const name of entries) {
            const full = join(dir, name);
            let st;
            try {
                st = statSync(full);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                if (name === 'node_modules' || name === '.git')
                    continue;
                walk(full, base);
                continue;
            }
            if (!/\.(mjs|cjs|js|ts)$/.test(name))
                continue;
            /**
             * ⚠️ **客户端产物不参与宿主侧依赖规划**（见函数头说明）——
             * 它里面的 `require('react')` 是给浏览器模块表的，宿主侧解析它没有意义，
             * 强行要求只会把正常插件判成"依赖缺失" ✗。
             *
             * ⚠️ 键必须**相对 `pluginDir`**：`walk` 的 `base` 起手就是**绝对路径** ✗
             * （第一版直接用 `join(base, name)` ⇒ 永远匹配不上 ⇒ 修复看似生效实则没有 ✗）。
             */
            if (skip.has(relative(pluginDir, full).split('\\').join('/')))
                continue;
            if (found.size > maxFiles)
                return;
            if (st.size > maxBytes)
                continue;
            let text;
            try {
                text = readFileSync(full, 'utf8');
            }
            catch {
                continue;
            }
            /**
             * 静态 import（含 `from`）/ **副作用导入**（无 `from`）/ 动态 import / require。
             *
             * ⚠️ **副作用导入必须单独一条**（`import '@pkg/x'`）——
             * 第一版的三条分支全都要求 `from '...'` 或括号形式 ✗ ⇒ **这种写法被整类漏掉** ✗。
             * 这不是理论风险：库里到处都是 `import 'core-js/stable'` 这类写法 ✓。
             *
             * 抓出来的方式值得一提：是**负控**（"应当不通过"的样本）把它照出来的 ——
             * 正控当时全绿 ✓。⇒ **对端点明的纪律当场见效**：
             * 只证明"它这次没报错"是不够的，还要证明"**它该报的时候还会报**"。
             */
            const re = /(?:^|[\s;{(])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;{(])import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            for (const m of text.matchAll(re)) {
                const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
                if (spec)
                    found.add(spec);
            }
        }
    };
    walk(pluginDir, pluginDir);
    return [...found].sort();
}
/**
 * 试着把一个 DSH 包解析到**真模块**。
 *
 * 从 `fromDir` 出发用 `createRequire` 解析（CJS 侧解析器，对已安装包最可靠），
 * 解析成功且目标文件存在才算 `real`。
 *
 * ⚠️ 解析到"源码检出"是常见的坑：路径存在、但 `lib/index.js` 没构建出来。
 * 所以这里**必须检查文件真的可读**，不能只看解析结果。
 */
export function resolveRealModule(pkg, fromDir) {
    try {
        const req = createRequire(join(fromDir, '__ccr_probe__.cjs'));
        const resolved = req.resolve(pkg);
        if (existsSync(resolved))
            return resolved;
        return undefined;
    }
    catch {
        return undefined;
    }
}
/** 某个 DSH 包有没有门面。 */
export function hasFacade(pkg) {
    return pkg in FACADE_MODULES;
}
/**
 * 规划垫片：扫说明符 → 分类 → 逐个定档。
 *
 * @param pluginDir 插件的当前所在目录（用来解析它自己的依赖）
 * @param shimRoot  垫片根（其下的 `node_modules` 会被创建）
 * @param depSourceDir 第三方依赖从哪里解析；默认同 pluginDir
 *        —— 卡片被拷进 `cards/` 后，依赖往往要从**原安装位置**解析，故可分开指定。
 */
export function planShims(pluginDir, shimRoot, depSourceDir) {
    /**
     * ⚠️ **把客户端产物排除在宿主侧依赖规划之外**（实测踩到的假拒绝 —— 见 `scanBareSpecifiers` 的说明）。
     *
     * 客户端的 `require('react')` 由**浏览器的模块表**满足；在宿主侧要求它可解析，
     * 会把两张完全正常的插件都判成"第三方依赖未解析到" ✗（症状还极具误导性：
     * 看起来像"依赖没装"，实际是"我们在用错误的解析面要求它"）。
     */
    const clientEntry = readClientArtifact(pluginDir).entry;
    const skip = new Set(clientEntry ? [clientEntry.split('\\').join('/')] : []);
    const scanned = scanBareSpecifiers(pluginDir, { skip });
    const depFrom = depSourceDir ?? pluginDir;
    const dsh = [];
    const thirdParty = [];
    const seenDsh = new Set();
    const seenThird = new Set();
    for (const spec of scanned) {
        const kind = classifySpecifier(spec);
        if (kind === 'builtin' || kind === 'relative' || kind === 'unknown')
            continue;
        if (kind === 'dsh') {
            const pkg = packageRootOf(spec);
            if (seenDsh.has(pkg))
                continue;
            seenDsh.add(pkg);
            const realPath = resolveRealModule(pkg, depFrom);
            if (realPath) {
                dsh.push({ pkg, tier: 'real', realPath });
            }
            else if (hasFacade(pkg)) {
                dsh.push({ pkg, tier: 'facade' });
            }
            else {
                dsh.push({
                    pkg,
                    tier: 'none',
                    reason: '既拿不到真模块，也没有对应的能力门面 —— 该包不在门面白名单里。' +
                        '新增门面前请先确认能忠实复刻它的契约（见 facade.ts 的忠实度说明）。',
                });
            }
            continue;
        }
        // 第三方包
        const pkg = packageRootOf(spec);
        if (seenThird.has(pkg))
            continue;
        seenThird.add(pkg);
        const realPath = resolveRealModule(pkg, depFrom);
        if (realPath) {
            // 解析到的是入口文件，取其包根目录
            let dir = dirname(realPath);
            while (dir !== dirname(dir)) {
                if (existsSync(join(dir, 'package.json')))
                    break;
                dir = dirname(dir);
            }
            thirdParty.push({ pkg, resolvedDir: dir });
        }
        else {
            thirdParty.push({ pkg });
        }
    }
    return { shimRoot, dsh, thirdParty, scanned };
}
/** 规划里**没法解决**的东西（调用方据此拒绝挂载并说清缺什么）。 */
export function unresolvedOf(plan) {
    const out = [];
    for (const d of plan.dsh)
        if (d.tier === 'none')
            out.push(`${d.pkg}（无门面、也拿不到真模块）`);
    for (const t of plan.thirdParty)
        if (!t.resolvedDir)
            out.push(`${t.pkg}（第三方依赖未解析到）`);
    return out;
}
/**
 * 写垫片。
 *
 * 安全规则（都很实在）：
 *   1. `shimRoot` 已存在但**没有我们的标记** ⇒ **拒绝写入** ——
 *      绝不能往可能属于别人的目录里塞文件。
 *   2. 幂等：内容相同就不重写（避免无谓的 mtime 变动与文件锁）。
 *   3. 只动 `node_modules/<包名>` 这一层，不碰别的。
 */
export function writeShims(plan, facadeBaseDir) {
    const nm = join(plan.shimRoot, 'node_modules');
    /**
     * ⚠️ 标记的层级很关键：垫片**根**（例如 `…/connection-cards/cards/`）
     * 本来就该已经存在 —— 里面装着各个卡片目录。我们真正拥有的是它的
     * `node_modules/` 那一层。所以判定与标记都放在 `node_modules` 上，
     * 而不是整个根目录上：否则每次挂载都会被自己的安全检查拦住（实测踩到）。
     */
    const marker = join(nm, SHIM_MARKER);
    if (existsSync(nm) && !existsSync(marker)) {
        throw new Error(`拒绝写入垫片：${nm} 已存在但没有本工具的标记文件（${SHIM_MARKER}）。` +
            `这个 node_modules 可能属于别的程序 —— 换个位置，或先人工确认后删除它。`);
    }
    mkdirSync(nm, { recursive: true });
    writeFileSync(marker, JSON.stringify({
        tool: 'dsh-connection-card-host/adapter',
        note: '垫片目录：由适配层生成；删掉它可安全重建（不影响卡片本身）',
    }, null, 2), 'utf8');
    let written = 0;
    let skipped = 0;
    let linked = 0;
    // ── DSH 包：re-export 真模块，或用门面 ──
    for (const entry of plan.dsh) {
        if (entry.tier === 'none')
            continue;
        const dir = join(nm, ...entry.pkg.split('/'));
        mkdirSync(dir, { recursive: true });
        const facadeAbs = resolve(facadeBaseDir, FACADE_MODULES[entry.pkg] ?? './facade.js');
        let body;
        let tierNote;
        if (entry.tier === 'real' && entry.realPath) {
            const url = pathToFileURL(entry.realPath).href;
            body =
                `// 垫片：复用**真模块**（与 DSH 同一份实例，ESM 按 URL 缓存）\n` +
                    `export * from ${JSON.stringify(url)}\n` +
                    `import __def from ${JSON.stringify(url)}\nexport default __def\n`;
            tierNote = `real → ${entry.realPath}`;
        }
        else {
            const spec = FACADE_EXPORTS[entry.pkg];
            const url = pathToFileURL(facadeAbs).href;
            const named = spec?.named ?? [];
            body =
                `// 垫片：**能力门面**（真模块取不到时使用；差异见 src/adapter/facade.ts 文件头）\n` +
                    (named.length > 0
                        ? `export { ${named.join(', ')} } from ${JSON.stringify(url)}\n`
                        : '') +
                    (spec?.hasDefault
                        ? `export { Schema as default } from ${JSON.stringify(url)}\n`
                        : '') +
                    `export const __facade = true\n`;
            tierNote = `facade → ${FACADE_MODULES[entry.pkg]}`;
        }
        const pkgJson = {
            name: entry.pkg,
            version: '0.0.0-ccr-shim',
            type: 'module',
            main: 'index.mjs',
            exports: { '.': './index.mjs', './package.json': './package.json' },
            // 让"这份东西是谁生成的"在包里也能读到
            ccrShim: { tier: entry.tier, note: tierNote },
        };
        const files = [
            [join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n'],
            [join(dir, 'index.mjs'), body],
        ];
        for (const [path, content] of files) {
            const prev = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
            if (prev === content) {
                skipped++;
            }
            else {
                writeFileSync(path, content, 'utf8');
                written++;
            }
        }
    }
    // ── 第三方包：只能链真实副本 ──
    for (const entry of plan.thirdParty) {
        if (!entry.resolvedDir)
            continue;
        const dir = join(nm, ...entry.pkg.split('/'));
        if (existsSync(dir)) {
            skipped++;
            continue;
        }
        mkdirSync(dirname(dir), { recursive: true });
        try {
            // Windows 上 junction 对目录可用且不需要管理员权限
            symlinkSync(entry.resolvedDir, dir, 'junction');
            linked++;
        }
        catch (e) {
            throw new Error(`第三方依赖 ${entry.pkg} 链接失败：${String(e)}。` +
                `源目录 ${entry.resolvedDir} —— 若它不可访问，请确认该插件装在哪里。`);
        }
    }
    return { written, skipped, linked };
}
/** 一行摘要，供审计。 */
export function describePlan(plan) {
    const dsh = plan.dsh
        .map((d) => `${d.pkg.split('/').pop()}=${d.tier}`)
        .join(' ');
    const third = plan.thirdParty
        .map((t) => `${t.pkg}=${t.resolvedDir ? 'linked' : '**缺失**'}`)
        .join(' ');
    return `shimRoot=${plan.shimRoot} dsh[${dsh || '无'}] 第三方[${third || '无'}]`;
}
/** 清理垫片（回退/排错用）。只删带标记的 `node_modules`。 */
export function removeShimRoot(shimRoot) {
    const nm = join(shimRoot, 'node_modules');
    if (!existsSync(join(nm, SHIM_MARKER)))
        return false;
    rmSync(nm, { recursive: true, force: true });
    return true;
}
//# sourceMappingURL=shim.js.map