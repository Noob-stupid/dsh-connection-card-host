import type { Connection, CardInstance } from '../types/index.js';
export interface PersistedData {
    version: number;
    connections: Connection[];
    cardInstances: CardInstance[];
    settings: Record<string, unknown>;
}
export declare class Persistence {
    private data;
    private dataPath;
    private backupPath;
    constructor();
    /** 暴露存储根目录（$DSH_HOME/connection-cards/），供卡片宿主定位插件目录。 */
    baseDir(): string;
    private load;
    save(): void;
    getConnections(): Connection[];
    setConnections(connections: Connection[]): void;
    getCardInstances(): CardInstance[];
    setCardInstances(instances: CardInstance[]): void;
    addConnection(conn: Connection): void;
    updateConnection(id: string, updater: (c: Connection) => Connection): void;
    removeConnection(id: string): void;
}
