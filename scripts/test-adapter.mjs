/**
 * 适配层离线断言 —— 不依赖真实 DSH、不加载任何第三方插件。
 *
 * 只测**纯逻辑**：能力门面的转换、影子 ctx 的拒绝语义、命名与可见性判定。
 * 这些是后面所有实验的地基，它们错了，实验现象会指向完全错误的方向。
 *
 * 跑法：npm run test:adapter（或 node scripts/test-adapter.mjs）
 */
import {
  parametersToJsonSchema,
  defineTool,
  Schema,
} from '../lib/adapter/facade.js'
import {
  validateDeclaration,
  describeCapabilityFailure,
  isImplemented,
  ALL_CAPABILITIES,
} from '../lib/adapter/capabilities.js'
import { createShadowCtx } from '../lib/adapter/shadow-ctx.js'
import {
  bridgedToolName,
  sanitizeCardId,
  isBridgedToolName,
  decideBridgedVisibility,
} from '../lib/adapter/tool-scope.js'
import { isAdapterEnabled, setAdapterEnabled } from '../lib/adapter/flags.js'

let pass = 0
let fail = 0

function ok(cond, label) {
  if (cond) {
    pass++
  } else {
    fail++
    console.log(`  ❌ ${label}`)
  }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`  ❌ ${label}\n      期望 ${e}\n      实得 ${a}`)
  }
}

function throws(fn, matcher, label) {
  try {
    fn()
    fail++
    console.log(`  ❌ ${label}（期望抛错，实际没抛）`)
  } catch (e) {
    const msg = String(e && e.message ? e.message : e)
    if (matcher && !matcher.test(msg)) {
      fail++
      console.log(`  ❌ ${label}（抛错文案不匹配）\n      实得 ${msg}`)
    } else {
      pass++
    }
  }
}

/* ═══════════════ 1. 能力门面：参数规格 → JSON Schema ═══════════════ */

console.log('── 1. 门面：参数规格 → JSON Schema（照官方第 601-604 行的 required 规则）')

// 官方规则：属性默认可选 —— 没有 required:true 时，required 键**整个不出现**
eq(
  parametersToJsonSchema({ url: { type: 'string', description: 'URL' } }),
  { type: 'object', properties: { url: { type: 'string', description: 'URL' } } },
  '未写 required:true ⇒ 不产出 required 键',
)

// 显式 required:true 才进数组，且该标记**不能泄漏**到属性 schema 里
eq(
  parametersToJsonSchema({ a: { type: 'string', required: true }, b: { type: 'number' } }),
  { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] },
  'required:true ⇒ 进数组，且不泄漏进属性 schema',
)

eq(parametersToJsonSchema(undefined), { type: 'object', properties: {} }, '无参数规格 ⇒ 空对象 schema')

/* ═══════════════ 2. 门面：defineTool ═══════════════ */

console.log('── 2. 门面：defineTool')

throws(
  () =>
    defineTool({
      name: 't',
      description: 'd',
      output: { schema: { type: 'string' }, render: () => '' },
      execute: async () => '',
      timeoutMs: -1,
    }),
  /timeoutMs must be a positive finite number/,
  'timeoutMs 非正数 ⇒ 抛错（照官方第 847 行）',
)

{
  const calls = []
  const def = defineTool({
    name: 'demo',
    description: '说明',
    parameters: { x: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (a, v) => String(v) },
    execute: async (args, exec) => {
      calls.push([args, exec])
      return 'ok'
    },
    deferLoading: true,
    timeoutMs: 5000,
    finalizeContent: () => 'fin',
    isConcurrencySafe: () => true,
  })

  ok(def.__facade === true, '定义带 __facade 标记（诚实标注来源）')
  ok(def.deferLoading === true, 'deferLoading 透传')
  ok(def.timeoutMs === 5000, 'timeoutMs 透传')
  eq(def.parameters, { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] }, '参数已转换')
  ok(typeof def.output.render === 'function', 'output.render 保留')
  ok(typeof def.finalizeContent === 'function', 'finalizeContent 透传')
  ok(typeof def.isConcurrencySafe === 'function', 'isConcurrencySafe 透传')

  const execToken = { agent: { session: { header: { id: 's1' } } } }
  const ret = await def.execute({ x: 'hi' }, execToken)
  ok(ret === 'ok', 'execute 返回用户结果')
  ok(calls.length === 1 && calls[0][1] === execToken, 'execute 把 exec 原样交给插件（调用时校验的基础）')
}

// deferLoading 默认不出现（官方只在 === true 时带上）
{
  const def = defineTool({
    name: 'no-defer',
    description: 'd',
    output: { schema: { type: 'string' }, render: () => '' },
    execute: async () => '',
  })
  ok(!('deferLoading' in def), '未声明 deferLoading ⇒ 键不出现（与官方一致）')
}

