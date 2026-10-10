/**
 * 包内 skill provider —— 让**装了本插件的 DSH** 里的 agent 自动知道这套连接工具。
 *
 * ## 为什么是「包内 provider」而不是往 `~/.dsh/skills/` 拷一份
 *
 * DSH 的 skill 发现有两类通道（原文出处见下）：
 *
 *   ① **文件系统通道**：`@deepseek-ai/dsh-skill-filesystem` 扫描固定的根目录
 *      （`<projectRoot>/.dsh/skills`、`<dshHome>/skills`、`~/.agents/skills` …），
 *      每个 skill 是一个目录包 `<name>/SKILL.md` 或扁平文件 `<name>.md`。
 *      —— **插件包里的文件不在这些根里**，所以把 SKILL.md 放进 npm 包
 *      （哪怕进了 `files`）**并不会**被扫到。
 *      出处：`dsh-skill-filesystem/lib/index.js` 的 `roots()`（roots 列表）
 *      与 `discoverRoot()`（只认 `SKILL.md` / `*.md`）；README「Roots and priority」表。
 *
 *   ② **provider 通道**：插件在 `apply()` 里同步调用
 *      `ctx.skills.registerProvider(create)`，自己就是一个 skill 来源。
 *      这是官方自己用的形态 —— `@deepseek-ai/dsh-skill-badge` 就是这么把
 *      `dsh-badge` 这个 skill 随包发出去的。
 *      出处：`dsh-skill/lib/types/index.d.ts` 的 `SkillProvider` /
 *      `SkillRegistry.registerProvider`；`dsh-skill-badge/lib/index.js` 全文。
 *
 * 本插件走 ②：skill 内容随包走，**安装即被发现**，**卸载即消失**（注册绑定在
 * fiber 上，dispose 时自动注销）—— 不用往用户目录里塞文件，也不会留残留。
 *
 * ## 边界（刻意的）
 *
 * · `rank` 取 600（官方 `BUNDLED_SKILL_RANK`，即「随包提供的 skill」那一档）。
 *   这里**写字面量而不是 import**：`@deepseek-ai/dsh-skill` 是 DSH 的包，
 *   本插件不该为它加一条硬依赖，否则在没有 skills 服务的 checkout 上整个插件装不上。
 * · 拿不到 `ctx.skills` 时**只记日志、不抛**：skill 是增强，不是本插件的命脉。
 *   （例如面向 DSH 0.2.0-rc.1 的旧 checkout 没有 `ctx.skills`。）
 * · 正文**每次加载都从包里重读**，所以改正文不需要重载插件。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { safeCtxGet } from '../safe-ctx.js';
/** 官方 `BUNDLED_SKILL_RANK` 的值（随包提供档）。见文件头注释。 */
const BUNDLED_SKILL_RANK = 600;
/** 注册到 `ctx.skills` 的 provider 名（同一层内唯一）。 */
const PROVIDER_NAME = 'connection-card';
/** skill 名（kebab-case，官方 `SKILL_NAME` 文法 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`）。 */
const SKILL_NAME = 'connection-card';
/**
 * 目录项描述 —— 会进**每个会话**的 skill 目录，所以要短、要能路由。
 *
 * `dsh-tool-skill` 的 `catalogDescriptionMaxLength` 默认 500，超出会被截。
 */
const SKILL_DESCRIPTION = 'Cross-session collaboration over DSH connections: message another session, read what the peer is doing right now, share premises in a convention box, and call tools published by cards mounted on the connection. Use whenever this session is part of a connection and the work touches the other side.';
/** 可选的额外路由提示（官方 frontmatter 字段 `whenToUse`）。 */
const SKILL_WHEN_TO_USE = "Another session is collaborating on your work; you need to hand something over, ask the peer for something, or read the peer's live work state to align interfaces and avoid duplicate work.";
/** 正文文件（随包发布，见 package.json 的 files 与 scripts/check-skill-provider.mjs）。 */
const SKILL_BODY_URL = new URL('../../skills/connection-card.md', import.meta.url);
const SKILL_RESOURCE_BASE = {
    kind: 'directory',
    path: fileURLToPath(new URL('../../skills/', import.meta.url)),
};
/** 目录项（`ctx.skills.list()` 会看到这一个）。 */
const CANDIDATE = {
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    whenToUse: SKILL_WHEN_TO_USE,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME,
    source: 'bundled',
    rank: BUNDLED_SKILL_RANK,
    locator: SKILL_BODY_URL,
    resourceBase: SKILL_RESOURCE_BASE,
};
const provider = {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([CANDIDATE]),
    async get() {
        return {
            name: SKILL_NAME,
            description: SKILL_DESCRIPTION,
            whenToUse: SKILL_WHEN_TO_USE,
            invocation: CANDIDATE.invocation,
            provider: PROVIDER_NAME,
            source: CANDIDATE.source,
            resourceBase: SKILL_RESOURCE_BASE,
            content: await readFile(SKILL_BODY_URL, 'utf8'),
        };
    },
};
/** 注册 `connection-card` skill provider；返回卸载函数（拿不到 skills 时返回 undefined）。 */
export function registerConnectionSkill(ctx, auditLog) {
    const skills = safeCtxGet(ctx, 'skills');
    if (!skills || typeof skills.registerProvider !== 'function') {
        auditLog('skill provider 未注册：ctx.skills 不可用（本实例的 DSH 没有 skills 服务）');
        return undefined;
    }
    const dispose = skills.registerProvider(() => provider);
    auditLog(`skill provider 已注册：${PROVIDER_NAME} / skill=${SKILL_NAME}（rank ${BUNDLED_SKILL_RANK}）`);
    return dispose;
}
//# sourceMappingURL=connection-skill.js.map