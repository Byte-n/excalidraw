import { collaborationApiDocumentation } from "./api-documentation.generated.js";
import { directExecutor } from "./direct-executor.js";
import {
  createCanvasCollaboration,
  createCanvasSceneReader,
} from "./collaboration.js";

import {
  ScriptApiInfoInputSchema,
  ScriptDocumentationOutputSchema,
  ScriptExecuteCodeInputSchema,
  ScriptExportInputSchema,
  ScriptExportOutputSchema,
  ScriptOverviewInputSchema,
  ScriptOutputSchema,
} from "./schemas.js";

import type {
  CanvasExecuteCodeHooks,
  CanvasExportHooks,
  CanvasScriptHooks,
} from "./port.js";

const scriptMethods = collaborationApiDocumentation.members.map(
  (member) => member.signature,
);
const documentation = (member?: string): string => {
  const members = collaborationApiDocumentation.members.filter(
    (entry) => !member || entry.name === member,
  );
  const text = members
    .map((entry) =>
      [
        entry.signature,
        entry.description,
        ...entry.parameters.map(
          (parameter) => `参数 ${parameter.name}: ${parameter.type}`,
        ),
        `返回: Promise<${entry.returns}>`,
      ].join("\n"),
    )
    .join("\n\n");
  const referencedTypes: { name: string; definition: string }[] = [];
  let references = text;
  for (
    let index = 0;
    index < collaborationApiDocumentation.types.length;
    index++
  ) {
    for (const type of collaborationApiDocumentation.types) {
      if (
        !referencedTypes.some((entry) => entry.name === type.name) &&
        new RegExp(`\\b${type.name}\\b`).test(references)
      ) {
        referencedTypes.push(type);
        references += `\n${type.definition}`;
      }
    }
  }
  return `execute_code 中所有公开方法均返回 Promise；原始宿主方法可同步或异步。\n\n${text}\n\n${referencedTypes
    .map((type) => `${type.name} = ${type.definition}`)
    .join("\n\n")}`;
};
const validDocumentation = (text: string) =>
  ScriptDocumentationOutputSchema.parse({
    ok: true,
    status: "read",
    result: { text },
  });

export const createCanvasOverviewTool = () => ({
  name: "high_level_overview" as const,
  description: "说明画板协作脚本的使用顺序、六个 API 方法和提交边界。",
  inputSchema: ScriptOverviewInputSchema,
  outputSchema: ScriptDocumentationOutputSchema,
  execute: async (input: unknown) => {
    const parsed = ScriptOverviewInputSchema.parse(input);
    void parsed;
    return validDocumentation(
      `先读取 collaboration.getScene 或 getElements，再用 write 模式下的 mutate/execute 提交；query 查询领域元素，createElement 构造基础形状草稿后用 mutate(add) 提交；每批提交独立回执，local_applied 不代表远端持久化。\n\n${scriptMethods.join(
        "\n",
      )}`,
    );
  },
});

export const createCanvasApiInfoTool = () => ({
  name: "collaboration_api_info" as const,
  description:
    "查询从 CanvasCollaborationApi 类型和 JSDoc 自动生成的 API 文档，包含参数、返回类型及能力限制。",
  inputSchema: ScriptApiInfoInputSchema,
  outputSchema: ScriptDocumentationOutputSchema,
  execute: async (input: unknown) => {
    const parsed = ScriptApiInfoInputSchema.parse(input);
    return validDocumentation(documentation(parsed.member));
  },
});

export const createCanvasExecuteCodeTool = (hooks: CanvasExecuteCodeHooks) => ({
  name: "execute_code" as const,
  description:
    "在指定画板执行 JavaScript；宿主可注入沙箱，负责权限、审批、取消和资源释放。",
  inputSchema: ScriptExecuteCodeInputSchema,
  outputSchema: ScriptOutputSchema,
  execute: async (input: unknown, execution: { signal?: AbortSignal } = {}) => {
    const parsed = ScriptExecuteCodeInputSchema.parse(input);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    execution.signal?.addEventListener("abort", cancel, { once: true });
    if (execution.signal?.aborted) {
      cancel();
    }
    const context = { ...parsed, signal: controller.signal };
    try {
      const session = await hooks.sessionFactory(context);
      const collaboration = await (hooks.collaborationFactory?.(
        session,
        context,
      ) ?? createCanvasCollaboration(session, context));
      const executor = hooks.executor ?? directExecutor;
      const result = await executor.execute({
        code: parsed.code,
        collaboration,
        signal: context.signal,
        cancel,
        onError: (error) => hooks.onError?.(error, context),
      });
      return ScriptOutputSchema.parse(result);
    } finally {
      cancel();
      execution.signal?.removeEventListener("abort", cancel);
    }
  },
});

export const createCanvasExportTool = (hooks: CanvasExportHooks) => ({
  name: "export" as const,
  description: "从一次有效协作会话读取指定画板的完整 canonical elements 快照。",
  inputSchema: ScriptExportInputSchema,
  outputSchema: ScriptExportOutputSchema,
  execute: async (input: unknown, execution: { signal?: AbortSignal } = {}) => {
    const parsed = ScriptExportInputSchema.parse(input);
    const context = { ...parsed, signal: execution.signal };
    if (context.signal?.aborted) {
      throw new Error("execution_cancelled");
    }
    const session = await hooks.sessionFactory(context);
    const scene = createCanvasSceneReader(session, context)();
    return ScriptExportOutputSchema.parse({
      ok: true,
      status: "read",
      result: { canvasId: parsed.canvasId, ...scene },
    });
  },
});

export const createCanvasScriptTools = (hooks: CanvasScriptHooks) =>
  [
    createCanvasOverviewTool(),
    createCanvasApiInfoTool(),
    createCanvasExecuteCodeTool(hooks),
    createCanvasExportTool(hooks),
  ] as const;
