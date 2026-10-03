/**
 * 诊断（二）：为什么 rmSync 对这几个条目静默无效。
 * 检查：路径上有没有 junction/符号链接、文件属性、以及各种删除 API 的实际行为。
 */
import {
  existsSync,
  lstatSync,
  statSync,
  rmSync,
  unlinkSync,
  rmdirSync,
  realpathSync,
} from 'node:fs'
import { join } from 'node:path'

const cardsRoot = 'C:\\Users\\花火\\.dsh\\connection-cards\\cards'
const file = join(cardsRoot, 'hello-card.current')
const dir = join(cardsRoot, 'hello-card@1.0.0-43da4a94')

/** 逐级检查路径上每一段是不是重解析点（junction / symlink）。 */
function inspectPath(p) {
  const parts = p.split('\\')
  let cur = parts[0] + '\\'
  for (let i = 1; i < parts.length; i++) {
    cur = join(cur, parts[i])
    if (!existsSync(cur)) break
    try {
      const st = lstatSync(cur)
      if (st.isSymbolicLink()) {
        console.log(`  ⚠️ 重解析点: ${cur} → ${(() => { try { return realpathSync(cur) } catch { return '?' } })()}`)
      }
    } catch (e) {
      console.log(`  lstat 失败 ${cur}: ${e.code}`)
    }
  }
}
console.log('── 路径上的重解析点 ──')
inspectPath(cardsRoot)
console.log('  cardsRoot realpath =', realpathSync(cardsRoot))

console.log('')
console.log('── 目标文件的状态 ──')
try {
  const st = statSync(file)
  console.log(`  ${file}`)
  console.log(`    mode=${st.mode.toString(8)} readonly=${(st.mode & 0o200) === 0} size=${st.size}`)
} catch (e) {
  console.log('  statSync 失败:', e.code)
}

console.log('')
console.log('── 各种删除 API 的行为 ──')
const attempts = [
  ['rmSync(file, {force:true})', () => rmSync(file, { force: true })],
  ['unlinkSync(file)', () => unlinkSync(file)],
  ['rmSync(dir, {recursive:true,force:true})', () => rmSync(dir, { recursive: true, force: true })],
  ['rmdirSync(dir) 递归删空', () => {
    // 先清文件再删目录
    const inner = join(dir, 'package.json')
    if (existsSync(inner)) unlinkSync(inner)
    rmdirSync(dir)
  }],
]
for (const [label, fn] of attempts) {
  try {
    fn()
    console.log(`  ${label} → 调用返回；文件还在？${existsSync(file)} 目录还在？${existsSync(dir)}`)
  } catch (e) {
    console.log(`  ${label} → 抛错 ${e.code}: ${String(e.message).slice(0, 70)}`)
  }
}

console.log('')
console.log('── 目录最终状态 ──')
console.log('  ', (await import('node:fs')).readdirSync(cardsRoot).filter((n) => n.startsWith('hello-card')).join(', ') || '（无）')
