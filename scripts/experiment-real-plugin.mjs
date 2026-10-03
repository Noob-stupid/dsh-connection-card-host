/**
 * 真实插件实验（不需要 DSH 在跑，也不碰线上环境）。
 *
 * 与 test-shim / test-bridge 的区别：那两个用**假插件**验证机制；
 * 这个把**真实的第三方插件**（默认取 `dsh-browser`）拷进卡片目录后完整走一遍：
 *
 *     垫片（真模块 or 能力门面） → 影子 ctx → 插件的真 apply → 捕获它的真工具
 *       → 桥接（命名/可见性/生命周期）
 *
 * 这一步能提前暴露"假插件测不出来"的问题：真实插件会用到门面之外的东西、
 * 依赖真实的第三方包、Config 里可能用到门面没实现的链式调用。
 *
 * 插件不在本机时**跳过**（不算失败）—— 它不是人人都有的环境依赖。
 *
 * 跑法：node scripts/experiment-real-plugin.mjs [插件目录或包名]
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 手工递归拷贝。
 *
 * ⚠️ **不能用 `fs.cpSync`**：本机上它写「用户主目录下的 .dsh」与 %TEMP% 一律
 * `EIO, Access is denied`（写非系统盘却正常），而 `copyFileSync` 哪儿都能写。
 * 这与卡片安装器用的是同一个 API —— 实测安装器当时也装不上（已在 v1.0.19 修）。
 */
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const sp = join(src, e.name)
    const dp = join(dst, e.name)
    if (e.isDirectory()) copyDir(sp, dp)
    else if (e.isFile()) writeFileSync(dp, readFileSync(sp))
  }
}

import { mountPlugin } from '../lib/adapter/mount.js'
import { ToolBridge } from '../lib/adapter/tool-bridge.js'
import { validateDeclaration } from '../lib/adapter/capabilities.js'
import { planShims, writeShims, unresolvedOf, describePlan } from '../lib/adapter/shim.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

/**
 * 找插件：按包名解析，或直接用给的路径。
 *
 * 候选根目录**从环境推**，不写死本机路径：
 *   · DSH_PROFILE_DIR —— profile 启动的 DSH 会设它（首选）
 *   · 用户主目录下的 .dsh/profiles/<名字>/node_modules —— 兜底，逐个 profile 试
 * 找不到就跳过（本脚本不是人人都有的环境依赖）。
 */
function locate(spec) {
  if (existsSync(spec)) return { dir: spec, source: 'path' }

  const roots = []
  if (process.env.DSH_PROFILE_DIR) roots.push(join(process.env.DSH_PROFILE_DIR, 'node_modules'))
  const profilesDir = join(homedir(), '.dsh', 'profiles')
  try {
    for (const name of readdirSync(profilesDir)) {
      roots.push(join(profilesDir, name, 'node_modules'))
    }
  } catch {
    /* profiles 目录不存在：没有候选根 */
  }

  for (const r of roots) {
    const p = join(r, ...spec.split('/'))
    if (existsSync(p)) return { dir: p, source: r }
  }
  return null
}

const target = process.argv[2] ?? 'dsh-browser'
const found = locate(target)

if (!found) {
  console.log(`── 真实插件实验：跳过（本机找不到 ${target}）`)
  console.log('')
  console.log('═══ 结果：0 通过 / 0 失败（已跳过）═══')
  process.exit(0)
}

const logs = []
const audit = (m) => logs.push(m)
const root = mkdtempSync(join(tmpdir(), 'ccr-real-'))
const cardsRoot = join(root, 'cards') // 垫片根 = 卡片根（插件的向上查找才命中）
const facadeBaseDir = join(process.cwd(), 'lib', 'adapter')

