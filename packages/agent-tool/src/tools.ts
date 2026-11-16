import { LAYOUT_ALGORITHM_IDS } from "@excalidraw/element";
import { SHAPE_IDS } from "@excalidraw/yjs";

import { collaborationApiDocumentation } from "./api-documentation.generated.js";
import { createCanvasSceneReader } from "./collaboration.js";
import { directExecutor } from "./direct-executor.js";
import { createCanvasSdk } from "./sdk/index.js";

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
  name: "canvas_overview" as const,
  description:
    "返回画布 SDK 的工具索引、读写边界、apply/layout 用法与 shape/layout 索引。",
  inputSchema: ScriptOverviewInputSchema,
  outputSchema: ScriptDocumentationOutputSchema,
  execute: async (input: unknown) => {
    const parsed = ScriptOverviewInputSchema.parse(input);
    void parsed;
    return validDocumentation(
      [
        "工具：canvas_overview、canvas_docs、execute_code、canvas_export。",
        '只读：canvas.scene.get/search/getElements、canvas.text.measure/fit、canvas.validate、canvas.schema.get、canvas.export({ format: "json" })。',
        "写入：execute_code 使用 write 模式且会话可编辑时，canvas.apply({ ops, expectedVersions?, dryRun?, idempotencyKey? }) 提交语义操作；同批 tempId 可互相引用，失败整批回滚。",
        "布局：canvas.layout.apply({ ids, algorithm, origin?, options?, dryRun? }) 对已有元素计算布局并随同一次事务提交，回执含 layoutToken。",
        "回执：apply/layout 返回 elements、bounds、warnings 与变更 id；local_applied 仅表示本地提交成功，不代表远端持久化。",
        `shape kind 索引：${SHAPE_IDS.join("、")}。`,
        `layout 算法：${LAYOUT_ALGORITHM_IDS.join("、")}。`,
        "不要手写 canonical JSON；通过 canvas.apply 的语义操作创建和修改元素。",
        `协作 API 签名：\n${scriptMethods.join("\n")}`,
      ].join("\n\n"),
    );
  },
});

export const createCanvasApiInfoTool = () => ({
  name: "canvas_docs" as const,
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
