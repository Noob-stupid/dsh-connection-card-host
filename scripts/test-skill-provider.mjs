/**
 * 包内 skill 的**契约测试** —— 钉住「装上插件后 agent 真能看到这份说明」。
 *
 * 为什么需要它：skill 的内容在 `skills/connection-card.md`（随包发布），
 * 而**目录项**（名字/描述/whenToUse/rank）写死在 `src/tools/connection-skill.ts`。
 * 两处漂移不会报错，只会静默地让 agent 看到一份过时说明 —— 或者干脆看不到。
 *
 * 本测试验证（零依赖、零网络、不需要装 DSH）：
 *   ① 正文文件的 frontmatter 合法：kebab-case name、非空 description/whenToUse
 *      （这样它**也能**作为扁平 skill 直接放进 `~/.dsh/skills/` 使用）
 *   ② 描述长度 ≤ 500 —— `dsh-tool-skill` 的 `catalogDescriptionMaxLength` 默认值，
 *      超了会在目录里被截断（截断的是路由信息）
 *   ③ 正文里出现的**每一个** `connection_*` 工具名都真实存在
 *      （从 `src/tools/awareness-tools.ts` 的 name 字段抽出来比对）
 *   ④ 反向：源码里注册的每个 `connection_*` 工具都在正文里被讲到
 *      （新增工具却忘了写文档 ⇒ 红）
 *   ⑤ `src/index.ts` 真的调了 `registerConnectionSkill`，且挂到了 ctx.effect
 *   ⑥ 正文里不出现开发机绝对路径（与仓库的 localscan 同一条纪律）
 *
 * 跑法：node scripts/test-skill-provider.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_FILE = join(ROOT, 'skills', 'connection-card.md')
const PROVIDER_FILE = join(ROOT, 'src', 'tools', 'connection-skill.ts')
const TOOLS_FILE = join(ROOT, 'src', 'tools', 'awareness-tools.ts')
const INDEX_FILE = join(ROOT, 'src', 'index.ts')

let pass = 0
let fail = 0
const ok = (c, l) => (c ? pass++ : (fail++, console.log(`  ❌ ${l}`)))

// ── 读文件 ────────────────────────────────────────────────────────────────
ok(existsSync(SKILL_FILE), `skills/connection-card.md 存在（随包发布的 skill 正文）`)
ok(existsSync(PROVIDER_FILE), `src/tools/connection-skill.ts 存在（包内 provider）`)
if (!existsSync(SKILL_FILE) || !existsSync(PROVIDER_FILE)) {
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  process.exit(1)
}

const raw = readFileSync(SKILL_FILE, 'utf8')
const provider = readFileSync(PROVIDER_FILE, 'utf8')
const toolsSrc = readFileSync(TOOLS_FILE, 'utf8')
const indexSrc = readFileSync(INDEX_FILE, 'utf8')

// ── ① frontmatter ─────────────────────────────────────────────────────────
const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
ok(fmMatch !== null, '正文以 YAML frontmatter 开头（能被 dsh-skill-filesystem 直接认）')
const fm = fmMatch ? fmMatch[1] : ''
const field = (key) => {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
}
const name = field('name')
const description = field('description')
const whenToUse = field('whenToUse')

ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), `name 是 kebab-case（实得 "${name}"）`)
ok(name === 'connection-card', `name == connection-card（实得 "${name}"）`)
ok(description.length > 0, 'description 非空')
ok(whenToUse.length > 0, 'whenToUse 非空（路由提示）')

// ── ② 描述长度上限（dsh-tool-skill 默认 500）─────────────────────────────
ok(
  description.length <= 500,
  `description ≤ 500 字符（实得 ${description.length}）—— 超了会被目录截断`,
)

// provider 里的名/描述必须与正文一致（两处漂移就静默过时）
ok(provider.includes(`'${name}'`), `provider 里的 skill 名与正文一致（${name}）`)
const descInProvider = description.slice(0, 40)
ok(
  provider.includes(descInProvider.replace(/'/g, "\\'")),
  'provider 里的 description 与正文同源（前 40 字符一致）',
)

// ── ③④ 工具名双向覆盖 ─────────────────────────────────────────────────────
const toolsInSource = [...toolsSrc.matchAll(/name:\s*'(connection_[a-z_]+)'/g)].map((m) => m[1])
const toolsInSkill = new Set([...raw.matchAll(/`?(connection_[a-z_]+)`?/g)].map((m) => m[1]))

ok(toolsInSource.length >= 5, `源码里至少 5 个 connection_* 工具（实得 ${toolsInSource.length}）`)
for (const t of toolsInSource) {
  ok(toolsInSkill.has(t), `正文讲到了源码里的工具 ${t}`)
}
for (const t of toolsInSkill) {
  ok(toolsInSource.includes(t), `正文提到的 ${t} 在源码里真实存在（不许编造工具）`)
}

// ── ⑤ index.ts 接线 ───────────────────────────────────────────────────────
ok(indexSrc.includes('registerConnectionSkill'), 'index.ts 调用了 registerConnectionSkill')
ok(
  /registerConnectionSkill[\s\S]{0,400}?ctx\.effect/.test(indexSrc),
  '注册返回的 dispose 挂到了 ctx.effect（卸载即净）',
)
ok(provider.includes('BUNDLED_SKILL_RANK = 600'), 'rank 取官方 BUNDLED_SKILL_RANK = 600')
ok(
  !/from\s+'@deepseek-ai\/dsh-skill'/.test(provider),
  '不硬依赖 @deepseek-ai/dsh-skill（旧 checkout 也要能装）',
)

// ── ⑥ 不泄漏开发机绝对路径（同仓库 localscan 纪律）────────────────────────
ok(!/[A-Za-z]:\\/.test(raw), '正文里没有开发机绝对路径（盘符+反斜杠）')

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
