export class CardRegistry {
    templates = new Map();
    instances = new Map();
    modules = new Map();
    registerTemplate(template) {
        this.templates.set(template.templateId, template);
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