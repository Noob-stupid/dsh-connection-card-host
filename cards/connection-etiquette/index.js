// 连接礼仪（紧急度）卡片 —— 只做两件事：
//   1) 幂等 + 惰性地向对端宣告「紧急度四档」策略（quiet 宣告：不进对话流、不唤醒）
//   2) 提供唯一工具 report_connection_note：按调用方给的档位**原样转发**，不判语义
//
// 刻意不做：不订阅事件、不轮询、不重试、无面板 UI、不落盘、不替调用方判断该不该插话。
// 语义判断属于调用方（会话/模型）；本卡只保证「按你给的档位送达」，并留下审计。

/**
 * 策略全文 —— 与同目录 SKILL.md **逐字一致**（test.mjs 有一条逐字校验）。
 */
export const POLICY_TEXT = `连接紧急度礼仪（本卡生效时遵守）

四档语义：
  preempt  叫停：错误的前提正在被执行 / 同块补充且对端正深陷该处
  urgent   插进下一步：更正、能让对方少走弯路的新信息
  normal   排队：一般请求、进展同步
  quiet    只告知：不进对话流、不唤醒

规则 1（更正优先）：我上一条说错了或信息过时 ⇒ 一律 urgent；若判断"对方可能已按错的在做" ⇒ preempt。
  判据只有一句：打断一次的成本 vs 让对方按错误前提干一段活的代价。
规则 2（同块补充）：对端正在修错 + 同一项目同一块 + 我手里有补充报错（按错误签名去重）⇒ 可 preempt 告知。
边界：preempt 是「叫停」不是「抢话」—— 只在上表两种情形用，其余降级（宿主侧另有 5 分钟限流兜底）。
`

/** 允许的紧急度档位；非法值一律**不发送**。 */
const ALLOWED_URGENCY = new Set(['quiet', 'normal', 'urgent', 'preempt'])

/**
 * 宣告状态：**只在内存、不落盘**，且按 api（= 卡片实例）分桶。
 *
 * 为什么不是裸的 module 级 boolean：loader 对同一模板只 import 一次模块，
 * 同一张卡挂在多条连接上时 `apply` 会被调用多次（每个实例一个 api 对象）。
 * 裸 boolean 会让「连接 C1 宣告成功」把 C2 的宣告吃掉 —— 那正是本卡要修的
 * 「静默失效」换一个维度复发。
 */
const declaredByInstance = new WeakMap()

/** 这个实例是否已宣告成功过。 */
function isDeclared(api) {
  return declaredByInstance.get(api) === true
}

/**
 * 发一次策略宣告（quiet）。**幂等由调用方用 isDeclared 保证**：
 * 成功过就不再发；失败**不改状态**，下次工具调用再试。
 *
 * 绝不抛：宣告发不出去（对端冷会话 / 未授权 / scope=both 被拒）不是装载失败的理由；
 * 异常更不能漏给 loader —— 它不 await apply，漏出去就是未处理拒绝。
 */
async function declarePolicy(api) {
  try {
    const r = await api.sendMessage(POLICY_TEXT, { urgency: 'quiet', kind: 'say' })
    if (r?.ok === true) {
      declaredByInstance.set(api, true)
      return true
    }
    // 如实记录：**不把"我以为发了"写成"已宣告"**
    api.log(`策略宣告未送达（declared 保持 false，下次工具调用会再试）：${r?.reason ?? '宿主未说明原因'}`)
    return false
  } catch (e) {
    api.log(`策略宣告抛错（不重试、不影响装载）：${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

/** 证据 → 一行可审计文本（审计要能看到"凭什么插话"）。 */
function evidenceLine(evidence) {
  if (evidence === undefined) return '(未提供)'
  try {
    const json = JSON.stringify(evidence)
    return json === undefined ? String(evidence) : json
  } catch {
    return '(evidence 无法序列化)'
  }
}

export function apply(api) {
  api.log(`connection-etiquette 已装载（scope=${api.scope}）`)

  /**
   * 顺序说明：**先注册工具、再宣告**。
   * 宣告要走真实投递（可能慢、可能失败），把注册排在它后面会让「工具是否可用」
   * 被宣告的时延绑架；而工具自身也会惰性补宣告，所以顺序不影响正确性。
   */
  api.registerTool('report_connection_note', async (args) => {
    const urgency = args?.urgency
    // 非法档位 ⇒ 不发送（也不顺手补宣告：这一调用不该产生任何投递）
    if (!ALLOWED_URGENCY.has(urgency)) {
      return { ok: false, reason: 'bad-urgency' }
    }
    // 证据先落日志：先记录"凭什么"，再谈投递
    api.log(`report_connection_note urgency=${urgency} evidence=${evidenceLine(args?.evidence)}`)

    // 幂等 + 惰性宣告：只在"没成功过"时补一次（成功过 ⇒ 一次都不多发）
    if (!isDeclared(api)) await declarePolicy(api)

    try {
      // 原样转发：不改写 text、不放宽 urgency、不重试；返回宿主的结构化结果
      const r = await api.sendMessage(args?.text, { urgency, kind: 'say' })
      return r ?? { ok: false, reason: '宿主未返回结果' }
    } catch (e) {
      return { ok: false, reason: `投递异常：${e instanceof Error ? e.message : String(e)}` }
    }
  })

  /**
   * 装载时尝试宣告一次。loader **不 await** apply，所以返回值只是为了
   * 让想等到确定结果的调用方（含离线单测）可以 await。
   */
  return declarePolicy(api)
}
