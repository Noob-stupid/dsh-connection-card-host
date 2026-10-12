/**
 * `dsh.client.inject` ⊆ 宿主真正提供的模块词 —— **把维护者的判据钉死**。
 *
 * 缘起（社区列表维护者在收录 PR #24 里给的核对意见）：
 *   本包 `dsh.client.inject` 里写着 `@deepseek-ai/dsh-client-runtime`，
 *   而它在当前宿主（0.2.0-rc.2）的模块表里**已经不存在** —— 上游把那行删了。
 *   声明查不到只会被静默跳过（不崩），但这条声明是失效的。
 *
 * 于是这里断言一件可失败的事：
 *
 *   ① **宿主提供集合**（宿主模块表 + 启动图条目）**必须能从宿主/仓库推导出来**；
 *      推不出来就 **响亮 SKIP**（退出码 2）——**绝不假装 PASS**。
 *   ② `package.json` 的 `dsh.client.inject` **每一个词都必须在这个集合里**。
 *   ③ 推导出的集合本身要够大（≥ 4 个词）—— 防止正则写歪了把"空集"当通过。
 *
 * 数据来源（一个都不写死）：
 *   · 宿主模块表：前端产物里 `__ModuleLoader__` 的 staticModules 种子字面量；
 *     推不到产物就退到 dsh 源码 checkout 的 `packages/client/web/src/platform.ts`。
 *   · 启动图条目：`/plugins/<包名>` 形式的图行 —— 即"装在宿主里的兄弟客户端插件"。
 *   · 直接可解析：注入词能在宿主解析到**真实存在**的包（悬空 junction 不算）。
 *
 * 跑法：node scripts/test-inject-words.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

/* ───────────────── 宿主定位 ───────────────── */

const DSH_HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')

/**
 * 候选宿主根：profile 目录、宿主 node_modules、dsh 源码 checkout。
 * 逐个喂给各个推导器，取第一个成功的结果。
 */
function hostCandidates() {
  const out = []
  const profiles = join(DSH_HOME, 'profiles')
  if (existsSync(profiles)) {
    out.push(join(profiles, 'node_modules'))
    for (const name of ['desktop', 'web', 'default', 'headless']) {
      const p = join(profiles, name, 'node_modules')
      if (existsSync(p)) out.push(p)
    }
  }
  out.push(join(DSH_HOME, 'node_modules'))
  for (const key of ['DSH_CHECKOUT', 'DSH_SOURCE']) {
    if (process.env[key]) out.push(process.env[key])
  }
  return out.filter(existsSync)
}

/** checkout 候选（`platform.ts` 的所在）。 */
function checkoutCandidates() {
  const out = []
  for (const key of ['DSH_CHECKOUT', 'DSH_SOURCE']) {
    if (process.env[key]) out.push(process.env[key])
  }
  out.push(join(process.env.HOME ?? '', 'dsh-harness'), join(process.env.USERPROFILE ?? '', 'dsh-harness'))
  return out.filter(existsSync)
}

/** 宿主前端产物（`window.__ModuleLoader__` 的 staticModules 种子在里面）。 */
function frontendBundles() {
  const out = []
  for (const mods of hostCandidates()) {
    const dist = join(mods, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets')
    if (!existsSync(dist)) continue
    for (const f of readdirSafe(dist)) {
      if (f.endsWith('.js')) out.push(join(dist, f))
    }
  }
  return out
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/* ───────────────── 推导器 ───────────────── */

/**
 * 从一段 JS 里抠出 staticModules 种子对象的**顶层键**。
 * 种子字面量的形状是 `return{react:…,"react/jsx-runtime":…}` ——
 * 只吃 `return{` 之后那个对象的顶层引号键，嵌套对象（React 自己）自然被跳过。
 * @param {string} text - 产物源码。
 * @returns {string[]} 模块词（可能为空 = 没抠到）。
 */
function seedWordsFrom(text) {
  const at = text.indexOf('return{react:')
  if (at === -1) return []
  const start = text.indexOf('{', at)
  let depth = 0
  let end = -1
  let inStr = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr !== null) {
      if (ch === '\\') i++
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) return []
  const body = text.slice(start + 1, end)
  depth = 0
  inStr = null
  const words = []
  let key = null
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inStr !== null) {
      if (ch === '\\') i++
      else if (ch === inStr) { key = key === null ? null : key; inStr = null }
      else if (key !== null) key += ch
      continue
    }
    if (ch === '"' || ch === "'") { if (depth === 0) key = ''; inStr = ch; continue }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; continue }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue }
    if (ch === ',') { if (depth === 0 && key !== null) { words.push(key); key = null } }
  }
  if (key !== null) words.push(key)
  return words.filter((w) => w.length > 0)
}

/**
 * 从 checkout 的 `platform.ts` 抠出 `PLATFORM_MODULES` 的词表。
 * @param {string} text - platform.ts 源码。
 * @returns {string[]} 模块词。
 */
function platformWordsFrom(text) {
  const m = text.match(/PLATFORM_MODULES\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (m === null) return []
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2])
}

