/**
 * 适配层总开关 —— **默认关闭**。
 *
 * 用户要求（`REVERT.md` §4）：开关默认 OFF，需显式开启。
 * 这与项目里另外两处高风险功能的做法一致（抢占的四道闸门）。
 *
 * 三层闸门，缺一不可：
 *
 *   1. **本开关**（默认 false）—— 没开就完全不参与任何流程
 *   2. **卡片申报** —— package.json 里必须有 `dshCard.adapter`；
 *      没有申报的卡片，行为与今天**完全一致**（`adapter-design.md` D4/护栏②）
 *   3. **能力清单** —— 申报的能力逐个校验，未申报的访问当场抛错
 *
 * 为什么默认关：这套东西会**加载第三方代码并注册全局工具**，
 * 是"用户没要求就不该发生"的那类行为。宁可他主动开。
 */

let adapterEnabled = false

/** 适配层是否启用。 */
export function isAdapterEnabled(): boolean {
  return adapterEnabled
}

/**
 * 开关（供配置或测试用）。
 *
 * ⚠️ 不做持久化 —— 持久化会让"以为关了其实还开着"成为可能；
 * 开启应当是一次**显式动作**。
 */
export function setAdapterEnabled(value: boolean): void {
  adapterEnabled = value === true
}
