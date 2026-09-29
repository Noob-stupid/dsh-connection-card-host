/**
 * ConnectionEventBus — 连接级事件总线。
 * 命名空间：conn:<connectionId>:<event>
 * 卡片只能订阅自己所在连接的事件。
 */
type Handler = (data: unknown) => void
type AllHandler = (event: string, data: unknown) => void

export class ConnectionEventBus {
  private handlers = new Map<string, Set<Handler>>()
  private allHandlers = new Map<string, Set<AllHandler>>()

  emit(connectionId: string, event: string, data: unknown): void {
    const key = `conn:${connectionId}:${event}`
    const set = this.handlers.get(key)
    if (set) {
      for (const h of set) {
        try { h(data) } catch (e) {
          console.error(`[ConnectionEventBus] handler error for ${key}:`, e)
        }
      }
    }
    const allSet = this.allHandlers.get(connectionId)
    if (allSet) {
      for (const h of allSet) {
        try { h(event, data) } catch (e) {
          console.error(`[ConnectionEventBus] all-handler error for ${connectionId}:`, e)
        }
      }
    }
  }

  subscribe(connectionId: string, event: string, handler: Handler): () => void {
    const key = `conn:${connectionId}:${event}`
    let set = this.handlers.get(key)
    if (!set) {
      set = new Set()
      this.handlers.set(key, set)
    }
    set.add(handler)
    return () => { set!.delete(handler) }
  }

  subscribeAll(connectionId: string, handler: AllHandler): () => void {
    let set = this.allHandlers.get(connectionId)
    if (!set) {
      set = new Set()
      this.allHandlers.set(connectionId, set)
    }
    set.add(handler)
    return () => { set!.delete(handler) }
  }

  /** 清除某连接的所有订阅（断开时调用） */
  clearConnection(connectionId: string): void {
    for (const key of this.handlers.keys()) {
      if (key.startsWith(`conn:${connectionId}:`)) {
        this.handlers.delete(key)
      }
    }
    this.allHandlers.delete(connectionId)
  }
}
