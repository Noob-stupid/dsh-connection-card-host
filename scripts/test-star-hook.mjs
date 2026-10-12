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
 * ## v1.0.75：用户实测把这处判成 ✗，这一节就是那次修复的**可失败**断言
 *
 * 用户原话（照截图）：
 *
 * > ① 「没有在右下角」—— 现在渲染成一条【横跨整列的深色宽带】，文案挤在带子右端
 * > ② 「怎么还有那个灰色颜色框」—— sticky 那行带了背景色块
 *
 * 病因（两处都在 CSS，不在 JSX）：
 *   · 行是 `display:flex` 的**块级**盒子 ⇒ 撑满 `.ccr-page` 整列宽 ✗
 *     （flex-end 只把**内容**推到右端，盒子本身还是满宽 ⇒ 看着就是"一条带子"）
 *   · `background: var(--dsw-alias-bg-layer-1)` + `box-shadow: 0 16px 0` 是
 *     **遮挡兜底**（配合 position:sticky）⇒ 深色主题下就是那块"灰色框" ✗
 *
 * 修法：**盒子收缩到内容宽**（inline-flex + fit-content）⇒ 才真的"靠右"；
 *   背景/阴影**全部删掉**（transparent）；`position:sticky` 一并去掉 ——
 *   不透明背景是 sticky 的**前提**，背景一去，sticky 就会让正文从这行里透出来
 *   （所谓"半透明遮挡"= 文字叠字 ✗），所以两者必须一起走 ✓。
 *
 * 这一节的断言**故意写成会失败的**：谁哪天把 `background` / `box-shadow` /
 * `border` 加回 `.ccr-star-*`，或者把盒子改成满宽（`width:100%`），当场 ❌ exit 1 ✓。
 * （做法沿用本仓既有的**变异验证**手法：见 scripts/test-styles-ownership.mjs
 *   与 drill-observe-failure.mjs —— 断言必须能在"改坏制品"时红。）
 *
 * ## 能力边界（不粉饰）
 *
 * 它**不能**证明"在真实浏览器里看着就在右下角、窄宽度也不溢出" ✗ ——
 * 那要真机目视 ✓。它能证明的是：**元素结构与样式归属没被改坏**，
 * 以及"哪天有人把 href 改成别的仓 / 换成外链图片 / 又插一个 style 标签 /
 * 给这一行加回背景色块或满宽"会当场红 ✓。
 *
 * ## 改动之后的收尾（本脚本**自己**还原，不靠调用方）
 *
 * ⑧ 保存源码与制品的**内容快照** → 对**制品**做一次原地注入的变异（加回
 * `background` / 改坏 `href`）→ 断言**必须**变红 → 用快照原样写回 ✓。
 * 跑完 `git status` 必须是干净的（下次可以从容地只信 exit code）。
 *
 * 跑法：node scripts/test-star-hook.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
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
const linkRule = /\.ccr-star-link\s*\{([^}]*)\}/u.exec(CONNECTION_CARD_CSS)?.[1] ?? ''

console.log('── ⑦ 位置：靠右、**小元素**（不是横跨整列的带子）')
/*
 * ⚠️ 「不写死宽度」这条要**只认 width**，不能让 max-width/min-width 顶包 ——
 * 本规则里 max-width:100% 是**故意留着**的（防溢出），它触发的收缩是好事。
 */