/**
 * 宿主提供集合 = 宿主模块表 ∪ 启动图条目 ∪ 宿主里可解析的真实包。
 * @returns {{words: Set<string>, sources: string[]}|null} 推导成功时的集合与来源说明；推不出来返回 null。
 */
function deriveHostWords() {
  const words = new Set()
  const sources = []
  const note = (s) => { if (!sources.includes(s)) sources.push(s) }

  // ① 宿主模块表：前端产物里的 staticModules 种子。
  for (const file of frontendBundles()) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const got = seedWordsFrom(text)
    if (got.length > 0) {
      for (const w of got) words.add(w)
      note(`宿主前端产物 staticModules 种子（${file}）`)
      break
    }
  }

  // ② 退路：checkout 的 platform.ts（同一份词表的源码单点）。
  if (words.size === 0) {
    for (const co of checkoutCandidates()) {
      const p = join(co, 'packages', 'client', 'web', 'src', 'platform.ts')
      if (!existsSync(p)) continue
      const got = platformWordsFrom(readFileSync(p, 'utf8'))
      if (got.length > 0) {
        for (const w of got) words.add(w)
        note(`checkout platform.ts（${p}）`)
        break
      }
    }
  }

  // ③ 启动图条目：宿主里已装的客户端插件，注入它们同样是有效的。
  for (const mods of hostCandidates()) {
    const scope = join(mods, '@deepseek-ai')
    if (!existsSync(scope)) continue
    let entries = []
    try {
      entries = readdirSafe(scope)
    } catch {
      continue
    }
    let hit = 0
    for (const name of entries) {
      const pkgJson = join(scope, name, 'package.json')
      if (!existsSync(pkgJson)) continue
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'))
        if (pkg?.dsh?.client?.platform === 'web') { words.add(pkg.name); hit++ }
      } catch {
        /* 半装/坏包：跳过，别的候选还能用 */
      }
    }
    if (hit > 0) note(`宿主已装客户端插件 ${hit} 个（${scope}）`)
  }

  if (words.size === 0) return null
  return { words, sources }
}

/**
 * 该词在宿主里是否解析到一个**真实存在**的包。
 * 悬空 junction 不算 —— 本机 profile 里就有一个（`dsh-client-runtime` 指向已消失的
 * npx 缓存目录）：`require.resolve` 会成功，但目标压根不在盘上。
 * @param {string} word - 待查的模块词。
 * @returns {boolean} 真解析到实物返回 true。
 */
function resolvesInHost(word) {
  for (const mods of hostCandidates()) {
    try {
      const req = createRequire(join(mods, 'noop.js'))
      const p = req.resolve(`${word}/package.json`)
      if (existsSync(p) && statSync(p).isFile()) return true
    } catch {
      /* 该候选解析不到：换下一个 */
    }
  }
  return false
}

/* ───────────────── 断言 ───────────────── */

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const inject = pkg?.dsh?.client?.inject

console.log('── dsh.client.inject ⊆ 宿主提供的模块词')

if (!Array.isArray(inject)) {
  fail++
  console.log(`  ❌ package.json 的 dsh.client.inject 不是字符串数组：${JSON.stringify(inject)}`)
} else {
  ok(inject.length > 0, `dsh.client.inject 非空（读回 ${inject.length} 个词：${inject.join(', ')}）`)
  ok(
    inject.every((w) => typeof w === 'string' && w.length > 0),
    'dsh.client.inject 全是非空字符串',
  )

  const derived = deriveHostWords()
  if (derived === null) {
    console.log('')
    console.log('  ⚠️  SKIP —— 推导不出宿主提供的模块词表（这条断言**没有通过**，只是本机判不了）。')
    console.log('      试过：dsh 前端产物 staticModules / checkout platform.ts / 宿主已装客户端插件')
    console.log(`      宿主候选：${hostCandidates().join(' , ') || '（一个都不存在）'}`)
    console.log('      判得了就判；判不了就响亮 SKIP —— 绝不假装 PASS。')
    console.log('      要真判：设 DSH_HOME 指向装了 dsh 的宿主，或设 DSH_CHECKOUT 指向 dsh 源码 checkout。')
    console.log('')
    process.exit(2)
  }

  const { words, sources } = derived
  console.log(`  来源：${sources.join(' ； ')}`)
  console.log(`  宿主提供 ${words.size} 个词`)

  // 防假绿：正则抠歪了会得到"空集或极小集"，那么任何注入词都会"通过"。
  ok(words.size >= 4, `推导出的词表够大（≥ 4，实得 ${words.size}）—— 防止抠歪了变成假通过`)

  for (const word of inject) {
    const inTable = words.has(word)
    const resolvable = !inTable && resolvesInHost(word)
    ok(
      inTable || resolvable,
      `${word} 是宿主提供的模块词` +
        (inTable ? '（在宿主模块表/启动图里）' : resolvable ? '（宿主里解析到真实包）' : ' —— **宿主不提供它，这条 inject 声明是失效的**'),
    )
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
