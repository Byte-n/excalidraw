import type { ExcalidrawSceneElement } from "@excalidraw/yjs";
import type { HocuspocusHeadlessSession } from "@excalidraw/yjs-hocuspocus-client";

import type { ScriptExecuteCodeInput, ScriptExportInput } from "./schemas.js";

/** 协作对象由当前 session 能力构造；执行器仅桥接其显式公开的方法。 */
export type CanvasCollaborationApi = Readonly<
  Record<string, (...args: unknown[]) => unknown | Promise<unknown>>
>;
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
