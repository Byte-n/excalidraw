import {
  applyConnectorOperation,
  applyMindmapOperation,
  applySequenceOperation,
  applyShapeOperation,
  applyTableOperation,
  applyTextOperation,
  getSequenceShapeDefaultSize,
  isSequenceLifelineElement,
  isShapeElement,
  isTextElement,
  layoutElements,
} from "@excalidraw/element";

import { SHAPE_IDS } from "@excalidraw/yjs";

import type {
  CanvasElementOperationResult,
  ConnectorOperation,
  MindmapOperation,
  SceneGeometry,
  SceneTextStyle,
  ShapeOperation,
  ShapeStyle,
  ConnectorStyle,
  SequenceOperation,
  ShapeOptions,
  TableOperation,
  TextOperation,
} from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  CanvasSceneCommands,
  ExcalidrawSceneElement,
} from "@excalidraw/yjs";
import type { HocuspocusHeadlessSession } from "@excalidraw/yjs-hocuspocus-client";

import { CanvasSdkError, toCanvasSdkError } from "./errors.js";
import {
  CanvasApplyInputSchema,
  type CanvasApplyInputParsed,
  type CanvasOp,
} from "./schemas.js";
import { correctApplyOps, resolveFontFamily } from "./skeleton.js";

import type {
  CanvasApplyReceipt,
  CanvasBounds,
  CanvasSdk,
  CanvasWarning,
} from "./types.js";

type AnyRecord = Record<string, unknown>;

export type ApplyDeps = {
  session: HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>;
  readScene: () => {
    elements: readonly ExcalidrawSceneElement[];
    assets: Record<string, unknown>;
  };
  commands: CanvasSceneCommands<unknown>;
  generation: number;
  assertActive: (write?: boolean) => void;
};

const DEFAULT_SHAPE_WIDTH = 160;
const DEFAULT_SHAPE_HEIGHT = 80;

const receiptsBySession = new WeakMap<
  object,
  Map<string, CanvasApplyReceipt>
>();

const getReceiptCache = (session: object) => {
  let cache = receiptsBySession.get(session);
  if (!cache) {
    cache = new Map();
    receiptsBySession.set(session, cache);
  }
  return cache;
};

const asElements = (
  elements: readonly ExcalidrawSceneElement[],
): ExcalidrawElement[] => elements as unknown as ExcalidrawElement[];

export const elementBounds = (element: ExcalidrawElement): CanvasBounds => ({
  x: element.x,
  y: element.y,
  width: element.width ?? 0,
  height: element.height ?? 0,
});

export const elementKind = (element: ExcalidrawElement): string | undefined => {
  const shape = (element as { shape?: { id?: unknown } }).shape;
  return shape && typeof shape.id === "string" ? shape.id : undefined;
};

export const elementLabel = (
  element: ExcalidrawElement,
): string | undefined => {
  const texts = (element as { texts?: Record<string, { text?: unknown }> })
    .texts;
  const body = texts?.body?.text;
  if (typeof body === "string" && body.length > 0) {
    return body;
  }
  const label = texts?.label?.text;
  return typeof label === "string" && label.length > 0 ? label : undefined;
};

export const summarizeElement = (element: ExcalidrawElement) => {
  const kind = elementKind(element);
  const label = elementLabel(element);
  const graphId = (element as { graphId?: unknown }).graphId;
  return {
    id: element.id,
    type: element.type,
    ...(kind ? { kind } : {}),
    x: element.x,
    y: element.y,
    width: element.width ?? 0,
    height: element.height ?? 0,
    ...(label ? { label } : {}),
    ...(typeof graphId === "string" ? { graphId } : {}),
    ...(element.isDeleted ? { isDeleted: true } : {}),
  };
};

