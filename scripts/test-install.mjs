/**
 * 安装路径的离线验证 —— **普通 DSH 插件包也能装**。
 *
 * 用户原话点破了这件事：
 *   > 肯定是要可以装普通 dsh 插件包啊，因为你经常搜到的会话能力相关的就是普通插件包啊
 *
 * 所以这里钉住三件事：
 *   ① 卡片包（自带 dshCard）照旧
 *   ② 普通 DSH 插件包被识别、并**合成适配清单**（写进副本，不碰来源）
 *   ③ 两者都不是的包要**说清为什么**拒（而不是含糊地"不是卡片包"）
 *
 * 跑法：node scripts/test-install.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import { checkPackage, ensureAdapterManifest, looksLikeDshPlugin } from '../lib/card-host/package-check.js'
import { installCard, uninstallCard, toCodeloadUrl, downloadChannelsFor, orderChannels, readDownloadMemo, rememberDownloadChannel, classifyDownloadFailure, probeChannel } from '../lib/card-host/installer.js'

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

const root = mkdtempSync(join(tmpdir(), 'ccr-install-test-'))
const logs = []
const audit = (m) => logs.push(m)

/** 造一个包目录。 */
function makePkg(name, { pkgExtra = {}, files = {} } = {}) {
  const dir = join(root, 'sources', name)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...pkgExtra }, null, 2))
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, text)
  }
  return dir
}