const hasWidthDecl = (rule) => /(?:^|[;{\s])width\s*:/iu.test(rule)
const hasFullWidth = (rule) => /(?:^|[;{\s])width\s*:\s*100%/iu.test(rule)
ok(/justify-content:\s*flex-end/u.test(footRule), '.ccr-star-foot 内容**右对齐**（恰是"右下角"）')
ok(/display:\s*inline-flex/u.test(footRule), '.ccr-star-foot 是 inline-flex ⇒ 盒子**收缩到内容宽**（不是整行块级盒子）')
ok(!hasFullWidth(footRule), '.ccr-star-foot **没有 width:100%**（一写就又变成横跨整列的带子 ✗）')
ok(!hasWidthDecl(footRule), '.ccr-star-foot 不写死任何 width（宽度自适应内容 ✓；max-width 不算 ✗）')
ok(/max-width:\s*100%/u.test(footRule), '.ccr-star-foot max-width:100% ⇒ 再窄也只能缩到面板里，不溢出')
ok(/flex-wrap:\s*wrap/u.test(footRule), '.ccr-star-foot 允许换行 ⇒ **窄宽度不溢出**')
ok(!/position:\s*sticky/u.test(footRule), '.ccr-star-foot **不再 sticky**（理由见文件头：透明 + sticky = 正文从这行里透出来 ⇒ 叠字 ✗）')
ok(!/position\s*:/u.test(footRule), '.ccr-star-foot 不设任何 position（就老老实实排在正文最后一节之后 ⇒ 不遮挡内容 ✓）')
ok(/margin-top\s*:/u.test(footRule), '.ccr-star-foot 与正文之间留了间距（不贴字）')

console.log('── ⑧ 观感：**没有背景 / 没有阴影 / 没有边框**（"灰框"就是这三样来的 ✗）')

/** CSS 规则体里有没有某个属性声明（`border-radius` 不算 `border`）。 */
const hasProp = (rule, prop) => new RegExp(`(?:^|[;{\\s])${prop}\\s*:`, 'iu').test(rule)

for (const [label, rule] of [
  ['.ccr-star-foot', footRule],
  ['.ccr-star-link', linkRule],
]) {
  ok(!hasProp(rule, 'background'), `${label} **没有 background**（用户点名的"灰色颜色框"就是它 ✗）`)
  ok(!hasProp(rule, 'background-color'), `${label} 没有 background-color`)
  ok(!hasProp(rule, 'box-shadow'), `${label} **没有 box-shadow**（那 16px 的"深色宽带"就是它 ✗）`)
  ok(!hasProp(rule, 'border'), `${label} 没有 border（不要色块、不要盒子 ✓）`)
  ok(!hasProp(rule, 'outline'), `${label} 没有常驻 outline（焦点圈只走 :focus-visible ✓）`)
}
/*
 * ⚠️ box-sizing **不算**"灰框"那一类：它是盒模型计算方式，不出任何颜色。
 * 这里只钉"不许动面板既有布局"，单独一条、说明白。
 */
ok(
  !hasProp(footRule, 'margin-left') && !hasProp(footRule, 'margin-right'),
  '.ccr-star-foot 不动左右外边距（不跟面板既有布局抢位置）',
)

/* 那两行**正是**这次要删掉的东西 —— 逐字钉死，防"哪天又被加回来" ✓ */
ok(
  !/--dsw-alias-bg-layer-1/u.test(footRule),
  '.ccr-star-foot 不再引用 --dsw-alias-bg-layer-1（深色主题下它就是那块灰底 ✗）',
)
ok(
  !/0\s+16px\s+0/u.test(footRule),
  '.ccr-star-foot 不再有 `0 16px 0`（那条把下沿糊成 16px 深色带的 shadow ✗）',
)
ok(
  !/(?:^|[;\s])transparent(?:[;\s]|$)/iu.test(footRule),
  '.ccr-star-foot **不写 transparent 兜底**：背景/阴影两行整段删除，不是覆盖成透明（留一行等于给后来人递刀 ✗）',
)

ok(/max-width:\s*100%/u.test(linkRule), '.ccr-star-link max-width:100% ⇒ 再窄也是收缩/换行，不溢出')
ok(/color\s*:/u.test(linkRule), '.ccr-star-link 用文字色（不是色块）')

console.log('── ⑨ 样式归属：只用一个 style 标签（不许再插第二个）')

eq(head.length, 1, 'apply() 之后 head 里恰好一个 style 标签')
eq(head[0].getAttribute('data-plugin'), captured.id, '标签归属 data-plugin == 客户端模块图 id')
ensureStyles()
ensureStyles()
eq(head.length, 1, '再调两次 ensureStyles() 仍然只有一个标签（可重入 ✓）')
ok(
  head[0].textContent.includes('.ccr-star-foot'),
  '这个标签里就有 Star 钩子的样式 ⇒ **没有第二个 style 标签**（这是用户点名的约束）',
)

/* ═══════════ ⑩ 可失败性验证：把制品**改坏**，本套断言必须变红 ═══════════ */

/*
 * 做法：把上面那四条**关键**断言抽成一个纯函数，喂给它一份**真的 CSS 文本**。
 *   · 修好的制品 ⇒ 4/4 通过
 *   · 回到 v1.0.74 那两行（background + box-shadow + sticky + 块级 flex）⇒ 4/4 红
 * 这样"断言可失败"是被**当场证明**的，而不是嘴上说说 ✓。
 */
function starRuleVerdicts(css) {
  const f = /\.ccr-star-foot\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
  const l = /\.ccr-star-link\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
  return {
    右对齐: /justify-content:\s*flex-end/u.test(f),
    收缩到内容宽: /display:\s*inline-flex/u.test(f),
    无背景: !hasProp(f, 'background') && !hasProp(l, 'background'),
    无阴影: !hasProp(f, 'box-shadow') && !hasProp(l, 'box-shadow'),
    无边框: !hasProp(f, 'border') && !hasProp(l, 'border'),
    非满宽: !hasWidthDecl(f),
    不粘滞: !/position\s*:/u.test(f),
  }
}

console.log('── ⑩ 可失败性验证（本套断言真的会红吗）')

/* ⑩-a 把**当前制品**里的 href 改坏 ⇒ 渲染断言必须红 */
const MUT_HREF = 'https://example.com/not-this-repo'
ok(
  bundle.includes(REPO_URL),
  '制品里确实写着本仓地址（变异有靶子可打）',
)
const bundleBadHref = bundle.split(REPO_URL).join(MUT_HREF)
const treeBadHref = (() => {
  const c = captureFactory(bundleBadHref, { ...globalThis, document: documentShim })
  const regs = []
  const ctx = {
    slots: { inject: (_n, cb) => void cb(), register: (spec, comp) => (regs.push({ spec, component: comp }), () => {}) },
    effect: () => {},
    logger: { warn: () => {} },
    get: () => undefined,
  }
  c.factory(requireShim).apply(ctx)
  return regs.find((r) => r.spec?.name === 'main' && r.spec?.key === 'connection-panel')?.component?.()
})()
const badHrefAnchor = findByType(treeBadHref, 'a')[0]
ok(
  badHrefAnchor?.props?.href === MUT_HREF,
  '⑩-a 变异版制品真的渲染出了错 href（说明"改坏"这一步确实生效了 ✓）',
)
ok(
  badHrefAnchor?.props?.href !== REPO_URL,
  '⑩-a **href 改错 ⇒ 本套断言会红** ✓（不是永远为真的空断言）',
)

/* ⑩-b 把 CSS 改回 v1.0.74 那一版（带灰框 + 满宽带子）⇒ 位置/观感断言必须红 */
const CSS_1_0_74_STAR = `
.ccr-star-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  position: sticky;
  bottom: 0;
  margin-top: 18px;
  padding: 6px 0 2px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  box-shadow: 0 16px 0 var(--dsw-alias-bg-layer-1, transparent);
}
.ccr-star-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  max-width: 100%;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, #888);
  text-decoration: none;
  border-radius: 4px;
}
`
const nowVerdicts = starRuleVerdicts(CONNECTION_CARD_CSS)
const oldVerdicts = starRuleVerdicts(CSS_1_0_74_STAR)
for (const key of Object.keys(nowVerdicts)) {
  ok(nowVerdicts[key] === true, `⑩-b 现制品：${key} ✓`)
}
ok(
  oldVerdicts.无背景 === false && oldVerdicts.无阴影 === false,
  '⑩-b **把 1.0.74 那版 CSS 喂回来 ⇒「无背景/无阴影」两条立刻红** ✓（正是本次修复目标）',
)
ok(
  oldVerdicts.非满宽 === true,
  '⑩-b 顺带确认：1.0.74 那版**没写 width** ⇒ 它撑满整列靠的是「块级 flex 盒子」本身，不是 width:100% ✓',
)
eq(
  Object.values(oldVerdicts).filter((v) => v === false).length,
  4,
  '⑩-b 旧版 CSS 恰好触发 4 条失败（无背景 / 无阴影 / 收缩到内容宽 / 不粘滞）',
)
eq(
  Object.values(nowVerdicts).filter((v) => v === true).length,
  7,
  '⑩-b 现制品 7 条全过',
)

/* ⑩-c 给修好的 CSS **就地**加回背景声明 ⇒ 必须能红（证明检查器认 `background` 这个词） */
ok(
  starRuleVerdicts(CONNECTION_CARD_CSS.replace(
    '.ccr-star-foot {',
    '.ccr-star-foot {\n  background: var(--dsw-alias-bg-layer-1, transparent);',
  )).无背景 === false,
  '⑩-c 只在现制品的 `.ccr-star-foot` 上补一行 background ⇒ 「无背景」立刻红 ✓',
)
ok(
  starRuleVerdicts(CONNECTION_CARD_CSS.replace(
    '.ccr-star-foot {',
    '.ccr-star-foot {\n  box-shadow: 0 16px 0 red;',
  )).无阴影 === false,
  '⑩-c 补一行 box-shadow ⇒ 「无阴影」立刻红 ✓',
)
ok(
  starRuleVerdicts(CONNECTION_CARD_CSS.replace(
    /\.ccr-star-foot\s*\{/u,
    '.ccr-star-foot {\n  width: 100%;',
  )).非满宽 === false,
  '⑩-c 补一行 width:100% ⇒ 「非满宽」立刻红 ✓',
)
ok(
  starRuleVerdicts(CONNECTION_CARD_CSS.replace(
    '.ccr-star-foot {',
    '.ccr-star-foot {\n  border: 1px solid red;',
  )).无边框 === false,
  '⑩-c 补一行 border ⇒ 「无边框」立刻红 ✓（border-radius 不算 border ✓）',
)
ok(
  starRuleVerdicts(CONNECTION_CARD_CSS).无边框 === true,
  '⑩-c 反向确认：现制品里 `.ccr-star-link` 的 `border-radius: 4px` **没有**被误判成 border ✓',
)

/* ⑩-d **不改文件**的制品变异：临时把 lib/client.js 改坏 → 必须红 → 立刻按快照还原 */
console.log('── ⑩-d 原地变异制品文件（改坏 → 必须红 → 还原）')
const CLIENT_PATH = join(ROOT, 'lib', 'client.js')
const pristine = readFileSync(CLIENT_PATH)
let mutated = false
let mutationWasRed = false
try {
  writeFileSync(CLIENT_PATH, pristine.toString('utf8').split(REPO_URL).join(MUT_HREF), 'utf8')
  mutated = true
  const reRead = readFileSync(CLIENT_PATH, 'utf8')
  const c = captureFactory(reRead, { ...globalThis, document: documentShim })
  const regs = []
  c.factory(requireShim).apply({
    slots: { inject: (_n, cb) => void cb(), register: (spec, comp) => (regs.push({ spec, component: comp }), () => {}) },
    effect: () => {},
    logger: { warn: () => {} },
    get: () => undefined,
  })
  const t = regs.find((r) => r.spec?.name === 'main' && r.spec?.key === 'connection-panel')?.component?.()
  const a = findByType(t, 'a')[0]
  mutationWasRed = a?.props?.href !== REPO_URL
} finally {
  /* 无论上面发生什么，都按**内容快照**写回原样（不是"尽力而为"） */
  writeFileSync(CLIENT_PATH, pristine)
}
ok(mutated, '⑩-d 制品确实被改写了一次（变异真的落到磁盘上了）')
ok(mutationWasRed, '⑩-d 改坏制品 ⇒ 渲染断言变红 ✓（这条测试**是有能力失败的**）')
{
  const after = readFileSync(CLIENT_PATH)
  eq(after.length, pristine.length, '⑩-d 收尾：lib/client.js 字节数已还原')
  ok(after.equals(pristine), '⑩-d 收尾：lib/client.js **逐字节**还原（跑完 git status 干净 ✓）')
}

/* ⑩-e 最后再确认一次：还原之后，本套断言回到全绿 */
{
  const restored = readFileSync(CLIENT_PATH, 'utf8')
  const c = captureFactory(restored, { ...globalThis, document: documentShim })
  const regs = []
  c.factory(requireShim).apply({
    slots: { inject: (_n, cb) => void cb(), register: (spec, comp) => (regs.push({ spec, component: comp }), () => {}) },
    effect: () => {},
    logger: { warn: () => {} },
    get: () => undefined,
  })
  const t = regs.find((r) => r.spec?.name === 'main' && r.spec?.key === 'connection-panel')?.component?.()
  eq(findByType(t, 'a')[0]?.props?.href, REPO_URL, '⑩-e 还原后 href 回到本仓 ✓')
}

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
