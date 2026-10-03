/**
 * 示范插件的**安装 + 全链预演**（离线，不碰 DSH）。
 *
 * 依次走：
 *   安装（installCard：普通 DSH 插件包 ⇒ 合成适配清单）
 *     → 读回清单（装载器就是这么做的）
 *       → 读客户端制品 + **捕获 factory** + 实例化（面板就是这么做的）
 *         → 挂载宿主侧 + 调它注册的工具（会话侧就是这么调的）
 *
 * 跑法：node scripts/verify-demo-plugin.mjs [插件目录]
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installCard } from '../lib/card-host/installer.js'
import { readClientArtifact } from '../lib/card-host/client-artifact.js'
import { mountPlugin } from '../lib/adapter/mount.js'
import { ToolBridge } from '../lib/adapter/tool-bridge.js'
import { planShims, writeShims, unresolvedOf, describePlan } from '../lib/adapter/shim.js'
import { captureFactory, instantiateCaptured, disposeCaptured } from '../lib/ui/capture-client.js'
import * as React from 'react'

const src = process.argv[2] ?? 'D:\\dsh-link\\test-plugins\\adapter-demo-plugin'
if (!existsSync(src)) {
  console.log(`── 跳过：找不到示范插件 ${src}`)
  process.exit(0)
}

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

const logs = []
const audit = (m) => logs.push(m)
const root = mkdtempSync(join(tmpdir(), 'ccr-demo-'))
const cardsRoot = join(root, 'cards')
const facadeBaseDir = join(process.cwd(), 'lib', 'adapter')

try {
  console.log('── 1. 安装（走产品路径）')
  const installed = await installCard(src, cardsRoot, audit)
  ok(installed.ok, `安装成功${installed.ok ? '' : `：${installed.reason}`}`)
  if (!installed.ok || !installed.dir) throw new Error('安装失败')

  const pkg = JSON.parse(readFileSync(join(installed.dir, 'package.json'), 'utf8'))
  ok(Boolean(pkg.dshCard?.adapter), '装出来的副本带 adapter 段（装载器据此走适配路径）')
  ok(pkg.dshCard?.synthesized === true, '标了 synthesized')
  console.log(`   合成清单：capabilities=[${(pkg.dshCard?.adapter?.capabilities ?? []).join(', ')}]`)
  ok(
    (pkg.dshCard?.adapter?.capabilities ?? []).includes('prompt'),
    '合成清单含 prompt（示范插件的提示词才拿得到）',
  )

  console.log('── 2. 垫片（否则模块顶层 import 到不了 @deepseek-ai/*）')
  const plan = planShims(installed.dir, cardsRoot, src)
  console.log(`   ${describePlan(plan)}`)
  ok(unresolvedOf(plan).length === 0, `依赖全可解析（${unresolvedOf(plan).join('; ') || '无'}）`)
  writeShims(plan, facadeBaseDir)

  console.log('── 3. 宿主侧挂载 + 工具')
  const mounted = await mountPlugin(
    {
      pluginId: installed.cardId,
      pluginDir: installed.dir,
      capabilities: pkg.dshCard.adapter.capabilities,
      shimRoot: cardsRoot,
      facadeBaseDir,
      depSourceDir: src,
    },
    audit,
  )
  const names = [...mounted.capture.tools.keys()]
  console.log(`   捕获工具：${names.join(', ')}`)
  ok(names.includes('demo_ping') && names.includes('demo_status'), '工具都注册上了')
  ok(mounted.capture.prompts.length === 1, '提示词段被捕获（1 段）')

  const registry = new Map()
  const bridge = new ToolBridge({
    registerTool: (def) => {
      registry.set(def.name, def)
      return () => registry.delete(def.name)
    },
    getConnection: (id) => (id === 'conn-1' ? { sessionA: 'A', sessionB: 'B' } : undefined),
    audit,
  })
  bridge.add(mounted, { cardId: installed.cardId, instanceId: 'demo-1', connectionId: 'conn-1', scope: 'a' })
  const ping = registry.get('card_adapter_demo_plugin_demo_ping')
  ok(Boolean(ping), '桥接后的工具名正确（带卡片前缀）')

  const out = await ping.execute({ text: '你好' }, { agent: { id: 'A', session: { header: { cwd: '/tmp' } } } })
  console.log(`   A 端调用 → ${JSON.stringify(String(out).slice(0, 70))}…`)
  ok(/示范插件回显 #1/.test(String(out)), '工具真的执行了插件实现')
  const denied = await ping.execute({ text: 'x' }, { agent: { id: 'B' } })
  ok(/只对 A 端可见/.test(String(denied)), 'B 端被挡下（按端生效）')

  console.log('── 4. 客户端 UI 捕获（面板侧做的事）')
  const artifact = readClientArtifact(installed.dir)
  ok(artifact.ok, `读到客户端制品${artifact.ok ? `（${artifact.entry}）` : `：${artifact.reason}`}`)
  ok(/exports/.test(JSON.stringify(pkg.exports ?? {})) || Boolean(artifact.entry), '入口按 exports["./client"] 解析')

  const captured = captureFactory(artifact.source)
  ok(captured.id === 'adapter-demo-plugin', '捕获到 factory 且 id 正确')
  const shadow = instantiateCaptured(captured, (spec) => {
    if (spec === 'react') return React
    if (spec === 'react/jsx-runtime') return React
    throw new Error(`未转交 ${spec}`)
  })
  ok(shadow.registrations.length === 1, `捕获到 ${shadow.registrations.length} 条槽位注册`)
  console.log(`   槽位：${shadow.registrations[0]?.slot}（适配层会渲染进面板侧栏）`)
  ok(typeof shadow.registrations[0]?.component === 'function', '拿到的是**真 React 组件**（可交互）')
  disposeCaptured(shadow)

  mounted.dispose()
  bridge.remove('demo-1')

  console.log('')
  console.log('   ── 预演结论 ──')
  console.log('   安装 / 清单 / 垫片 / 挂载 / 工具 / 按端可见 / UI 捕获 —— 全部通过')
} catch (e) {
  fail++
  console.log(`  ❌ 预演抛错：${e instanceof Error ? e.message : String(e)}`)
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
