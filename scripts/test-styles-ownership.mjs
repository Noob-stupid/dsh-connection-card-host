/**
 * 样式表**归属**契约测试 —— 钉住「面板突然变成裸 HTML」那个缺陷的根因。
 *
 * 根因（框架契约，见 @deepseek-ai/dsh-client-modules 的 system.ts 与
 * @deepseek-ai/dsh-client-hmr 的 client/index.ts）：
 *   · 物化插件时 `claimStyles(id)` 把 `style:not([data-plugin])` **全部**认领给
 *     当时正在物化的那个插件；
 *   · HMR 重载插件时 `removeOwnedStyles(id)` 只删 `data-plugin === id` 的标签。
 * 所以「注入的样式表没打归属」= 它会在**别的插件物化时**被认领走；那个插件一
 * 热重载，框架就把我们的样式表当成它自己的删掉，而我们的客户端半区并没有重载
 * ⇒ 没人重新注入 ⇒ 面板裸奔（现场：字号回到浏览器默认、按钮回到原生盒子）。
 *
 * 本测试用**最小 DOM 替身**（不装 jsdom：本仓库的测试一律零依赖、零网络）验证：
 *   ① 归属值 == 客户端模块图 id（并与 client bundle 的 banner id、
 *      cordis.patch.yml 的 entry name 三处一致 —— 漂移就等于归属到不存在的插件）
 *   ② 幂等：重复调用只留一个标签
 *   ③ 自愈：标签被外部删除 / 内容被改写 / 归属被抢走 / 身份丢失 ⇒ 下一次调用即纠正
 *   ④ 注销**只删本代自己创建的**标签：别的插件的样式表、旧代留下的样式表都不碰
 *
 * 跑法：node scripts/test-styles-ownership.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONNECTION_CARD_CSS, ensureStyles, injectStyles } from '../lib/styles/tokens.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 与被测代码共用的常量（写死在这里是故意的：改错了要红）。 */
const STYLE_ELEMENT_ID = 'dsh-connection-card-host-styles'
const STYLE_IDENTITY_SUFFIX = '/styles/tokens.ts'

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

/**
 * 最小 DOM 替身：只实现被测代码真正用到的那几个成员
 * （`getElementById` / `createElement` / `head.appendChild` /
 *   `get-setAttribute` / `removeAttribute` / `textContent` / `id` / `remove`）。
 */
function createDomShim() {
  const head = []

  const makeElement = (tagName) => {
    const attrs = new Map()
    const el = {
      tagName: String(tagName).toUpperCase(),
      textContent: '',
      parentNode: null,
      get id() {
        return attrs.get('id') ?? ''
      },
      set id(value) {
        attrs.set('id', String(value))
      },
      setAttribute: (name, value) => {
        attrs.set(name, String(value))
      },
      getAttribute: (name) => attrs.get(name) ?? null,
      removeAttribute: (name) => {
        attrs.delete(name)
      },
      remove: () => {
        const i = head.indexOf(el)
        if (i >= 0) head.splice(i, 1)
      },
    }
    return el
  }

  const documentShim = {
    head: {
      appendChild: (el) => {
        el.parentNode = documentShim.head
        head.push(el)
        return el
      },
    },
    createElement: makeElement,
    getElementById: (id) => head.find((el) => el.getAttribute('id') === id) ?? null,
  }

  return { documentShim, head, makeElement }
}

/* ═══════════ 0. 非浏览器环境：静默空操作 ═══════════ */

console.log('── 0. 非浏览器环境：不抛、注销函数仍然可调')
ok(typeof globalThis.document === 'undefined', '起点：Node 里没有 document')
let thrown = null
try {
  ensureStyles()
  const noop = injectStyles()
  ok(typeof noop === 'function', 'injectStyles() 在没有 document 时仍返回注销函数')
  noop()
} catch (e) {
  thrown = e
}
ok(thrown === null, `没有 document 时不抛（实得：${thrown === null ? '无' : thrown.message}）`)

/* ═══════════ 1. 归属值三处一致 ═══════════ */

