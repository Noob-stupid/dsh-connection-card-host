/**
 * **作用域判定**（用户点出的第三条判据轴）的正控 / 负控。
 *
 * ## 它在钉什么
 *
 * 用户原话：「`omdsh-dev/DSH-better-sidebar` 这种插件一看就是**为了全局而生的**啊」
 * ⇒ **星多 ≠ 适合当卡片** ✗。全局 UI（替换/接管整个侧栏那种）属于"装到 App 上"，
 * 挂到**某条连接**上既装不下、也会和 App 布局打架 ✓。
 *
 * ⇒ 候选列表要能**提前**标出「全局 / 局部 / 能力 / 未判定」，
 * 用户才不用逐个试（**逐个试才发现的成本最高** ✓）。
 *
 * ## 两条控制（我们立的纪律）
 *
 *   · **应通过**：注册到连接级槽位（`conversation.input.right`）⇒ 判 `local` ✓
 *   · **应不通过**：注册到 App 级槽位（`sidebar` / `settings.section`）⇒ **必须**判 `global` ✓
 *   · 边界：没有客户端制品 ⇒ `capability`（纯能力卡，正是卡片本职 ✓）
 *   · 诚实：有客户端制品但读不到源码 ⇒ `unclear`（**不猜** ✓）
 *
 * 跑法：node scripts/test-suitability.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { analyzeSuitability, suitabilityBadge } from '../lib/card-host/suitability.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

const root = mkdtempSync(join(tmpdir(), 'ccr-suit-'))

/** 造一张带客户端制品的卡：`slotNames` 决定它注册到哪儿。 */
function makeCard(name, { slotNames, withClient = true }) {
  const dir = join(root, name)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      main: 'lib/index.js',
      ...(withClient ? { exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } } } : {}),
    }),
  )
  writeFileSync(join(dir, 'lib', 'index.js'), 'export function apply() {}\n')
  if (withClient) {
    writeFileSync(
      join(dir, 'lib', 'client.js'),
      `window.__ModuleLoader__.load({ id: '${name}', factory(require) {\n` +
        slotNames.map((s) => `  require('react')\n  slots.register('${s}', () => null)`).join('\n') +
        `\n  return { inject: ['slots'], apply() {} }\n} })\n`,
    )
  }
  return dir
}

try {
  console.log('── ① 应通过：连接级槽位 ⇒ 局部')

  {
    const dir = makeCard('local-widget', { slotNames: ['conversation.input.right'] })
    const r = analyzeSuitability(dir)
    ok(r.scope === 'local', `连接级槽位 ⇒ local（实测 ${r.scope}）`)
    ok(suitabilityBadge(r).kind === 'ok', '徽标语气是"可用"')
    ok(r.globalHits.length === 0, '不该命中任何全局槽位')
  }

  console.log('── ② 应不通过：App 级槽位 ⇒ 全局（用户点的那类）')

  for (const slot of ['sidebar', 'settings.section', 'layout.main', 'ui-settings.general', 'theme.tokens']) {
    const dir = makeCard(`global-${slot.replace(/\W/g, '-')}`, { slotNames: [slot] })
    const r = analyzeSuitability(dir)
    ok(r.scope === 'global', `App 级槽位 ${slot} ⇒ **必须**判 global（实测 ${r.scope}）`)
    ok(suitabilityBadge(r).kind === 'warn', `${slot} ⇒ 徽标语气是"警告"（不建议）`)
  }

  console.log('── ③ 边界：没有客户端制品 ⇒ 纯能力卡')

  {
    const dir = makeCard('pure-capability', { slotNames: [], withClient: false })
    const r = analyzeSuitability(dir)
    ok(r.scope === 'capability', `无客户端制品 ⇒ capability（实测 ${r.scope}）`)
    ok(/本职/.test(r.why), '理由里说清"这正是卡片的本职"')
  }

  console.log('── ④ 诚实：有客户端制品但读不到源码 ⇒ 不猜')

  {
    const dir = join(root, 'broken-client')
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'broken-client',
        version: '1.0.0',
        dsh: { client: { platform: 'web' } },
      }),
    )
    const r = analyzeSuitability(dir, true)
    ok(r.scope === 'unclear', `声明了 UI 但拿不到源码 ⇒ unclear（实测 ${r.scope}）`)
    ok(!/适合/.test(r.why), '理由里**不得**出现"适合当卡片"这类判断（不猜）')
  }

  console.log('── ⑤ 局部与全局**同时**出现 ⇒ 按全局算（宁可提醒）')

  {
    const dir = makeCard('mixed', { slotNames: ['conversation.input.right', 'sidebar'] })
    const r = analyzeSuitability(dir)
    ok(r.scope === 'global', `混着注册时按 global 算（实测 ${r.scope}）`)
    ok(r.globalHits.includes('sidebar'), '命中列表里能看到是哪个槽位导致的')
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
