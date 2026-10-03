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
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { installCard, uninstallCard, findEscapingEntry } from '../lib/card-host/installer.js'

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

  /* ═══════════ 容忍类矩阵：换 typeflag/条目，判据应当同样是"警告不失败" ═══════════ */

  console.log('── 容忍类矩阵（外部工具的行为差异 ⇒ 都不该被当成我们的失败）')

  /**
   * ⚠️ 断言写成**行为级**（"条目不落地时仍算成功 + warning 里有它"），
   * **不要**断言"stderr 里出现某句英文" —— 文本是巧合级（换 tar 版本/语言就变），
   * "目录非空 + 该条被跳过"才是契约级。
   */
  const toleranceEntries = [
    ['硬链接（typeflag 1）', () => tarHeader('lib/hard.js', 0, '1', 'index.js')],
    ['目录条目（typeflag 5）', () => tarHeader('lib/sub/', 0, '5', '')],
    ['FIFO（typeflag 6，Windows 建不了）', () => tarHeader('lib/pipe', 0, '6', '')],
    ['字符设备（typeflag 3，Windows 建不了）', () => tarHeader('lib/tty', 0, '3', '')],
    ['超长路径（>260）', () => tarFile(`lib/${'x'.repeat(300)}.js`, 'x')],
  ]

  for (const [label, make] of toleranceEntries) {
    const t = Buffer.concat([
      tarFile('package.json', JSON.stringify({ name: 'mix-demo', version: '1.0.0', main: 'lib/index.js', dsh: { bundle: {} } })),
      tarFile('lib/index.js', 'export function apply() {}'),
      make(),
      Buffer.alloc(1024),
    ])
    const p = join(work, `mix-${label.slice(0, 4)}.tgz`)
    writeFileSync(p, gzipSync(t))
    const root = join(work, `cards-${label.slice(0, 4)}`)
    const res = await installCard(p, root, () => {})
    ok(res.ok, `${label} ⇒ 仍然装上（容忍类差异不该让安装失败）`)
    if (res.ok) {
      ok(
        readdirSync(join(res.dir, 'lib')).includes('index.js'),
        `${label} ⇒ 正常条目落地了`,
      )
      uninstallCard(res.cardId, root)
    }
  }

  /* ═══════════ 逃逸类：**必须拒绝**（与容忍类是两个判据） ═══════════ */

  console.log('── 逃逸类（zip-slip）⇒ **必须拒绝**，不是警告')

  /**
   * 判据边界（对端点明）：
   *   · 外部工具**容忍类**差异 ⇒ 降级警告（上面那些）
   *   · **逃逸类**条目 ⇒ **必须拦** —— 即使 tar 自己肯解，也不该落到我们目录外
   *
   * 纯函数先钉一遍（不依赖 tar 的行为）：
   */
  ok(findEscapingEntry(['package.json', '../outside.txt']) === '../outside.txt', '相对逃逸（..）能被认出')
  ok(findEscapingEntry(['/etc/passwd']) === '/etc/passwd', '绝对路径能被认出')
  ok(findEscapingEntry(['C:/Windows/x']) === 'C:/Windows/x', 'Windows 绝对路径能被认出')
  ok(findEscapingEntry(['a/../../b']) === 'a/../../b', '中间的 .. 也能认出')
  ok(findEscapingEntry(['pkg/lib/a.js', 'pkg/package.json']) === undefined, '正常条目**不误报**')

  // 再走一遍真实安装路径：必须被拒，且**目标目录外一个字节都没写**
  const evilTar = Buffer.concat([
    tarFile('package.json', JSON.stringify({ name: 'evil-demo', version: '1.0.0', dsh: { bundle: {} } })),
    tarFile('../outside.txt', 'I escaped'),
    Buffer.alloc(1024),
  ])
  const evilPath = join(work, 'evil.tgz')
  writeFileSync(evilPath, gzipSync(evilTar))

  /**
   * ⚠️ **哨兵探针**（对端建议，比"文件不存在"更强）：
   * 先在目标目录**同级**放一个内容已知的文件，事后断言**内容未变** ——
   * 这样连"写了又删"也能抓到（只断言"不存在"是抓不到的）。
   */
  const sentinel = join(work, 'outside.txt')
  writeFileSync(sentinel, 'SENTINEL-UNTOUCHED')

  const evilRoot = join(work, 'cards-evil')
  const evilRes = await installCard(evilPath, evilRoot, () => {})

  ok(!evilRes.ok, '含逃逸条目的包 ⇒ **拒绝安装**')
  ok(/拒绝解压|目标目录之外/.test(evilRes.reason ?? ''), '拒绝理由说清是"会写到目标目录之外"')
  ok(
    readFileSync(sentinel, 'utf8') === 'SENTINEL-UNTOUCHED',
    '**哨兵内容未变**（比"文件不存在"更强：连"写了又删"都能抓到）',
  )

  /* ═══════════ 链接目标逃逸：条目名正常，**目标**指向目录外 ═══════════ */

  console.log('── 链接目标逃逸（只看条目名是**抓不到**的）')

  const linkEvil = Buffer.concat([
    tarFile('package.json', JSON.stringify({ name: 'linkevil', version: '1.0.0', dsh: { bundle: {} } })),
    tarHeader('lib/leak.js', 0, '2', '../../../../etc/passwd'), // ← 名字正常，目标逃逸
    Buffer.alloc(1024),
  ])
  const linkPath = join(work, 'linkevil.tgz')
  writeFileSync(linkPath, gzipSync(linkEvil))
  const linkRes = await installCard(linkPath, join(work, 'cards-link'), () => {})

  ok(!linkRes.ok, '链接目标指向目录外 ⇒ **拒绝安装**')
  ok(/拒绝|目标目录之外/.test(linkRes.reason ?? ''), '拒绝理由说清原因（靠"看链接目标"才抓得到）')
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
