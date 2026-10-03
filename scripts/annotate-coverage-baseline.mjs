/**
 * 给"导出覆盖基线"的每条登记项补上**封闭词表**的理由码（对端建议）。
 *
 * ## 为什么是词表而不是自由文本
 *
 * 77 条自由文本会立刻变成**文档债**（没人读、更没人更新）。词表的好处：
 *   · **可统计**（"还有几条 todo？"）
 *   · **可审计**（`ui` / `internal` 不需要解释）
 *   · 关键：把"**该补测试**"与"**有意放过**"**分开** ——
 *     原来的 77 条只有日期，两者混在一起 ✗
 *
 * ## 词表（封闭，改动需在这里加定义）
 *
 *     ui        UI 组件：由人工验收覆盖
 *     internal  内部助手：只被同模块调用，行为由调用方测试间接覆盖
 *     const     纯展示常量/映射：无逻辑
 *     todo      **确实该补测试** —— 这是**待办**，不是豁免；应随时间减少
 *
 * 规则：`todo` 必须带日期，且**应定期清零**；`ui`/`internal`/`const` 才是豁免。
 *
 * ## 护栏纪律（对端点明，写在这里免得自己犯）
 *
 * > **护栏代码是最不该"聪明"的地方。**
 *
 * 线性、无依赖、无技巧：能一眼读完、能被穷举演练、失败就大声。
 * 不写"后面才声明的东西"、不兜可选链、不顺手加缓存 ——
 * **把聪明留在产品代码里，护栏只负责报警。**
 *
 * 跑法：node scripts/annotate-coverage-baseline.mjs   （幂等）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const BASELINE = join(ROOT, 'scripts', 'export-coverage-baseline.txt')

/** 词表（封闭）。 */
const CODES = {
  ui: 'UI 组件：由人工验收覆盖',
  internal: '内部助手：只被同模块调用，行为由调用方测试间接覆盖',
  const: '纯展示常量/映射：无逻辑',
  todo: '**确实该补测试**（待办，不是豁免；应随时间减少）',
}

/**
 * 真该补测试的（**人工挑选，故意短**）——它们是逻辑承载的、且目前**没有任何直接测试**。
 * 这份清单应当**只减不增**：补上测试就从这里删掉。
 */
const TODO_SYMBOLS = new Set([
  'resolveCardEntry', // 卡片入口解析：决定"加载哪个文件"，错了就是安全/正确性问题
  'checkApiVersion', // 卡片 API 版本闸门：判错会让旧卡片带着新语义跑
  'declaredApiVersion',
  'checkVersion', // 宿主版本闸门
  'fingerprintSourceDir', // 指纹决定"同来源跳过写入"，算错会导致静默不更新
  'parseVersionedDirName', // 目录名解析：解析失败 ⇒ 旧版本永远清不掉
])

function codeFor(line) {
  const symbol = line.split(':').pop().split('/')[0]
  const isUi = /\/ui\//u.test(line)
  const isConst =
    /^[A-Z0-9_]+$/u.test(symbol) ||
    /(_VERSION|_CHANGELOG|_PREFIX|_FILE|_ATTR|_ORDER|_ENDPOINTS|_CHANNEL|_CSS|_CAPABILITIES|_KIND|_SOURCE)$/u.test(
      symbol,
    )
  if (TODO_SYMBOLS.has(symbol)) return 'todo'
  if (isUi) return 'ui'
  if (isConst) return 'const'
  return 'internal'
}

const raw = readFileSync(BASELINE, 'utf8').split('\n').filter((l) => l.trim())
const counts = {}
const out = []

for (const line of raw) {
  const symbolPart = line.split('#')[0].trim()
  if (!symbolPart) continue
  /** 保留已有的 `at=`（登记日期），只补/替换 `code=`。 */
  const oldComment = line.includes('#') ? line.split('#').slice(1).join('#').trim() : ''
  const atMatch = /at=(\d{4}-\d{2}-\d{2})/u.exec(oldComment)
  const at = atMatch?.[1] ?? new Date().toISOString().slice(0, 10)
  const code = codeFor(symbolPart)
  counts[code] = (counts[code] ?? 0) + 1
  out.push(`${symbolPart}  # code=${code} at=${at}`)
}

writeFileSync(BASELINE, out.join('\n') + '\n', 'utf8')

console.log(`已标注 ${out.length} 条（封闭词表）：`)
for (const [code, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code.padEnd(9)} ${String(n).padStart(3)}  ${CODES[code] ?? ''}`)
}
console.log('')
console.log(`⚠️ **todo = ${counts.todo ?? 0} 条**：这是**待办**不是豁免，应随测试补齐而减少。`)
