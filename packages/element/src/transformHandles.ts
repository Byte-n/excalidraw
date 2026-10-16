import {
  DEFAULT_TRANSFORM_HANDLE_SPACING,
  type EditorInterface,
} from "@excalidraw/common";

import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { Radians } from "@excalidraw/math";

import type {
  InteractiveCanvasAppState,
  Zoom,
} from "@excalidraw/excalidraw/types";
import type { Bounds } from "@excalidraw/common";

import { getElementAbsoluteCoords } from "./bounds";
import {
  isFrameLikeElement,
  isImageElement,
  isLinearElement,
} from "./typeChecks";

import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  PointerType,
} from "./types";

export type TransformHandleDirection =
  | "n"
  | "s"
  | "w"
  | "e"
  | "nw"
  | "ne"
  | "sw"
  | "se";

export type TransformHandleType = TransformHandleDirection | "rotation";

export type TransformHandle = Bounds;
export type TransformHandles = Partial<{
  [T in TransformHandleType]: TransformHandle;
}>;
export type MaybeTransformHandleType = TransformHandleType | false;

const transformHandleSizes: { [k in PointerType]: number } = {
  mouse: 9,
  pen: 16,
  touch: 28,
};

const ROTATION_RESIZE_HANDLE_GAP = 16;
const ROTATION_HANDLE_SCALE = 1.75;

export const DEFAULT_OMIT_SIDES = {
  e: true,
  s: true,
  n: true,
  w: true,
};

export const OMIT_SIDES_FOR_MULTIPLE_ELEMENTS = {
  e: true,
  s: true,
  n: true,
  w: true,
};

export const OMIT_SIDES_FOR_FRAME = {
  e: true,
  s: true,
  n: true,
  w: true,
  rotation: true,
};

const OMIT_SIDES_FOR_LINE_SLASH = {
  e: true,
  s: true,
  n: true,
  w: true,
  nw: true,
  se: true,
};

const OMIT_SIDES_FOR_LINE_BACKSLASH = {
  e: true,
  s: true,
  n: true,
  w: true,
};

const generateTransformHandle = (
  x: number,
  y: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
  angle: Radians,
): TransformHandle => {
  const [xx, yy] = pointRotateRads(
    pointFrom(x + width / 2, y + height / 2),
    pointFrom(cx, cy),
    angle,
  );
  return [xx - width / 2, yy - height / 2, width, height];
};

export const canResizeFromSides = (editorInterface: EditorInterface) => {
  if (
    editorInterface.formFactor === "phone" &&
    editorInterface.userAgent.isMobileDevice
  ) {
    return false;
  }

  return true;
};

export const getOmitSidesForEditorInterface = (
  editorInterface: EditorInterface,
) => {
  if (canResizeFromSides(editorInterface)) {
    return DEFAULT_OMIT_SIDES;
  }

  return {};
};

