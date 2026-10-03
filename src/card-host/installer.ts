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
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, statSync, unlinkSync, rmdirSync, renameSync, type Dirent } from 'node:fs'
import { join, basename, resolve, dirname } from 'node:path'
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
import { checkPackage, ensureAdapterManifest } from './package-check.js'

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
 * ## 删不掉时：**改名降级**，而不是报失败（对端真机结论）
 *
 * Windows 上"删不掉"有两种完全不同的原因：
 *   · **真被占用**（别的进程开着）—— 重试是白等
 *   · **句柄还没释放**（刚被 kill 的子进程，`taskkill /T /F` 返回 ≠ 句柄已释放）
 *     —— 过一会儿就好了
 *
 * 两者从错误码上分不开（都是 `EPERM`/`EBUSY`/"being used by another process"），
 * 所以**一律不重试**，改成：把文件**改名挪走**（`.trash-<时间戳>-<随机>`）。
 * 改名在同一卷上是元数据操作，**不需要删除权限、也不受"打开中"影响**（多数情况）——
 * 于是调用方能继续干活，用户也不会看到一个"因为清理失败而失败"的安装。
 *
 * @returns 是否真的删掉了 —— 调用方**必须**看这个返回值：
 *          "删不掉"与"删掉了"在这台机器上是两种真实结果。
 */
