/**
 * useConnections — 从宿主拉取连接列表并保持刷新。
 *
 * 浏览器半拿不到宿主的推送事件（连接级事件总线在宿主进程内），
 * 所以这里用轮询：轻量、无额外协议，2s 间隔对本地 HTTP 完全够用。
 * 后续要降到推送可以接 DSH 的 websocket downlink。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
const POLL_INTERVAL_MS = 2000;
export function useConnections(client) {
    const [connections, setConnections] = useState([]);
    const [error, setError] = useState(null);
    const [loaded, setLoaded] = useState(false);
    // 防止卸载后 setState
    const aliveRef = useRef(true);
    const refresh = useCallback(async () => {
        if (!client)
            return;
        try {
            const next = await client.listConnections();
            if (!aliveRef.current)
                return;
            setConnections(next);
            setError(null);
        }
        catch (e) {
            if (!aliveRef.current)
                return;
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            if (aliveRef.current)
                setLoaded(true);
        }
    }, [client]);
    useEffect(() => {
        aliveRef.current = true;
        if (!client)
            return;
        void refresh();
        const timer = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
        return () => {
            aliveRef.current = false;
            clearInterval(timer);
        };
    }, [client, refresh]);
    return { connections, error, loaded, refresh };
}
//# sourceMappingURL=useConnections.js.map