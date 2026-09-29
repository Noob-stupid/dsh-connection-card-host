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
 */
export async function importCardModule(entryPath) {
    try {
        const url = pathToFileURL(entryPath).href;
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