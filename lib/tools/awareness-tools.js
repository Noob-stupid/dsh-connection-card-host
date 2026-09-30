/** 会话 id → 显示名（读不到就退化成短 id）。 */
function makeLabeler(service) {
    const sessions = service.listSessions();
    const byId = new Map(sessions.map((s) => [s.id, s.title || s.id]));
    return (id) => byId.get(id) ?? id.replace(/^session-/, '').slice(0, 8);
}
/** 从 exec 里取调用者会话 id。 */
function callerSessionId(exec) {
    const agent = exec?.agent;
    const id = agent?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
}
/** 把调用者参与的连接，转成「我 ↔ 对方」的视角。 */
function peerViews(service, selfId) {
    const label = makeLabeler(service);
    const out = [];
    for (const conn of service.getConnectionsBySession(selfId)) {
        const isA = conn.sessionA === selfId;
        const peerId = isA ? conn.sessionB : conn.sessionA;
        out.push({
            connectionId: conn.id,
            selfId,
            peerId,
            selfLabel: label(selfId),
            peerLabel: label(peerId),
            aLabel: label(conn.sessionA),
            bLabel: label(conn.sessionB),
        });
    }
    return out;
}
function text(value) {
    return [{ type: 'text', text: value }];
}
/** 所有工具共用的返回外壳。 */
function defineTool(opts) {
    return {
        name: opts.name,
        description: opts.description,
        parameters: opts.parameters ?? { type: 'object', properties: {}, additionalProperties: false },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => text(String(value ?? '')),
        },
        async execute(args, exec) {
            try {
                return await opts.run((args ?? {}), exec);
            }
            catch (e) {
                // 工具不该把异常抛回模型 —— 那会让整个回合以 error 结束
                opts.auditLog(`工具 ${opts.name} 执行失败: ${String(e)}`);
                return `${opts.name} 执行失败：${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}
/**
 * 注册三个感知工具，返回卸载函数。
 *
 * `tools.register` 返回的是 dispose 函数，必须挂到 ctx.effect 上，
 * 否则插件卸载后工具还留在注册表里（会指向已释放的闭包）。
 */
export function registerAwarenessTools(tools, deps) {
    const { service, auditLog } = deps;
    const disposers = [];
    // ── 1. 看对方在干什么 ──
    disposers.push(tools.register(defineTool({
        auditLog,
        name: 'connection_peer_work',
        description: '查看与本会话相连的其他会话**当前正在做什么**（在改哪些文件、计划进行到哪一步、最近用了什么工具）。' +
            '当你需要和对方配合、对齐接口或避免重复劳动时用它。' +
            '信息是自动采集的实时状态，对方不需要专门告诉你。',
        parameters: {
            type: 'object',
            properties: {
                connectionId: {
                    type: 'string',
                    description: '可选：只看某一条连接。省略则列出本会话参与的全部连接。',
                },
            },
            additionalProperties: false,
        },
        run: async (args, exec) => {
            const selfId = callerSessionId(exec);
            if (!selfId)
                return '无法确定当前会话（工具没有拿到 exec.agent）。';
            let views = peerViews(service, selfId);
            const only = typeof args.connectionId === 'string' ? args.connectionId : '';
            if (only)
                views = views.filter((v) => v.connectionId === only || v.connectionId.startsWith(only));
            if (views.length === 0) {
                return '本会话当前没有参与任何连接。可以用连接面板或拖拽建立连接后再试。';
            }
            const chunks = [];
            for (const v of views) {
                const summary = service.peerWork(v.peerId, v.peerLabel);
                chunks.push(summary ??
                    `【${v.peerLabel}】还没有采集到工作状态（对方可能还没开始干活，或刚连接上）。`);
            }
            return chunks.join('\n\n');
        },
    })));
    // ── 2. 查公约盒 ──
    disposers.push(tools.register(defineTool({
        auditLog,
        name: 'connection_conventions',
        description: '查看本连接**双方已经约定好的前提**（接口、字段名、坐标、单位、命名规范、文件分工等）。' +
            '动手做与对方有交集的部分之前，先查一下，避免按自己的假设做错。' +
            '也可以用 keyword 只查某个主题。',
        parameters: {
            type: 'object',
            properties: {
                keyword: {
                    type: 'string',
                    description: '可选：按关键词过滤（匹配主题或正文）。',
                },
                connectionId: { type: 'string', description: '可选：只看某一条连接。' },
            },
            additionalProperties: false,
        },
        run: async (args, exec) => {
            const selfId = callerSessionId(exec);
            if (!selfId)
                return '无法确定当前会话（工具没有拿到 exec.agent）。';
            let views = peerViews(service, selfId);
            const only = typeof args.connectionId === 'string' ? args.connectionId : '';
            if (only)
                views = views.filter((v) => v.connectionId === only || v.connectionId.startsWith(only));
            if (views.length === 0)
                return '本会话当前没有参与任何连接。';
            const keyword = typeof args.keyword === 'string' ? args.keyword : '';
            const chunks = [];
            for (const v of views) {
                const convs = keyword
                    ? service.searchConventions(v.connectionId, keyword)
                    : service.listConventions(v.connectionId);
                if (convs.length === 0) {
                    chunks.push(keyword
                        ? `（${v.peerLabel}）没有匹配「${keyword}」的约定。`
                        : `本连接（${v.selfLabel} ↔ ${v.peerLabel}）的公约盒还是空的。` +
                            '\n如果你这边确定了对方需要遵守的前提，用 connection_declare 放进去。');
                    continue;
                }
                const lines = [`本连接（${v.selfLabel} ↔ ${v.peerLabel}）的共享约定：`];
                for (const c of convs) {
                    // 按连接自己的 A/B 端点取名 —— 不能假设我是 a 端
                    const who = c.by === 'a' ? v.aLabel : c.by === 'b' ? v.bLabel : '用户（人工添加）';
                    const mine = c.by !== 'user' && who === v.selfLabel ? '（我声明的）' : '';
                    lines.push(`- [${c.topic}] ${c.text}`);
                    lines.push(`  （由 ${who} 声明${mine} · id=${c.id}）`);
                }
                chunks.push(lines.join('\n'));
            }
            return chunks.join('\n\n');
        },
    })));
    // ── 3. 声明约定 ──
    disposers.push(tools.register(defineTool({
        auditLog,
        name: 'connection_declare',
        description: '把一个**双方必须遵守的前提**放进共享公约盒，对方随时能查到。' +
            '判断标准：**对方不知道就会做错的东西**。' +
            '例如接口/字段名、坐标方向、单位、命名规范、文件分工边界。' +
            '不要放进度和临时状态（那属于工作状态，自动采集，不用声明）。',
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '约定正文。写清楚、可执行。' },
                topic: {
                    type: 'string',
                    description: '分类，便于检索。如「接口」「坐标」「命名」「分工」。',
                },
                supersedes: {
                    type: 'string',
                    description: '可选：被本条取代的旧约定 id（旧条目会标记为已取代，不删除）。',
                },
                connectionId: {
                    type: 'string',
                    description: '可选：写入哪条连接。本会话只参与一条连接时可省略。',
                },
            },
            required: ['text'],
            additionalProperties: false,
        },
        run: async (args, exec) => {
            const selfId = callerSessionId(exec);
            if (!selfId)
                return '无法确定当前会话（工具没有拿到 exec.agent）。';
            const body = typeof args.text === 'string' ? args.text.trim() : '';
            if (body.length === 0)
                return '约定正文不能为空。';
            let views = peerViews(service, selfId);
            const only = typeof args.connectionId === 'string' ? args.connectionId : '';
            if (only)
                views = views.filter((v) => v.connectionId === only || v.connectionId.startsWith(only));
            if (views.length === 0)
                return '本会话当前没有参与任何连接，无处声明。';
            if (views.length > 1 && !only) {
                return (`本会话参与了 ${views.length} 条连接，请用 connectionId 指定写入哪一条：\n` +
                    views.map((v) => `- ${v.connectionId}（↔ ${v.peerLabel}）`).join('\n'));
            }
            const v = views[0];
            const topic = typeof args.topic === 'string' ? args.topic : '一般';
            const supersedes = typeof args.supersedes === 'string' ? args.supersedes : undefined;
            const result = service.declareConvention(v.connectionId, isA(service, v) ? 'a' : 'b', topic, body, supersedes);
            if (!result.ok)
                return `声明失败：${result.reason}`;
            auditLog(`约定已声明 [${topic}] by ${v.selfLabel}: ${body.slice(0, 60)}`);
            return (`已放入公约盒（${v.selfLabel} ↔ ${v.peerLabel}）：\n` +
                `- [${topic}] ${body}\n` +
                `对方下一次查询 connection_conventions 时就能看到。`);
        },
    })));
    return () => {
        for (const d of disposers) {
            try {
                d();
            }
            catch {
                /* 卸载失败不阻断其他 */
            }
        }
    };
}
/** 判断某连接里 self 是不是 a 端。 */
function isA(service, v) {
    const conn = service.getConnectionById(v.connectionId);
    return conn?.sessionA === v.selfId;
}
//# sourceMappingURL=awareness-tools.js.map