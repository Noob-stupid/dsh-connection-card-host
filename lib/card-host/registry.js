export class CardRegistry {
    templates = new Map();
    instances = new Map();
    modules = new Map();
    registerTemplate(template) {
        this.templates.set(template.templateId, template);
    }
    /**
     * 只在「已安装」来源里清空模板，内置的保留。
     *
     * 用于重扫前剔除**已经消失**的卡片（卸载、目录被手工删掉）。
     * 不做这件事的话，scanTemplates 只增不减 —— 卸载掉的卡片会一直挂在
     * 列表里直到宿主重启，用户点了会得到一个"模板未找到"。
     *
     * 只清 installed：内置卡片随插件发布，不可能"在磁盘上消失"，
     * 清掉再重扫纯属浪费（而且内置根目录万一临时读不到就全没了）。
     */
    clearInstalledTemplates() {
        for (const [id, t] of [...this.templates]) {
            if (t.source === 'installed') {
                this.templates.delete(id);
                // 模块缓存也要清，否则重装同名卡片会命中旧代码
                this.modules.delete(id);
            }
        }
    }
    getTemplate(templateId) {
        return this.templates.get(templateId);
    }
    listTemplates() {
        return Array.from(this.templates.values());
    }
    registerInstance(instance) {
        this.instances.set(instance.instanceId, instance);
    }
    getInstance(instanceId) {
        return this.instances.get(instanceId);
    }
    removeInstance(instanceId) {
        this.instances.delete(instanceId);
    }
    listInstancesByConnection(connectionId) {
        return Array.from(this.instances.values()).filter((i) => i.connectionId === connectionId);
    }
    /** 某个模板当前装载在哪些连接上（更新卡片后要逐个重载）。 */
    listInstancesByTemplate(templateId) {
        return Array.from(this.instances.values()).filter((i) => i.templateId === templateId);
    }
    /** 缓存动态 import 的卡片模块（templateId → apply/mountPanel）。 */
    setModule(templateId, mod) {
        this.modules.set(templateId, mod);
    }
    getModule(templateId) {
        return this.modules.get(templateId);
    }
    removeModule(templateId) {
        this.modules.delete(templateId);
    }
}
//# sourceMappingURL=registry.js.map