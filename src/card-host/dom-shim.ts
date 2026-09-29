/**
 * DOM 替身 — 让宿主侧的卡片 `mountPanel(element, api)` 能跑起来。
 *
 * 背景：卡片模块 import 在**宿主进程**（apply 要订阅事件、注册工具），
 * 但按协议 `mountPanel` 收的是 HTMLElement，而宿主没有 DOM。
 * 官方三张卡片只用 `element.innerHTML = ...`，所以给一个「只支持 innerHTML」
 * 的替身即可取回渲染结果，再交给浏览器注入。
 *
 * 局限（诚实说明）：卡片若在 mountPanel 里做真实 DOM 操作
 * （appendChild、事件监听、querySelector 等）不会生效 —— 那些能力只提供
 * 空实现。需要交互式面板的卡片应当导出 `renderPanel(api): string`。
 */

export interface ShimElement {
  innerHTML: string
  textContent: string
  className: string
  readonly tagName: string
  dataset: Record<string, string>
  style: Record<string, string>
  children: unknown[]
  childNodes: unknown[]
  classList: {
    add(...names: string[]): void
    remove(...names: string[]): void
    toggle(name: string): boolean
    contains(name: string): boolean
  }
  appendChild(child: unknown): unknown
  removeChild(child: unknown): unknown
  insertBefore(child: unknown): unknown
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
  removeAttribute(name: string): void
  addEventListener(): void
  removeEventListener(): void
  dispatchEvent(): boolean
  querySelector(): null
  querySelectorAll(): unknown[]
  closest(): null
  remove(): void
  focus(): void
  blur(): void
  getBoundingClientRect(): { top: number; left: number; width: number; height: number }
}

/** 造一个最小可用的 DOM 替身。 */
export function createShimElement(tagName = 'div'): ShimElement {
  const attributes = new Map<string, string>()
  const classes = new Set<string>()

  const shim: ShimElement = {
    innerHTML: '',
    textContent: '',
    className: '',
    tagName: tagName.toUpperCase(),
    dataset: {},
    style: {},
    children: [],
    childNodes: [],
    classList: {
      add: (...names) => { for (const n of names) classes.add(n) },
      remove: (...names) => { for (const n of names) classes.delete(n) },
      toggle: (name) => (classes.has(name) ? (classes.delete(name), false) : (classes.add(name), true)),
      contains: (name) => classes.has(name),
    },
    appendChild: (child) => {
      shim.children.push(child)
      shim.childNodes.push(child)
      return child
    },
    removeChild: (child) => {
      const i = shim.children.indexOf(child)
      if (i >= 0) shim.children.splice(i, 1)
      return child
    },
    insertBefore: (child) => shim.appendChild(child),
    setAttribute: (name, value) => { attributes.set(name, String(value)) },
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => { attributes.delete(name) },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    remove: () => {},
    focus: () => {},
    blur: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  }

  return shim
}
