/**
 * 行元素上承载会话 id 的属性名。
 *
 * ⚠️ **这个常量住在这里是错的** ✗ —— 它被 `src/client/row-map.ts` 用 ✓，
 * 而那个模块是**纯逻辑**（跑在 Node 测试里 ✓）。
 * 把常量定义在一个 `import react` 的文件里 ✗ ⇒ 任何加载 `row-map` 的地方
 * 都**被迫拉起 react** ✓ —— 裸 runner（CI）没有 react ⇒ 测试连**加载**都失败 ✓：
 *
 *     Cannot find package 'react' imported from .../lib/ui/SessionRowMarker.js
 *
 * ⇒ 现在常量**下沉到 `row-map.ts`** ✓（无 react 依赖 ✓），这里改为**从那边引入** ✓。
 * 一条判据：**常量要住在"最先需要它的、依赖最少的那一层"** ✓ ——
 * 住在组件里就等于给纯逻辑绑上了 UI 依赖 ✗。
 */
export { ROW_ID_ATTR } from '../client/row-map.js';
interface SessionRowMarkerProps {
    sessionId: string;
}
export declare function SessionRowMarker({ sessionId }: SessionRowMarkerProps): import("react").JSX.Element;