export const unionBounds = (
  elements: readonly ExcalidrawElement[],
): CanvasBounds => {
  if (!elements.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(
    ...elements.map((element) => element.x + (element.width ?? 0)),
  );
  const maxY = Math.max(
    ...elements.map((element) => element.y + (element.height ?? 0)),
  );
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const mapTextStyle = (input: unknown): SceneTextStyle | undefined => {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const source = input as AnyRecord;
  const result: AnyRecord = {};
  for (const key of [
    "fontSize",
    "fontFamily",
    "color",
    "textAlign",
    "verticalAlign",
  ]) {
    if (!(key in source)) {
      continue;
    }
    const value = source[key];
    result[key] =
      key === "fontFamily" && typeof value === "string"
        ? resolveFontFamily(value)
        : value;
  }
  return result as SceneTextStyle;
};

const isLabelInput = (value: unknown): value is AnyRecord =>
  !!value && typeof value === "object";

const labelText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (isLabelInput(value) && typeof value.text === "string") {
    return value.text;
  }
  return undefined;
};

const labelTextStyle = (value: unknown): SceneTextStyle | undefined => {
  if (!isLabelInput(value)) {
    return undefined;
  }
  return mapTextStyle(value);
};

const mergeTextStyle = (
  base: SceneTextStyle | undefined,
  label: unknown,
): SceneTextStyle | undefined => {
  const extra = labelTextStyle(label);
  if (!base && !extra) {
    return undefined;
  }
  return { ...(base ?? {}), ...(extra ?? {}) } as SceneTextStyle;
};

const textFitOf = (opTextFit: unknown, label: unknown) => {
  if (opTextFit && typeof opTextFit === "object") {
    return opTextFit as {
      mode: "auto" | "fixed";
      minWidth?: number;
      minHeight?: number;
    };
  }
  if (isLabelInput(label) && (label.fit === "auto" || label.fit === "fixed")) {
    return {
      mode: label.fit,
      ...(typeof label.minWidth === "number"
        ? { minWidth: label.minWidth }
        : {}),
      ...(typeof label.minHeight === "number"
        ? { minHeight: label.minHeight }
        : {}),
    } as { mode: "auto" | "fixed"; minWidth?: number; minHeight?: number };
  }
  return undefined;
};

const hasUnknownShapeKind = (ops: readonly unknown[]) =>
  ops.some((op) => {
    if (!op || typeof op !== "object") {
      return false;
    }
    const record = op as AnyRecord;
    return (
      record.op === "addShape" &&
      typeof record.kind === "string" &&
      !(SHAPE_IDS as readonly string[]).includes(record.kind)
    );
  });

const parseApplyInput = (
  input: unknown,
): { parsed: CanvasApplyInputParsed; warnings: CanvasWarning[] } => {
  const rawOps =
    input &&
    typeof input === "object" &&
    Array.isArray((input as AnyRecord).ops)
      ? ((input as AnyRecord).ops as unknown[])
      : undefined;
  const corrections = rawOps
    ? correctApplyOps(rawOps)
    : { ops: [] as unknown[], warnings: [] as CanvasWarning[] };
  const candidate = rawOps
    ? { ...(input as AnyRecord), ops: corrections.ops }
    : input;
  const parsed = CanvasApplyInputSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    // 联合分支错误只暴露 invalid_union 顶层路径，需直接从操作里识别非法 kind。
    const kindIssue = hasUnknownShapeKind(corrections.ops);
    throw new CanvasSdkError("invalid_input", "操作参数不合法", {
      issues,
      ...(kindIssue ? { legalValues: [...SHAPE_IDS] } : {}),
    });
  }
  for (const [index, op] of parsed.data.ops.entries()) {
    if (
      op.op === "addShape" &&
      !(SHAPE_IDS as readonly string[]).includes(op.kind)
    ) {
      throw new CanvasSdkError("invalid_input", `未知图形类型: ${op.kind}`, {
        path: `ops[${index}].kind`,
        legalValues: [...SHAPE_IDS],
      });
    }
  }
  return { parsed: parsed.data, warnings: corrections.warnings };
};

