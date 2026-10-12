/**
 * 测试跑法（**跨平台、无 shell 语法**）—— `npm test` 的宿主。
 *
 * 为什么需要它：`package.json` 的 `scripts.test` 是一条 `A && B && C` 长链，
 * 而链上有一条**允许 SKIP** 的步骤（`test-inject-words.mjs` 在推不出宿主模块表时
 * 退 2）。`;`/`$?`/`[ ]` 那套只有 POSIX shell 认 —— cmd.exe 会把它们当路径，
 * 于是"本机能跑、npm 跑不了"。**改由 Node 串流程，两边行为完全一致**。
 *
 * 语义：
 *   · 每步独立子进程，输出原样透传（CI 日志里一条不少）
 *   · 退出码 2 **只有** `test-inject-words.mjs` 能用，含义是**响亮 SKIP**
 *     （本机判不了 ⇒ 既不算通过也不算失败，但**绝不假装 PASS**）
 *   · 其余任何非零退出码 ⇒ 整体失败，立刻停
 *   · 汇总照旧打印 `═══ 结果：N 通过 / M 失败 ═══`（各步自己的那一行不动）
 *
 * 跑法：npm test
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 唯一允许退 2（=SKIP）的步骤。 */
const SKIP_ALLOWED = 'scripts/test-inject-words.mjs'

/** 步骤清单：文件列表（不是命令行字符串 —— 避免任何 shell 解析）。 */
const STEPS = [
  'scripts/check-api-surface.mjs',
  'scripts/check-export-coverage.mjs',
  SKIP_ALLOWED,
  'scripts/test-tool-scoping.mjs',
  'scripts/test-preempt.mjs',
  'scripts/test-install.mjs',
  'scripts/test-adapter.mjs',
  'scripts/test-shim.mjs',
  'scripts/test-shim-scan-scope.mjs',
  'scripts/test-shim-entry-closure.mjs',
  'scripts/test-suitability.mjs',
  'scripts/test-side-follows-expanded.mjs',
  'scripts/test-bridge.mjs',
  'scripts/test-status.mjs',
  'scripts/test-host-wiring.mjs',
  'scripts/test-capabilities.mjs',
  'scripts/test-ui-capture.mjs',
  'scripts/test-styles-ownership.mjs',
  'scripts/test-star-hook.mjs',
  'scripts/test-skill-provider.mjs',
  'scripts/drill-observe-failure.mjs',
  'cards/connection-etiquette/test.mjs',
  'scripts/test-builtin-etiquette-card.mjs',
  'scripts/test-symlink-tar.mjs',
  'scripts/test-escape-entries.mjs',
  'scripts/experiment-real-plugin.mjs',
]

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const skipAllowed = new Set([SKIP_ALLOWED])

const skipped = []
const failed = []

for (const step of STEPS) {
  const r = spawnSync(process.execPath, [step], { cwd: ROOT, stdio: 'inherit' })
  const code = r.status ?? 1
  if (code === 0) continue
  if (code === 2 && skipAllowed.has(step)) {
    skipped.push(step)
    console.log(`\n── ${step}: SKIP（退 2 —— 本机判不了，未通过也未失败）\n`)
    continue
  }
  failed.push(`${step} (exit ${code})`)
  console.log(`\n── ${step}: FAIL（退出码 ${code}）—— 后续步骤不再执行\n`)
  break
}

console.log('')
if (failed.length > 0) {
  console.log(`═══ run-tests：失败 ${failed.length} 步 —— ${failed.join(', ')} ═══`)
  process.exit(1)
}
if (skipped.length > 0) {
  console.log(`═══ run-tests：全部通过，${skipped.length} 步 SKIP（${skipped.join(', ')}）═══`)
  console.log('    ⚠️ SKIP 不等于通过 —— 要真判就设 DSH_HOME 或 DSH_CHECKOUT。')
}
process.exit(0)
