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
 * 为一个 URL 排出**下载通道表**（按可信度排序）。
 *
 * GitHub 类：codeload（官方、无重定向、无配额）→ ghproxy（镜像兜底，**可能 0 B/s**）→ 原 URL。
 * 其它：原 URL 直连。
 *
 * ⚠️ 镜像**不能硬编码成唯一出路**：对端记录 `mirror.ghproxy.com` 早已失效并被停放页接管 ——
 * 所以镜像只做**兜底**，且必须能失败后继续（见 downloadTo 的逐通道重试）。
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
 * 下载失败的**归因**（对端参考实现里最有用的一段）。
 *
 * 关键是识别出"**本机代理/证书拦截**"这一类 —— 今天撞的
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 与 `CRYPT_E_NO_REVOCATION_CHECK` 都在这一类里。
 * 指引里写"检测到本机加速器/代理，建议关掉再试"比"请检查网络"有用一个量级。
 */
export declare function classifyDownloadFailure(text: string): {
    kind: 'intercepted' | 'unreachable';
    note: string;
};
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
