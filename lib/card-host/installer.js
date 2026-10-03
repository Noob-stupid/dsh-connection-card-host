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
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, statSync, unlinkSync, rmdirSync, renameSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
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
            { id: 'codeload', name: 'codeload', url: codeload },
            { id: 'ghproxy', name: 'ghproxy', url: `https://ghproxy.net/${trimmed}` },
            { id: 'github-direct', name: 'github-direct', url: trimmed },
        ];
    }
    return [{ id: 'direct', name: 'direct', url: trimmed }];
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
function memoPathFor(cardsRoot) {
    return join(dirname(cardsRoot), 'download-memo.json');
}
/** 读"上次成功的通道 id"。任何异常都当没有（绝不抛）。 */
export function readDownloadMemo(cardsRoot) {
    try {
        const raw = readFileSync(memoPathFor(cardsRoot), 'utf8');
        const parsed = JSON.parse(raw);
        return typeof parsed.channelId === 'string' ? parsed.channelId : '';
    }
    catch {
        return '';
    }
}
/** 记住这次成功的通道。**写盘失败静默**。 */
export function rememberDownloadChannel(cardsRoot, channelId) {
    try {
        writeFileSync(memoPathFor(cardsRoot), JSON.stringify({ channelId, at: Date.now() }, null, 2), 'utf8');
    }
    catch {
        /* 记忆只是优化 —— 写不进就算了 */
    }
}
/**
 * 把上次成功的通道**挪到最前**，其余顺序不变（纯函数）。
 *
 * 为什么值钱：在"直连不通、只有某个镜像可用"的环境里，这一步省掉一整轮无谓探活/失败等待。
 */
export function orderChannels(channels, preferredId) {
    if (!preferredId)
        return channels;
    const i = channels.findIndex((c) => c.id === preferredId);
    if (i <= 0)
        return channels;
    const out = [...channels];
    const [hit] = out.splice(i, 1);
    out.unshift(hit);
    return out;
}
/**
 * 下载失败的**归因**（对端参考实现里最有用的一段）。
 *
 * 关键是识别出"**本机代理/证书拦截**"这一类 —— 今天撞的
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 与 `CRYPT_E_NO_REVOCATION_CHECK` 都在这一类里。
 * 指引里写"检测到本机加速器/代理，建议关掉再试"比"请检查网络"有用一个量级。
 */
