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
import { existsSync, mkdirSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
/** 解压 tgz 到目标目录（用系统 tar —— Windows 10+ 自带 bsdtar）。 */
function extractTgz(tgzPath, destDir) {
    mkdirSync(destDir, { recursive: true });
    execFileSync('tar', ['-xzf', tgzPath, '-C', destDir], { stdio: 'pipe' });
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
/** 校验一个目录是不是合法的卡片包；返回清单信息或失败原因。 */
function validateCardPackage(dir) {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath))
        return { ok: false, reason: '包里没有 package.json' };
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    }
    catch (e) {
        return { ok: false, reason: `package.json 不是合法 JSON：${String(e)}` };
    }
    if (!pkg.dshCard || typeof pkg.dshCard !== 'object') {
        return {
            ok: false,
            reason: 'package.json 里没有 dshCard 字段 —— 这不是一张卡片包' +
                '（卡片包必须在 dshCard 里声明 id/name/entry）',
        };
    }
    const id = pkg.dshCard.id || pkg.name;
    if (!id)
        return { ok: false, reason: 'dshCard.id 与 package.json 的 name 都缺失，无法确定卡片 id' };
    // 入口：dshCard.entry 优先，其次 package.json.main，再次 index.js
    const entry = pkg.dshCard.entry || pkg.main || 'index.js';
    if (!existsSync(join(dir, entry))) {
        return { ok: false, reason: `入口文件不存在：${entry}` };
    }
    return {
        ok: true,
        id: String(id),
        name: pkg.dshCard.name || pkg.name || String(id),
        version: pkg.version,
        entry,
    };
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
            const inner = join(unpacked, 'package');
            sourceDir = existsSync(inner) ? inner : unpacked;
        }
        else if (kind === 'tgz-url') {
            const tgzPath = join(work, 'download.tgz');
            const resp = await fetch(raw);
            if (!resp.ok)
                throw new Error(`下载失败（HTTP ${resp.status}）`);
            writeFileSync(tgzPath, Buffer.from(await resp.arrayBuffer()));
            const unpacked = join(work, 'unpacked');
            extractTgz(tgzPath, unpacked);
            const inner = join(unpacked, 'package');
            sourceDir = existsSync(inner) ? inner : unpacked;
        }
        else {
            sourceDir = await fetchNpm(raw, work);
        }
        // ── 先校验来源，再动目标目录 ──
        const check = validateCardPackage(sourceDir);
        if (!check.ok || !check.id) {
            auditLog(`卡片安装被拒（${raw}）：${check.reason}`);
            return { ok: false, reason: check.reason };
        }
        const cardId = check.id.replace(/[^A-Za-z0-9._@-]/g, '_');
        const destDir = join(cardsRoot, cardId);
        // 覆盖安装：删掉旧的再搬新的（cpSync 不保证清理多余文件）
        rmSync(destDir, { recursive: true, force: true });
        mkdirSync(cardsRoot, { recursive: true });
        cpSync(sourceDir, destDir, { recursive: true });
        auditLog(`卡片已安装：${check.name} v${check.version ?? '?'} (${cardId}) → ${destDir}`);
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
        rmSync(work, { recursive: true, force: true });
    }
}
/** 从已安装目录卸载一张卡片。 */
export function uninstallCard(cardId, cardsRoot) {
    const safe = basename(cardId);
    if (safe !== cardId || safe.length === 0) {
        return { ok: false, reason: '非法的卡片 id' };
    }
    const dir = join(cardsRoot, safe);
    if (!existsSync(dir))
        return { ok: false, reason: `未安装：${safe}` };
    try {
        rmSync(dir, { recursive: true, force: true });
        return { ok: true };
    }
    catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
}
//# sourceMappingURL=installer.js.map