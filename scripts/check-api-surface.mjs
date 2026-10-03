/**
 * **机械护栏**：导出符号集合的前后等式。
 *
 * ## 它在防什么
 *
 * 批量正则替换的**原罪是它不知道"函数的边界"** ——
 * 一次批量替换可能把某个函数从中间切掉，而**构建期不一定报错**
 * （换个位置，语法可能仍然合法、只是行为悄悄变了）。
 *
 * 我实际踩到过一次：批量替换误删了 `urlNote()`，构建期报错救了我 ——
 * 但那是**运气**，不是机制。
 *
 * ## 它怎么工作
 *
 * 从 `src/**` 抓出**导出符号集合**（函数 / 常量 / 类 / 接口 / 类型），
 * 与基线文件 `scripts/api-surface.txt` 比对：
 *
 *   · 集合相同 ⇒ 通过（无论内部怎么改）
 *   · 集合不同 ⇒ **报错**，并列出多了什么、少了什么
 *
 * 于是"从中间切掉一个导出"这类**静默损伤**会当场变成**红灯**。
 * 要故意增删导出时，跑 `node scripts/check-api-surface.mjs --update` 更新基线即可 ——
 * **这个动作是显式的**，正好让人停一下、确认这是有意的。
 *
 * ## 为什么用集合而不是逐字节比对
 *
 * 逐字节比对会被**任何**改动打红（噪声太大 ⇒ 人就会习惯性 `--update` ⇒ 护栏失效）。
 * 只钉**符号集合**，信噪比才对：**它只对"结构性损伤"报警**。
 *
 * 跑法：
 *   node scripts/check-api-surface.mjs            # 校验（CI / npm test 用）
 *   node scripts/check-api-surface.mjs --update   # 有意增删导出后更新基线
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BASELINE = join(ROOT, 'scripts', 'api-surface.txt')

/** 递归收集 src 下的 .ts/.tsx 文件。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else if (/\.tsx?$/u.test(name)) out.push(abs)
  }
  return out
}

/** 抓导出符号：`export function X` / `export const X` / `export class X` / `export interface X` / `export type X`。 */
const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gmu

function collectSurface() {
  const syms = []
  for (const abs of walk(SRC)) {
    const text = readFileSync(abs, 'utf8')
    for (const m of text.matchAll(EXPORT_RE)) {
      syms.push(`${relative(ROOT, abs).replace(/\\/gu, '/')}:${m[1]}`)
    }
  }
  return syms.sort()
}

const current = collectSurface()

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, current.join('\n') + '\n', 'utf8')
  console.log(`已更新导出符号基线：${current.length} 个符号 → ${relative(ROOT, BASELINE)}`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.log('── 没有基线文件（首次运行）')
  console.log(`   跑一次 --update 生成：node scripts/check-api-surface.mjs --update`)
  process.exit(1)
}

const baseline = readFileSync(BASELINE, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

const cur = new Set(current)
const base = new Set(baseline)
const added = current.filter((s) => !base.has(s))
const removed = baseline.filter((s) => !cur.has(s))

if (added.length === 0 && removed.length === 0) {
  console.log(`═══ 导出符号集合未变（${current.length} 个）—— 通过 ═══`)
  process.exit(0)
}

console.log('❌ 导出符号集合变了（这类变化要么是有意的，要么是**批量替换切掉了什么**）：')
if (removed.length > 0) {
  console.log(`   少了 ${removed.length} 个（**重点看这个** —— 静默损伤通常长这样）：`)
  for (const s of removed) console.log(`     - ${s}`)
}
if (added.length > 0) {
  console.log(`   多了 ${added.length} 个：`)
  for (const s of added) console.log(`     + ${s}`)
}
console.log('')
console.log('   确认是有意增删 ⇒ node scripts/check-api-surface.mjs --update')
console.log('   不是有意的 ⇒ 很可能是批量替换越过了函数边界，用 git diff 查回那段。')
process.exit(1)
