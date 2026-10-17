/**
 * **统一日志出口**（`src/core/log.ts`）的测试。
 *
 * ## 它钉什么
 *
 * P1-1 的目标不是"少几个 console" ✗，而是：**出事时用户手里能拿到日志** ✓。
 * 所以判据是"**日志真的到了出口**" ✓，以及"**没有出口时不静默**" ✓。
 *
 *   · 正控：注册 sink ⇒ `log(logError)` 的消息**原样到达** sink ✓（带 level ✓）
 *   · 负控：反注册 ⇒ 回到 console 兜底 ✓（`hasLogSink()` 为假 ✓）——
 *     不能"没 sink 就什么都不写" ✗（那会让"日志没写进去"和"根本没发生"长得一样 ✓）
 *   · 边界：sink 自己抛错 ⇒ 仍然退回 console ✓（**出口坏了不能吞掉证据** ✓）
 *   · Error 参数 ⇒ 带 message + stack ✓（`String(err)` 会丢 stack ✗）
 *
 * 跑法：node scripts/test-log-sink.mjs
 */
import { hasLogSink, log, logError, logInfo, logWarn, setLogSink } from '../lib/core/log.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))
const eq = (a, b, l) => (a === b ? pass++ : (fail++, console.log(`  ❌ ${l}\n      期望 ${b}，实得 ${a}`)))

console.log('── ① 正控：注册 sink ⇒ 消息原样到达（带 level）')

{
  const seen = []
  const off = setLogSink((level, message) => seen.push([level, message]))
  ok(hasLogSink(), '注册后 hasLogSink() 为真 ✓')

  logInfo('hello', 'world')
  logWarn('careful')
  logError('boom')

  eq(seen.length, 3, '三条都应到达 sink ✓')
  eq(seen[0][0], 'info', 'level = info ✓')
  eq(seen[0][1], 'hello world', '多参数按空格拼接 ✓')
  eq(seen[1][0], 'warn', 'level = warn ✓')
  eq(seen[2][0], 'error', 'level = error ✓')

  off()
  ok(!hasLogSink(), '反注册后 hasLogSink() 为假 ✓（回到 console 兜底 ✓）')
}

console.log('── ② 边界：Error 参数要带 stack（String(err) 会丢 ✗）')

{
  const seen = []
  const off = setLogSink((level, message) => seen.push(message))
  const err = new Error('something broke')
  logError('失败:', err)
  ok(seen[0].includes('something broke'), 'Error 的 message 在里面 ✓')
  ok(seen[0].includes('at ') || seen[0].includes('\n'), '并带上了 stack（而不是只剩 message ✗）')
  off()
}

console.log('── ③ 负控：sink 自己抛错 ⇒ 仍然要留下痕迹（不能吞证据）')

{
  const off = setLogSink(() => {
    throw new Error('sink is broken')
  })
  /** 捕获 console 兜底：只要"不抛到调用方"且"有输出"即可 ✓。 */
  const orig = console.error
  let fellBack = false
  console.error = () => {
    fellBack = true
  }
  let threw = false
  try {
    logError('依然要能被看到')
  } catch {
    threw = true
  } finally {
    console.error = orig
    off()
  }
  ok(!threw, 'sink 抛错**不能**把调用方炸掉 ✓')
  ok(fellBack, 'sink 抛错时退回 console ✓（证据不能丢 ✓）')
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
