#!/usr/bin/env node
/**
 * 防假绿门槛：`npm test` 测的是 lib/（随仓库提交的构建产物），**不是 src/**。
 *
 * 于是有个真实的坏情况：新增了 src/xxx.ts、忘了构建 → lib/ 里没有它 →
 * CI 照样绿。这里断言每个 src/**.ts|tsx（不含 .d.ts）都有对应的 lib/**.js。
 *
 * 局限（如实写明，别假装它更强）：这只抓「新增源文件却没构建」，
 * **抓不住「改了内容没重新构建」**（完整重建要 DSH checkout，公开 runner 拿不到）。
 * 后一半靠提交纪律：lib/ 必须与 src/ 在同一次提交里一起进。
 *
 * 用法：node scripts/ci/check-src-lib-parity.mjs      （在仓库根目录运行）
 */
import { execFileSync } from 'node:child_process'

const die = (msg) => {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0')
  .filter(Boolean)
const toLib = (f) => 'lib/' + f.slice('src/'.length).replace(/\.tsx?$/, '.js')

const src = files.filter((f) => f.startsWith('src/') && /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'))
const lib = new Set(files.filter((f) => f.startsWith('lib/') && f.endsWith('.js')))

if (src.length === 0) die('一个 src 源文件都没扫到 —— git ls-files 结果不可信')
if (!lib.has('lib/index.js')) die('lib/index.js 不存在 —— 构建产物缺失或 git ls-files 结果不可信')

const missing = src.filter((f) => !lib.has(toLib(f)))
if (missing.length > 0) {
  console.error(`❌ ${missing.length} 个源文件没有对应的构建产物（改了 src 忘了构建？）：`)
  for (const f of missing) console.error(`  ${f}  →  缺 ${toLib(f)}`)
  process.exit(1)
}
console.log(`✅ 构建产物与源码对齐：${src.length} 个 src 源文件全部有对应 lib/*.js（lib 共 ${lib.size} 个 .js）`)
console.log('   局限：只证明「没有新增未构建的源文件」；「改了内容没重建」靠 lib/ 与 src/ 同一次提交的纪律。')
