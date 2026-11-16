import { z } from "zod";

import {
  LAYOUT_ALGORITHM_IDS,
  SEQUENCE_LIFELINE_IDS,
} from "@excalidraw/element";
import { ARROWHEAD_VALUES, SHAPE_IDS } from "@excalidraw/yjs";

import { CanvasSdkError } from "./errors.js";

const finite = z.number().finite();
const positive = finite.positive();
const id = z.string().min(1);
const point = z.object({ x: finite, y: finite }).strict();
const textAlign = z.enum(["left", "center", "right"]);
const verticalAlign = z.enum(["top", "middle", "bottom"]);
const nullableString = z.string().nullable().optional();
const nullableNumber = finite.nullable().optional();
const nonEmpty = <T extends object>(value: T) => Object.keys(value).length > 0;

const fontFamilyValue = z.union([z.number().int().positive(), id]);

export const CanvasBoundsSchema = z
  .object({
    x: finite,
    y: finite,
    width: finite.nonnegative(),
    height: finite.nonnegative(),
  })
  .strict();

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
    opacity: finite.min(0).max(100).nullable().optional(),
    roundness: z.enum(["round", "sharp"]).nullable().optional(),
  })
  .strict()
  .refine(nonEmpty, "样式更新不能为空");
const connectorStyle = z
  .object({
    strokeColor: nullableString,
    strokeWidth: nullableNumber,
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).nullable().optional(),
    opacity: finite.min(0).max(100).nullable().optional(),
  })
  .strict()
  .refine(nonEmpty, "样式更新不能为空");
const textStyle = z
  .object({
    fontSize: positive.nullable().optional(),
    fontFamily: fontFamilyValue.nullable().optional(),
    color: nullableString,
    textAlign: textAlign.nullable().optional(),
    verticalAlign: verticalAlign.nullable().optional(),
  })
  .strict()
  .refine(nonEmpty, "文字样式更新不能为空");

export const CanvasTextStyleInputSchema = z
  .object({
    fontSize: positive.optional(),
    fontFamily: fontFamilyValue.optional(),
    textAlign: textAlign.optional(),
    verticalAlign: verticalAlign.optional(),
    color: z.string().optional(),
    lineHeight: positive.optional(),
  })
  .strict();

const triangleOptions = z
  .object({ apexX: finite.min(0).max(1).nullable().optional() })
  .strict()
  .refine(nonEmpty);
const trapezoidOptions = z
  .object({
    narrowWidthRatio: finite.min(0.05).max(1).nullable().optional(),
    narrowEdge: z.enum(["top", "bottom"]).nullable().optional(),
  })
  .strict()
  .refine(nonEmpty);
const cubeOptions = z
  .object({
    controlPoint: z
      .object({
        x: finite.min(0.05).max(0.95).nullable().optional(),
        y: finite.min(0.05).max(0.95).nullable().optional(),
      })
      .strict()
      .refine(nonEmpty),
  })
  .strict();
const circularOptions = z
  .object({
    centralAngle: finite.min(0.01).max(360).nullable().optional(),
    radius: finite.min(0.01).max(1_000_000).nullable().optional(),
    sectorRatio: finite.min(0).max(1).nullable().optional(),
    startRadialLineAngle: finite.min(-360).max(360).nullable().optional(),
  })
  .strict()
  .refine(nonEmpty);
const shapeOptions = z.union([
  triangleOptions,
  trapezoidOptions,
  cubeOptions,
  circularOptions,
]);

export const CanvasLabelInputSchema = z
  .object({
    text: z.string(),
    fontSize: positive.optional(),
    fontFamily: fontFamilyValue.optional(),
    textAlign: textAlign.optional(),
    verticalAlign: verticalAlign.optional(),
    color: z.string().optional(),
    fit: z.enum(["auto", "fixed"]).optional(),
    minWidth: positive.optional(),
    minHeight: positive.optional(),
  })
  .strict();
export type CanvasLabelInput = z.infer<typeof CanvasLabelInputSchema>;

export const CanvasTextFitSchema = z
  .object({
    mode: z.enum(["auto", "fixed"]),
    minWidth: positive.optional(),
    minHeight: positive.optional(),
  })
  .strict();

