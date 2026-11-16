import {
  DEFAULT_ELEMENT_PROPS,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_VERTICAL_ALIGN,
  ROUNDNESS,
  getLineHeight,
  invariant,
} from "@excalidraw/common";

import { Scene } from "./Scene";
import { applyTextRegionChange } from "./text/applyEdit";
import { getTextElementStylePatch } from "./text/elementText";
import { DEFAULT_BOUND_TEXT_LABEL_POSITION } from "./text/labelLayout";
import { getTextBlock } from "./text/ops";
import { isLinearElement } from "./typeChecks";

import type { TextBlockStyle } from "./text/types";
import type {
  ExcalidrawElement,
  ExcalidrawShapeElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  FillStyle,
  FontFamilyValues,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from "./types";

export type ScenePoint = Readonly<{ x: number; y: number }>;
export type SceneGeometry = ScenePoint &
  Readonly<{ width: number; height: number; angle?: number }>;
export type SceneElementTarget = Readonly<{ elementId: string }>;
export type NullableStyle<T> = { readonly [K in keyof T]?: T[K] | null };
export type ConnectorStyle = NullableStyle<{
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
}>;
export type ShapeStyle = ConnectorStyle &
  NullableStyle<{
    backgroundColor: string;
    fillStyle: FillStyle;
    roundness: "round" | "sharp";
  }>;
export type SceneTextStyle = NullableStyle<{
  fontSize: number;
  fontFamily: FontFamilyValues;
  color: string;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
}>;
export type TextStyle = SceneTextStyle;

export type CanvasElementOperationReferences =
  | {
      domain: "shape";
      action: "create" | "update" | "delete";
      elementId: string;
    }
  | {
      domain: "connector";
      action: "create" | "update" | "reconnect" | "delete";
      elementId: string;
    }
  | {
      domain: "mindmap";
      action:
        | "createRoot"
        | "addChild"
        | "addSibling"
        | "rename"
        | "move"
        | "reparent"
        | "deleteSubtree";
      graphId: string;
      nodeId: string;
      rootNodeId: string | null;
    }
  | {
      domain: "table";
      action:
        | "create"
        | "delete"
        | "setCellText"
        | "insertRow"
        | "deleteRow"
        | "insertColumn"
        | "deleteColumn"
        | "mergeCells"
        | "splitCell"
        | "setCellStyle"
        | "setName"
        | "setStyle";
      tableId: string;
      cellId?: string;
      anchorCellId?: string;
      rowId?: string;
      columnId?: string;
      rows?: readonly { rowId: string; index: number }[];
      columns?: readonly { columnId: string; index: number }[];
      cells?: readonly {
        cellId: string;
        rowId: string;
        columnId: string;
      }[];
    }
  | {
      domain: "sequence";
      action:
        | "addParticipant"
        | "removeParticipant"
        | "addMessage"
        | "updateMessage"
        | "removeMessage"
        | "addFragment"
        | "updateFragment";
      elementId: string;
    }
  | {
      domain: "text";
      action: "create" | "update" | "delete";
      elementId: string;
    };
export type CanvasElementOperationResult = Readonly<{
  elements: readonly ExcalidrawElement[];
  changedElementIds: readonly string[];
  createdElementIds: readonly string[];
  deletedElementIds: readonly string[];
  references: CanvasElementOperationReferences;
}>;

export type CanvasSceneErrorCode =
  | "invalid_input"
  | "target_not_found"
  | "version_conflict"
  | "invalid_operation"
  | "invalid_scene"
  | "invalid_asset"
  | "scene_limit_exceeded"
  | "not_editable"
  | "session_unavailable"
  | "internal_error";

export class CanvasSceneError extends Error {
  readonly code: CanvasSceneErrorCode;

  constructor(code: CanvasSceneErrorCode, message: string) {
    super(message);
    this.name = "CanvasSceneError";
    this.code = code;
  }
}

// 复用真实 Scene 的几何计算，但不生成版本、时间或 fractional index。
export const createCalculationScene = (
  elements: readonly ExcalidrawElement[],
) =>
  new Scene(structuredClone(elements), {
    skipValidation: true,
    calculationOnly: true,
  });

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => {
      const entry = rightEntries.find(([otherKey]) => otherKey === key);
      return !!entry && sameValue(value, entry[1]);
    })
  );
};

