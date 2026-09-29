import { RPC_CHANNEL, RPC_ENDPOINTS } from '../types/rpc.js';
import { safeCtxGet } from '../safe-ctx.js';
const ok = (value) => ({ ok: true, value });
const fail = (message) => ({
    ok: false,
    error: { code: 'internal', message, details: {} },
});
/** 端点段允许的字符（与 DSH 的 ENDPOINT_SEGMENT_PATTERN 一致）。 */
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/;
// ─── payload 取值助手（宿主侧不信任浏览器传入） ───
function str(payload, key) {
    const value = payload?.[key];
    if (typeof value !== 'string' || value === '') {
        throw new Error(`参数 ${key} 缺失或不是非空字符串`);
    }
    return value;
}
function direction(payload) {
    const value = str(payload, 'direction');
    if (value !== 'aToB' && value !== 'bToA') {
        throw new Error(`参数 direction 非法: ${value}`);
    }
    return value;
}
function level(payload) {
    const value = str(payload, 'level');
    if (value !== 'read' && value !== 'suggest' && value !== 'write') {
        throw new Error(`参数 level 非法: ${value}`);
    }
    return value;
}
/** 端点 → 处理函数。返回值会被包进 RpcResult.value。 */
function buildEndpoints(service, clientLog) {
    return {
        [RPC_ENDPOINTS.health]: () => ({
            ready: true,
            connections: service.getAllConnections().length,
        }),
        // 浏览器半的诊断上报：浏览器里读不到 console，只能借这条通道落盘
        [RPC_ENDPOINTS.debugLog]: (p) => {
            const message = p?.message;
            if (typeof message === 'string')
                clientLog?.(message);
            return null;
        },
        [RPC_ENDPOINTS.listConnections]: () => service.getAllConnections(),
        [RPC_ENDPOINTS.connectionsBySession]: (p) => service.getConnectionsBySession(str(p, 'sessionId')),
        [RPC_ENDPOINTS.createConnection]: (p) => service.createConnection(str(p, 'sessionA'), str(p, 'sessionB')),
        [RPC_ENDPOINTS.disconnect]: (p) => {
            service.disconnect(str(p, 'id'));
            return null;
        },
        [RPC_ENDPOINTS.updatePermission]: (p) => {
            service.updatePermission(str(p, 'id'), direction(p), level(p));
            return null;
        },
        [RPC_ENDPOINTS.requestPermissionUpgrade]: (p) => service.requestPermissionUpgrade(str(p, 'id'), direction(p), level(p)),
        [RPC_ENDPOINTS.acceptPermissionUpgrade]: (p) => service.acceptPermissionUpgrade(str(p, 'requestId'), str(p, 'acceptorId')),
        [RPC_ENDPOINTS.rejectPermissionUpgrade]: (p) => {
            service.rejectPermissionUpgrade(str(p, 'requestId'), str(p, 'rejectorId'));
            return null;
        },
        [RPC_ENDPOINTS.loadCard]: (p) => service.loadCard(str(p, 'templateId'), str(p, 'connectionId')),
        [RPC_ENDPOINTS.unloadCard]: async (p) => {
            await service.unloadCard(str(p, 'instanceId'));
            return null;
        },
        [RPC_ENDPOINTS.reloadCard]: async (p) => {
            await service.reloadCard(str(p, 'instanceId'));
            return null;
        },
        // connectionId 可选：不传就只列模板（loadedCount 全为 0）
        [RPC_ENDPOINTS.listCardTemplates]: (p) => {
            const connectionId = p?.connectionId;
            return service.listCardTemplates(typeof connectionId === 'string' && connectionId ? connectionId : undefined);
        },
        [RPC_ENDPOINTS.renderCardPanel]: (p) => service.renderCardPanel(str(p, 'instanceId')),
        [RPC_ENDPOINTS.listWhitelist]: (p) => service.listWhitelistedMethods(str(p, 'connectionId')),
        [RPC_ENDPOINTS.listSessions]: () => service.listSessions(),
    };
}
// ─── 信任栅栏（对齐 DSH 的 api-request-trust 语义） ───
function isLoopbackHostname(hostname) {
    const h = hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}
/**
 * 只接受本机来源的请求。
 * 对齐 DSH：Host 必须是 loopback；拒绝跨站标记；Origin 若存在必须与 Host 同源。
 * 诚实说明：这是反 DNS-rebinding / 反跨站的护栏，不是认证层。
 */
