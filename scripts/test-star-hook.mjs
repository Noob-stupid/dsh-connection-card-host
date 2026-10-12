/**
 * Star 钩子契约测试 —— 用户点名要的「面板**右下角**的星星钩子」。
 *
 * ## 用户原话
 *
 * > 「在面板右下角弄上之前提到的星星钩子｛感兴趣点 star 标签｝」
 *
 * ## 这条测试**真的渲染一次面板**（不是只读源码）
 *
 * 做法沿用本仓既有的**零依赖**手法（见 test-ui-capture.mjs）：
 *
 *   1. `captureFactory(lib/client.js)` —— 临时换掉 `__ModuleLoader__`、执行制品、
 *      拿到 `factory`、**立刻还原**（那条还原契约本身由 test-ui-capture 钉着）。
 *   2. 用**自己的影子 require** 调 factory：`react` / `react/jsx-runtime` 给一份
 *      最小替身（hooks 是直通的，不需要 jsdom、不装任何依赖）。
 *   3. 用**影子 client ctx** 调 `apply(ctx)`，把槽位注册**捕获**下来 ——
 *      取 `main` 槽位（key = connection-panel）那个组件工厂。
 *   4. **调它一次**（这就是"面板渲染后"），在返回的元素树里找那个 `<a>`。
 *
 * 于是断言落在**渲染结果**上，而不是"源码里有没有那段字"：
 *   · 右下角的那一行存在，且是 `.ccr-page` 的**最后一个子项**（贴底 ✓）
 *   · `href` 指向**本仓库**、`target=_blank`、`rel` 同时有 noreferrer/noopener ✓
 *   · 图标是**内联 SVG**（不是外链图片），全树**没有 img/link/script** ✗ 外链
 *   · 用到的 `ccr-star-*` 类**都在** CONNECTION_CARD_CSS 里 ✓（改了 src 没重建 lib 也会红）
 *   · 渲染完 + `ensureStyles()` 之后，head 里**仍然只有一个** style 标签 ✓
 *     （「不许再插第二个 style 标签」这条就是靠它钉住的）
 *
 * ## 能力边界（不粉饰）
 *
 * 它**不能**证明"在真实浏览器里看着就在右下角、窄宽度也不溢出" ✗ ——
 * 那要真机目视 ✓。它能证明的是：**元素结构与样式归属没被改坏**，
 * 以及"哪天有人把 href 改成别的仓 / 换成外链图片 / 又插一个 style 标签"会当场红 ✓。
 *
 * 跑法：node scripts/test-star-hook.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { captureFactory } from '../lib/ui/capture-client.js'
import { CONNECTION_CARD_CSS, ensureStyles } from '../lib/styles/tokens.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 这个钩子必须指向**本仓**（写死在这里是故意的：改成别的仓要红）。 */
const REPO_URL = 'https://github.com/Noob-stupid/dsh-connection-card-host'

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

/* ═══════════ 夹具 ①：最小 DOM 替身（与 test-styles-ownership 同形） ═══════════ */

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
  return { documentShim, head }
}

/* ═══════════ 夹具 ②：最小 React 替身（不装 jsdom / 不引任何依赖） ═══════════ */

/**
 * 元素就是**普通对象** `{ type, props }`。
 *
 * hooks 一律"直通"：`useState` 返回初值、`useMemo`/`useCallback` 立即求值、
 * effect 类**不执行**（我们只关心**渲染出来的树**，不跑副作用）。
 */
function createFakeReact() {
  const el = (type, props) => ({ type, props: props ?? {} })
  const noop = () => {}
  const Fragment = Symbol('react.fragment')
  /**
   * 制品里有一个**错误边界**（class extends react.Component）。
   * 它只是被**定义**，本测试的渲染路径不会走到它 —— 所以给一个够用的基类即可。
   */
  class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }
    setState() {}
    render() {
      return null
    }
  }
  const react = {
    Fragment,
    Component,
    PureComponent: Component,
    createRef: () => ({ current: null }),
    createElement: (type, props, ...children) =>
      el(type, { ...(props ?? {}), children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children }),
    useState: (init) => [typeof init === 'function' ? init() : init, noop],
    useRef: (init) => ({ current: init }),
    useEffect: noop,
    useLayoutEffect: noop,
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useContext: () => undefined,
    useReducer: (_r, init) => [init, noop],
    memo: (c) => c,
    forwardRef: (c) => c,
  }
  const jsx = (type, props) => el(type, props)
  const jsxRuntime = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment }
  const requireShim = (spec) => {
    if (spec === 'react') return react
    if (spec === 'react/jsx-runtime') return jsxRuntime
    if (spec === 'react-dom') return { render: noop, createPortal: (c) => c }
    throw new Error(`测试夹具没有提供模块「${spec}」—— 请在这里补上替身`)
  }
  return { requireShim, Fragment }
}

