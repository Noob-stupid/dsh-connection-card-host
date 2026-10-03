/**
 * 挂载器 —— 把一个**普通 DSH 插件**在卡片作用域里真正跑起来。
 *
 * 流程（每一步都可能明确拒绝，且拒绝理由必须能指导下一步）：
 *
 *   1. **解析入口**：package.json 的 main → dshCard.entry → lib/index.js
 *   2. **垫片**：规划 + 写入（拿不到的东西在这里就暴露，见 shim.ts）
 *   3. **申报对账**：插件 `export const inject = ['tools', …]` 要的服务，
 *      必须被适配层的能力申报覆盖 —— 这是护栏②的"申报制"落到具体一处
 *   4. **加载模块**：import 入口（崩溃隔离：加载失败不拖垮宿主）
 *   5. **apply**：用影子 ctx 调 `apply(ctx, config)`（崩溃隔离）
 *   6. **交出结果**：捕获的工具 + 全部 disposer，由桥接层接管
 *
 * ## 为什么"申报对账"要单独做一步
 *
 * 插件的 `inject` 是它**自己声明的依赖**，而能力申报是**我们答应的供给**。
 * 两者对不上就是"我答应给你 tools，你却要 webServer" —— 这种不匹配如果不在
 * 装载前查出来，就会在插件跑到某一行时以"undefined 上取属性"的形态炸掉，
 * 而那个报错跟真实原因（服务没提供）隔着好几层。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { validateDeclaration, ALL_CAPABILITIES, type CapabilityDeclaration } from './capabilities.js'
import { createShadowCtx, type ShadowCapture, type ShadowCtx } from './shadow-ctx.js'
import { planShims, writeShims, unresolvedOf, describePlan, type ShimPlan } from './shim.js'

/** 一次挂载的输入。 */
export interface MountRequest {
  /** 插件 id（卡片 id 或包名），用于命名、审计与错误文案。 */
  pluginId: string
  /** 插件所在目录（卡片目录 / 已安装目录）。 */
  pluginDir: string
  /** 能力申报（`dshCard.adapter.capabilities`）。 */
  capabilities: unknown
  /** 传给插件 `apply` 的配置（默认 `{}`）。 */
  config?: unknown
  /** 垫片根：其下会建 `node_modules`。 */
  shimRoot: string
  /** 门面模块所在目录（`lib/adapter`）。 */
  facadeBaseDir: string
  /** 第三方依赖从哪里解析；默认同 pluginDir。 */
  depSourceDir?: string
}

/** 挂载结果。 */
export interface MountedPlugin {
  pluginId: string
  dir: string
  entry: string
  /** 插件 `inject` 声明的服务名。 */
  injects: string[]
  capture: ShadowCapture
  shimPlan: ShimPlan
  /** 卸载：逆序清理 + 清空工具表。 */
  dispose: () => void
  describe: () => string
}

/** 挂载失败（区分"能指导下一步"的原因）。 */
export class MountRefused extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MountRefused'
    this.code = code
  }
}

/** 插件入口解析：main → dshCard.entry → lib/index.js。 */
export function resolvePluginEntry(pluginDir: string): string | undefined {
  const pkgPath = join(pluginDir, 'package.json')
  if (!existsSync(pkgPath)) return undefined
  let pkg: { main?: string; dshCard?: { entry?: string } }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return undefined
  }
  const candidates = [
    pkg.dshCard?.entry,
    pkg.main,
    'lib/index.js',
    'lib/index.mjs',
    'index.mjs',
    'index.js',
  ].filter((c): c is string => typeof c === 'string' && c.length > 0)

  for (const rel of candidates) {
    const abs = join(pluginDir, rel)
    if (existsSync(abs) && statSync(abs).isFile()) return abs
  }
  return undefined
}

/**
 * 插件 `inject` ↔ 能力申报 的对账。
 *
 * 规则：
 *   · 插件要的每个服务，都必须在**已实现**的能力里 —— 否则拒绝，并说清要哪个
 *   · 适配层已实现、但插件**没要**的能力无所谓（多给不算错）
 *   · `effect` 属于 ctx 核心，不需要写进 inject；我们按"总是可用"处理
 */
export function reconcileInjects(
  pluginId: string,
  injects: string[],
  declaration: CapabilityDeclaration,
): { ok: true } | { ok: false; reason: string } {
  const missing = injects.filter((name) => !declaration.declared.includes(name))
  if (missing.length === 0) return { ok: true }

  const unknown = missing.filter((m) => !ALL_CAPABILITIES.includes(m))
  return {
    ok: false,
    reason:
      `插件「${pluginId}」声明需要这些服务：[${missing.join(', ')}]，` +
      `但它所在卡片的适配申报里没有它们（申报的是 [${declaration.declared.join(', ') || '（空）'}]）。` +
      (unknown.length > 0
        ? `其中 [${unknown.join(', ')}] 甚至不是本适配层的能力名 —— ` +
          `也就是说适配层**不提供**这些服务。` +
          `若该插件的核心功能依赖它们，它不适合作为卡片挂载。`
        : `请在该卡片的申报里补上。`),
  }
}