type ApplyState = {
  working: ExcalidrawElement[];
  tempIds: Map<string, string>;
  changed: Set<string>;
  created: Set<string>;
  deleted: Set<string>;
  references: AnyRecord[];
};

const resolveId = (state: ApplyState, value: string) =>
  state.tempIds.get(value) ?? value;

const resolveEndpoint = (
  state: ApplyState,
  endpoint: string | { point: { x: number; y: number } },
) =>
  typeof endpoint === "string"
    ? { elementId: resolveId(state, endpoint) }
    : { point: endpoint.point };

const requireElement = (state: ApplyState, value: string) => {
  const id = resolveId(state, value);
  const element = state.working.find((entry) => entry.id === id);
  if (!element || element.isDeleted) {
    throw new CanvasSdkError("target_not_found", `元素不存在: ${value}`);
  }
  return element;
};

const mergeOperationResult = (
  state: ApplyState,
  result: CanvasElementOperationResult,
) => {
  state.working = [...result.elements];
  result.changedElementIds.forEach((id) => state.changed.add(id));
  result.createdElementIds.forEach((id) => state.created.add(id));
  result.deletedElementIds.forEach((id) => state.deleted.add(id));
  state.references.push(result.references as unknown as AnyRecord);
};

const registerCreated = (
  state: ApplyState,
  result: CanvasElementOperationResult,
  tempId?: string,
) => {
  const referenceId =
    "elementId" in result.references ? result.references.elementId : undefined;
  const createdId =
    referenceId && result.createdElementIds.includes(referenceId)
      ? referenceId
      : result.createdElementIds[0];
  if (!createdId) {
    throw new CanvasSdkError("internal_error", "操作未返回新元素");
  }
  if (tempId) {
    state.tempIds.set(tempId, createdId);
  }
  return createdId;
};

const runShapeOperation = (state: ApplyState, operation: ShapeOperation) => {
  const result = applyShapeOperation(state.working, operation);
  mergeOperationResult(state, result);
  return result;
};

const runTextOperation = (state: ApplyState, operation: TextOperation) => {
  const result = applyTextOperation(state.working, operation);
  mergeOperationResult(state, result);
  return result;
};

const runConnectorOperation = (
  state: ApplyState,
  operation: ConnectorOperation,
) => {
  const result = applyConnectorOperation(state.working, operation);
  mergeOperationResult(state, result);
  return result;
};

const runMindmapOperation = (
  state: ApplyState,
  operation: MindmapOperation,
) => {
  const result = applyMindmapOperation(state.working, operation);
  mergeOperationResult(state, result);
  return result;
};

const runTableOperation = (state: ApplyState, operation: TableOperation) => {
  const result = applyTableOperation(state.working, operation);
  mergeOperationResult(state, result);
  return result;
};

const runSequenceOperation = (
  state: ApplyState,
  operation: SequenceOperation,
) => {
  const result = applySequenceOperation(state.working, operation);
  mergeOperationResult(state, result);
  return result;
};

const graphIdOf = (state: ApplyState, nodeId: string) => {
  const element = state.working.find(
    (entry) =>
      entry.id === resolveId(state, nodeId) &&
      !entry.isDeleted &&
      entry.type === "mindmap-node",
  );
  if (!element) {
    throw new CanvasSdkError("target_not_found", `脑图节点不存在: ${nodeId}`);
  }
  const graphId = (element as { graphId?: unknown }).graphId;
  if (typeof graphId !== "string") {
    throw new CanvasSdkError("invalid_operation", "脑图节点缺少 graphId");
  }
  return graphId;
};

