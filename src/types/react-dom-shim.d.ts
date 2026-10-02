/**
 * `react-dom` 的最小类型声明。
 *
 * ## 为什么需要它
 *
 * `react-dom` 在**运行时**由客户端 externals 提供
 * （见 `tsdown.config.ts` 的 `CLIENT_EXTERNALS`：`react-dom` / `react-dom/client`
 * 都在其中，浏览器侧由 PLATFORM_MODULES 冻结表解析），
 * 所以**不需要**把它装成依赖。
 *
 * 但 `tsc` 只认 `node_modules` 里的类型 —— 本仓库没装 `@types/react-dom`，
 * 于是 `import { createPortal } from 'react-dom'` 会报 TS7016
 * 「Could not find a declaration file」。
 *
 * 与其为了一行 import 装一个包（还会把 react-dom 拉进 devDependencies、
 * 让"运行时由宿主提供"这件事变得含糊），不如在这里声明**我们真正用到的那个函数**。
 *
 * ⚠️ 只声明用到的最小面 —— 不要在这里补全 react-dom 的 API，
 * 那会让人误以为这个仓库自己带 react-dom。
 */
declare module 'react-dom' {
  import type { ReactNode } from 'react'

  /** 把一段 React 节点渲染到宿主容器里（我们用 `document.body` 当顶层宿主）。 */
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactNode
}