export function classifyDownloadFailure(text) {
    const t = String(text ?? '');
    if (/certificate|CERT_|self[- ]signed|UNABLE_TO_VERIFY|CRYPT_E_|SSL|TLS|proxy|ECONNREFUSED|ERR_PROXY/iu.test(t)) {
        return {
            kind: 'intercepted',
            note: `本地代理/证书拦截（${t.slice(0, 90)}）—— 检测到本机有加速器/代理，建议关闭后重试`,
        };
    }
    return { kind: 'unreachable', note: `网络不可达（${t.slice(0, 90) || '连接失败'}）` };
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
export function probeChannel(url, timeoutMs = 4000) {
    if (!hasCurl())
        return { alive: true, note: '没有 curl，跳过探活（直接试下载）' };
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    try {
        const out = execFileSync(CURL_BIN, [
            '-sS',
            '-I',
            '-o', process.platform === 'win32' ? 'NUL' : '/dev/null',
            '-w', '%{http_code}',
            '--max-time', String(secs),
            '--ssl-no-revoke',
            url,
        ], { stdio: 'pipe', timeout: timeoutMs + 2000, killSignal: 'SIGKILL', encoding: 'utf8' });
        const code = Number(String(out ?? '').trim().split(/\s+/).pop());
        if (Number.isFinite(code)) {
            if (code >= 200 && code < 400)
                return { alive: true, note: `HTTP ${code}` };
            // 镜像常不支持 HEAD —— 判死会误杀
            if (code === 403 || code === 405) {
                return { alive: true, note: `HTTP ${code}（不支持 HEAD，按活处理）` };
            }
            if (code === 404)
                return { alive: false, note: 'HTTP 404（该地址没有这个包）' };
            return { alive: false, note: `HTTP ${code}` };
        }
        return { alive: true, note: '探活没拿到状态码（按活处理，交给实际下载判）' };
    }
    catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        return { alive: false, note: classifyDownloadFailure(text).note };
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
async function downloadTo(url, destPath, auditLog, cardsRoot) {
    const preferred = readDownloadMemo(cardsRoot);
    const channels = orderChannels(downloadChannelsFor(url), preferred);
    if (preferred && channels[0]?.id === preferred) {
        auditLog(`按记忆优先走 ${preferred}（上次成功的通道）`);
    }
    const errors = [];
    /** 每个通道**实际传了多少字节** —— 对端点明：失败指引里要有这个数字。 */
    const transferred = [];
    for (const [i, ch] of channels.entries()) {
        const partPath = `${destPath}.part`;
        /**
         * 探活**只对非首选通道**做。
         *
         * 首选通道（记忆命中的、或表里第一个）直接试 —— 它最可能成功，
         * 先探一次纯属多一个来回。而**镜像兜底位**值得先花 4 秒判死：
         * 死镜像的典型形态是挂住不动（对端记录：精确的 0 B/s），
         * 那会白等到停滞判死（45 秒）才换下一个。
         */
        if (i > 0) {
            const probe = probeChannel(ch.url);
            if (!probe.alive) {
                auditLog(`跳过通道 ${ch.name}：${probe.note}`);
                errors.push(`${ch.name}: 探活未过（${probe.note}）`);
                continue;
            }
        }
        // ① curl（系统 TLS 栈）—— 首选
        if (hasCurl()) {
            try {
                /**
                 * `--write-out` 把**实际下载字节数**与平均速率带回来：
                 * 失败指引里带上它，用户（和我们）才能一眼判断"该换源"还是"该等" ——
                 * `0 B` 说明连上但一个字节都没传（该立刻换通道），有字节在涨则值得加时重试。
                 */
                const out = execFileSync(CURL_BIN, [
                    '-sSL',
                    '--ssl-no-revoke',
                    '--connect-timeout', '15',
                    '--max-time', '300',
                    '--speed-limit', '1',
                    '--speed-time', '45',
                    '-w', '%{size_download} %{speed_download}',
                    '-o', partPath,
                    ch.url,
                ], { stdio: 'pipe', timeout: 330_000, killSignal: 'SIGKILL', encoding: 'utf8' });
                const [bytes] = String(out ?? '').trim().split(/\s+/);
                transferred.push(`${ch.name}: ${bytes || '?'} 字节`);
                if (existsSync(partPath) && statSync(partPath).size > 0) {
                    renameSync(partPath, destPath);
                    rememberDownloadChannel(cardsRoot, ch.id);
                    if (ch.name !== 'direct')
                        auditLog(`下载走 ${ch.name}（curl，${bytes || '?'} 字节）`);
                    return { ok: true, via: `curl:${ch.name}` };
                }
                errors.push(`${ch.name}: curl 返回成功但文件为空`);
            }
            catch (e) {
                const text = e instanceof Error ? e.message.slice(0, 90) : String(e);
                errors.push(`${ch.name}: curl ${text}`);
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
                transferred.push(`${ch.name}: ${buf.length} 字节`);
                if (buf.length === 0) {
                    errors.push(`${ch.name}: fetch 返回空文件`);
                }
                else {
                    writeFileSync(partPath, buf);
                    renameSync(partPath, destPath);
                    rememberDownloadChannel(cardsRoot, ch.id);
                    auditLog(`下载走 ${ch.name}（fetch，${buf.length} 字节）`);
                    return { ok: true, via: `fetch:${ch.name}` };
                }
            }
        }
        catch (e) {
            const text = e instanceof Error ? e.message.slice(0, 90) : String(e);
            errors.push(`${ch.name}: fetch ${text}`);
        }
    }
    /**
     * 归因：把"证书/代理拦截"与"网络不可达"分开说 ——
     * 前者有**可执行的下一步**（关掉加速器/代理），后者才是真的网络问题。
     */
    const attribution = classifyDownloadFailure(errors.join(' | '));
    return {
        ok: false,
        reason: `下载失败，已试过 ${channels.length} 个通道：` +
            errors.map((e) => `\n    · ${e}`).join('') +
            (transferred.length > 0 ? `\n  各通道实传：${transferred.join('；')}` : '') +
            `\n  归因：**${attribution.note}**` +
            `\n  可执行的下一步（按可信度排序）：` +
            `\n    1) 若能拿到 codeload 链接，直接用它（官方通道，无重定向、无 API 配额）` +
            `\n    2) 若这是 npm 包，改用包名安装（走 registry）` +
            `\n    3) 镜像兜底：在 GitHub 链接前加 https://ghproxy.net/（镜像可能不稳，需自行探活）`,
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
            const dl = await downloadTo(raw, tgzPath, auditLog, cardsRoot);
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