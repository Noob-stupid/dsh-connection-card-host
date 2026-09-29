/**
 * goal-relay-card — 官方示例目标中继卡片。
 * 在连接的会话间中继目标状态。
 * ⚠️ 约束：不 import 任何 @deepseek-ai/* 包，只使用 CardAPI。
 */
export function apply(api) {
  api.on('goal_updated', (data) => {
    api.log('goal updated, relaying', data)
    api.emit('goal_relayed', { ...data, relayedAt: Date.now() })
  })

  api.on('goal_completed', (data) => {
    api.log('goal completed', data)
    api.emit('health_changed', { health: 'green' })
  })

  api.registerTool('relay_goal', async (params) => {
    const result = await api.requestRemote('relay_goal', params)
    return result
  })
}

export function mountPanel(element, api) {
  element.innerHTML = '<div class="goal-relay-card">目标中继...</div>'
}