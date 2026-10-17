/**
 * **"当前会话那一行"锚点**的测试（`pickCurrentRowAnchor`）。
 *
 * ## 它治什么
 *
 * 当前会话行是**活跃**行 ⇒ 官方用自己的状态点**顶掉**我们的标记槽位 ✗ ⇒
 * 这一行**没有标记** ✓；标题又可能被截断 ✓ ⇒ 两条老路都断 ✗ ⇒ 连线画不出来 ✓。
 * 而 `snapshot.current` 知道它是谁 ✓ ⇒ 用**结构**（`aria-selected`）把它接上 ✓。
 *
 * ## 为什么安全
 *
 * 三条自校验：有 `currentId` ✓ / 那一行**还没有** id ✓ / **没有别的行**已被认成它 ✓
 * —— 任一不满足就**不采用** ✓（用结构补充文本，而不是用猜测覆盖事实 ✓）。
 *
 * 跑法：node scripts/test-row-current-anchor.mjs
 */
import { pickCurrentRowAnchor } from '../lib/client/row-map.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))
const eq = (a, b, l) =>
  JSON.stringify(a) === JSON.stringify(b)
    ? pass++
    : (fail++, console.log(`  ❌ ${l}\n      期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`))

const CUR = 'session-current'
const OTHER = 'session-other'

console.log('── ① 应通过：活跃行没标记、也没被标题认出来 ⇒ 用结构锚点接上')

{
  eq(
    pickCurrentRowAnchor([OTHER, undefined, undefined], 1, CUR),
    { index: 1, id: CUR },
    '第 1 行是活跃行、尚未有 id、无冲突 ⇒ 采用 ✓',
  )
}

console.log('── ② 应不通过：已知事实优先（那一行已经有 id 就不覆盖）')

{
  eq(
    pickCurrentRowAnchor([OTHER, 'session-guessed'], 1, CUR),
    undefined,
    '活跃行**已有** id ⇒ 不覆盖 ✓（不能因为"它是当前行"就把已认出的 id 换掉 ✗）',
  )
}

console.log('── ③ 应不通过：假设被证伪（别的行已被认成当前会话）')

{
  eq(
    pickCurrentRowAnchor([CUR, undefined], 1, CUR),
    undefined,
    '别的行已经是 currentId ⇒ "活跃行 = 当前会话"在本次渲染里被证伪 ⇒ 不采用 ✓',
  )
}

console.log('── ④ 应不通过：没有 currentId / 没有活跃行 / 下标越界')

{
  eq(pickCurrentRowAnchor([undefined, undefined], 1, undefined), undefined, '没有 currentId ⇒ 不采用 ✓')
  eq(pickCurrentRowAnchor([undefined, undefined], undefined, CUR), undefined, '没有活跃行 ⇒ 不采用 ✓')
  eq(pickCurrentRowAnchor([undefined], 5, CUR), undefined, '下标越界 ⇒ 不采用 ✓')
  eq(pickCurrentRowAnchor([], 0, CUR), undefined, '没有行 ⇒ 不采用 ✓')
}

console.log('── ⑤ 边界：活跃行恰好就是**最后一行**、前面全未识别')

{
  eq(
    pickCurrentRowAnchor([undefined, undefined, undefined], 2, CUR),
    { index: 2, id: CUR },
    '末行作为锚点也成立 ✓',
  )
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
