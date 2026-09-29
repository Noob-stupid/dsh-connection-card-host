/**
 * 持久化层 — connections.json + 原子写入 + .bak 恢复。
 * 存储位置：$DSH_HOME/connection-cards/connections.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
const CURRENT_VERSION = 1;
function getBaseDir() {
    const dshHome = process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE || '.', '.dsh');
    return join(dshHome, 'connection-cards');
}
function getDataPath() {
    return join(getBaseDir(), 'connections.json');
}
function getBackupPath() {
    return join(getBaseDir(), 'connections.json.bak');
}
function emptyData() {
    return { version: CURRENT_VERSION, connections: [], cardInstances: [], settings: {} };
}
export class Persistence {
    data;
    dataPath;
    backupPath;
    constructor() {
        this.dataPath = getDataPath();
        this.backupPath = getBackupPath();
        this.data = this.load();
    }
    /** 暴露存储根目录（$DSH_HOME/connection-cards/），供卡片宿主定位插件目录。 */
    baseDir() {
        return getBaseDir();
    }
    load() {
        try {
            if (existsSync(this.dataPath)) {
                const raw = readFileSync(this.dataPath, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed.version === CURRENT_VERSION)
                    return parsed;
                // TODO: 版本迁移逻辑（按版本号顺序执行）
                return parsed;
            }
        }
        catch (e) {
            console.error('[Persistence] load failed, trying backup:', e);
            try {
                if (existsSync(this.backupPath)) {
                    const raw = readFileSync(this.backupPath, 'utf8');
                    return JSON.parse(raw);
                }
            }
            catch {
                console.error('[Persistence] backup also failed, starting fresh');
            }
        }
        return emptyData();
    }
    save() {
        try {
            mkdirSync(getBaseDir(), { recursive: true });
            // 先写备份
            if (existsSync(this.dataPath)) {
                try {
                    renameSync(this.dataPath, this.backupPath);
                }
                catch { /* ignore */ }
            }
            writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf8');
        }
        catch (e) {
            console.error('[Persistence] save failed:', e);
        }
    }
    getConnections() {
        return this.data.connections;
    }
    setConnections(connections) {
        this.data.connections = connections;
        this.save();
    }
    getCardInstances() {
        return this.data.cardInstances;
    }
    setCardInstances(instances) {
        this.data.cardInstances = instances;
        this.save();
    }
    addConnection(conn) {
        this.data.connections.push(conn);
        this.save();
    }
    updateConnection(id, updater) {
        const idx = this.data.connections.findIndex((c) => c.id === id);
        if (idx !== -1) {
            this.data.connections[idx] = updater(this.data.connections[idx]);
            this.save();
        }
    }
    removeConnection(id) {
        this.data.connections = this.data.connections.filter((c) => c.id !== id);
        // 标记关联卡片为 orphaned（保留状态便于回滚）
        for (const ci of this.data.cardInstances) {
            if (ci.connectionId === id) {
                ci.enabled = false;
            }
        }
        this.save();
    }
}
//# sourceMappingURL=persistence.js.map