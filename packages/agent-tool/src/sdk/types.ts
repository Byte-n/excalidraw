import type { CanvasOp } from "./schemas.js";

export type CanvasBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type CanvasPoint = { x: number; y: number };
export type CanvasWarning = {
  code: string;
  message: string;
  path?: string;
  from?: unknown;
  to?: unknown;
};
export type CanvasTextStyleInput = {
  fontSize?: number;
  fontFamily?: number | string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  color?: string;
  lineHeight?: number;
};
export type CanvasElementSummary = {
  id: string;
  type: string;
  kind?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  graphId?: string;
  isDeleted?: boolean;
};
export type CanvasSceneView =
  | { view: "summary"; elements: CanvasElementSummary[]; total: number }
  | {
      view: "full";
      schemaVersion: 2;
      elements: Record<string, unknown>[];
      assets: Record<string, unknown>;
    };
export type CanvasSceneApi = {
  get(input?: {
    view?: "summary" | "full";
    ids?: string[];
    region?: CanvasBounds;
  }): Promise<CanvasSceneView>;
  search(input: {
    query: string;
    types?: string[];
    limit?: number;
    offset?: number;
  }): Promise<{
    items: CanvasElementSummary[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  }>;
  getElements(ids: string[]): Promise<Record<string, unknown>[]>;
};
export type CanvasTextApi = {
  measure(input: { text: string; style?: CanvasTextStyleInput }): Promise<{
    width: number;
    height: number;
    lineHeight: number;
    lines: number;
  }>;
  fit(input: {
    text: string;
    style?: CanvasTextStyleInput;
    maxWidth: number;
    maxHeight?: number;
  }): Promise<{
    text: string;
    lines: string[];
    width: number;
    height: number;
    truncated: boolean;
  }>;
};
export type CanvasApplyInput = {
  ops: CanvasOp[];
  expectedVersions?: Record<string, number>;
  dryRun?: boolean;
  idempotencyKey?: string;
};
export type CanvasApplyReceipt = {
  elements: Array<{
    id: string;
    tempId?: string;
    type: string;
    kind?: string;
    bounds: CanvasBounds;
    label?: string;
  }>;
  bounds: CanvasBounds;
  warnings: CanvasWarning[];
  changedElementIds: string[];
  createdElementIds: string[];
  deletedElementIds: string[];
  tempIds: Record<string, string>;
  references: Array<Record<string, unknown>>;
};
export type CanvasLayoutInput = {
  ids: string[];
  algorithm:
    | "layered"
    | "tree"
    | "grid"
    | "row"
    | "column"
    | "stack"
    | "align"
    | "distribute";
  origin?: CanvasPoint;
  options?: {
    direction?: "TB" | "LR";
    rankGap?: number;
    nodeGap?: number;
    gap?: number;
    columns?: number;
    axis?: "x" | "y";
    position?: "start" | "center" | "end";
  };
  dryRun?: boolean;
};
export type CanvasLayoutReceipt = {
  elements: Array<{
    id: string;
    type: string;
    kind?: string;
    bounds: CanvasBounds;
    label?: string;
  }>;
  bounds: CanvasBounds;
  warnings: CanvasWarning[];
  affectedElementIds: string[];
  layoutToken: string;
};
export type CanvasValidateInput = {
  ids?: string[];
  checks?: Array<"overlap" | "overflow" | "bindings" | "dangling">;
};
export type CanvasValidateIssue = {
  code: "overlap" | "overflow" | "bindings" | "dangling";
  severity: "warning" | "error";
  elementIds: string[];
  message: string;
};
export type CanvasValidateResult = {
  ok: boolean;
  issues: CanvasValidateIssue[];
};
export type CanvasSchemaType =
  | "apply"
  | "layout"
  | "text"
  | "validate"
  | "scene"
  | "export";
export interface CanvasSdk {
  /** 只读场景访问：summary 轻量摘要，full 返回 canonical 快照。 */
  readonly scene: CanvasSceneApi;
  /** 文本度量与换行；Node 端自动安装确定性估算度量。 */
  readonly text: CanvasTextApi;
  /** 语义操作批；同批 tempId 可互相引用，失败整批回滚。 */
  readonly apply: (input: CanvasApplyInput) => Promise<CanvasApplyReceipt>;
  /** 对已有 id 执行布局；由发起方计算并提交。 */
  readonly layout: {
    apply(input: CanvasLayoutInput): Promise<CanvasLayoutReceipt>;
  };
  /** 结构校验：重叠、文本溢出、绑定、悬空连线。 */
  readonly validate: (
    input?: CanvasValidateInput,
  ) => Promise<CanvasValidateResult>;
  /** 返回 Zod 生成的 JSON Schema。 */
  readonly schema: {
    get(input: { type: CanvasSchemaType }): Promise<Record<string, unknown>>;
  };
  /** 导出 JSON 快照；SVG/PNG 本期不支持。 */
  readonly export: (input?: {
    format?: "json";
    ids?: string[];
    region?: CanvasBounds;
  }) => Promise<Record<string, unknown>>;
}
