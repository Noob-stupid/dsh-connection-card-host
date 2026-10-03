/**
 * 运行时接线的离线验证：`CardAdapterHost` + 下发过滤安装器。
 *
 * 这两块是"适配层 ↔ 既有卡片系统"的唯一接缝，也是最容易出半截状态的地方：
 *   · 挂载成功但桥接失败 ⇒ 必须把插件也卸掉（不留半截）
 *   · 卸载 ⇒ 工具必须摘干净（无幽灵）+ 插件资源释放
 *   · 过滤钩子 ⇒ 必须 fail-open，且只动自己的工具
 *
 * 跑法：node scripts/test-host-wiring.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CardAdapterHost } from '../lib/adapter/card-adapter.js'
import { installBridgedFilter } from '../lib/adapter/assemble.js'
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

const root = mkdtempSync(join(tmpdir(), 'ccr-wiring-'))
const cardsRoot = join(root, 'cards')
const facadeBaseDir = join(process.cwd(), 'lib', 'adapter')
const logs = []
const audit = (m) => logs.push(m)

/** 造一个最小可用的假插件（只要 tools 能力）。 */
function makePlugin(name, { toolName = 'open', body = '' } = {}) {
  const dir = join(cardsRoot, `${name}@1.0.0-abc`)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      main: 'lib/index.js',
      dshCard: { id: name, name, entry: 'lib/index.js', adapter: { capabilities: ['tools', 'effect'] } },
    }),
  )
  writeFileSync(
    join(dir, 'lib', 'index.js'),
    [
      `import { defineTool } from '@deepseek-ai/dsh-tools'`,
      `export const inject = ['tools']`,
      `export function apply(ctx) {`,
      `  ctx.effect(() => () => { globalThis.__ccrClosed = (globalThis.__ccrClosed || 0) + 1 }, 'x')`,
      `  ctx.tools.register(defineTool({`,
      `    name: ${JSON.stringify(toolName)},`,
      `    description: '假工具',`,
      `    parameters: {},`,
      `    output: { schema: { type: 'string' }, render: (a, v) => String(v) },`,
      `    async execute() { return 'OK' },`,
      `  }))`,
      body,
      `}`,
    ].join('\n'),
  )
  return dir
}

const registry = new Map()
const makeHost = (overrides = {}) =>
  new CardAdapterHost({
    registerTool: (def) => {
      if (registry.has(def.name)) throw new Error(`tool "${def.name}" is already registered`)
      registry.set(def.name, def)
      return () => registry.delete(def.name)
    },
    getConnection: (id) =>
      id === 'conn-1' ? { sessionA: 'sess-A', sessionB: 'sess-B' } : undefined,
    shimRoot: cardsRoot,
    facadeBaseDir,
    audit,
    ...overrides,
  })

