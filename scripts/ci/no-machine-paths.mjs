#!/usr/bin/env node
/**
 * 本机路径扫描（CI 硬门槛）—— 门面仓库里不该出现作者机器的绝对路径。
 *
 * 扫「被 git 跟踪」的文本文件，命中任一类即失败并打印 `文件:行:内容`：
 *   ① Windows 盘符绝对路径（反斜杠写法；另有一条更严的正斜杠补充检测器）
 *   ② 本机用户名（中文写法 + 拼音写法两种）
 *   ③ `file:///` + 盘符 的本机 URI
 *
 * 三条设计约束（都来自实测踩坑）：
 *   · 盘符正则不得匹配 URL。所以盘符后**必须**跟反斜杠：URL 跟的是两个斜杠，天然区分
 *     （https / http / xmlns="http://www.w3.org/2000/svg" 一律不命中）。
 *   · 盘符前必须是词边界。否则 sourcemap / JSON 里 `elementDesc:` 紧跟的 \r 转义
 *     （字母 + 冒号 + 反斜杠）会被误读成盘符路径 —— 这是实测到的唯一误报源。
 *   · 本脚本自己也是被跟踪的文本文件，所以下面所有敏感字面量（用户名、盘符、
 *     URI 前缀、白名单里的示例路径）一律拼接构造，源码里不出现连续字面量。
 *
 * 自校验不放这里内联：跑 `scripts/ci/selfcheck-localscan.mjs`（无参数、本地与 CI 同一份）。
 * 本脚本在扫描前会先把它当子进程跑一遍 —— 扫描器坏掉时不允许报绿。
 *
 * 用法：node scripts/ci/no-machine-paths.mjs      （在仓库根目录运行）
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SELF = fileURLToPath(import.meta.url)
const HERE = dirname(SELF)

// ── 敏感字面量：全部拼接构造，避免扫描器命中自己 ────────────────────────────
const DRIVE = 'D' + ':' // 白名单里那几条示意路径用的盘符
const BS2 = '\\' + '\\' // 双反斜杠（两个字符）：照抄预览线 localscan.sh 里 shell 正则的原文写法
const USER_CN = '花' + '火'
const USER_PY = 'hua' + 'huo'
const URI_PREFIX = 'file' + ':' + '///'

// ── 检测器 ─────────────────────────────────────────────────────────────────
export const DETECTORS = [
  {
    id: 'win-abs-backslash',
    why: 'Windows 盘符绝对路径',
    // 盘符后必须紧跟反斜杠：URL 后面是 `//`，所以 URL 永远不命中。
    // 盘符前要求边界：挡掉 sourcemap 里 `elementDesc:` + \r 那种「字母:反斜杠」的 JSON 转义。
    re: /(^|[^A-Za-z0-9+.-])([A-Za-z]:\\[^\s'"`<>|*?]*)/g,
    pick: (m) => m[2],
  },
  {
    id: 'win-abs-forward-slash',
    why: 'Windows 盘符绝对路径（正斜杠写法）',
    // 更严的补充检测器，覆盖盘符 + 正斜杠的写法（file URI 后面那种）。
    // 三向收紧，确保不会误报 URL/协议头：① 盘符后的下一个字符不能再是斜杠（协议头的双斜杠被排除）；
    // ② 盘符前要求边界；③ 首段路径至少 2 个字符。
    re: /(^|[^A-Za-z0-9+.-])([A-Za-z]:\/(?![\/])[A-Za-z0-9_.-]{2,}(?:\/[A-Za-z0-9_.-]+)*)/g,
    pick: (m) => m[2],
  },
  {
    id: 'local-user',
    why: '本机用户名',
    re: new RegExp(`${USER_CN}|${USER_PY}`, 'gi'),
    pick: (m) => m[0],
  },
  {
    id: 'local-uri',
    why: '本机 file:// URI',
    re: new RegExp(`${URI_PREFIX}[A-Za-z]:`, 'g'),
    pick: (m) => m[0],
  },
]

// ── 白名单：逐条写明理由 ────────────────────────────────────────────────────
// 公开文档在讲「Windows 本地路径」这种安装源格式时用的是一眼可辨的通用示例，不是任何真机路径。
// 豁免粒度 = 「这几个文件 + 这段精确文本」：同一段文本出现在别处、或换成别的路径，一律照失败。
// 不许用「扫不出来就放宽正则」的办法 —— 放宽模式会同时放过真泄漏。
// 注意 LICENSE 里的 `Copyright (c) 2026, Noob-stupid` 本来就不在命中范围内（那不是用户名）。
//
// ── 收口判据（2026-10-04 定；后来者不许放宽）────────────────────────────────
//   · **白名单只收精确字面量**：整条路径逐字符相等才豁免 —— 不收通配、不收正则；
//     （下面那条 `textPrefix` 是唯一的历史例外，且自带「必须带 <...> 占位符」的附加条件）
//   · **出现带用户名的真实路径一律不许进白名单** —— 那说明真泄漏已经发生，只能回去改代码；
//     加豁免等于把闸门关掉，等于让这道门槛失效。
export const ALLOWLIST = [
  {
    text: DRIVE + '\\my-cards\\monitor-card',
    files: ['README.md', 'README.zh.md', 'docs/card-protocol.md', 'lib/card-host/installer.js', 'src/card-host/installer.ts'],
    why: '「本地目录」安装源的通用示意路径（my-cards 是杜撰的示例目录）',
    inRepo: true,
  },
  {
    text: DRIVE + '\\downloads\\monitor-card-1.0.0.tgz',
    files: ['README.md', 'README.zh.md', 'docs/card-protocol.md', 'lib/card-host/installer.js', 'src/card-host/installer.ts'],
    why: '「本地 tgz」安装源的通用示意路径（downloads 是杜撰的示例目录）',
    inRepo: true,
  },
  {
    // 教学占位示例：尖括号里的用户名会被检测器的 `<`/`>` 终止符截断，捕获到的只有前缀，
    // 所以这条按「前缀 + 整行里必须有 <...> 占位」判定 —— 真机用户名（中文写法、拼音写法、
    // 任何实名）都不带尖括号，压根不匹配这条，不会被顺手放过。
    textPrefix: 'C' + ':' + '\\Users\\',
    requireLine: /<[^>]*>/,
    sample: 'C' + ':' + '\\Users\\<user>\\project',
    files: ['README.md', 'README.zh.md', 'docs/card-protocol.md', 'docs/adapter-api.md', 'docs/compatibility.md'],
    why: '预置：文档里「盘符 + Users + 尖括号占位用户名」那种教学示例 → 豁免（当前仓库没有，由自校验脚本断言这条规则生效）',
    inRepo: false,
  },

  // ── 预览线（≥1.0.58）合并进来的「泛化示例 / 测试夹具」6 处命中 ──────────────
  // 都不是本机真实路径：没有用户名、不指向任何真机上的位置。
  // 其中 4 处**正是**「Windows 绝对路径必须能被识别出来」这条断言本身 —— 删不得，
  // 删了等于把被测行为删掉，所以走白名单（该机制本就是为泛化示例准备的）。
  // 被扫描文件里的原文是「双反斜杠」写法（shell 正则里的转义），故用 BS2 拼接复现。
  {
    text: 'D' + ':' + BS2 + 'my-cards' + BS2 + 'monitor-card',
    files: ['scripts/localscan.sh'],
    why: '泛化示例（localscan.sh 第 30 行 ALLOW 正则第 1 段）：杜撰的示例目录，非本机真实路径',
    inRepo: true,
  },
  {
    text: 'D' + ':' + BS2 + 'downloads' + BS2 + 'monitor-card-1' + '\\.0\\.0\\.tgz',
    files: ['scripts/localscan.sh'],
    why: '泛化示例（同一行 ALLOW 正则第 2 段）：杜撰的示例 tgz 名，非本机真实路径',
    inRepo: true,
  },
  {
    text: 'C' + ':' + BS2 + 'Users' + BS2,
    files: ['scripts/localscan.sh'],
    why: '泛化前缀（同一行 ALLOW 正则第 3 段里被 <> 占位符截断的部分）：**无用户名**，非本机真实路径',
    inRepo: true,
  },
  {
    text: 'C' + ':' + '/Windows/system32/x',
    files: ['scripts/test-escape-entries.mjs'],
    why: '测试夹具（该行故意写一个绝对路径，断言它「能被认出」）：非本机真实路径',
    inRepo: true,
  },
  {
    text: 'C' + ':' + '/Windows/x',
    files: ['scripts/test-symlink-tar.mjs'],
    why: '测试夹具（同一行出现 2 次、精确文本一致，故一条覆盖两处；断言「Windows 绝对路径能被认出」）：非本机真实路径',
    inRepo: true,
  },
]

// ── 扫描 ───────────────────────────────────────────────────────────────────
// 防「扫到 0 个文件也算绿」：实测被跟踪文件 253 个（其中文本 2xx），低于这个下限说明
// git ls-files 没列出东西（删库 / 空克隆 / 跑错目录），宁可拦下来。
export const MIN_TRACKED_TEXT_FILES = 150

export function trackedTextFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const list = []
  for (const f of out.split('\0')) {
    if (!f) continue
    let buf
    try {
      buf = readFileSync(f)
    } catch {
      continue // 索引里有、工作区没有（子模块 / 已删）——跳过
    }
    if (buf.includes(0)) continue // 含 NUL 当二进制
    list.push(f)
  }
  return list
}

export function scanText(text) {
  const hits = []
  text.split(/\r\n|\r|\n/).forEach((line, i) => {
    for (const d of DETECTORS) {
      for (const m of line.matchAll(d.re)) {
        hits.push({
          line: i + 1,
          col: m.index + 1,
          detector: d.id,
          why: d.why,
          text: d.pick(m),
          lineText: line.trim(),
        })
      }
    }
  })
  return hits
}

export function isWaived(hit) {
  return ALLOWLIST.some((a) => {
    if (!a.files.includes(hit.file)) return false
    if (a.text) return a.text === hit.text // 精确文本
    if (a.textPrefix) return hit.text.startsWith(a.textPrefix) && a.requireLine.test(hit.lineText)
    return false
  })
}

// 「这条豁免规则是否被这次命中用上了」——用于报告失效的白名单条目
const isSameEntry = (a, w) => (a.text ? a.text === w.text : a.textPrefix ? w.text.startsWith(a.textPrefix) : false)

function scanFiles(files) {
  const violations = []
  const waived = []
  for (const file of files) {
    for (const hit of scanText(readFileSync(file, 'utf8'))) {
      hit.file = file
      ;(isWaived(hit) ? waived : violations).push(hit)
    }
  }
  return { violations, waived }
}

function runSelfCheck() {
  console.log('═══ 自校验：先跑 scripts/ci/selfcheck-localscan.mjs，证明扫描器是活的 ═══')
  try {
    const out = execFileSync(process.execPath, [join(HERE, 'selfcheck-localscan.mjs')], { encoding: 'utf8' })
    process.stdout.write(out)
    return true
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout)
    if (e.stderr) process.stderr.write(e.stderr)
    return false
  }
}

export function main() {
  if (!runSelfCheck()) {
    console.error('\n❌ 自校验未通过 —— 扫描器现在的结果不可信，直接失败（不允许假绿）。')
    process.exit(1)
  }

  console.log('\n═══ 扫描被 git 跟踪的文本文件 ═══')
  const files = trackedTextFiles()
  for (const must of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'README.md']) {
    if (!files.includes(must)) {
      console.error(`❌ 被跟踪文本文件里没有 ${must} —— git ls-files 结果不可信，失败`)
      process.exit(1)
    }
  }
  if (files.length < MIN_TRACKED_TEXT_FILES) {
    console.error(`❌ 只扫到 ${files.length} 个文件（下限 ${MIN_TRACKED_TEXT_FILES}）—— 空克隆/跑错目录会让扫描假绿，失败`)
    process.exit(1)
  }

  const { violations, waived } = scanFiles(files)
  for (const w of waived) console.log(`  · 豁免 ${w.file}:${w.line}: ${w.text}  —— ${w.why}`)
  for (const a of ALLOWLIST) {
    if (a.inRepo && !waived.some((w) => isSameEntry(a, w))) {
      console.log(`  ⚠️ 白名单条目在仓库里没有命中任何位置（文档改过？）：${a.text ?? a.sample} —— 建议清理，别留永久豁免口子`)
    }
  }

  if (violations.length > 0) {
    console.error(`\n❌ 本机路径扫描失败：${violations.length} 处命中`)
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}:${v.col}: ${v.text}`)
      console.error(`      类别：${v.why}（${v.detector}）`)
      console.error(`      该行：${v.lineText}`)
    }
    process.exit(1)
  }
  console.log(`\n✅ 本机路径扫描通过：扫了 ${files.length} 个被跟踪文本文件，违规 0 处，白名单豁免 ${waived.length} 处`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) main()
