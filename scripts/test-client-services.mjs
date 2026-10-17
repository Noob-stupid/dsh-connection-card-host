/**
 * **P2-2 客户端能力面**的测试：允许清单转发 + 不越界。
 *
 * ## 它钉什么
 *
 * 生态里真实 UI 插件几乎都要 `locale` / `configForms` 之类 ✗ —— 只给 `slots`/`effect`
 * 时它们**挂得上、槽位也注册，但渲染必然失败** ✓（真机实测 ✓）。
 * 这一层按**允许清单**把宿主真实 ctx 的服务转过去 ✓。
 *
 * ## 为什么是允许清单（不是"能转就转"）
 *
 * 转发的是**我们自己的** ctx ✓（权限等同本插件 ✓）⇒ 只放**展示/配置类** ✓，
 * `connection` / `remote` / 认证类**不放** ✗（它们能替用户对外做事 ✓）。
 *
 * ## 正控 / 负控
 *
 *   · 正控：清单内（`locale`）⇒ 两种写法（`ctx.get('locale')` / `ctx.locale`）**都拿到真对象** ✓
 *   · 负控：清单外（`connection`）⇒ **不转发** ✓（`get` 返回 undefined ✓；直连**抛错** ✓）
 *     并且**记一条警告** ✓（学习式诊断：日志会告诉我们生态还需要什么 ✓）
 *   · 边界：没注入解析器 ⇒ 一律不转发 ✓（不崩 ✓）
 *
 * 跑法：node scripts/test-client-services.mjs
 */
import { instantiateCaptured, setClientServiceResolver } from '../lib/ui/capture-client.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))
const eq = (a, b, l) => (a === b ? pass++ : (fail++, console.log(`  ❌ ${l}\n      期望 ${b}，实得 ${a}`)))

/** 造一个"捕获到的" factory：它在 apply 里试着取两个服务并记下来 ✓。 */
function fakeCaptured() {
  const seen = {}
  return {
    seen,
    captured: {
      id: 'fake-card',
      factory: () => ({
        inject: ['slots'],
        apply: (ctx) => {
          try {
            seen.viaGet = ctx.get('locale')
          } catch (e) {
            seen.viaGet = `throw:${e.message}`
          }
          try {
            seen.viaDirect = ctx.locale
          } catch (e) {
            seen.viaDirect = `throw:${e.message}`
          }
          try {
            seen.bad = ctx.get('connection')
          } catch (e) {
            seen.bad = `throw:${e.message}`
          }
          try {
            seen.badDirect = ctx.connection
          } catch (e) {
            seen.badDirect = `throw:${e.message}`
          }
        },
      }),
    },
  }
}

const LOCALE = { t: () => 'x' }
const CONN = { send: () => {} }

console.log('── ① 正控：允许清单内的服务，两种写法都转发 ✓')

{
  const off = setClientServiceResolver((name) => (name === 'locale' ? LOCALE : name === 'connection' ? CONN : undefined))
  const { seen, captured } = fakeCaptured()
  const warns = []
  instantiateCaptured(captured, () => ({}), (m) => warns.push(m))
  eq(seen.viaGet, LOCALE, '`ctx.get("locale")` ⇒ 拿到真实对象 ✓')
  eq(seen.viaDirect, LOCALE, '`ctx.locale` ⇒ 也拿到 ✓（直连写法同样支持 ✓）')
  off()
}

console.log('── ② 负控：清单外的服务**不转发**（能对外做事的那些 ✗）')

{
  const off = setClientServiceResolver(() => CONN)
  const { seen, captured } = fakeCaptured()
  const warns = []
  instantiateCaptured(captured, () => ({}), (m) => warns.push(m))
  eq(seen.bad, undefined, '`ctx.get("connection")` ⇒ **undefined** ✓（不转发 ✓）')
  ok(String(seen.badDirect).startsWith('throw:'), '`ctx.connection` ⇒ **抛错** ✓（硬失败，不静默 ✓）')
  ok(
    warns.some((w) => w.includes('未开放转发')),
    `要记一条"未开放转发"的警告 ✓（学习式诊断；实得 ${warns.length} 条告警）`,
  )
  off()
}

console.log('── ③ 边界：没有注入解析器 ⇒ 一律不转发（也不崩）')

{
  const { seen, captured } = fakeCaptured()
  instantiateCaptured(captured, () => ({}), () => {})
  eq(seen.viaGet, undefined, '没有解析器 ⇒ get 返回 undefined ✓')
  ok(String(seen.viaDirect).startsWith('throw:'), '没有解析器 ⇒ 直连抛错 ✓（与"未提供"语义一致 ✓）')
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
