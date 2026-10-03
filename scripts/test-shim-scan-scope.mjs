/**
 * **正控 / 负控**：垫片的"扫描面"必须只看宿主面（对端提炼的纪律，落到测试里）。
 *
 * ## 它在钉什么（v1.0.56 修的那个假拒绝）
 *
 * 病根是**扫描面**搞错了，不是解析面不足 ✗：
 * 浏览器产物（`lib/client.js`）里的 `require('react')` 由**浏览器模块表**满足 ✓，
 * 而垫片原先把它也算进"宿主侧必须可解析" ⇒ 正常插件被误判成"第三方依赖未解析到" ✗。
 *
 * > **判据本身没错，是它看的范围错了** —— 这类错误比"解析面不足"更隐蔽。
 *
 * ## 为什么必须成对（对端点明的纪律）
 *
 * > **任何"扫描/校验"类修复，都要各带一个"应当通过"和"应当不通过"的样本。**
 * > 否则你只证明"它这次没报错"，**没证明"它还会报错"** ✗。
 *
 * 所以本文件三条断言缺一不可：
 *   · **应通过**：客户端产物的浏览器依赖（`react`）**不得**出现在 unresolved 里
 *   · **应不通过**：宿主入口真的导入的 DSH 包（无门面）**必须**出现在 unresolved 里
 *   · **边界**：宿主入口**自己**需要 `react` 时 ⇒ 仍然算 unresolved（我们只跳过客户端产物，不是放过 react）
 *
 * 跑法：node scripts/test-shim-scan-scope.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planShims, unresolvedOf } from '../lib/adapter/shim.js'

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

/** 造一个插件目录：host 入口 + 浏览器产物，两者导入的东西不同。 */
function makePlugin(root, { hostImports, clientImports, withClient = true }) {
  const dir = join(root, withClient ? 'with-client' : 'host-only')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'scan-scope-fixture',
      version: '1.0.0',
      type: 'module',
      main: 'lib/index.js',
      ...(withClient ? { exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } } } : {}),
    }),
  )
  writeFileSync(
    join(dir, 'lib', 'index.js'),
    hostImports.map((s) => `import '${s}'`).join('\n') + '\nexport function apply() {}\n',
  )
  if (withClient) {
    writeFileSync(
      join(dir, 'lib', 'client.js'),
      `window.__ModuleLoader__.load({ id: 'x', factory(require) {\n` +
        clientImports.map((s) => `  require('${s}')`).join('\n') +
        `\n  return { inject: ['slots'], apply() {} }\n} })\n`,
    )
  }
  return dir
}

const root = mkdtempSync(join(tmpdir(), 'ccr-scanscope-'))
const shimRoot = join(root, 'cards')
try {
  console.log('── ① 应通过：客户端产物的浏览器依赖**不算**宿主依赖')

  {
    const dir = makePlugin(root, {
      /** 宿主面：干净（只导入一个确有门面的包） */
      hostImports: ['@deepseek-ai/dsh-tools'],
      /** 浏览器面：react 只在这里出现 */
      clientImports: ['react', 'react/jsx-runtime'],
    })
    const un = unresolvedOf(planShims(dir, shimRoot, dir))
    ok(
      !un.some((u) => u.startsWith('react')),
      `客户端产物的 react **不得**算作宿主依赖（实测 unresolved=[${un.join(', ')}]）`,
    )
    ok(un.length === 0, `宿主面干净 ⇒ unresolved 应为空（实测 [${un.join(', ')}]）`)
  }

  console.log('── ② 应不通过：宿主入口真的缺的依赖**必须**被报出来')

  {
    const dir = makePlugin(root, {
      /** 宿主面：导入一个**没有门面**的 DSH 包 ⇒ 必须报 */
      hostImports: ['@deepseek-ai/dsh-credentials'],
      clientImports: ['react'],
    })
    const un = unresolvedOf(planShims(dir, shimRoot, dir))
    ok(
      un.some((u) => u.includes('dsh-credentials')),
      `宿主入口缺的 DSH 包**必须**出现在 unresolved（实测 [${un.join(', ')}]）`,
    )
    ok(
      !un.some((u) => u.startsWith('react')),
      '同一次里，客户端产物的 react 仍然**不算**（两个判据互不干扰）',
    )
  }

  console.log('── ③ 边界：宿主入口**自己**需要 react ⇒ 仍然算 unresolved')

  {
    const dir = makePlugin(root, {
      hostImports: ['react'],
      clientImports: ['react'],
    })
    const un = unresolvedOf(planShims(dir, shimRoot, dir))
    ok(
      un.some((u) => u.startsWith('react')),
      '宿主入口自己导入 react ⇒ **照样报**（我们只跳过客户端产物，不是放过 react）',
    )
  }

  console.log('── ④ 没有客户端产物的插件：行为不变（不做多余的事）')

  {
    const dir = makePlugin(root, {
      hostImports: [],
      clientImports: [],
      withClient: false,
    })
    const un = unresolvedOf(planShims(dir, shimRoot, dir))
    ok(un.length === 0, '无客户端产物的插件照常规划（unresolved 为空）')
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('')
if (fail === 0) {
  console.log(`═══ 结果：${pass} 通过 / 0 失败 ═══`)
  process.exit(0)
} else {
  console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(1)
}
