/**
 * 诊断：卸载为什么静默不删。
 * 直接复刻 uninstallCard 的每一步，并把**实际使用的路径**打出来。
 */
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { currentPointerName, parseVersionedDirName } from '../lib/card-host/card-paths.js'
import { uninstallCard } from '../lib/card-host/installer.js'

const cardsRoot = 'C:\\Users\\花火\\.dsh\\connection-cards\\cards'
const safe = 'hello-card'

console.log('  cardsRoot      =', JSON.stringify(cardsRoot))
console.log('  cardsRoot 存在 =', existsSync(cardsRoot))

const pointer = join(cardsRoot, currentPointerName(safe))
console.log('  pointer        =', JSON.stringify(pointer))
console.log('  pointer 存在   =', existsSync(pointer))

const versioned = []
for (const name of readdirSync(cardsRoot)) {
  const p = parseVersionedDirName(name)
  if (p && p.cardId === safe) versioned.push(name)
}
console.log('  versionedDirs  =', JSON.stringify(versioned))

const legacy = join(cardsRoot, safe)
console.log('  legacyDir      =', JSON.stringify(legacy), '存在 =', existsSync(legacy))

console.log('  ── 逐步删除 ──')
try {
  rmSync(pointer, { force: true })
  console.log('  rmSync(pointer) 后仍存在？', existsSync(pointer))
} catch (e) {
  console.log('  rmSync(pointer) 抛错:', e.code, e.message.slice(0, 80))
}
for (const n of versioned) {
  const p = join(cardsRoot, n)
  try {
    rmSync(p, { recursive: true, force: true })
    console.log(`  rmSync(${n}) 后仍存在？`, existsSync(p))
  } catch (e) {
    console.log(`  rmSync(${n}) 抛错:`, e.code, e.message.slice(0, 80))
  }
}
try {
  rmSync(legacy, { recursive: true, force: true })
  console.log('  rmSync(legacy) 后仍存在？', existsSync(legacy))
} catch (e) {
  console.log('  rmSync(legacy) 抛错:', e.code, e.message.slice(0, 80))
}

console.log('  ── 目录现在还有什么 ──')
console.log('  ', readdirSync(cardsRoot).filter((n) => n.startsWith(safe)).join(', ') || '（无）')

console.log('  ── 再调一次真实 uninstallCard ──')
console.log('  ', JSON.stringify(uninstallCard(safe, cardsRoot)))
console.log('  ', readdirSync(cardsRoot).filter((n) => n.startsWith(safe)).join(', ') || '（无）')
