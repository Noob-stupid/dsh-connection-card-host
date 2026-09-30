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