try {
  /* ═══════════ 1. 识别：三种形态 ═══════════ */

  console.log('── 1. checkPackage 的三种形态')

  // ① 卡片包（自带 dshCard）
  {
    const dir = makePkg('plain-card', {
      pkgExtra: { main: 'index.js', dshCard: { id: 'plain-card', name: '普通卡片', entry: 'index.js' } },
      files: { 'index.js': 'export function apply() {}\n' },
    })
    const r = checkPackage(dir)
    ok(r.ok, '卡片包：接受')
    eq(r.kind, 'card', '卡片包：kind=card')
    eq(r.name, '普通卡片', '卡片包：用清单里的显示名')
  }

  // ② 普通 DSH 插件（dsh 字段）
  {
    const dir = makePkg('dsh-plugin-a', {
      pkgExtra: { main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      files: { 'lib/index.js': 'export function apply() {}\n' },
    })
    const r = checkPackage(dir)
    ok(r.ok, 'DSH 插件（有 dsh 字段）：接受')
    eq(r.kind, 'dsh-plugin', 'DSH 插件：kind=dsh-plugin')
    eq(r.id, 'dsh-plugin-a', 'DSH 插件：id 取包名')
  }

  // ③ 普通 DSH 插件（靠 peerDependencies 认出来）
  {
    const dir = makePkg('dsh-plugin-b', {
      pkgExtra: { main: 'lib/index.js', peerDependencies: { '@deepseek-ai/cordis': '>=4 <5' } },
      files: { 'lib/index.js': 'export function apply() {}\n' },
    })
    eq(checkPackage(dir).kind, 'dsh-plugin', 'DSH 插件（peerDependencies 有 @deepseek-ai/*）：认得出来')
  }

  // ④ 普通 DSH 插件（靠入口 import 认出来 —— 最实在的一条判据）
  {
    const dir = makePkg('dsh-plugin-c', {
      pkgExtra: { main: 'lib/index.js' },
      files: {
        'lib/index.js': "import { defineTool } from '@deepseek-ai/dsh-tools'\nexport function apply() { void defineTool }\n",
      },
    })
    const r = checkPackage(dir)
    eq(r.kind, 'dsh-plugin', 'DSH 插件（入口 import 了 @deepseek-ai/*）：认得出来')
  }

  // ⑤ 都不是
  {
    const dir = makePkg('random-thing', {
      pkgExtra: { main: 'index.js' },
      files: { 'index.js': 'export const x = 1\n' },
    })
    const r = checkPackage(dir)
    ok(!r.ok, '既不是卡片包也不是 DSH 插件：拒绝')
    ok(/dshCard/.test(r.reason) && /DSH 插件包/.test(r.reason), '拒绝理由同时说明两种可接受形态')
  }

  // ⑥ 没有入口
  {
    const dir = makePkg('no-entry', { pkgExtra: { dsh: { bundle: {} } } })
    const r = checkPackage(dir)
    ok(!r.ok && /入口/.test(r.reason), '找不到入口：拒绝并说明')
  }

  // ⑦ 坏 JSON / 没有 package.json
  {
    const dir = join(root, 'sources', 'bad-json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{ 这不是 JSON')
    ok(!checkPackage(dir).ok, 'package.json 非法：拒绝')
    const dir2 = join(root, 'sources', 'empty')
    mkdirSync(dir2, { recursive: true })
    ok(!checkPackage(dir2).ok, '没有 package.json：拒绝')
  }

  ok(
    looksLikeDshPlugin(root, { dsh: {} }, 'x.js') === true,
    'looksLikeDshPlugin：dsh 字段即判定',
  )

  /* ═══════════ 2. 合成适配清单 ═══════════ */

  console.log('── 2. 合成适配清单（写进副本）')

  {
    const src = makePkg('synth-me', {
      pkgExtra: { main: 'lib/index.js', dsh: { bundle: {} } },
      files: { 'lib/index.js': 'export function apply() {}\n' },
    })
    const copy = join(root, 'copies', 'synth-me')
    mkdirSync(join(copy, 'lib'), { recursive: true })
    for (const f of ['package.json', 'lib/index.js']) {
      writeFileSync(join(copy, f), readFileSync(join(src, f)))
    }

    const r = ensureAdapterManifest(copy, { id: 'synth-me', name: 'synth-me', entry: 'lib/index.js' })
    ok(r.patched, '合成成功')

    const patched = JSON.parse(readFileSync(join(copy, 'package.json'), 'utf8'))
    ok(patched.dshCard, '副本里有了 dshCard')
    /**
     * ⚠️ 默认能力面是**已实现的全部**（tools/effect/llm/prompt），不是当初的最小集。
     * 改这个断言时想清楚：给少了会让"其实只想用 prompt 的插件"被假拒绝；
     * 给多了**不会放宽边界**（影子 ctx 只交申报过的服务）。
     */
    eq(
      patched.dshCard.adapter.capabilities,
      ['tools', 'effect', 'llm', 'prompt'],
      '能力面默认 = 已实现的全部（tools/effect/llm/prompt）',
    )
    ok(patched.dshCard.synthesized === true, '标了 synthesized（便于排查与面板区分）')

    const origin = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
    ok(!origin.dshCard, '**来源包一个字节没改**（只动副本）')

    const again = ensureAdapterManifest(copy, { id: 'synth-me', name: 'x', entry: 'lib/index.js' })
    ok(!again.patched, '已是适配卡 ⇒ 幂等不重写')

    const cardPkg = join(root, 'copies', 'already-card')
    mkdirSync(cardPkg, { recursive: true })
    writeFileSync(
      join(cardPkg, 'package.json'),
      JSON.stringify({ name: 'c', dshCard: { id: 'c', name: 'C', entry: 'i.js' } }),
    )
    ok(!ensureAdapterManifest(cardPkg, { id: 'c', name: 'C', entry: 'i.js' }).patched, '自带 dshCard 的包不动它')
  }

  /* ═══════════ 3. 端到端：装普通 DSH 插件 ═══════════ */

  console.log('── 3. 端到端安装')

  const cardsRoot = join(root, 'cards')
  const realPlugin = makePkg('my-capability-plugin', {
    pkgExtra: {
      main: 'lib/index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      peerDependencies: { '@deepseek-ai/cordis': '>=4.0.1 <4.1.0' },
    },
    files: {
      'lib/index.js': "import { defineTool } from '@deepseek-ai/dsh-tools'\nexport const inject = ['tools']\nexport function apply(ctx) { void defineTool; void ctx }\n",
    },
  })

  const r1 = await installCard(realPlugin, cardsRoot, audit)
  ok(r1.ok, `普通 DSH 插件包安装成功（${r1.reason ?? 'ok'}）`)
  ok(/合成适配清单/.test(logs.join('\n')), '安装日志说明了"已合成适配清单"')

  if (r1.ok && r1.dir) {
    const installed = JSON.parse(readFileSync(join(r1.dir, 'package.json'), 'utf8'))
    ok(installed.dshCard?.adapter?.capabilities?.includes('tools'), '**装出来的副本**带适配清单（装载器据此走适配路径）')
    ok(installed.dshCard.id === 'my-capability-plugin', '合成清单的 id 正确')
    eq(
      readdirSync(cardsRoot).filter((n) => n.startsWith('my-capability-plugin')).length >= 2,
      true,
      '落地了版本目录 + 指针',
    )
  }

  // 幂等：同一来源再装一次 ⇒ 跳过拷贝
  const before = logs.length
  const r2 = await installCard(realPlugin, cardsRoot, audit)
  ok(r2.ok, '重复安装仍成功')
  ok(logs.slice(before).some((l) => /跳过写入/.test(l)), '重复安装走"跳过写入"（幂等）')

  // 普通卡片包照旧
  const cardSrc = makePkg('my-card', {
    pkgExtra: { main: 'index.js', dshCard: { id: 'my-card', name: '我的卡片', entry: 'index.js' } },
    files: { 'index.js': 'export function apply() {}\n' },
  })
  const r3 = await installCard(cardSrc, cardsRoot, audit)
  ok(r3.ok, '卡片包仍能装')
  if (r3.ok && r3.dir) {
    const p = JSON.parse(readFileSync(join(r3.dir, 'package.json'), 'utf8'))
    ok(!p.dshCard.synthesized, '卡片包**不会**被标记成合成的')
  }

  // 卸载
  const u = uninstallCard('my-capability-plugin', cardsRoot)
  ok(u.ok, '卸载成功')
  ok(
    !existsSync(join(cardsRoot, 'my-capability-plugin.current')),
    '卸载后指针没了（卡片从列表消失）',
  )

  /* ═══════════ 4. GitHub 链接：规范化到 codeload + 通道表 ═══════════ */

  console.log('── 4. GitHub 链接处理（codeload 直取）')

  eq(
    toCodeloadUrl('https://github.com/o/r/archive/refs/heads/main.tar.gz'),
    'https://codeload.github.com/o/r/tar.gz/refs/heads/main',
    'archive/heads → codeload',
  )
  eq(
    toCodeloadUrl('https://github.com/o/r/archive/refs/tags/v1.2.3.tar.gz'),
    'https://codeload.github.com/o/r/tar.gz/refs/tags/v1.2.3',
    'archive/tags → codeload（可按 tag 钉版本）',
  )
  eq(toCodeloadUrl('https://example.com/x.tgz'), undefined, '非 GitHub 链接不转换')
  eq(toCodeloadUrl('https://github.com/o/r'), undefined, '不是 archive 链接就不猜')

  {
    const chs = downloadChannelsFor('https://github.com/o/r/archive/refs/heads/main.tar.gz')
    eq(chs.map((c) => c.name), ['codeload', 'ghproxy', 'github-direct'], 'GitHub：codeload 优先，镜像兜底，最后直连')
    ok(chs[0].url.startsWith('https://codeload.github.com/'), '首选通道是 codeload（无重定向、无 API 配额）')
    ok(chs[1].url.startsWith('https://ghproxy.net/https://github.com/'), '镜像通道形态正确（可失败后继续）')

    const plain = downloadChannelsFor('https://registry.npmjs.org/x/-/x-1.0.0.tgz')
    eq(plain.map((c) => c.name), ['direct'], '非 GitHub：只有直连一条通道')
  }

  /* ═══════════ 5. 通道记忆：按 channelId（不是 URL 模板）+ 纯函数排序 ═══════════ */

  console.log('── 5. 下载通道记忆（对端点明：键必须是 channelId）')

  {
    const chs = downloadChannelsFor('https://github.com/o/r/archive/refs/heads/main.tar.gz')

    eq(orderChannels(chs, '').map((c) => c.id), ['codeload', 'ghproxy', 'github-direct'], '没有记忆 ⇒ 原顺序')
    eq(
      orderChannels(chs, 'ghproxy').map((c) => c.id),
      ['ghproxy', 'codeload', 'github-direct'],
      '命中记忆 ⇒ 挪到最前，其余顺序不变',
    )
    eq(
      orderChannels(chs, '不存在的通道').map((c) => c.id),
      ['codeload', 'ghproxy', 'github-direct'],
      '记忆里的通道已不在表里 ⇒ 不动（镜像会死，不能因此崩）',
    )

    /**
     * ⚠️ 这条是**对端点名我必须改的那处**：他们的 URL 模板与仓库无关、可复用；
     * 我们的 archive URL 带 owner/repo/branch —— 若按模板记忆，会"每仓库一条、永远记不住"。
     * 所以记忆里只存 **channelId**。
     */
    const memoFile = join(dirname(cardsRoot), 'download-memo.json')
    ok(!existsSync(memoFile), '一开始没有记忆文件')
    eq(readDownloadMemo(cardsRoot), '', '没有记忆 ⇒ 返回空串')
    rememberDownloadChannel(cardsRoot, 'codeload')
    eq(readDownloadMemo(cardsRoot), 'codeload', '记住的是 channelId（与具体仓库无关）')
    const memoRaw = JSON.parse(readFileSync(memoFile, 'utf8'))
    ok(!/github\.com|codeload\.github/.test(JSON.stringify(memoRaw)), '记忆里**不含 URL**（否则换个仓库就失效）')

    // 读盘坏了也要能继续（记忆只是优化）
    writeFileSync(memoFile, '{ 这不是 JSON', 'utf8')
    eq(readDownloadMemo(cardsRoot), '', '记忆文件损坏 ⇒ 当没有（绝不抛）')
    unlinkSync(memoFile)
  }

  /* ═══════════ 6. 失败归因：证书/代理拦截 vs 网络不可达 ═══════════ */

  console.log('── 6. 失败归因（可执行的下一步）')

  {
    const cert = classifyDownloadFailure('curl: (60) SSL certificate problem: UNABLE_TO_VERIFY_LEAF_SIGNATURE')
    eq(cert.kind, 'intercepted', '证书类 ⇒ intercepted')
    ok(/加速器|代理/.test(cert.note), '归因里指出"本机有加速器/代理"并给出下一步')

    const revoke = classifyDownloadFailure('schannel: CRYPT_E_NO_REVOCATION_CHECK')
    eq(revoke.kind, 'intercepted', '吊销检查失败也归到 intercepted（今天真实撞到的就是它）')

    const net = classifyDownloadFailure('getaddrinfo ENOTFOUND codeload.github.com')
    eq(net.kind, 'unreachable', '域名解析不了 ⇒ unreachable')
    ok(/网络不可达/.test(net.note), '文案区分开了')
  }

  /* ═══════════ 7. 探活：判死要快（不能自己变成白等） ═══════════ */

  console.log('── 7. 通道探活')

  {
    /**
     * 连不上的地址 ⇒ 判死。**这条不需要外网**：连本机空端口会立刻被拒。
     * 顺带卡耗时 —— 探活是"提前判死"用的，**不能自己变成白等**。
     */
    const t0 = Date.now()
    const dead = probeChannel('http://127.0.0.1:1/nothing-here.tar.gz')
    const cost = Date.now() - t0
    ok(!dead.alive, '连不上 ⇒ 判死')
    ok(cost < 9000, `判死要快（实测 ${cost}ms；上限 4s + 余量）`)
    ok(/代理|不可达|拦截/.test(dead.note), '归因文案可读（说清是网络问题还是本地拦截）')
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
