/**
 * 受限沙箱 — 卡片模块的动态 import 与执行作用域控制。
 * 阶段 2：做"约束性说明"（卡片代码不 import @deepseek-ai/*），
 * 真正的 import 隔离由 loader 的受限 import 路径实现。
 * 这里提供：动态 import 封装 + 幂等加载守卫 + 崩溃隔离（try/catch）。
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
/**
 * 在受限作用域中动态 import 卡片入口模块。
 * 崩溃隔离：卡片模块 import/apply 抛出异常不会拖垮宿主。
 *
 * ## 缓存失效（bust）—— 以及它**做不到**什么
 *
 * Node 的 ESM 缓存按**解析后的 URL** 命中。原实现直接 `import(url)`，
 * 于是 `reloadCard` 再 import 同一个 URL 只会拿回旧模块 —— **"重载"等于没重载**。
 * 传 `bust` 会给入口 URL 加一个 `?v=` 查询串绕开缓存。
 *
 * ⚠️ **但它只作用于入口本身**：卡片里的 `import './pdf.js'` 解析出的 URL
 * 不带查询串，仍然命中缓存。也就是说：
 *
 *   · **卡片更新走版本化目录** → 整个目录（含所有子模块）都是新 URL → **全部新鲜** ✅
 *   · **同目录下的 `reload`** → 只能保证**入口**新鲜；**子模块可能还是旧的** ⚠️
 *
 * 后者无法在这里根治（除非改写卡片的 import 说明符或换掉整个 loader）。
 * 所以：**改卡片代码请重新安装**（会落进新版本目录），不要指望 `reload` 更新子模块。
 *
 * @param entryPath 卡片入口文件的绝对路径
 * @param bust 缓存失效令牌（每次重载传新值）
 */
export async function importCardModule(entryPath, bust) {
    try {
        const base = pathToFileURL(entryPath).href;
        const url = bust === undefined ? base : `${base}?v=${encodeURIComponent(String(bust))}`;
        const mod = (await import(url));
        if (!mod.apply && !mod.mountPanel) {
            throw new Error(`卡片入口缺少 apply/mountPanel 导出（${entryPath}）`);
        }
        return mod;
    }
    catch (e) {
        // 崩溃隔离：不让卡片加载失败拖垮宿主
        console.error('[CardSandbox] 卡片模块加载失败:', e);
        throw e;
    }
}
/**
 * 解析卡片包的入口文件路径（从 manifest/main 或默认 dist/index.js）。
 * @param cardDir 卡片解压目录
 * @param main package.json 的 main 字段（可选）
 */
export function resolveCardEntry(cardDir, main) {
    if (main)
        return join(cardDir, main);
    return join(cardDir, 'dist', 'index.js');
}
//# sourceMappingURL=sandbox.js.map