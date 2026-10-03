/**
 * 卡片安装器 —— 把外部来源的卡片包放进**我们自己的目录**。
 *
 * ## 设计原则：完全隔离
 *
 * 装到 `$DSH_HOME/connection-cards/cards/<id>/`，**不碰 profile**、
 * 不跑 pnpm、不动 `dsh.profile.bundles`。用户给的理由很实在：
 *
 *   > 下载到我们自己的目录里、在里面用 —— **这样不会破坏 DSH 的更新，
 *   > 也不会被 DSH 的更新破坏**。
 *
 * 走 profile 安装会让我们和 DSH 共享依赖树、版本约束、准入检查，
 * 一旦 DSH 升级或依赖冲突，**故障面波及整个 DSH**。自己的目录则完全隔离，
 * 而且不受模块解析链限制（路径自己算，绝对路径 import 即可）。
 *
 * ## 支持的来源
 *
 * | 形式 | 例子 |
 * |---|---|
 * | 本地目录 | `D:\my-cards\monitor-card` |
 * | 本地 tgz  | `D:\downloads\monitor-card-1.0.0.tgz` |
 * | npm 包名  | `monitor-card` 或 `@scope/monitor-card` |
 * | HTTP tgz  | `https://example.com/monitor-card.tgz` |
 *
 * npm 走 registry **tarball**（一次 HTTPS GET），**不引 pnpm**
 * —— 为了装一张卡片把包管理器拖进来不值得，而且 pnpm 会改写 profile。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, statSync, unlinkSync, rmdirSync, type Dirent } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  versionedDirName,
  currentPointerName,
  parseVersionedDirName,
  fingerprintSourceDir,
  sourceRecordName,
  type CardSourceRecord,
} from './card-paths.js'

export interface InstallResult {
  ok: boolean
  /** 卡片 id（= 目录名）。 */
  cardId?: string
  /** 最终落地目录。 */
  dir?: string
  /** 卡片显示名，便于回执里说人话。 */
  name?: string
  version?: string
  reason?: string
}

/** 从 spec 推断来源类型。 */
type SourceKind = 'dir' | 'tgz-file' | 'tgz-url' | 'npm'

function classify(spec: string): SourceKind {
  const s = spec.trim()
  if (/^https?:\/\//i.test(s)) return 'tgz-url'
  if (/\.(tgz|tar\.gz)$/i.test(s)) return 'tgz-file'
  // 存在的本地路径（目录或文件）
  try {
    if (existsSync(resolve(s))) {
      return /\.(tgz|tar\.gz)$/i.test(s) ? 'tgz-file' : 'dir'
    }
  } catch {
    /* 非法路径字符等，落到 npm 分支 */
  }
  return 'npm'
}

/**
 * 递归删除目录 —— **不要用 `fs.rmSync`**。
 *
 * ## 为什么换掉 rmSync（2026-10-02 实测，比 cpSync 那条更隐蔽）
 *
 * 本机上 `rmSync` 对**用户主目录下**（`~/.dsh/…`）的路径**静默无效**：
 * **不抛异常、也不删除**。实测：
 *
 *     rmSync(hello-card.current, { force: true })     → 调用返回，文件仍在
 *     unlinkSync(hello-card.current)                  → 真的删掉了
 *
 * 后果比"报错"严重得多 —— 卸载卡片时：
 *   ① 指针删不掉 ⇒ 卡片**仍留在列表里**，用户以为没卸掉
 *   ② 而函数返回 `{ ok: true }` ⇒ 界面显示"已卸载" —— **成功是假的**
 *
 * ## 与 cpSync 同源
 *
 * `cpSync` 在同样位置报 `EIO, Access is denied`，`rmSync` 则静默不动；
 * 两者的共同点是都走**批量/目录级**的文件系统 API。
 * 逐个条目的 `copyFileSync` / `unlinkSync` / `rmdirSync` 一律正常。
 * 所以本文件的规矩是：**只使用逐条目 API**，不用批量 API。
 */
function removeDirRecursive(target: string): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(target, { withFileTypes: true })
  } catch {
    return // 不存在或读不到：按"已删除"处理（等价于 rmSync 的 force 语义）
  }
  for (const entry of entries) {
    const p = join(target, entry.name)
    if (entry.isDirectory()) {
      removeDirRecursive(p)
      try {
        rmdirSync(p)
      } catch {
        /* 非空或占用：留给下一次（不抛，调用方按需统计） */
      }
    } else {
      try {
        unlinkSync(p)
      } catch {
        /* 被占用：留给下一次 */
      }
    }
  }
  try {
    rmdirSync(target)
  } catch {
    /* 目录里还有删不掉的条目：保留它比假装删掉更诚实 */
  }
}

