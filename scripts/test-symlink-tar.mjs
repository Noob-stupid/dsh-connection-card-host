/**
 * 回归：**解压退出码 ≠ 0 但内容已落地 ⇒ 警告，不是失败**。
 *
 * ## 为什么需要专门一个测试
 *
 * Windows 自带的 `tar.exe` 是 **bsdtar/libarchive**（不是 GNU tar）：遇到**符号链接**
 * 会跳过该条目、继续解其余，最后**退出码非零**（警告级失败）。
 *
 * 若把"退出码 ≠ 0"当成失败 ⇒ **一个内容其实完整落地的仓库会装不上**，
 * 而错误还写着"解包失败"—— 归因指向完全错的方向（对端点明的场景）。
 *
 * ## 怎么造出这个场景（本机建不了真符号链接，需要管理员权限）
 *
 * 符号链接在 tar 格式里只是**一个 typeflag（'2'）**，所以**手工拼一个 tar** 即可 ——
 * 不依赖文件系统权限，也不依赖 tar 的版本差异：
 *
 *     package.json     typeflag '0'
 *     lib/index.js     typeflag '0'
 *     lib/link.js      typeflag '2'  → linkname: index.js     ← 关键条目
 *
 * 跑法：node scripts/test-symlink-tar.mjs
 */
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { installCard, uninstallCard } from '../lib/card-host/installer.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

/** 拼一个 tar 条目头（512 字节）。 */
function tarHeader(name, size, typeflag, linkname) {
  const b = Buffer.alloc(512)
  b.write(name, 0, 100, 'utf8')
  b.write('0000644\0', 100, 8)
  b.write('0000000\0', 108, 8)
  b.write('0000000\0', 116, 8)
  b.write(size.toString(8).padStart(11, '0') + '\0', 124, 12)
  b.write('00000000000\0', 136, 12)
  b.write('        ', 148, 8)
  b.write(typeflag, 156, 1)
  if (linkname) b.write(linkname, 157, 100, 'utf8')
  b.write('ustar\0', 257, 6)
  b.write('00', 263, 2)
  // 校验和：先把 checksum 字段当空格算，再写回去
  let sum = 0
  for (const x of b) sum += x
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return b
}

function tarFile(name, content) {
  const c = Buffer.from(content, 'utf8')
  const padded = Buffer.alloc(Math.ceil(c.length / 512) * 512)
  c.copy(padded)
  return Buffer.concat([tarHeader(name, c.length, '0', ''), padded])
}

console.log('── 造一个含符号链接条目的归档（不用管理员权限）')

const work = mkdtempSync(join(tmpdir(), 'ccr-symtar-'))
try {
  const tar = Buffer.concat([
    tarFile('package.json', JSON.stringify({ name: 'sym-demo', version: '1.0.0', main: 'lib/index.js', dsh: { bundle: {} } })),
    tarFile('lib/index.js', 'export function apply() {}'),
    tarHeader('lib/link.js', 0, '2', 'index.js'), // ← 符号链接条目
    Buffer.alloc(1024), // 归档结尾
  ])
  const tgz = join(work, 'sym.tgz')
  writeFileSync(tgz, gzipSync(tar))
  ok(statSync(tgz).size > 0, '归档已生成')

  console.log('── 安装：应当**成功且带警告**，而不是失败')

  const cardsRoot = join(work, 'cards')
  const r = await installCard(tgz, cardsRoot, () => {})

  ok(r.ok, '装上了（**不因 tar 的退出码非零而失败**）')
  ok(Boolean(r.warning), `带上了警告：${r.warning ?? '(没有警告 —— 那是漏报)'}`)
  ok(/退出码/.test(r.warning ?? ''), '警告里说明了是 tar 的退出码')

  if (r.ok && r.dir) {
    const lib = readdirSync(join(r.dir, 'lib'))
    ok(lib.includes('index.js'), '正常条目**确实落地了**（这才是不该报失败的原因）')
    ok(!lib.includes('link.js'), '符号链接条目被跳过（预期行为，Windows 上建不了链接）')
    uninstallCard(r.cardId, cardsRoot)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
