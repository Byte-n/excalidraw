import { z } from "zod";

import { ARROWHEAD_VALUES, BASE_SHAPE_IDS } from "@excalidraw/yjs";

const finite = z.number().finite();
const positive = finite.positive();
const id = z.string().min(1);
const point = z.object({ x: finite, y: finite }).strict();
const geometry = z
  .object({
    x: finite,
    y: finite,
    width: positive,
    height: positive,
    angle: finite.optional(),
  })
  .strict();
const geometryPatch = z
  .object({
    x: finite.optional(),
    y: finite.optional(),
    width: positive.optional(),
    height: positive.optional(),
    angle: finite.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "几何更新不能为空");
const target = z
  .object({
    elementId: id,
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
const nodeTarget = z
  .object({
    graphId: id,
    nodeId: id,
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
const tableTarget = z
  .object({
    tableId: id,
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
const nullableString = z.string().nullable().optional();
const nullableNumber = finite.nullable().optional();
const shapeStyle = z
  .object({
    strokeColor: nullableString,
    backgroundColor: nullableString,
    fillStyle: z
      .enum(["hachure", "cross-hatch", "solid", "zigzag"])
      .nullable()
      .optional(),
    strokeWidth: nullableNumber,
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).nullable().optional(),
    roughness: nullableNumber,
    opacity: finite.min(0).max(100).nullable().optional(),
    roundness: z.enum(["round", "sharp"]).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "样式更新不能为空");
const connectorStyle = z
  .object({
    strokeColor: nullableString,
    strokeWidth: nullableNumber,
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).nullable().optional(),
    roughness: nullableNumber,
    opacity: finite.min(0).max(100).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "样式更新不能为空");
const textStyle = z
  .object({
    fontSize: positive.nullable().optional(),
    fontFamily: z.number().int().positive().nullable().optional(),
    color: nullableString,
    textAlign: z.enum(["left", "center", "right"]).nullable().optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "文字样式更新不能为空");

const triangleOptions = z
  .object({ apexX: finite.min(0).max(1).nullable().optional() })
  .strict();
const trapezoidOptions = z
  .object({
    narrowWidthRatio: finite.min(0.05).max(1).nullable().optional(),
    narrowEdge: z.enum(["top", "bottom"]).nullable().optional(),
  })
  .strict();
const cubeOptions = z
  .object({
    controlPoint: z
      .object({
        x: finite.min(0.05).max(0.95).nullable().optional(),
        y: finite.min(0.05).max(0.95).nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0),
  })
  .strict();
const circularOptions = z
  .object({
    centralAngle: finite.min(0.01).max(360).nullable().optional(),
    radius: finite.min(0.01).max(1_000_000).nullable().optional(),
    sectorRatio: finite.min(0).max(1).nullable().optional(),
    startRadialLineAngle: finite.min(-360).max(360).nullable().optional(),
  })
  .strict();
const shapeOptions = z.union([
  triangleOptions,
  trapezoidOptions,
  cubeOptions,
  circularOptions,
]);
const shapeKind = z.enum(BASE_SHAPE_IDS);
const shapeCreate = z
  .object({
    action: z.literal("create"),
    kind: shapeKind,
    geometry,
    text: z.string().optional(),
    style: shapeStyle.optional(),
    textStyle: textStyle.optional(),
    shapeOptions: shapeOptions.optional(),
  })
  .strict();
const shapeUpdate = z
  .object({
    action: z.literal("update"),
    target,
    geometry: geometryPatch.optional(),
    text: z.string().optional(),
    style: shapeStyle.optional(),
    textStyle: textStyle.optional(),
    shapeOptions: shapeOptions.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [
        value.geometry,
        value.text,
        value.style,
        value.textStyle,
        value.shapeOptions,
      ].some((entry) => entry !== undefined),
    "图形更新不能为空",
  );
const shapeDelete = z.object({ action: z.literal("delete"), target }).strict();
export const ShapeEditInputSchema = z.discriminatedUnion("action", [
  shapeCreate,
  shapeUpdate,
  shapeDelete,
]);
export type ShapeEditInput = z.infer<typeof ShapeEditInputSchema>;

const endpoint = z.union([
  z.object({ elementId: id }).strict(),
  z.object({ point }).strict(),
]);
const connectorUpdate = z
  .object({
    action: z.literal("update"),
    target,
    routing: z.enum(["straight", "curved", "orthogonal"]).optional(),
    label: z.string().optional(),
    startArrowhead: z.enum(ARROWHEAD_VALUES).nullable().optional(),
    endArrowhead: z.enum(ARROWHEAD_VALUES).nullable().optional(),
    style: connectorStyle.optional(),
    textStyle: textStyle.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).some((key) => !["action", "target"].includes(key)),
    "连线更新不能为空",
  );
const connectorCreate = z
  .object({
    action: z.literal("create"),
    kind: z.enum(["line", "arrow"]),
    start: endpoint,
    end: endpoint,
    routing: z.enum(["straight", "curved", "orthogonal"]).optional(),
    label: z.string().optional(),
    startArrowhead: z.enum(ARROWHEAD_VALUES).nullable().optional(),
    endArrowhead: z.enum(ARROWHEAD_VALUES).nullable().optional(),
    style: connectorStyle.optional(),
    textStyle: textStyle.optional(),
  })
  .strict();
const connectorReconnect = z
  .object({
    action: z.literal("reconnect"),
    target,
    start: endpoint.optional(),
    end: endpoint.optional(),
  })
  .strict()
  .refine(
    (value) => value.start !== undefined || value.end !== undefined,
    "重连至少指定一个端点",
  );
const connectorDelete = z
  .object({ action: z.literal("delete"), target })
  .strict();
export const ConnectorEditInputSchema = z.discriminatedUnion("action", [
  connectorCreate,
  connectorUpdate,
  connectorReconnect,
  connectorDelete,
]);
export type ConnectorEditInput = z.infer<typeof ConnectorEditInputSchema>;

export const MindmapEditInputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("createRoot"),
      position: point,
      text: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.enum(["addChild", "addSibling", "rename"]),
      target: nodeTarget,
      text: z.string(),
    })
    .strict(),
  z
    .object({ action: z.literal("move"), target: nodeTarget, position: point })
    .strict(),
  z
    .object({
      action: z.literal("reparent"),
      target: nodeTarget,
      parentNodeId: id,
      beforeNodeId: id.optional(),
    })
    .strict(),
  z.object({ action: z.literal("deleteSubtree"), target: nodeTarget }).strict(),
]);
export type MindmapEditInput = z.infer<typeof MindmapEditInputSchema>;

const cellStyle = z
  .object({
    backgroundColor: nullableString,
    clipContent: z.boolean().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const tableStyleTitle = z
  .object({
    gap: finite.nonnegative().nullable().optional(),
    align: z.enum(["start", "center", "end"]).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const tableStyle = z
  .object({
    backgroundColor: nullableString,
    opacity: finite.min(0).max(100).nullable().optional(),
    borderColor: nullableString,
    borderWidth: finite.nonnegative().nullable().optional(),
    borderStyle: z.enum(["solid", "dashed", "dotted"]).nullable().optional(),
    gridColor: nullableString,
    gridWidth: finite.nonnegative().nullable().optional(),
    gridStyle: z.enum(["solid", "dashed", "dotted"]).nullable().optional(),
    clipContent: z.boolean().nullable().optional(),
    title: tableStyleTitle.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "表格样式更新不能为空");
export const TableEditInputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      position: point,
      rowCount: z.number().int().positive(),
      columnCount: z.number().int().positive(),
      title: z.string().optional(),
      style: tableStyle.optional(),
    })
    .strict(),
  z.object({ action: z.literal("delete"), target: tableTarget }).strict(),
  z
    .object({
      action: z.literal("setCellText"),
      target: tableTarget,
      cellId: id,
      text: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("insertRow"),
      target: tableTarget,
      at: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ action: z.literal("deleteRow"), target: tableTarget, rowId: id })
    .strict(),
  z
    .object({
      action: z.literal("insertColumn"),
      target: tableTarget,
      at: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("deleteColumn"),
      target: tableTarget,
      columnId: id,
    })
    .strict(),
  z
    .object({
      action: z.literal("mergeCells"),
      target: tableTarget,
      firstCellId: id,
      lastCellId: id,
    })
    .strict(),
  z
    .object({ action: z.literal("splitCell"), target: tableTarget, cellId: id })
    .strict(),
  z
    .object({
      action: z.literal("setCellStyle"),
      target: tableTarget,
      cellId: id,
      style: cellStyle,
    })
    .strict(),
  z
    .object({
      action: z.literal("setTitle"),
      target: tableTarget,
      text: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("setStyle"),
      target: tableTarget,
      style: tableStyle,
    })
    .strict(),
]);
export type TableEditInput = z.infer<typeof TableEditInputSchema>;

const pageFields = {
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(50),
};
export const ShapeQueryInputSchema = z.union([
  z
    .object({
      action: z.literal("list"),
      elementId: id.optional(),
      text: z.string().optional(),
      ...pageFields,
    })
    .strict(),
  z.object({ action: z.literal("get"), elementId: id }).strict(),
]);
export type ShapeQueryInput = z.infer<typeof ShapeQueryInputSchema>;

export const ConnectorQueryInputSchema = z.union([
  z
    .object({
      action: z.literal("list"),
      elementId: id.optional(),
      text: z.string().optional(),
      ...pageFields,
    })
    .strict(),
  z.object({ action: z.literal("get"), elementId: id }).strict(),
]);
export type ConnectorQueryInput = z.infer<typeof ConnectorQueryInputSchema>;
export const MindmapQueryInputSchema = z.union([
  z
    .object({
      action: z.literal("list"),
      text: z.string().optional(),
      ...pageFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("get"),
      graphId: id,
      nodeId: id.optional(),
      ...pageFields,
    })
    .strict(),
]);
export type MindmapQueryInput = z.infer<typeof MindmapQueryInputSchema>;
export const TableQueryInputSchema = z.union([
  z
    .object({
      action: z.literal("list"),
      text: z.string().optional(),
      ...pageFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("get"),
      tableId: id,
      cellId: id.optional(),
      ...pageFields,
    })
    .strict(),
]);
export type TableQueryInput = z.infer<typeof TableQueryInputSchema>;

export const CanvasToolErrorSchema = z
  .object({
    code: z.enum([
      "invalid_input",
      "target_not_found",
      "version_conflict",
      "invalid_operation",
      "invalid_scene",
      "invalid_asset",
      "scene_limit_exceeded",
      "not_editable",
      "session_unavailable",
      "internal_error",
      "canvas_not_found",
      "forbidden",
      "approval_rejected",
    ]),
    message: z.string(),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }).strict())
      .readonly()
      .optional(),
  })
  .strict();
export type CanvasToolError = z.infer<typeof CanvasToolErrorSchema>;

export const CanvasQueryResultSchema = z
  .object({
    domain: z.enum(["shape", "connector", "mindmap", "table"]),
    items: z.array(z.record(z.string(), z.unknown())),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
  })
  .strict();
export type CanvasQueryResult = z.infer<typeof CanvasQueryResultSchema>;
export const CanvasReceiptSchema = z
  .object({
    changedElementIds: z.array(id),
    createdElementIds: z.array(id),
    deletedElementIds: z.array(id),
    result: z
      .object({
        domain: z.enum(["shape", "connector", "mindmap", "table"]),
        action: z.string(),
        references: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
export type CanvasReceipt = z.infer<typeof CanvasReceiptSchema>;
export const CanvasToolResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal("read"),
      result: CanvasQueryResultSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      status: z.literal("local_applied"),
      receipt: CanvasReceiptSchema,
    })
    .strict(),
  z.object({ ok: z.literal(false), error: CanvasToolErrorSchema }).strict(),
]);
export type CanvasToolResult = z.infer<typeof CanvasToolResultSchema>;

/** 查询工具只会返回读取结果或错误。 */
export const CanvasQueryToolResultSchema = z.union([
  z.object({ ok: z.literal(true), status: z.literal("read"), result: CanvasQueryResultSchema }).strict(),
  z.object({ ok: z.literal(false), error: CanvasToolErrorSchema }).strict(),
]);
export type CanvasQueryToolResult = z.infer<typeof CanvasQueryToolResultSchema>;

/** 编辑工具只会返回本地应用回执或错误。 */
export const CanvasEditToolResultSchema = z.union([
  z.object({ ok: z.literal(true), status: z.literal("local_applied"), receipt: CanvasReceiptSchema }).strict(),
  z.object({ ok: z.literal(false), error: CanvasToolErrorSchema }).strict(),
]);
export type CanvasEditToolResult = z.infer<typeof CanvasEditToolResultSchema>;
