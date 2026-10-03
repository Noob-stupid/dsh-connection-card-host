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

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** 垫片的 `node_modules` 里的"这是我们的目录"标记 —— 没有它就不敢往里写。 */
export const SHIM_MARKER = '.ccr-shim.json'

/** 三类说明符。 */
export type SpecifierKind = 'builtin' | 'dsh' | 'third-party'

/** 一个 DSH 包的解析结果。 */
export interface DshShimEntry {
  /** 包名，如 `@deepseek-ai/dsh-tools`。 */
  pkg: string
  /** `real` = 复用了真模块；`facade` = 用了能力门面。 */
  tier: 'real' | 'facade' | 'none'
  /** tier=real 时的真模块路径。 */
  realPath?: string
  /** tier=none 时说明为什么（没有门面可用、也拿不到真模块）。 */
  reason?: string
}

/** 一个第三方包的处理结果。 */
export interface ThirdPartyEntry {
  pkg: string
  /** 解析到的真实目录；未解析到时为 undefined。 */
  resolvedDir?: string
}

/** 一次垫片规划的结果。 */
export interface ShimPlan {
  /** 垫片根（`node_modules` 的父目录）。 */
  shimRoot: string
  dsh: DshShimEntry[]
  thirdParty: ThirdPartyEntry[]
  /** 扫到的全部裸说明符（供审计）。 */
  scanned: string[]
}

/**
 * 有门面的 DSH 包。
 *
 * ⚠️ 这张表就是"我们替 DSH 提供了什么"的**白名单** —— 新增一项都要想清楚
 * 门面是否忠实（见 `facade.ts` 的忠实度说明）。表外的 DSH 包一律 `none`。
 */
const FACADE_MODULES: Record<string, string> = {
  // 包名 → 门面模块的相对路径（相对 lib/adapter/）
  '@deepseek-ai/dsh-tools': './facade.js',
  '@deepseek-ai/schemastery': './facade.js',
}

/** 门面模块里，各包对应的导出形态。 */
const FACADE_EXPORTS: Record<string, { named: string[]; hasDefault: boolean }> = {
  '@deepseek-ai/dsh-tools': { named: ['defineTool'], hasDefault: false },
  '@deepseek-ai/schemastery': { named: [], hasDefault: true },
}

const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

/** 判断一个说明符属于哪一类。 */
export function classifySpecifier(spec: string): SpecifierKind | 'relative' | 'unknown' {
  if (spec.startsWith('node:')) return 'builtin'
  if (BUILTIN.has(spec)) return 'builtin'
  if (spec.startsWith('.')) return 'relative'
  if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) return 'unknown'
  if (spec.startsWith('@deepseek-ai/')) return 'dsh'
  // `@scope/name` 或 `name`
  if (/^(@[^/]+\/)?[^/]+$/.test(spec)) return 'third-party'
  return 'unknown'
}