export const getTransformHandlesFromCoords = (
  [x1, y1, x2, y2, cx, cy]: [number, number, number, number, number, number],
  angle: Radians,
  zoom: Zoom,
  pointerType: PointerType,
  omitSides: { [T in TransformHandleType]?: boolean } = {},
  margin = 4,
  spacing = DEFAULT_TRANSFORM_HANDLE_SPACING,
): TransformHandles => {
  const size = transformHandleSizes[pointerType];
  const handleWidth = size / zoom.value;
  const handleHeight = size / zoom.value;
  const sideHandleLength = Math.max(size, 16) / zoom.value;
  // Side handles sit on the same line as the selection border. The border
  // normally has two handle-spacing units of padding; images pass spacing 0
  // because their selection border is drawn directly on the element bounds.
  const sideHandleOffset =
    spacing === 0 ? 0 : (DEFAULT_TRANSFORM_HANDLE_SPACING * 2) / zoom.value;

  const handleMarginX = size / zoom.value;
  const handleMarginY = size / zoom.value;

  const width = x2 - x1;
  const height = y2 - y1;
  const rotationHandleSize = handleWidth * ROTATION_HANDLE_SCALE;
  const dashedLineMargin = margin / zoom.value;
  const centeringOffset = (size - spacing * 2) / (2 * zoom.value);

  const transformHandles: TransformHandles = {
    nw: omitSides.nw
      ? undefined
      : generateTransformHandle(
          x1 - dashedLineMargin - handleMarginX + centeringOffset,
          y1 - dashedLineMargin - handleMarginY + centeringOffset,
          handleWidth,
          handleHeight,
          cx,
          cy,
          angle,
        ),
    ne: omitSides.ne
      ? undefined
      : generateTransformHandle(
          x2 + dashedLineMargin - centeringOffset,
          y1 - dashedLineMargin - handleMarginY + centeringOffset,
          handleWidth,
          handleHeight,
          cx,
          cy,
          angle,
        ),
    sw: omitSides.sw
      ? undefined
      : generateTransformHandle(
          x1 - dashedLineMargin - handleMarginX + centeringOffset,
          y2 + dashedLineMargin - centeringOffset,
          handleWidth,
          handleHeight,
          cx,
          cy,
          angle,
        ),
    se: omitSides.se
      ? undefined
      : generateTransformHandle(
          x2 + dashedLineMargin - centeringOffset,
          y2 + dashedLineMargin - centeringOffset,
          handleWidth,
          handleHeight,
          cx,
          cy,
          angle,
        ),
    rotation: omitSides.rotation
      ? undefined
      : generateTransformHandle(
          // placed diagonally outside the bottom-right (se) corner handle:
          // the se corner handle center, extrapolated one more
          // ROTATION_RESIZE_HANDLE_GAP along the diagonal. Both axes use the
          // same idiom as the se corner handle (`dashedLineMargin` and
          // `centeringOffset` mirror the ne/se x coordinates), so the handle
          // sits symmetric about the selection's diagonal.
          x2 +
            dashedLineMargin -
            centeringOffset +
            handleWidth / 2 +
            ROTATION_RESIZE_HANDLE_GAP / zoom.value -
            rotationHandleSize / 2,
          y2 +
            dashedLineMargin -
            centeringOffset +
            handleHeight / 2 +
            ROTATION_RESIZE_HANDLE_GAP / zoom.value -
            rotationHandleSize / 2,
          rotationHandleSize,
          rotationHandleSize,
          cx,
          cy,
          angle,
        ),
  };

  // We only want to show height handles (all cardinal directions)  above a certain size
  // Note: we render using "mouse" size so we should also use "mouse" size for this check
  const minimumSizeForEightHandles =
    (5 * transformHandleSizes.mouse) / zoom.value;
  if (Math.abs(width) > minimumSizeForEightHandles) {
    if (!omitSides.n) {
      transformHandles.n = generateTransformHandle(
        x1 + width / 2 - sideHandleLength / 2,
        y1 - sideHandleOffset - handleHeight / 2,
        sideHandleLength,
        handleHeight,
        cx,
        cy,
        angle,
      );
    }
    if (!omitSides.s) {
      transformHandles.s = generateTransformHandle(
        x1 + width / 2 - sideHandleLength / 2,
        y2 + sideHandleOffset - handleHeight / 2,
        sideHandleLength,
        handleHeight,
        cx,
        cy,
        angle,
      );
    }
  }
  if (Math.abs(height) > minimumSizeForEightHandles) {
    if (!omitSides.w) {
      transformHandles.w = generateTransformHandle(
        x1 - sideHandleOffset - handleWidth / 2,
        y1 + height / 2 - sideHandleLength / 2,
        handleWidth,
        sideHandleLength,
        cx,
        cy,
        angle,
      );
    }
    if (!omitSides.e) {
      transformHandles.e = generateTransformHandle(
        x2 + sideHandleOffset - handleWidth / 2,
        y1 + height / 2 - sideHandleLength / 2,
        handleWidth,
        sideHandleLength,
        cx,
        cy,
        angle,
      );
    }
  }

  return transformHandles;
};