/* ═══════════ 夹具 ③：元素树遍历（不带父指针 ⇒ 自己带） ═══════════ */

function walk(node, visit, parent = null) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent)
    return
  }
  if (typeof node !== 'object') return
  const element = node
  visit(element, parent)
  walk(element.props?.children, visit, element)
}

function findByType(tree, type) {
  const hits = []
  walk(tree, (el) => {
    if (el.type === type) hits.push(el)
  })
  return hits
}

function classNameOf(el) {
  const c = el?.props?.className
  return typeof c === 'string' ? c : ''
}

/* ═══════════ 准备环境：DOM 替身 + 捕获真实制品的 factory ═══════════ */

const { documentShim, head } = createDomShim()
globalThis.document = documentShim

const { requireShim } = createFakeReact()

const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const captured = captureFactory(bundle, globalThis)

console.log('── ⓪ 制品与捕获')
eq(captured.id, '@noob-stupid/dsh-connection-card-host', '客户端制品 id 就是包名')
ok(typeof captured.factory === 'function', '拿到 factory 函数')

/* ═══════════ 渲染：影子 ctx → 捕获 main 槽位 → 真渲染一次面板 ═══════════ */

console.log('── ① 用影子 client ctx 实例化，取 main 槽位（key=connection-panel）')

const registrations = []
const warns = []
const shadowCtx = {
  slots: {
    /** 官方语义：服务可用时立刻执行 cb。 */
    inject: (_name, cb) => void cb(),
    register: (spec, component) => {
      registrations.push({ spec, component })
      return () => {}
    },
  },
  effect: () => {},
  logger: { warn: (m) => warns.push(String(m)) },
  /** `ctx.get(name)` 契约：未知服务返回 undefined（见 capture-client.ts 的说明）。 */
  get: () => undefined,
}

const plugin = captured.factory(requireShim)
ok(typeof plugin?.apply === 'function', 'factory 返回 { apply }')
plugin.apply(shadowCtx)

const mainReg = registrations.find((r) => r.spec?.name === 'main' && r.spec?.key === 'connection-panel')
ok(mainReg !== undefined, '捕获到 main 槽位、key = connection-panel 的注册')
ok(
  registrations.every((r) => r.spec?.name !== undefined),
  '每条注册都带槽位名',
)

/*
 * ⚠️ 这一渲染**故意在"宿主通道未就绪"下做**（影子 ctx 没有 connection/sessions
 * ⇒ client 为 null）。Star 钩子**不该依赖连接数据** —— 它是"这个插件本身"的入口。
 * 反过来，若哪天有人把它塞进 `ready && …` 里，这条会立刻红。
 */
const tree = mainReg.component()

console.log('── ② 右下角那一行：存在，且是 .ccr-page 的最后一个子项')

const pageHits = []
walk(tree, (el) => {
  if (classNameOf(el).split(/\s+/u).includes('ccr-page')) pageHits.push(el)
})
eq(pageHits.length, 1, '渲染树里有唯一的 .ccr-page')
const pageChildren = [].concat(pageHits[0]?.props?.children ?? [])
const lastChild = pageChildren[pageChildren.length - 1]
ok(lastChild !== undefined, '.ccr-page 有子项')
ok(
  classNameOf(lastChild).split(/\s+/u).includes('ccr-star-foot'),
  '**最后一个**子项就是 .ccr-star-foot（"底部/右下角"= 排在正文最后一节之后 ✓）',
)

const footHits = findByType(tree, 'div').filter((el) =>
  classNameOf(el).split(/\s+/u).includes('ccr-star-foot'),
)
eq(footHits.length, 1, '整棵树里恰好一个 .ccr-star-foot')
const foot = footHits[0]

console.log('── ③ 链接：指向本仓 + 新标签 + rel 双保险')

const anchors = findByType(tree, 'a')
eq(anchors.length, 1, '渲染出的 <a> 恰好一个（就是 Star 钩子）')
const anchor = anchors[0]
eq(anchor.props?.href, REPO_URL, 'href 指向**本仓**（不是别的仓 / 不是外链图片）')
eq(anchor.props?.target, '_blank', '新标签页打开')
const rel = String(anchor.props?.rel ?? '')
ok(rel.split(/\s+/u).includes('noreferrer'), 'rel 含 noreferrer')
ok(rel.split(/\s+/u).includes('noopener'), 'rel 含 noopener（防 window.opener 反向控制）')
ok(
  typeof anchor.props?.title === 'string' && anchor.props.title.length > 0,
  '有 title（鼠标悬停能看出这个链接是干什么的）',
)
ok(
  anchor === foot?.props?.children || [].concat(foot?.props?.children ?? []).includes(anchor),
  '这个 <a> 就挂在 .ccr-star-foot 里面（不是飘在别处）',
)

