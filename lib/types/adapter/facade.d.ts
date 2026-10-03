/**
 * 能力门面（facade）—— 当**真模块取不到**时，我们替插件提供的最小可运行面。
 *
 * ## 为什么需要它
 *
 * 普通 DSH 插件的入口在模块顶层 import `@deepseek-ai/*`，而卡片运行时
 * **物理上解析不到这些包**（`adapter-design.md` F1，已用真运行验证）。
 * 垫片层的职责是让这些 import 能落地，落地方式有两档：
 *
 *   档一（优先）：垫片 `re-export` **真模块** —— 插件拿到与 DSH 相同的实例。
 *   档二（回退）：真模块取不到时（例如只存在于 asar 内、当前加载方式读不到），
 *                 由本文件的**门面**提供等价面。
 *
 * ⚠️ 务必诚实标注：走档二时，插件运行的**不是**官方实现，而是本文件的等价物。
 * 差异要写在这里，并且在挂载时记审计（哪个包走了哪一档）。
 *
 * ## 忠实度：`defineTool` 是照官方实现写的
 *
 * 依据（`app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`）：
 *
 *   · `defineTool` 在第 838 行
 *   · 参数规格 → JSON Schema 走 `parameterSchemaSpecToJsonSchema`（第 802 行）
 *   · 属性是否 required 的**确切规则**在第 601-604 行：
 *       - 属性**默认可选**；
 *       - 仅当属性对象里显式写了 `required: true` 才进 `required` 数组；
 *       - `required` 若存在但**不是 `true`** ⇒ 官方直接报 authorError。
 *   · `timeoutMs` 必须是正有限数（第 847 行）
 *
 * **本门面与官方的已知差异**（MVP 阶段刻意不做，需在协议里写明）：
 *
 *   1. **不做执行期参数校验**：官方 `execute` 会先跑 `validateJsonSchemaValue`
 *      并在违规时抛 `ToolArgsError`。本门面只把 schema 交给**桥接层**，
 *      由桥接层在注册进 DSH 工具服务时使用官方校验（我们那侧能用真 `defineTool`）。
 *   2. **不实现 `Schema` 的校验语义**：`Config` 只在模块顶层被**构造**，
 *      槽位挂载时配置由我们给，不做 schema 校验。
 *   3. 未知/超集关键字不报错 —— 官方会 `authorError`。这里选择宽容，
 *      因为门面的定位是"让插件跑起来"，严格性交给桥接层。
 */
/** JSON Schema 片段（本门面只产出官方支持的子集）。 */
export interface JsonSchema {
    type?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    enum?: unknown[];
    const?: unknown;
    oneOf?: JsonSchema[];
    description?: string;
    title?: string;
    default?: unknown;
    examples?: unknown[];
}
/** 插件作者写的**参数规格**：属性名 → 值 schema。 */
export type ParameterSpec = Record<string, JsonSchema>;
/**
 * 参数规格 → 对象根 JSON Schema。
 *
 * 忠实复刻官方 `parameterSchemaSpecToJsonSchema`（第 802 行）的输出形态：
 *   `{ type: 'object', properties, required? }` —— `required` 为空时**整个键都不出现**。
 */
export declare function parametersToJsonSchema(spec: ParameterSpec | undefined): JsonSchema;
/** 官方 `defineTool` 接受的入参（只声明我们门面实现的那些字段）。 */
export interface DefineToolOptions {
    name: string;
    description: string;
    parameters?: ParameterSpec;
    output: {
        schema: JsonSchema;
        render: (args: unknown, value: unknown) => unknown;
        presentationMeta?: (args: unknown, value: unknown) => unknown;
    };
    execute: (args: unknown, exec: unknown) => Promise<unknown>;
    deferLoading?: boolean;
    timeoutMs?: number;
    finalizeContent?: (exec: unknown, result: unknown) => unknown;
    projectContent?: (exec: unknown, result: unknown) => unknown;
    presentCall?: (args: unknown) => unknown;
    presentResult?: (args: unknown, result: unknown) => unknown;
    isConcurrencySafe?: (args: unknown) => boolean;
}
/** 注册表可用的工具定义（与官方 `defineTool` 的产物同形）。 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: JsonSchema;
    output: {
        schema: JsonSchema;
        render: (args: unknown, value: unknown) => unknown;
        presentationMeta?: (args: unknown, value: unknown) => unknown;
    };
    deferLoading?: boolean;
    timeoutMs?: number;
    execute: (args: unknown, exec: unknown) => Promise<unknown>;
    finalizeContent?: (exec: unknown, result: unknown) => unknown;
    projectContent?: (exec: unknown, result: unknown) => unknown;
    presentCall?: (args: unknown) => unknown;
    presentResult?: (args: unknown, result: unknown) => unknown;
    isConcurrencySafe?: (args: unknown) => boolean;
    /**
     * 非官方字段：标记这个定义来自**能力门面**而非官方实现。
     * 桥接层据此可以决定是否补校验、以及在审计里标注来源。
     */
    __facade?: true;
}
/**
 * `defineTool` 的门面实现。
 *
 * 契约与官方一致（见文件头"忠实度"），差异见文件头"已知差异"。
 */
export declare function defineTool(options: DefineToolOptions): ToolDefinition;
/** 惰性描述符：记录被声明的形状，不参与校验。 */
export interface SchemaDescriptor {
    /** 这份描述符声明的类型名（用于审计与排查）。 */
    readonly __schemaType: string;
    /** 链式方法返回自身，保证 `Schema.string().default('x')` 之类不断链。 */
    default(value: unknown): SchemaDescriptor;
    optional(): SchemaDescriptor;
    description(text: string): SchemaDescriptor;
    required(value?: boolean): SchemaDescriptor;
    [key: string]: unknown;
}
/** `Schema` 门面：只保证"构造得出来"。 */
export declare const Schema: {
    object(shape?: Record<string, unknown>): SchemaDescriptor;
    string(): SchemaDescriptor;
    number(): SchemaDescriptor;
    boolean(): SchemaDescriptor;
    array(inner?: unknown): SchemaDescriptor;
    any(): SchemaDescriptor;
    const(value: unknown): SchemaDescriptor;
    union(): SchemaDescriptor;
};
