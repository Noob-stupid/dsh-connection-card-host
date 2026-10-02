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
    // ── 0. 给对端发消息（真的投递） ──
    //
    // 用户的原话定义了这个工具的形态：
    //   > 到时候可能是用户一句开工，然后你就让连接对话全动起来，做他们自己的，
    //   > 可互相感知，不需要用户再去一个个看了然后确认
    // 所以紧急度**由助手按情况自己判断**，不要求用户选。
    disposers.push(tools.register(defineTool({
        auditLog,
        name: 'connection_send',
        description: '给连接另一端的会话发一条消息（真的投递到它的会话，它下一轮就能看到）。\n' +
            '\n' +
            '**紧急度由你按情况判断** —— 三档的实际差别：\n' +
            '  quiet  只告知：放进对方上下文但**不唤醒**它。进展同步、背景信息、\n' +
            '         "知道了就行"的事。对方下次干活时自然看到，不被打断。\n' +
            '  normal 排队（默认）：对方处理完手头的事就看到。一般任务与请求。\n' +
            '  urgent 插话：**插进对方正在跑的那一轮**，当场读到。只在确实需要它\n' +
            '         **立刻**改变行为时用（阻塞问题、叫停、发现它正在做错的事）。\n' +
            '         对方空闲时会自动降级为排队，不会失败。\n' +
            '\n' +
            '判断原则：**打断是有代价的**（对方要中断当前思路）。大部分消息不急 ——\n' +
            '默认用 normal，只有真急才 urgent。\n' +
            '\n' +
            '注意：这条路径**只发你给的这段文字**，不会带上你所在会话的任何内容。',
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要发给对方的内容' },
                urgency: {
                    type: 'string',
                    enum: ['quiet', 'normal', 'urgent', 'preempt'],
                    description: '紧急度。不定则按 normal（排队）。' +
                        'quiet=只告知不唤醒；normal=排队；urgent=插话（在**下一个步骤边界**注入，不打断当前步骤）；' +
                        'preempt=抢占（会**打断对方正在跑的这一轮**，已做的工作白费）。' +
                        'preempt 默认关闭、需写权限、每连接 5 分钟 1 次；不满足任一条件时自动退化为 urgent，消息照样送到。' +
                        '绝大多数情况 urgent 就够 —— 只有"它已经跑偏、等不到下一步"才用 preempt。',
                },
                kind: {
                    type: 'string',
                    enum: ['say', 'ask', 'reply'],
                    description: 'say=发言/同步（需「可建议」权限）；ask=请求对方做事、reply=回复（都需「可写入」权限）。',
                },
                connectionId: {
                    type: 'string',
                    description: '可选：指定连接（本会话参与多条时用）。省略则用唯一那条。',
                },
            },
            required: ['text'],
            additionalProperties: false,
        },
        run: async (args, exec) => {
            const selfId = callerSessionId(exec);
            if (!selfId)
                return '发不出去：认不出当前会话（工具没拿到 exec.agent）。';
            const views = peerViews(service, selfId);
            const only = typeof args.connectionId === 'string' ? args.connectionId : '';
            const picked = only
                ? views.filter((v) => v.connectionId === only || v.connectionId.startsWith(only))
                : views;
            if (picked.length === 0) {
                return only
                    ? `没找到连接 ${only}（本会话参与 ${views.length} 条）。`
                    : '本会话当前没有参与任何连接，发不出去。';
            }
            if (picked.length > 1) {
                return (`本会话参与了 ${picked.length} 条连接，请用 connectionId 指定要发给谁：\n` +
                    picked.map((v) => `  ${v.connectionId}  → ${v.peerLabel}`).join('\n'));
            }
            const view = picked[0];
            const urgency = String(args.urgency ?? 'normal');
            const kind = String(args.kind ?? 'say');
            const text = String(args.text ?? '').trim();
            if (!text)
                return '内容为空，没发。';
            // from 用「我在连接的哪一端」决定 —— 权限是按方向算的
            const conn = service.getConnectionById(view.connectionId);
            const from = conn?.sessionA === selfId ? 'a' : 'b';
            const r = await service.sendMessage(view.connectionId, from, kind, text, {
                urgency: urgency,
            });
            if (!r.ok) {
                // ⚠️ 拒绝原因必须原样带出去（含"还需 Xms""需要写权限"这类自证信息），
                // 否则调用方只能猜。
                return `没发出去：${r.reason ?? '未知原因'}`;
            }
            if (r.delivered === false) {
                return `已记录，但**没能投到对方会话**：${r.reason ?? '未知原因'}`;
            }
            const how = urgency === 'quiet'
                ? '只告知（不唤醒，对方下次干活时看到）'
                : urgency === 'urgent'
                    ? '插话（对方在跑就当场读到，空闲则排队）'
                    : '排队（对方处理完手头的事就看到）';
            return `已发给 ${view.peerLabel} · ${how}`;
        },
    })));
    // ── 0b. 调用卡片提供的工具 ──
    //
    // 卡片系统此前只画面板（给人看）。卡片里 `registerTool` 注册的能力**没人能调** ——
    // 注册进一个 Map 就再没第二处引用。这个桥接工具把它接通：
    // 会话在这条连接上能列出、并调用**对自己这一端可见**的卡片工具。
    //
    // 为什么用**一个**桥接工具、而不是把每个卡片工具注册成独立工具：
    // 独立注册会让**每个**工具都占常驻 schema（每个会话都付的固定成本），
    // 而卡片是随连接动态装载的。桥接只占 1 个 schema，且天然能强制可见范围。
    disposers.push(tools.register(defineTool({
        auditLog,
        name: 'connection_card_tool',
        description: '调用**本连接上已装载的卡片**提供的工具。\n' +
            '\n' +
            '不传 tool 时：列出当前可用的卡片与它们提供的工具。\n' +
            '传 tool 时：调用它，args 原样传给卡片。\n' +
            '\n' +
            '卡片是挂在**连接**上的（不是全局），而且**可以只对某一端可见** ——\n' +
            '看不见的卡片，你调它会被明确告知"只对另一端可见"，而不是含糊报错。',
        parameters: {
            type: 'object',
            properties: {
                instanceId: { type: 'string', description: '卡片实例 id（不传 tool 时会列出来）。' },
                tool: { type: 'string', description: '要调用的工具名。省略则只列出可用工具。' },
                args: { type: 'object', description: '传给卡片工具的参数（卡片自己定义形状）。' },
                connectionId: {
                    type: 'string',
                    description: '可选：指定连接。省略则用本会话唯一参与的那条。',
                },
            },
            additionalProperties: false,
        },
        run: async (args, exec) => {
            const selfId = callerSessionId(exec);
            if (!selfId)
                return '无法确定当前会话（工具没拿到 exec.agent）。';
            const views = peerViews(service, selfId);
            if (views.length === 0)
                return '本会话当前没有参与任何连接。';
            const only = typeof args.connectionId === 'string' ? args.connectionId : '';
            const picked = only
                ? views.filter((v) => v.connectionId === only || v.connectionId.startsWith(only))
                : views;
            if (picked.length === 0)
                return `没找到连接 ${only}。`;
            if (picked.length > 1) {
                return (`本会话参与了 ${picked.length} 条连接，请用 connectionId 指定：\n` +
                    picked.map((v) => `  ${v.connectionId}  → ${v.peerLabel}`).join('\n'));
            }
            const view = picked[0];
            const conn = service.getConnectionById(view.connectionId);
            const side = conn?.sessionA === selfId ? 'a' : 'b';
            const list = service.listCardTools(view.connectionId, side);
            const withTools = list.filter((c) => c.tools.length > 0);
            const tool = typeof args.tool === 'string' ? args.tool : '';
            if (!tool) {
                if (list.length === 0)
                    return '这条连接上没有装载任何卡片。';
                return (`连接 ${view.connectionId.slice(0, 8)} 上、对你在的这一端可见的卡片：\n` +
                    list
                        .map((c) => `  · ${c.cardId}（${c.instanceId.slice(0, 8)}，可见范围=${c.scope}）` +
                        (c.tools.length
                            ? `\n      提供工具：${c.tools.join(', ')}`
                            : '\n      （未注册工具）'))
                        .join('\n') +
                    (withTools.length === 0 ? '\n\n（其中没有提供工具的卡片）' : ''));
            }
            // ⚠️ 先取成局部常量：TS 的属性收窄在**闭包内**会失效
            // （回调里的 `args.instanceId` 又变回 unknown）。
            const wantId = typeof args.instanceId === 'string' ? args.instanceId : '';
            const target = wantId
                ? list.find((c) => c.instanceId === wantId || c.instanceId.startsWith(wantId))
                : withTools.find((c) => c.tools.includes(tool));
            if (!target) {
                return `在这条连接上找不到提供「${tool}」的可见卡片。可用工具：${withTools.flatMap((c) => c.tools).join(', ') || '(无)'}`;
            }
            const r = await service.callCardTool(target.instanceId, tool, args.args ?? {}, side);
            if (!r.ok)
                return `卡片工具调用失败：${r.reason ?? '未知原因'}`;
            return typeof r.value === 'string'
                ? r.value
                : JSON.stringify(r.value ?? null, null, 2).slice(0, 4000);
        },
    })));
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