/**
 * 真实插件实验 —— 走**完整产品路径**（不需要 DSH 在跑，也不碰线上环境）。
 *
 *     安装（installCard：普通 DSH 插件包 ⇒ 合成适配清单）
 *       → 读回清单（装载器就是这么做）
 *         → 挂载（垫片 → 影子 ctx → 插件的真 apply）
 *           → 桥接（命名 / 可见性 / 生命周期）
 *
 * 这比"手工把插件拷进卡片目录"更接近真实：安装器怎么处理、清单长什么样、
 * 装载器读到的能力面是什么，全都在这一步里过一遍。
 *
 * 插件不在本机时**跳过**（不算失败）—— 它不是人人都有的环境依赖。
 *
 * 跑法：node scripts/experiment-real-plugin.mjs [插件目录或包名]
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { installCard } from '../lib/card-host/installer.js'
import { mountPlugin } from '../lib/adapter/mount.js'
import { ToolBridge } from '../lib/adapter/tool-bridge.js'
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
  console.log(`   来源：${found.dir}`)

  /* ═══ 1. 安装（产品路径：普通 DSH 插件包 ⇒ 合成适配清单）═══ */
  const installed = await installCard(found.dir, cardsRoot, audit)
  ok(installed.ok, `安装成功${installed.ok ? '' : `（${installed.reason}）`}`)
  if (!installed.ok || !installed.dir) throw new Error(`安装失败：${installed.reason}`)

  const cardDir = installed.dir
  const cardId = installed.cardId
  console.log(`   落地：${cardDir}`)

  // 装载器就是这么读的：卡片目录的 package.json 里有没有 dshCard（含 adapter）
  const cardPkg = JSON.parse(readFileSync(join(cardDir, 'package.json'), 'utf8'))
  ok(Boolean(cardPkg.dshCard), '装出来的副本带 dshCard（装载器据此识别为卡片）')
  ok(Boolean(cardPkg.dshCard && cardPkg.dshCard.adapter), '带 adapter 段 ⇒ 走适配路径，而不是当普通卡片跑')
  ok(cardPkg.dshCard && cardPkg.dshCard.synthesized === true, '标了"清单是合成的"（可审计）')
  const capabilities =
    (cardPkg.dshCard && cardPkg.dshCard.adapter && cardPkg.dshCard.adapter.capabilities) || []
  console.log(
    `   合成清单：id=${cardPkg.dshCard && cardPkg.dshCard.id} entry=${cardPkg.dshCard && cardPkg.dshCard.entry} capabilities=[${capabilities.join(', ')}]`,
  )
  ok(capabilities.includes('tools'), '能力面含 tools（插件的工具才可能桥接出去）')

  /* ═══ 2. 垫片（否则插件在卡片目录里 import 不到 @deepseek-ai/*）═══ */
  const plan = planShims(cardDir, cardsRoot, found.dir)
  console.log(`   垫片：${describePlan(plan)}`)
  const unresolved = unresolvedOf(plan)
  ok(unresolved.length === 0, `依赖全部可解析（未解析：${unresolved.join('; ') || '无'}）`)
  const w = writeShims(plan, facadeBaseDir)
  ok(w.written > 0 || w.skipped > 0, `垫片已写出（写 ${w.written} / 跳 ${w.skipped} / 链 ${w.linked}）`)
  const dshTiers = plan.dsh.map((d) => `${d.pkg.split('/').pop()}=${d.tier}`).join(' ')
  console.log(`   @deepseek-ai 定档：${dshTiers}`)
  console.log(
    `   第三方：${plan.thirdParty.map((t) => `${t.pkg}=${t.resolvedDir ? '已链接' : '缺失'}`).join(' ') || '无'}`,
  )

  /* ═══ 3. 挂载：影子 ctx 调插件的真 apply ═══ */
  const mounted = await mountPlugin(
    {
      pluginId: cardId,
      pluginDir: cardDir,
      capabilities,
      shimRoot: cardsRoot,
      facadeBaseDir,
      depSourceDir: found.dir, // 第三方依赖从原安装位置解析
    },
    audit,
  )
  console.log(`   挂载：${mounted.describe()}`)
  ok(mounted.capture.tools.size > 0, `插件的真 apply 跑通并注册了工具（${mounted.capture.tools.size} 个）`)
  console.log(`   捕获工具：${[...mounted.capture.tools.keys()].join(', ')}`)

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
    cardId: cardId.replace(/[^A-Za-z0-9_]/g, '_'),
    instanceId: 'exp-1',
    connectionId: 'conn-1',
    scope: 'a', // 只给 A 端 —— 验证"按端生效"
  })
  ok(bridged.length === mounted.capture.tools.size, '每个捕获的工具都桥接了一条')
  ok([...registry.keys()].every((n) => n.startsWith('card_')), '注册名都带卡片前缀（防撞名）')

  const first = registry.get(bridged[0].bridgedName)
  const aOut = await first.execute({}, { agent: { id: 'sess-A' } })
  const bOut = await first.execute({}, { agent: { id: 'sess-B' } })
  console.log(`   A 端 → ${JSON.stringify(String(aOut).slice(0, 80))}`)
  console.log(`   B 端 → ${JSON.stringify(String(bOut).slice(0, 80))}`)
  ok(!/只对 A 端可见/.test(String(aOut)), 'A 端进入插件实现')
  ok(/只对 A 端可见/.test(String(bOut)), 'B 端被挡下（护栏③）')

  bridge.remove('exp-1')
  ok(registry.size === 0, '卸载后工具表清空（无幽灵）')
  mounted.dispose()
  ok(mounted.capture.tools.size === 0, 'dispose 清空捕获表')

  console.log('')
  console.log('   ── 这个真实插件的能力面 ──')
  console.log(`   插件 inject：${mounted.injects.join(', ') || '（空）'}`)
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