const label = z.union([z.string(), CanvasLabelInputSchema]);
const nullableLabel = label.nullable().optional();
const geometryPatch = z
  .object({
    x: finite.optional(),
    y: finite.optional(),
    width: positive.optional(),
    height: positive.optional(),
    angle: finite.optional(),
  })
  .strict();
const endpoint = z.union([id, z.object({ point }).strict()]);

// 具体 kind 集合由 element 的 SHAPE_IDS 决定；未知 kind 在解析失败时附带 legalValues。
const shapeKind = z.enum(SHAPE_IDS);

const addShape = z
  .object({
    op: z.literal("addShape"),
    tempId: id.optional(),
    kind: shapeKind,
    x: finite,
    y: finite,
    width: positive.optional(),
    height: positive.optional(),
    angle: finite.optional(),
    label: label.optional(),
    style: shapeStyle.optional(),
    textStyle: textStyle.optional(),
    shapeOptions: shapeOptions.optional(),
    textFit: CanvasTextFitSchema.optional(),
  })
  .strict();
const addText = z
  .object({
    op: z.literal("addText"),
    tempId: id.optional(),
    x: finite,
    y: finite,
    text: z.string(),
    width: positive.optional(),
    autoResize: z.boolean().optional(),
    style: textStyle.optional(),
  })
  .strict();
