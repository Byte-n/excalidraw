import { YjsSceneError } from "@excalidraw/yjs";

import type { CanvasSceneOperation } from "@excalidraw/yjs";

import {
  CanvasToolResultSchema,
  CanvasQueryToolResultSchema,
  CanvasEditToolResultSchema,
  ConnectorEditInputSchema,
  ConnectorQueryInputSchema,
  MindmapEditInputSchema,
  MindmapQueryInputSchema,
  ShapeEditInputSchema,
  ShapeQueryInputSchema,
  TableEditInputSchema,
  TableQueryInputSchema,
  type CanvasToolError,
  type CanvasToolResult,
  type ConnectorEditInput,
  type MindmapEditInput,
  type ShapeEditInput,
  type TableEditInput,
} from "./schemas";

import type { CanvasAgentPort } from "./port";

export type CanvasAgentTool<
  TInputSchema extends import("zod").ZodType = import("zod").ZodType,
  TOutputSchema extends import("zod").ZodType = import("zod").ZodType,
> = Readonly<{
  name: string;
  description: string;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  execute(input: import("zod").infer<TInputSchema>): import("zod").infer<TOutputSchema>;
}>;

const errorResult = (error: CanvasToolError): CanvasToolResult => ({
  ok: false,
  error,
});

const mapError = (error: unknown): CanvasToolError => {
  if (error instanceof YjsSceneError) {
    return { code: error.code, message: error.message };
  }
  return { code: "internal_error", message: "画板工具执行失败" };
};

const versionedTarget = <T extends { expectedVersion?: number }>(target: T) => {
  const { expectedVersion, ...withoutVersion } = target;
  return {
    target: withoutVersion,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
};

const toOperation = (
  domain: CanvasSceneOperation["domain"],
  value:
    | ShapeEditInput
    | ConnectorEditInput
    | MindmapEditInput
    | TableEditInput,
): CanvasSceneOperation => {
  if (domain === "shape") {
    const shapeValue = value as ShapeEditInput;
    if (shapeValue.action === "update" || shapeValue.action === "delete") {
      const target = versionedTarget(shapeValue.target);
      return {
        domain,
        operation: { ...shapeValue, ...target },
        ...("expectedVersion" in target
          ? { expectedVersion: target.expectedVersion }
          : {}),
      } as CanvasSceneOperation;
    }
    return { domain, operation: shapeValue } as CanvasSceneOperation;
  }
  if (domain === "connector") {
    const connectorValue = value as ConnectorEditInput;
    if (
      connectorValue.action === "update" ||
      connectorValue.action === "reconnect" ||
      connectorValue.action === "delete"
    ) {
      const target = versionedTarget(connectorValue.target);
      return {
        domain,
        operation: { ...connectorValue, ...target },
        ...("expectedVersion" in target
          ? { expectedVersion: target.expectedVersion }
          : {}),
      } as CanvasSceneOperation;
    }
    return { domain, operation: connectorValue } as CanvasSceneOperation;
  }
  if (domain === "mindmap") {
    const mindmapValue = value as MindmapEditInput;
    if (mindmapValue.action !== "createRoot") {
      const target = versionedTarget(mindmapValue.target);
      return {
        domain,
        operation: { ...mindmapValue, ...target },
        ...("expectedVersion" in target
          ? { expectedVersion: target.expectedVersion }
          : {}),
      } as CanvasSceneOperation;
    }
    return { domain, operation: mindmapValue } as CanvasSceneOperation;
  }
  const tableValue = value as TableEditInput;
  if (tableValue.action === "create") {
    return { domain, operation: tableValue } as CanvasSceneOperation;
  }
  const target = versionedTarget(tableValue.target);
  return {
    domain,
    operation: { ...tableValue, ...target },
    ...("expectedVersion" in target
      ? { expectedVersion: target.expectedVersion }
      : {}),
  } as CanvasSceneOperation;
};

const receiptOutput = (
  receipt: import("@excalidraw/yjs").CanvasLocalReceipt,
) => {
  const references = Object.fromEntries(
    Object.entries(receipt.result.references).filter(
      ([, value]) => value !== undefined,
    ),
  );
  return {
    changedElementIds: [...receipt.changedElementIds],
    createdElementIds: [...receipt.createdElementIds],
    deletedElementIds: [...receipt.deletedElementIds],
    result: {
      domain: receipt.result.references.domain,
      action: receipt.result.references.action,
      references,
    },
  };
};

const executeTool = <TOutputSchema extends import("zod").ZodType>(
  port: CanvasAgentPort,
  domain: CanvasSceneOperation["domain"],
  inputSchema: import("zod").ZodType,
  kind: "query" | "edit",
  outputSchema: TOutputSchema,
  rawInput: unknown,
): import("zod").infer<TOutputSchema> => {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return outputSchema.parse({
      ...errorResult({
      code: "invalid_input",
      message: "工具参数无效",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: "参数不符合工具契约",
      })),
      }),
    });
  }
  try {
    const value = parsed.data;
    const output =
      kind === "query"
        ? {
            ok: true as const,
            status: "read" as const,
            result: port.query({
              domain,
              input: value as Readonly<Record<string, unknown>>,
            }),
          }
        : (() => {
            const operation =
              domain === "shape"
                ? toOperation(domain, value as ShapeEditInput)
                : domain === "connector"
                ? toOperation(domain, value as ConnectorEditInput)
                : domain === "mindmap"
                ? toOperation(domain, value as MindmapEditInput)
                : toOperation(domain, value as TableEditInput);
            const receipt = port.execute(operation);
            return {
              ok: true as const,
              status: "local_applied" as const,
              receipt: receiptOutput(receipt),
            };
          })();
    const validated = outputSchema.safeParse(output);
    return validated.success ? validated.data : outputSchema.parse(errorResult({ code: "internal_error", message: "工具输出无效" }));
  } catch (error) {
    return outputSchema.parse(errorResult(mapError(error)));
  }
};