/** 从包名取**包根名**（`@scope/pkg/sub` → `@scope/pkg`；`pkg/sub` → `pkg`）。 */
export function packageRootOf(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

/**
 * 扫一个插件目录里用到的**裸说明符**（去重）。
 *
 * 有界：跳过 `node_modules`、只扫代码文件、限制文件数与文件大小 ——
 * 这是个体检/规划用的扫描，不是打包器。
 */
export function scanBareSpecifiers(
  pluginDir: string,
  options: { maxFiles?: number; maxBytes?: number } = {},
): string[] {
  const maxFiles = options.maxFiles ?? 400
  const maxBytes = options.maxBytes ?? 512 * 1024
  const found = new Set<string>()

  const walk = (dir: string, base: string): void => {
    if (found.size > 200) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue
        walk(full, base)
        continue
      }
      if (!/\.(mjs|cjs|js|ts)$/.test(name)) continue
      if (found.size > maxFiles) return
      if (st.size > maxBytes) continue
      let text: string
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      // 静态 import / export ... from / 动态 import('...') / require('...')
      const re = /(?:^|[\s;{(])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
      for (const m of text.matchAll(re)) {
        const spec = m[1] ?? m[2] ?? m[3]
        if (spec) found.add(spec)
      }
    }
  }

  walk(pluginDir, pluginDir)
  return [...found].sort()
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
export function resolveRealModule(pkg: string, fromDir: string): string | undefined {
  try {
    const req = createRequire(join(fromDir, '__ccr_probe__.cjs'))
    const resolved = req.resolve(pkg)
    if (existsSync(resolved)) return resolved
    return undefined
  } catch {
    return undefined
  }
}

/** 某个 DSH 包有没有门面。 */
export function hasFacade(pkg: string): boolean {
  return pkg in FACADE_MODULES
}

/**
 * 规划垫片：扫说明符 → 分类 → 逐个定档。
 *
 * @param pluginDir 插件的当前所在目录（用来解析它自己的依赖）
 * @param shimRoot  垫片根（其下的 `node_modules` 会被创建）
 * @param depSourceDir 第三方依赖从哪里解析；默认同 pluginDir
 *        —— 卡片被拷进 `cards/` 后，依赖往往要从**原安装位置**解析，故可分开指定。
 */
export function planShims(
  pluginDir: string,
  shimRoot: string,
  depSourceDir?: string,
): ShimPlan {
  const scanned = scanBareSpecifiers(pluginDir)
  const depFrom = depSourceDir ?? pluginDir

  const dsh: DshShimEntry[] = []
  const thirdParty: ThirdPartyEntry[] = []
  const seenDsh = new Set<string>()
  const seenThird = new Set<string>()

  for (const spec of scanned) {
    const kind = classifySpecifier(spec)
    if (kind === 'builtin' || kind === 'relative' || kind === 'unknown') continue

    if (kind === 'dsh') {
      const pkg = packageRootOf(spec)
      if (seenDsh.has(pkg)) continue
      seenDsh.add(pkg)

      const realPath = resolveRealModule(pkg, depFrom)
      if (realPath) {
        dsh.push({ pkg, tier: 'real', realPath })
      } else if (hasFacade(pkg)) {
        dsh.push({ pkg, tier: 'facade' })
      } else {
        dsh.push({
          pkg,
          tier: 'none',
          reason:
            '既拿不到真模块，也没有对应的能力门面 —— 该包不在门面白名单里。' +
            '新增门面前请先确认能忠实复刻它的契约（见 facade.ts 的忠实度说明）。',
        })
      }
      continue
    }

    // 第三方包
    const pkg = packageRootOf(spec)
    if (seenThird.has(pkg)) continue
    seenThird.add(pkg)

    const realPath = resolveRealModule(pkg, depFrom)
    if (realPath) {
      // 解析到的是入口文件，取其包根目录
      let dir = dirname(realPath)
      while (dir !== dirname(dir)) {
        if (existsSync(join(dir, 'package.json'))) break
        dir = dirname(dir)
      }
      thirdParty.push({ pkg, resolvedDir: dir })
    } else {
      thirdParty.push({ pkg })
    }
  }

  return { shimRoot, dsh, thirdParty, scanned }
}

/** 规划里**没法解决**的东西（调用方据此拒绝挂载并说清缺什么）。 */
export function unresolvedOf(plan: ShimPlan): string[] {
  const out: string[] = []
  for (const d of plan.dsh) if (d.tier === 'none') out.push(`${d.pkg}（无门面、也拿不到真模块）`)
  for (const t of plan.thirdParty) if (!t.resolvedDir) out.push(`${t.pkg}（第三方依赖未解析到）`)
  return out
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
export function writeShims(
  plan: ShimPlan,
  facadeBaseDir: string,
): { written: number; skipped: number; linked: number } {
  const nm = join(plan.shimRoot, 'node_modules')
  /**
   * ⚠️ 标记的层级很关键：垫片**根**（例如 `…/connection-cards/cards/`）
   * 本来就该已经存在 —— 里面装着各个卡片目录。我们真正拥有的是它的
   * `node_modules/` 那一层。所以判定与标记都放在 `node_modules` 上，
   * 而不是整个根目录上：否则每次挂载都会被自己的安全检查拦住（实测踩到）。
   */
  const marker = join(nm, SHIM_MARKER)

  if (existsSync(nm) && !existsSync(marker)) {
    throw new Error(
      `拒绝写入垫片：${nm} 已存在但没有本工具的标记文件（${SHIM_MARKER}）。` +
        `这个 node_modules 可能属于别的程序 —— 换个位置，或先人工确认后删除它。`,
    )
  }

  mkdirSync(nm, { recursive: true })
  writeFileSync(
    marker,
    JSON.stringify(
      {
        tool: 'dsh-connection-card-host/adapter',
        note: '垫片目录：由适配层生成；删掉它可安全重建（不影响卡片本身）',
      },
      null,
      2,
    ),
    'utf8',
  )

  let written = 0
  let skipped = 0
  let linked = 0

  // ── DSH 包：re-export 真模块，或用门面 ──
  for (const entry of plan.dsh) {
    if (entry.tier === 'none') continue
    const dir = join(nm, ...entry.pkg.split('/'))
    mkdirSync(dir, { recursive: true })

    const facadeAbs = resolve(facadeBaseDir, FACADE_MODULES[entry.pkg] ?? './facade.js')
    let body: string
    let tierNote: string

    if (entry.tier === 'real' && entry.realPath) {
      const url = pathToFileURL(entry.realPath).href
      body =
        `// 垫片：复用**真模块**（与 DSH 同一份实例，ESM 按 URL 缓存）\n` +
        `export * from ${JSON.stringify(url)}\n` +
        `import __def from ${JSON.stringify(url)}\nexport default __def\n`
      tierNote = `real → ${entry.realPath}`
    } else {
      const spec = FACADE_EXPORTS[entry.pkg]
      const url = pathToFileURL(facadeAbs).href
      const named = spec?.named ?? []
      body =
        `// 垫片：**能力门面**（真模块取不到时使用；差异见 src/adapter/facade.ts 文件头）\n` +
        (named.length > 0
          ? `export { ${named.join(', ')} } from ${JSON.stringify(url)}\n`
          : '') +
        (spec?.hasDefault
          ? `export { Schema as default } from ${JSON.stringify(url)}\n`
          : '') +
        `export const __facade = true\n`
      tierNote = `facade → ${FACADE_MODULES[entry.pkg]}`
    }

    const pkgJson = {
      name: entry.pkg,
      version: '0.0.0-ccr-shim',
      type: 'module',
      main: 'index.mjs',
      exports: { '.': './index.mjs', './package.json': './package.json' },
      // 让"这份东西是谁生成的"在包里也能读到
      ccrShim: { tier: entry.tier, note: tierNote },
    }

    const files: [string, string][] = [
      [join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n'],
      [join(dir, 'index.mjs'), body],
    ]
    for (const [path, content] of files) {
      const prev = existsSync(path) ? readFileSync(path, 'utf8') : undefined
      if (prev === content) {
        skipped++
      } else {
        writeFileSync(path, content, 'utf8')
        written++
      }
    }
  }

  // ── 第三方包：只能链真实副本 ──
  for (const entry of plan.thirdParty) {
    if (!entry.resolvedDir) continue
    const dir = join(nm, ...entry.pkg.split('/'))
    if (existsSync(dir)) {
      skipped++
      continue
    }
    mkdirSync(dirname(dir), { recursive: true })
    try {
      // Windows 上 junction 对目录可用且不需要管理员权限
      symlinkSync(entry.resolvedDir, dir, 'junction')
      linked++
    } catch (e) {
      throw new Error(
        `第三方依赖 ${entry.pkg} 链接失败：${String(e)}。` +
          `源目录 ${entry.resolvedDir} —— 若它不可访问，请确认该插件装在哪里。`,
      )
    }
  }

  return { written, skipped, linked }
}

/** 一行摘要，供审计。 */
export function describePlan(plan: ShimPlan): string {
  const dsh = plan.dsh
    .map((d) => `${d.pkg.split('/').pop()}=${d.tier}`)
    .join(' ')
  const third = plan.thirdParty
    .map((t) => `${t.pkg}=${t.resolvedDir ? 'linked' : '**缺失**'}`)
    .join(' ')
  return `shimRoot=${plan.shimRoot} dsh[${dsh || '无'}] 第三方[${third || '无'}]`
}

/** 清理垫片（回退/排错用）。只删带标记的 `node_modules`。 */
export function removeShimRoot(shimRoot: string): boolean {
  const nm = join(shimRoot, 'node_modules')
  if (!existsSync(join(nm, SHIM_MARKER))) return false
  rmSync(nm, { recursive: true, force: true })
  return true
}