export const getTransformHandles = (
  element: ExcalidrawElement,
  zoom: Zoom,
  elementsMap: ElementsMap,
  pointerType: PointerType = "mouse",
  omitSides: { [T in TransformHandleType]?: boolean } = DEFAULT_OMIT_SIDES,
): TransformHandles => {
  // 手柄只挂在框上：没有框（连接线）就没有手柄可挂，也不需要另写一套元素
  // 类型判据（见 canHaveSelectionFrame）。命中测试同源——resizeTest 走的也
  // 是这个函数，所以「看不见」与「拖不动」始终是一条口径。
  //
  // 锁定元素与思维导图边另有理由：一画出来就是「能拖」的承诺。
  if (
    element.locked ||
    element.type === "mindmap-edge" ||
    !canHaveSelectionFrame(element)
  ) {
    return {};
  }

  // Table geometry keeps its grid dimensions in sync with its element
  // bounds, so every handle routes through the table gesture: corners scale
  // the whole subtree uniformly, sides stretch one axis, and rotation is
  // not supported at all.
  if (element.type === "table") {
    return getTransformHandlesFromCoords(
      getElementAbsoluteCoords(element, elementsMap, true),
      element.angle,
      zoom,
      pointerType,
      {
        ...omitSides,
        ...DEFAULT_OMIT_SIDES,
        rotation: true,
      },
      DEFAULT_TRANSFORM_HANDLE_SPACING,
    );
  }

  // Mindmap 节点的位置与角度由布局驱动，单节点旋转手柄无意义
  if (element.type === "mindmap-node") {
    return getTransformHandlesFromCoords(
      getElementAbsoluteCoords(element, elementsMap, true),
      element.angle,
      zoom,
      pointerType,
      {
        ...omitSides,
        ...DEFAULT_OMIT_SIDES,
        rotation: true,
      },
      DEFAULT_TRANSFORM_HANDLE_SPACING,
    );
  }

  if (element.type === "freedraw") {
    if (element.points.length === 2) {
      // only check the last point because starting point is always (0,0)
      const [, p1] = element.points;
      if (p1[0] === 0 || p1[1] === 0) {
        omitSides = OMIT_SIDES_FOR_LINE_BACKSLASH;
      } else if (p1[0] > 0 && p1[1] < 0) {
        omitSides = OMIT_SIDES_FOR_LINE_SLASH;
      } else if (p1[0] > 0 && p1[1] > 0) {
        omitSides = OMIT_SIDES_FOR_LINE_BACKSLASH;
      } else if (p1[0] < 0 && p1[1] > 0) {
        omitSides = OMIT_SIDES_FOR_LINE_SLASH;
      } else if (p1[0] < 0 && p1[1] < 0) {
        omitSides = OMIT_SIDES_FOR_LINE_BACKSLASH;
      }
    }
  } else if (isFrameLikeElement(element)) {
    omitSides = {
      ...omitSides,
      ...DEFAULT_OMIT_SIDES,
      rotation: true,
    };
  }
  const margin = isImageElement(element) ? 0 : DEFAULT_TRANSFORM_HANDLE_SPACING;
  return getTransformHandlesFromCoords(
    getElementAbsoluteCoords(element, elementsMap, true),
    element.angle,
    zoom,
    pointerType,
    omitSides,
    margin,
    isImageElement(element) ? 0 : undefined,
  );
};

/**
 * 选中框的显隐（只看元素本身，与 app 状态无关）：连接线（直线/曲线/折线）
 * 没有框——矩形只会把一条斜线圈进它的包围盒，选中反馈交给端点/拐点手柄与
 * 线本身。
 *
 * 这个判断有四个消费者，必须同源，否则就会出现「框不画了、可它还在某处生
 * 效」这种看不见的陷阱：
 * - `hasBoundingBox`：画框（renderer/interactiveScene）+ 只命中包围盒也算
 *   点到（app/hitTest）
 * - `getTransformHandles`：画手柄 + 抓手柄（resizeTest）
 * - `resizeTest` 贴着包围盒的边带兜底：悬停即变缩放光标的那圈热区
 * - `pointerSelection` 按下时拿手柄的门槛
 */
export const canHaveSelectionFrame = (element: ExcalidrawElement) =>
  !isLinearElement(element);

export const hasBoundingBox = (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: InteractiveCanvasAppState,
  editorInterface: EditorInterface,
) => {
  if (
    appState.selectedLinearElement?.isEditing ||
    appState.selectedLinearElement?.isDragging
  ) {
    return false;
  }
  if (elements.length > 1) {
    return true;
  }

  return canHaveSelectionFrame(elements[0]);
};