const runOp = (rawOp: CanvasOp, state: ApplyState) => {
  switch (rawOp.op) {
    case "addShape": {
      const label = rawOp.label;
      const text = labelText(label);
      const textStyle = mergeTextStyle(mapTextStyle(rawOp.textStyle), label);
      const textFit = textFitOf(rawOp.textFit, label);
      const defaultSize = getSequenceShapeDefaultSize(rawOp.kind);
      const geometry = {
        x: rawOp.x,
        y: rawOp.y,
        width: rawOp.width ?? defaultSize?.width ?? DEFAULT_SHAPE_WIDTH,
        height: rawOp.height ?? defaultSize?.height ?? DEFAULT_SHAPE_HEIGHT,
        ...(rawOp.angle !== undefined ? { angle: rawOp.angle } : {}),
      };
      const result = runShapeOperation(state, {
        action: "create",
        kind: rawOp.kind,
        geometry,
        ...(text !== undefined ? { text } : {}),
        ...(rawOp.style ? { style: rawOp.style as ShapeStyle } : {}),
        ...(textStyle ? { textStyle } : {}),
        ...(rawOp.shapeOptions
          ? { shapeOptions: rawOp.shapeOptions as ShapeOptions }
          : {}),
        ...(textFit ? { textFit } : {}),
      } as ShapeOperation);
      registerCreated(state, result, rawOp.tempId);
      return;
    }
    case "addText": {
      const result = runTextOperation(state, {
        action: "create",
        x: rawOp.x,
        y: rawOp.y,
        text: rawOp.text,
        ...(rawOp.width !== undefined ? { width: rawOp.width } : {}),
        ...(rawOp.autoResize !== undefined
          ? { autoResize: rawOp.autoResize }
          : {}),
        ...(rawOp.style
          ? { style: mapTextStyle(rawOp.style) as SceneTextStyle }
          : {}),
      });
      registerCreated(state, result, rawOp.tempId);
      return;
    }
    case "updateShape": {
      const id = resolveId(state, rawOp.id);
      const label = rawOp.label;
      const text = label === null ? "" : labelText(label);
      const textStyle = mergeTextStyle(mapTextStyle(rawOp.textStyle), label);
      const textFit = textFitOf(rawOp.textFit, label);
      runShapeOperation(state, {
        action: "update",
        target: { elementId: id },
        ...(rawOp.geometry
          ? { geometry: rawOp.geometry as Partial<SceneGeometry> }
          : {}),
        ...(text !== undefined ? { text } : {}),
        ...(rawOp.style ? { style: rawOp.style as ShapeStyle } : {}),
        ...(textStyle ? { textStyle } : {}),
        ...(rawOp.shapeOptions
          ? { shapeOptions: rawOp.shapeOptions as ShapeOptions }
          : {}),
        ...(textFit ? { textFit } : {}),
      });
      return;
    }
    case "updateText": {
      runTextOperation(state, {
        action: "update",
        target: { elementId: resolveId(state, rawOp.id) },
        ...(rawOp.text !== undefined ? { text: rawOp.text } : {}),
        ...(rawOp.x !== undefined ? { x: rawOp.x } : {}),
        ...(rawOp.y !== undefined ? { y: rawOp.y } : {}),
        ...(rawOp.width !== undefined ? { width: rawOp.width } : {}),
        ...(rawOp.autoResize !== undefined
          ? { autoResize: rawOp.autoResize }
          : {}),
        ...(rawOp.style
          ? { style: mapTextStyle(rawOp.style) as SceneTextStyle }
          : {}),
      });
      return;
    }
    case "connect": {
      const textStyle = mapTextStyle(rawOp.textStyle);
      const result = runConnectorOperation(state, {
        action: "create",
        kind: rawOp.kind ?? "arrow",
        start: resolveEndpoint(state, rawOp.from),
        end: resolveEndpoint(state, rawOp.to),
        ...(rawOp.routing ? { routing: rawOp.routing } : {}),
        ...(rawOp.label !== undefined ? { label: rawOp.label } : {}),
        ...(rawOp.startArrowhead !== undefined
          ? { startArrowhead: rawOp.startArrowhead as never }
          : {}),
        ...(rawOp.endArrowhead !== undefined
          ? { endArrowhead: rawOp.endArrowhead as never }
          : {}),
        ...(rawOp.style ? { style: rawOp.style as ConnectorStyle } : {}),
        ...(textStyle ? { textStyle } : {}),
      });
      registerCreated(state, result, rawOp.tempId);
      return;
    }
    case "updateConnector": {
      const textStyle = mapTextStyle(rawOp.textStyle);
      runConnectorOperation(state, {
        action: "update",
        target: { elementId: resolveId(state, rawOp.id) },
        ...(rawOp.routing ? { routing: rawOp.routing } : {}),
        ...(rawOp.label !== undefined ? { label: rawOp.label } : {}),
        ...(rawOp.startArrowhead !== undefined
          ? { startArrowhead: rawOp.startArrowhead as never }
          : {}),
        ...(rawOp.endArrowhead !== undefined
          ? { endArrowhead: rawOp.endArrowhead as never }
          : {}),
        ...(rawOp.style ? { style: rawOp.style as ConnectorStyle } : {}),
        ...(textStyle ? { textStyle } : {}),
      });
      return;
    }
    case "delete": {
      const element = requireElement(state, rawOp.id);
      const id = element.id;
      if (isSequenceLifelineElement(element)) {
        runSequenceOperation(state, {
          action: "removeParticipant",
          target: { elementId: id },
        });
        return;
      }
      if (isShapeElement(element)) {
        runShapeOperation(state, {
          action: "delete",
          target: { elementId: id },
        });
        return;
      }
      if (isTextElement(element)) {
        runTextOperation(state, {
          action: "delete",
          target: { elementId: id },
        });
        return;
      }
      if (element.type === "arrow" || element.type === "line") {
        runConnectorOperation(state, {
          action: "delete",
          target: { elementId: id },
        });
        return;
      }
      if (element.type === "table") {
        runTableOperation(state, {
          action: "delete",
          target: { tableId: id },
        });
        return;
      }
      if (element.type === "mindmap-node") {
        const graphId = (element as { graphId?: unknown }).graphId;
        if (typeof graphId !== "string") {
          throw new CanvasSdkError("invalid_operation", "脑图节点缺少 graphId");
        }
        runMindmapOperation(state, {
          action: "deleteSubtree",
          target: { graphId, nodeId: id },
        });
        return;
      }
      throw new CanvasSdkError(
        "invalid_operation",
        `不支持删除的元素类型: ${element.type}`,
      );
    }
    case "move": {
      const element = requireElement(state, rawOp.id);
      if (isShapeElement(element)) {
        runShapeOperation(state, {
          action: "update",
          target: { elementId: element.id },
          geometry: {
            ...(rawOp.x !== undefined ? { x: rawOp.x } : {}),
            ...(rawOp.y !== undefined ? { y: rawOp.y } : {}),
          },
        });
        return;
      }
      if (isTextElement(element)) {
        runTextOperation(state, {
          action: "update",
          target: { elementId: element.id },
          ...(rawOp.x !== undefined ? { x: rawOp.x } : {}),
          ...(rawOp.y !== undefined ? { y: rawOp.y } : {}),
        });
        return;
      }
      throw new CanvasSdkError(
        "invalid_operation",
        `不支持移动的元素类型: ${element.type}`,
      );
    }
    case "resize": {
      const element = requireElement(state, rawOp.id);
      if (!isShapeElement(element)) {
        throw new CanvasSdkError(
          "invalid_operation",
          `不支持调整尺寸的元素类型: ${element.type}`,
        );
      }
      runShapeOperation(state, {
        action: "update",
        target: { elementId: element.id },
        geometry: {
          ...(rawOp.width !== undefined ? { width: rawOp.width } : {}),
          ...(rawOp.height !== undefined ? { height: rawOp.height } : {}),
          ...(rawOp.x !== undefined ? { x: rawOp.x } : {}),
          ...(rawOp.y !== undefined ? { y: rawOp.y } : {}),
        },
      });
      return;
    }
    case "layout": {
      const ids = rawOp.ids
        ? rawOp.ids.map((entry) => resolveId(state, entry))
        : [...state.created].filter((entry) => {
            const element = state.working.find((item) => item.id === entry);
            return (
              element && element.type !== "arrow" && element.type !== "line"
            );
          });
      if (!ids.length) {
        throw new CanvasSdkError("invalid_input", "layout 需要至少一个元素 id");
      }
      const result = layoutElements(state.working, {
        ids,
        algorithm: rawOp.algorithm,
        ...(rawOp.origin ? { origin: rawOp.origin } : {}),
        ...(rawOp.options ? { options: rawOp.options } : {}),
      });
      state.working = [...result.elements];
      result.affectedElementIds.forEach((id) => state.changed.add(id));
      state.references.push({
        domain: "layout",
        action: "apply",
        algorithm: rawOp.algorithm,
      });
      return;
    }
    case "sequence": {
      switch (rawOp.action) {
        case "addParticipant": {
          const label = rawOp.label;
          const text = labelText(label);
          const textStyle = mergeTextStyle(
            mapTextStyle(rawOp.textStyle),
            label,
          );
          const textFit = textFitOf(rawOp.textFit, label);
          const result = runSequenceOperation(state, {
            action: "addParticipant",
            kind: rawOp.kind,
            position: { x: rawOp.x, y: rawOp.y },
            ...(rawOp.width !== undefined ? { width: rawOp.width } : {}),
            ...(rawOp.height !== undefined ? { height: rawOp.height } : {}),
            ...(text !== undefined ? { text } : {}),
            ...(rawOp.style ? { style: rawOp.style as ShapeStyle } : {}),
            ...(textStyle ? { textStyle } : {}),
            ...(textFit ? { textFit } : {}),
          });
          registerCreated(state, result, rawOp.tempId);
          return;
        }
        case "removeParticipant":
          runSequenceOperation(state, {
            action: "removeParticipant",
            target: { elementId: resolveId(state, rawOp.participantId) },
          });
          return;
        case "addMessage": {
          const textStyle = mapTextStyle(rawOp.textStyle);
          const result = runSequenceOperation(state, {
            action: "addMessage",
            from: {
              participantId: resolveId(state, rawOp.from.participantId),
              ...(rawOp.from.activationId
                ? {
                    activationId: resolveId(state, rawOp.from.activationId),
                  }
                : {}),
            },
            to: {
              participantId: resolveId(state, rawOp.to.participantId),
              ...(rawOp.to.activationId
                ? { activationId: resolveId(state, rawOp.to.activationId) }
                : {}),
            },
            ...(rawOp.y !== undefined ? { y: rawOp.y } : {}),
            ...(rawOp.order !== undefined ? { order: rawOp.order } : {}),
            ...(rawOp.label !== undefined ? { text: rawOp.label } : {}),
            ...(rawOp.startArrowhead !== undefined
              ? { startArrowhead: rawOp.startArrowhead as never }
              : {}),
            ...(rawOp.endArrowhead !== undefined
              ? { endArrowhead: rawOp.endArrowhead as never }
              : {}),
            ...(rawOp.style ? { style: rawOp.style as ConnectorStyle } : {}),
            ...(textStyle ? { textStyle } : {}),
          });
          registerCreated(state, result, rawOp.tempId);
          return;
        }
        case "updateMessage": {
          const textStyle = mapTextStyle(rawOp.textStyle);
          runSequenceOperation(state, {
            action: "updateMessage",
            target: { elementId: resolveId(state, rawOp.messageId) },
            ...(rawOp.label !== undefined ? { text: rawOp.label } : {}),
            ...(textStyle ? { textStyle } : {}),
          });
          return;
        }
        case "removeMessage":
          runSequenceOperation(state, {
            action: "removeMessage",
            target: { elementId: resolveId(state, rawOp.messageId) },
          });
          return;
        case "addFragment": {
          const textStyle = mapTextStyle(rawOp.textStyle);
          const result = runSequenceOperation(state, {
            action: "addFragment",
            position: { x: rawOp.x, y: rawOp.y },
            ...(rawOp.width !== undefined ? { width: rawOp.width } : {}),
            ...(rawOp.height !== undefined ? { height: rawOp.height } : {}),
            ...(rawOp.operator !== undefined
              ? { operator: rawOp.operator }
              : {}),
            ...(rawOp.style ? { style: rawOp.style as ShapeStyle } : {}),
            ...(textStyle ? { textStyle } : {}),
          });
          registerCreated(state, result, rawOp.tempId);
          return;
        }
        case "updateFragment": {
          const textStyle = mapTextStyle(rawOp.textStyle);
          runSequenceOperation(state, {
            action: "updateFragment",
            target: { elementId: resolveId(state, rawOp.fragmentId) },
            ...(rawOp.operator !== undefined
              ? { operator: rawOp.operator }
              : {}),
            ...(textStyle ? { textStyle } : {}),
            ...(rawOp.insertRowAt !== undefined
              ? { insertRowAt: rawOp.insertRowAt }
              : {}),
            ...(rawOp.deleteRowId !== undefined
              ? { deleteRowId: rawOp.deleteRowId }
              : {}),
          });
          return;
        }
      }
      return;
    }
    case "mindmap": {
      if (rawOp.action === "createRoot") {
        const result = runMindmapOperation(state, {
          action: "createRoot",
          position: { x: rawOp.x, y: rawOp.y },
          text: rawOp.text,
        });
        registerCreated(state, result, rawOp.tempId);
        return;
      }
      const nodeId = resolveId(state, rawOp.nodeId);
      const graphId = rawOp.graphId ?? graphIdOf(state, rawOp.nodeId);
      if (rawOp.action === "reparent") {
        runMindmapOperation(state, {
          action: "reparent",
          target: { graphId, nodeId },
          parentNodeId: resolveId(state, rawOp.parentNodeId),
          ...(rawOp.beforeNodeId
            ? { beforeNodeId: resolveId(state, rawOp.beforeNodeId) }
            : {}),
        });
        return;
      }
      if (rawOp.action === "deleteSubtree") {
        runMindmapOperation(state, {
          action: "deleteSubtree",
          target: { graphId, nodeId },
        });
        return;
      }
      const result = runMindmapOperation(state, {
        action: rawOp.action,
        target: { graphId, nodeId },
        text: rawOp.text,
      });
      if (rawOp.action === "addChild" || rawOp.action === "addSibling") {
        registerCreated(state, result, rawOp.tempId);
      }
      return;
    }
    case "table": {
      if (rawOp.action === "create") {
        const result = runTableOperation(state, {
          action: "create",
          position: rawOp.position,
          rowCount: rawOp.rowCount,
          columnCount: rawOp.columnCount,
          ...(rawOp.name !== undefined ? { name: rawOp.name } : {}),
          ...(rawOp.style ? { style: rawOp.style as never } : {}),
        });
        if (rawOp.tempId) {
          registerCreated(state, result, rawOp.tempId);
        }
        return;
      }
      const tableId = resolveId(state, rawOp.tableId);
      switch (rawOp.action) {
        case "delete":
          runTableOperation(state, { action: "delete", target: { tableId } });
          return;
        case "setCellText":
          runTableOperation(state, {
            action: "setCellText",
            target: { tableId },
            cellId: rawOp.cellId,
            text: rawOp.text,
          });
          return;
        case "insertRow":
        case "insertColumn":
          runTableOperation(state, {
            action: rawOp.action,
            target: { tableId },
            at: rawOp.at,
          });
          return;
        case "deleteRow":
          runTableOperation(state, {
            action: "deleteRow",
            target: { tableId },
            rowId: rawOp.rowId,
          });
          return;
        case "deleteColumn":
          runTableOperation(state, {
            action: "deleteColumn",
            target: { tableId },
            columnId: rawOp.columnId,
          });
          return;
        case "mergeCells":
          runTableOperation(state, {
            action: "mergeCells",
            target: { tableId },
            firstCellId: rawOp.firstCellId,
            lastCellId: rawOp.lastCellId,
          });
          return;
        case "splitCell":
          runTableOperation(state, {
            action: "splitCell",
            target: { tableId },
            cellId: rawOp.cellId,
          });
          return;
        case "setCellStyle":
          runTableOperation(state, {
            action: "setCellStyle",
            target: { tableId },
            cellId: rawOp.cellId,
            style: rawOp.style as never,
          });
          return;
        case "setName":
          runTableOperation(state, {
            action: "setName",
            target: { tableId },
            name: rawOp.name,
          });
          return;
        case "setStyle":
          runTableOperation(state, {
            action: "setStyle",
            target: { tableId },
            style: rawOp.style as never,
          });
      }
    }
  }
};