/* ═══════════════ 3. Schema 门面：只求构造得出来 ═══════════════ */

console.log('── 3. 门面：Schema（插件在模块顶层会构造 Config）')

{
  const cfg = Schema.object({
    executablePath: Schema.string(),
    viewport: Schema.object({ width: Schema.number().default(1280) }),
    navigationTimeoutMs: Schema.number().optional().description('超时'),
  })
  ok(cfg && cfg.__schemaType === 'object', 'Schema.object 可构造')
  ok(Schema.string().default('x').optional().description('d').__schemaType === 'string', '链式调用不断链')
}

/* ═══════════════ 4. 能力申报校验 ═══════════════ */

console.log('── 4. 能力申报校验')

eq(validateDeclaration(undefined), { ok: true, declared: [] }, '未申报 ⇒ 合法（空集）')
eq(validateDeclaration([]), { ok: true, declared: [] }, '空数组 ⇒ 合法')

{
  const r = validateDeclaration(['tools', 'tools', 'effect'])
  ok(r.ok, '重复项不导致失败')
  eq(r.declared, ['effect', 'tools'], '去重并排序')
}

{
  const r = validateDeclaration(['tools', 'telepathy'])
  ok(!r.ok, '未定义能力名 ⇒ 拒绝（不静默丢弃）')
  ok(/telepathy/.test(r.reason), '拒绝文案点名了那个能力')
  ok(/tools/.test(r.reason), '拒绝文案列出了可用能力')
}

{
  const r = validateDeclaration(['events'])
  ok(r.ok, '已列入词汇表但未实现的能力（events）⇒ 申报仍然合法')
  eq(r.declared, ['events'], '如实保留在申报集合里')
}

/**
 * ⚠️ 别再用 llm/prompt 当"未实现"样本 —— 它们**已经实现**了。
 * 未实现的样本改用 events/agent（用户明确不要模型路由，这两个不在路线图上）。
 */
ok(isImplemented('tools') && !isImplemented('events'), 'isImplemented 区分已实现/未实现')
ok(isImplemented('llm') && isImplemented('prompt'), 'llm 与 prompt 现在**已实现**')
ok(
  ALL_CAPABILITIES.includes('llm') &&
    ALL_CAPABILITIES.includes('prompt') &&
    ALL_CAPABILITIES.includes('events') &&
    ALL_CAPABILITIES.includes('agent'),
  '词汇表含 llm / prompt / events / agent',
)

/* ═══════════════ 5. 拒绝文案要能区分两种情形 ═══════════════ */

console.log('── 5. 拒绝文案：未申报 vs 已申报但未实现')

{
  const m1 = describeCapabilityFailure('events', ['tools'], 'p1')
  ok(/未申报/.test(m1), '未申报 ⇒ 文案说"未申报"')
  ok(/tools/.test(m1), '未申报 ⇒ 列出它申报了什么')

  const m2 = describeCapabilityFailure('events', ['tools', 'events'], 'p1')
  ok(/尚未实现/.test(m2), '已申报但未实现 ⇒ 文案说"尚未实现"')
  ok(!/未申报/.test(m2), '两种情形文案不混用')
}

/* ═══════════════ 6. 影子 ctx：护栏②的核心 ═══════════════ */

console.log('── 6. 影子 ctx')

