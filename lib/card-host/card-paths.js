/**
 * 已安装卡片的目录规则 —— **版本化目录 + current 指针**。
 *
 * ## 为什么必须版本化（2026-10-01 实测撞出来的）
 *
 * 原来是 `cards/<id>/` 单一目录，覆盖安装要 `rmSync` 再写。但卡片**装载后
 * 它的 node_modules 被宿主进程锁住**，Windows 上 `rmSync` 直接 EPERM：
 *
 *     重装 pdf-card → EPERM, Permission denied: ...\cards\pdf-card
 *
 * 结果：**带依赖的卡片一旦装载就再也更新不了**，除非重启宿主。
 * （pnpm 也是因为这个才用版本化存储目录。）
 *
 * ## 现在的规则
 *
 * ```
 * cards/
 *   pdf-card@1.0.0-a1b2c3d4/     ← 内容目录（版本+来源指纹，一次写入不再改）
 *   pdf-card@1.0.1-e5f6g7h8/
 *   pdf-card.current              ← 纯文本，内容是当前生效的目录名
 *   file-watch-card@1.0.0-11223344/
 *   file-watch-card.current
 * ```
 *
 * - **装新版本 = 写新目录 + 改指针**，从不删旧目录 → 不受文件锁影响
 * - 同一份来源重复安装 → 目录名相同 → **直接跳过写入**（幂等，也不撞锁）
 * - 旧目录留给「清理旧版本」在宿主重启后删（那时锁已释放）
 * - **未版本化的老目录（`cards/<id>/`）仍然认**，向后兼容，不需要迁移
 */
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
/** 目录名里允许的字符（避免 `@scope/name` 这种把路径撑成两级的包名）。 */
const SAFE = /[^A-Za-z0-9._@-]/g;
/**
 * 给一个卡片来源目录算指纹（用于版本化目录名）。
 *
 * ⚠️ 不能用**目录自身**的 mtime —— 往已存在的文件里追加内容**不会**改变
 * 父目录的 mtime，那样改了代码指纹却不变，会被当成"同来源"跳过写入
 * （实测踩到：改了 `index.js`，指纹仍是 `68df0483`，更新静默没生效）。
 *
 * 所以遍历**卡片自己的文件**（**跳过 node_modules** —— 那是 npm 装的依赖，
 * 几十 MB，既慢又和卡片代码无关），用 `相对路径:大小:mtime` 组合成指纹。
 *
 * @returns 8 位十六进制指纹
 */
export function fingerprintSourceDir(dir) {
    const entries = [];
    const walk = (cur, depth) => {
        if (depth > 6)
            return;
        let names;
        try {
            names = readdirSync(cur);
        }
        catch {
            return;
        }
        for (const name of names.sort()) {
            if (name === 'node_modules' || name === '.git')
                continue;
            const full = join(cur, name);
            let st;
            try {
                st = statSync(full);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                walk(full, depth + 1);
            }
            else {
                entries.push(`${relative(dir, full)}:${st.size}:${Math.round(st.mtimeMs)}`);
            }
        }
    };
    walk(dir, 0);
    return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 8);
}
/** 把一个卡片 id 变成安全的目录名片段。 */
export function safeCardId(cardId) {
    return cardId.replace(/\//g, '__').replace(SAFE, '_');
}
/**
 * 版本化目录名：`<id>@<version>-<指纹>`。
 *
 * 指纹取自**来源标识**（路径 + 大小 + 修改时间；tgz 用文件指纹）——
 * 来源没变就同名（幂等跳过），来源变了就换新目录（不撞锁）。
 */
export function versionedDirName(cardId, version, sourceKey) {
    const fp = createHash('sha256').update(sourceKey).digest('hex').slice(0, 8);
    return `${safeCardId(cardId)}@${(version ?? '0.0.0').replace(SAFE, '_')}-${fp}`;
}
/** current 指针文件名。 */
export function currentPointerName(cardId) {
    return `${safeCardId(cardId)}.current`;
}
/**
 * 安装来源记录文件名。
 *
 * 存下来才能在以后回答两个问题：
 *   · 这个卡片是从哪装的？（更新要照着同一个来源重装）
 *   · 装的什么版本？（和上游最新版比较，才知道要不要更新按钮亮起来）
 */
export function sourceRecordName(cardId) {
    return `${safeCardId(cardId)}.source.json`;
}
/** 目录名是不是"版本化"形式（含 `@<ver>-<8位指纹>`）。 */
export function parseVersionedDirName(name) {
    const m = /^(.+)@([^@]+)-([0-9a-f]{8})$/.exec(name);
    if (!m)
        return null;
    return { cardId: m[1], version: m[2], fp: m[3] };
}
/** 从「当前指针」的目录名里取版本号（给面板显示"装的是哪一版"）。 */
export function versionFromDirName(name) {
    return parseVersionedDirName(name)?.version;
}
//# sourceMappingURL=card-paths.js.map