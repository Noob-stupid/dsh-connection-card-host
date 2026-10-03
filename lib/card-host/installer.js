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
import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, statSync, unlinkSync, rmdirSync, renameSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { versionedDirName, currentPointerName, parseVersionedDirName, fingerprintSourceDir, sourceRecordName, } from './card-paths.js';
import { checkPackage, ensureAdapterManifest } from './package-check.js';
function classify(spec) {
    const s = spec.trim();
    if (/^https?:\/\//i.test(s))
        return 'tgz-url';
    if (/\.(tgz|tar\.gz)$/i.test(s))
        return 'tgz-file';
    // 存在的本地路径（目录或文件）
    try {
        if (existsSync(resolve(s))) {
            return /\.(tgz|tar\.gz)$/i.test(s) ? 'tgz-file' : 'dir';
        }
    }
    catch {
        /* 非法路径字符等，落到 npm 分支 */
    }
    return 'npm';
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
function removeDirRecursive(target) {
    let entries;
    try {
        entries = readdirSync(target, { withFileTypes: true });
    }
    catch {
        return; // 不存在或读不到：按"已删除"处理（等价于 rmSync 的 force 语义）
    }
    for (const entry of entries) {
        const p = join(target, entry.name);
        if (entry.isDirectory()) {
            removeDirRecursive(p);
            try {
                rmdirSync(p);
            }
            catch {
                /* 非空或占用：留给下一次（不抛，调用方按需统计） */
            }
        }
        else {
            try {
                unlinkSync(p);
            }
            catch {
                /* 被占用：留给下一次 */
            }
        }
    }
    try {
        rmdirSync(target);
    }
    catch {
        /* 目录里还有删不掉的条目：保留它比假装删掉更诚实 */
    }
}
/**
 * 删除一个文件（等价于 `rmSync(p, { force: true })`，但用了**有效的** API）。
 *
 * @returns 是否真的删掉了 —— 调用方**必须**看这个返回值：
 *          "删不掉"与"删掉了"在这台机器上是两种真实结果。
 */
function removeFileQuiet(target) {
    try {
        unlinkSync(target);
        return true;
    }
    catch {
        return !existsSync(target); // 本来就没有 = 视作成功
    }
}
/** 解压 tgz 到目标目录（用系统 tar —— Windows 10+ 自带 bsdtar）。 */
function extractTgz(tgzPath, destDir) {
    mkdirSync(destDir, { recursive: true });
    execFileSync('tar', ['-xzf', tgzPath, '-C', destDir], { stdio: 'pipe' });
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
export function toCodeloadUrl(url) {
    const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/archive\/refs\/(heads|tags)\/(.+)\.tar\.gz$/i.exec(url.trim());
    if (!m)
        return undefined;
    const [, owner, repo, kind, ref] = m;
    return `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/${kind}/${ref}`;
}
/**
 * 为一个 URL 排出**下载通道表**（按可信度排序）。
 *
 * GitHub 类：codeload（官方、无重定向、无配额）→ ghproxy（镜像兜底，**可能 0 B/s**）→ 原 URL。
 * 其它：原 URL 直连。
 *
 * ⚠️ 镜像**不能硬编码成唯一出路**：对端记录 `mirror.ghproxy.com` 早已失效并被停放页接管 ——
 * 所以镜像只做**兜底**，且必须能失败后继续（见 downloadTo 的逐通道重试）。
 */
export function downloadChannelsFor(url) {
    const trimmed = url.trim();
    const codeload = toCodeloadUrl(trimmed);
    if (codeload) {
        return [
            { name: 'codeload', url: codeload },
            { name: 'ghproxy', url: `https://ghproxy.net/${trimmed}` },
            { name: 'github-direct', url: trimmed },
        ];
    }
    return [{ name: 'direct', url: trimmed }];
}
/** `curl.exe` 是否存在（Windows 上必须显式带 .exe —— 见 downloadTo 的说明）。 */
let curlChecked = false;
let curlAvailable = false;
function hasCurl() {
    if (curlChecked)
        return curlAvailable;
    curlChecked = true;
    try {
        execFileSync(CURL_BIN, ['--version'], { stdio: 'pipe', timeout: 10_000 });
        curlAvailable = true;
    }
    catch {
        curlAvailable = false;
    }
    return curlAvailable;
}
/**
 * ⚠️ **必须显式 `curl.exe`**：在 PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，
 * 直接调 `curl` 可能拿到一个完全不同的东西（对端特别提醒过）。
 * Node 的 execFileSync 不走 shell，但仍显式写全名以免歧义。
 */
const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';
/**
 * 下载一个文件到本地 —— **通道表 + 逐通道重试**。
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
async function downloadTo(url, destPath, auditLog) {
    const channels = downloadChannelsFor(url);
    const errors = [];
    for (const ch of channels) {
        const partPath = `${destPath}.part`;
        // ① curl（系统 TLS 栈）—— 首选
        if (hasCurl()) {
            try {
                execFileSync(CURL_BIN, [
                    '-sSL',
                    '--ssl-no-revoke',
                    '--connect-timeout', '15',
                    '--max-time', '300',
                    '--speed-limit', '1',
                    '--speed-time', '45',
                    '-o', partPath,
                    ch.url,
                ], { stdio: 'pipe', timeout: 330_000, killSignal: 'SIGKILL' });
                if (existsSync(partPath) && statSync(partPath).size > 0) {
                    renameSync(partPath, destPath);
                    if (ch.name !== 'direct')
                        auditLog(`下载走 ${ch.name}（curl）`);
                    return { ok: true, via: `curl:${ch.name}` };
                }
                errors.push(`${ch.name}: curl 下到空文件`);
            }
            catch (e) {
                errors.push(`${ch.name}: curl ${e instanceof Error ? e.message.slice(0, 90) : String(e)}`);
            }
        }
        // ② Node fetch —— 备选（registry 类通常走这条没问题）
        try {
            const resp = await fetch(ch.url);
            if (!resp.ok) {
                errors.push(`${ch.name}: HTTP ${resp.status}`);
            }
            else {
                const buf = Buffer.from(await resp.arrayBuffer());
                if (buf.length === 0) {
                    errors.push(`${ch.name}: fetch 下到空文件`);
                }
                else {
                    writeFileSync(partPath, buf);
                    renameSync(partPath, destPath);
                    auditLog(`下载走 ${ch.name}（fetch）`);
                    return { ok: true, via: `fetch:${ch.name}` };
                }
            }
        }
        catch (e) {
            errors.push(`${ch.name}: fetch ${e instanceof Error ? e.message.slice(0, 90) : String(e)}`);
        }
    }
    return {
        ok: false,
        reason: `下载失败，已试过 ${channels.length} 个通道：` +
            errors.map((e) => `\n    · ${e}`).join('') +
            `\n  可执行的下一步（按可信度排序）：` +
            `\n    1) 若能拿到 codeload 链接，直接用它（官方通道，无重定向、无 API 配额）` +
            `\n    2) 若这是 npm 包，改用包名安装（走 registry）` +
            `\n    3) 镜像兜底：在 GitHub 链接前加 https://ghproxy.net/（镜像可能不稳，需自行探活）` +
            `\n  若你所在机器上"Node 的网络被拦、而 curl/系统 git 仍可用"，上面第 1/3 条通常能过。`,
    };
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
function packageRootUnder(unpacked) {
    const fromRegistry = join(unpacked, 'package');
    if (existsSync(join(fromRegistry, 'package.json')))
        return fromRegistry;
    let entries;
    try {
        entries = readdirSync(unpacked, { withFileTypes: true })
            .filter((e) => e.isDirectory() && e.name !== '__MACOSX')
            .map((e) => e.name);
    }
    catch {
        return unpacked;
    }
    if (entries.length === 1) {
        const only = join(unpacked, entries[0]);
        if (existsSync(join(only, 'package.json')))
            return only;
    }
    return unpacked;
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
function copyDirRecursive(src, dst) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
        const from = join(src, entry.name);
        const to = join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(from, to);
        }
        else if (entry.isFile()) {
            copyFileSync(from, to);
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
async function fetchNpm(name, workDir) {
    const metaUrl = `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
    const metaResp = await fetch(metaUrl, {
        headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
    });
    if (!metaResp.ok) {
        throw new Error(`查不到包 ${name}（registry 返回 ${metaResp.status}）`);
    }
    const meta = (await metaResp.json());
    const latest = meta['dist-tags']?.latest;
    const tarball = latest ? meta.versions?.[latest]?.dist?.tarball : undefined;
    if (!tarball)
        throw new Error(`包 ${name} 没有可下载的 tarball`);
    const tgzPath = join(workDir, 'package.tgz');
    const resp = await fetch(tarball);
    if (!resp.ok)
        throw new Error(`下载 tarball 失败（${resp.status}）`);
    writeFileSync(tgzPath, Buffer.from(await resp.arrayBuffer()));
    const outDir = join(workDir, 'unpacked');
    extractTgz(tgzPath, outDir);
    // tarball 内统一以 package/ 为根
    const pkgRoot = join(outDir, 'package');
    return existsSync(pkgRoot) ? pkgRoot : outDir;
}
/**
 * 安装一张卡片到 cardsRoot/<id>/。
 *
 * 幂等：目标已存在时**覆盖**（用户重装/升级的场景），
 * 但先校验来源合法再动目标目录 —— 不能校验失败还把旧的删了。
 */
export async function installCard(spec, cardsRoot, auditLog) {
    const raw = spec.trim();
    if (raw.length === 0)
        return { ok: false, reason: '安装来源不能为空' };
    const kind = classify(raw);
    const work = join(tmpdir(), `ccr-install-${randomUUID()}`);
    mkdirSync(work, { recursive: true });
    try {
        let sourceDir;
        if (kind === 'dir') {
            sourceDir = resolve(raw);
        }
        else if (kind === 'tgz-file') {
            const unpacked = join(work, 'unpacked');
            extractTgz(resolve(raw), unpacked);
            sourceDir = packageRootUnder(unpacked);
        }
        else if (kind === 'tgz-url') {
            const tgzPath = join(work, 'download.tgz');
            const dl = await downloadTo(raw, tgzPath, auditLog);
            if (!dl.ok)
                throw new Error(dl.reason ?? '下载失败');
            const unpacked = join(work, 'unpacked');
            extractTgz(tgzPath, unpacked);
            sourceDir = packageRootUnder(unpacked);
        }
        else {
            sourceDir = await fetchNpm(raw, work);
        }
        // ── 先校验来源，再动目标目录 ──
        //
        // 两种来源都接受（见 package-check.ts）：卡片包，以及**普通 DSH 插件包**
        // （后者由安装器合成适配清单 —— 用户明确要求能装这类，因为
        // "会话能力相关的基本都是普通插件包"）。
        const check = checkPackage(sourceDir);
        if (!check.ok || !check.id) {
            auditLog(`卡片安装被拒（${raw}）：${check.reason}`);
            return { ok: false, reason: check.reason };
        }
        const cardId = check.id.replace(/[^A-Za-z0-9._@-]/g, '_');
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
        const sourceKey = fingerprintSourceDir(sourceDir);
        const dirName = versionedDirName(cardId, check.version, sourceKey);
        const destDir = join(cardsRoot, dirName);
        const pointerPath = join(cardsRoot, currentPointerName(cardId));
        mkdirSync(cardsRoot, { recursive: true });
        let skipped = false;
        if (existsSync(destDir)) {
            // 同名目录已存在 = 同一份来源装过 → 不重写（这正是避开文件锁的关键）
            skipped = true;
        }
        else {
            copyDirRecursive(sourceDir, destDir);
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
            });
            if (patched.patched) {
                auditLog(`[adapter] ${cardId}：这是**普通 DSH 插件包**，已为它合成适配清单` +
                    `（能力面默认 tools/effect；需要更多能力时装载阶段会明确拒绝并说明缺什么）`);
            }
            else if (patched.reason) {
                auditLog(`[adapter] ${cardId}：合成适配清单失败（不影响安装本身）：${patched.reason}`);
            }
        }
        // 改指针（内容极小，不会被锁）
        writeFileSync(pointerPath, dirName, 'utf8');
        // 记下**来源**与版本 —— 以后"检查更新 / 更新"要照着同一个来源重装，
        // 也得知道当前装的是哪一版才能和上游比。指针只回答"在用的是哪个目录"，
        // 回答不了"从哪来的"。
        try {
            const record = {
                spec: raw,
                kind,
                ...(check.version ? { installedVersion: check.version } : {}),
                dirName,
                fingerprint: sourceKey,
                installedAt: Date.now(),
            };
            writeFileSync(join(cardsRoot, sourceRecordName(cardId)), JSON.stringify(record, null, 2), 'utf8');
        }
        catch (e) {
            // 记录写不进去不该让安装失败 —— 只是"更新"能力会退化成"不知道来源"
            auditLog(`卡片来源记录写入失败（不影响安装）：${e instanceof Error ? e.message : String(e)}`);
        }
        auditLog(`卡片已安装：${check.name} v${check.version ?? '?'} (${cardId}) → ${dirName}` +
            (skipped ? '（同来源已存在，跳过写入）' : ''));
        return {
            ok: true,
            cardId,
            dir: destDir,
            ...(check.name ? { name: check.name } : {}),
            ...(check.version ? { version: check.version } : {}),
        };
    }
    catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        auditLog(`卡片安装失败（${raw}）：${reason}`);
        return { ok: false, reason };
    }
    finally {
        removeDirRecursive(work);
    }
}
/** 从已安装目录卸载一张卡片。 */
export function uninstallCard(cardId, cardsRoot) {
    const safe = basename(cardId);
    if (safe !== cardId || safe.length === 0) {
        return { ok: false, reason: '非法的卡片 id' };
    }
    // ── 版本化之后的卸载 ──
    //
    // 目录是 `cards/<id>@<ver>-<fp>/`，靠 `cards/<id>.current` 指认在用的是哪个。
    // **先删指针**（那一步永远成功，且立刻让卡片从列表消失），
    // 再尽力删目录 —— 被宿主锁住时删不掉是**预期内**的，留给"清理旧版本"
    // 在重启后处理，不能因此报卸载失败（否则用户会以为没卸掉）。
    const pointer = join(cardsRoot, currentPointerName(safe));
    const versionedDirs = [];
    try {
        for (const name of readdirSync(cardsRoot)) {
            const parsed = parseVersionedDirName(name);
            if (parsed && parsed.cardId === safe)
                versionedDirs.push(name);
        }
    }
    catch {
        /* 目录读不到就按没有处理 */
    }
    const legacyDir = join(cardsRoot, safe);
    const hasLegacy = existsSync(legacyDir);
    const hasPointer = existsSync(pointer);
    if (!hasLegacy && !hasPointer && versionedDirs.length === 0) {
        return { ok: false, reason: `未安装：${safe}` };
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
                reason: `指针删不掉：${pointer}。` +
                    `卡片会继续留在列表里 —— 这比报"已卸载"却仍在更诚实。` +
                    `常见原因：文件被占用，或安全软件拦下了删除。`,
            };
        }
    }
    // 2) 尽力删目录（锁住就跳过，不算失败）
    let locked = 0;
    const targets = [...versionedDirs.map((n) => join(cardsRoot, n)), ...(hasLegacy ? [legacyDir] : [])];
    for (const dir of targets) {
        removeDirRecursive(dir);
        // 用"还在不在"判断，而不是"有没有抛错" —— 这台机器上删不掉是不抛错的
        if (existsSync(dir))
            locked++;
    }
    return locked > 0
        ? { ok: true, reason: `已卸载；有 ${locked} 个旧目录被占用（重启后清理）` }
        : { ok: true };
}
//# sourceMappingURL=installer.js.map