const buildReceipt = ({
  state,
  elements,
  changed,
  created,
  deleted,
  warnings,
}: {
  state: ApplyState;
  elements: readonly ExcalidrawElement[];
  changed: ReadonlySet<string>;
  created: ReadonlySet<string>;
  deleted: ReadonlySet<string>;
  warnings: CanvasWarning[];
}): CanvasApplyReceipt => {
  const tempIdById = new Map(
    [...state.tempIds.entries()].map(([tempId, id]) => [id, tempId]),
  );
  const reported = new Set([...changed, ...created]);
  const visible = elements.filter(
    (element) => reported.has(element.id) && !element.isDeleted,
  );
  return {
    elements: visible.map((element) => {
      const kind = elementKind(element);
      const label = elementLabel(element);
      const tempId = tempIdById.get(element.id);
      return {
        id: element.id,
        ...(tempId ? { tempId } : {}),
        type: element.type,
        ...(kind ? { kind } : {}),
        bounds: elementBounds(element),
        ...(label ? { label } : {}),
      };
    }),
    bounds: unionBounds(visible),
    warnings,
    changedElementIds: [...changed],
    createdElementIds: [...created],
    deletedElementIds: [...deleted],
    tempIds: Object.fromEntries(state.tempIds),
    references: state.references,
  };
};

