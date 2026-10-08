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

const scriptMethods = [
  "getScene() -> Promise<SceneSnapshot>",
  "getElements(ids?: string[]) -> Promise<CanonicalElement[]>",
  "query(input) -> Promise<CanvasQueryResult>",
  "createElement(input) -> Promise<CanonicalDraft>",
  "mutate(input) -> Promise<BatchReceipt>",
  "execute(input) -> Promise<CanvasReceipt>",
] as const;
const documentation = (member?: string): string => {
  if (member) {
    return (
      scriptMethods.find((method) => method.startsWith(`${member}(`)) ??
      "未知协作 API 成员"
    );
  }
  return scriptMethods.join("\n");
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
      `先读取 collaboration.getScene 或 query，再用 createElement 与 mutate/execute 提交；每批提交独立回执，local_applied 不代表远端持久化。\n\n${scriptMethods.join(
        "\n",
      )}`,
    );
  },
});

export const createCanvasApiInfoTool = () => ({
  name: "collaboration_api_info" as const,
  description: "返回实际公开的六个协作 API 方法及 Promise 输入输出。",
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
