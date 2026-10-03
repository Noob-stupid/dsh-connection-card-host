/**
 * 故障演练：**让观测手段失效**，看护栏会不会报"检查本身没跑起来"。
 *
 * 这条演练的意义（对端点明的一个形状）：
 * **观测手段失败时得出的"没有"是「假的没有」** ——
 * 本脚本如果把 `SRC` 指向不存在的目录，`collectSurface()` 会返回空，
 * 若没有健全性下限，就会报"集合相同 ⇒ 通过"（**假绿**）。
 *
 * 我自己项目里有过一次真事故：路径扫描因为 shell 吃掉了模式而"通过"，
 * 实际漏掉 6 处泄漏 —— 形状完全一样。
 *
 * 跑法：node scripts/drill-observe-failure.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const target = 'scripts/check-api-surface.mjs'
const original = readFileSync(target, 'utf8')

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

try {
  // 把 src 指到不存在的目录 —— 模拟"观测手段失效"
  const broken = original.replace("const SRC = join(ROOT, 'src')", "const SRC = join(ROOT, 'src-nonexistent')")
  ok(broken !== original, '演练准备：能改到 SRC（否则演练本身没生效）')
  writeFileSync(target, broken, 'utf8')

  let status = 0
  let out = ''
  try {
    out = String(execFileSync(process.execPath, [target], { encoding: 'utf8' }))
  } catch (e) {
    status = e.status ?? -1
    out = String(e.stdout ?? '')
  }

  ok(status === 2, `观测失效时**必须失败**（实测退出码 ${status}，应为 2）`)
  ok(/检查本身没跑起来/.test(out), '文案明确说"检查本身没跑起来"，而不是"通过"')
  ok(/假的没有|观测手段失效/.test(out), '文案点出这是**观测手段**的问题（免得被当成"代码变了"）')
  /**
   * ⚠️ 断言要写成"**没有正向通过行**"，不能只写"不含『通过』二字" ——
   * 文案里恰好有一句"**别把它当通过**"，那是**否定**用法。
   * （第一次就是这么挂的：断言太粗 ⇒ 把正确的提示语判成了失败。）
   */
  ok(!/集合未变|—— 通过 ═══/u.test(out), '**不能出现正向通过行**（那才是假绿的形态）')
} finally {
  writeFileSync(target, original, 'utf8')
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
