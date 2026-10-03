export interface InstallResult {
    ok: boolean;
    /** 卡片 id（= 目录名）。 */
    cardId?: string;
    /** 最终落地目录。 */
    dir?: string;
    /** 卡片显示名，便于回执里说人话。 */
    name?: string;
    version?: string;
    reason?: string;
}
/**
 * 删除一个文件（等价于 `rmSync(p, { force: true })`，但用了**有效的** API）。
 *
 * ## 删不掉时：**改名降级**，而不是报失败（对端真机结论）
 *
 * Windows 上"删不掉"有两种完全不同的原因：
 *   · **真被占用**（别的进程开着）—— 重试是白等
 *   · **句柄还没释放**（刚被 kill 的子进程，`taskkill /T /F` 返回 ≠ 句柄已释放）
 *     —— 过一会儿就好了
 *
 * 两者从错误码上分不开（都是 `EPERM`/`EBUSY`/"being used by another process"），
 * 所以**一律不重试**，改成：把文件**改名挪走**（`.trash-<时间戳>-<随机>`）。
 * 改名在同一卷上是元数据操作，**不需要删除权限、也不受"打开中"影响**（多数情况）——
 * 于是调用方能继续干活，用户也不会看到一个"因为清理失败而失败"的安装。
 *
 * @returns 是否真的删掉了 —— 调用方**必须**看这个返回值：
 *          "删不掉"与"删掉了"在这台机器上是两种真实结果。
 */
export declare function removeFileQuiet(target: string): boolean;
/**
 * 把 GitHub 的 archive 链接规范化成 **codeload** 链接。
 *
 *     https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.tar.gz
 *   → https://codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/<branch>
 *
 * ## 为什么要换（对端真机结论，我们照做）
 *
 *   · **官方 codeload 无重定向、无 API 配额**（`github.com/.../archive/...` 会 302 到它，
 *     而 `api.github.com/.../tarball/...` 未认证只有 60 次/小时）
 *   · 对端在**本机实测 codeload `200` 可用**，所以这是主通道而不是备选
 *
 * 认不出形态就返回 undefined（原样走原 URL，不做猜测）。
 */
export declare function toCodeloadUrl(url: string): string | undefined;
/** 一个下载通道：稳定 id（记忆用）+ 名字（审计用）+ 真实 URL。 */
interface DownloadChannel {
    /**
     * 稳定标识（如 `codeload` / `ghproxy` / `direct`）。
     *
     * ⚠️ **记忆必须按 id 存，不能按 URL 模板存** —— 对端点明的一处：
     * 他们的 git URL 与仓库无关、模板可复用；而我们的 archive URL **带 owner/repo/branch**，
     * 存模板会"每仓库一条、永远记不住"。
     */
    id: string;
    name: string;
    url: string;
}
/**
 * 把**仓库地址**展开成 archive 候选（含分支回退）。
 *
 * 用户贴的多半是仓库地址而不是 archive 地址：
 *
 *     https://github.com/<o>/<r>                 ← 最常见
 *     https://github.com/<o>/<r>/tree/<branch>  ← 从浏览器地址栏复制来的
 *
 * 这两种原先都会当成"不是 archive 链接"→ 直连拉下来一个 **HTML 页面** → 解包报错 ✗。
 * 展开成：
 *
 *     /tree/<branch> 给了分支 ⇒ 该分支优先
 *     其余按 **main → master → dev** 补足，最多 3 条
 *
 * 为什么带 dev：对端真机记录 —— dsh-web 的默认分支就是 `dev`，
 * 分支猜错时 archive 会 404，得能自己找回来。
 */
export declare function expandGitHubRepoUrl(url: string): string[];
/**
 * 为一个 URL 排出**下载通道表**（按可信度排序）。
 *
 * GitHub archive 类：codeload（官方、无重定向、无配额）→ ghproxy（镜像兜底，**可能 0 B/s**）→ 原 URL。
 * GitHub **仓库**类：按分支回退展开成最多 3 条 codeload（每条各自探活）。
 * 其它：原 URL 直连。
 *
 * ⚠️ 镜像**不能硬编码成唯一出路**：对端记录 `mirror.ghproxy.com` 早已失效并被停放页接管 ——
 * 所以镜像只做**兜底**，且必须能失败后继续。
 */
export declare function downloadChannelsFor(url: string): DownloadChannel[];
/** 读"上次成功的通道 id"。任何异常都当没有（绝不抛）。 */
export declare function readDownloadMemo(cardsRoot: string): string;
/** 记住这次成功的通道。**写盘失败静默**。 */
export declare function rememberDownloadChannel(cardsRoot: string, channelId: string): void;
/**
 * 把上次成功的通道**挪到最前**，其余顺序不变（纯函数）。
 *
 * 为什么值钱：在"直连不通、只有某个镜像可用"的环境里，这一步省掉一整轮无谓探活/失败等待。
 */
export declare function orderChannels(channels: DownloadChannel[], preferredId: string): DownloadChannel[];
/**
 * 下载失败的**归因** —— 只吃**结构化输入**，不解析人类可读文本。
 *
 * > **能拿到结构化信号时，永远不要解析人类可读文本** ——
 * > 文本会被人改、被工具包装、被本地化，而**退出码是契约**。
 *
 * ## 为什么必须有这条纪律（我们真踩过）
 *
 * 上一版是"拿 `error.message` 做正则"。而 Node 抛错时会把**整条命令行**回显进 message，
 * 我们的 argv 里就有 `--connect-timeout` / `--max-time` ⇒ 正则里只要出现 `timeout` 这个词，
 * **任何** curl 失败都会被归成"超时"（实测：一个 404 被报成"超时，包可能较大" ✗）。
 * 换个参数名还会再中一次 —— 所以**根治办法是别拿文本判类**。
 *
 * ## 两条配套纪律
 *
 *   1. **默认桶必须是 `unknown`**（带退出码 + stderr 尾部），**绝不 default 到某个具体原因** ——
 *      上一版 default 到"超时"**就是那个 bug 本身**
 *   2. 文本只作**展示**（stderr 尾部原样给用户看），**不参与判类**
 */
