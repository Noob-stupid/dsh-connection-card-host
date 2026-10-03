/**
 * 逃逸类判据的**穷举测试**（对端给的 Windows 绕过清单）。
 *
 * ## 为什么单独一个文件
 *
 * `..` 与绝对路径只是**最粗的两种**。同一类在 Windows 上还有一堆绕过：
 * 反斜杠分隔、盘符相对、UNC、NTFS 备用数据流、保留设备名、结尾点/空格……
 * 这些全是**纯函数分支**，最便宜的钉法就是逐个喂进 `classifyTarEntry()`。
 *
 * ⚠️ 断言只写**行为级**（认得出 / 不误报），**不断言文案里的英文** ——
 * 文本是巧合级（换版本/语言就变），行为才是契约级。
 *
 * 跑法：node scripts/test-escape-entries.mjs
 */
import { classifyTarEntry, findEscapingEntry } from '../lib/card-host/installer.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

const mustEscape = [
  ['最粗的：上跳', '../outside.txt'],
  ['最粗的：绝对路径', '/etc/passwd'],
  ['反斜杠分隔的上跳', '..\\outside.txt'],
  ['多级混合上跳', '../..\\x'],
  ['先进入再上跳出去（净深度为负）', 'a/../../b'],
  ['前导 ./ 再上跳', './../x'],
  ['Windows 绝对路径', 'C:/Windows/system32/x'],
  ['盘符相对（不是绝对，但落到 C 盘当前目录）', 'C:foo'],
  ['UNC 路径', '\\\\server\\share\\x'],
  ['NTFS 备用数据流', 'file.txt:stream'],
  ['保留设备名 CON', 'CON'],
  ['保留设备名带扩展名', 'CON.txt'],
  ['保留设备名 NUL（深层）', 'pkg/lib/NUL'],
  ['保留设备名 COM1', 'com1'],
  ['保留设备名 LPT9', 'pkg/LPT9.log'],
]

for (const [label, name] of mustEscape) {
  const r = classifyTarEntry(name)
  ok(Boolean(r.escape), `逃逸：${label} —— ${name}`)
}

const mustNotEscape = [
  ['普通文件', 'package.json'],
  ['普通嵌套', 'lib/index.js'],
  ['深层嵌套', 'a/b/c/d/e.js'],
  ['带点的普通名', 'lib/v1.2.3/index.js'],
  ['名字里含 con 但不等于', 'content.js'],
  ['名字里含 colon 但…（含冒号即判逃逸，这里用不含的）', 'lib/a-b_c.js'],
  ['单个点（当前目录）', './lib/index.js'],
  ['内部先上跳再回来（净深度不为负）', 'a/b/../c.js'],
  /**
   * ⚠️ 这个我一开始**写错在"必须逃逸"那一组** —— 但它其实不逃逸：
   * `a//../b` 规范化后就是 `b`，仍在目录内。
   * 分类器判对了，是我的期望写错 —— 留着这条，正是"规范化"与"看起来像上跳"的区别。
   */
  ['空段 + 上跳但净深度不为负', 'a//../b'],
]

for (const [label, name] of mustNotEscape) {
  const r = classifyTarEntry(name)
  ok(!r.escape, `不误报：${label} —— ${name}`)
}

// 容忍类：结尾点/空格 ⇒ 警告（不拒绝）
{
  const r = classifyTarEntry('lib/foo. ')
  ok(!r.escape, '结尾点/空格 ⇒ **不**当成逃逸（是碰撞风险，不是逃逸）')
  ok(Boolean(r.warn), '结尾点/空格 ⇒ 给出警告')
}

// 入口函数：任一条目中招就返回它
{
  ok(
    findEscapingEntry(['package.json', 'lib/a.js', 'x/../../y']) === 'x/../../y',
    'findEscapingEntry 能在多个条目里挑出逃逸的那个',
  )
  ok(
    findEscapingEntry(['package.json', 'lib/a.js']) === undefined,
    '全是正常条目 ⇒ 返回 undefined（不误报）',
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
