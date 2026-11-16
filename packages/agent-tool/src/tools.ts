import { createCanvasSceneReader } from "./collaboration.js";
import { buildCanvasOverviewText, createDocsApi } from "./docs/index.js";
import { directExecutor } from "./direct-executor.js";
import { createCanvasSdk } from "./sdk/index.js";

import {
  ScriptDocumentationOutputSchema,
  ScriptDocsInputSchema,
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

const validDocumentation = (result: {
  text: string;
  docsVersion?: string;
  truncated?: boolean;
}) =>
  ScriptDocumentationOutputSchema.parse({
    ok: true,
    status: "read",
    result,
  });

export const createCanvasOverviewTool = () => ({
  name: "canvas_overview" as const,
  description:
    "返回画布 SDK 的工具索引、读写边界、apply/layout 用法与 shape/layout 索引。",
  inputSchema: ScriptOverviewInputSchema,
  outputSchema: ScriptDocumentationOutputSchema,
  execute: async (input: unknown) => {
    const parsed = ScriptOverviewInputSchema.parse(input);
    void parsed;
    return validDocumentation({ text: buildCanvasOverviewText() });
  },
});

export const createCanvasApiInfoTool = () => ({
  name: "canvas_docs" as const,
  description:
    "按 guide/topic 查询画布规则、API 签名、shape/layout/error 清单与任务示例。",
  inputSchema: ScriptDocsInputSchema,
  outputSchema: ScriptDocumentationOutputSchema,
  execute: async (input: unknown) => {
    const parsed = ScriptDocsInputSchema.parse(input);
    const docs = createDocsApi();
    if (parsed.action === "index") {
      const index = await docs.index(
        parsed.kind ? { kind: parsed.kind } : undefined,
      );
      return validDocumentation({
        docsVersion: index.docsVersion,
        text: [
          `docsVersion: ${index.docsVersion}`,
          ...index.guides.map((guide) =>
            [
              `${guide.id}（${guide.title}）：${guide.summary}`,
              ...guide.topics.map(
                (topic) =>
                  `- ${guide.id}/${topic.id}（${topic.title}）：${topic.summary}`,
              ),
            ].join("\n"),
          ),
        ].join("\n\n"),
      });
    }
    if (parsed.action === "read") {
      const result = await docs.read({
        guide: parsed.guide,
        ...(parsed.topic ? { topic: parsed.topic } : {}),
        ...(parsed.includeExamples !== undefined
          ? { includeExamples: parsed.includeExamples }
          : {}),
      });
      return validDocumentation({
        text: result.text,
        docsVersion: result.docsVersion,
        truncated: result.truncated,
      });
    }
    const result = await docs.search({
      query: parsed.query,
      ...(parsed.kind ? { kind: parsed.kind } : {}),
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    });
    return validDocumentation({
      docsVersion: result.docsVersion,
      text: [
        `docsVersion: ${result.docsVersion}`,
        `共 ${result.total} 条命中`,
        ...result.items.map(
          (item) =>
            `${item.guide}/${item.topic}（${item.title}）：${item.snippet}`,
        ),
      ].join("\n"),
    });
  },
});

export const createCanvasExecuteCodeTool = (hooks: CanvasExecuteCodeHooks) => ({
  name: "execute_code" as const,
  description:
    "在指定画板执行 JavaScript；注入 canvas SDK，宿主可替换执行器并负责权限、审批、取消和资源释放。",
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
      const canvas = await (hooks.sdkFactory?.(session, context) ??
        createCanvasSdk(session, context));
      const executor = hooks.executor ?? directExecutor;
      const result = await executor.execute({
        code: parsed.code,
        canvas,
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
  name: "canvas_export" as const,
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