export function removeFileQuiet(target: string): boolean {
  try {
    unlinkSync(target)
    return true
  } catch {
    if (!existsSync(target)) return true // 本来就没有 = 视作成功
  }
  // 删不掉 ⇒ 改名挪走（见上面的说明）。改不动就只能如实返回 false。
  try {
    renameSync(target, `${target}.trash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    return true
  } catch {
    return !existsSync(target)
  }
}

/** 解压 tgz 到目标目录（用系统 tar —— Windows 10+ 自带 bsdtar）。 */
function extractTgz(tgzPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-xzf', tgzPath, '-C', destDir], { stdio: 'pipe' })
}

/**
 * 把 GitHub 的 archive 链接规范化成 **codeload** 链接。
 *
 *     https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.tar.gz
 *   → https://codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/<branch>
 *
 * ## 为什么要换（对端真机结论，我们照做）
 *
 *   · **官方 codeload 无重定向、无 API 配额**（`github.com/.../archive/...` 会 302 到它，
 *     而 `api.github.com/.../tarball/...` 未认证只有 60 次/小时）
 *   · 对端在**本机实测 codeload `200` 可用**，所以这是主通道而不是备选
 *
 * 认不出形态就返回 undefined（原样走原 URL，不做猜测）。
 */
export function toCodeloadUrl(url: string): string | undefined {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/archive\/refs\/(heads|tags)\/(.+)\.tar\.gz$/i.exec(
    url.trim(),
  )
  if (!m) return undefined
  const [, owner, repo, kind, ref] = m
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/${kind}/${ref}`
}

/** 一个下载通道：稳定 id（记忆用）+ 名字（审计用）+ 真实 URL。 */
interface DownloadChannel {
  /**
   * 稳定标识（如 `codeload` / `ghproxy` / `direct`）。
   *
   * ⚠️ **记忆必须按 id 存，不能按 URL 模板存** —— 对端点明的一处：
   * 他们的 git URL 与仓库无关、模板可复用；而我们的 archive URL **带 owner/repo/branch**，
   * 存模板会"每仓库一条、永远记不住"。
   */
  id: string
  name: string
  url: string
}

/**
 * 把**仓库地址**展开成 archive 候选（含分支回退）。
 *
 * 用户贴的多半是仓库地址而不是 archive 地址：
 *
 *     https://github.com/<o>/<r>                 ← 最常见
 *     https://github.com/<o>/<r>/tree/<branch>  ← 从浏览器地址栏复制来的
 *
 * 这两种原先都会当成"不是 archive 链接"→ 直连拉下来一个 **HTML 页面** → 解包报错 ✗。
 * 展开成：
 *
 *     /tree/<branch> 给了分支 ⇒ 该分支优先
 *     其余按 **main → master → dev** 补足，最多 3 条
 *
 * 为什么带 dev：对端真机记录 —— dsh-web 的默认分支就是 `dev`，
 * 分支猜错时 archive 会 404，得能自己找回来。
 */
export function expandGitHubRepoUrl(url: string): string[] {
  const m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\/tree\/([^/\s]+))?\/?$/i.exec(url.trim())
  if (!m) return []
  const [, owner, repo, branch] = m
  const order: string[] = []
  if (branch) order.push(branch)
  for (const b of ['main', 'master', 'dev']) {
    if (!order.includes(b)) order.push(b)
  }
  return order.slice(0, 3).map((b) => `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${b}`)
}

/**
 * 为一个 URL 排出**下载通道表**（按可信度排序）。
 *
 * GitHub archive 类：codeload（官方、无重定向、无配额）→ ghproxy（镜像兜底，**可能 0 B/s**）→ 原 URL。
 * GitHub **仓库**类：按分支回退展开成最多 3 条 codeload（每条各自探活）。
 * 其它：原 URL 直连。
 *
 * ⚠️ 镜像**不能硬编码成唯一出路**：对端记录 `mirror.ghproxy.com` 早已失效并被停放页接管 ——
 * 所以镜像只做**兜底**，且必须能失败后继续。
 */
export function downloadChannelsFor(url: string): DownloadChannel[] {
  const trimmed = url.trim()
  const codeload = toCodeloadUrl(trimmed)
  if (codeload) {
    return [
      { id: 'codeload', name: 'codeload', url: codeload },
      { id: 'ghproxy', name: 'ghproxy', url: `https://ghproxy.net/${trimmed}` },
      { id: 'github-direct', name: 'github-direct', url: trimmed },
    ]
  }

  const expanded = expandGitHubRepoUrl(trimmed)
  if (expanded.length > 0) {
    return expanded.map((u) => ({
      id: `codeload-${u.split('/').pop()}`,
      name: `codeload(${u.split('/').pop()})`,
      url: u,
    }))
  }

  return [{ id: 'direct', name: 'direct', url: trimmed }]
}

/* ══════════════════════════════════════════════════════════════════════
 * 记忆：上次成功的通道（对端参考实现的第一块）
 *
 * 三条纪律照抄（都是他们真机踩出来的）：
 *   1. 读盘失败**返回空**，绝不抛 —— 记忆只是优化
 *   2. 写盘失败**静默** —— 不能因为"记不住"就装不上
 *   3. 排序是**纯函数**，便于离线断言
 * ══════════════════════════════════════════════════════════════════════ */

/** 记忆文件放在 cards 的**同级**（`$DSH_HOME/connection-cards/download-memo.json`）。 */
function memoPathFor(cardsRoot: string): string {
  return join(dirname(cardsRoot), 'download-memo.json')
}

/** 读"上次成功的通道 id"。任何异常都当没有（绝不抛）。 */
export function readDownloadMemo(cardsRoot: string): string {
  try {
    const raw = readFileSync(memoPathFor(cardsRoot), 'utf8')
    const parsed = JSON.parse(raw) as { channelId?: unknown }
    return typeof parsed.channelId === 'string' ? parsed.channelId : ''
  } catch {
    return ''
  }
}

/** 记住这次成功的通道。**写盘失败静默**。 */
export function rememberDownloadChannel(cardsRoot: string, channelId: string): void {
  try {
    writeFileSync(
      memoPathFor(cardsRoot),
      JSON.stringify({ channelId, at: Date.now() }, null, 2),
      'utf8',
    )
  } catch {
    /* 记忆只是优化 —— 写不进就算了 */
  }
}

/**
 * 把上次成功的通道**挪到最前**，其余顺序不变（纯函数）。
 *
 * 为什么值钱：在"直连不通、只有某个镜像可用"的环境里，这一步省掉一整轮无谓探活/失败等待。
 */
export function orderChannels(
  channels: DownloadChannel[],
  preferredId: string,
): DownloadChannel[] {
  if (!preferredId) return channels
  const i = channels.findIndex((c) => c.id === preferredId)
  if (i <= 0) return channels
  const out = [...channels]
  const [hit] = out.splice(i, 1)
  out.unshift(hit!)
  return out
}

/**
 * 下载失败的**归因**（对端参考实现里最有用的一段）。
 *
 * 关键是识别出"**本机代理/证书拦截**"这一类 —— 今天撞的
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 与 `CRYPT_E_NO_REVOCATION_CHECK` 都在这一类里。
 * 指引里写"检测到本机加速器/代理，建议关掉再试"比"请检查网络"有用一个量级。
 */
export function classifyDownloadFailure(text: string): { kind: 'intercepted' | 'unreachable' | 'timeout'; note: string } {
  const t = String(text ?? '')
  /**
   * ⚠️ **两个来源的超时都要认**（对端点明的一条）：
   *   · 我们自己的 exec 超时 → `ETIMEDOUT` / killed
   *   · **curl 自己的 `--max-time` 超时 → `curl: (28) Operation timed out`，不带任何标志位**
   * 只认前者会把 curl 超时归成"未知失败"，归因就错了。
   *
   * ⚠️⚠️ **但绝不能只写 `timeout` 这个词**：Node 抛错时会把**整条命令行**回显在消息里，
   * 而我们的命令行里就有 `--connect-timeout` / `--max-time` ⇒ 那会让**任何** curl 失败
   * 都被归成"超时"（实测踩到：一个 404 被报成"超时，包可能较大" ✗）。
   * 所以只认**精确形态**：curl 的退出码 `(28)`、`ETIMEDOUT`、`timed out`。
   */
  if (/curl: \(28\)|ETIMEDOUT|timed out|Operation timed out|killed/iu.test(t)) {
    return { kind: 'timeout', note: `超时（${t.slice(0, 90)}）—— 包可能较大或链路慢，可重试或换通道` }
  }
  if (
    /certificate|CERT_|self[- ]signed|UNABLE_TO_VERIFY|CRYPT_E_|SSL|TLS|proxy|ECONNREFUSED|ERR_PROXY/iu.test(
      t,
    )
  ) {
    return {
      kind: 'intercepted',
      note: `本地代理/证书拦截（${t.slice(0, 90)}）—— 检测到本机有加速器/代理，建议关闭后重试`,
    }
  }
  return { kind: 'unreachable', note: `网络不可达（${t.slice(0, 90) || '连接失败'}）` }
}

/** `curl.exe` 是否存在（Windows 上必须显式带 .exe —— 见 downloadTo 的说明）。 */
let curlChecked = false
let curlAvailable = false
function hasCurl(): boolean {
  if (curlChecked) return curlAvailable
  curlChecked = true
  try {
    execFileSync(CURL_BIN, ['--version'], { stdio: 'pipe', timeout: 10_000 })
    curlAvailable = true
  } catch {
    curlAvailable = false
  }
  return curlAvailable
}

/**
 * ⚠️ **必须显式 `curl.exe`**：在 PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，
 * 直接调 `curl` 可能拿到一个完全不同的东西（对端特别提醒过）。
 * Node 的 execFileSync 不走 shell，但仍显式写全名以免歧义。
 */
const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl'

/**
 * **通道探活** —— "提前判死"，别让一个死镜像把安装拖满超时。
 *
 * ## 策略（对端真机结论，照抄）
 *
 *   · 超时**只给 4 秒** —— 它是"提前判死"用的，不能自己变成白等
 *   · **403 / 405 按活着处理** —— 很多镜像不支持 HEAD，判死会误杀
 *   · 404 才算真死（地址没有这个包）
 *
 * ## 为什么用 curl（而不是 fetch）
 *
 * 与本文件其它地方同因：这台机器上 Node 的 fetch 连 github 类主机会
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，拿它探活等于**永远判死**。
 * 没有 curl 时**不探活**（按活着处理）—— 宁可多试一次，也不能因为探不了就跳过。
 *
 * ## 与对端实现的差异（按我们的边界裁剪）
 *
 * 他们探的是 **git 智能 HTTP**（`…/info/refs?service=git-upload-pack` + pkt-line 校验）；
 * 我们只下 HTTP archive，`HEAD` 判活足够 —— git 那套整块不抄。
 */
export function probeChannel(url: string, timeoutMs = 4000): { alive: boolean; note: string } {
  if (!hasCurl()) return { alive: true, note: '没有 curl，跳过探活（直接试下载）' }
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000))
  try {
    const out = execFileSync(
      CURL_BIN,
      [
        /**
         * ⚠️ `-f`（fail on HTTP error）在探活里**不能**加：`-f` 会让 4xx/5xx 直接变退出码，
         * 于是我们就拿不到状态码、没法实现"**403/405 按活着处理**"那条策略了。
         * 探活靠 `%{http_code}` 判，不靠退出码。
         */
        '-sS',
        '-I',
        '-o', process.platform === 'win32' ? 'NUL' : '/dev/null',
        '-w', '%{http_code}',
        '--max-time', String(secs),
        '--ssl-no-revoke',
        url,
      ],
      { stdio: 'pipe', timeout: timeoutMs + 2000, killSignal: 'SIGKILL', encoding: 'utf8' },
    )
    const code = Number(String(out ?? '').trim().split(/\s+/).pop())
    if (Number.isFinite(code)) {
      if (code >= 200 && code < 400) return { alive: true, note: `HTTP ${code}` }
      // 镜像常不支持 HEAD —— 判死会误杀
      if (code === 403 || code === 405) {
        return { alive: true, note: `HTTP ${code}（不支持 HEAD，按活处理）` }
      }
      if (code === 404) return { alive: false, note: 'HTTP 404（该地址没有这个包）' }
      return { alive: false, note: `HTTP ${code}` }
    }
    return { alive: true, note: '探活没拿到状态码（按活处理，交给实际下载判）' }
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e)
    return { alive: false, note: classifyDownloadFailure(text).note }
  }
}