console.log('── 1. 归属值 == 客户端模块图 id（bundle banner / cordis.patch.yml）')
const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const bannerMatch = /__ModuleLoader__\.load\(\{\s*id:\s*["']([^"']+)["']/u.exec(bundle)
const bannerId = bannerMatch === null ? null : bannerMatch[1]
ok(bannerId !== null, '从 lib/client.js 的 banner 里读到客户端模块图 id')

const patchText = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
const nameMatch = /^\s*name:\s*(.+)$/mu.exec(patchText)
const entryName = nameMatch === null ? null : nameMatch[1].trim().replace(/^['"]|['"]$/gu, '')
eq(entryName, bannerId, 'cordis.patch.yml 的 entry name == client bundle 的 id')
ok(
  /^\s*-\s*id:\s*connection-card-host\s*$/mu.test(patchText),
  'cordis.patch.yml 的 entry id 仍是 connection-card-host（这一行永远不要改）',
)
ok(
  bundle.includes('data-plugin-css'),
  'lib/client.js 里确实有归属写入 —— 防「改了 src 没重建」（lib/ 是随仓库提交的构建产物）',
)

/* ═══════════ 2. 首次注入：归属 + 身份 + 内容 ═══════════ */

console.log('── 2. 首次注入：标签打上归属')
const { documentShim, head, makeElement } = createDomShim()
globalThis.document = documentShim

const disposeA = injectStyles()
eq(head.length, 1, '注入后 head 里恰好一个样式标签')
const tagA = head[0]
eq(tagA.getAttribute('id'), STYLE_ELEMENT_ID, '标签 id 保持稳定（面板的布局探针按它判断样式是否在位）')
eq(tagA.getAttribute('data-plugin'), bannerId, '归属 data-plugin == 客户端模块图 id —— 框架据此认领/删除')
eq(
  tagA.getAttribute('data-plugin-css'),
  `${bannerId}${STYLE_IDENTITY_SUFFIX}`,
  '身份 data-plugin-css 沿用官方注入器约定（<插件 id>/<文件>）',
)
eq(tagA.textContent, CONNECTION_CARD_CSS, '标签内容就是本 bundle 的 CSS')

/* ═══════════ 3. 幂等 ═══════════ */

console.log('── 3. 幂等：重复调用只留一个标签')
ensureStyles()
ensureStyles()
eq(head.length, 1, 'ensureStyles() 可重入（apply 与面板挂载都会调它）')

/* ═══════════ 4. 自愈 ═══════════ */

console.log('── 4. 自愈：被删 / 被改写 / 被抢走归属 ⇒ 下一次调用即纠正')
tagA.remove()
eq(head.length, 0, '模拟样式表被框架 HMR（removeOwnedStyles）或外部脚本删掉')
ensureStyles()
eq(head.length, 1, '下一次 ensureStyles() 把标签重建回来')
const tagB = head[0]
ok(tagB !== tagA, '重建的是新标签（旧的那个已经不在文档里）')
eq(tagB.getAttribute('data-plugin'), bannerId, '重建的标签仍然带归属')

tagB.textContent = '/* 被截断的样式 */'
ensureStyles()
eq(tagB.textContent, CONNECTION_CARD_CSS, '内容被改写 ⇒ 就地更新回本 bundle 的 CSS')

tagB.setAttribute('data-plugin', 'some-other-plugin')
ensureStyles()
eq(tagB.getAttribute('data-plugin'), bannerId, '归属被别的插件抢走 ⇒ 就地纠正回来')

tagB.removeAttribute('data-plugin-css')
ensureStyles()
eq(tagB.getAttribute('data-plugin-css'), `${bannerId}${STYLE_IDENTITY_SUFFIX}`, '身份属性丢失 ⇒ 就地补回')

/* ═══════════ 5. 注销只删本代创建的标签 ═══════════ */

console.log('── 5. 注销只删本代创建的标签（别人的、旧代的都不碰）')
const foreign = makeElement('style')
foreign.id = 'some-other-plugin-styles'
foreign.setAttribute('data-plugin', 'some-other-plugin')
foreign.textContent = '/* 别的插件的样式表 */'
documentShim.head.appendChild(foreign)

disposeA()
eq(head.length, 1, '注销移除了本代创建的标签')
ok(head[0] === foreign, '别的插件的样式表原样保留（绝不误删）')

// 旧代残留：没有归属、内容是我们的 CSS（修复前的老版本留下的正是这个样子）
const legacy = makeElement('style')
legacy.id = STYLE_ELEMENT_ID
legacy.textContent = CONNECTION_CARD_CSS
documentShim.head.appendChild(legacy)

const disposeB = injectStyles()
eq(head.length, 2, '接管旧代残留时不再新建第二个标签')
eq(legacy.getAttribute('data-plugin'), bannerId, '接管的旧代标签被补上归属（否则它又会被别的插件认领走）')
eq(legacy.textContent, CONNECTION_CARD_CSS, '接管时内容不动（本来就是本 bundle 的 CSS）')

disposeB()
eq(head.length, 2, '注销**不删**旧代留下的标签 —— 它不是本代创建的（这条正是旧守卫要保护的性质）')
ok(head.includes(legacy), '旧代标签仍在文档里')
ok(head.includes(foreign), '别的插件的标签仍在文档里')

/* ═══════════ 收尾 ═══════════ */

delete globalThis.document
ok(typeof globalThis.document === 'undefined', '收尾：还原全局，不污染后续检查')

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
