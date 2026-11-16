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
  /** 读取场景摘要、完整快照或指定 id/区域内的元素。 */
  get(input?: {
    view?: "summary" | "full";
    ids?: string[];
    region?: CanvasBounds;
  }): Promise<CanvasSceneView>;
  /** 按文本、类型分页搜索未删除元素。 */
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
  /** 按 id 读取完整 canonical 元素；任一 id 不存在则报 target_not_found。 */
  getElements(ids: string[]): Promise<Record<string, unknown>[]>;
};
export type CanvasTextApi = {
  /** 度量单行或多行文本的宽高与行高。 */
  measure(input: { text: string; style?: CanvasTextStyleInput }): Promise<{
    width: number;
    height: number;
    lineHeight: number;
    lines: number;
  }>;
  /** 在最大宽度/高度内换行并返回可放入盒子的文本。 */
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
    | "sequence"
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
export type CanvasDiagramNodeInput = {
  id: string;
  kind?: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};
export type CanvasDiagramEdgeInput = {
  id?: string;
  from: string;
  to: string;
  label?: string;
  kind?: "arrow" | "line";
  routing?: "straight" | "curved" | "orthogonal";
};
export type CanvasGenerateDiagramInput = {
  format?: "json" | "mermaid";
  spec: {
    nodes: CanvasDiagramNodeInput[];
    edges?: CanvasDiagramEdgeInput[];
  };
  origin?: CanvasPoint;
  layout?:
    | false
    | {
        direction?: "TB" | "LR";
        rankGap?: number;
        nodeGap?: number;
      };
  dryRun?: boolean;
  idempotencyKey?: string;
};
export type CanvasSequenceParticipantInput = {
  id?: string;
  label: string;
  kind?: string;
  width?: number;
  height?: number;
};
export type CanvasSequenceMessageInput = {
  id?: string;
  from: string;
  to: string;
  label?: string;
};
export type CanvasSequenceFragmentInput = {
  id?: string;
  operator?: string;
  participants?: string[];
  messages?: string[];
};
export type CanvasGenerateSequenceInput = {
  participants: CanvasSequenceParticipantInput[];
  messages?: CanvasSequenceMessageInput[];
  fragments?: CanvasSequenceFragmentInput[];
  origin?: CanvasPoint;
  layout?: false | { gap?: number; rankGap?: number; nodeGap?: number };
  dryRun?: boolean;
  idempotencyKey?: string;
};
export type CanvasMindmapNodeInput = {
  text: string;
  children?: CanvasMindmapNodeInput[];
};
export type CanvasMindmapDirection =
  | "left-to-right"
  | "right-to-left"
  | "top-to-bottom"
  | "bottom-to-top";
export type CanvasGenerateMindmapInput = {
  root: CanvasMindmapNodeInput;
  direction?: CanvasMindmapDirection;
  origin?: CanvasPoint;
  dryRun?: boolean;
  idempotencyKey?: string;
};
export type CanvasGenerateTableInput = {
  columns: string[];
  rows: string[][];
  header?: boolean;
  name?: string;
  maxWidth?: number;
  origin?: CanvasPoint;
  dryRun?: boolean;
  idempotencyKey?: string;
};
export type CanvasGenerateApi = {
  /** 从语义 JSON 建流程图：节点+连线，可选 layered 布局；本期不解析 Mermaid 源码。 */
  diagram(input: CanvasGenerateDiagramInput): Promise<CanvasApplyReceipt>;
  /** 从参与者/消息/片段建时序图，并在同一次事务内执行 sequence 布局。 */
  sequence(input: CanvasGenerateSequenceInput): Promise<CanvasApplyReceipt>;
  /** 从文本树建脑图并按 direction 布局。 */
  mindmap(input: CanvasGenerateMindmapInput): Promise<CanvasApplyReceipt>;
  /** 建表格并写入表头/数据单元格。 */
  table(input: CanvasGenerateTableInput): Promise<CanvasApplyReceipt>;
};
export type CanvasExportInput = {
  format?: "json" | "svg" | "png";
  ids?: string[];
  region?: CanvasBounds;
  scale?: number;
  background?: boolean;
  backgroundColor?: string;
  padding?: number;
};
export type CanvasJsonExportResult = {
  format: "json";
  schemaVersion: 2;
  elements: Record<string, unknown>[];
  assets: Record<string, unknown>;
};
export type CanvasSvgExportResult = {
  format: "svg";
  mimeType: "image/svg+xml";
  data: string;
  width: number;
  height: number;
};
export type CanvasPngExportResult = {
  format: "png";
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
};
export type CanvasExportResult =
  | CanvasJsonExportResult
  | CanvasSvgExportResult
  | CanvasPngExportResult;
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
  | "generate"
  | "text"
  | "validate"
  | "scene"
  | "export";
export type CanvasDocsKind = "guide" | "type" | "shape" | "layout" | "error";
export type CanvasDocsTopicSummary = {
  id: string;
  title: string;
  summary: string;
  kind: CanvasDocsKind;
};
export type CanvasDocsGuide = {
  id: string;
  title: string;
  summary: string;
  topics: CanvasDocsTopicSummary[];
};
export type CanvasDocsIndex = {
  docsVersion: string;
  guides: CanvasDocsGuide[];
};
export type CanvasDocsReadInput = {
  guide: string;
  topic?: string;
  includeExamples?: boolean;
};
export type CanvasDocsReadResult = {
  docsVersion: string;
  guide: string;
  topic?: string;
  text: string;
  truncated: boolean;
  fullLength?: number;
};
export type CanvasDocsSearchInput = {
  query: string;
  kind?: CanvasDocsKind;
  limit?: number;
};
export type CanvasDocsSearchResult = {
  docsVersion: string;
  items: Array<{
    guide: string;
    topic: string;
    title: string;
    snippet: string;
  }>;
  total: number;
};
export type CanvasDocsApi = {
  /** 列出 guide 与 topic 索引；kind 可过滤 topic 分类。 */
  index(input?: { kind?: CanvasDocsKind }): Promise<CanvasDocsIndex>;
  /** 读取 guide 的 topic 列表或单个 topic；单次响应上限约 4000 字符。 */
  read(input: CanvasDocsReadInput): Promise<CanvasDocsReadResult>;
  /** 按标题/摘要/正文搜索 topic，返回命中附近片段。 */
  search(input: CanvasDocsSearchInput): Promise<CanvasDocsSearchResult>;
};
export interface CanvasSdk {
  /** 只读场景访问：summary 轻量摘要，full 返回 canonical 快照。 */
  readonly scene: CanvasSceneApi;
  /** 文本度量与换行；Node 端自动安装确定性估算度量。 */
  readonly text: CanvasTextApi;
  /** 语义操作批；同批 tempId 可互相引用，失败整批回滚。 */
  readonly apply: (input: CanvasApplyInput) => Promise<CanvasApplyReceipt>;
  /** 语义生成器：diagram/sequence/mindmap/table，复用 apply 事务与纯布局。 */
  readonly generate: CanvasGenerateApi;
  /** 对已有 id 执行布局；由发起方计算并提交。 */
  readonly layout: {
    /** 计算并提交布局，返回受影响元素、bounds 与 layoutToken。 */
    apply(input: CanvasLayoutInput): Promise<CanvasLayoutReceipt>;
  };
  /** 结构校验：重叠、文本溢出、绑定、悬空连线。 */
  readonly validate: (
    input?: CanvasValidateInput,
  ) => Promise<CanvasValidateResult>;
  /** 返回 Zod 生成的 JSON Schema。 */
  readonly schema: {
    /** 按类型返回 apply/layout/generate/text/validate/scene/export 的 JSON Schema。 */
    get(input: { type: CanvasSchemaType }): Promise<Record<string, unknown>>;
  };
  /** 导出 JSON 快照、SVG 或 PNG；PNG 在 Node 端光栅化。 */
  readonly export: (input?: CanvasExportInput) => Promise<CanvasExportResult>;
  /** 按 guide/topic 查询画布规则、API 签名、shape/layout/error 清单。 */
  readonly docs: CanvasDocsApi;
}