/**
 * 执行一次挂载。
 *
 * @throws MountRefused 一切可预期的拒绝（含明确原因）；其它异常视为缺陷。
 */
export async function mountPlugin(
  request: MountRequest,
  audit: (message: string) => void,
): Promise<MountedPlugin> {
  const { pluginId, pluginDir, shimRoot, facadeBaseDir } = request

  if (!existsSync(pluginDir)) {
    throw new MountRefused('no-dir', `插件目录不存在：${pluginDir}`)
  }

  const entry = resolvePluginEntry(pluginDir)
  if (!entry) {
    throw new MountRefused(
      'no-entry',
      `在 ${pluginDir} 里找不到入口文件（试过 package.json 的 main、dshCard.entry、lib/index.js）。` +
        `这不是一个可加载的插件包。`,
    )
  }

  /**
   * ⚠️ 顺序很关键：**先校验我们自己的输入**（能力申报），再去做任何会碰外部的事。
   *
   * 申报是调用方给我们的东西，校验它不需要加载插件、不需要写垫片 ——
   * 把它排在 import 之后，会出现"申报写错了，却先看到插件加载失败"这种误导性报错。
   */
  const declaration = validateDeclaration(request.capabilities)
  if (!declaration.ok) {
    throw new MountRefused('bad-declaration', `卡片能力申报不合法：${declaration.reason}`)
  }

  // ── 1. 垫片：拿不到的东西在这里暴露 ──
  const plan = planShims(pluginDir, shimRoot, request.depSourceDir)
  const unresolved = unresolvedOf(plan)
  if (unresolved.length > 0) {
    throw new MountRefused(
      'unresolved-deps',
      `插件「${pluginId}」有无法解析的依赖，拒绝挂载：\n  · ${unresolved.join('\n  · ')}\n` +
        `DSH 包需要真模块或能力门面（白名单见 shim.ts）；第三方包需要能解析到真实副本。`,
    )
  }
  const writeResult = writeShims(plan, facadeBaseDir)
  audit(
    `[adapter] ${pluginId} 垫片就绪（写 ${writeResult.written} / 跳 ${writeResult.skipped} / 链 ${writeResult.linked}）：` +
      describePlan(plan),
  )

  // ── 2. 加载模块（崩溃隔离）──
  let mod: {
    apply?: (ctx: unknown, config: unknown) => unknown
    inject?: unknown
    name?: unknown
    Config?: unknown
  }
  try {
    const bust = Date.now().toString(36)
    mod = (await import(`${pathToFileURL(entry).href}?v=${bust}`)) as typeof mod
  } catch (e) {
    throw new MountRefused(
      'import-failed',
      `插件「${pluginId}」入口加载失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }

  if (typeof mod.apply !== 'function') {
    throw new MountRefused(
      'no-apply',
      `插件「${pluginId}」没有导出 apply 函数 —— 这不是一个 cordis 插件（入口：${entry}）。`,
    )
  }

  // ── 3. 申报对账 ──
  const injects = Array.isArray(mod.inject) ? (mod.inject as unknown[]).map(String) : []
  const reconciled = reconcileInjects(pluginId, injects, declaration)
  if (!reconciled.ok) {
    throw new MountRefused('inject-not-covered', reconciled.reason)
  }

  // ── 4. apply（崩溃隔离）──
  const shadow: ShadowCtx = createShadowCtx({ pluginId, declaration, audit })
  try {
    await mod.apply(shadow.ctx, request.config ?? {})
  } catch (e) {
    // apply 抛了：把已经登记的东西清掉，别留半截状态
    shadow.dispose()
    throw new MountRefused(
      'apply-failed',
      `插件「${pluginId}」的 apply 执行失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }

  audit(
    `[adapter] ${pluginId} 已挂载：${shadow.describe()}（工具尚未对会话可见，等桥接）`,
  )

  return {
    pluginId,
    dir: pluginDir,
    entry,
    injects,
    capture: shadow.capture,
    shimPlan: plan,
    dispose: () => {
      shadow.dispose()
      audit(`[adapter] ${pluginId} 已卸载（清理 ${shadow.capture.disposers.length} 项资源）`)
    },
    describe: () => shadow.describe(),
  }
}
