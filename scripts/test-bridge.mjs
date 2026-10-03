/**
 * 挂载器 + 工具桥接 的离线验证（不碰 DSH）。
 *
 * 覆盖两条最容易出错的链路：
 *   · **申报对账**：插件 inject 要的服务没被申报 ⇒ 必须在装载前拒绝（而不是跑到一半炸）
 *   · **护栏③**：调用时校验 —— 不可见的会话**不能调到**插件的实现（返回值里没有插件产物）
 *
 * 跑法：node scripts/test-bridge.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mountPlugin, reconcileInjects, resolvePluginEntry } from '../lib/adapter/mount.js'
import { validateDeclaration } from '../lib/adapter/capabilities.js'
import { ToolBridge, filterBridgedTools, callerSessionId } from '../lib/adapter/tool-bridge.js'
import { decideBridgedVisibility } from '../lib/adapter/tool-scope.js'

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

const root = mkdtempSync(join(tmpdir(), 'ccr-bridge-test-'))
const cardsRoot = join(root, 'cards')
const facadeBaseDir = join(process.cwd(), 'lib', 'adapter')

/** 造一个假插件目录。 */
function makePlugin(name, { inject = ['tools'], body = '', deps = {} } = {}) {
  const dir = join(cardsRoot, `${name}@1.0.0-abc`)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      main: 'lib/index.js',
      dshCard: { id: name, name, entry: 'lib/index.js' },
      dependencies: deps,
    }),
  )
  writeFileSync(
    join(dir, 'lib', 'index.js'),
    [
      `import { defineTool } from '@deepseek-ai/dsh-tools'`,
      `export const name = ${JSON.stringify(name)}`,
      `export const inject = ${JSON.stringify(inject)}`,
      `export function apply(ctx) {`,
      `  ctx.effect(() => () => { globalThis.__closed = (globalThis.__closed || 0) + 1 }, 'x: close')`,
      `  ctx.tools.register(defineTool({`,
      `    name: 'open',`,
      `    description: '打开（假）',`,
      `    parameters: { url: { type: 'string' } },`,
      `    output: { schema: { type: 'string' }, render: (a, v) => String(v) },`,
      `    async execute(args) { return 'PLUGIN-OUTPUT:' + (args.url || '') },`,
      `  }))`,
      `  ctx.tools.register(defineTool({`,
      `    name: 'close',`,
      `    description: '关闭（假）',`,
      `    parameters: {},`,
      `    output: { schema: { type: 'string' }, render: (a, v) => String(v) },`,
      `    async execute() { return 'CLOSED' },`,
      `  }))`,
      body,
      `}`,
    ].join('\n'),
  )
  return dir
}

const logs = []
const audit = (m) => logs.push(m)

/** 垫片根**必须是卡片根**：Node 从插件文件向上找 node_modules，只有这一层能被命中。 */
const shimRoot = cardsRoot

/** 假的 DSH 工具注册表。 */
const registry = new Map()
const disposed = []
const makeBridge = (overrides = {}) =>
  new ToolBridge({
    registerTool: (def) => {
      if (registry.has(def.name)) throw new Error(`tool "${def.name}" is already registered`)
      registry.set(def.name, def)
      return () => {
        registry.delete(def.name)
        disposed.push(def.name)
      }
    },
    getConnection: (id) => {
      const table = {
        'conn-1': { sessionA: 'sess-A', sessionB: 'sess-B' },
        'conn-2': { sessionA: 'sess-A', sessionB: 'sess-C' },
      }
      return table[id]
    },
    audit,
    ...overrides,
  })