console.log('── ④ 图标是**内联** SVG；全树没有 img / link / script（不外链）')

const anchorsSvg = findByType(anchor, 'svg')
eq(anchorsSvg.length, 1, '链接里有唯一的内联 <svg> 图标')
const svg = anchorsSvg[0]
eq(svg.props?.viewBox, '0 0 16 16', 'SVG 用 16×16 视图（GitHub mark 的正统几何）')
eq(svg.props?.fill, 'currentColor', 'fill=currentColor ⇒ 跟随文字颜色（两个主题都对）')
eq(svg.props?.['aria-hidden'], 'true', '图标 aria-hidden（读屏不念装饰图形）')
const paths = findByType(svg, 'path')
eq(paths.length, 1, 'SVG 里是一条 path（无外链、无字体图标）')
ok(
  typeof paths[0]?.props?.d === 'string' && paths[0].props.d.startsWith('M6.766'),
  'path 是 GitHub mark 的几何（M6.766 …）',
)
ok(
  !/<img|<script|<link|url\(https?:/iu.test(bundle),
  '客户端制品里没有外链图片/脚本/字体引用',
)
for (const tag of ['img', 'script', 'link']) {
  eq(findByType(tree, tag).length, 0, `渲染树里没有 <${tag}>`)
}

console.log('── ⑤ 文字是中文，且与参照处同一句')

const spans = findByType(anchor, 'span')
eq(spans.length, 1, '链接里是一个 <span> 文案')
const text = spans[0]?.props?.children
ok(typeof text === 'string' && /[\u4e00-\u9fff]/u.test(text), '文案是中文')
eq(text, '喜欢这个插件？去 GitHub 点个 Star', '文案与参照处（插件控制台）同一句')

console.log('── ⑥ 用到的 ccr-star-* 类都在 CONNECTION_CARD_CSS 里（防"改了 src 没重建 lib"）')

const classes = new Set()
for (const el of [foot, anchor, svg]) {
  for (const c of classNameOf(el).split(/\s+/u)) {
    if (c.startsWith('ccr-star')) classes.add(c)
  }
}
eq([...classes].sort(), ['ccr-star-foot', 'ccr-star-link'], '渲染用到的类就是这两个')
for (const c of classes) {
  ok(new RegExp(`\\.${c}\\s*\\{`, 'u').test(CONNECTION_CARD_CSS), `.${c} 在 CONNECTION_CARD_CSS 里有定义`)
}

const footRule = /\.ccr-star-foot\s*\{([^}]*)\}/u.exec(CONNECTION_CARD_CSS)?.[1] ?? ''
ok(/justify-content:\s*flex-end/u.test(footRule), '.ccr-star-foot **右对齐**（恰是"右下角"）')
ok(/position:\s*sticky/u.test(footRule), '.ccr-star-foot position:sticky')
ok(/bottom:\s*0/u.test(footRule), '.ccr-star-foot bottom:0 ⇒ 贴底（正文超长滚动时仍钉在下沿）')
ok(/display:\s*flex/u.test(footRule), '.ccr-star-foot 是整行 flex')
ok(/flex-wrap:\s*wrap/u.test(footRule), '.ccr-star-foot 允许换行 ⇒ **窄宽度不溢出**')
ok(!/\bwidth\s*:/u.test(footRule), '.ccr-star-foot 不写死宽度（不跟宿主抢布局）')

const linkRule = /\.ccr-star-link\s*\{([^}]*)\}/u.exec(CONNECTION_CARD_CSS)?.[1] ?? ''
ok(/max-width:\s*100%/u.test(linkRule), '.ccr-star-link max-width:100% ⇒ 再窄也是收缩/换行，不溢出')

console.log('── ⑦ 样式归属：只用一个 style 标签（不许再插第二个）')

eq(head.length, 1, 'apply() 之后 head 里恰好一个 style 标签')
eq(head[0].getAttribute('data-plugin'), captured.id, '标签归属 data-plugin == 客户端模块图 id')
ensureStyles()
ensureStyles()
eq(head.length, 1, '再调两次 ensureStyles() 仍然只有一个标签（可重入 ✓）')
ok(
  head[0].textContent.includes('.ccr-star-foot'),
  '这个标签里就有 Star 钩子的样式 ⇒ **没有第二个 style 标签**（这是用户点名的约束）',
)

/* ═══════════ 收尾：还原全局，不污染后续检查 ═══════════ */

delete globalThis.document
ok(typeof globalThis.document === 'undefined', '收尾：还原 document')

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  console.log('⚠️ 这条测的是**元素与样式契约**；"真机上就在右下角、窄宽度也不溢出"要目视验收')
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