export const finishSceneOperation = (
  input: readonly ExcalidrawElement[],
  elements: readonly ExcalidrawElement[],
  references: CanvasElementOperationReferences,
): CanvasElementOperationResult => {
  const previous = new Map(input.map((element) => [element.id, element]));
  const changedElementIds: string[] = [];
  const createdElementIds: string[] = [];
  const deletedElementIds: string[] = [];
  const candidate = elements.map((element) => {
    const old = previous.get(element.id);
    if (old) {
      invariant(
        element.version === old.version &&
          element.versionNonce === old.versionNonce &&
          element.updated === old.updated &&
          element.created === old.created &&
          element.index === old.index,
        "纯场景操作不得改变既有版本或身份元数据",
      );
    }
    if (old && sameValue(old, element)) {
      return old;
    }
    changedElementIds.push(element.id);
    if (!old) {
      createdElementIds.push(element.id);
    }
    if (element.isDeleted && !old?.isDeleted) {
      deletedElementIds.push(element.id);
    }
    return element;
  });
  const candidateIds = new Set(candidate.map((element) => element.id));
  invariant(
    input.every((element) => candidateIds.has(element.id)),
    "完整候选必须保留所有既有元素及墓碑",
  );
  return {
    elements: candidate,
    changedElementIds,
    createdElementIds,
    deletedElementIds,
    references,
  };
};

export const applySceneElementStyle = (
  element: ExcalidrawElement,
  style: ShapeStyle | ConnectorStyle | undefined,
  scene: Scene,
) => {
  if (!style) {
    return;
  }
  const { roundness, ...leaves } = style as ShapeStyle;
  const updates = Object.fromEntries(
    Object.entries(leaves).map(([key, value]) => [
      key,
      value === null
        ? DEFAULT_ELEMENT_PROPS[key as keyof typeof DEFAULT_ELEMENT_PROPS]
        : value,
    ]),
  );
  scene.mutateElement(element, {
    ...updates,
    ...(roundness !== undefined && {
      roundness:
        roundness === "round" ? { type: ROUNDNESS.PROPORTIONAL_RADIUS } : null,
    }),
  });
};

export const applySceneTextStyle = (
  text: ExcalidrawTextElement,
  style: SceneTextStyle | undefined,
  scene: Scene,
) => {
  if (!style) {
    return;
  }
  scene.mutateElement(
    text,
    getTextElementStylePatch(text, {
      ...(style.fontSize !== undefined && {
        fontSize: style.fontSize ?? DEFAULT_FONT_SIZE,
      }),
      ...(style.fontFamily !== undefined && {
        fontFamily: style.fontFamily ?? DEFAULT_FONT_FAMILY,
      }),
      ...(style.textAlign !== undefined && {
        textAlign: style.textAlign ?? DEFAULT_TEXT_ALIGN,
      }),
      ...(style.verticalAlign !== undefined && {
        verticalAlign: style.verticalAlign ?? DEFAULT_VERTICAL_ALIGN,
      }),
    }),
  );
  if (style.color !== undefined) {
    scene.mutateElement(text, {
      strokeColor: style.color ?? DEFAULT_ELEMENT_PROPS.strokeColor,
    });
  }
};

/** 图形正文没有既有 block 时的样式：居中、默认字体与字号。 */
const DEFAULT_SHAPE_TEXT_STYLE: TextBlockStyle = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
  textAlign: "center",
  verticalAlign: "middle",
};

