/**
 * 适配卡状态判定（D6）的离线断言。
 *
 * 用户裁决：适配卡在候选列表里**照常显示 + 「适配」标注**，未就绪时**置灰并说明原因**。
 * 判定是纯函数（`src/adapter/status.ts`），宿主侧下发、UI 只照着显示 ——
 * 判定散进 UI 是"标注与实际行为脱节"的根源，所以这里把它钉死。
 *
 * 跑法：node scripts/test-status.mjs
 */
import { adapterStatusOf, canMountByStatus } from '../lib/adapter/status.js'
import { setAdapterEnabled } from '../lib/adapter/flags.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))
const eq = (a, b, l) => {
  const x = JSON.stringify(a)
  const y = JSON.stringify(b)
  if (x === y) pass++
  else {
    fail++
    console.log(`  ❌ ${l}\n      期望 ${y}\n      实得 ${x}`)
  }
}

console.log('── 1. 普通卡片：不受适配层影响')
{
  const s = adapterStatusOf(undefined)
  eq(s.isAdapter, false, '没有 adapter 段 ⇒ 不是适配卡')
  eq(s.status, 'ready', '普通卡片状态为 ready（该能挂就能挂）')
  ok(canMountByStatus(s.status), '普通卡片可挂')
}

console.log('── 2. 适配卡 + 开关关闭（默认）')
{
  setAdapterEnabled(false)
  const s = adapterStatusOf({ capabilities: ['tools', 'effect'] })
  eq(s.isAdapter, true, '有 adapter 段 ⇒ 是适配卡')
  eq(s.status, 'off', '开关关闭 ⇒ status=off')
  ok(/默认关闭/.test(s.reason), '说明里点出"默认关闭"')
  ok(/tools/.test(s.reason) && /effect/.test(s.reason), '说明里列出了申报的能力')
  ok(!canMountByStatus(s.status), 'off ⇒ 不可点（置灰）')
}

console.log('── 3. 适配卡 + 开关开启')
{
  setAdapterEnabled(true)
  const s = adapterStatusOf({ capabilities: ['tools', 'effect'] })
  eq(s.status, 'ready', '开关开启且能力都实现 ⇒ ready')
  ok(canMountByStatus(s.status), 'ready ⇒ 可点')
  ok(/已开启/.test(s.reason), '说明里标出"已开启"')
}

console.log('── 4. 申报了尚未实现的能力 ⇒ 即使开着也挂不上')
{
  setAdapterEnabled(true)
  /**
   * ⚠️ 样本用 `events`（不在路线图上），别再用 `llm` —— 它**已经实现**了。
   * 这条断言的意义是"申报里含未实现能力时，置灰且不受开关影响"。
   */
  const s = adapterStatusOf({ capabilities: ['tools', 'events'] })
  eq(s.status, 'unsupported', 'events 尚未实现 ⇒ unsupported（**不受开关影响**）')
  ok(/events/.test(s.reason), '说明里点名 events')
  ok(/尚未实现/.test(s.reason), '说明里写明"尚未实现"')
  ok(/tools/.test(s.reason), '说明里点出已实现的是哪些')
  ok(!canMountByStatus(s.status), 'unsupported ⇒ 不可点')

  // llm/prompt 现在已实现 ⇒ 只申报它们应当 ready
  const ready = adapterStatusOf({ capabilities: ['tools', 'llm', 'prompt'] }, true)
  eq(ready.status, 'ready', 'llm 与 prompt 已实现 ⇒ ready')
}

console.log('── 5. 边界')
{
  const s = adapterStatusOf({ capabilities: ['tools', 'tools', 'effect'] })
  eq(s.capabilities, ['effect', 'tools'], '能力清单去重并排序')

  const empty = adapterStatusOf({}, true)
  eq(empty.capabilities, [], '没有 capabilities 字段 ⇒ 空清单（合法：只要生命周期）')
  eq(empty.status, 'ready', '空清单 + 开关开启 ⇒ ready')

  const weird = adapterStatusOf({ capabilities: 'tools' }, true)
  eq(weird.capabilities, [], 'capabilities 不是数组 ⇒ 当空处理（不炸）')

  // 显式传 enabled 应当覆盖全局开关（测试可注入是刻意的）
  setAdapterEnabled(false)
  eq(adapterStatusOf({ capabilities: ['tools'] }, true).status, 'ready', '显式 enabled 覆盖全局开关')
  setAdapterEnabled(false)
}

setAdapterEnabled(false)

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