export type DownloadFailureKind = 'dns' | 'connect' | 'http-status' | 'timeout' | 'ssl' | 'cert' | 'recv' | 'partial' | 'proxy' | 'unknown';
/** 结构化输入 —— 只有这些字段参与判类。 */
export interface DownloadFailureInput {
    /** curl 退出码（`execFileSync` 抛错时在 `error.status`）。 */
    code?: number | string | undefined;
    /** 被信号杀死时的信号名。 */
    signal?: string | undefined;
    /** stderr 尾部 —— **仅用于展示**。 */
    stderrTail?: string | undefined;
}
export declare function classifyCurlExit(input: DownloadFailureInput): {
    kind: DownloadFailureKind;
    note: string;
};
/**
 * `fetch` 失败的归因 —— 同样**只用结构化字段**：`error.cause.code`。
 *
 * 这不是文本解析：`UNABLE_TO_VERIFY_LEAF_SIGNATURE` 这类是 Node 的**错误码**（契约），
 * 而 `error.message` 只是包装文案（不参与判类）。
 */
export declare function classifyFetchError(e: unknown): {
    kind: DownloadFailureKind;
    note: string;
};
/**
 * **通道探活** —— "提前判死"，别让一个死镜像把安装拖满超时。
 *
 * ## 策略（对端真机结论，照抄）
 *
 *   · 超时**只给 4 秒** —— 它是"提前判死"用的，不能自己变成白等
 *   · **403 / 405 按活着处理** —— 很多镜像不支持 HEAD，判死会误杀
 *   · 404 才算真死（地址没有这个包）
 *
 * ## 为什么用 curl（而不是 fetch）
 *
 * 与本文件其它地方同因：这台机器上 Node 的 fetch 连 github 类主机会
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，拿它探活等于**永远判死**。
 * 没有 curl 时**不探活**（按活着处理）—— 宁可多试一次，也不能因为探不了就跳过。
 *
 * ## 与对端实现的差异（按我们的边界裁剪）
 *
 * 他们探的是 **git 智能 HTTP**（`…/info/refs?service=git-upload-pack` + pkt-line 校验）；
 * 我们只下 HTTP archive，`HEAD` 判活足够 —— git 那套整块不抄。
 */
export declare function probeChannel(url: string, timeoutMs?: number): {
    alive: boolean;
    note: string;
};
/**
 * **磁盘口径的实传字节数** —— 判进度以它为准。
 *
 * ## 为什么不解析 curl 的 `-w`（对端点明的更权威口径）
 *
 * `-w` 的输出**在进程被杀时可能根本没有**（我们这边表现为"空串"，
 * 见 `bytesFromExecError` 那一串判空）。而 `.part` 的**实际大小是权威口径**：
 * 跨平台、跨 curl 版本、**被杀也准**，还不依赖 stdout 是否被捕获。
 *
 * 于是"拿不到字节数就只能不赌"这件事**从根上消失** —— 永远拿得到。
 * `-w` 的数字退化为**辅助信息**（平均速率有意义，字节数以磁盘为准）。
 *
 * ⚠️ 这只是"量了多少"，**不代表完整性**：截断由后面的 `tar -xzf` 兜住
 * （截断的 gzip 解包会报错，不会被当成成功）。
 */
export declare function partSizeOnDisk(partPath: string): number;
/**
 * 从 `execFileSync` 抛出的错误里取 curl `-w` 报的**实传字节数**（辅助信息）。
 *
 * 为什么取得到：命令带了 `-w '%{size_download} …'`，而 Node 的 `execFileSync`
 * 抛错时会把**已经产生的 stdout/stderr 挂在 error 上**（`error.stdout`）。
 *
 * ⚠️ **JS 的"空/无"与"零"默认会被混为一谈**，这一族坑值得一起记：
 *
 *     Number('')  === 0       // ← 我们真踩到的那个
 *     Number(' ') === 0       // 空格同理
 *     +' '        === 0
 *     parseInt('') === NaN    // 唯独 parseInt 例外；但 parseInt('12abc') === 12（部分解析）
 *
 * 所以凡"缺失"与"计数为 0"**结论相反**的地方，都要**前置判空** ——
 * 并且"结论相反的两个分支"必须**各自有断言**，否则它就以"偶尔误判"的形态永远活着。
 *
 * @returns 字节数；拿不到返回 -1（与"传了 0 字节"是**两种**情况，不能混）
 */
export declare function bytesFromExecError(e: unknown): number;
/**
 * 安装一张卡片到 cardsRoot/<id>/。
 *
 * 幂等：目标已存在时**覆盖**（用户重装/升级的场景），
 * 但先校验来源合法再动目标目录 —— 不能校验失败还把旧的删了。
 */
export declare function installCard(spec: string, cardsRoot: string, auditLog: (msg: string) => void): Promise<InstallResult>;
/** 从已安装目录卸载一张卡片。 */
export declare function uninstallCard(cardId: string, cardsRoot: string): {
    ok: boolean;
    reason?: string;
};
export {};
