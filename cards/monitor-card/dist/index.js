/**
 * monitor-card — 官方示例监控卡片。
 * ⚠️ 约束：不 import 任何 @deepseek-ai/* 包，只使用 CardAPI。
 */
export function apply(api) {
  api.on('preset_error', (data) => {
    api.log('preset error detected', data)
    api.emit('health_changed', { health: 'red' })
  })

  api.on('session_idle', (data) => {
    api.log('session idle', data)
    api.emit('health_changed', { health: 'yellow' })
  })

  api.registerTool('get_status', async () => {
    return { ok: true }
  })
}

export function mountPanel(element, api) {
  element.innerHTML = '<div class="monitor-card">监控中...</div>'
}
