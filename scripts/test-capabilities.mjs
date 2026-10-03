/**
 * `llm` 与 `prompt` 两个能力的离线验证。
 *
 * 用户裁决（D1/D7）：
 *   · `llm` = **卡片自己调模型**（自己挑 provider/model）；**改会话模型/路由那类不做**
 *   · `prompt` = 卡片往**它那条连接的那一端**的会话提示词里加内容
 *
 * 钉住的关键行为：
 *   · `prompt` 段在**装配时**按会话判定（不是注册时）—— 会话活生生死，装配每次都发生
 *   · `interpolate: false` —— 卡片文字里的 {{...}} 不该被当变量引用（未注册的引用会抛错）
 *   · `llm.chat` 的 provider/model **必须显式**；有**费用预算**；失败不抛异常而是返回码
 *
 * 跑法：node scripts/test-capabilities.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateDeclaration, IMPLEMENTED_CAPABILITIES, PLANNED_CAPABILITIES } from '../lib/adapter/capabilities.js'
import { createShadowCtx } from '../lib/adapter/shadow-ctx.js'
import { PromptInjector, DEFAULT_PROMPT_ORDER, sessionIdOfAssemblyContext } from '../lib/adapter/prompt-inject.js'
import { CardLlm, DEFAULT_LLM_BUDGET } from '../lib/adapter/llm-facade.js'
import { mountPlugin } from '../lib/adapter/mount.js'

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

const logs = []
const audit = (m) => logs.push(m)

console.log('── 1. 能力清单：llm/prompt 已实现，events/agent 未实现')

ok(IMPLEMENTED_CAPABILITIES.includes('llm') && IMPLEMENTED_CAPABILITIES.includes('prompt'), 'llm 与 prompt 在已实现清单里')
ok(PLANNED_CAPABILITIES.includes('events') && PLANNED_CAPABILITIES.includes('agent'), 'events / agent 仍是"未实现"（不在路线图上）')

/* ═══════════ 2. 影子 ctx：prompt 段被捕获 ═══════════ */

console.log('── 2. 影子 ctx 的 prompt 段')

{
  const shadow = createShadowCtx({
    pluginId: 'p1',
    declaration: validateDeclaration(['prompt']),
    audit,
  })
  shadow.ctx.prompt.section({ name: 'blender', text: '本会话可做 Blender 建模。' })
  shadow.ctx.prompt.section({ text: '第二段', order: 42 })
  eq(shadow.capture.prompts.length, 2, '两段都被捕获')
  eq(shadow.capture.prompts[0].name, 'blender', '段名保留')
  eq(shadow.capture.prompts[1].order, 42, 'order 保留')

  let threw = false
  try {
    shadow.ctx.prompt.section({ text: '' })
  } catch {
    threw = true
  }
  ok(threw, '空 text 抛错（空段没有意义，早说比晚说好）')

  threw = false
  try {
    shadow.ctx.prompt.section({})
  } catch {
    threw = true
  }
  ok(threw, '缺 text 抛错')

  // 未申报 prompt ⇒ 访问即拒
  const noDecl = createShadowCtx({ pluginId: 'p2', declaration: validateDeclaration(['tools']), audit })
  let msg = ''
  try {
    noDecl.ctx.prompt
  } catch (e) {
    msg = String(e.message)
  }
  ok(/未申报/.test(msg), '未申报 prompt ⇒ 拒绝并说明未申报')
}

/* ═══════════ 3. 提示词注入：装配时判定可见性 ═══════════ */

console.log('── 3. 提示词注入（装配时判定）')

