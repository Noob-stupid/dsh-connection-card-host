export class ConnectionEventBus {
    handlers = new Map();
    allHandlers = new Map();
    emit(connectionId, event, data) {
        const key = `conn:${connectionId}:${event}`;
        const set = this.handlers.get(key);
        if (set) {
            for (const h of set) {
                try {
                    h(data);
                }
                catch (e) {
                    console.error(`[ConnectionEventBus] handler error for ${key}:`, e);
                }
            }
        }
        const allSet = this.allHandlers.get(connectionId);
        if (allSet) {
            for (const h of allSet) {
                try {
                    h(event, data);
                }
                catch (e) {
                    console.error(`[ConnectionEventBus] all-handler error for ${connectionId}:`, e);
                }
            }
        }
    }
    subscribe(connectionId, event, handler) {
        const key = `conn:${connectionId}:${event}`;
        let set = this.handlers.get(key);
        if (!set) {
            set = new Set();
            this.handlers.set(key, set);
        }
        set.add(handler);
        return () => { set.delete(handler); };
    }
    subscribeAll(connectionId, handler) {
        let set = this.allHandlers.get(connectionId);
        if (!set) {
            set = new Set();
            this.allHandlers.set(connectionId, set);
        }
        set.add(handler);
        return () => { set.delete(handler); };
    }
    /** 清除某连接的所有订阅（断开时调用） */
    clearConnection(connectionId) {
        for (const key of this.handlers.keys()) {
            if (key.startsWith(`conn:${connectionId}:`)) {
                this.handlers.delete(key);
            }
        }
        this.allHandlers.delete(connectionId);
    }
}
//# sourceMappingURL=event-bus.js.map