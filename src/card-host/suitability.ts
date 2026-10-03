/**
 * **卡片的适格性**：这张卡"是不是当卡片的材料"（用户在候选列表里要能一眼看出）。
 *
 * ## 为什么需要它（用户点出的第三条判据轴）
 *
 * 用户原话：
 *
 * > 「`omdsh-dev/DSH-better-sidebar` 这种插件一看就是**为了全局而生的**啊」
 *
 * 也就是说：**星多 ≠ 适合当卡片** ✗。
 * `DSH-better-sidebar`（3979★）是**替换/接管整个侧栏的全局 UI** ——
 * 它天生属于"**装到 App 上**"，不属于"**挂到某条连接上**" ✗。
 * 这类插件**即使能挂上也没意义**（全局 UI 塞进连接级面板既装不下，也会和 App 自己的布局打架）。
 *
 * ⇒ 判定要**三条轴**（前两条在别处已实现，这里是第三条 + 汇总）：
 *
 *     ① 模块门：入口 import 闭包内的依赖可解析   （`shim.ts` 的 planShims）
 *     ② 能力门：inject ⊆ {tools, effect, llm, prompt}
 *     ③ **作用域门**：全局型 ⇒ 「不建议当卡片」
 *
 * ## 判据（**静态可读**，不用挂载）
 *
 * · 注册到 **App 级**槽位/布局/设置页/主题（`sidebar` / `layout` / `settings` / `theme` /
 *   `ui-settings-*` 这类）⇒ **全局型** ✗
 * · 注册到**局部**位置（如 `conversation.input.right`）⇒ **局部/连接级** ✓
 * · **没有 `dsh.client`**（纯能力）⇒ **能力型** ✓
 *
 * ## ⚠️ 它是**启发式**，不是裁决
 *
 * 只读客户端源码里的**槽位名字符串** ⇒ 会漏判/误判 ✓。
 * 所以它只用来**标注**（"不建议"），**不用来阻断** ✗ ——
 * 用户仍可以挂，只是事先知道"这张卡天生不是卡片材料" ✓。
 * （对端点明：**用户看不出"哪张卡天生不是卡片材料"，逐个试才发现的成本最高** ✓。）
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readClientArtifact } from './client-artifact.js'

/** 卡片适格性（面板据此标注）。 */
export interface CardSuitability {
  /** `capability` 纯能力 / `local` 局部 UI / `global` 全局 UI / `unclear` 判不出。 */
  scope: 'capability' | 'local' | 'global' | 'unclear'
  /** 给人看的一句理由（面板 tooltip 用）。 */
  why: string
  /** 命中的全局槽位名（诊断用；空数组表示没命中）。 */
  globalHits: string[]
}

/**
 * **App 级（全局）槽位名**：命中这些 ⇒ 这张卡是"为全局而生"的 ✗。
 *
 * 判据保守：只认**能明确指向 App 级布局/设置/主题**的名字 ✓，
 * 拿不准的一律不判全局（宁可漏判，也不要把局部挂件误标成全局 ✗）。
 */
const GLOBAL_SLOT_HINTS = [
  'sidebar',
  'layout',
  'titlebar',
  'statusbar',
  'menubar',
  'theme',
  'ui-settings',
  'settings',
  'app.',
  'workspace.tab',
  'nav.',
]

/** 局部（连接级）槽位名的一眼可辨前缀。 */
const LOCAL_SLOT_HINTS = ['conversation.', 'message.', 'input.', 'session.', 'composer.', 'card.']

/**
 * **App 级（全局）命名空间**：命中这些**对象的注册调用** ⇒ 这张卡是"为全局而生"的 ✗。
 *
 * ⚠️ 为什么要有这一条（对端复核抓到的漏判，**真实样本**是主题插件）：
 *
 * `Tommy00748/dsh-theme-cyberpunk2077` 被上一版判成 `unclear` ⇒ **过了三门** ✗，
 * 而它的原文是：
 *
 *     ctx.theme.register({ id: THEME_ID, … })      // ← 名字是**变量**，不是字面量 ✗
 *     ctx.theme.setTheme(THEME_ID)
 *     const THEME_ID = "cyberpunk2077"             // ← 追到常量才知道是主题 ✗
 *
 * 上一版 `slotNamesIn()` 只匹配 `slots.register|add|get|mount` ✗ ⇒
 * ① `theme.register` **不在列** ② 名字是**变量**不是字面量 ✗ —— 两处都漏 ⇒ 判成"不清楚" ✗。
 *
 * ⇒ 修法：**按"谁在被调用"判**（命名空间 ✓），比按"名字长什么样"判可靠得多 ✓ ——
 * `ctx.theme.register(…)` 无论 id 叫什么、是不是变量，**它都是主题 ⇒ 全局** ✓。
 *
 * 这与那四条根因同族：**判据面没被真实样本校准**（这次的真实样本是主题插件 ✓）。
 */
