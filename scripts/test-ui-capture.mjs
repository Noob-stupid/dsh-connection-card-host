/**
 * UI 捕获的离线验证。
 *
 * 捕获逻辑刻意写成**不依赖真实浏览器**（`target` 可注入）—— 于是它能在 Node 里被测：
 * 换掉 `__ModuleLoader__`、执行源码、拿 factory、给影子 ctx、收槽位注册。
 *
 * 钉住的关键行为：
 *   · 临时替换的 `__ModuleLoader__` **无论成败都要还原**（那是 DSH 加载器的命脉）
 *   · factory 用**我们自己的 require** 调（同一份 React）
 *   · 访问未提供的服务 ⇒ **明确失败 + 留警告**（不静默降级）
 *   · 插件 `inject` 里若有 slots/effect 之外的服务 ⇒ **装载前拒绝**
 *
 * 跑法：node scripts/test-ui-capture.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { captureFactory, instantiateCaptured, disposeCaptured } from '../lib/ui/capture-client.js'
import { readClientArtifact } from '../lib/card-host/client-artifact.js'

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

const warns = []
const onWarn = (m) => warns.push(m)

/* ═══════════ 1. captureFactory ═══════════ */

console.log('── 1. 捕获 factory（临时换 ModuleLoader）')

{
  const target = { __ModuleLoader__: { load: () => { throw new Error('不该走到真的加载器') } } }
  const source = `
    window.__ModuleLoader__.load({
      id: 'demo-plugin',
      factory(require) {
        const React = require('react')
        function Demo() { return React.createElement('div', null, 'hi') }
        return { inject: ['slots'], apply(ctx) { ctx.slots.register({ name: 'sidebar.panellist', id: 'demo' }, Demo) } }
      },
    })
  `
  const captured = captureFactory(source, target)
  eq(captured.id, 'demo-plugin', '抓到 id')
  ok(typeof captured.factory === 'function', '抓到 factory 函数')
  ok(typeof target.__ModuleLoader__.load === 'function', '执行完**还原**了原来的 __ModuleLoader__')
  ok(!('__ModuleLoader__' in {}) && target.__ModuleLoader__ !== undefined, '还原成的是原对象')
}

{
  // 源码抛错也必须还原
  const original = { load: () => {} }
  const target = { __ModuleLoader__: original }
  let threw = false
  try {
    captureFactory('throw new Error("源码里炸了")', target)
  } catch {
    threw = true
  }
  ok(threw, '源码抛错 ⇒ 抛出来')
  ok(target.__ModuleLoader__ === original, '源码抛错时**仍然还原**（否则 DSH 的加载器就没了）')
}

{
  const target = {}
  let msg = ''
  try {
    captureFactory('var x = 1', target)
  } catch (e) {
    msg = String(e.message)
  }
  ok(/没有调用 __ModuleLoader__\.load/.test(msg), '不是客户端制品 ⇒ 明确说清')
  ok(!('__ModuleLoader__' in target), '原先没有该全局 ⇒ 执行完也不留下它')
}

/* ═══════════ 2. instantiateCaptured ═══════════ */

console.log('── 2. 用影子 client ctx 实例化')

function makeCaptured(injectList = ['slots']) {
  return {
    id: 'demo',
    factory: (require) => {
      const React = require('react')
      return {
        inject: injectList,
        apply(ctx) {
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register({ name: 'sidebar.panellist', id: 'demo-widget' }, () => React.createElement('span')),
          )
          ctx.effect(() => () => {
            globalThis.__ccrUiClosed = (globalThis.__ccrUiClosed || 0) + 1
          }, 'demo effect')
        },
      }
    },
  }
}

const fakeReact = { createElement: (t, p, c) => ({ t, p, c }) }

{
  const shadow = instantiateCaptured(makeCaptured(), () => fakeReact, onWarn)
  eq(shadow.registrations.length, 1, '捕获到 1 条槽位注册')
  eq(shadow.registrations[0].slot, 'sidebar.panellist', '槽位名保留')
  eq(shadow.registrations[0].id, 'demo-widget', '注册 id 保留')
  ok(typeof shadow.registrations[0].component === 'function', '组件原样保留')
  /**
   * 两条清理是**正确的**：一条是 `inject` 采纳的 register disposer
   * （官方写法 `inject(name, () => register(...))` 就是这样），另一条是 `effect` 自己的。
   * 关键在于下面的"清理只执行一次"—— 那是真正要钉住的。
   */
  eq(shadow.disposers.length, 2, '两条清理（inject 采纳的 + effect 自己的）')

  globalThis.__ccrUiClosed = 0
  disposeCaptured(shadow)
  eq(globalThis.__ccrUiClosed, 1, 'disposeCaptured 执行了清理')
  eq(shadow.registrations.length, 0, '注册表清空')
}

