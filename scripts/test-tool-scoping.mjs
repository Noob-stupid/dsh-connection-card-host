// 按会话 scope 隐藏工具的离线断言
// 纯函数可测：不依赖真实 agent / 会话，覆盖各种情况（尤其 fail-open 分支）
import { decideFilter, filterAssembly, setScopingEnabled } from '../lib/core/tool-scoping.js'

let pass = 0
let fail = 0
const ok = (cond, label, extra) => {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${extra ? `  → ${extra}` : ''}`)
  }
}

const conns = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }))
const deps = (n) => ({ getConnectionsBySession: () => conns(n) })
const agent = (sid) => ({ scope: { session: { id: sid } } })

console.log('═══ decideFilter：该不该过滤 ═══')

// ── 正常路径 ──
ok(decideFilter(agent('s1'), deps(0)).filter === true, '没连接 → 过滤')
ok(decideFilter(agent('s1'), deps(1)).filter === false, '有 1 条连接 → 不过滤')
ok(decideFilter(agent('s1'), deps(3)).filter === false, '有 3 条连接 → 不过滤')

// ── fail-open：每一处拿不准都不能过滤 ──
ok(decideFilter(undefined, deps(0)).filter === false, 'fail-open：没有 context')
ok(decideFilter({}, deps(0)).filter === false, 'fail-open：context 上没有 scope')
ok(decideFilter({ scope: null }, deps(0)).filter === false, 'fail-open：scope 是 null')
ok(decideFilter({ scope: {} }, deps(0)).filter === false, 'fail-open：scope 上没有 session')
ok(decideFilter({ scope: { session: {} } }, deps(0)).filter === false, 'fail-open：session 没有 id')
ok(decideFilter({ scope: { session: { id: '' } } }, deps(0)).filter === false, 'fail-open：id 是空串')
ok(decideFilter({ scope: { session: { id: 123 } } }, deps(0)).filter === false, 'fail-open：id 不是字符串')

// ── fail-open：查连接抛错 / 返回怪东西 ──
ok(
  decideFilter(agent('s1'), {
    getConnectionsBySession: () => {
      throw new Error('服务没装配')
    },
  }).filter === false,
  'fail-open：查连接抛错',
)
ok(
  decideFilter(agent('s1'), { getConnectionsBySession: () => null }).filter === false,
  'fail-open：查连接返回 null',
)

// ── 开关 ──
setScopingEnabled(false)
ok(decideFilter(agent('s1'), deps(0)).filter === false, '开关关闭 → 不过滤')
setScopingEnabled(true)

console.log('\n═══ filterAssembly：摘掉哪些 ═══')

const asm = (names) => ({ tools: names.map((n) => ({ name: n })), sections: ['keep-me'] })
const OUR = [
  'connection_send',
  'connection_card_tool',
  'connection_peer_work',
  'connection_conventions',
  'connection_declare',
]

const r1 = filterAssembly(asm([...OUR, 'bash', 'read', 'write']))
ok(r1.removed === 5, `摘掉 5 个感知工具（实得 ${r1.removed}）`)
ok(
  r1.assembly.tools.every((t) => !t.name.startsWith('connection_')),
  '剩下的没有 connection_ 前缀',
)
ok(r1.assembly.tools.length === 3, '别人的 3 个工具原样保留')
ok(r1.assembly.sections?.[0] === 'keep-me', '其他字段（sections）原样保留')

const r2 = filterAssembly(asm(['bash', 'read']))
ok(r2.removed === 0 && r2.assembly.tools.length === 2, '没有感知工具 → 一个不动')

// 边界：过滤后为空 → 放弃过滤（让模型面对空工具面比多几个工具更糟）
const r3 = filterAssembly(asm([...OUR]))
ok(r3.removed === 0, '只有感知工具时放弃过滤（不返回空工具面）')
ok(r3.assembly.tools.length === 5, '  └ 5 个都留着')

// 边界：tools 不是数组
ok(filterAssembly({}).removed === 0, 'tools 缺失 → 不动')
ok(filterAssembly({ tools: null }).removed === 0, 'tools 是 null → 不动')
ok(filterAssembly({ tools: 'x' }).removed === 0, 'tools 不是数组 → 不动')

// 边界：工具项没有 name
const r4 = filterAssembly({ tools: [{ name: 'bash' }, {}, { name: undefined }, { name: 'connection_send' }] })
ok(r4.removed === 1, `无名项不被误删（摘 ${r4.removed}）`)

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail === 0 ? 0 : 1)
