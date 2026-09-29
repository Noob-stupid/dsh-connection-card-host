import type { CardModule } from './registry.js';
/**
 * 在受限作用域中动态 import 卡片入口模块。
 * 崩溃隔离：卡片模块 import/apply 抛出异常不会拖垮宿主。
 */
export declare function importCardModule(entryPath: string): Promise<CardModule>;
/**
 * 解析卡片包的入口文件路径（从 manifest/main 或默认 dist/index.js）。
 * @param cardDir 卡片解压目录
 * @param main package.json 的 main 字段（可选）
 */
export declare function resolveCardEntry(cardDir: string, main?: string): string;
