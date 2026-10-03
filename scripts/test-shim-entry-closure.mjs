/**
 * **根因 1 的正控 / 负控**：依赖扫描必须只看**宿主入口的 import 闭包**。
 *
 * ## 复刻的真机证据（对端实测 `shaobeichen/dsh-pocket`，1500★）
 *
 *     报"缺 5 个"，逐条归因：
 *       esbuild, react     ← client/build.mjs（构建脚本）
 *       qrcode-terminal    ← bin/dsh-pocket.mjs（CLI）
 *       ws, react          ← test/*.test.js
 *       qrcode             ← lib/service.mjs  ← **只有这一个是真运行时依赖** ✓
 *
 * ⇒ 5 个里 4 个是假的：**判据没错，是它看的范围错了** ✗（"扫描面"错误第三次出现）。
 *
 * ## 两条控制缺一不可（我们立的纪律）
 *
 *   · **应通过**：走入口闭包 ⇒ unresolved **只有 `qrcode`** ✓
 *   · **应不通过**（证明修的是真问题）：走整目录 ⇒ unresolved **必须包含**那些假依赖 ✓
 *     —— 否则"修好了"可能只是"换了个说法" ✗
 *
 * 跑法：node scripts/test-shim-entry-closure.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planShims, unresolvedOf } from '../lib/adapter/shim.js'

/**
 * `unresolvedOf` 的条目带后缀（如 `qrcode（第三方依赖未解析到）`）⇒ **按包名前缀判**。
 *
 * ⚠️ 第一版我用 `list.includes('qrcode')` 精确匹配 ⇒ 四条断言全红 ✗，
 * 而实际数据**完全正确**（闭包只剩 qrcode ✓、整目录 5 个假依赖 ✓）。
 * ⇒ 又一次"**测试红了先怀疑夹具/断言，别急着改代码**" ✓。
 */
const has = (list, pkg) => list.some((x) => x === pkg || x.startsWith(`${pkg}（`))

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

/** 复刻 dsh-pocket 的目录形状：入口干净，测试/CLI/构建脚本里才是"假依赖"。 */
function makePocket(root) {
  const dir = join(root, 'pocket')
  for (const sub of ['lib', 'test', 'bin', 'client']) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'pocket', version: '1.0.0', type: 'module', main: 'lib/index.js' }),
  )
  /** 真运行时依赖：只有 qrcode（经相对导入的 service.mjs） */
  writeFileSync(
    join(dir, 'lib', 'index.js'),
    ["import qrcode from 'qrcode'", "import './service.mjs'", 'export function apply() {}', ''].join('\n'),
  )
  writeFileSync(join(dir, 'lib', 'service.mjs'), 'export const service = 1\n')
  /** 假依赖：只在开发/构建/CLI 时用 */
  writeFileSync(join(dir, 'test', 'smoke.test.js'), "import react from 'react'\n")
  writeFileSync(join(dir, 'test', 'proxy.test.js'), "import WebSocket from 'ws'\n")
  writeFileSync(join(dir, 'bin', 'cli.mjs'), "import qr from 'qrcode-terminal'\n")
  writeFileSync(join(dir, 'client', 'build.mjs'), "import esbuild from 'esbuild'\nimport react from 'react'\n")
  return dir
}

const root = mkdtempSync(join(tmpdir(), 'ccr-closure-'))
try {
  const dir = makePocket(root)
  const shimRoot = join(root, 'cards')

  console.log('── ① 应通过：入口闭包 ⇒ 只剩真运行时依赖')

  const closure = unresolvedOf(planShims(dir, shimRoot, dir, 'lib/index.js'))
  ok(
    has(closure, 'qrcode'),
    `真运行时依赖 qrcode **必须**在（实测 [${closure.join(', ')}]）`,
  )
  for (const fake of ['esbuild', 'qrcode-terminal', 'ws', 'react']) {
    ok(
      !has(closure, fake),
      `**假依赖 ${fake} 不得出现**（它只在 test/ bin/ client/ 里；实测 [${closure.join(', ')}]）`,
    )
  }

  console.log('── ② 应不通过：整目录扫描**必须**会把这些假依赖扫出来')

  const whole = unresolvedOf(planShims(dir, shimRoot, dir))
  for (const fake of ['esbuild', 'qrcode-terminal', 'ws']) {
    ok(
      has(whole, fake),
      `整目录扫描应当扫出 ${fake}（证明**修的是真问题**，不是换了个说法；实测 [${whole.join(', ')}]）`,
    )
  }

  console.log('── ③ 入口解析不出来 ⇒ 回退整目录（行为不倒退）')

  {
    const bad = unresolvedOf(planShims(dir, shimRoot, dir, 'lib/does-not-exist.js'))
    ok(bad.length > 1, `入口不存在 ⇒ 回退整目录扫描（实测 ${bad.length} 个）`)
  }

  console.log('── ④ 只有入口自己 ⇒ 也算解析失败，回退整目录')

  {
    const lonelyRoot = join(root, 'lonely')
    mkdirSync(join(lonelyRoot, 'lib'), { recursive: true })
    writeFileSync(join(lonelyRoot, 'package.json'), JSON.stringify({ name: 'lonely', main: 'lib/index.js' }))
    writeFileSync(join(lonelyRoot, 'lib', 'index.js'), 'export function apply() {}\n')
    const un = unresolvedOf(planShims(lonelyRoot, shimRoot, lonelyRoot, 'lib/index.js'))
    ok(un.length === 0, '干净的单文件入口 ⇒ 无未解析依赖（回退也不会误报）')
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