try {
  console.log(`── 真实插件：${target}`)
  console.log(`   源目录：${found.dir}`)

  /* ═══ 1. 模拟安装：拷进卡片目录（与安装器做的事一致）═══ */
  const pkgName = JSON.parse(readFileSync(join(found.dir, 'package.json'), 'utf8')).name
  const cardDir = join(cardsRoot, `${pkgName}@1.0.0-real`)
  mkdirSync(cardsRoot, { recursive: true })
  copyDir(found.dir, cardDir)
  ok(existsSync(join(cardDir, 'package.json')), '插件已拷进卡片目录')

  /* ═══ 2. 垫片必须可用（否则连加载都过不了）═══ */
  const plan = planShims(cardDir, cardsRoot, found.dir)
  console.log(`   垫片：${describePlan(plan)}`)
  const unresolved = unresolvedOf(plan)
  ok(unresolved.length === 0, `依赖全部可解析（未解析：${unresolved.join('; ') || '无'}）`)

  const w = writeShims(plan, facadeBaseDir)
  ok(w.written > 0 || w.skipped > 0, `垫片已写出（写 ${w.written} / 跳 ${w.skipped} / 链 ${w.linked}）`)

  const dshTiers = plan.dsh.map((d) => `${d.pkg.split('/').pop()}=${d.tier}`).join(' ')
  console.log(`   @deepseek-ai 包定档：${dshTiers}`)
  console.log(
    `   第三方：${plan.thirdParty.map((t) => `${t.pkg}=${t.resolvedDir ? '已链接' : '缺失'}`).join(' ') || '无'}`,
  )

  /* ═══ 3. 真实加载 + 真实 apply（影子 ctx）═══ */
  const mounted = await mountPlugin(
    {
      pluginId: pkgName,
      pluginDir: cardDir,
      capabilities: ['tools', 'effect'],
      shimRoot: cardsRoot,
      facadeBaseDir,
      depSourceDir: found.dir, // 第三方依赖从原安装位置解析
    },
    audit,
  )

  console.log(`   挂载结果：${mounted.describe()}`)
  ok(mounted.capture.tools.size > 0, `插件的真 apply 跑通并注册了工具（${mounted.capture.tools.size} 个）`)

  const toolNames = [...mounted.capture.tools.keys()]
  console.log(`   捕获的工具：${toolNames.join(', ')}`)
  for (const n of toolNames.slice(0, 3)) {
    const def = mounted.capture.tools.get(n)
    ok(typeof def.execute === 'function', `「${n}」有可执行的 execute`)
    ok(Boolean(def.parameters && def.parameters.type === 'object'), `「${n}」的参数已转成对象根 JSON Schema`)
  }

  /* ═══ 4. 桥接：命名 / 可见性 / 生命周期 ═══ */
  const registry = new Map()
  const bridge = new ToolBridge({
    registerTool: (def) => {
      if (registry.has(def.name)) throw new Error(`duplicated tool: ${def.name}`)
      registry.set(def.name, def)
      return () => registry.delete(def.name)
    },
    getConnection: (id) => (id === 'conn-1' ? { sessionA: 'sess-A', sessionB: 'sess-B' } : undefined),
    audit,
  })

  const bridged = bridge.add(mounted, {
    cardId: pkgName.replace(/[^A-Za-z0-9_]/g, '_'),
    instanceId: 'exp-1',
    connectionId: 'conn-1',
    scope: 'a', // 只给 A 端 —— 正好验证"按端生效"
  })

  ok(bridged.length === mounted.capture.tools.size, '每个捕获的工具都桥接了一条')
  ok(
    [...registry.keys()].every((n) => n.startsWith('card_')),
    '注册进工具表的名字都带卡片前缀（防撞名）',
  )

  const first = registry.get(bridged[0].bridgedName)
  const aOut = await first.execute({}, { agent: { id: 'sess-A' } })
  const bOut = await first.execute({}, { agent: { id: 'sess-B' } })
  console.log(`   A 端调用 → ${JSON.stringify(String(aOut).slice(0, 90))}`)
  console.log(`   B 端调用 → ${JSON.stringify(String(bOut).slice(0, 90))}`)
  ok(!/只对 A 端可见/.test(String(aOut)), 'A 端调用没有被可见性挡下（进入了插件实现）')
  ok(/只对 A 端可见/.test(String(bOut)), 'B 端调用被挡下（护栏③：只藏不校验是不够的）')

  // 生命周期：卸载后工具消失 + 插件资源释放
  bridge.remove('exp-1')
  ok(registry.size === 0, '卸载后工具表清空（无幽灵）')
  mounted.dispose()
  ok(mounted.capture.tools.size === 0, 'dispose 清空捕获表')

  /* ═══ 5. 结论输出 ═══ */
  console.log('')
  console.log('   ── 这个真实插件用到的能力面 ──')
  console.log(`   ctx.* 依赖：${mounted.injects.join(', ') || '（inject 为空）'}`)
  console.log(`   门面档位：${dshTiers}`)
} catch (e) {
  fail++
  console.log(`  ❌ 实验抛错：${e instanceof Error ? e.message : String(e)}`)
  if (e instanceof Error && e.stack) {
    console.log(
      e.stack
        .split('\n')
        .slice(1, 4)
        .map((l) => `     ${l.trim()}`)
        .join('\n'),
    )
  }
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
