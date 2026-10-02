// 抢占式中断的离线断言
// 这是整个机制里最危险的判断（"能不能打断别人"），每个分支都要钉住
import {
  admitPreempt,
  canPreempt,
  deliverModeFor,
  resetPreemptCooldown,
  setPreemptEnabled,
  shouldCancel,
  PREEMPT_COOLDOWN_MS,
} from '../lib/core/preempt.js'

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

const conn = (level) => ({
  id: 'c1',
  sessionA: 'sa',
  sessionB: 'sb',
  permission: { aToB: level, bToA: level },
  status: 'active',
  health: 'green',
  cards: [],
  createdAt: 0,
  updatedAt: 0,
})

console.log('═══ shouldCancel：什么情况下才真的打断 ═══')

// 硬红线：工具在飞 —— 无论跑没跑，都不能打断
ok(
  shouldCancel({ running: true, busyWithTool: true }).cancel === false,
  '在跑 + 工具执行中 → 不打断（硬红线：会留悬空调用）',
)
ok(
  shouldCancel({ running: false, busyWithTool: true }).cancel === false,
  '没在跑 + 工具在飞 → 不打断（状态矛盾时保守）',
)

// 正常可打断
ok(shouldCancel({ running: true, busyWithTool: false }).cancel === true, '在跑 + 不在工具中 → 可打断')

// 空闲不需要打断
ok(shouldCancel({ running: false, busyWithTool: false }).cancel === false, '空闲 → 不打断（steer 即开新回合）')

console.log('\n═══ canPreempt：三重闸门 ═══')

// ① 默认关闭
resetPreemptCooldown()
setPreemptEnabled(false)
ok(canPreempt(conn('write'), 'a').ok === false, '默认关闭时拒绝')

// 开启后的权限闸门
setPreemptEnabled(true)
resetPreemptCooldown()
ok(canPreempt(conn('write'), 'a').ok === true, 'write 权限 → 放行')
resetPreemptCooldown()
ok(canPreempt(conn('read'), 'a').ok === false, 'read 权限 → 拒绝')
resetPreemptCooldown()
ok(canPreempt(conn('suggest'), 'a').ok === false, 'suggest 权限 → 拒绝（只能发言，不能停别人的活）')

// 方向独立：aToB 是 write 不代表 bToA 也是
resetPreemptCooldown()
const asym = { ...conn('read'), permission: { aToB: 'write', bToA: 'read' } }
ok(canPreempt(asym, 'a').ok === true, '不对称连接：A→B 是 write → A 方向放行')
ok(canPreempt(asym, 'b').ok === false, '不对称连接：B→A 是 read → B 方向拒绝')

// ② 频控
resetPreemptCooldown()
const t0 = 1_000_000_000_000
ok(admitPreempt('c1', t0).ok === true, '第一次抢占放行')
const second = admitPreempt('c1', t0 + 1000)
ok(second.ok === false, '1 秒后再来 → 被频控挡住')
ok(
  second.ok === false && Math.abs(second.retryAfterMs - (PREEMPT_COOLDOWN_MS - 1000)) < 5,
  '  └ 且给出还需等待的毫秒数',
)
ok(admitPreempt('c1', t0 + PREEMPT_COOLDOWN_MS).ok === true, '满 5 分钟后放行')
// 不同连接互不影响
ok(admitPreempt('c2', t0).ok === true, '另一个连接不受这个连接的频控影响')

console.log('\n═══ deliverModeFor：原来的三档有没有被改动 ═══')
console.log('  （用户明确问过："不会动我们之前的不紧急情况之类的消息吧" —— 用真值表回答）\n')

// 原来三档：与改动前的实现逐格比对
ok(deliverModeFor('quiet', true) === 'inject', 'quiet + 对端在跑   → inject  （原来就是）')
ok(deliverModeFor('quiet', false) === 'inject', 'quiet + 对端空闲   → inject  （原来就是）')
ok(deliverModeFor('normal', true) === 'queue', 'normal + 对端在跑  → queue   （原来就是）')
ok(deliverModeFor('normal', false) === 'queue', 'normal + 对端空闲  → queue   （原来就是）')
ok(deliverModeFor('urgent', true) === 'steer', 'urgent + 对端在跑  → steer   （原来就是）')
ok(deliverModeFor('urgent', false) === 'queue', 'urgent + 对端空闲  → queue   （原来就是，降级不报错）')

// 新增档：投递模式与 urgent **完全相同** —— 多出来的只有 cancel
ok(deliverModeFor('preempt', true) === 'steer', 'preempt + 对端在跑 → steer   （与 urgent 同）')
ok(deliverModeFor('preempt', false) === 'queue', 'preempt + 对端空闲 → queue   （与 urgent 同）')

// 未知档位与 normal 同待遇（保守）
ok(deliverModeFor('', true) === 'queue', '未知档位 → queue（保守，与 normal 同）')
ok(deliverModeFor('乱写的', false) === 'queue', '乱写的档位 → queue（保守）')

console.log('\n═══ 降级语义：抢占失败 ≠ 消息发不出去 ═══')

resetPreemptCooldown()
setPreemptEnabled(false)
const r = canPreempt(conn('write'), 'a')
ok(r.ok === false, '关闭时 canPreempt 返回失败')
ok(
  r.ok === false && typeof r.reason === 'string' && r.reason.includes('urgent'),
  '  └ 且明确告诉调用方"可以用 urgent 替代" —— 失败时行为 = 普通 urgent，不是发不出去',
)

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail === 0 ? 0 : 1)