{
  const registered = new Map()
  const injector = new PromptInjector({
    registerSection: (section) => {
      registered.set(section.name, section)
      return () => registered.delete(section.name)
    },
    getConnection: (id) => (id === 'conn-1' ? { sessionA: 'sess-A', sessionB: 'sess-B' } : undefined),
    audit,
  })

  const n = injector.register(
    { instanceId: 'i1', cardId: 'blender-card', connectionId: 'conn-1', scope: 'a' },
    [{ name: 'spec', text: '建模约定：先量尺寸。' }],
  )
  eq(n, 1, '注册一段')
  eq(registered.size, 1, '宿主侧收到注册')

  const section = [...registered.values()][0]
  ok(section.name.startsWith('card:blender-card'), '段名带卡片前缀（不同卡片互不覆盖）')
  eq(section.interpolate, false, '**关掉插值**（卡片文字里的 {{...}} 不该被当变量）')
  eq(section.order, DEFAULT_PROMPT_ORDER, '默认排序位在宿主内容之后')

  // 装配时：A 端拿得到，B 端拿不到
  const ctxA = { scope: { session: { id: 'sess-A' } } }
  const ctxB = { scope: { session: { id: 'sess-B' } } }
  const ctxOther = { scope: { session: { id: 'sess-X' } } }
  eq(section.text(ctxA), '建模约定：先量尺寸。', 'A 端（可见）⇒ 返回文字')
  eq(section.text(ctxB), '', 'B 端（不可见）⇒ 返回空串（空段会被丢掉）')
  eq(section.text(ctxOther), '', '不在连接里的会话 ⇒ 空串')
  eq(section.text({}), '', '认不出会话 ⇒ 空串（**不 fail-open**：提示词宁可少给）')

  ok(sessionIdOfAssemblyContext({ agent: { id: 'sess-A' } }) === 'sess-A', '兜底：context.agent.id 也认')

  // 撤销
  eq(injector.unregister('i1'), 1, '撤销返回段数')
  eq(registered.size, 0, '宿主侧也撤掉了')
  eq(injector.size(), 0, '注入器清空')
}

/* ═══════════ 4. llm 门面 ═══════════ */

console.log('── 4. llm 门面（卡片自己调模型）')

/** 造一个假的 llm 流。 */
function fakeStream(chunks) {
  return () => ({
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  })
}

{
  const calls = []
  const llm = new CardLlm('blender-card', {
    stream: (options) => {
      calls.push(options)
      return fakeStream([
        { type: 'text-delta', text: '你好' },
        { type: 'text-delta', text: '，世界' },
        { usage: { input: 10, output: 4 } },
        { kind: 'finish' },
      ])()
    },
    listProviders: () => ['deepseek-official'],
    audit,
  })

  eq(llm.providers(), ['deepseek-official'], 'providers() 透传')
  const r = await llm.chat({ provider: 'deepseek-official', model: 'deepseek-v4-flash', prompt: '打个招呼' })
  ok(r.ok, 'chat 成功')
  eq(r.text, '你好，世界', '文本增量按序拼起来')
  eq(r.usage, { input: 10, output: 4 }, 'usage 带回来')
  ok(/模型调用/.test(logs.join('\n')) && /成功/.test(logs.join('\n')), '调用留了审计')

  const sent = calls[0]
  eq(sent.provider, 'deepseek-official', 'provider 原样传给宿主')
  eq(sent.model, 'deepseek-v4-flash', 'model 原样传给宿主（**必须显式**）')
  eq(sent.messages.length, 1, '没有 system 时只有一条 user 消息')
  ok(sent.messages[0].content[0].text === '打个招呼', '用户输入进了消息体')

  // system 会生成 system 消息
  await llm.chat({ provider: 'p', model: 'm', system: '你是校对员', prompt: 'x' })
  eq(calls[1].messages.length, 2, '有 system 时是两条消息')
  eq(calls[1].messages[0].role, 'system', '第一条是 system')

  // 缺参数 ⇒ 明确拒绝（不是抛异常）
  const bad = await llm.chat({ provider: '', model: '', prompt: '' })
  ok(!bad.ok && bad.failure.code === 'BAD_ARGS', '缺 provider/model ⇒ BAD_ARGS')
  ok(/必须显式给/.test(bad.failure.message), '拒绝理由说明"必须显式给"')
}

console.log('── 5. llm：失败与费用护栏')

{
  const llm = new CardLlm('failure-card', {
    stream: () => fakeStream([{ kind: 'error', failure: { code: 'RATE_LIMIT', message: '太快了' } }])(),
    listProviders: () => [],
    audit,
  })
  const r = await llm.chat({ provider: 'p', model: 'm', prompt: 'hi' })
  ok(!r.ok, '失败时 ok=false')
  eq(r.failure.code, 'RATE_LIMIT', '错误码按官方约定透出（**按 code 路由**，不按 message）')
}

