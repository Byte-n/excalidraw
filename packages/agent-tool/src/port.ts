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