const GLOBAL_NAMESPACES = ['theme', 'settings', 'layout', 'sidebar', 'titlebar', 'workspace']

/**
 * 从源码里找出**App 级命名空间的注册/设置调用**（如 `ctx.theme.register(`）。
 *
 * 只看"调用发生在谁身上" —— 不看参数长什么样 ✓（参数可能是变量 ✓）。
 */
function globalNamespacesIn(source: string): string[] {
  const out = new Set<string>()
  const re = new RegExp(
    `(?:^|[^\\w$])(?:ctx\\s*\\.\\s*)?(${GLOBAL_NAMESPACES.join('|')})\\s*\\.\\s*` +
      `(?:register|setTheme|set\\w*|add|contribute|mount|apply|install|provide)\\s*\\(`,
    'g',
  )
  for (const m of source.matchAll(re)) out.add(m[1])
  return [...out]
}

/**
 * 解析源码里的**字面量常量**（`const THEME_ID = "cyberpunk2077"`）。
 *
 * 用途：注册调用常常传变量而不是字面量 ✗ ⇒ 不追常量就"看不见"那个名字 ✓。
 * 只认**直接赋字面量**（一层 ✓）：不做出跨文件的常量传播 —— 那是编译器的事，
 * 而这里只要"够用且不猜" ✓。
 */