{
  const llm = new CardLlm('throwing-card', {
    stream: () => ({
      // 迭代中途抛错
      async *[Symbol.asyncIterator]() {
        throw new Error('适配器炸了')
      },
    }),
    listProviders: () => [],
    audit,
  })
  const r = await llm.chat({ provider: 'p', model: 'm', prompt: 'hi' })
  ok(!r.ok && r.failure.code === 'STREAM_THREW', '流抛错 ⇒ 收敛成失败码（不让异常穿透到卡片）')
}

{
  const llm = new CardLlm('budget-card', {
    stream: () => fakeStream([{ kind: 'finish' }])(),
    listProviders: () => [],
    audit,
    budget: 2,
  })
  await llm.chat({ provider: 'p', model: 'm', prompt: '1' })
  await llm.chat({ provider: 'p', model: 'm', prompt: '2' })
  const third = await llm.chat({ provider: 'p', model: 'm', prompt: '3' })
  ok(!third.ok && third.failure.code === 'CARD_BUDGET_EXCEEDED', '超出预算 ⇒ 明确拒绝（费用护栏）')
  ok(/费用护栏/.test(third.failure.message), '拒绝理由说明是费用护栏')
  eq(llm.used(), 2, '超限的调用不计入')
  eq(DEFAULT_LLM_BUDGET, 100, '默认预算 100 次/挂载')
}

/* ═══════════ 6. 端到端：真实装载一个用 prompt+llm 的插件 ═══════════ */

console.log('── 6. 端到端：声明 prompt+llm 的插件能装上')

{
  const root = mkdtempSync(join(tmpdir(), 'ccr-cap-'))
  const cardsRoot = join(root, 'cards')
  const dir = join(cardsRoot, 'cap-plugin@1.0.0-x')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'cap-plugin',
      version: '1.0.0',
      type: 'module',
      main: 'lib/index.js',
      dsh: { bundle: {} },
    }),
  )
  writeFileSync(
    join(dir, 'lib', 'index.js'),
    [
      `import { defineTool } from '@deepseek-ai/dsh-tools'`,
      `export const inject = ['tools']`,
      `export function apply(ctx) {`,
      `  ctx.prompt.section({ name: 'a', text: '来自插件的提示词' })`,
      `  ctx.tools.register(defineTool({`,
      `    name: 'peek',`,
      `    description: '看一眼',`,
      `    parameters: {},`,
      `    output: { schema: { type: 'string' }, render: (a, v) => String(v) },`,
      `    async execute() {`,
      `      const r = await ctx.llm.chat({ provider: 'fake', model: 'fake-model', prompt: '你好' })`,
      `      return r.ok ? '模型说：' + r.text : '模型调用失败：' + r.failure.code`,
      `    },`,
      `  }))`,
      `}`,
    ].join('\n'),
  )

  try {
    const mounted = await mountPlugin(
      {
        pluginId: 'cap-plugin',
        pluginDir: dir,
        capabilities: ['tools', 'effect', 'prompt', 'llm'],
        shimRoot: cardsRoot,
        facadeBaseDir: join(process.cwd(), 'lib', 'adapter'),
        services: {
          llm: new CardLlm('cap-plugin', {
            stream: () => fakeStream([{ type: 'text-delta', text: 'OK' }, { kind: 'finish' }])(),
            listProviders: () => ['fake'],
            audit,
          }),
        },
      },
      audit,
    )

    eq(mounted.capture.prompts.length, 1, '插件的提示词段被捕获')
    eq(mounted.capture.tools.size, 1, '插件的工具被捕获')

    // 插件内部真的调到了模型门面
    const out = await mounted.capture.tools.get('peek').execute({}, {})
    eq(out, '模型说：OK', '插件通过 ctx.llm.chat 拿到了模型输出')

    // 未申报 llm 时拿不到（申报制）
    const noLlm = await mountPlugin(
      {
        pluginId: 'cap-plugin',
        pluginDir: dir,
        capabilities: ['tools', 'effect', 'prompt'],
        shimRoot: cardsRoot,
        facadeBaseDir: join(process.cwd(), 'lib', 'adapter'),
      },
      audit,
    )
    let msg = ''
    try {
      await noLlm.capture.tools.get('peek').execute({}, {})
    } catch (e) {
      msg = String(e.message)
    }
    ok(/未申报/.test(msg), '未申报 llm ⇒ 访问即拒（宿主塞了服务也不算数）')
    noLlm.dispose()
    mounted.dispose()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
