/**
 * 卡片更新检查与执行。
 *
 * ## 为什么单独一个文件
 *
 * `installer.ts` 管"装"，这里管"**装过之后**"：记录在案的是哪一版、上游有没有新版、
 * 要不要更新。三件事共用"来源记录"这一份数据，但和安装本身是两回事。
 *
 * ## 各来源怎么判断"有没有新版"
 *
 * | 来源 | 判断方式 | 说明 |
 * |:---|:---|:---|
 * | `npm` | `npm view <name> version` | 和记录的 `installedVersion` 比 |
 * | `dir` | 重新算来源指纹 | 指纹变了 = 作者改了本地目录 |
 * | `tgz-file` | 文件大小 + mtime | 粗略但够用 |
 * | `tgz-url` | HTTP HEAD 的 ETag/Last-Modified | 拿不到就说"无法判断" |
 *
 * **拿不到结论时如实说"无法判断"，不猜。** 猜错的更新比不更新更糟。
 */
import { type CardSourceRecord } from './card-paths.js';
/** 一次更新检查的结论。 */
export interface UpdateCheck {
    cardId: string;
    /** 记录的来源（给面板显示"从哪装的"）。 */
    spec: string;
    kind: CardSourceRecord['kind'];
    /** 当前生效的版本目录名。 */
    dirName: string;
    /** 当前版本（记录的，或从目录名回退解析）。 */
    currentVersion?: string;
    /** 上游最新版本（能查到才有）。 */
    latestVersion?: string;
    /** 有没有新版。`undefined` = 判断不了（见 reason）。 */
    hasUpdate?: boolean;
    /** 判断不了时说明原因 —— **不要静默返回"无更新"**。 */
    reason?: string;
}
/** 读一个卡片的来源记录（没有就返回 null，不抛）。 */
export declare function readSourceRecord(cardsRoot: string, cardId: string): CardSourceRecord | null;
/** 当前生效的版本目录名（指针优先，回退到记录）。 */
export declare function currentDirName(cardsRoot: string, cardId: string): string | undefined;
/**
 * 检查一个卡片有没有更新。
 *
 * **判断不了时 `hasUpdate` 留空并给 `reason`** —— 面板据此显示"无法检查"而不是
 * 谎报"已是最新"。
 */
export declare function checkCardUpdate(cardsRoot: string, cardId: string): UpdateCheck;