const queryTool = (
  name: string,
  description: string,
  domain: CanvasSceneOperation["domain"],
  schema: import("zod").ZodType,
  port: CanvasAgentPort,
): CanvasAgentTool<typeof schema, typeof CanvasQueryToolResultSchema> => ({
  name,
  description,
  inputSchema: schema,
  outputSchema: CanvasQueryToolResultSchema,
  execute: (input) => executeTool(port, domain, schema, "query", CanvasQueryToolResultSchema, input),
});

const editTool = (
  name: string,
  description: string,
  domain: CanvasSceneOperation["domain"],
  schema: import("zod").ZodType,
  port: CanvasAgentPort,
): CanvasAgentTool<typeof schema, typeof CanvasEditToolResultSchema> => ({
  name,
  description,
  inputSchema: schema,
  outputSchema: CanvasEditToolResultSchema,
  execute: (input) => executeTool(port, domain, schema, "edit", CanvasEditToolResultSchema, input),
});

export const createCanvasAgentTools = (
  port: CanvasAgentPort,
) => [
  queryTool(
    "queryShapes",
    "查询普通图形的语义摘要和稳定 ID。",
    "shape",
    ShapeQueryInputSchema,
    port,
  ),
  editTool(
    "editShapes",
    "创建、更新或删除普通图形；成功表示 local_applied。",
    "shape",
    ShapeEditInputSchema,
    port,
  ),
  queryTool(
    "queryConnectors",
    "查询连线端点、标签和路由摘要。",
    "connector",
    ConnectorQueryInputSchema,
    port,
  ),
  editTool(
    "editConnectors",
    "创建、更新、重连或删除连线；成功表示 local_applied。",
    "connector",
    ConnectorEditInputSchema,
    port,
  ),
  queryTool(
    "queryMindmap",
    "查询脑图根和节点摘要。",
    "mindmap",
    MindmapQueryInputSchema,
    port,
  ),
  editTool(
    "editMindmap",
    "执行一个脑图树操作；成功表示 local_applied。",
    "mindmap",
    MindmapEditInputSchema,
    port,
  ),
  queryTool(
    "queryTable",
    "查询表格、行列和单元格摘要。",
    "table",
    TableQueryInputSchema,
    port,
  ),
  editTool(
    "editTable",
    "执行一个表格语义操作；成功表示 local_applied。",
    "table",
    TableEditInputSchema,
    port,
  ),
];

import type { CanvasScriptPort } from "./port";
import {
  ScriptApiInfoInputSchema,
  ScriptDocumentationOutputSchema,
  ScriptExecuteCodeInputSchema,
  ScriptExportInputSchema,
  ScriptExportOutputSchema,
  ScriptOverviewInputSchema,
  ScriptOutputSchema,
} from "./schemas";

const scriptMethods = [
  "getScene() -> Promise<SceneSnapshot>",
  "getElements(ids?: string[]) -> Promise<CanonicalElement[]>",
  "query(input) -> Promise<CanvasQueryResult>",
  "createElement(input) -> Promise<CanonicalDraft>",
  "mutate(input) -> Promise<BatchReceipt>",
  "execute(input) -> Promise<CanvasReceipt>",
] as const;
const documentation = (member?: string): string => {
  if (member) return scriptMethods.find((method) => method.startsWith(`${member}(`)) ?? "未知协作 API 成员";
  return scriptMethods.join("\n");
};
const validDocumentation = (text: string) => ScriptDocumentationOutputSchema.parse({ ok: true, status: "read", result: { text } });

export const createCanvasScriptTools = (port: CanvasScriptPort) => [
  {
    name: "high_level_overview",
    description: "说明画板协作脚本的使用顺序、六个 API 方法和提交边界。",
    inputSchema: ScriptOverviewInputSchema,
    outputSchema: ScriptDocumentationOutputSchema,
    execute: async (input: unknown) => {
      const parsed = ScriptOverviewInputSchema.parse(input);
      void parsed;
      return validDocumentation("先读取 collaboration.getScene 或 query，再用 createElement 与 mutate/execute 提交；每批提交独立回执，local_applied 不代表远端持久化。\n\n" + scriptMethods.join("\n"));
    },
  },
  {
    name: "collaboration_api_info",
    description: "返回实际公开的六个协作 API 方法及 Promise 输入输出。",
    inputSchema: ScriptApiInfoInputSchema,
    outputSchema: ScriptDocumentationOutputSchema,
    execute: async (input: unknown) => {
      const parsed = ScriptApiInfoInputSchema.parse(input);
      return validDocumentation(documentation(parsed.member));
    },
  },
  {
    name: "execute_code",
    description: "在指定画板执行受限 JavaScript；宿主负责权限、审批、取消和资源释放。",
    inputSchema: ScriptExecuteCodeInputSchema,
    outputSchema: ScriptOutputSchema,
    execute: async (input: unknown) => {
      const parsed = ScriptExecuteCodeInputSchema.parse(input);
      const result = await port.executeCode(parsed);
      return ScriptOutputSchema.parse(result);
    },
  },
  {
    name: "export",
    description: "从一次有效协作会话读取指定画板的完整 canonical elements 快照。",
    inputSchema: ScriptExportInputSchema,
    outputSchema: ScriptExportOutputSchema,
    execute: async (input: unknown) => {
      const parsed = ScriptExportInputSchema.parse(input);
      const result = await port.exportScene(parsed);
      return ScriptExportOutputSchema.parse(result);
    },
  },
] as const;
