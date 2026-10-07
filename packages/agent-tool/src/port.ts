import type { CanvasLocalReceipt, CanvasSceneOperation } from "@excalidraw/yjs";

import type { CanvasQueryResult } from "./schemas";

/** 宿主注入的最小端口；连接、权限、审批和生命周期不属于 agent-tool。 */
export type CanvasSceneQuery = Readonly<{
  domain: "shape" | "connector" | "mindmap" | "table";
  input: Readonly<Record<string, unknown>>;
}>;

export type CanvasAgentPort = Readonly<{
  query(query: CanvasSceneQuery): CanvasQueryResult;
  execute(operation: CanvasSceneOperation): CanvasLocalReceipt;
}>;

/** 脚本工具注入端口；宿主负责鉴权、审批、运行时和会话生命周期。 */
export type CanvasScriptPort = Readonly<{
  executeCode(input: { canvasId: string; code: string; mode: "read" | "write" }): Promise<unknown>;
  exportScene(input: { canvasId: string }): Promise<unknown>;
}>;