function isTrusted(req) {
    const host = req.headers.host;
    if (typeof host !== 'string' || host === '')
        return false;
    let hostUrl;
    try {
        hostUrl = new URL(`http://${host}`);
    }
    catch {
        return false;
    }
    if (!isLoopbackHostname(hostUrl.hostname))
        return false;
    if (req.headers['sec-fetch-site'] === 'cross-site')
        return false;
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === hostUrl.host;
    }
    catch {
        return false;
    }
}
// ─── HTTP 辅助 ───
async function readJsonBody(req, limitBytes = 1_000_000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                reject(new Error('请求体过大'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
        req.on('error', reject);
    });
}
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
    });
    res.end(payload);
}
/** 从请求 URL 中取出通道相对的端点；不合法返回 undefined。 */
function endpointFromUrl(url) {
    if (!url)
        return undefined;
    const pathname = url.split('?', 1)[0];
    if (!pathname.startsWith(`${RPC_CHANNEL}/`))
        return undefined;
    const endpoint = pathname.slice(RPC_CHANNEL.length + 1);
    const segments = endpoint.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..' || !ENDPOINT_SEGMENT.test(s))) {
        return undefined;
    }
    return endpoint;
}
/**
 * 在 webServer 上注册 RPC 路由。
 *
 * 需要调用方 ctx 已注入 `webServer`；否则返回 undefined。
 *
 * @returns 注销函数；webServer 不可用时返回 undefined。
 */
export function registerRpcBridge(ctx, service, options = {}) {
    const logger = options.logger ?? console;
    const audit = options.audit ?? (() => { });
    const webServer = safeCtxGet(ctx, 'webServer');
    const canRegister = typeof webServer?.register === 'function';
    audit(`bridge: ctx.webServer=${canRegister ? 'ready' : 'absent'}`);
    if (!canRegister || !webServer) {
        logger.warn?.('[connection-card-host] ctx.webServer 不可用；浏览器端将无法访问宿主服务');
        return undefined;
    }
    const endpoints = buildEndpoints(service, options.clientLog);
    const handler = async (req, res) => {
        if (!isTrusted(req)) {
            sendJson(res, 403, fail('来源不受信任（仅接受本机同源请求）'));
            return;
        }
        if (req.method !== 'POST') {
            sendJson(res, 405, fail('仅支持 POST'));
            return;
        }
        const mediaType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        if (mediaType !== 'application/json') {
            sendJson(res, 415, fail('content-type 必须为 application/json'));
            return;
        }
        const endpoint = endpointFromUrl(req.url);
        if (endpoint === undefined) {
            sendJson(res, 404, fail('未知端点'));
            return;
        }
        let envelope;
        try {
            const parsed = await readJsonBody(req);
            if (!parsed || typeof parsed !== 'object')
                throw new Error('body 不是对象');
            envelope = parsed;
        }
        catch (e) {
            sendJson(res, 400, fail(`请求体解析失败: ${e instanceof Error ? e.message : String(e)}`));
            return;
        }
        const rpcId = typeof envelope.rpcId === 'string' ? envelope.rpcId : '';
        if (!rpcId) {
            sendJson(res, 400, fail('缺少 rpcId'));
            return;
        }
        if (envelope.method !== undefined && envelope.method !== endpoint) {
            sendJson(res, 400, { type: 'server-response', rpcId, result: fail('method 与端点不一致') });
            return;
        }
        const fn = endpoints[endpoint];
        if (!fn) {
            sendJson(res, 200, {
                type: 'server-response',
                rpcId,
                result: fail(`未知端点: ${endpoint}`),
            });
            return;
        }
        let result;
        try {
            result = ok(await fn(envelope.payload));
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            logger.warn?.(`[connection-card-host] ${endpoint} 失败: ${message}`);
            result = fail(message);
        }
        sendJson(res, 200, { type: 'server-response', rpcId, result });
    };
    try {
        const dispose = webServer.register({
            kind: 'prefix',
            path: RPC_CHANNEL,
            handler,
        });
        audit(`bridge: 路由已注册 ${RPC_CHANNEL}（${Object.keys(endpoints).length} 个端点）`);
        logger.info?.(`[connection-card-host] RPC 路由已注册: ${RPC_CHANNEL}`);
        return dispose;
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // 热重载时旧路由可能尚未释放；duplicate 视为已就绪（幂等）
        if (message.includes('duplicate')) {
            audit(`bridge: 路由已存在，跳过重复注册 ${RPC_CHANNEL}`);
            return undefined;
        }
        audit(`bridge: 注册失败 ${message}`);
        logger.warn?.(`[connection-card-host] RPC 路由注册失败: ${message}`);
        return undefined;
    }
}
//# sourceMappingURL=rpc-bridge.js.map