/** curl 下载的总时限（秒）。对端 archive 给 180 秒（真机 429MB / 4MB/s ≈ 105 秒），我们取更宽。 */
const CURL_MAX_TIME_SEC = 300

/**
 * 本插件版本 —— **印进失败指引**（对端建议）。
 *
 * 为什么值：我们已经有"看报错长什么样"的口诀（旧代码光秃秃一句 `fetch failed`，
 * 新代码列通道/字节/归因），但那**依赖用户对比记忆**。
 * 印版本号是**零推理的确定性判据** —— 用户报问题时，一眼就知道他跑的是哪一版。
 * 这条直接服务于"测试全绿但用户看到旧行为"那类误读（README「已知坑」）。
 */
const PLUGIN_VERSION = (() => {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    const v = (JSON.parse(raw) as { version?: unknown }).version
    return typeof v === 'string' ? v : 'unknown'
  } catch {
    return 'unknown'
  }
})()

/**
 * **磁盘口径的实传字节数** —— 判进度以它为准。
 *
 * ## 为什么不解析 curl 的 `-w`（对端点明的更权威口径）
 *
 * `-w` 的输出**在进程被杀时可能根本没有**（我们这边表现为"空串"，
 * 见 `bytesFromExecError` 那一串判空）。而 `.part` 的**实际大小是权威口径**：
 * 跨平台、跨 curl 版本、**被杀也准**，还不依赖 stdout 是否被捕获。
 *
 * 于是"拿不到字节数就只能不赌"这件事**从根上消失** —— 永远拿得到。
 * `-w` 的数字退化为**辅助信息**（平均速率有意义，字节数以磁盘为准）。
 *
 * ⚠️ 这只是"量了多少"，**不代表完整性**：截断由后面的 `tar -xzf` 兜住
 * （截断的 gzip 解包会报错，不会被当成成功）。
 */