/**
 * 删除一个文件（等价于 `rmSync(p, { force: true })`，但用了**有效的** API）。
 *
 * @returns 是否真的删掉了 —— 调用方**必须**看这个返回值：
 *          "删不掉"与"删掉了"在这台机器上是两种真实结果。
 */
function removeFileQuiet(target: string): boolean {
  try {
    unlinkSync(target)
    return true
  } catch {
    return !existsSync(target) // 本来就没有 = 视作成功
  }
}

/** 解压 tgz 到目标目录（用系统 tar —— Windows 10+ 自带 bsdtar）。 */
function extractTgz(tgzPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-xzf', tgzPath, '-C', destDir], { stdio: 'pipe' })
}

/**
 * 递归拷贝目录 —— **不要用 `fs.cpSync`**。
 *
 * ## 为什么换掉 cpSync（2026-10-02 实测）
 *
 * 本机上 `cpSync` 写入**用户主目录下**（`~/.dsh/…`，卡片目录正在那儿）与 `%TEMP%`
 * 一律 `EIO, Access is denied`，写**非系统盘**却正常；而 `copyFileSync` 三种位置都能写。
 * 于是**安装卡片整个失败**：
 *
 *     installCard('<卡片来源>', …)
 *     → ok:false  reason: "EIO, Access is denied.
 *        '\\?\<用户主目录>\.dsh\connection-cards\cards\hello-card@<版本>-<指纹>'"
 *
 * 复现方式很直接：对同一份源、同一目标，`cpSync` 必失败、逐文件 `copyFileSync` 必成功。
 * 怀疑与安全软件/文件系统过滤驱动对 `cpSync` 所用的批量复制 API 有关，
 * 但**不必查清根因**：逐文件拷贝是等价且更可控的实现。
 *
 * ## 顺带的好处
 *
 * · 逐文件拷贝对"目标被占用"的容错更好（可跳过单个失败项而不是整体失败）
 * · 不跟随符号链接（避免把链接目标整棵树拷进来）
 */
function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name)
    const to = join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(from, to)
    } else if (entry.isFile()) {
      copyFileSync(from, to)
    }
    // 其它类型（符号链接/设备等）跳过：卡片包不该依赖它们
  }
}

/**
 * npm 包名 → 下载它的 tarball 并解压，返回解压出的包目录。
 *
 * registry 的包 tarball 内部统一是 `package/` 前缀，所以解压后
 * 真正的包根在 `<tmp>/package`。
 */
async function fetchNpm(name: string, workDir: string): Promise<string> {
  const metaUrl = `https://registry.npmjs.org/${name.replace('/', '%2f')}`
  const metaResp = await fetch(metaUrl, {
    headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
  })
  if (!metaResp.ok) {
    throw new Error(`查不到包 ${name}（registry 返回 ${metaResp.status}）`)
  }
  const meta = (await metaResp.json()) as {
    'dist-tags'?: { latest?: string }
    versions?: Record<string, { dist?: { tarball?: string } }>
  }
  const latest = meta['dist-tags']?.latest
  const tarball = latest ? meta.versions?.[latest]?.dist?.tarball : undefined
  if (!tarball) throw new Error(`包 ${name} 没有可下载的 tarball`)

  const tgzPath = join(workDir, 'package.tgz')
  const resp = await fetch(tarball)
  if (!resp.ok) throw new Error(`下载 tarball 失败（${resp.status}）`)
  writeFileSync(tgzPath, Buffer.from(await resp.arrayBuffer()))

  const outDir = join(workDir, 'unpacked')
  extractTgz(tgzPath, outDir)

  // tarball 内统一以 package/ 为根
  const pkgRoot = join(outDir, 'package')
  return existsSync(pkgRoot) ? pkgRoot : outDir
}

