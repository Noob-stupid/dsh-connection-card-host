// 连接礼仪卡片 · 离线单测（假 api；不碰宿主、不投递任何真实消息）
//
//   ① apply 会尝试 quiet 宣告
//   ② 宣告失败：apply 不抛、只 log，且状态没被记为"已宣告"
//   ③ 下次工具调用会重试宣告（惰性补救 —— 本轮的关键修复）
//   ④ 宣告成功后再调用不重复宣告（幂等）
//   ⑤ 工具把 text/urgency 原样转发，并回传宿主的结构化结果
//   ⑥ 非法 urgency 不发送，且返回 { ok:false, reason:'bad-urgency' }
//   ⑦ 整个 evidence 出现在日志里
//   ⑧ SKILL.md 与 index.js 内联的 POLICY_TEXT 逐字一致
//
// 跑法：node test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, POLICY_TEXT } from './index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * ⚠️ **读进来先归一化行尾**（CRLF → LF）再比对。
 *
 * 为什么必须这么做（真机抓到的一次失败）：
 *
 *     ❌ ⑧ SKILL.md(379 字符) 与 POLICY_TEXT(367 字符) 不一致
 *
 * 差的正是 **12** —— 文件 12 行、每行多一个 `\r` ✓。
 * 原因：`SKILL.md` 在磁盘上被检出成 **CRLF**（Windows 上 `core.autocrlf` 的默认行为 ✓），
 * 而 `POLICY_TEXT` 是**代码里的字符串字面量**（永远是 LF ✓）⇒ 逐字比对必然不等 ✗。
 *
 * ⇒ 这类断言**不该依赖行尾**：文件的行尾是**签出环境**的属性，
 * 不是内容的属性 ✓。（同一份内容在 Linux 检出是 LF、Windows 检出是 CRLF —— 都对 ✓。）
 * 归一化之后，"逐字一致"这条判据才**只针对内容** ✓。
 */
const readNormalized = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const SKILL = readNormalized(join(HERE, 'SKILL.md'))

/**
 * 假 CardAPI：只实现本卡用到的三个成员（scope / log / registerTool / sendMessage）。
 * `replies[i]` 决定第 i 次 sendMessage 的返回；给 Error 实例则模拟"宿主抛错"。
 */
function fakeApi(replies = [{ ok: true }]) {
  const sends = []
  const logs = []
  const tools = new Map()
  let i = 0
  const api = {
    scope: 'a',
    log: (...args) => {
      logs.push(args)
    },
    registerTool: (name, fn) => {
      tools.set(name, fn)
    },
    async sendMessage(text, options) {
      const reply = replies[Math.min(i, replies.length - 1)]
      i += 1
      sends.push({ text, options })
      if (reply instanceof Error) throw reply
      return reply
    },
  }
  return {
    api,
    sends,
    logs,
    hasTool: () => tools.has('report_connection_note'),
    tool: (args) => tools.get('report_connection_note')(args),
    logText: () =>
      logs
        .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
        .join('\n'),
  }
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
    passed += 1
  } catch (e) {
    console.log(`❌ ${name}\n   ${e?.message ?? e}`)
    failed += 1
  }
}

// ── ① ────────────────────────────────────────────────────────────────────────
await check('① apply 会尝试 quiet 宣告', async () => {
  const t = fakeApi([{ ok: true, via: 'quiet' }])
  const ret = await apply(t.api)
  assert.equal(ret, true, 'apply 的返回值应反映宣告结果')
  assert.equal(t.sends.length, 1, 'apply 期间应恰好投递一次（宣告）')
  assert.equal(t.sends[0].text, POLICY_TEXT, '宣告文本必须是 POLICY_TEXT 全文')
  assert.deepEqual(t.sends[0].options, { urgency: 'quiet', kind: 'say' })
  assert.ok(t.hasTool(), 'apply 必须注册 report_connection_note')
})

// ── ② ────────────────────────────────────────────────────────────────────────
await check('② 宣告失败：apply 不抛、只 log，状态未被记为已宣告', async () => {
  const t = fakeApi([
    { ok: false, reason: '这张卡片挂在两端（scope=both）—— 无法判定该对哪一端说话，故未发送' },
  ])
  let threw = null
  let ret
  try {
    ret = await apply(t.api)
  } catch (e) {
    threw = e
  }
  assert.equal(threw, null, `apply 绝不能抛，实际抛出：${threw?.message}`)
  assert.equal(ret, false, '宣告失败时 apply 应返回 false')
  assert.match(t.logText(), /策略宣告未送达/)
  assert.match(t.logText(), /scope=both/, '日志要如实写回宿主给的原因（不谎报已宣告）')
  assert.ok(t.hasTool(), '宣告失败不得影响工具注册')
})