export function partSizeOnDisk(partPath: string): number {
  try {
    return statSync(partPath).size
  } catch {
    return 0
  }
}

/**
 * 从 `execFileSync` 抛出的错误里取 curl `-w` 报的**实传字节数**（辅助信息）。
 *
 * 为什么取得到：命令带了 `-w '%{size_download} …'`，而 Node 的 `execFileSync`
 * 抛错时会把**已经产生的 stdout/stderr 挂在 error 上**（`error.stdout`）。
 *
 * ⚠️ **JS 的"空/无"与"零"默认会被混为一谈**，这一族坑值得一起记：
 *
 *     Number('')  === 0       // ← 我们真踩到的那个
 *     Number(' ') === 0       // 空格同理
 *     +' '        === 0
 *     parseInt('') === NaN    // 唯独 parseInt 例外；但 parseInt('12abc') === 12（部分解析）
 *
 * 所以凡"缺失"与"计数为 0"**结论相反**的地方，都要**前置判空** ——
 * 并且"结论相反的两个分支"必须**各自有断言**，否则它就以"偶尔误判"的形态永远活着。
 *
 * @returns 字节数；拿不到返回 -1（与"传了 0 字节"是**两种**情况，不能混）
 */
export function bytesFromExecError(e: unknown): number {
  const out = (e as { stdout?: unknown } | null)?.stdout
  const first = String(out ?? '').trim().split(/\s+/)[0] ?? ''
  if (first === '') return -1
  const n = Number(first)
  return Number.isFinite(n) ? n : -1
}

