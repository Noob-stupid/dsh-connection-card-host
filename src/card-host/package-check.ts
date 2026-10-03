/**
 * 安装包体检 —— **两种来源都要能装**。
 *
 * ## 为什么要支持两种
 *
 * 用户的原话点破了这件事：
 *
 *   > 肯定是要可以装普通 dsh 插件包啊，因为你经常搜到的会话能力相关的就是普通插件包啊
 *
 * 也就是说：**"能提升会话能力的东西"绝大多数就是普通 DSH 插件**，
 * 而不是专门为我们协议写的卡片包。只收 `dshCard` 等于把最有用的一类挡在门外。
 *
 * ## 两种来源
 *
 * | 来源 | 判别 | 处理 |
 * |:--|:--|:--|
 * | **卡片包** | 自带 `dshCard` 字段 | 照原样（现状不动） |
 * | **普通 DSH 插件包** | 没有 `dshCard`，但像 DSH 插件 | **合成适配清单**，按**适配卡**装载 |
 *
 * ## "像 DSH 插件"的判据（任一命中）
 *
 *   1. 有 `dsh` 字段（dsh.bundle.patch —— 官方插件形态）
 *   2. peerDependencies 里声明了 `@deepseek-ai/*`
 *   3. 入口源码里 import 了 `@deepseek-ai/*`
 *
 * 第 3 条是**最实在**的一条：前两条是"自称"，这一条是"实际依赖"。
 *
 * ## 合成出来的清单长什么样
 *
 * ```jsonc
 * "dshCard": {
 *   "id": "<包名>",
 *   "name": "<包名>",
 *   "entry": "<main 或 lib/index.js>",
 *   "adapter": { "capabilities": ["tools", "effect"] }   // 最小能力面
 * }
 * ```
 *
 * 能力面**只报最小集**（`tools` + `effect`）是刻意的：
 * 我们无法静态推断插件要用什么，与其猜一个大集合，不如报最小的、
 * 让**装载时的申报对账**去拒绝它（`reconcileInjects` 会明确说缺哪个服务）。
 * 那时用户看到的是一句人话，而不是"运行到某一行才炸"。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 体检结果。 */
export interface PackageCheck {
  ok: boolean
  reason?: string
  id?: string
  name?: string
  version?: string
  entry?: string
  /** 来源形态：卡片包 / 普通 DSH 插件包（后者要合成适配清单）。 */
  kind?: 'card' | 'dsh-plugin'
}

/**
 * 合成适配卡清单时用的能力面。
 *
 * ⚠️ 给的是**已实现的全部能力**（tools / effect / llm / prompt），不是最初的最小集。
 * 理由：安装时我们**无法静态推断**插件要用什么；给最小集会让"其实只想用 prompt 的插件"
 * 在装载阶段因未申报而被拒 —— 那是**假拒绝**。而多申报**不会放宽边界**：
 * 影子 ctx 只把申报过的服务交出去，插件用不到的就不碰；真需要未实现的能力
 * （events / agent）时，仍会在 `reconcileInjects` 那一步被明确拒绝。
 */
export const ADAPTER_DEFAULT_CAPABILITIES = ['tools', 'effect', 'llm', 'prompt'] as const

interface PackageJson {
  name?: string
  version?: string
  main?: string
  dsh?: unknown
  dshCard?: { id?: string; name?: string; entry?: string; adapter?: unknown }
  peerDependencies?: Record<string, string>
}

