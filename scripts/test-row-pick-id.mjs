/**
 * **行文本 → 会话 id** 的行级判据测试（`pickRowTitleId`）。
 *
 * 这一层是负控逼出来的 ✗：光有单条"标题↔行文本"判据不够 ——
 * **一行可能同时匹配多个标题**（截断前缀 vs 精确），按"第一个匹配就用"会**连错会话** ✗。
 *
 * 规则：**精确优先** ⇒ 否则**唯一前缀**才采用 ⇒ 零个/多个一律不猜 ✓。
 *
 * 跑法：node scripts/test-row-pick-id.mjs
 */
import { pickRowTitleId, titleMatchesRowText } from '../lib/client/row-map.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))
const eq = (a, b, l) =>
  a === b ? pass++ : (fail++, console.log(`  ❌ ${l}\n      期望 ${b ?? '(不采用)'}，实得 ${a ?? '(不采用)'}`))

const ID_A = 'session-aaaaaaaa-0000-0000-0000-000000000001'
const ID_B = 'session-bbbbbbbb-0000-0000-0000-000000000002'

console.log('── ① 真机那个 bug：长标题被截断 ⇒ 仍能认出来')

{
  /**
   * ⚠️ 路径用**中性占位**（`@~/Downloads/…`）而不是真实用户目录 ✗ ——
   * 仓库的路径扫描会把"本机用户目录"判成**路径泄漏** ✓，
   * 而这里需要的性质只是"**一个会被 UI 截断的长标题**" ✓，与真实目录无关 ✓。
   */
  const full = '@~/Downloads/DSH 嵌入式 runtime'
  const entries = [[full, ID_A]]
  eq(
    pickRowTitleId('@~/Downloads/DSH 嵌入式…', entries),
    ID_A,
    '截断行文本 ⇒ 认出那个会话 ✓（旧实现这里返回 undefined ✗ ⇒ 画不出线 ✗）',
  )
}

console.log('── ② 精确优先：即使另有前缀候选，也选精确的那个')

{
  const entries = [
    ['准备协作', ID_A],
    ['准备协作二号', ID_B],
  ]
  eq(
    pickRowTitleId('准备协作', entries),
    ID_A,
    '行文本 = "准备协作" ⇒ 精确命中 ✓（不许被"准备协作二号"的前缀匹配带跑 ✗）',
  )
  eq(pickRowTitleId('准备协作二号', entries), ID_B, '行文本 = "准备协作二号" ⇒ 精确命中 B ✓')
}

console.log('── ③ 不猜：零个或多个前缀候选 ⇒ 一律不采用')

{
  const entries = [
    ['准备协作 Alpha', ID_A],
    ['准备协作 Beta', ID_B],
  ]
  eq(
    pickRowTitleId('准备协作', entries),
    undefined,
    '行文本 "准备协作" 同时是**两个**标题的前缀 ⇒ **不采用** ✓（连错比连不上更糟 ✗）',
  )
  eq(pickRowTitleId('完全无关', entries), undefined, '没有任何候选 ⇒ 不采用 ✓')
  eq(pickRowTitleId('', entries), undefined, '空行文本 ⇒ 不采用 ✓')
}

console.log('── ④ 单条判据（titleMatchesRowText）的契约 —— 它只回答"是否前缀关系"')

{
  ok(
    titleMatchesRowText('准备协作', '准备协作二号'),
    '它是前缀关系 ⇒ 返回 true ✓ —— **歧义由行级判据解决** ✓（这就是要两层的原因 ✓）',
  )
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