/** 一个文件/目录是否**非空**（下载成没成功的最终判据）。 */
function isNonEmptyDir(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0
  } catch {
    return false
  }
}

/**
 * 下载一个文件到本地 —— **通道表 + 探活 + 逐通道重试**。
 *
 * ## 为什么 curl 优先，而不是 Node 的 fetch（对端真机结论，与我们实测一致）
 *
 *     Node fetch（自带/打包 CA）→ github：UNABLE_TO_VERIFY_LEAF_SIGNATURE
 *     系统 curl（schannel）    → 只差吊销检查，--ssl-no-revoke 即过
 *
 * 也就是说：在这台机器上 **curl 是唯一稳的那条**，fetch 只是备选。
 * 反过来写（fetch 优先）等于**每次都先白等一轮证书失败** —— 我们最初就是这么写的。
 *
 * ## 停滞按**字节增长**判，不只看总超时
 *
 * `--speed-limit 1 --speed-time 45`：**45 秒内平均速率低于 1 B/s 就中止** ——
 * 这正是"卡死"的形态（对端记录 ghproxy 卡死是精确的 0 B/s）。
 * 只靠总超时会把白等拉长，而且大包正常下载也会被误杀。
 *
 * ## 落盘用临时文件 + rename
 *
 * 半截包最坑：直接写目标文件，一次失败就留下一个"看起来装好了"的残包。
 */