/** 入口源码里是否 import 了 DSH 包（"实际依赖"这条硬判据）。 */
function entryImportsDsh(dir: string, entry: string): boolean {
  const abs = join(dir, entry)
  if (!existsSync(abs)) return false
  try {
    // 只读入口本身：插件通常在入口 import 自己需要的服务
    const text = readFileSync(abs, 'utf8')
    return /from\s*['"]@deepseek-ai\/|require\(\s*['"]@deepseek-ai\//.test(text)
  } catch {
    return false
  }
}

/** 这个包像不像一个普通 DSH 插件（见文件头三条判据）。 */
export function looksLikeDshPlugin(dir: string, pkg: PackageJson, entry: string): boolean {
  if (pkg.dsh && typeof pkg.dsh === 'object') return true
  const peers = pkg.peerDependencies ?? {}
  if (Object.keys(peers).some((k) => k.startsWith('@deepseek-ai/'))) return true
  return entryImportsDsh(dir, entry)
}

/** 解析入口：dshCard.entry → main → 常见约定文件名。 */
function resolveEntry(dir: string, pkg: PackageJson): string | undefined {
  const candidates = [
    pkg.dshCard?.entry,
    pkg.main,
    'lib/index.js',
    'lib/index.mjs',
    'index.mjs',
    'index.js',
  ].filter((c): c is string => typeof c === 'string' && c.length > 0)
  for (const rel of candidates) {
    if (existsSync(join(dir, rel))) return rel
  }
  return undefined
}

/**
 * 体检一个安装来源目录。
 *
 * 两种来源都接受；都不是则给出**能指导下一步**的拒绝理由。
 */
export function checkPackage(dir: string): PackageCheck {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return { ok: false, reason: '包里没有 package.json' }

  let pkg: PackageJson
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson
  } catch (e) {
    return { ok: false, reason: `package.json 不是合法 JSON：${String(e)}` }
  }

  const entry = resolveEntry(dir, pkg)

  // ── 形态一：卡片包（自带 dshCard）──
  if (pkg.dshCard && typeof pkg.dshCard === 'object') {
    const id = pkg.dshCard.id || pkg.name
    if (!id) {
      return { ok: false, reason: 'dshCard.id 与 package.json 的 name 都缺失，无法确定卡片 id' }
    }
    const cardEntry = resolveEntry(dir, pkg)
    if (!cardEntry) {
      return {
        ok: false,
        reason: `找不到入口文件（试过 dshCard.entry / main / lib/index.js / index.js）`,
      }
    }
    return {
      ok: true,
      kind: 'card',
      id: String(id),
      name: pkg.dshCard.name || pkg.name || String(id),
      version: pkg.version,
      entry: cardEntry,
    }
  }

  // ── 形态二：普通 DSH 插件包（合成适配清单）──
  if (!entry) {
    return {
      ok: false,
      reason:
        '既不是卡片包（没有 dshCard），也找不到可加载的入口' +
        '（试过 main / lib/index.js / index.mjs / index.js）。',
    }
  }
  if (!looksLikeDshPlugin(dir, pkg, entry)) {
    return {
      ok: false,
      reason:
        '这个包既不是卡片包（没有 dshCard），也不像一个 DSH 插件包 —— ' +
        'DSH 插件包应当满足其一：有 dsh 字段、peerDependencies 里声明 @deepseek-ai/*、' +
        '或入口里 import 了 @deepseek-ai/*。' +
        '（卡片包请在 dshCard 里声明 id/name/entry；普通 DSH 插件包直接装即可，会自动按适配卡处理。）',
    }
  }
  const id = pkg.name
  if (!id) {
    return { ok: false, reason: 'DSH 插件包缺少 package.json 的 name，无法确定卡片 id' }
  }
  return {
    ok: true,
    kind: 'dsh-plugin',
    id: String(id),
    name: String(id),
    version: pkg.version,
    entry,
  }
}

/**
 * 把合成的适配清单写进**已安装的副本**。
 *
 * ⚠️ 只动 `destDir` —— 也就是我们拷贝出来的那一份；**原始来源一个字节都不碰**。
 * 版本化目录名由来源指纹决定，改副本不影响幂等判断（指纹取自来源，不是副本）。
 *
 * @returns 是否真的写了（已经是适配卡则不动）
 */
export function ensureAdapterManifest(
  destDir: string,
  synth: { id: string; name: string; entry: string },
): { patched: boolean; reason?: string } {
  const pkgPath = join(destDir, 'package.json')
  if (!existsSync(pkgPath)) return { patched: false, reason: '副本里没有 package.json' }

  let pkg: PackageJson
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson
  } catch (e) {
    return { patched: false, reason: `副本 package.json 读不了：${String(e)}` }
  }

  // 已经是卡片包（自带 dshCard）⇒ 不动它
  if (pkg.dshCard && typeof pkg.dshCard === 'object') return { patched: false }

  pkg.dshCard = {
    id: synth.id,
    name: synth.name,
    entry: synth.entry,
    adapter: { capabilities: [...ADAPTER_DEFAULT_CAPABILITIES] },
    // 标记"清单是安装器合成的"，便于排查与面板区分（JSON 没有注释，只能放字段）
    synthesized: true,
  } as PackageJson['dshCard']

  try {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    return { patched: true }
  } catch (e) {
    return { patched: false, reason: `副本 package.json 写不进去：${String(e)}` }
  }
}
