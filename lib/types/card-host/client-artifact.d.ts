/**
 * 读插件的**客户端制品**（宿主侧）—— 把源码文本交给浏览器去捕获。
 *
 * ## 为什么由宿主读，而不是浏览器去 fetch
 *
 * 卡片装在 `$DSH_HOME/connection-cards/cards/…`，浏览器够不到那个路径
 * （也不该给它文件系统访问）。面板已经有 RPC 通道，宿主读文件、把**文本**送过去
 * 是最小暴露面：浏览器拿到的是一段源码，不是一个目录句柄。
 *
 * ## 入口怎么定（按官方约定）
 *
 * 官方 UI 插件指引说：`package.json` 加 `dsh.client` 段，
 * **并提供一个 `./client` 导出**。所以：
 *
 *   1. `exports['./client']` 指向的文件（最准）
 *   2. 退而求其次：`lib/client.js` / `client.js`（常见布局）
 *
 * 两者都没有 ⇒ 这张卡片**没有 UI** ⇒ 返回 `no-client`（不是错误：能力型插件本来就可能没 UI）。
 */
/** 客户端制品的读取结果。 */
export interface ClientArtifact {
    ok: boolean;
    /** 相对卡片目录的入口路径（ok 时给出）。 */
    entry?: string;
    /** 源码文本（ok 时给出）。 */
    source?: string;
    /** 失败/不存在的原因（可直接显示给人看）。 */
    reason?: string;
}
/**
 * 读一个卡片目录的客户端制品。
 *
 * @param cardDir 卡片目录（我们自己的那一份副本）
 */
export declare function readClientArtifact(cardDir: string): ClientArtifact;