async function downloadTo(
  url: string,
  destPath: string,
  auditLog: (msg: string) => void,
  cardsRoot: string,
): Promise<{ ok: boolean; via?: string; reason?: string }> {
  const preferred = readDownloadMemo(cardsRoot)
  const channels = orderChannels(downloadChannelsFor(url), preferred)
  if (preferred && channels[0]?.id === preferred) {
    auditLog(`按记忆优先走 ${preferred}（上次成功的通道）`)
  }
  const errors: string[] = []
  /** 每个通道**实际传了多少字节** —— 对端点明：失败指引里要有这个数字。 */
  const transferred: string[] = []

  for (const [i, ch] of channels.entries()) {
    /**
     * ⚠️ 临时文件**必须与目标同卷**（所以是 `dest + '.part'`，不是 `tmpdir()` 下的某个路径）。
     *
     * 为什么：收尾用的是 `renameSync` —— **跨卷 rename 不是元数据操作**，
     * 会退化成"复制 + 删除"，于是既慢、又会被"文件正被打开"挡住，
     * 我们就失去了"改名降级"这个兜底（见 `removeFileQuiet`）。
     * 以后若有人想把临时目录挪到系统 tmp，请先想清楚这一条。
     */
    const partPath = `${destPath}.part`
    /**
     * ⚠️ **每次尝试前先删掉上一次的半截文件**（对端点明的一条）。
     *
     * 不删的话：上一个通道失败后留下非空的 `.part`，下一个通道**立刻失败**时，
     * 下面的"非空即成功"判断会把**上一次的残包**当成本次成功 ✗
     * —— 装出来的是坏包，而日志看着一切正常。
     *
     * （他们那边是"每次尝试用唯一目录 + 内容就绪才 rename"；我们 rename 的是文件，
     *   所以等价做法就是每次清干净。）
     */
    removeFileQuiet(partPath)

    /**
     * 探活**只对非首选通道**做。
     *
     * 首选通道（记忆命中的、或表里第一个）直接试 —— 它最可能成功，
     * 先探一次纯属多一个来回。而**镜像兜底位**值得先花 4 秒判死：
     * 死镜像的典型形态是挂住不动（对端记录：精确的 0 B/s），
     * 那会白等到停滞判死（45 秒）才换下一个。
     */
    if (i > 0) {
      const probe = probeChannel(ch.url)
      if (!probe.alive) {
        auditLog(`跳过通道 ${ch.name}：${probe.note}`)
        errors.push(`${ch.name}: 探活未过（${probe.note}）`)
        continue
      }
    }

    // ① curl（系统 TLS 栈）—— 首选
    if (hasCurl()) {
      /**
       * **同通道最多试两次**，第二次**加时**（1.75×）—— 对端给的判据：
       *
       *   实传 `0` 字节 ⇒ 连上但不传（对端记录：镜像卡死是**精确的 0 B/s**）
       *                    ⇒ 加时只是把白等拉长，**立刻换通道**
       *   实传 > 0 字节 ⇒ 在传、只是慢（大仓库首包慢常见）
       *                    ⇒ **值得同通道加时再试一次**
       *
       * 于是 300 秒这个预算花在"值得等"的地方，而不是花在死镜像上。
       */
      const timeouts = [CURL_MAX_TIME_SEC]
      for (let a = 0; a < timeouts.length; a++) {
        try {
          const out = execFileSync(
            CURL_BIN,
            [
              /**
               * ⚠️ **`-f` 必须有**（对端点明的一条）：不带它时，站点返回 404/500 的
               * **错误页会被原样存成 tar.gz**，随后 tar 报"这不是 gzip 文件"之类，
               * 把排查方向带偏。带上 `-f`，HTTP 层错误直接算失败，归因才准。
               *
               * 其它参数的分工：
               *   `--max-time`  总上限（archive 给宽些：对端真机 429MB / 4MB/s ≈ 105 秒）
               *   `--speed-limit/--speed-time` 停滞判死（45 秒内 <1 B/s 即中止）
               *
               * 进程退出语义：这里用 **`execFileSync`（同步）** —— 它**必然等到子进程退出**
               * 才返回/抛错。对端点明的那条 Windows 陷阱（"taskkill 返回 ≠ 句柄已释放"）
               * 因此天然不适用于这条路径；真正需要防的是**清理/改名撞上未释放的句柄**，
               * 那个由 `removeFileQuiet()` 的"改名降级"兜住。
               */
              '-sSLf',
              '--ssl-no-revoke',
              '--connect-timeout', '15',
              '--max-time', String(timeouts[a]),
              '--speed-limit', '1',
              '--speed-time', '45',
              '-w', '%{size_download} %{speed_download}',
              '-o', partPath,
              ch.url,
            ],
            { stdio: 'pipe', timeout: (timeouts[a]! + 30) * 1000, killSignal: 'SIGKILL', encoding: 'utf8' },
          )
          const [bytes, speed] = String(out ?? '').trim().split(/\s+/)
          /** ⚠️ 判进度用**磁盘口径**（`-w` 被杀时可能没有输出；见 partSizeOnDisk 的说明）。 */
          const onDisk = partSizeOnDisk(partPath)
          transferred.push(`${ch.name}: ${onDisk} 字节（磁盘口径）`)
          if (onDisk > 0) {
            renameSync(partPath, destPath)
            rememberDownloadChannel(cardsRoot, ch.id)
            if (ch.name !== 'direct') {
              auditLog(
                `下载走 ${ch.name}（curl，${onDisk} 字节` +
                  `${speed ? `，均速 ${Math.round(Number(speed) / 1024)} KB/s` : ''}）`,
              )
            }
            return { ok: true, via: `curl:${ch.name}` }
          }
          errors.push(`${ch.name}: curl 返回成功但磁盘上是 0 字节（-w 报 ${bytes || '(无)'}）`)
          break
        } catch (e) {
          const text = e instanceof Error ? e.message.slice(0, 90) : String(e)
          /** 磁盘口径 —— 中途被杀也拿得到（这正是换它的原因）。 */
          const got = partSizeOnDisk(partPath)
          if (got > 0) transferred.push(`${ch.name}: ${got} 字节后中断（磁盘口径）`)
          else transferred.push(`${ch.name}: 0 字节（磁盘口径；-w 报 ${bytesFromExecError(e)}）`)
          errors.push(`${ch.name}: curl ${text}`)

          /**
           * 只加时**一次**，且只在"确实传了东西"时。
           * 记得清掉半截文件 —— 否则下一轮"非空即成功"会把残包当成品。
           */
          if (a === 0 && got > 0) {
            timeouts.push(Math.round(CURL_MAX_TIME_SEC * 1.75))
            auditLog(`${ch.name} 已传 ${got} 字节后中断 ⇒ 同通道加时重试一次`)
            removeFileQuiet(partPath)
            continue
          }
          break
        }
      }
    }

    // ② Node fetch —— 备选（registry 类通常走这条没问题）
    try {
      const resp = await fetch(ch.url)
      if (!resp.ok) {
        errors.push(`${ch.name}: HTTP ${resp.status}`)
      } else {
        const buf = Buffer.from(await resp.arrayBuffer())
        transferred.push(`${ch.name}: ${buf.length} 字节`)
        if (buf.length === 0) {
          errors.push(`${ch.name}: fetch 返回空文件`)
        } else {
          writeFileSync(partPath, buf)
          renameSync(partPath, destPath)
          rememberDownloadChannel(cardsRoot, ch.id)
          auditLog(`下载走 ${ch.name}（fetch，${buf.length} 字节）`)
          return { ok: true, via: `fetch:${ch.name}` }
        }
      }
    } catch (e) {
      const text = e instanceof Error ? e.message.slice(0, 90) : String(e)
      errors.push(`${ch.name}: fetch ${text}`)
    }
  }

  /**
   * 归因：把"证书/代理拦截"与"网络不可达"分开说 ——
   * 前者有**可执行的下一步**（关掉加速器/代理），后者才是真的网络问题。
   */
  const attribution = classifyDownloadFailure(errors.join(' | '))
  return {
    ok: false,
    reason:
      `下载失败，已试过 ${channels.length} 个通道：` +
      errors.map((e) => `\n    · ${e}`).join('') +
      (transferred.length > 0 ? `\n  各通道实传（磁盘口径）：${transferred.join('；')}` : '') +
      `\n  归因：**${attribution.note}**` +
      `\n  可执行的下一步（按可信度排序）：` +
      `\n    1) 若能拿到 codeload 链接，直接用它（官方通道，无重定向、无 API 配额）` +
      `\n    2) 若这是 npm 包，改用包名安装（走 registry）` +
      `\n    3) 镜像兜底：在 GitHub 链接前加 https://ghproxy.net/（镜像可能不稳，需自行探活）` +
      /**
       * **版本号**：零推理的"你跑的是哪一版"判据（见 PLUGIN_VERSION 的说明）。
       * 报问题时带上这一行，就不用猜"是不是旧代码"了。
       */
      `\n  —— 连接卡片宿主 v${PLUGIN_VERSION}`,
  }
}