/** 校验一个目录是不是合法的卡片包；返回清单信息或失败原因。 */
function validateCardPackage(dir: string): {
  ok: boolean
  reason?: string
  id?: string
  name?: string
  version?: string
  entry?: string
} {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return { ok: false, reason: '包里没有 package.json' }

  let pkg: {
    name?: string
    version?: string
    main?: string
    dshCard?: { id?: string; name?: string; entry?: string }
  }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    return { ok: false, reason: `package.json 不是合法 JSON：${String(e)}` }
  }

  if (!pkg.dshCard || typeof pkg.dshCard !== 'object') {
    return {
      ok: false,
      reason:
        'package.json 里没有 dshCard 字段 —— 这不是一张卡片包' +
        '（卡片包必须在 dshCard 里声明 id/name/entry）',
    }
  }

  const id = pkg.dshCard.id || pkg.name
  if (!id) return { ok: false, reason: 'dshCard.id 与 package.json 的 name 都缺失，无法确定卡片 id' }

  // 入口：dshCard.entry 优先，其次 package.json.main，再次 index.js
  const entry = pkg.dshCard.entry || pkg.main || 'index.js'
  if (!existsSync(join(dir, entry))) {
    return { ok: false, reason: `入口文件不存在：${entry}` }
  }

  return {
    ok: true,
    id: String(id),
    name: pkg.dshCard.name || pkg.name || String(id),
    version: pkg.version,
    entry,
  }
}

/**
 * 安装一张卡片到 cardsRoot/<id>/。
 *
 * 幂等：目标已存在时**覆盖**（用户重装/升级的场景），
 * 但先校验来源合法再动目标目录 —— 不能校验失败还把旧的删了。
 */
