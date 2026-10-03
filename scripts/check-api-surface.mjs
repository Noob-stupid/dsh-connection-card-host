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

/**
 * 递归收集 src 下的 .ts/.tsx 文件。
 *
 * ⚠️ **读不到就当"没扫到"，不要抛** —— 抛出去会变成一段堆栈 + 退出码 1，
 * 而下面那道**健全性下限**才能给出真正的结论（"检查本身没跑起来"）。
 * 这条是**故障演练**逼出来的（`drill-observe-failure.mjs`）：
 * 演练第一次跑时，`SRC` 不存在会导致脚本直接崩，压根走不到那句友好提示 ✗。
 */
function walk(dir, out = []) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const abs = join(dir, name)
    try {
      const st = statSync(abs)
      if (st.isDirectory()) walk(abs, out)
      else if (/\.tsx?$/u.test(name)) out.push(abs)
    } catch {
      /* 单个条目读不到：跳过（整体异常由下限发现） */
    }
  }
  return out
}

/**
 * 抓导出符号 **+ arity（参数个数）**。
 *
 * ## 为什么带 arity（对端点明的**边界补丁**）
 *
 * 本护栏能抓：**被切掉 / 被改名 / 新增未申报** 的导出 —— 即"**消失了什么**"。
 * 它**抓不到**："**还在、但被掏空**" —— 函数名不变、函数体被换成 `return null`，
 * 或者**参数个数/顺序被改**（这几种符号集合一模一样）。
 *
 * ⇒ 把 **arity** 也记进基线（形如 `installer.ts:pruneStaleCardDirs/2`）：
 * 仍然**只对"有意改签名"报警**（信噪比不降），但覆盖到"**签名被改**"这一类。
 *
 * ⚠️ 剩下的"同名同参但**体被掏空**"这类**刻意不用护栏覆盖** ——
 * 那正是会把护栏变成噪声的那条路。它靠**测试 + `git diff --stat` 比例审查**兜住。
 *
 * ⚠️ 还有一条判断护栏死活的通用规则（对端给的，写在这儿免得后人加规则时忘）：
 * > **报警必须只对"你要防的那类损伤"报警；
 * > 报警频率高于该类损伤的真实出现率，护栏就会死**
 * > （不是被绕过，是被"例行公事"磨掉 —— 人开始习惯性 `--update`）。
 */
const FUNC_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gmu
/**
 * ⚠️ `u` 标志下**裸 `{` 是语法错误**（`Lone quantifier brackets`）——
 * 我第一次写 `(?:=>|{)` 就是这样，整个脚本直接解析失败 ✗。
 * 带 `u` 的正则里 `{` / `}` 必须转义。
 */
const ARROW_RE =
  /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\s*)?\(([^)]*)\)\s*(?:=>|\{)/gmu
const OTHER_RE = /^export\s+(?:const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gmu

/** 数顶层逗号 ⇒ 参数个数（无参 = 0）。 */
function arityOf(params) {
  const t = String(params ?? '').trim()
  if (t === '') return 0
  let depth = 0
  let n = 1
  for (const ch of t) {
    if ('([{<'.includes(ch)) depth++
    else if (')]}>'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) n++
  }
  return n
}

function collectSurface() {
  const syms = []
  for (const abs of walk(SRC)) {
    const text = readFileSync(abs, 'utf8')
    const rel = relative(ROOT, abs).replace(/\\/gu, '/')
    const seen = new Set()

    for (const m of text.matchAll(FUNC_RE)) {
      seen.add(m[1])
      syms.push(`${rel}:${m[1]}/${arityOf(m[2])}`)
    }
    for (const m of text.matchAll(ARROW_RE)) {
      if (seen.has(m[1])) continue
      seen.add(m[1])
      syms.push(`${rel}:${m[1]}/${arityOf(m[2])}`)
    }
    /** 非函数导出：只记名字（`/n` = not applicable），不制造无意义的噪声。 */
    for (const m of text.matchAll(OTHER_RE)) {
      if (seen.has(m[1])) continue
      seen.add(m[1])
      syms.push(`${rel}:${m[1]}/n`)
    }
  }
  return syms.sort()
}

const current = collectSurface()

/**
 * ⚠️ **观测健全性下限**（这道检查是"被观测手段本身"救的，必须显式）。
 *
 * 本脚本的结论是"**集合相同 ⇒ 没损伤**"—— 但**观测手段自己失败时**（目录读不到、
 * 编码不对、正则被改坏），`collectSurface()` 会返回**空**，于是"空 == 空"⇒ **假绿** ✗。
 *
 * > 对端给这条起了个准名字：**观测手段失败时得出的"没有"是「假的没有」**。
 *
 * 我自己项目里有过一次真事故：路径扫描因为 shell 吃掉了模式而"通过"，
 * 实际漏掉了 6 处泄漏 —— 形状完全一样（**工具没生效，结论却是绿的**）。
 *
 * 所以这里设一道下限：**符号数或文件数低到不合理 ⇒ 直接失败**，
 * 而不是安静地报"通过"。要放宽时改这两个常量（改动本身就是一次显式决定）。
 */
const MIN_EXPECTED_SYMBOLS = 100
const MIN_EXPECTED_FILES = 10

const fileCount = walk(SRC).length
if (fileCount < MIN_EXPECTED_FILES || current.length < MIN_EXPECTED_SYMBOLS) {
  console.log('❌ **检查本身没跑起来**（不是"集合相同"）：')
  console.log(`   扫到文件 ${fileCount} 个（下限 ${MIN_EXPECTED_FILES}）、导出符号 ${current.length} 个（下限 ${MIN_EXPECTED_SYMBOLS}）`)
  console.log('   这几乎总是**观测手段失效**（路径不对 / 目录读不到 / 正则被改坏），')
  console.log('   而不是"代码真的只剩这么点导出"。**别把它当通过。**')
  process.exit(2)
}

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
