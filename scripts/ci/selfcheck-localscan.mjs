#!/usr/bin/env node
/**
 * 本机路径扫描的**自校验**（无参数；本地与 CI 跑的是同一份，不内联进 workflow）。
 *
 * 为什么不把自校验写进 workflow 的 shell 里：shell 会把样本里的反斜杠转义吃掉
 * （制表符、未知转义直接报错）→ 得到「命不中」的**假失败**。而会误报的自校验
 * 比没有自校验更糟：它会诱使人去放宽检测模式，顺手把真泄漏一起放过去。
 *
 * 断言两侧都覆盖：
 *   A. 该命中的必须命中（盘符反斜杠 / 盘符正斜杠 / 用户名 / file URI）
 *   B. 不该误伤的必须不命中（URL、SVG xmlns、协议头、文档示意路径、LICENSE 版权行、
 *      相对路径、sourcemap 里那串反斜杠转义）
 *   C. 扫描器与自校验脚本**自身**都必须是 0 命中（否则脚本自己就成了泄漏源）
 * 任一条不满足 → 退出 1。所有样本一律拼接构造，避免样本字面量把自己扫出来。
 *
 * 用法：node scripts/ci/selfcheck-localscan.mjs      （在仓库根目录运行）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ALLOWLIST, DETECTORS, SELF, isWaived, scanText } from './no-machine-paths.mjs'

const SELFCHECK = fileURLToPath(import.meta.url)
const CN = '花' + '火'
const PY = 'hua' + 'huo'
const URI = 'file' + ':' + '///'

let pass = 0
let fail = 0
const ok = (cond, label, extra) => {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${extra ? `  → ${extra}` : ''}`)
  }
}

// 「违规」的统一口径：检测器命中 **且** 不在白名单里
const violationsOf = (text, file = 'docs/probe.md') => scanText(text).filter((h) => !isWaived({ ...h, file }))

console.log('═══ A. 该命中的必须命中 ═══')
const positives = [
  { why: '盘符 + 反斜杠（本机克隆目录那种）', detector: 'win-abs-backslash', text: '本地克隆在 ' + 'D' + ':' + '\\dsh-link\\_stable-docs 下面' },
  { why: '盘符 + 反斜杠（用户目录那种）', detector: 'win-abs-backslash', text: 'profile 在 ' + 'C' + ':' + '\\Users\\someone\\AppData\\Roaming' },
  { why: '盘符 + 正斜杠', detector: 'win-abs-forward-slash', text: 'clone to ' + 'E' + ':' + '/work/repo' },
  { why: '本机用户名（中文写法 + 拼音写法）', detector: 'local-user', text: `owner ${CN} (aka ${PY})` },
  { why: 'file URI + 盘符', detector: 'local-uri', text: 'open ' + URI + 'D' + ':' + '/x/y' },
  { why: '真实用户名目录（不许被「Users 占位示例」那条白名单顺手放过）', detector: 'win-abs-backslash', text: 'profile 在 ' + 'C' + ':' + '\\Users\\realname\\AppData 下面' },
]
for (const p of positives) {
  const got = violationsOf(p.text)
  ok(got.some((h) => h.detector === p.detector), `命中：${p.why} → ${p.detector}`, JSON.stringify(got.map((h) => h.text)))
}
const covered = new Set(positives.flatMap((p) => scanText(p.text).map((h) => h.detector)))
const uncovered = DETECTORS.filter((d) => !covered.has(d.id)).map((d) => d.id)
ok(uncovered.length === 0, `每个检测器都有正例覆盖（${DETECTORS.length} 个：${DETECTORS.map((d) => d.id).join(' / ')}）`, `未覆盖 ${JSON.stringify(uncovered)}`)

console.log('\n═══ B. 不该误伤的必须不命中 ═══')
const negatives = [
  { why: 'https 仓库 URL', text: 'git remote ' + 'https' + ':' + '//github.com/Noob-stupid/dsh-connection-card-host.git' },
  { why: 'SVG xmlns 声明', text: 'xmlns="http' + ':' + '//www.w3.org/2000/svg"' },
  { why: '本机 HTTP 端点（文档里的 curl）', text: 'curl -X POST http' + ':' + '//127.0.0.1:19387/connection-card/health' },
  { why: 'Release tgz 下载 URL', text: 'add ' + 'https' + ':' + '//github.com/Noob-stupid/x/releases/download/v1.0.17/x-1.0.17.tgz' },
  { why: 'LICENSE 版权行（Noob-stupid 是允许的）', text: 'Copyright (c) 2026, Noob-stupid' },
  { why: '相对路径 import', text: "import { decideFilter } from './lib/core/tool-scoping.js'" },
  { why: 'sourcemap 里那串反斜杠转义（字母+冒号+反斜杠的假象）', text: 'elementDesc:' + '\\r\\n  next' },
]
for (const n of negatives) {
  const got = violationsOf(n.text)
  ok(got.length === 0, `不误伤：${n.why}`, JSON.stringify(got.map((h) => h.text)))
}
for (const a of ALLOWLIST) {
  const got = violationsOf(a.sample ?? a.text, a.files[0])
  ok(got.length === 0, `示意路径被白名单豁免（不算违规）：${a.text ?? a.sample}`, JSON.stringify(got.map((h) => h.text)))
}

console.log('\n═══ C. 脚本自身不得命中 ═══')
for (const [label, file] of [
  ['scripts/ci/no-machine-paths.mjs', SELF],
  ['scripts/ci/selfcheck-localscan.mjs', SELFCHECK],
]) {
  const got = scanText(readFileSync(file, 'utf8'))
  ok(got.length === 0, `扫自己（${label}）= 0 命中`, JSON.stringify(got.map((h) => `${h.line}:${h.text}`)))
}

console.log(`\n═══ 自校验结果：${pass} 通过 / ${fail} 失败 ═══`)
if (fail > 0) {
  console.error('❌ 自校验失败 —— 扫描器的结论不可信（不许在这种情况下报绿）。')
  process.exit(1)
}