export async function installCard(
  spec: string,
  cardsRoot: string,
  auditLog: (msg: string) => void,
): Promise<InstallResult> {
  const raw = spec.trim()
  if (raw.length === 0) return { ok: false, reason: '安装来源不能为空' }

  const kind = classify(raw)
  const work = join(tmpdir(), `ccr-install-${randomUUID()}`)
  mkdirSync(work, { recursive: true })

  try {
    let sourceDir: string
    if (kind === 'dir') {
      sourceDir = resolve(raw)
    } else if (kind === 'tgz-file') {
      const unpacked = join(work, 'unpacked')
      extractTgz(resolve(raw), unpacked)
      const inner = join(unpacked, 'package')
      sourceDir = existsSync(inner) ? inner : unpacked
    } else if (kind === 'tgz-url') {
      const tgzPath = join(work, 'download.tgz')
      const resp = await fetch(raw)
      if (!resp.ok) throw new Error(`下载失败（HTTP ${resp.status}）`)
      writeFileSync(tgzPath, Buffer.from(await resp.arrayBuffer()))
      const unpacked = join(work, 'unpacked')
      extractTgz(tgzPath, unpacked)
      const inner = join(unpacked, 'package')
      sourceDir = existsSync(inner) ? inner : unpacked
    } else {
      sourceDir = await fetchNpm(raw, work)
    }

    // ── 先校验来源，再动目标目录 ──
    const check = validateCardPackage(sourceDir)
    if (!check.ok || !check.id) {
      auditLog(`卡片安装被拒（${raw}）：${check.reason}`)
      return { ok: false, reason: check.reason }
    }

    const cardId = check.id.replace(/[^A-Za-z0-9._@-]/g, '_')

    // ── 版本化目录：装新版本 = 写新目录 + 改指针，**从不删旧目录** ──
    //
    // 为什么不删：卡片装载后它的 node_modules 被宿主进程锁住，
    // `rmSync` 在 Windows 上直接 EPERM（实测：
    //   "重装 pdf-card → EPERM, Permission denied: ...\cards\pdf-card"）。
    // 版本化之后，新版本写进**新目录**，完全不碰被锁的那个；
    // 旧的留给"清理旧版本"在宿主重启后删。
    //
    // 指纹取自来源（路径+大小+修改时间）：同一份来源重复安装 → 目录名相同 →
    // **跳过写入**（幂等，也就不撞锁）。
    //
    // ⚠️ 指纹必须覆盖**卡片自己的文件**，不能用目录 mtime ——
    // 往已存在的文件里追加内容不会改父目录的 mtime，那样改了代码指纹却不变，
    // 更新会被当成"同来源"静默跳过（实测踩到）。
    const sourceKey = fingerprintSourceDir(sourceDir)
    const dirName = versionedDirName(cardId, check.version, sourceKey)
    const destDir = join(cardsRoot, dirName)
    const pointerPath = join(cardsRoot, currentPointerName(cardId))
    mkdirSync(cardsRoot, { recursive: true })

    let skipped = false
    if (existsSync(destDir)) {
      // 同名目录已存在 = 同一份来源装过 → 不重写（这正是避开文件锁的关键）
      skipped = true
    } else {
      copyDirRecursive(sourceDir, destDir)
    }

    // 改指针（内容极小，不会被锁）
    writeFileSync(pointerPath, dirName, 'utf8')

    // 记下**来源**与版本 —— 以后"检查更新 / 更新"要照着同一个来源重装，
    // 也得知道当前装的是哪一版才能和上游比。指针只回答"在用的是哪个目录"，
    // 回答不了"从哪来的"。
    try {
      const record: CardSourceRecord = {
        spec: raw,
        kind,
        ...(check.version ? { installedVersion: check.version } : {}),
        dirName,
        fingerprint: sourceKey,
        installedAt: Date.now(),
      }
      writeFileSync(join(cardsRoot, sourceRecordName(cardId)), JSON.stringify(record, null, 2), 'utf8')
    } catch (e) {
      // 记录写不进去不该让安装失败 —— 只是"更新"能力会退化成"不知道来源"
      auditLog(`卡片来源记录写入失败（不影响安装）：${e instanceof Error ? e.message : String(e)}`)
    }

    auditLog(
      `卡片已安装：${check.name} v${check.version ?? '?'} (${cardId}) → ${dirName}` +
        (skipped ? '（同来源已存在，跳过写入）' : ''),
    )
    return {
      ok: true,
      cardId,
      dir: destDir,
      ...(check.name ? { name: check.name } : {}),
      ...(check.version ? { version: check.version } : {}),
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    auditLog(`卡片安装失败（${raw}）：${reason}`)
    return { ok: false, reason }
  } finally {
    removeDirRecursive(work)
  }
}

/** 从已安装目录卸载一张卡片。 */
export function uninstallCard(cardId: string, cardsRoot: string): { ok: boolean; reason?: string } {
  const safe = basename(cardId)
  if (safe !== cardId || safe.length === 0) {
    return { ok: false, reason: '非法的卡片 id' }
  }

  // ── 版本化之后的卸载 ──
  //
  // 目录是 `cards/<id>@<ver>-<fp>/`，靠 `cards/<id>.current` 指认在用的是哪个。
  // **先删指针**（那一步永远成功，且立刻让卡片从列表消失），
  // 再尽力删目录 —— 被宿主锁住时删不掉是**预期内**的，留给"清理旧版本"
  // 在重启后处理，不能因此报卸载失败（否则用户会以为没卸掉）。
  const pointer = join(cardsRoot, currentPointerName(safe))
  const versionedDirs: string[] = []
  try {
    for (const name of readdirSync(cardsRoot)) {
      const parsed = parseVersionedDirName(name)
      if (parsed && parsed.cardId === safe) versionedDirs.push(name)
    }
  } catch {
    /* 目录读不到就按没有处理 */
  }

  const legacyDir = join(cardsRoot, safe)
  const hasLegacy = existsSync(legacyDir)
  const hasPointer = existsSync(pointer)

  if (!hasLegacy && !hasPointer && versionedDirs.length === 0) {
    return { ok: false, reason: `未安装：${safe}` }
  }

  // 1) 删指针 —— 关键一步，卡片立刻消失
  if (hasPointer) {
    /**
     * ⚠️ 必须**看返回值**，不能只看"有没有抛错"。
     *
     * 本机上删除失败是**静默**的（`rmSync` 时代连异常都没有，文件还在、
     * 函数却返回 ok:true ⇒ 界面显示"已卸载"而卡片仍在列表里 —— 假成功）。
     * 所以：删不掉就**如实报失败**并说清后果。
     */
    if (!removeFileQuiet(pointer)) {
      return {
        ok: false,
        reason:
          `指针删不掉：${pointer}。` +
          `卡片会继续留在列表里 —— 这比报"已卸载"却仍在更诚实。` +
          `常见原因：文件被占用，或安全软件拦下了删除。`,
      }
    }
  }

  // 2) 尽力删目录（锁住就跳过，不算失败）
  let locked = 0
  const targets = [...versionedDirs.map((n) => join(cardsRoot, n)), ...(hasLegacy ? [legacyDir] : [])]
  for (const dir of targets) {
    removeDirRecursive(dir)
    // 用"还在不在"判断，而不是"有没有抛错" —— 这台机器上删不掉是不抛错的
    if (existsSync(dir)) locked++
  }

  return locked > 0
    ? { ok: true, reason: `已卸载；有 ${locked} 个旧目录被占用（重启后清理）` }
    : { ok: true }
}
