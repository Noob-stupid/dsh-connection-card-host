/**
 * **行文本 ↔ 会话标题**匹配的测试 —— 钉住"长标题被截断"那个真机 bug。
 *
 * ## 现场的因果链（用户报"那两行之间没有线"）
 *
 *     会话行把长标题截断成 `@~/Downloads/DSH 嵌入式…`（中性占位 ✓，不用真实目录 ✗）
 *     ⇒ 行文本**比标题短** ✗
 *     ⇒ 旧判据 `text.startsWith(title)` **永远为假** ✗
 *     ⇒ 那一行认不出 ⇒ 连线配不上对 ⇒ 线画不出来 ✓
 *
 * 旁证：同现场**短标题**的会话能匹配 ✓ ⇒ `missing` 恰好只有一个 ✓（形状完全吻合 ✓）。
 *
 * ## 纪律没变
 *
 * 仍是**前缀关系**（不是子串 ✓）+ 行文本至少 4 字符才允许"行更短"的方向 ✓
 * + 调用方仍要求**唯一命中** ✓ —— **宁可少认一行，也不连错会话** ✓
 *
 * 跑法：node scripts/test-row-title-match.mjs
 */
import { titleMatchesRowText } from '../lib/client/row-map.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

console.log('── ① 应通过：截断的行文本（真机那个 bug）')

{
  /** 中性占位路径 ✓（性质是"长到会被截断"，与真实目录无关 ✓）。 */
  const title = '@~/Downloads/DSH 嵌入式 runtime'
  const row = '@~/Downloads/DSH 嵌入式…'
  ok(titleMatchesRowText(row, title), `截断行文本应匹配长标题（实测 row="${row}"）`)
  ok(titleMatchesRowText(row.replace('…', '...'), title), '省略号写成 `...` 也应匹配（UI 两种都可能 ✓）')
  ok(titleMatchesRowText('准备协作', '准备协作'), '短标题精确匹配仍成立 ✓')
}

console.log('── ② 应通过：种行里标题后面还有时间等文本')

{
  ok(titleMatchesRowText('准备协作 2分钟', '准备协作'), '行文本 = 标题 + 时间 ✓')
  ok(titleMatchesRowText('准备协作 · 3 个待办', '准备协作'), '行文本 = 标题 + 其它 ✓')
}

console.log('── ③ 应不通过：不同的标题不许匹配（不能为了画线而乱配）')

{
  ok(!titleMatchesRowText('准备协', '准备协作'), '太短的行文本（<4 字符）不参与"行更短"方向 ✗')
  /**
   * ⚠️ 这条断言我**改过**：原先写的是"应当不匹配"✗ —— 那是把两层判据混在一起了 ✓。
   * `titleMatchesRowText` 的契约只是"**是否前缀关系**" ✓ ⇒ 这里**应当为真** ✓；
   * 而"一行同时匹配多个标题"的**歧义**由行级判据 `pickRowTitleId` 解决 ✓
   * （它要求精确优先 + 唯一才采用 ✓，见 test-row-pick-id ✓）。
   */
  ok(
    titleMatchesRowText('准备协作', '准备协作二号'),
    '前缀关系 ⇒ true ✓；歧义在**行级**判据里解决 ✓（两层缺一不可 ✓）',
  )
  ok(!titleMatchesRowText('完全不同的会话', '准备协作'), '无关标题 ✗')
  ok(!titleMatchesRowText('', '准备协作'), '空行文本 ✗')
  ok(!titleMatchesRowText('准备协作', ''), '空标题 ✗')
}

console.log('── ④ 应不通过：子串关系不算匹配（旧实现也只认前缀 ✓）')

{
  ok(!titleMatchesRowText('前准备协作后', '准备协作'), '标题在行文本**中间** ⇒ 不算 ✓（避免误配 ✓）')
}

console.log('── ⑤ 大小写与空白归一')

{
  ok(titleMatchesRowText('  HELLO   World  ', 'hello world'), '大小写 + 多空白归一 ✓')
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
