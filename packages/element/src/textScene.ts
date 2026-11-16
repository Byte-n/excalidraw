import {
  DEFAULT_ELEMENT_PROPS,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_VERTICAL_ALIGN,
} from "@excalidraw/common";

import { newTextElement, refreshTextDimensions } from "./newElement";
import {
  CanvasSceneError,
  createCalculationScene,
  deleteSceneElements,
  finishSceneOperation,
} from "./sceneOperations";
import { getTextElementStylePatch } from "./text/elementText";
import { normalizeText } from "./textMeasurements";
import { isTextElement } from "./typeChecks";

import type { Scene } from "./Scene";
import type {
  CanvasElementOperationResult,
  SceneElementTarget,
  SceneTextStyle,
} from "./sceneOperations";
import type { ExcalidrawElement, ExcalidrawTextElement } from "./types";

export type TextOperation =
  | Readonly<{
      action: "create";
      x: number;
      y: number;
      text: string;
      width?: number;
      autoResize?: boolean;
      style?: SceneTextStyle;
      baseFontSize?: number;
    }>
  | Readonly<{
      action: "update";
      target: SceneElementTarget;
      text?: string;
      x?: number;
      y?: number;
      width?: number;
      autoResize?: boolean;
      style?: SceneTextStyle;
    }>
  | Readonly<{ action: "delete"; target: SceneElementTarget }>;

const assertFiniteCoordinate = (value: number, name: string) => {
  if (!Number.isFinite(value)) {
    throw new CanvasSceneError("invalid_input", `${name} 必须是有限数值`);
  }
};

const assertFiniteWidth = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CanvasSceneError("invalid_input", "文本宽度必须是正数");
  }
};

const applyTextStyle = (
  text: ExcalidrawTextElement,
  style: SceneTextStyle | undefined,
  scene: Scene,
) => {
  if (!style) {
    return;
  }
  const patch = {
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
  };
  if (Object.keys(patch).length) {
    scene.mutateElement(text, getTextElementStylePatch(text, patch));
  }
  if (style.color !== undefined) {
    scene.mutateElement(text, {
      strokeColor: style.color ?? DEFAULT_ELEMENT_PROPS.strokeColor,
    });
  }
};

const createText = (
  operation: Extract<TextOperation, { action: "create" }>,
  scene: Scene,
): ExcalidrawTextElement => {
  assertFiniteCoordinate(operation.x, "x");
  assertFiniteCoordinate(operation.y, "y");
  if (typeof operation.text !== "string") {
    throw new CanvasSceneError("invalid_input", "文本内容必须是字符串");
  }
  const autoResize = operation.autoResize ?? true;
  if (!autoResize && operation.width !== undefined) {
    assertFiniteWidth(operation.width);
  }
  const style = operation.style;
  const text = newTextElement({
    x: operation.x,
    y: operation.y,
    text: operation.text,
    autoResize,
    textAlign: "left",
    verticalAlign: "top",
    ...(style?.fontSize != null ? { fontSize: style.fontSize } : {}),
    ...(style?.fontFamily != null ? { fontFamily: style.fontFamily } : {}),
    ...(operation.baseFontSize !== undefined
      ? { baseFontSize: operation.baseFontSize }
      : {}),
  });
  scene.replaceAllElements([...scene.getElementsIncludingDeleted(), text], {
    skipValidation: true,
  });
  applyTextStyle(text, style, scene);

  if (!autoResize && operation.width !== undefined) {
    scene.mutateElement(text, { width: operation.width });
    const dimensions = refreshTextDimensions(
      text,
      scene.getNonDeletedElementsMap(),
    );
    if (dimensions) {
      scene.mutateElement(text, {
        texts: {
          body: { ...text.texts.body, text: dimensions.text },
        },
        width: dimensions.width,
        height: dimensions.height,
        x: operation.x,
        y: operation.y,
      });
    }
  }
  return text;
};

const updateText = (
  operation: Extract<TextOperation, { action: "update" }>,
  scene: Scene,
): ExcalidrawTextElement => {
  const element = scene
    .getNonDeletedElementsMap()
    .get(operation.target.elementId);
  if (!element || !isTextElement(element)) {
    throw new CanvasSceneError("target_not_found", "文字元素不存在");
  }
  applyTextStyle(element, operation.style, scene);

  const autoResize = operation.autoResize ?? element.autoResize;
  if (operation.autoResize !== undefined) {
    scene.mutateElement(element, { autoResize: operation.autoResize });
  }
  if (!autoResize && operation.width !== undefined) {
    assertFiniteWidth(operation.width);
    scene.mutateElement(element, { width: operation.width });
  }
  if (operation.x !== undefined) {
    assertFiniteCoordinate(operation.x, "x");
  }
  if (operation.y !== undefined) {
    assertFiniteCoordinate(operation.y, "y");
  }

  const nextText =
    operation.text === undefined
      ? undefined
      : normalizeText(String(operation.text));
  const dimensions = refreshTextDimensions(
    element,
    scene.getNonDeletedElementsMap(),
    nextText,
  );
  if (!dimensions) {
    return element;
  }
  scene.mutateElement(element, {
    texts: { body: { ...element.texts.body, text: dimensions.text } },
    width: dimensions.width,
    height: dimensions.height,
    x: operation.x ?? dimensions.x,
    y: operation.y ?? dimensions.y,
  });
  return element;
};

export const applyTextOperation = (
  elements: readonly ExcalidrawElement[],
  operation: TextOperation,
): CanvasElementOperationResult => {
  const scene = createCalculationScene(elements);
  try {
    if (operation.action === "create") {
      const text = createText(operation, scene);
      return finishSceneOperation(
        elements,
        scene.getElementsIncludingDeleted(),
        {
          domain: "text",
          action: operation.action,
          elementId: text.id,
        },
      );
    }

    const element = scene
      .getNonDeletedElementsMap()
      .get(operation.target.elementId);
    if (!element || !isTextElement(element)) {
      throw new CanvasSceneError("target_not_found", "文字元素不存在");
    }
    if (operation.action === "delete") {
      deleteSceneElements(new Set([element.id]), scene);
      return finishSceneOperation(
        elements,
        scene.getElementsIncludingDeleted(),
        {
          domain: "text",
          action: operation.action,
          elementId: element.id,
        },
      );
    }

    const text = updateText(operation, scene);
    return finishSceneOperation(
      elements,
      scene.getElementsIncludingDeleted(),
      {
        domain: "text",
        action: operation.action,
        elementId: text.id,
      },
    );
  } finally {
    scene.destroy();
  }
};
