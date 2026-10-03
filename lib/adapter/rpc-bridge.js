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
/**
 * 取出并校验卡片的可见范围。
 * 非法值当作"没传"（回退到模板声明或默认 'both'），不抛错 ——
 * 这个参数是可选的，用户界面传了脏值不该让整个装载失败。
 */
function cardScopeOf(payload) {
    const raw = payload?.scope;
    return raw === 'a' || raw === 'b' || raw === 'both' ? raw : undefined;
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
        [RPC_ENDPOINTS.loadCard]: (p) => service.loadCard(str(p, 'templateId'), str(p, 'connectionId'), cardScopeOf(p)),
        [RPC_ENDPOINTS.setCardScope]: (p) => ({
            ok: service.setCardScope(str(p, 'instanceId'), cardScopeOf(p) ?? 'both'),
        }),
        [RPC_ENDPOINTS.installCard]: (p) => service.installCard(str(p, 'spec')),
        [RPC_ENDPOINTS.uninstallCard]: (p) => service.uninstallCard(str(p, 'cardId')),
        [RPC_ENDPOINTS.cardsRoot]: () => service.cardsRoot(),
        // 卡片给会话提供的能力 —— 此前 `registerTool` 注册进去**没人读**，
        // 这两个端点把工具表接通（会话侧走 `connection_card_tool` 工具）。
        [RPC_ENDPOINTS.listCardTools]: (p) => {
            const raw = p;
            return service.listCardTools(str(p, 'connectionId'), raw?.side === 'b' ? 'b' : 'a');
        },
        [RPC_ENDPOINTS.callCardTool]: (p) => {
            const raw = p;
            return service.callCardTool(str(p, 'instanceId'), str(p, 'tool'), raw?.args ?? {}, raw?.side === 'b' ? 'b' : 'a');
        },
        // 卡片更新
        [RPC_ENDPOINTS.checkCardUpdate]: (p) => service.checkCardUpdate(str(p, 'cardId')),
        [RPC_ENDPOINTS.updateCard]: (p) => service.updateCard(str(p, 'cardId')),
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
        /**
         * UI 捕获用：把卡片的**客户端制品源码**送回浏览器。
         *
         * 浏览器够不到卡片目录（也不该给它文件系统访问），所以由宿主读文件、送**文本**过去 ——
         * 最小暴露面。面板拿到源码后临时换掉 `__ModuleLoader__` 捕获 factory，
         * 再把它的槽位注册渲染进面板（见 ui/capture-client.ts）。
         */
        [RPC_ENDPOINTS.readCardClientSource]: (p) => service.readCardClientSource(str(p, 'instanceId')),
        // 调试：向连接发事件，手动触发卡片逻辑
        [RPC_ENDPOINTS.debugEmit]: (p) => {
            const event = str(p, 'event');
            const data = p?.data;
            service.emitConnectionEvent(str(p, 'connectionId'), event, data);
            return null;
        },
        [RPC_ENDPOINTS.listUpgradeRequests]: (p) => {
            const connectionId = p?.connectionId;
            return service.listPendingUpgrades(typeof connectionId === 'string' && connectionId ? connectionId : undefined);
        },
        [RPC_ENDPOINTS.negotiateWhitelist]: (p) => {
            const raw = p?.methods;
            const methods = Array.isArray(raw)
                ? raw
                    .map((m) => {
                    const entry = m;
                    return typeof entry?.method === 'string'
                        ? {
                            method: entry.method,
                            description: typeof entry.description === 'string' ? entry.description : '',
                        }
                        : null;
                })
                    .filter((m) => m !== null)
                : [];
            service.negotiateWhitelist(str(p, 'connectionId'), methods);
            return methods.length;
        },
        [RPC_ENDPOINTS.listMessages]: (p) => {
            const raw = p;
            const since = typeof raw?.since === 'number' ? raw.since : undefined;
            const limit = typeof raw?.limit === 'number' ? raw.limit : undefined;
            return service.listMessages(str(p, 'connectionId'), {
                ...(since !== undefined ? { since } : {}),
                ...(limit !== undefined ? { limit } : {}),
            });
        },
        [RPC_ENDPOINTS.clearMessages]: (p) => 
        // 清空是破坏性操作，但只影响我们自己的交流记录（连接本身不动）
        service.clearMessages(str(p, 'connectionId')),
        // ── 协作感知（面板用） ──
        [RPC_ENDPOINTS.connectionWork]: (p) => {
            const work = service.connectionWork(str(p, 'connectionId'));
            // 摘要文本要带上会话名，否则会渲染成空的【】。
            // 客户端其实用结构化字段，这个 summary 只作调试/兜底。
            const titles = new Map(service.listSessions().map((s) => [s.id, s.title || s.id]));
            const labelOf = (id) => titles.get(id) ?? id.replace(/^session-/, '').slice(0, 8);
            return {
                a: work.a
                    ? { ...work.a, summary: service.peerWork(work.a.sessionId, labelOf(work.a.sessionId)) ?? '' }
                    : null,
                b: work.b
                    ? { ...work.b, summary: service.peerWork(work.b.sessionId, labelOf(work.b.sessionId)) ?? '' }
                    : null,
            };
        },
        [RPC_ENDPOINTS.relayDiagnostics]: () => service.relayDiagnostics(),
        [RPC_ENDPOINTS.listConventions]: (p) => service.listConventions(str(p, 'connectionId'), p?.all === true),
        [RPC_ENDPOINTS.declareConvention]: (p) => {
            const raw = p;
            // 面板来的默认是 'user'（人是第三方，不是 A 也不是 B）
            const byRaw = raw?.by;
            const by = byRaw === 'a' || byRaw === 'b' ? byRaw : 'user';
            const supersedes = typeof raw?.supersedes === 'string' ? raw.supersedes : undefined;
            return service.declareConvention(str(p, 'connectionId'), by, typeof raw?.topic === 'string' ? raw.topic : '一般', str(p, 'text'), supersedes);
        },
        [RPC_ENDPOINTS.removeConvention]: (p) => ({
            ok: service.removeConvention(str(p, 'connectionId'), str(p, 'id')),
        }),
        [RPC_ENDPOINTS.renderConventions]: (p) => service.renderConventions(str(p, 'connectionId'), str(p, 'aLabel'), str(p, 'bLabel')),
        [RPC_ENDPOINTS.sendMessage]: (p) => {
            const raw = p;
            const from = raw?.from === 'b' ? 'b' : 'a';
            const kindRaw = raw?.kind;
            const kind = kindRaw === 'ask' || kindRaw === 'reply' || kindRaw === 'system' ? kindRaw : 'say';
            const replyTo = typeof raw?.replyTo === 'string' ? raw.replyTo : undefined;
            // 紧急度决定投递方式（排队/插话/只告知），默认排队。
            const urgency = raw?.urgency === 'quiet' || raw?.urgency === 'urgent' ? raw.urgency : 'normal';
            return service.sendMessage(str(p, 'connectionId'), from, kind, str(p, 'text'), {
                ...(replyTo ? { replyTo } : {}),
                urgency,
            });
        },
        [RPC_ENDPOINTS.relayCapabilities]: () => service.relayCapabilities(),
        // 调试：直接往某个会话投递，验证「A 说话 B 能感知」的最后一跳
        [RPC_ENDPOINTS.debugDeliver]: async (p) => {
            const raw = p;
            // form 决定接收端怎么判断这条消息：mirror=信息，handoff=派活。
            // 默认 handoff —— 显式调用这个端点的人，本意就是"要对方处理"。
            const form = raw?.form === 'mirror' ? 'mirror' : 'handoff';
            const urgency = raw?.urgency === 'quiet' || raw?.urgency === 'urgent' ? raw.urgency : 'normal';
            return service.deliverToSession(str(p, 'sessionId'), str(p, 'text'), urgency, form);
        },
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