{
  const logs = []
  const shadow = createShadowCtx({
    pluginId: 'demo-plugin',
    declaration: validateDeclaration(['tools', 'effect']),
    audit: (m) => logs.push(m),
  })

  // 申报过的 tools 能用
  const def = { name: 'do_thing', description: 'x', parameters: {}, output: {}, execute: async () => 1 }
  const disposer = shadow.ctx.tools.register(def)
  ok(shadow.capture.tools.has('do_thing'), '注册的工具被捕获')
  ok(logs.some((l) => /注册工具「do_thing」/.test(l)), '注册动作留了审计')

  // 重复注册要抛（静默覆盖会让"少了一个工具"极难查）
  throws(() => shadow.ctx.tools.register(def), /重复注册/, '同名重复注册 ⇒ 抛错')

  // 注销函数可用
  disposer()
  ok(!shadow.capture.tools.has('do_thing'), 'register 返回的 disposer 能撤销注册')

  // effect：立即执行 + 登记清理
  let cleaned = 0
  shadow.ctx.effect(() => () => {
    cleaned++
  }, 'demo effect')
  eq(shadow.capture.disposers.length, 1, 'effect 登记了清理函数')

  // 未申报的能力 ⇒ 显式失败
  throws(() => shadow.ctx.llm, /未申报/, '访问未申报能力 ⇒ 抛错且说明未申报')

  // 反射性访问不该抛
  ok(shadow.ctx.then === undefined, 'ctx.then ⇒ undefined（await ctx 不炸）')
  ok(String(shadow.ctx).includes('shadow-ctx'), '模板插值/字符串化不抛')

  // ctx.set：语义冲突，明确拒绝并记账
  throws(() => shadow.ctx.set('myService', {}), /语义冲突/, 'ctx.set 向全局提供服务 ⇒ 明确拒绝')
  eq(shadow.capture.providedAttempts, ['myService'], '拒绝同时记账（可供审计）')

  // dispose：逆序清理 + 清空工具表
  const order = []
  const s2 = createShadowCtx({
    pluginId: 'p2',
    declaration: validateDeclaration(['effect']),
    audit: () => {},
  })
  s2.ctx.effect(() => () => order.push('first'), 'first')
  s2.ctx.effect(() => () => order.push('second'), 'second')
  s2.dispose()
  eq(order, ['second', 'first'], 'dispose 逆序执行清理')

  // 清理时某个 disposer 抛错，不影响其余
  const s3 = createShadowCtx({ pluginId: 'p3', declaration: validateDeclaration(['effect']), audit: () => {} })
  let reached = false
  s3.ctx.effect(() => () => {
    throw new Error('boom')
  }, 'bad')
  s3.ctx.effect(() => () => {
    reached = true
  }, 'good')
  s3.dispose()
  ok(reached, '一个 disposer 抛错不阻断其余清理')
}

{
  // 申报了 events（未实现）后被访问 ⇒ 文案必须说"尚未实现"，与"未申报"区分
  const shadow = createShadowCtx({
    pluginId: 'p-events',
    declaration: validateDeclaration(['tools', 'events']),
    audit: () => {},
  })
  throws(() => shadow.ctx.events, /尚未实现/, '已申报但未实现 ⇒ 抛错且说"尚未实现"')
}

/* ═══════════════ 7. 命名 ═══════════════ */

console.log('── 7. 桥接工具命名')

eq(sanitizeCardId('@noob-stupid/pdf-card'), '_noob_stupid_pdf_card', '非法字符换成下划线')
eq(bridgedToolName('pdf-card', 'open'), 'card_pdf_card_open', '工具名带卡片前缀')
ok(isBridgedToolName('card_x_y') && !isBridgedToolName('browser_open'), 'isBridgedToolName 只认前缀')

/* ═══════════════ 8. 可见性判定（两处共用的那一份） ═══════════════ */

console.log('── 8. 可见性判定')

const conn = { sessionA: 'sess-A', sessionB: 'sess-B' }

{
  const d = decideBridgedVisibility('both', conn, 'sess-A')
  ok(d.visible && d.side === 'a', "scope=both ⇒ A 端可见")

  const d2 = decideBridgedVisibility('both', conn, 'sess-B')
  ok(d2.visible && d2.side === 'b', 'scope=both ⇒ B 端可见')

  const d3 = decideBridgedVisibility('a', conn, 'sess-A')
  ok(d3.visible, "scope=a ⇒ A 端可见")

  const d4 = decideBridgedVisibility('a', conn, 'sess-B')
  ok(!d4.visible, 'scope=a ⇒ B 端不可见')
  ok(/A 端/.test(d4.reason) && /B 端/.test(d4.reason), '拒绝文案同时点明"只对 A 端"和"你在 B 端"')

  const d5 = decideBridgedVisibility('both', conn, 'sess-X')
  ok(!d5.visible && /不在这条连接里/.test(d5.reason), '不在连接里的会话 ⇒ 不可见且说明原因')

  const d6 = decideBridgedVisibility('both', conn, null)
  ok(!d6.visible && /认不出调用方/.test(d6.reason), '认不出会话 ⇒ 不可见（不 fail-open）')

  const d7 = decideBridgedVisibility(undefined, conn, 'sess-A')
  ok(d7.visible, 'scope 未设 ⇒ 按 both 处理（与卡片既有语义一致）')
}

/* ═══════════════ 9. 总开关默认 OFF ═══════════════ */

console.log('── 9. 总开关')

ok(isAdapterEnabled() === false, '默认关闭（用户要求：默认 OFF）')
setAdapterEnabled(true)
ok(isAdapterEnabled() === true, '可显式开启')
setAdapterEnabled(false)
ok(isAdapterEnabled() === false, '可再次关闭')
setAdapterEnabled('yes')
ok(isAdapterEnabled() === false, '非布尔真值不当作开启（只认 true）')

/* ═══════════════ 结果 ═══════════════ */

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