const updateShape = z
  .object({
    op: z.literal("updateShape"),
    id,
    geometry: geometryPatch.optional(),
    label: nullableLabel,
    style: shapeStyle.optional(),
    textStyle: textStyle.optional(),
    shapeOptions: shapeOptions.optional(),
    textFit: CanvasTextFitSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [
        value.geometry,
        value.label,
        value.style,
        value.textStyle,
        value.shapeOptions,
        value.textFit,
      ].some((entry) => entry !== undefined),
    "图形更新不能为空",
  );
const updateText = z
  .object({
    op: z.literal("updateText"),
    id,
    text: z.string().optional(),
    x: finite.optional(),
    y: finite.optional(),
    width: positive.optional(),
    autoResize: z.boolean().optional(),
    style: textStyle.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [
        value.text,
        value.x,
        value.y,
        value.width,
        value.autoResize,
        value.style,
      ].some((entry) => entry !== undefined),
    "文字更新不能为空",
  );
const routing = z.enum(["straight", "curved", "orthogonal"]);
const arrowhead = z.enum(ARROWHEAD_VALUES);
const connectorLabel = z.string().optional();
const connect = z
  .object({
    op: z.literal("connect"),
    tempId: id.optional(),
    kind: z.enum(["arrow", "line"]).optional(),
    from: endpoint,
    to: endpoint,
    routing: routing.optional(),
    label: connectorLabel,
    startArrowhead: arrowhead.nullable().optional(),
    endArrowhead: arrowhead.nullable().optional(),
    style: connectorStyle.optional(),
    textStyle: textStyle.optional(),
  })
  .strict();
const updateConnector = z
  .object({
    op: z.literal("updateConnector"),
    id,
    routing: routing.optional(),
    label: connectorLabel,
    startArrowhead: arrowhead.nullable().optional(),
    endArrowhead: arrowhead.nullable().optional(),
    style: connectorStyle.optional(),
    textStyle: textStyle.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [
        value.routing,
        value.label,
        value.startArrowhead,
        value.endArrowhead,
        value.style,
        value.textStyle,
      ].some((entry) => entry !== undefined),
    "连线更新不能为空",
  );
const deleteOp = z.object({ op: z.literal("delete"), id }).strict();
const move = z
  .object({
    op: z.literal("move"),
    id,
    x: finite.optional(),
    y: finite.optional(),
  })
  .strict()
  .refine(
    (value) => value.x !== undefined || value.y !== undefined,
    "移动至少指定一个坐标",
  );
const resize = z
  .object({
    op: z.literal("resize"),
    id,
    width: positive.optional(),
    height: positive.optional(),
    x: finite.optional(),
    y: finite.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.width, value.height, value.x, value.y].some(
        (entry) => entry !== undefined,
      ),
    "调整尺寸至少指定一个字段",
  );

const layoutOptions = z
  .object({
    direction: z.enum(["TB", "LR"]).optional(),
    rankGap: finite.nonnegative().optional(),
    nodeGap: finite.nonnegative().optional(),
    gap: finite.nonnegative().optional(),
    columns: z.number().int().positive().optional(),
    axis: z.enum(["x", "y"]).optional(),
    position: z.enum(["start", "center", "end"]).optional(),
  })
  .strict();
const layoutOp = z
  .object({
    op: z.literal("layout"),
    algorithm: z.enum(LAYOUT_ALGORITHM_IDS),
    ids: z.array(id).min(1).optional(),
    origin: point.optional(),
    options: layoutOptions.optional(),
  })
  .strict();

const mindmap = z.union([
  z
    .object({
      op: z.literal("mindmap"),
      action: z.literal("createRoot"),
      tempId: id.optional(),
      x: finite,
      y: finite,
      text: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("mindmap"),
      action: z.enum(["addChild", "addSibling"]),
      tempId: id.optional(),
      nodeId: id,
      graphId: id.optional(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("mindmap"),
      action: z.literal("rename"),
      nodeId: id,
      graphId: id.optional(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("mindmap"),
      action: z.literal("reparent"),
      nodeId: id,
      graphId: id.optional(),
      parentNodeId: id,
      beforeNodeId: id.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("mindmap"),
      action: z.literal("deleteSubtree"),
      nodeId: id,
      graphId: id.optional(),
    })
    .strict(),
]);

const cellStyle = z
  .object({
    backgroundColor: nullableString,
    clipContent: z.boolean().nullable().optional(),
  })
  .strict()
  .refine(nonEmpty);
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
    header: z.boolean().nullable().optional(),
  })
  .strict()
  .refine(nonEmpty, "表格样式更新不能为空");

const table = z.union([
  z
    .object({
      op: z.literal("table"),
      action: z.literal("create"),
      tempId: id.optional(),
      position: point,
      rowCount: z.number().int().positive(),
      columnCount: z.number().int().positive(),
      name: z.string().optional(),
      style: tableStyle.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("delete"),
      tableId: id,
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("setCellText"),
      tableId: id,
      cellId: id,
      text: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.enum(["insertRow", "insertColumn"]),
      tableId: id,
      at: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("deleteRow"),
      tableId: id,
      rowId: id,
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("deleteColumn"),
      tableId: id,
      columnId: id,
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("mergeCells"),
      tableId: id,
      firstCellId: id,
      lastCellId: id,
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("splitCell"),
      tableId: id,
      cellId: id,
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("setCellStyle"),
      tableId: id,
      cellId: id,
      style: cellStyle,
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("setName"),
      tableId: id,
      name: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("table"),
      action: z.literal("setStyle"),
      tableId: id,
      style: tableStyle,
    })
    .strict(),
]);

const sequenceEndpoint = z
  .object({ participantId: id, activationId: id.optional() })
  .strict();
const sequence = z.discriminatedUnion("action", [
  z
    .object({
      op: z.literal("sequence"),
      action: z.literal("addParticipant"),
      tempId: id.optional(),
      kind: z.enum(SEQUENCE_LIFELINE_IDS),
      x: finite,
      y: finite,
      width: positive.optional(),
      height: positive.optional(),
      label: label.optional(),
      style: shapeStyle.optional(),
      textStyle: textStyle.optional(),
      textFit: CanvasTextFitSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("sequence"),
      action: z.literal("removeParticipant"),
      participantId: id,
    })
    .strict(),
  z
    .object({
      op: z.literal("sequence"),
      action: z.literal("addMessage"),
      tempId: id.optional(),
      from: sequenceEndpoint,
      to: sequenceEndpoint,
      y: finite.optional(),
      order: z.number().int().positive().optional(),
      label: z.string().optional(),
      startArrowhead: arrowhead.nullable().optional(),
      endArrowhead: arrowhead.nullable().optional(),
      style: connectorStyle.optional(),
      textStyle: textStyle.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("sequence"),
      action: z.literal("updateMessage"),
      messageId: id,
      label: z.string().optional(),
      textStyle: textStyle.optional(),
    })
    .strict()
    .refine(
      (value) => value.label !== undefined || value.textStyle !== undefined,
      "消息更新不能为空",
    ),
  z
    .object({
      op: z.literal("sequence"),
      action: z.literal("removeMessage"),
      messageId: id,
    })
    .strict(),
  z
    .object({
      op: z.literal("sequence"),
      action: z.literal("addFragment"),
      tempId: id.optional(),
      x: finite,
      y: finite,
      width: positive.optional(),
      height: positive.optional(),
      operator: z.string().optional(),
      style: shapeStyle.optional(),
      textStyle: textStyle.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("sequence"),
      action: z.literal("updateFragment"),
      fragmentId: id,
      operator: z.string().optional(),
      textStyle: textStyle.optional(),
      insertRowAt: z.number().int().positive().optional(),
      deleteRowId: id.optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.operator !== undefined ||
        value.textStyle !== undefined ||
        value.insertRowAt !== undefined ||
        value.deleteRowId !== undefined,
      "片段更新不能为空",
    ),
]);

export const CanvasOpSchema = z.union([
  addShape,
  addText,
  updateShape,
  updateText,
  connect,
  updateConnector,
  deleteOp,
  move,
  resize,
  layoutOp,
  mindmap,
  table,
  sequence,
]);
export type CanvasOp = z.infer<typeof CanvasOpSchema>;

export const CanvasApplyInputSchema = z
  .object({
    ops: z.array(CanvasOpSchema).min(1).max(1000),
    expectedVersions: z
      .record(id, z.number().int().safe().positive())
      .optional(),
    dryRun: z.boolean().optional(),
    idempotencyKey: id.optional(),
  })
  .strict();
export type CanvasApplyInputParsed = z.infer<typeof CanvasApplyInputSchema>;

export const CanvasLayoutInputSchema = z
  .object({
    ids: z.array(id).min(1).max(1000),
    algorithm: z.enum(LAYOUT_ALGORITHM_IDS),
    origin: point.optional(),
    options: layoutOptions.optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();
export type CanvasLayoutInputParsed = z.infer<typeof CanvasLayoutInputSchema>;

export const CanvasValidateChecks = [
  "overlap",
  "overflow",
  "bindings",
  "dangling",
] as const;
export const CanvasValidateInputSchema = z
  .object({
    ids: z.array(id).optional(),
    checks: z.array(z.enum(CanvasValidateChecks)).optional(),
  })
  .strict();

export const CanvasSceneGetInputSchema = z
  .object({
    view: z.enum(["summary", "full"]).optional(),
    ids: z.array(id).optional(),
    region: CanvasBoundsSchema.optional(),
  })
  .strict();
export const CanvasSceneSearchInputSchema = z
  .object({
    query: z.string(),
    types: z.array(id).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();
export const CanvasSceneElementsInputSchema = z.array(id).min(1).max(10000);

export const CanvasTextMeasureInputSchema = z
  .object({
    text: z.string(),
    style: CanvasTextStyleInputSchema.optional(),
  })
  .strict();
export const CanvasTextFitInputSchema = z
  .object({
    text: z.string(),
    style: CanvasTextStyleInputSchema.optional(),
    maxWidth: positive,
    maxHeight: positive.optional(),
  })
  .strict();

export const CanvasExportInputSchema = z
  .object({
    format: z.literal("json").optional(),
    ids: z.array(id).optional(),
    region: CanvasBoundsSchema.optional(),
  })
  .strict();

export const CanvasSchemaTypeSchema = z
  .object({
    type: z.enum(["apply", "layout", "text", "validate", "scene", "export"]),
  })
  .strict();

export const CanvasSceneSchema = z
  .object({
    view: z.enum(["summary", "full"]).optional(),
    ids: z.array(id).optional(),
    region: CanvasBoundsSchema.optional(),
  })
  .strict();
export const CanvasSceneSearchSchema = CanvasSceneSearchInputSchema;

/** 统一把 Zod 校验失败转换为带 issues 的 invalid_input。 */
export const parseInput = <T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CanvasSdkError("invalid_input", "输入参数不合法", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  return parsed.data;
};
