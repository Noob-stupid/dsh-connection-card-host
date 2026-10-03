/**
 * **右侧面板跟随"展开的连接"** —— 用户报的行为要求，这条测试把它钉住。
 *
 * ## 用户原话
 *
 * > 「应该展开对应的连接右侧才会展现，**而不是固定位置呆着不动** ——
 * >   因为如果有多个连接，**展开哪个右侧就显示哪个**。」
 *
 * ## 原先的缺陷（现场"固定不动"就是它）
 *
 * `capturedCards` 的 `useMemo` **遍历所有连接** ✗ ⇒
 *   ① 右侧不跟随展开态（看着像钉在原地）
 *   ② 多连接时重复挂载 + 白渲染
 *   ③ 切换时旧组件不卸载 ⇒ **Y 会看到 X 的组件状态** ✗（React 组件带 state）
 *
 * ## 这条测试的做法（**静态读源码**，因为它是客户端渲染逻辑，跑不了 DOM）
 *
 * ⚠️ 说清它的能力边界：它**不能**证明"界面上真的换了" ✗（那要浏览器 ✓）；
 * 它证明的是"**那段逻辑还在，且三条约束没被改回去**" ✓ ——
 * 也就是防止"修好了又被后人改回遍历所有连接"这类回归 ✓。
 * 真正的行为验收靠对端真机（开两条连接、分别展开、看右侧）✓。
 *
 * 跑法：node scripts/test-side-follows-expanded.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

const src = readFileSync('src/ui/ConnectionPanel.tsx', 'utf8')

/** 抠出 `capturedCards` 那段 useMemo 的正文（从声明到依赖数组结尾）。 */
const start = src.indexOf('const capturedCards = useMemo(')
const endMarker = '}, [connections, adapterTemplates, expandedId])'
const end = src.indexOf(endMarker, start)
/** ⚠️ 切片要**含到依赖数组结尾**：第一版 `end + 45` 是硬编码长度 ✗ ⇒
 *  断言"依赖数组里有 expandedId"误报失败（**代码是对的，是我的切片短了一点点** ✗）。
 *  ⇒ 又一次"测试红了先怀疑夹具/断言" ✓。 */
const body = start >= 0 && end > start ? src.slice(start, end + endMarker.length) : ''

console.log('── ① 那段逻辑存在，且依赖展开态')

ok(start >= 0, '找得到 capturedCards 的 useMemo')
ok(
  /\[connections, adapterTemplates, expandedId\]/.test(body),
  '依赖数组里有 **expandedId**（否则展开态变化不会触发重算 ✗）',
)

console.log('── ② 只收"展开的那条连接"')

ok(/if \(!expandedId\) return out/.test(body), '未展开 ⇒ **立即返回空**（不残留上一条 ✓）')
ok(
  /connections\.find\(\(c\) => c\.id === expandedId\)/.test(body),
  '用 `find` 只取**展开的那一条**（而不是 for 遍历所有 ✓）',
)
ok(
  !/for \(const conn of connections\)/.test(body),
  '**不得**再出现"遍历所有连接"的写法（那正是用户报的缺陷 ✗）',
)

console.log('── ③ key 带连接 id ⇒ 换连接必然卸载重挂')

ok(
  /key: `\$\{conn\.id\}:\$\{card\.instanceId\}`/.test(body),
  'key = `连接id:实例id`（换连接时 React **卸载旧的** ⇒ 不会串状态 ✓）',
)

console.log('── ④ 右侧整块在"没有内容"时不渲染（空 = 空，不是残留）')

ok(
  /\{client && capturedCards\.length > 0 && \(/.test(src),
  '`capturedCards.length > 0` 才渲染 aside ⇒ 没展开连接时右侧是**空的** ✓',
)

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  console.log('⚠️ 静态测试只防回归；"界面上真的换了"要靠真机验收（两条连接分别展开）')
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