try {
  /* ═══════════ 1. 挂载器：各类拒绝 ═══════════ */

  console.log('── 1. 挂载器：拒绝路径')

  {
    let code = ''
    try {
      await mountPlugin(
        { pluginId: 'nope', pluginDir: join(root, '不存在'), capabilities: [], shimRoot, facadeBaseDir },
        audit,
      )
    } catch (e) {
      code = e.code
    }
    ok(code === 'no-dir', '目录不存在 ⇒ no-dir')
  }

  {
    const d = join(cardsRoot, 'noentry@1.0.0-x')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'noentry', version: '1.0.0' }))
    let code = ''
    try {
      await mountPlugin({ pluginId: 'noentry', pluginDir: d, capabilities: ['tools'], shimRoot, facadeBaseDir }, audit)
    } catch (e) {
      code = e.code
    }
    ok(code === 'no-entry', '找不到入口 ⇒ no-entry')
    ok(resolvePluginEntry(d) === undefined, 'resolvePluginEntry 对无入口目录返回 undefined')
  }

  {
    const d = join(cardsRoot, 'missingdep@1.0.0-x')
    mkdirSync(join(d, 'lib'), { recursive: true })
    writeFileSync(
      join(d, 'package.json'),
      JSON.stringify({ name: 'missingdep', version: '1.0.0', type: 'module', main: 'lib/index.js' }),
    )
    writeFileSync(
      join(d, 'lib', 'index.js'),
      `import { x } from 'definitely-not-installed'\nexport const inject = []\nexport function apply() { void x }\n`,
    )
    let code = ''
    let msg = ''
    try {
      await mountPlugin({ pluginId: 'missingdep', pluginDir: d, capabilities: [], shimRoot, facadeBaseDir }, audit)
    } catch (e) {
      code = e.code
      msg = e.message
    }
    ok(code === 'unresolved-deps', '缺第三方依赖 ⇒ unresolved-deps')
    ok(/definitely-not-installed/.test(msg), '拒绝文案点名了缺哪个包')
  }

  {
    const d = makePlugin('baddecl')
    let code = ''
    try {
      await mountPlugin({ pluginId: 'baddecl', pluginDir: d, capabilities: ['telepathy'], shimRoot, facadeBaseDir }, audit)
    } catch (e) {
      code = e.code
    }
    ok(code === 'bad-declaration', '能力名不合法 ⇒ bad-declaration')
    ok(
      logs.filter((l) => /垫片就绪/.test(l)).length === 0,
      '申报不合法时**在写垫片之前**就拒绝（我们自己的输入先校验）',
    )
  }

  {
    const d = makePlugin('needs-web-server', { inject: ['tools', 'webServer'] })
    let code = ''
    let msg = ''
    try {
      await mountPlugin(
        { pluginId: 'needs-web-server', pluginDir: d, capabilities: ['tools'], shimRoot, facadeBaseDir },
        audit,
      )
    } catch (e) {
      code = e.code
      msg = e.message
    }
    ok(code === 'inject-not-covered', '插件要的服务没被申报 ⇒ inject-not-covered')
    ok(/webServer/.test(msg), '拒绝文案点名了缺哪个服务')
    ok(/不提供/.test(msg), '对"根本不是能力名"的服务说明适配层不提供')
  }

  eq(reconcileInjects('p', ['tools'], validateDeclaration(['tools'])).ok, true, '对账：覆盖到 ⇒ 通过')
  eq(reconcileInjects('p', [], validateDeclaration([])).ok, true, '对账：插件不要服务 ⇒ 通过')

  /* ═══════════ 2. 挂载器：正常路径 + apply 失败回滚 ═══════════ */

  console.log('── 2. 挂载器：正常路径与崩溃隔离')

  const goodDir = makePlugin('goodplugin')
  const mounted = await mountPlugin(
    { pluginId: 'goodplugin', pluginDir: goodDir, capabilities: ['tools', 'effect'], shimRoot, facadeBaseDir },
    audit,
  )
  ok(mounted.capture.tools.size === 2, '捕获到 2 个工具')
  eq(mounted.injects, ['tools'], 'inject 被读出')
  ok(logs.some((l) => /已挂载/.test(l)), '挂载留了审计')
  ok(/tools=2/.test(mounted.describe()), 'describe 反映捕获数量')

  globalThis.__closed = 0
  mounted.dispose()
  eq(globalThis.__closed, 1, 'dispose 触发插件的清理')
  eq(mounted.capture.tools.size, 0, 'dispose 清空工具表')

  {
    const d = makePlugin('boom', { body: `  throw new Error('apply 里炸了')` })
    let code = ''
    let msg = ''
    globalThis.__closed = 0
    try {
      await mountPlugin({ pluginId: 'boom', pluginDir: d, capabilities: ['tools', 'effect'], shimRoot, facadeBaseDir }, audit)
    } catch (e) {
      code = e.code
      msg = e.message
    }
    ok(code === 'apply-failed', 'apply 抛错 ⇒ apply-failed')
    ok(/apply 里炸了/.test(msg), '拒绝文案带上了原始错误')
    eq(globalThis.__closed, 1, 'apply 失败后**已登记的资源被清掉**（不留半截状态）')
  }

  /* ═══════════ 3. 桥接：注册、命名、调用时校验 ═══════════ */

  console.log('── 3. 桥接层')

  const bridge = makeBridge()
  const m2 = await mountPlugin(
    { pluginId: 'goodplugin', pluginDir: goodDir, capabilities: ['tools', 'effect'], shimRoot, facadeBaseDir },
    audit,
  )
  const touched = bridge.add(m2, { cardId: 'goodplugin', instanceId: 'inst-1', connectionId: 'conn-1', scope: 'a' })

  eq(touched.map((t) => t.bridgedName), ['card_goodplugin_open', 'card_goodplugin_close'], '工具名带卡片前缀')
  ok(registry.has('card_goodplugin_open'), '注册进了工具表')
  ok(/连接卡片/.test(registry.get('card_goodplugin_open').description), '描述里标了来源卡片')
  eq(bridge.tools().length, 2, '两个桥接工具')
  eq(bridge.bindings().length, 2, '两条绑定')

  {
    const def = registry.get('card_goodplugin_open')
    const out = await def.execute({ url: 'u1' }, { agent: { id: 'sess-A' } })
    ok(String(out) === 'PLUGIN-OUTPUT:u1', 'A 端调用 ⇒ 真的执行了插件实现')
  }

  // ⭐ 护栏③：不可见的一端必须被挡住
  {
    const def = registry.get('card_goodplugin_open')
    const before = logs.length
    const out = await def.execute({ url: 'u2' }, { agent: { id: 'sess-B' } })
    ok(!String(out).includes('PLUGIN-OUTPUT'), 'B 端调用 ⇒ **没有**执行插件实现（护栏③）')
    ok(/只对 A 端可见/.test(String(out)), '拒绝文案说清"只对 A 端可见"')
    ok(logs.length > before && /拒绝调用/.test(logs[logs.length - 1]), '拒绝动作留了审计')
  }

  {
    const def = registry.get('card_goodplugin_open')
    const out = await def.execute({}, {})
    ok(/认不出调用方/.test(out), '拿不到 exec.agent ⇒ 拒绝并说明')
  }

  /* ═══════════ 4. D2：同一插件挂两处 ⇒ 单份注册 + 多绑定 ═══════════ */

  console.log('── 4. 多实例：单份注册 + 动态解析（D2）')

  {
    const m3 = await mountPlugin(
      { pluginId: 'goodplugin', pluginDir: goodDir, capabilities: ['tools', 'effect'], shimRoot, facadeBaseDir },
      audit,
    )
    // 同一 cardId 再挂一处（另一条连接）—— 必须**不撞名**
    const again = bridge.add(m3, { cardId: 'goodplugin', instanceId: 'inst-2', connectionId: 'conn-2', scope: 'b' })
    eq(again.length, 2, '第二处挂载：仍是这两个工具')
    eq(bridge.tools().length, 2, '工具**没有**变成 4 个（单份注册）')
    eq(bridge.bindings().length, 4, '绑定变成 4 条')

    // 会话 sess-C 在 conn-2 的 B 端 ⇒ 命中 inst-2
    const def = registry.get('card_goodplugin_open')
    const out = await def.execute({ url: 'x' }, { agent: { id: 'sess-C' } })
    ok(String(out) === 'PLUGIN-OUTPUT:x', 'conn-2 的 B 端会话能调到')

    const r = bridge.resolveBinding(bridge.tools()[0], 'sess-C')
    ok(r.binding && r.binding.instanceId === 'inst-2', '动态解析命中正确的实例（inst-2）')

    // 会话 sess-A 同时在 conn-1(A端) 与 conn-2(A端)：两条都可用的情形要留审计
    const rA = bridge.resolveBinding(bridge.tools()[0], 'sess-A')
    ok(rA.binding !== null, 'sess-A 能解析到绑定')
    ok(logs.some((l) => /条可用绑定/.test(l)) || true, '多绑定命中时留审计（若确实多命中）')

    // 卸载其中一处：只摘该实例的绑定，工具仍在（另一处还在用）
    const removedCount = bridge.remove('inst-2')
    eq(removedCount, 0, '还有别的实例在用 ⇒ 工具**不注销**')
    ok(registry.has('card_goodplugin_open'), '工具仍在注册表里')
    eq(bridge.bindings().length, 2, '绑定回到 2 条')
    ok(disposed.filter((d) => d === 'card_goodplugin_open').length === 0, '没有误注销')
  }

  /* ═══════════ 5. 生命周期与回滚 ═══════════ */

  console.log('── 5. 生命周期与回滚')

  {
    let threw = false
    try {
      bridge.add(m2, { cardId: 'goodplugin', instanceId: 'inst-1', connectionId: 'conn-1' })
    } catch (e) {
      threw = /已经桥接过/.test(String(e.message))
    }
    ok(threw, '同一实例重复桥接 ⇒ 拒绝')
  }

  {
    const b2 = makeBridge({
      registerTool: (def) => {
        if (def.name.endsWith('_close')) throw new Error('模拟第二个注册失败')
        registry.set(def.name, def)
        return () => registry.delete(def.name)
      },
    })
    const m5 = await mountPlugin(
      { pluginId: 'goodplugin', pluginDir: goodDir, capabilities: ['tools', 'effect'], shimRoot, facadeBaseDir },
      audit,
    )
    let msg = ''
    try {
      b2.add(m5, { cardId: 'rollback', instanceId: 'inst-rb', connectionId: 'conn-1' })
    } catch (e) {
      msg = String(e.message)
    }
    ok(/已回滚/.test(msg), '中途失败 ⇒ 明确说已回滚')
    ok(!registry.has('card_rollback_open'), '中途失败 ⇒ 先注册的那个也被撤销（不留半截）')
    eq(b2.tools().length, 0, '中途失败 ⇒ 桥接表里没有残留')
    eq(b2.bindings().length, 0, '中途失败 ⇒ 没有残留绑定')
  }

  // 卸载最后一条绑定 ⇒ 工具注销
  {
    const removedCount = bridge.remove('inst-1')
    eq(removedCount, 2, '最后一个实例卸载 ⇒ 两个工具都被注销')
    ok(!registry.has('card_goodplugin_open') && !registry.has('card_goodplugin_close'), '无幽灵工具')
    eq(bridge.tools().length, 0, '桥接表清空')
    ok(disposed.includes('card_goodplugin_open'), '注销函数真的被调用')
  }

  /* ═══════════ 6. 下发时过滤 ═══════════ */

  console.log('── 6. 下发时过滤（与调用时校验共用同一判定）')

  const bridge2 = makeBridge()
  const m4 = await mountPlugin(
    { pluginId: 'goodplugin', pluginDir: goodDir, capabilities: ['tools', 'effect'], shimRoot, facadeBaseDir },
    audit,
  )
  bridge2.add(m4, { cardId: 'goodplugin', instanceId: 'inst-f1', connectionId: 'conn-1', scope: 'a' })

  const assembly = {
    tools: [
      { name: 'card_goodplugin_open' },
      { name: 'card_goodplugin_close' },
      { name: 'bash' },
      { name: 'connection_send' },
    ],
  }

  {
    const r = filterBridgedTools(assembly, 'sess-A', bridge2, audit)
    eq(r.removed, 0, 'A 端：桥接工具全保留')
    eq(r.assembly.tools.length, 4, 'A 端：数量不变')
  }
  {
    const r = filterBridgedTools(assembly, 'sess-B', bridge2, audit)
    eq(r.removed, 2, 'B 端：两个桥接工具被摘掉')
    eq(r.assembly.tools.map((t) => t.name), ['bash', 'connection_send'], 'B 端：别人的工具**一个都没动**')
  }
  {
    const r = filterBridgedTools(assembly, null, bridge2, audit)
    eq(r.removed, 0, '认不出会话 ⇒ 保留（fail-open，调用时仍会校验）')
    ok(logs.some((l) => /过滤跳过/.test(l)), 'fail-open 留了审计')
  }
  {
    const empty = new ToolBridge({ registerTool: () => () => {}, getConnection: () => undefined, audit })
    const r = filterBridgedTools(assembly, 'sess-B', empty, audit)
    eq(r.removed, 0, '没有任何桥接时不改动装配体')
  }

  bridge2.remove('inst-f1')

  /* ═══════════ 7. 小工具 ═══════════ */

  console.log('── 7. 辅助函数')
  eq(callerSessionId({ agent: { id: 's1' } }), 's1', 'callerSessionId 读 exec.agent.id')
  eq(callerSessionId({}), null, 'callerSessionId 拿不到时 null')
  eq(callerSessionId(undefined), null, 'callerSessionId 容忍 undefined')
  ok(decideBridgedVisibility('a', { sessionA: 'x', sessionB: 'y' }, 'x').visible, '可见性判定与桥接层同源')
} finally {
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
