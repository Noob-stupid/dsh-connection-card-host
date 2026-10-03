/**
 * 内置候选卡 `connection-etiquette` 的**集成测试**（我这一侧）。
 *
 * 与卡片自己的 `test.mjs` 分工不同：
 *   · 他的 → 卡片内部逻辑（宣告幂等、转发原样、证据进日志、SKILL 逐字一致）
 *   · 本文件 → **跨边界**的四件事：清单字段齐全 / 未授权拒绝 / `scope='both'` 拒绝 / 工具注册成功
 *
 * 也就是说：**卡片的策略写得对不对是他的测试管，卡片与宿主契约合不合得上是我这边管** ✓
 *
 * 跑法：node scripts/test-builtin-etiquette-card.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCardApi } from '../lib/card-host/card-api.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))
const eq = (a, b, l) =>
  JSON.stringify(a) === JSON.stringify(b)
    ? pass++
    : (fail++, console.log(`  ❌ ${l}\n      期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`))

const CARD_DIR = join(process.cwd(), 'cards', 'connection-etiquette')
const pkg = JSON.parse(readFileSync(join(CARD_DIR, 'package.json'), 'utf8'))

/* ═══════════ ① 清单字段齐全（契约对齐） ═══════════ */

console.log('── ① 清单字段（与宿主契约对齐）')

{
  ok(pkg.main === 'index.js', 'main 指向 index.js（不写会默认 dist/index.js ⇒ 找不到入口）')
  const c = pkg.dshCard ?? {}
  eq(c.id, 'connection-etiquette', 'id = connection-etiquette（注册表 key、也是收端看到的前缀名）')
  ok(typeof c.name === 'string' && c.name.length > 0, 'name 非空（面板显示用）')
  eq(c.requires?.write, ['send_message'], '**requires.write 含 send_message**（授权闸门）')
  ok(Array.isArray(c.events), 'events **存在**（必填字段，可空数组）')
  ok(!('scope' in c), '**不写 scope**（写了 a/b 会锁死该端、用户改不了）')
  ok(!('ui' in c), '不写 ui（本卡无面板）')
}

/* ═══════════ 造一个最小 api 来验跨边界行为 ═══════════ */

function makeApi({ write = ['send_message'], scope = 'a' } = {}) {
  const calls = []
  const tools = new Map()
  const api = createCardApi({
    instance: {
      instanceId: 'i1',
      templateId: 'connection-etiquette',
      connectionId: 'c1',
      scope,
      config: {},
      state: {},
      permissions: 'read',
      priority: 100,
      enabled: true,
    },
    eventBus: { subscribe: () => () => {}, emit: () => {} },
    adapter: { requestRemote: async () => ({}) },
    messageLog: { list: () => [], append: () => ({ ok: true }) },
    manager: {
      getById: () => ({ id: 'c1', sessionA: 'sess-A', sessionB: 'sess-B' }),
      persistMessages: () => {},
    },
    canSendMessage: () => write.includes('send_message'),
    resolvePeerSession: () => (scope === 'a' ? 'sess-B' : scope === 'b' ? 'sess-A' : undefined),
    deliver: async (sessionId, text, urgency) => {
      calls.push({ sessionId, text, urgency })
      return { ok: true, via: 'agents.get + followup', live: true }
    },
  })
  // 抓工具注册（CardAPI 只把它们收在内部，这里通过 registerTool 间接验证不抛）
  const origRegister = api.registerTool
  api.registerTool = (name, fn) => {
    tools.set(name, fn)
    return origRegister.call(api, name, fn)
  }
  return { api, calls, tools }
}

/* ═══════════ ② 未授权 ⇒ 拒绝（fail-closed） ═══════════ */

console.log('── ② 未授权时 sendMessage 拒绝')

{
  const { api, calls } = makeApi({ write: [] })
  const r = await api.sendMessage('策略', { urgency: 'quiet' })
  ok(!r.ok, '没声明 send_message ⇒ **拒绝发送**（授权是用户给的，不是默认权利）')
  eq(r.code, 'not-authorized', '结构化 code = not-authorized（卡片据此别再重试）')
  eq(r.permanent, true, 'permanent = true（重试也没用）')
  eq(calls.length, 0, '**一次投递都没发生**（拒绝发生在投递之前）')
}

/* ═══════════ ③ scope='both' ⇒ 拒绝 ═══════════ */

console.log('── ③ scope=both 时 sendMessage 拒绝（判不出该对哪端说话）')

{
  const { api, calls } = makeApi({ scope: 'both' })
  const r = await api.sendMessage('策略', { urgency: 'quiet' })
  ok(!r.ok, 'both ⇒ **拒绝**（宁可不说，也不要对错的一端说）')
  eq(r.code, 'scope-ambiguous', 'code = scope-ambiguous（永久）')
  eq(r.permanent, true, 'permanent = true')
  eq(calls.length, 0, '没有投递')
}

/* ═══════════ ④ 正常路径 + 工具注册成功 ═══════════ */

console.log('── ④ 正常路径：工具注册 + 投递走宿主既有通道 + 收端能辨识来源')

{
  const { api, calls, tools } = makeApi()
  /** 模拟卡片的 apply：注册工具（这是它唯一的工具） */
  api.registerTool('report_connection_note', async (params) =>
    api.sendMessage(String(params.text ?? ''), { urgency: params.urgency }),
  )
  ok(tools.has('report_connection_note'), '工具注册成功 ✓')

  /** 卡片自己的 apply 也会宣告；这里直接验"宣告"这条跨边界行为。 */
  const r = await api.sendMessage('策略全文', { urgency: 'quiet' })
  ok(r.ok === true, '授权 + 单端 ⇒ 投递成功')
  eq(calls.length, 1, '实际投递 1 次')
  eq(calls[0].sessionId, 'sess-B', '**投给了对端**（scope=a ⇒ 目标是 B 端会话）')
  eq(calls[0].urgency, 'quiet', 'urgency 原样透传')
  ok(
    calls[0].text.startsWith('【卡片 · connection-etiquette】'),
    '**收端能辨识来源**（自动前缀，别让接收方误判说话的人是谁）',
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