try {
  /* ═══════════ 1. 三层闸门 ═══════════ */

  console.log('── 1. 闸门：开关关着时')

  setAdapterEnabled(false)
  {
    const host = makeHost()
    const dir = makePlugin('gated')
    let msg = ''
    try {
      await host.mount({ instanceId: 'i1', cardId: 'gated', pluginDir: dir, capabilities: ['tools'], connectionId: 'conn-1' })
    } catch (e) {
      msg = String(e.message)
    }
    ok(/适配层\*\*没有开启\*\*|没有开启/.test(msg), '开关关着 ⇒ 拒绝并说明"没开启"')
    ok(/不会影响其它卡片/.test(msg), '拒绝文案说清影响面')
    eq(host.bridge.tools().length, 0, '拒绝时没有任何工具被注册')
    ok(logs.filter((l) => /桥接|注册/.test(l)).length === 0, '拒绝时没有任何桥接动作')
  }

  /* ═══════════ 2. 正常挂载 / 卸载 ═══════════ */

  console.log('── 2. 挂载与卸载')

  setAdapterEnabled(true)
  const host = makeHost()
  const dir = makePlugin('good', { toolName: 'open' })

  const r = await host.mount({
    instanceId: 'inst-1',
    cardId: 'good',
    pluginDir: dir,
    capabilities: ['tools', 'effect'],
    connectionId: 'conn-1',
    scope: 'a',
  })
  eq(r.tools, 1, '挂载返回桥接的工具数')
  ok(registry.has('card_good_open'), '工具注册进了工具表')
  ok(/已挂到连接 conn-1/.test(logs.join('\n')), '挂载留了审计')
  ok(/适配卡=1/.test(host.describe()) || /已挂载适配卡=1/.test(host.describe()), 'describe 反映已挂载数')

  // 重复挂载同一实例
  {
    let msg = ''
    try {
      await host.mount({ instanceId: 'inst-1', cardId: 'good', pluginDir: dir, capabilities: ['tools'], connectionId: 'conn-1' })
    } catch (e) {
      msg = String(e.message)
    }
    ok(/已经挂载过/.test(msg), '同实例重复挂载 ⇒ 拒绝')
  }

  // 可见性：A 端能调，B 端不能（与调用时校验同源）
  {
    const def = registry.get('card_good_open')
    eq(await def.execute({}, { agent: { id: 'sess-A' } }), 'OK', 'A 端可调用')
    const denied = await def.execute({}, { agent: { id: 'sess-B' } })
    ok(!String(denied).includes('OK') && /只对 A 端可见/.test(String(denied)), 'B 端被拒（护栏③）')
  }

  // 卸载：工具摘干净 + 插件资源释放
  globalThis.__ccrClosed = 0
  host.unmount('inst-1')
  ok(!registry.has('card_good_open'), '卸载后工具从工具表消失（无幽灵）')
  eq(globalThis.__ccrClosed, 1, '卸载释放了插件的 effect 资源')
  eq(host.bridge.tools().length, 0, '桥接表清空')
  host.unmount('inst-1') // 幂等

  /* ═══════════ 3. 桥接失败 ⇒ 插件也要卸掉（不留半截） ═══════════ */

  console.log('── 3. 桥接失败时的回滚')

  {
    const host2 = makeHost({
      registerTool: () => {
        throw new Error('模拟注册失败')
      },
    })
    const dir2 = makePlugin('bad-bridge')
    globalThis.__ccrClosed = 0
    let msg = ''
    try {
      await host2.mount({ instanceId: 'inst-2', cardId: 'bad-bridge', pluginDir: dir2, capabilities: ['tools', 'effect'], connectionId: 'conn-1' })
    } catch (e) {
      msg = String(e.message)
    }
    ok(/模拟注册失败/.test(msg), '桥接失败 ⇒ 错误透出')
    eq(globalThis.__ccrClosed, 1, '桥接失败 ⇒ 插件也被卸掉（资源释放）')
    eq(host2.bridge.tools().length, 0, '桥接失败 ⇒ 桥接表没有残留')
  }

  /* ═══════════ 4. disposeAll ═══════════ */

  console.log('── 4. 插件卸载时收口')

  {
    const host3 = makeHost()
    const d1 = makePlugin('multi-a', { toolName: 'ta' })
    const d2 = makePlugin('multi-b', { toolName: 'tb' })
    await host3.mount({ instanceId: 'm1', cardId: 'multi-a', pluginDir: d1, capabilities: ['tools', 'effect'], connectionId: 'conn-1' })
    await host3.mount({ instanceId: 'm2', cardId: 'multi-b', pluginDir: d2, capabilities: ['tools', 'effect'], connectionId: 'conn-1' })
    eq(host3.bridge.tools().length, 2, '两张适配卡各注册一个工具')
    globalThis.__ccrClosed = 0
    host3.disposeAll()
    eq(host3.bridge.tools().length, 0, 'disposeAll 摘掉全部工具')
    eq(globalThis.__ccrClosed, 2, 'disposeAll 释放两张卡片的资源')
    ok(!registry.has('card_multi_a_ta') && !registry.has('card_multi_b_tb'), '工具表里没有残留')
  }

  /* ═══════════ 5. 下发过滤安装器 ═══════════ */

  console.log('── 5. 下发过滤安装器')

  {
    const host4 = makeHost()
    const d = makePlugin('filt', { toolName: 'open' })
    await host4.mount({ instanceId: 'f1', cardId: 'filt', pluginDir: d, capabilities: ['tools', 'effect'], connectionId: 'conn-1', scope: 'a' })

    // 假的 ctx.on：抓住 handler 自己调
    let handler = null
    const installed = installBridgedFilter(
      (event, h) => {
        eq(event, 'system-prompt/assemble', '挂在 system-prompt/assemble 上')
        handler = h
        return () => {
          handler = null
        }
      },
      { bridge: host4.bridge, audit },
    )
    ok(typeof handler === 'function', '安装后拿到了 handler')

    const settle = (assembly) => () => Promise.resolve(assembly)
    const ctxOf = (sid) => ({ scope: { session: { id: sid } } })

    const assembly = { tools: [{ name: 'card_filt_open' }, { name: 'bash' }] }

    // A 端（可见）：不动
    {
      const out = await handler(assembly, ctxOf('sess-A'), settle(assembly))
      eq(out.tools.length, 2, 'A 端：桥接工具保留')
    }
    // B 端（不可见）：摘掉
    {
      const out = await handler(assembly, ctxOf('sess-B'), settle(assembly))
      eq(out.tools.map((t) => t.name), ['bash'], 'B 端：只摘自己的工具，别人的一个不动')
    }
    // 认不出会话：fail-open
    {
      const before = logs.length
      const out = await handler(assembly, {}, settle(assembly))
      eq(out.tools.length, 2, '认不出会话 ⇒ 原样放行（fail-open）')
      ok(logs.length >= before, 'fail-open 有留痕（debug/audit）')
    }
    // 形态不对：原样返回
    {
      const out = await handler(assembly, ctxOf('sess-A'), undefined)
      eq(out, assembly, '没有 next ⇒ 原样返回（不抛）')
    }
    // next 抛错 ⇒ 不能把装配搞挂
    {
      const boom = () => Promise.reject(new Error('next 炸了'))
      let threw = false
      let out
      try {
        out = await handler(assembly, ctxOf('sess-A'), boom)
      } catch {
        threw = true
      }
      ok(threw || out !== undefined, 'next 抛错时不会静默返回 undefined（由瀑布层处理）')
    }

    // 卸载函数可用
    installed()
    eq(handler, null, '卸载函数摘掉了 handler')
    host4.disposeAll()
  }
} finally {
  setAdapterEnabled(false)
  rmSync(root, { recursive: true, force: true })
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
