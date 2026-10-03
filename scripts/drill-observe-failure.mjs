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
const eq = (a, b, l) =>
  JSON.stringify(a) === JSON.stringify(b)
    ? pass++
    : (fail++, console.log(`  ❌ ${l} —— 期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`))

/** 跑一次护栏，返回 `{ status, json }`（**断言结构**，不断言人类文案）。 */
function runGuard() {
  let status = 0
  let out = ''
  try {
    out = String(execFileSync(process.execPath, [target, '--json'], { encoding: 'utf8' }))
  } catch (e) {
    status = e.status ?? -1
    out = String(e.stdout ?? '')
  }
  let json = null
  for (const line of out.split('\n')) {
    const t = line.trim()
    if (t.startsWith('{')) {
      try {
        json = JSON.parse(t)
      } catch {
        /* 不是 JSON 行：忽略 */
      }
    }
  }
  return { status, json, out }
}

/**
 * ⚠️ **演练成对**（对端点明）：**负例**（观测失败 ⇒ 必须 2）+ **正例**（干净树 ⇒ 必须 0）。
 *
 * 只有负例的话，将来有人把下限门槛调坏，护栏会**永久红** ⇒
 * 又被"习惯性 --update/关掉"磨掉（回到信噪比那条）。
 * 正例的作用就是**证明护栏在正常情况下真的是绿的**。
 */
console.log('── 正例：干净树 ⇒ 必须 ok/0')

{
  const r = runGuard()
  ok(r.status === 0, `干净树 ⇒ 退出码 0（实测 ${r.status}）`)
  eq(r.json?.status, 'ok', 'JSON status = ok')
  eq(r.json?.removed?.length, 0, 'JSON removed 为空')
  ok((r.json?.symbols ?? 0) > 0, 'JSON 带上了符号数（结构化信号，不是文案）')
}

console.log('── 负例：观测失效 ⇒ 必须 unavailable/2')

try {
  // 把 src 指到不存在的目录 —— 模拟"观测手段失效"
  const broken = original.replace("const SRC = join(ROOT, 'src')", "const SRC = join(ROOT, 'src-nonexistent')")
  ok(broken !== original, '演练准备：能改到 SRC（否则演练本身没生效）')
  writeFileSync(target, broken, 'utf8')

  const r = runGuard()
  const { status, json } = r

  ok(status === 2, `观测失效时**必须失败**（实测退出码 ${status}，应为 2）`)
  /** ⚠️ **断言结构**（对端点明）：人类文案会变、会被否定句迷惑，JSON 不会。 */
  eq(json?.status, 'unavailable', 'JSON status = unavailable（**第三档**，不是 ok 也不是 changed）')
  ok(typeof json?.reason === 'string' && json.reason.length > 0, 'JSON 里带上了原因（结构化，可被脚本消费）')
  /**
   * 人类文案只留一条**粗判**：不能出现**正向通过行**。
   *
   * ⚠️ 这里踩过一次：最早断言"输出里不含『通过』二字" ⇒
   * 而正确文案里恰好有一句"**别把它当通过**"（否定用法）⇒ 把对的判成了错的 ✗。
   * 教训（对端归纳的）：**断言人类文本本身就是脆的** ——
   * 判据要做成**结构**（上面的 JSON），文案只作展示、不参与断言。
   */
  ok(!/集合未变/u.test(r.out), '人类文案里不能出现正向通过行（那才是假绿的形态）')
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
