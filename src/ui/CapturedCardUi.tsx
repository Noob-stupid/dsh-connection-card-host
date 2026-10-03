/**
 * 把**适配卡插件自带的 UI** 渲染进我们的面板（而不是 DSH 全局界面）。
 *
 * ## 它怎么拿到 UI
 *
 *   1. 经 RPC 取卡片的客户端制品**源码**（宿主读文件，浏览器只拿文本）
 *   2. `captureFactory()`：临时换掉 `__ModuleLoader__`、执行源码、拿 `{ id, factory }`，**立刻还原**
 *   3. `instantiateCaptured()`：用**我们自己的 React** 调 factory，给它影子 client ctx，
 *      把它的槽位注册**捕获**下来（不注册进 DSH 的全局槽位）
 *   4. 在这里把捕获到的组件渲染出来
 *
 * ## 两个刻意的设计
 *
 * ### `require` 用我们自己的模块，不转交 DSH 的模块表
 *
 * 插件 factory 里 `require('react')` 必须拿到**同一个 React 实例**，否则 hooks 会炸。
 * 我们自己就是 DSH 的客户端插件 —— 我们 `import` 到的 React 与 DSH 交给我们的
 * 是同一份。所以只转交我们确实有的那几个（react / react/jsx-runtime / react-dom），
 * 别的**明确拒绝**并说清，而不是给个假对象让它跑到一半崩。
 *
 * ### 出错边界（ErrorBoundary）
 *
 * 渲染的是**第三方代码**。它抛错不能让整个面板白屏 —— 所以每个卡片外面包一层边界，
 * 只把这张卡片的 UI 换成一句错误说明（并记审计），面板其余部分照常。
 */

import { createElement, Component, useEffect, useRef, useState, type ReactNode } from 'react'
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'

import {
  captureFactory,
  instantiateCaptured,
  disposeCaptured,
  type CapturedRegistration,
  type ShadowClientCtx,
} from './capture-client.js'
import type { ConnectionCardHostClient } from '../client/host-client.js'

/**
 * 交给第三方 factory 的 `require`。
 *
 * ⚠️ 只转交我们**确实持有**的模块；未知说明符**抛错**（说清我们有什么）——
 * 给假对象会让它在更远的地方崩，那时更难查。
 */
export function makeMiniRequire(): (spec: string) => unknown {
  const table: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': ReactJsxRuntime,
    'react-dom': ReactDom,
  }
  return (spec: string) => {
    if (spec in table) return table[spec]
    throw new Error(
      `客户端插件 require('${spec}')：适配层只转交 react / react/jsx-runtime / react-dom。` +
        `（转交别的会拿到假对象，跑起来只会更难查）`,
    )
  }
}

/** 出错边界：第三方 UI 抛错不该带走整个面板。 */
class CapturedErrorBoundary extends Component<
  { label: string; onError: (message: string) => void; children: ReactNode },
  { error: string | null }
> {
  constructor(props: { label: string; onError: (message: string) => void; children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(e: unknown): { error: string } {
    return { error: e instanceof Error ? e.message : String(e) }
  }

  componentDidCatch(e: unknown): void {
    this.props.onError(`${this.props.label} 渲染失败：${e instanceof Error ? e.message : String(e)}`)
  }

  render(): ReactNode {
    if (this.state.error) {
      return createElement(
        'div',
        { className: 'ccr-captured__error' },
        `这张卡片的 UI 渲染失败：${this.state.error}`,
      )
    }
    return this.props.children
  }
}

export interface CapturedCardUiProps {
  client: ConnectionCardHostClient
  instanceId: string
  /** 显示名（卡片名 + 连接信息），用于分组标题。 */
  label: string
  /** 诊断上报（面板把它转成 client-debug 日志）。 */
  onDiagnostic?: (message: string) => void
}

/**
 * 渲染一张适配卡的 UI（捕获后）。
 *
 * 拿不到 UI 时**安静地不渲染**（纯能力型插件本来就没有 UI）——
 * 但"声明了却没有文件"这类矛盾会显示出来，因为那是需要人看一眼的。
 */
export function CapturedCardUi({ client, instanceId, label, onDiagnostic }: CapturedCardUiProps): ReactNode {
  const [regs, setRegs] = useState<CapturedRegistration[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const shadowRef = useRef<ShadowClientCtx | null>(null)

  useEffect(() => {
    let alive = true
    const diag = (m: string): void => onDiagnostic?.(`[ui-capture] ${m}`)

    void (async () => {
      try {
        const artifact = await client.readCardClientSource(instanceId)
        if (!alive) return
        if (!artifact.ok || !artifact.source) {
          // 没 UI 是正常的；"声明了却没有"这类矛盾要说出来
          if (artifact.reason && /声明了 dsh\.client/.test(artifact.reason)) setNote(artifact.reason)
          else diag(`${instanceId}：${artifact.reason ?? '没有客户端制品'}`)
          return
        }

        const captured = captureFactory(artifact.source)
        const shadow = instantiateCaptured(captured, makeMiniRequire(), diag)
        if (!alive) {
          disposeCaptured(shadow)
          return
        }
        shadowRef.current = shadow
        diag(`${instanceId}：捕获到 ${shadow.registrations.length} 条槽位注册（来源 ${captured.id}）`)
        setRegs(shadow.registrations)
      } catch (e) {
        if (!alive) return
        setNote(e instanceof Error ? e.message : String(e))
        diag(`${instanceId}：UI 捕获失败 —— ${e instanceof Error ? e.message : String(e)}`)
      }
    })()

    return () => {
      alive = false
      // 卸载即清理（插件的 effect/监听不该留在页面上）
      if (shadowRef.current) {
        disposeCaptured(shadowRef.current)
        shadowRef.current = null
      }
    }
  }, [client, instanceId, onDiagnostic])

  if (note) {
    return <div className="ccr-captured__note">{`${label}：${note}`}</div>
  }
  if (!regs || regs.length === 0) return null

  return (
    <section className="ccr-captured">
      <div className="ccr-captured__head">{label}</div>
      {regs.map((reg, i) => (
        <CapturedErrorBoundary
          key={`${reg.slot}-${reg.id ?? i}`}
          label={`${label}（槽位 ${reg.slot}）`}
          onError={(m: string) => onDiagnostic?.(`[ui-capture] ${m}`)}
        >
          <div className="ccr-captured__slot">{reg.slot}</div>
          {/*
            ⚠️ 不给 props：DSH 的槽位通常带 ownerProps，而我们没有那个上下文。
            需要 props 的组件会在这里抛错 → 被边界接住并显示原因（而不是白屏）。
          */}
          {createElement(reg.component as never, {})}
        </CapturedErrorBoundary>
      ))}
    </section>
  )
}