/** 文本样式补丁合并进区域样式；fontFamily 变化同步派生行高。 */
const mergeShapeTextStyle = (
  style: TextBlockStyle,
  patch: SceneTextStyle,
): TextBlockStyle => {
  const fontFamily =
    patch.fontFamily === undefined
      ? style.fontFamily
      : patch.fontFamily ?? DEFAULT_FONT_FAMILY;
  return {
    ...style,
    ...(patch.fontSize !== undefined && {
      fontSize: patch.fontSize ?? DEFAULT_FONT_SIZE,
    }),
    ...(patch.fontFamily !== undefined && {
      fontFamily,
      lineHeight: getLineHeight(fontFamily),
    }),
    ...(patch.color !== undefined && {
      color: patch.color ?? DEFAULT_ELEMENT_PROPS.strokeColor,
    }),
    ...(patch.textAlign !== undefined && {
      textAlign: patch.textAlign ?? DEFAULT_TEXT_ALIGN,
    }),
    ...(patch.verticalAlign !== undefined && {
      verticalAlign: patch.verticalAlign ?? DEFAULT_VERTICAL_ALIGN,
    }),
  };
};

const updateShapeLabel = (
  container: ExcalidrawShapeElement,
  value: string | undefined,
  style: SceneTextStyle | undefined,
  scene: Scene,
) => {
  const block = getTextBlock(container.texts, "body");

  if (value === "") {
    if (style) {
      throw new CanvasSceneError("invalid_input", "文字样式需要非空标签");
    }
    if (block) {
      applyTextRegionChange(scene, container.id, "body", { text: "" });
    }
    return;
  }

  if (value === undefined && !block) {
    if (style) {
      throw new CanvasSceneError("invalid_input", "文字样式需要非空标签");
    }
    return;
  }

  const baseStyle = block?.style ?? DEFAULT_SHAPE_TEXT_STYLE;
  applyTextRegionChange(scene, container.id, "body", {
    text: value ?? block?.text ?? "",
    style: style ? mergeShapeTextStyle(baseStyle, style) : baseStyle,
  });
};

/** 线性元素标签：写入 `texts.label`，位置沿用既有 placement 或默认值。 */
const updateLinearLabel = (
  container: ExcalidrawLinearElement,
  value: string | undefined,
  style: SceneTextStyle | undefined,
  scene: Scene,
) => {
  const block = getTextBlock(container.texts, "label");

  if (value === "") {
    if (style) {
      throw new CanvasSceneError("invalid_input", "文字样式需要非空标签");
    }
    if (block) {
      applyTextRegionChange(scene, container.id, "label", { text: "" });
    }
    return;
  }

  if (value === undefined && !block) {
    if (style) {
      throw new CanvasSceneError("invalid_input", "文字样式需要非空标签");
    }
    return;
  }

  const baseStyle = block?.style ?? DEFAULT_SHAPE_TEXT_STYLE;
  applyTextRegionChange(scene, container.id, "label", {
    text: value ?? block?.text ?? "",
    style: style ? mergeShapeTextStyle(baseStyle, style) : baseStyle,
    placement: block?.placement ?? {
      labelPosition: DEFAULT_BOUND_TEXT_LABEL_POSITION,
    },
  });
};

export const updateSceneLabel = (
  container: ExcalidrawShapeElement | ExcalidrawLinearElement,
  value: string | undefined,
  style: SceneTextStyle | undefined,
  scene: Scene,
) => {
  if (isLinearElement(container)) {
    updateLinearLabel(container, value, style, scene);
    return;
  }
  updateShapeLabel(container, value, style, scene);
};

// 删除目标及其引用：连线绑定与 boundElements 一并清理。
export const deleteSceneElements = (ids: ReadonlySet<string>, scene: Scene) => {
  const elements = scene.getElementsIncludingDeleted();
  const deleted = new Set(ids);
  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }
    if (deleted.has(element.id)) {
      scene.mutateElement(element, { isDeleted: true, boundElements: [] });
    }
    const boundElements = element.boundElements?.filter(
      (ref) => !deleted.has(ref.id),
    );
    if (
      boundElements &&
      boundElements.length !== element.boundElements?.length
    ) {
      scene.mutateElement(element, { boundElements });
    }
    if (isLinearElement(element)) {
      scene.mutateElement(element, {
        ...(element.startBinding &&
          (deleted.has(element.id) ||
            deleted.has(element.startBinding.elementId)) && {
            startBinding: null,
          }),
        ...(element.endBinding &&
          (deleted.has(element.id) ||
            deleted.has(element.endBinding.elementId)) && { endBinding: null }),
      });
    }
  }
};