/**
 * 找到解包目录里的**包根**。
 *
 * 三种常见布局（都实测过）：
 *
 *   1. `package/`            —— npm registry 的 tarball 约定
 *   2. **唯一的一层子目录**   —— GitHub 归档（`仓库名-main/`）、部分 HTTP tgz 分发
 *   3. 就是解包目录本身       —— 已经把内容打在根上的包
 *
 * 先说背景：最初只认第 1 种，于是**从 GitHub 下载的插件一律装不上**
 * （报"包里没有 package.json"）—— 用户给的正是 GitHub 链接，必须支持。
 *
 * 判定"唯一子目录"时只认目录、忽略 `__MACOSX` 之类噪音，且**必须**能在里面找到
 * `package.json` 才采用 —— 否则宁可回退到解包目录本身（让上游给出准确的拒绝理由，
 * 而不是在这里瞎猜一层）。
 */
function packageRootUnder(unpacked: string): string {
  const fromRegistry = join(unpacked, 'package')
  if (existsSync(join(fromRegistry, 'package.json'))) return fromRegistry

  let entries: string[]
  try {
    entries = readdirSync(unpacked, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '__MACOSX')
      .map((e) => e.name)
  } catch {
    return unpacked
  }

  /**
   * 顺序很重要（对端点明的一条）：
   *
   *   1. **解包目录自己**有 package.json ⇒ 就是它（monorepo / 套装仓库常见）
   *   2. 唯一子目录有 package.json ⇒ 是它（GitHub 归档 `仓库名-分支/`）
   *   3. 唯一子目录（**不看 package.json**）⇒ 也认它
   *
   * ⚠️ 第 3 条是**放宽**，理由：判据用"有没有 package.json"会把
   * **纯技能仓库 / 示例仓库 / 套装仓库**（根目录没有 package.json）全部误判成"失败"。
   * 下载成没成功，看的是"**解压后有东西**"；"这包里有没有 package.json"是**上层**的判断，
   * 而且它该给出**另一句错误**（"下到了但不是插件包" ≠ "下载失败"）。
   */
  if (existsSync(join(unpacked, 'package.json'))) return unpacked

  if (entries.length === 1) return join(unpacked, entries[0]!)

  return unpacked
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
      sourceDir = packageRootUnder(unpacked)
    } else if (kind === 'tgz-url') {
      const tgzPath = join(work, 'download.tgz')
      const dl = await downloadTo(raw, tgzPath, auditLog, cardsRoot)
      if (!dl.ok) throw new Error(dl.reason ?? '下载失败')
      const unpacked = join(work, 'unpacked')
      extractTgz(tgzPath, unpacked)
      sourceDir = packageRootUnder(unpacked)
    } else {
      sourceDir = await fetchNpm(raw, work)
    }

    // ── 先校验来源，再动目标目录 ──
    //
    // 两种来源都接受（见 package-check.ts）：卡片包，以及**普通 DSH 插件包**
    // （后者由安装器合成适配清单 —— 用户明确要求能装这类，因为
    // "会话能力相关的基本都是普通插件包"）。
    /**
     * ⚠️ **"解压后是空的"必须先单独判**（对端点明的一条）。
     *
     * 判据分层是：**下载成没成功 = 解压后有东西**；"这包里有没有 package.json"是**上层**的事。
     * 若把"空解压"也交给 checkPackage，用户看到的会是
     * "包里没有 package.json" —— 那是**误导**：真正的原因是**没下下来/解压失败**。
     * 两句话指向完全不同的排查方向，所以这里分开说。
     */
    if (!isNonEmptyDir(sourceDir)) {
      const reason =
        `解压后目录是空的（${sourceDir}）—— 这不是"包里缺少 package.json"，而是**没有拿到内容**：` +
        `压缩包可能损坏、也可能是空的。请重试，或换一个来源地址。`
      auditLog(`卡片安装被拒（${raw}）：${reason}`)
      return { ok: false, reason }
    }

    const check = checkPackage(sourceDir)
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

    /**
     * 普通 DSH 插件包：把合成的适配清单写进**副本**。
     *
     * ⚠️ 两处刻意的设计：
     *   1. **只动副本，不碰来源** —— 原始包一个字节都不改
     *   2. **即使 skipped 也要跑** —— 老版本装下的副本可能还没合成过清单，
     *      这时只跳过拷贝、补写清单即可（幂等；已是适配卡则不动）
     */
    if (check.kind === 'dsh-plugin') {
      const patched = ensureAdapterManifest(destDir, {
        id: cardId,
        name: check.name ?? cardId,
        entry: check.entry ?? 'lib/index.js',
      })
      if (patched.patched) {
        auditLog(
          `[adapter] ${cardId}：这是**普通 DSH 插件包**，已为它合成适配清单` +
            `（能力面默认 tools/effect；需要更多能力时装载阶段会明确拒绝并说明缺什么）`,
        )
      } else if (patched.reason) {
        auditLog(`[adapter] ${cardId}：合成适配清单失败（不影响安装本身）：${patched.reason}`)
      }
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