/**
 * 卡片更新检查与执行。
 *
 * ## 为什么单独一个文件
 *
 * `installer.ts` 管"装"，这里管"**装过之后**"：记录在案的是哪一版、上游有没有新版、
 * 要不要更新。三件事共用"来源记录"这一份数据，但和安装本身是两回事。
 *
 * ## 各来源怎么判断"有没有新版"
 *
 * | 来源 | 判断方式 | 说明 |
 * |:---|:---|:---|
 * | `npm` | `npm view <name> version` | 和记录的 `installedVersion` 比 |
 * | `dir` | 重新算来源指纹 | 指纹变了 = 作者改了本地目录 |
 * | `tgz-file` | 文件大小 + mtime | 粗略但够用 |
 * | `tgz-url` | HTTP HEAD 的 ETag/Last-Modified | 拿不到就说"无法判断" |
 *
 * **拿不到结论时如实说"无法判断"，不猜。** 猜错的更新比不更新更糟。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { currentPointerName, sourceRecordName, versionFromDirName, fingerprintSourceDir, } from './card-paths.js';
/** 读一个卡片的来源记录（没有就返回 null，不抛）。 */
export function readSourceRecord(cardsRoot, cardId) {
    const p = join(cardsRoot, sourceRecordName(cardId));
    if (!existsSync(p))
        return null;
    try {
        const raw = JSON.parse(readFileSync(p, 'utf8'));
        if (!raw.spec || !raw.kind)
            return null;
        return {
            spec: raw.spec,
            kind: raw.kind,
            ...(raw.installedVersion ? { installedVersion: raw.installedVersion } : {}),
            dirName: raw.dirName ?? '',
            ...(raw.fingerprint ? { fingerprint: raw.fingerprint } : {}),
            installedAt: raw.installedAt ?? 0,
        };
    }
    catch {
        return null;
    }
}
/** 当前生效的版本目录名（指针优先，回退到记录）。 */
export function currentDirName(cardsRoot, cardId) {
    const p = join(cardsRoot, currentPointerName(cardId));
    try {
        const t = readFileSync(p, 'utf8').trim();
        if (t)
            return t;
    }
    catch {
        /* 没指针就看记录 */
    }
    return readSourceRecord(cardsRoot, cardId)?.dirName || undefined;
}
/** 查 npm 上某个包的最新版本。查不到返回 undefined（不抛）。 */
function npmLatestVersion(name) {
    try {
        const out = execFileSync('npm', ['view', name, 'version'], {
            stdio: 'pipe',
            timeout: 30_000,
            encoding: 'utf8',
            shell: process.platform === 'win32',
        });
        const v = String(out).trim();
        return v || undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * 检查一个卡片有没有更新。
 *
 * **判断不了时 `hasUpdate` 留空并给 `reason`** —— 面板据此显示"无法检查"而不是
 * 谎报"已是最新"。
 */
export function checkCardUpdate(cardsRoot, cardId) {
    const rec = readSourceRecord(cardsRoot, cardId);
    const dirName = currentDirName(cardsRoot, cardId) ?? '';
    const currentVersion = rec?.installedVersion ?? versionFromDirName(dirName);
    if (!rec) {
        return {
            cardId,
            spec: '(未记录)',
            kind: 'dir',
            dirName,
            ...(currentVersion ? { currentVersion } : {}),
            reason: '没有来源记录 —— 这张卡片是在"记录来源"功能之前装的，或记录被删了。重新安装一次即可获得更新能力。',
        };
    }
    const base = {
        cardId,
        spec: rec.spec,
        kind: rec.kind,
        dirName,
        ...(currentVersion ? { currentVersion } : {}),
    };
    switch (rec.kind) {
        case 'npm': {
            const latest = npmLatestVersion(rec.spec);
            if (!latest) {
                return { ...base, reason: 'npm 查询失败（离线？包名变了？）—— 无法判断' };
            }
            return {
                ...base,
                latestVersion: latest,
                hasUpdate: currentVersion !== latest,
            };
        }
        case 'dir': {
            if (!existsSync(rec.spec)) {
                return { ...base, reason: `来源目录已不存在：${rec.spec}` };
            }
            const now = fingerprintSourceDir(rec.spec);
            return {
                ...base,
                hasUpdate: rec.fingerprint !== undefined && now !== rec.fingerprint,
                ...(rec.fingerprint === undefined ? { reason: '记录里没有指纹，无法比较' } : {}),
            };
        }
        case 'tgz-file': {
            if (!existsSync(rec.spec)) {
                return { ...base, reason: `来源文件已不存在：${rec.spec}` };
            }
            // 本地 tgz 没有"版本"概念，只能看文件有没有变
            const st = statSync(rec.spec);
            const key = `${st.size}:${Math.round(st.mtimeMs)}`;
            return {
                ...base,
                hasUpdate: rec.fingerprint !== undefined && key !== rec.fingerprint,
                ...(rec.fingerprint === undefined ? { reason: '记录里没有指纹，无法比较' } : {}),
            };
        }
        case 'tgz-url':
            return {
                ...base,
                reason: '远程地址没有可靠的版本比较方式（各家 ETag/Last-Modified 行为不一）—— 需要时直接重新安装即可',
            };
        default:
            return { ...base, reason: `未知来源类型：${String(rec.kind)}` };
    }
}
//# sourceMappingURL=updates.js.map