{
  // 访问未提供的服务 ⇒ 明确失败 + 留警告
  const bad = {
    id: 'bad',
    factory: () => ({
      inject: ['slots'],
      apply(ctx) {
        void ctx.locale
      },
    }),
  }
  let msg = ''
  try {
    instantiateCaptured(bad, () => fakeReact, onWarn)
  } catch (e) {
    msg = String(e.message)
  }
  ok(/未提供的能力「locale」/.test(msg), '访问未提供的服务 ⇒ 抛错并点名')
  ok(/只提供 slots 与 effect/.test(msg), '错误里说明当前提供什么')
  ok(warns.some((w) => /locale/.test(w)), '同时留了警告（便于看清它想要什么）')
}

{
  /**
   * inject 里声明了 slots/effect 之外的服务 ⇒ **只告警，不拒绝**。
   *
   * ⚠️ 这条行为是**拿真插件实测后改的**：生态里的 UI 插件普遍声明一长串客户端服务
   * （locale / configForms / uiWorkspace …），而它们**未必每条路径都用到**。
   * 一律拒绝 = "因为声明太全而装不上"；放它跑、**真正访问**时再抛点名的错误，
   * 既不放宽边界也不误伤。所以这里断言的是"不抛 + 有告警"。
   */
  const warns2 = []
  const needy = {
    id: 'needy',
    factory: () => ({ inject: ['slots', 'store'], apply() {} }),
  }
  let threw = false
  try {
    instantiateCaptured(needy, () => fakeReact, (m) => warns2.push(m))
  } catch {
    threw = true
  }
  ok(!threw, '声明了未提供的服务 ⇒ **不拒绝**（只告警）')
  ok(
    warns2.some((w) => /声明了 \[store\]/.test(w)),
    '告警里点名它声明了什么（便于排查）',
  )
}

{
  // factory 不返回 apply
  let msg = ''
  try {
    instantiateCaptured({ id: 'x', factory: () => ({}) }, () => fakeReact, onWarn)
  } catch (e) {
    msg = String(e.message)
  }
  ok(/没有返回 \{ apply \}/.test(msg), 'factory 没返回 apply ⇒ 明确说清')

  // register 缺 name
  const noName = {
    id: 'y',
    factory: () => ({ inject: ['slots'], apply: (ctx) => ctx.slots.register({}, () => null) }),
  }
  let msg2 = ''
  try {
    instantiateCaptured(noName, () => fakeReact, onWarn)
  } catch (e) {
    msg2 = String(e.message)
  }
  ok(/缺少 name/.test(msg2), 'register 缺 name ⇒ 抛错')
}

/* ═══════════ 3. 宿主侧读客户端制品 ═══════════ */

console.log('── 3. 读客户端制品')

const root = mkdtempSync(join(tmpdir(), 'ccr-ui-'))
try {
  // ① 有 dsh.client + lib/client.js
  const a = join(root, 'with-client')
  mkdirSync(join(a, 'lib'), { recursive: true })
  writeFileSync(
    join(a, 'package.json'),
    JSON.stringify({ name: 'with-client', dsh: { client: { platform: 'web' } }, main: 'lib/index.js' }),
  )
  writeFileSync(join(a, 'lib', 'client.js'), 'window.__ModuleLoader__.load({ id: "with-client", factory: () => ({}) })\n')
  const ra = readClientArtifact(a)
  ok(ra.ok, '有 dsh.client + lib/client.js ⇒ 读到')
  eq(ra.entry, 'lib/client.js', '入口路径正确')
  ok(/__ModuleLoader__/.test(ra.source), '返回的是源码文本')

  // ② exports['./client'] 优先
  const b = join(root, 'with-exports')
  mkdirSync(join(b, 'dist'), { recursive: true })
  writeFileSync(
    join(b, 'package.json'),
    JSON.stringify({
      name: 'with-exports',
      exports: { './client': './dist/ui.mjs' },
      dsh: { client: { platform: 'web' } },
    }),
  )
  writeFileSync(join(b, 'dist', 'ui.mjs'), 'export const x = 1\n')
  const rb = readClientArtifact(b)
  ok(rb.ok && rb.entry === 'dist/ui.mjs', "exports['./client'] 优先于默认布局")

  // ③ 没有 UI（纯能力插件）
  const c = join(root, 'no-ui')
  mkdirSync(join(c, 'lib'), { recursive: true })
  writeFileSync(join(c, 'package.json'), JSON.stringify({ name: 'no-ui', main: 'lib/index.js' }))
  const rc = readClientArtifact(c)
  ok(!rc.ok && /没有客户端 UI/.test(rc.reason), '没有 UI ⇒ 说清是"没有 UI"而不是报错')
  ok(/纯能力型插件正常如此/.test(rc.reason), '文案说明这很正常')

  // ④ 声明了但没有文件 ⇒ 这是异常，要说清
  const d = join(root, 'declared-but-missing')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'x', dsh: { client: { platform: 'web' } } }))
  const rd = readClientArtifact(d)
  ok(!rd.ok && /声明了 dsh\.client，但找不到制品文件/.test(rd.reason), '声明了却没有文件 ⇒ 明确指出矛盾')

  // ⑤ 没有 package.json
  const e = join(root, 'empty')
  mkdirSync(e, { recursive: true })
  ok(!readClientArtifact(e).ok, '没有 package.json ⇒ 拒绝')
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
