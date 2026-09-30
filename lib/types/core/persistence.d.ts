import type { Connection, CardInstance, ConnectionMessage } from '../types/index.js';
import type { Convention } from './box.js';
export interface PersistedData {
    version: number;
    connections: Connection[];
    cardInstances: CardInstance[];
    /** 每条连接的交流记录（connectionId → 消息数组）。 */
    messages: Record<string, ConnectionMessage[]>;
    /** 每条连接的共享约定（connectionId → 公约数组）。 */
    conventions: Record<string, Convention[]>;
    settings: Record<string, unknown>;
}
/**
 * $DSH_HOME 的解析（与 Persistence 用同一套逻辑）。
 *
 * 导出出去是为了让别处也能算出"我们的目录" —— 卡片安装目录必须和
 * connections.json 在同一个 $DSH_HOME 下，不能各算各的。
 */
export declare function dshHomeDir(): string;
export declare function getBaseDir(): string;
export declare class Persistence {
    private data;
    private dataPath;
    private backupPath;
    constructor();
    /** 暴露存储根目录（$DSH_HOME/connection-cards/），供卡片宿主定位插件目录。 */
    baseDir(): string;
    /**
     * 把读入的 JSON 归一化成当前结构。
     *
     * ⚠️ 必须做：老版本文件缺少新加的字段（例如 `messages`），
     * 直接当成新结构用会在第一次访问时抛 undefined —— 而且是在
     * ConnectionManager 构造期间炸，整个 apply 都会挂。
     * 缺字段补默认值，坏值丢弃，绝不让磁盘上的旧数据决定内存结构。
     */
    private normalize;
    private load;
    save(): void;
    getConnections(): Connection[];
    setConnections(connections: Connection[]): void;
    getCardInstances(): CardInstance[];
    setCardInstances(instances: CardInstance[]): void;
    addConnection(conn: Connection): void;
    updateConnection(id: string, updater: (c: Connection) => Connection): void;
    removeConnection(id: string): void;
    /** 某连接的交流记录。 */
    getMessages(connectionId: string): ConnectionMessage[];
    /** 原子替换某连接的交流记录（调用方已做好条数上限）。 */
    setMessages(connectionId: string, messages: ConnectionMessage[]): void;
    /** 所有连接的交流记录（启动时灌入 messageLog）。 */
    getAllMessages(): Record<string, ConnectionMessage[]>;
    getConventions(connectionId: string): Convention[];
    setConventions(connectionId: string, list: Convention[]): void;
    getAllConventions(): Record<string, Convention[]>;
}
