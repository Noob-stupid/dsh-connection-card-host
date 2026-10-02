#!/usr/bin/env node
// cordis.patch.yml 结构门（零依赖、三十行内）：这份补丁决定插件装不装得上，
// 改坏了要在这里挡住，而不是等用户装包时才报错。不做完整 YAML 解析——只断言形状与关键字段。
import { readFileSync } from 'node:fs'

const die = (m) => {
  console.error(`❌ cordis.patch.yml: ${m}`)
  process.exit(1)
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const lines = readFileSync('cordis.patch.yml', 'utf8')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
const indent = (l) => l.length - l.trimStart().length

if (lines.some((l) => l.includes('\t'))) die('YAML 缩进不允许 tab')
if (!/^- insert:\s*$/.test(lines[0] ?? '')) die(`首行应为顶层 "- insert:"，实得 ${JSON.stringify(lines[0])}`)
const body = lines.slice(1)
const items = body.filter((l) => /^\s*-\s/.test(l))
if (items.length !== 1) die(`insert 下应恰好 1 个条目，实得 ${items.length}`)
if (indent(items[0]) <= indent(lines[0])) die('条目缩进应比 "- insert:" 更深')
if (!/^-\s+\w[\w-]*:\s*\S/.test(items[0].trim())) die(`条目首行不是「- 键: 值」：${JSON.stringify(items[0])}`)
if (!/^-\s+id:\s*connection-card-host\s*$/.test(items[0].trim())) die(`缺少 id: connection-card-host（这个名字不许改，实得 ${JSON.stringify(items[0].trim())}）`)
const nameLine = body.find((l) => /^name:\s*\S/.test(l.trim()))
const name = nameLine?.trim().replace(/^name:\s*/, '').replace(/^['"]|['"]$/g, '')
if (name !== pkg.name) die(`name 应与 package.json 的 name 一致（${pkg.name}），实得 ${JSON.stringify(name)}`)
if (!pkg.dsh?.client) die('package.json 缺 dsh.client —— 客户端插件装配信息丢了')
for (const l of body) if (!/^\s*-\s+\w[\w-]*:\s*\S|^\s+\w[\w-]*:\s*\S/.test(l)) die(`无法识别的行：${JSON.stringify(l)}`)
console.log(`✅ cordis.patch.yml：insert → id=connection-card-host（不许改）, name=${name} == package.json, dsh.client 存在`)
