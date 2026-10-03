/**
 * 读插件的**客户端制品**（宿主侧）—— 把源码文本交给浏览器去捕获。
 *
 * ## 为什么由宿主读，而不是浏览器去 fetch
 *
 * 卡片装在 `$DSH_HOME/connection-cards/cards/…`，浏览器够不到那个路径
 * （也不该给它文件系统访问）。面板已经有 RPC 通道，宿主读文件、把**文本**送过去
 * 是最小暴露面：浏览器拿到的是一段源码，不是一个目录句柄。
 *
 * ## 入口怎么定（按官方约定）
 *
 * 官方 UI 插件指引说：`package.json` 加 `dsh.client` 段，
 * **并提供一个 `./client` 导出**。所以：
 *
 *   1. `exports['./client']` 指向的文件（最准）
 *   2. 退而求其次：`lib/client.js` / `client.js`（常见布局）
 *
 * 两者都没有 ⇒ 这张卡片**没有 UI** ⇒ 返回 `no-client`（不是错误：能力型插件本来就可能没 UI）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
/**
 * 单文件大小上限。
 *
 * ## ⚠️ 原先是 4 MB —— 它把**真插件的 UI** 挡在门外（对端真机实测，根因 5）
 *
 * 证据：`Ayase34/gal-view`（194★, MIT）是当时**全生态唯一同时过两道门的 UI 插件** ✓，
 * 它的 `.dsh-plugin/client.js` = **5,915,546 字节**（自包含 bundle，内联字体/素材 ✓），
 * 并且**确实 `slots.register` ×2** ✓ —— 也就是说：
 *
 *     **挂得上、槽位也注册了，却因为一个 4 MB 常量拿不到源码 ⇒ UI 永远出不来** ✗
 *
 * 同量级：`@nagi-ovo/dsh-ads` 的 client.js = **7,031,124 字节**（同样会被拒）。
 *
 * ⇒ 自包含 bundle 到这个量级是**正常的**（内联素材），不是"多半不对" ✗ ——
 * 原先那句注释的假设是错的 ✓。32 MB 覆盖实测最大值并留出余量 ✓。
 *
 * ⚠️ 仍待办（对端点明，我认同）：**改成流式/分片** ——
 * 单次 JSON 传 6 MB 字符串会顶到 webServer 的 body 上限 ✗。
 * 先做这一行（立刻见效），分片排后面 ✓。
 */
const MAX_BYTES = 32 * 1024 * 1024;
/** 从 package.json 的 exports 里取 `./client`。 */
function clientExportOf(pkg) {
    const ex = pkg.exports;
    if (!ex || typeof ex !== 'object')
        return undefined;
    const entry = ex['./client'];
    if (typeof entry === 'string')
        return entry;
    if (entry && typeof entry === 'object') {
        const o = entry;
        for (const key of ['import', 'default', 'require']) {
            if (typeof o[key] === 'string')
                return o[key];
        }
    }
    return undefined;
}
/**
 * 读一个卡片目录的客户端制品。
 *
 * @param cardDir 卡片目录（我们自己的那一份副本）
 */
export function readClientArtifact(cardDir) {
    const pkgPath = join(cardDir, 'package.json');
    if (!existsSync(pkgPath))
        return { ok: false, reason: '卡片目录里没有 package.json' };
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    }
    catch (e) {
        return { ok: false, reason: `卡片 package.json 读不了：${String(e)}` };
    }
    /**
     * 有 `dsh.client` 段才认为"这张卡片声称有 UI"。
     * 没有该段却存在 lib/client.js 的情况也接住（老包/手写包常见），
     * 但**优先相信声明** —— 声明与文件不一致时以声明为准。
     */
    const declared = Boolean(pkg.dsh && typeof pkg.dsh === 'object' && pkg.dsh.client);
    const candidates = [];
    const fromExports = clientExportOf(pkg);
    if (fromExports)
        candidates.push(fromExports.replace(/^\.\//, ''));
    candidates.push('lib/client.js', 'lib/client.mjs', 'client.js', 'client.mjs');
    for (const rel of candidates) {
        const abs = join(cardDir, rel);
        if (!existsSync(abs))
            continue;
        try {
            const st = statSync(abs);
            if (!st.isFile())
                continue;
            if (st.size > MAX_BYTES) {
                return {
                    ok: false,
                    /**
                     * ⚠️ **文案必须引用常量，不能写死数字**（对端复核抓到的"文案与常量脱节"）。
                     *
                     * 上一版这里硬写着「上限 4 MB」✗ —— 而常量早已改成 32 MB ⇒
                     * 下次真触发时**报出来的数字是错的** ✗。这类错很阴：**它只在出错的路径上出现**，
                     * 平时永远看不到 ✓（而用户恰恰是在出错时才读它 ✗）。
                     */
                    reason: `客户端制品过大（${Math.round(st.size / 1024)} KB > 上限 ${MAX_BYTES / 1024 / 1024} MB）`,
                };
            }
            const source = readFileSync(abs, 'utf8');
            return { ok: true, entry: rel, source };
        }
        catch (e) {
            return { ok: false, reason: `读客户端制品失败（${rel}）：${String(e)}` };
        }
    }
    return {
        ok: false,
        reason: declared
            ? '卡片声明了 dsh.client，但找不到制品文件（试过 exports["./client"] 与 lib/client.js）'
            : '这张卡片没有客户端 UI（没有 dsh.client 段，也没有 lib/client.js）—— 纯能力型插件正常如此',
    };
}
//# sourceMappingURL=client-artifact.js.map