/**
 * self-heal-card — 官方示例自愈卡片。
 * 预设损坏时触发修复；修复完成后广播 preset_repaired。
 * ⚠️ 约束：不 import 任何 @deepseek-ai/* 包，只使用 CardAPI。
 */
export function apply(api) {
  let repairing = false

  api.on('preset_error', async (data) => {
    api.log('preset error, attempting repair', data)
    if (repairing) return
    repairing = true
    try {
      const result = await api.requestRemote('repair_preset', { reason: 'preset_error' })
      if (result && result.success !== false) {
        api.emit('preset_repaired', { ok: true })
        api.emit('health_changed', { health: 'green' })
      } else {
        api.emit('health_changed', { health: 'red' })
      }
    } catch (e) {
      api.log('repair failed', e)
      api.emit('health_changed', { health: 'red' })
    } finally {
      repairing = false
    }
  })

  api.registerTool('trigger_repair', async () => {
    const result = await api.requestRemote('repair_preset', { reason: 'manual' })
    return result
  })
}

export function mountPanel(element, api) {
  element.innerHTML = '<div class="self-heal-card">自愈卡片待命...</div>'
}