export const createApplyApi = (deps: ApplyDeps): CanvasSdk["apply"] => {
  return async (input) => {
    deps.assertActive(true);
    const { parsed, warnings } = parseApplyInput(input);
    const cache = parsed.idempotencyKey
      ? getReceiptCache(deps.session)
      : undefined;
    if (cache && parsed.idempotencyKey) {
      const cached = cache.get(parsed.idempotencyKey);
      if (cached) {
        return structuredClone(cached);
      }
    }
    try {
      const scene = deps.readScene();
      const state: ApplyState = {
        working: asElements(scene.elements),
        tempIds: new Map(),
        changed: new Set(),
        created: new Set(),
        deleted: new Set(),
        references: [],
      };
      for (const op of parsed.ops) {
        runOp(op, state);
      }
      let elements: readonly ExcalidrawElement[] = state.working;
      let changed = state.changed;
      let created = state.created;
      let deleted = state.deleted;
      if (!parsed.dryRun) {
        const receipt = deps.commands.commit({
          elements: state.working as unknown as ExcalidrawSceneElement[],
          ...(parsed.expectedVersions
            ? { expectedVersions: parsed.expectedVersions }
            : {}),
          generation: deps.generation,
        });
        elements = asElements(receipt.elements);
        changed = new Set(receipt.changedElementIds);
        created = new Set(receipt.createdElementIds);
        deleted = new Set(receipt.deletedElementIds);
      }
      const receipt = buildReceipt({
        state,
        elements,
        changed,
        created,
        deleted,
        warnings,
      });
      if (cache && parsed.idempotencyKey) {
        cache.set(parsed.idempotencyKey, structuredClone(receipt));
      }
      return receipt;
    } catch (error) {
      throw toCanvasSdkError(error);
    }
  };
};