// ── ③ ────────────────────────────────────────────────────────────────────────
await check('③ 下次工具调用会重试宣告（惰性补救）', async () => {
  const t = fakeApi([{ ok: false, reason: '对端冷会话，quiet 不投递' }, { ok: true }])
  await apply(t.api) // 宣告失败
  assert.equal(t.sends.length, 1)

  const r = await t.tool({ text: '插话正文', urgency: 'urgent', evidence: { peerTask: 'x' } })
  assert.deepEqual(r, { ok: true })
  assert.equal(t.sends.length, 3, '应 = 首次失败宣告 + 补宣告 + 正文')
  assert.equal(t.sends[1].text, POLICY_TEXT, '第 2 次投递必须是宣告（重试）')
  assert.deepEqual(t.sends[1].options, { urgency: 'quiet', kind: 'say' })
  assert.equal(t.sends[2].text, '插话正文', '补宣告之后才发正文')
  assert.deepEqual(t.sends[2].options, { urgency: 'urgent', kind: 'say' })
})

// ── ④ ────────────────────────────────────────────────────────────────────────
await check('④ 宣告成功后再调用不重复宣告（幂等）', async () => {
  const t = fakeApi([{ ok: true }])
  await apply(t.api)
  await t.tool({ text: 'a', urgency: 'normal' })
  await t.tool({ text: 'b', urgency: 'urgent' })
  await t.tool({ text: 'c', urgency: 'quiet' })
  assert.equal(t.sends.length, 4, '1 次宣告 + 3 条正文（宣告不得重复）')
  assert.equal(t.sends.filter((s) => s.text === POLICY_TEXT).length, 1, '宣告只应出现一次')
  assert.deepEqual(
    t.sends.map((s) => s.text),
    [POLICY_TEXT, 'a', 'b', 'c'],
  )
})

// ── ⑤ ────────────────────────────────────────────────────────────────────────
await check('⑤ 工具把 text/urgency 原样转发，并回传宿主的结构化结果', async () => {
  const t = fakeApi([{ ok: true }])
  await apply(t.api)
  const text = '  原样转发：不要 trim、不要加前缀、不要改写  '
  const r = await t.tool({ text, urgency: 'preempt', evidence: {} })
  assert.deepEqual(r, { ok: true })
  assert.equal(t.sends[1].text, text, 'text 必须逐字转发')
  assert.deepEqual(t.sends[1].options, { urgency: 'preempt', kind: 'say' })

  const t2 = fakeApi([{ ok: true, via: 'preempt', live: true }])
  await apply(t2.api)
  const r2 = await t2.tool({ text: 'x', urgency: 'preempt' })
  assert.deepEqual(r2, { ok: true, via: 'preempt', live: true }, '必须原样回传宿主的返回结构')

  const t3 = fakeApi([{ ok: false, reason: '这一端没有可投递的会话（对端可能尚未建立）' }])
  await apply(t3.api)
  const r3 = await t3.tool({ text: 'y', urgency: 'urgent' })
  assert.deepEqual(r3, { ok: false, reason: '这一端没有可投递的会话（对端可能尚未建立）' })
})

// ── ⑥ ────────────────────────────────────────────────────────────────────────
await check('⑥ 非法 urgency 不发送且返回 bad-urgency', async () => {
  const t = fakeApi([{ ok: true }])
  await apply(t.api)
  const before = t.sends.length
  for (const bad of ['soon', 'URGENT', 'both', '', undefined, null, 3]) {
    const r = await t.tool({ text: 'x', urgency: bad })
    assert.deepEqual(r, { ok: false, reason: 'bad-urgency' }, `urgency=${String(bad)} 应被拒`)
  }
  assert.equal(t.sends.length, before, '非法档位不得产生任何投递')
})

await check('⑥-b 未宣告时，非法 urgency 也不顺手补宣告', async () => {
  const t = fakeApi([{ ok: false, reason: '对端不可达' }])
  await apply(t.api) // 宣告失败 ⇒ 未宣告
  const r = await t.tool({ text: 'x', urgency: 'now' })
  assert.deepEqual(r, { ok: false, reason: 'bad-urgency' })
  assert.equal(t.sends.length, 1, '只应有 apply 那次失败宣告，工具调用不产生投递')
})

// ── ⑦ ────────────────────────────────────────────────────────────────────────
await check('⑦ 整个 evidence 出现在日志里', async () => {
  const t = fakeApi([{ ok: true }])
  await apply(t.api)
  const evidence = {
    peerTask: '正在改 card-api.ts 的 sendMessage',
    sameArea: true,
    supplement: '发现 scope=both 分支漏了 return',
    duplicateOf: null,
  }
  await t.tool({ text: '停下，那一处前提是错的', urgency: 'preempt', evidence })
  const log = t.logText()
  assert.ok(log.includes(JSON.stringify(evidence)), '日志里应有 evidence 的完整 JSON')
  for (const v of ['peerTask', '正在改 card-api.ts 的 sendMessage', 'sameArea', 'supplement', 'duplicateOf', 'preempt']) {
    assert.ok(log.includes(v), `日志缺少 evidence 内容：${v}`)
  }
})

// ── ⑧ ────────────────────────────────────────────────────────────────────────
await check('⑧ SKILL.md 与内联 POLICY_TEXT 逐字一致', () => {
  assert.equal(
    SKILL,
    POLICY_TEXT,
    `SKILL.md(${SKILL.length} 字符) 与 POLICY_TEXT(${POLICY_TEXT.length} 字符) 不一致`,
  )
})

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILED'} — passed=${passed} failed=${failed}`)
process.exit(failed === 0 ? 0 : 1)
