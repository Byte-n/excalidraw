import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import type { HocuspocusHeadlessSession } from "@excalidraw/yjs-hocuspocus-client";

import type { z } from "zod";

import type {
  CreateElementInputSchema,
  ExecuteInputSchema,
  MutateInputSchema,
  MutationReceiptSchema,
} from "./collaboration.js";
import type {
  CanvasQueryResult,
  ShapeQueryInputSchema,
  ConnectorQueryInputSchema,
  MindmapQueryInputSchema,
  TableQueryInputSchema,
  CanvasReceipt,
} from "./schemas.js";

import type { ScriptExecuteCodeInput, ScriptExportInput } from "./schemas.js";

/** 原始宿主调用可同步或异步；execute_code 中所有方法均包装为 Promise。 */
export type CanvasApiResult<T> = T | Promise<T>;
export type CanvasJsonValue =
  | null
  | boolean
  | number
  | string
  | CanvasJsonValue[]
  | { [key: string]: CanvasJsonValue };
export type CanvasSceneSnapshot = {
  schemaVersion: 2;
  elements: ExcalidrawSceneElement[];
  assets: Record<string, CanvasJsonValue>;
};
export type CanvasMutationInput = z.infer<typeof MutateInputSchema>;
export type CanvasMutationReceipt = z.infer<typeof MutationReceiptSchema>;
export type CanvasCreateElementInput = z.input<typeof CreateElementInputSchema>;
export type CanvasExecuteInput = z.infer<typeof ExecuteInputSchema>;
export type CanvasShapeQueryInput = z.input<typeof ShapeQueryInputSchema>;
export type CanvasConnectorQueryInput = z.input<
  typeof ConnectorQueryInputSchema
>;
export type CanvasMindmapQueryInput = z.input<typeof MindmapQueryInputSchema>;
export type CanvasTableQueryInput = z.input<typeof TableQueryInputSchema>;
export type CanvasQueryInput =
  | { domain: "shape"; operation: CanvasShapeQueryInput }
  | { domain: "connector"; operation: CanvasConnectorQueryInput }
  | { domain: "mindmap"; operation: CanvasMindmapQueryInput }
  | { domain: "table"; operation: CanvasTableQueryInput };

/** 默认 session 协作对象；写方法仅在 write 模式下公开。 */
export interface CanvasCollaborationApi {
  /** 返回 schemaVersion=2 的完整 canonical 快照，包含墓碑和 assets；要求会话同步且未取消。 */
  readonly getScene: () => CanvasApiResult<CanvasSceneSnapshot>;
  /** 省略 ids 返回全部元素。最多 10000 个非空 ID；任一 ID 不存在则抛出 target_not_found。 */
  readonly getElements: (
    ids?: string[],
  ) => CanvasApiResult<CanvasSceneSnapshot["elements"]>;
  /** 按领域读取未删除的 canonical 元素；list 默认 offset=0、limit=50，最多 200。get 目标不存在抛出 target_not_found；table cellId 返回单元格，mindmap graphId 返回图内元素。text 按元素 JSON 子串匹配。 */
  readonly query: (
    input: CanvasQueryInput,
  ) => CanvasApiResult<CanvasQueryResult>;
  /** 构造基础形状 canonical JSON 草稿，不提交；kind 使用 BASE_SHAPE_IDS，几何尺寸必须为正数。复杂连接、思维导图与表格使用 execute 创建。 */
  readonly createElement?: (
    input: CanvasCreateElementInput,
  ) => CanvasApiResult<ExcalidrawSceneElement>;
  /** 提交 1–1000 条 add/update/delete/connect。新增元素须为完整 JSON canonical 元素；expectedVersion 为正安全整数；要求实时编辑权限。回执仅代表本地提交。 */
  readonly mutate?: (
    input: CanvasMutationInput,
  ) => CanvasApiResult<CanvasMutationReceipt>;
  /** 提交 shape/connector/mindmap/table 领域操作；按 domain/action 校验参数，要求实时编辑权限。回执仅代表本地提交。 */
  readonly execute?: (
    input: CanvasExecuteInput,
  ) => CanvasApiResult<CanvasReceipt>;
}

export type CanvasExecutionContext = Readonly<
  ScriptExecuteCodeInput & { signal?: AbortSignal }
>;
export type CanvasCodeExecutor = Readonly<{
  execute(
    input: Readonly<{
      code: string;
      collaboration: CanvasCollaborationApi;
      signal?: AbortSignal;
      cancel?: () => void;
      onError?: (error: unknown) => void;
    }>,
  ): Promise<unknown>;
}>;
export type CanvasExecuteCodeHooks = Readonly<{
  sessionFactory(
    context: CanvasExecutionContext,
  ):
    | HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>
    | Promise<HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>>;
  collaborationFactory?(
    session: HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>,
    context: CanvasExecutionContext,
  ): CanvasCollaborationApi | Promise<CanvasCollaborationApi>;
  executor?: CanvasCodeExecutor;
  onError?(error: unknown, context: CanvasExecutionContext): void;
}>;
export type CanvasExportContext = Readonly<
  ScriptExportInput & { signal?: AbortSignal }
>;
export type CanvasExportHooks = Readonly<{
  sessionFactory(
    context: CanvasExportContext,
  ):
    | HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>
    | Promise<HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>>;
}>;
export type CanvasScriptHooks = Readonly<{
  sessionFactory(
    context: CanvasExecutionContext | CanvasExportContext,
  ):
    | HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>
    | Promise<HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>>;
}> &
  Pick<CanvasExecuteCodeHooks, "collaborationFactory" | "executor" | "onError">;
