/**
 * 持久化层 — connections.json + 原子写入 + .bak 恢复。
 * 存储位置：$DSH_HOME/connection-cards/connections.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
const CURRENT_VERSION = 1;
/**
 * $DSH_HOME 的解析（与 Persistence 用同一套逻辑）。
 *
 * 导出出去是为了让别处也能算出"我们的目录" —— 卡片安装目录必须和
 * connections.json 在同一个 $DSH_HOME 下，不能各算各的。
 */
export function dshHomeDir() {
    return (process.env.DSH_HOME ||
        join(process.env.HOME || process.env.USERPROFILE || '.', '.dsh'));
}
export function getBaseDir() {
    const dshHome = dshHomeDir();
    return join(dshHome, 'connection-cards');
}
function getDataPath() {
    return join(getBaseDir(), 'connections.json');
}
function getBackupPath() {
    return join(getBaseDir(), 'connections.json.bak');
}
function emptyData() {
    return {
        version: CURRENT_VERSION,
        connections: [],
        cardInstances: [],
        messages: {},
        conventions: {},
        settings: {},
    };
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
    /**
     * 把读入的 JSON 归一化成当前结构。
     *
     * ⚠️ 必须做：老版本文件缺少新加的字段（例如 `messages`），
     * 直接当成新结构用会在第一次访问时抛 undefined —— 而且是在
     * ConnectionManager 构造期间炸，整个 apply 都会挂。
     * 缺字段补默认值，坏值丢弃，绝不让磁盘上的旧数据决定内存结构。
     */
    normalize(parsed) {
        const base = emptyData();
        if (!parsed || typeof parsed !== 'object')
            return base;
        const p = parsed;
        const messages = {};
        if (p.messages && typeof p.messages === 'object') {
            for (const [key, value] of Object.entries(p.messages)) {
                if (Array.isArray(value))
                    messages[key] = value;
            }
        }
        const conventions = {};
        if (p.conventions && typeof p.conventions === 'object') {
            for (const [key, value] of Object.entries(p.conventions)) {
                if (Array.isArray(value))
                    conventions[key] = value;
            }
        }
        return {
            version: CURRENT_VERSION,
            connections: Array.isArray(p.connections) ? p.connections : [],
            cardInstances: Array.isArray(p.cardInstances) ? p.cardInstances : [],
            messages,
            conventions,
            settings: p.settings && typeof p.settings === 'object' ? p.settings : {},
        };
    }
    load() {
        try {
            if (existsSync(this.dataPath)) {
                const raw = readFileSync(this.dataPath, 'utf8');
                return this.normalize(JSON.parse(raw));
            }
        }
        catch (e) {
            console.error('[Persistence] load failed, trying backup:', e);
            try {
                if (existsSync(this.backupPath)) {
                    const raw = readFileSync(this.backupPath, 'utf8');
                    return this.normalize(JSON.parse(raw));
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
        delete this.data.messages[id];
        this.save();
    }
    /** 某连接的交流记录。 */
    getMessages(connectionId) {
        return this.data.messages[connectionId] ?? [];
    }
    /** 原子替换某连接的交流记录（调用方已做好条数上限）。 */
    setMessages(connectionId, messages) {
        if (messages.length === 0)
            delete this.data.messages[connectionId];
        else
            this.data.messages[connectionId] = messages;
        this.save();
    }
    /** 所有连接的交流记录（启动时灌入 messageLog）。 */
    getAllMessages() {
        return this.data.messages;
    }
    getConventions(connectionId) {
        return this.data.conventions[connectionId] ?? [];
    }
    setConventions(connectionId, list) {
        if (list.length === 0)
            delete this.data.conventions[connectionId];
        else
            this.data.conventions[connectionId] = list;
        this.save();
    }
    getAllConventions() {
        return this.data.conventions;
    }
}
//# sourceMappingURL=persistence.js.map