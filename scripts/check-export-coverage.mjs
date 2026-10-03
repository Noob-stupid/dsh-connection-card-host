/**
 * **低噪声补丁**：每个"可执行导出"至少被一个测试引用（**收缩式基线**）。
 *
 * ## ⚠️ 先读这条分工判据（对端点明，决定了这个脚本该怎么失败）
 *
 * > **这是"判据"还是"用户路径"？判据宁可崩，用户路径宁可降级。**
 *
 *   · **判据 / 护栏 / 校验**（本文件属于这类）⇒ **崩**（非 0 退出、大声报错）。
 *     它说"通过"是要被人**据此做决定**的 —— **假绿比崩危险得多**。
 *   · **用户路径**（下载 / 解包 / 安装，见 `src/card-host/installer.ts`）⇒ **降级 + 明确告知**，
 *     绝不把宿主带崩 —— 崩了用户就丢掉整个 DSH 会话。
 *
 * 同一个插件里这两类的**正确失败方式相反**，所以写清自己属于哪一类。
 *
 * ## 它在补哪个缺口（对端点明）
 *
 * `check-api-surface.mjs` 能抓"**消失了什么**"（切掉 / 改名 / 新增未申报），
 * **抓不到**"**还在、但被掏空**"—— 名字与参数都没变、函数体被换成 `return null`。
 * 那种掏空**最危险的形态**是"**没有任何测试碰过这个导出**" ⇒ 掏空了也没人发现。
 * 所以这条检查盯住它。
 *
 * ## 输出是**结构**（沿用同一约定）：一行 JSON
 *
 *     {"status":"ok|uncovered|unavailable","exports":N,"uncovered":[...]}
 *
 * 跑法：
 *   node scripts/check-export-coverage.mjs            # 校验
 *   node scripts/check-export-coverage.mjs --update   # 登记"已知未覆盖"（基线只减不增）
 *   node scripts/check-export-coverage.mjs --json
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const TESTS = join(ROOT, 'scripts')

function walk(dir, out = [], filter = /\.tsx?$/u) {
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
      if (st.isDirectory()) walk(abs, out, filter)
      else if (filter.test(name)) out.push(abs)
    } catch {
      /* 单个条目读不到：跳过（整体异常由下面的健全性下限发现） */
    }
  }
  return out
}

/** 只要**运行时可引用**的导出：函数与常量（类型导出查不到、只会制造噪声）。 */
const RUNTIME_EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/gmu

function collectRuntimeExports() {
  const out = []
  for (const abs of walk(SRC)) {
    const text = readFileSync(abs, 'utf8')
    for (const m of text.matchAll(RUNTIME_EXPORT_RE)) {
      out.push({ name: m[1], file: relative(ROOT, abs).replace(/\\/gu, '/') })
    }
  }
  return out
}

const exportsList = collectRuntimeExports()
const testFiles = walk(TESTS, [], /\.mjs$/u)
const testText = testFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

/**
 * ⚠️ **观测健全性下限**（同 `check-api-surface.mjs`）：
 * 观测手段失败时得出的"没有"是**假的没有** —— 扫不到文件/导出时**必须**报"没跑起来"，
 * 而不是安静地说"全部有覆盖"。
 */
const MIN_EXPORTS = 50
const MIN_TEST_FILES = 5
if (exportsList.length < MIN_EXPORTS || testFiles.length < MIN_TEST_FILES) {
  console.log(
    JSON.stringify({
      status: 'unavailable',
      exports: exportsList.length,
      uncovered: [],
      reason: `扫到导出 ${exportsList.length}（下限 ${MIN_EXPORTS}）、测试文件 ${testFiles.length}（下限 ${MIN_TEST_FILES}）`,
    }),
  )
  console.log('❌ **检查本身没跑起来**（不是"全部有覆盖"）—— 别把它当通过。')
  process.exit(2)
}

/** 引用判据：**词边界**匹配符号名（避免 `maskUrl` 命中 `maskUrlXxx`）。 */
const uncovered = exportsList
  .filter((e) => !new RegExp(`\\b${e.name.replace(/\$/gu, '\\$')}\\b`, 'u').test(testText))
  .map((e) => `${e.file}:${e.name}`)
  .sort()

/**
 * ⚠️ **收缩式基线**（这条是"信噪比"规则逼出来的设计，别改回"全部必须覆盖"）
 *
 * 第一版我写的是"**每个导出都必须有测试引用**" ⇒ 一跑就报 **77 个未覆盖** ✗
 * （UI 组件、内部助手、纯展示常量……它们**本来就不该**被测试引用）。
 * 那样的门槛会**永久红** ⇒ 人开始无视它 / 关掉它 ⇒ 护栏死 ✗
 * —— 正是"报警频率高于真实出现率"那条。
 *
 * 所以改成：**把现状登记为基线，只对"新增的未覆盖导出"报警**。
 * 这恰好也是对端的原意（"只在新增导出但没测试时报警 —— 那本来也是该拦的"）。
 *
 * 副作用是好的：**基线只减不增**成为一种显式承诺 —— 谁新增了导出，
 * 要么补测试，要么显式登记（登记本身就是一次"我知道它没测"的决定）。
 */
const BASELINE = join(TESTS, 'export-coverage-baseline.txt')

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, uncovered.join('\n') + '\n', 'utf8')
  console.log(`已登记 ${uncovered.length} 个"当前未覆盖"的导出 → scripts/export-coverage-baseline.txt`)
  process.exit(0)
}

let known = new Set()
try {
  known = new Set(
    readFileSync(BASELINE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  )
} catch {
  console.log(
    JSON.stringify({ status: 'unavailable', exports: exportsList.length, uncovered: [], reason: '没有基线文件' }),
  )
  console.log('❌ **检查没跑起来**：缺少 scripts/export-coverage-baseline.txt')
  console.log('   生成：node scripts/check-export-coverage.mjs --update')
  process.exit(2)
}

/** **只报新增的**（基线里已登记的属于"已知并接受"）。 */
const newly = uncovered.filter((s) => !known.has(s))

if (newly.length > 0) {
  console.log(
    JSON.stringify({ status: 'uncovered', exports: exportsList.length, uncovered: newly, known: known.size }),
  )
  console.log(`❌ 有 ${newly.length} 个**新增导出没有任何测试引用**：`)
  for (const s of newly) console.log(`     - ${s}`)
  console.log('')
  console.log('   风险：有人把它的实现**掏空成 `return null`** 也不会有测试变红。')
  console.log('   下一步（二选一）：')
  console.log('     · 补一条测试（推荐 —— 这正是"该拦的"）')
  console.log('     · 确实不该被测试引用 ⇒ node scripts/check-export-coverage.mjs --update（显式登记）')
  process.exit(1)
}

/** 基线里已经被覆盖的 ⇒ 提示可以缩小（**不是错误**，只是让基线别虚胖）。 */
const nowCovered = [...known].filter((s) => !uncovered.includes(s))

console.log(
  JSON.stringify({
    status: 'ok',
    exports: exportsList.length,
    uncovered: [],
    knownAccepted: known.size,
    canShrinkBaselineBy: nowCovered.length,
  }),
)
console.log(
  `═══ 没有"新增未覆盖"的导出（已登记 ${known.size} 个已知未覆盖，可缩减 ${nowCovered.length} 个）—— 通过 ═══`,
)
if (nowCovered.length > 0) {
  console.log(`   提示（非错误）：这 ${nowCovered.length} 个现在有测试了，可以 --update 缩小基线`)
}
process.exit(0)