function literalConstantsIn(source: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of source.matchAll(
    /(?:^|[\s;{(])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([^'"`\r\n]+)['"`]/g,
  )) {
    out.set(m[1], m[2])
  }
  return out
}

/**
 * 从客户端源码里抠出"像槽位名"的字符串字面量。
 *
 * ⚠️ **三条来源缺一不可**（每一条都是被真实样本逼出来的）：
 *
 *   ① **注册调用位置**的字符串：`slots.register('sidebar', …)` ✓
 *      —— 能抓到**单词槽位名**（`sidebar`）✗（第一版只认带点的名字 ⇒ 整类漏掉 ✗）
 *   ② 形如 `a.b` 的**带点小写标识符** ✓ —— 配置里直接写的名字 ✓
 *   ③ **变量常量**（`const THEME_ID = "cyberpunk2077"` 然后 `register(THEME_ID)`）✓
 *      —— 名字是变量时，只有追到常量才看得见 ✗（主题插件就是这么写的 ✓）
 *
 * 每一条都是**负控**（"应当不通过"的样本）抓出来的 ✓ ——
 * 只证明"它这次没报错"是不够的，还要证明"**它该报的时候还会报**" ✓。
 */
function slotNamesIn(source: string): string[] {
  const out = new Set<string>()
  const consts = literalConstantsIn(source)

  /** ① / ③ 注册调用：参数是字面量就直接收，是标识符就查常量 ✓。 */
  for (const m of source.matchAll(
    /(?:slots?\s*\.\s*(?:register|add|get|contribute|mount)|register(?:Slot|UI)?|contributes?)\s*\(\s*(?:['"`]([^'"`\r\n]+)['"`]|([A-Za-z_$][\w$]*))/g,
  )) {
    const literal = m[1]
    const ident = m[2]
    if (literal) out.add(literal)
    else if (ident && consts.has(ident)) out.add(consts.get(ident)!)
  }

  /** ② 带点的小写标识符（配置里直接写的槽位名）。 */
  for (const m of source.matchAll(/['"`]([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)['"`]/g)) {
    const name = m[1]
    /** 排除明显的非槽位（文件路径 / 扩展名 / 域名）。 */
    if (/\.(js|mjs|cjs|ts|tsx|json|css|png|svg|md)$/.test(name)) continue
    if (/^\d/.test(name) || name.includes('//')) continue
    out.add(name)
  }

  return [...out]
}

/** 判定一张卡片的适格性（**只读**：不动磁盘、不挂载、不联网）。 */
export function analyzeSuitability(cardDir: string, hasClient?: boolean): CardSuitability {
  const artifact = readClientArtifact(cardDir)
  const withClient = hasClient ?? artifact.ok

  if (!withClient) {
    return {
      scope: 'capability',
      why: '纯能力卡（没有客户端 UI）—— 挂到连接上只提供工具/事件，正是卡片的本职 ✓',
      globalHits: [],
    }
  }

  /** 有客户端制品但读不到源码：判不出（诚实说"判不出"，不猜）。 */
  if (!artifact.ok) {
    return {
      scope: 'unclear',
      why: `这张卡声明了客户端 UI，但读不到它的源码（${artifact.reason}）—— 无法判断作用域`,
      globalHits: [],
    }
  }

  /** 走到这里 `ok === true` ⇒ `source` 一定有 ✓（上面的分支已排除）。 */
  const src = artifact.source ?? ''
  const slots = slotNamesIn(src)
  /**
   * **命名空间优先**：`ctx.theme.register(…)` 无论 id 叫什么、是不是变量 ⇒ **它就是全局** ✓。
   * 这一条比"按名字猜"可靠得多 ✓（主题插件就是这么漏过去的 ✗）。
   */
  const ns = globalNamespacesIn(src)
  const globalHits = slots.filter((s) => GLOBAL_SLOT_HINTS.some((h) => s === h || s.startsWith(h)))
  const localHits = slots.filter((s) => LOCAL_SLOT_HINTS.some((h) => s.startsWith(h)))

  if (ns.length > 0) {
    return {
      scope: 'global',
      why:
        `**全局 UI**（调用了 App 级命名空间：${ns.map((n) => `ctx.${n}`).join(' / ')}）—— ` +
        `主题/设置/布局这类是**整个 App 的**，不属于某条连接。挂得上也不建议 ✗`,
      globalHits: [...ns, ...globalHits],
    }
  }

  if (globalHits.length > 0) {
    return {
      scope: 'global',
      why:
        `**全局 UI**（注册到 App 级位置：${globalHits.slice(0, 3).join(' / ')}）—— ` +
        `这类插件是为"装到 App 上"设计的，挂到**某条连接**上既装不下、也会和 App 布局打架。` +
        `挂得上也不建议 ✗`,
      globalHits,
    }
  }

  if (localHits.length > 0) {
    return {
      scope: 'local',
      why: `局部 UI（注册到连接级位置：${localHits.slice(0, 3).join(' / ')}）—— 适合当卡片 ✓`,
      globalHits: [],
    }
  }

  /** 有 UI、但槽位名既不像全局也不像局部 ⇒ **不猜**。 */
  return {
    scope: 'unclear',
    why:
      `有客户端 UI，但没读到能定作用域的槽位名` +
      (slots.length > 0 ? `（读到 ${slots.length} 个候选名，都不匹配已知模式）` : '') +
      ` —— 能不能当卡片要挂一次才知道`,
    globalHits: [],
  }
}

/** 面板徽标的文案与语气（**一处定义**，避免 UI 与判定脱节）。 */
export function suitabilityBadge(s: CardSuitability): { text: string; kind: 'ok' | 'warn' | 'muted' } {
  switch (s.scope) {
    case 'capability':
      return { text: '能力', kind: 'ok' }
    case 'local':
      return { text: '局部', kind: 'ok' }
    case 'global':
      return { text: '全局', kind: 'warn' }
    default:
      return { text: '未判定', kind: 'muted' }
  }
}

/** 诊断用：这张卡目录里有没有构建产物（`src/` 有、`lib/` 无 ⇒ 源码包）。 */
export function looksLikeSourceOnly(dir: string): boolean {
  try {
    return existsSync(join(dir, 'src')) && !existsSync(join(dir, 'lib'))
  } catch {
    return false
  }
}

/** 读一个小文件的安全包装（判定用，失败就当读不到）。 */
export function readIfExists(file: string): string | undefined {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined
  } catch {
    return undefined
  }
}
