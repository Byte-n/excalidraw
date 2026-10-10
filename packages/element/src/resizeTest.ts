import {
  pointFrom,
  pointOnLineSegment,
  pointRotateRads,
  type Radians,
} from "@excalidraw/math";

import {
  SIDE_RESIZING_THRESHOLD,
  type EditorInterface,
} from "@excalidraw/common";

import type { GlobalPoint, LineSegment, LocalPoint } from "@excalidraw/math";

import type { AppState, Zoom } from "@excalidraw/excalidraw/types";
import type { Bounds } from "@excalidraw/common";

import { getElementAbsoluteCoords } from "./bounds";
import {
  getTransformHandlesFromCoords,
  getTransformHandles,
  getOmitSidesForEditorInterface,
  canResizeFromSides,
} from "./transformHandles";
import { isImageElement, isLinearElement } from "./typeChecks";

import type {
  TransformHandleType,
  TransformHandle,
  MaybeTransformHandleType,
} from "./transformHandles";
import type {
  ExcalidrawElement,
  PointerType,
  NonDeletedExcalidrawElement,
  ElementsMap,
} from "./types";

const isInsideTransformHandle = (
  transformHandle: TransformHandle,
  x: number,
  y: number,
) =>
  x >= transformHandle[0] &&
  x <= transformHandle[0] + transformHandle[2] &&
  y >= transformHandle[1] &&
  y <= transformHandle[1] + transformHandle[3];

export const resizeTest = <Point extends GlobalPoint | LocalPoint>(
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: AppState,
  x: number,
  y: number,
  zoom: Zoom,
  pointerType: PointerType,
  editorInterface: EditorInterface,
): MaybeTransformHandleType => {
  if (!appState.selectedElementIds[element.id]) {
    return false;
  }

  const { rotation: rotationTransformHandle, ...transformHandles } =
    getTransformHandles(
      element,
      zoom,
      elementsMap,
      pointerType,
      getOmitSidesForEditorInterface(editorInterface),
    );

  if (
    rotationTransformHandle &&
    isInsideTransformHandle(rotationTransformHandle, x, y)
  ) {
    return "rotation" as TransformHandleType;
  }

  const filter = Object.keys(transformHandles).filter((key) => {
    const transformHandle =
      transformHandles[key as Exclude<TransformHandleType, "rotation">]!;
    if (!transformHandle) {
      return false;
    }
    return isInsideTransformHandle(transformHandle, x, y);
  });

  if (filter.length > 0) {
    return filter[0] as TransformHandleType;
  }

  // Tables intentionally fall through to the side-band check below: their
  // whole selection frame scales (sides stretch one axis, via the table
  // gesture), so the frame line itself is the drag affordance.

  if (canResizeFromSides(editorInterface)) {
    const [x1, y1, x2, y2, cx, cy] = getElementAbsoluteCoords(
      element,
      elementsMap,
    );

    // do not resize from the sides for linear elements with only two points
    if (!(isLinearElement(element) && element.points.length <= 2)) {
      const SPACING = isImageElement(element)
        ? 0
        : SIDE_RESIZING_THRESHOLD / zoom.value;
      const ZOOMED_SIDE_RESIZING_THRESHOLD =
        SIDE_RESIZING_THRESHOLD / zoom.value;
      const sides = getSelectionBorders(
        pointFrom(x1 - SPACING, y1 - SPACING),
        pointFrom(x2 + SPACING, y2 + SPACING),
        pointFrom(cx, cy),
        element.angle,
      );

      for (const [dir, side] of Object.entries(sides)) {
        // test to see if x, y are on the line segment
        if (
          pointOnLineSegment(
            pointFrom(x, y),
            side as LineSegment<Point>,
            ZOOMED_SIDE_RESIZING_THRESHOLD,
          )
        ) {
          return dir as TransformHandleType;
        }
      }
    }
  }

  return false;
};

export const getElementWithTransformHandleType = (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: AppState,
  scenePointerX: number,
  scenePointerY: number,
  zoom: Zoom,
  pointerType: PointerType,
  elementsMap: ElementsMap,
  editorInterface: EditorInterface,
) => {
  return elements.reduce((result, element) => {
    if (result) {
      return result;
    }
    const transformHandleType = resizeTest(
      element,
      elementsMap,
      appState,
      scenePointerX,
      scenePointerY,
      zoom,
      pointerType,
      editorInterface,
    );
    return transformHandleType ? { element, transformHandleType } : null;
  }, null as { element: NonDeletedExcalidrawElement; transformHandleType: MaybeTransformHandleType } | null);
};

export const getTransformHandleTypeFromCoords = <
  Point extends GlobalPoint | LocalPoint,
>(
  [x1, y1, x2, y2]: Bounds,
  scenePointerX: number,
  scenePointerY: number,
  zoom: Zoom,
  pointerType: PointerType,
  editorInterface: EditorInterface,
): MaybeTransformHandleType => {
  const transformHandles = getTransformHandlesFromCoords(
    [x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2],
    0 as Radians,
    zoom,
    pointerType,
    getOmitSidesForEditorInterface(editorInterface),
  );

  const found = Object.keys(transformHandles).find((key) => {
    const transformHandle =
      transformHandles[key as Exclude<TransformHandleType, "rotation">]!;
    return (
      transformHandle &&
      isInsideTransformHandle(transformHandle, scenePointerX, scenePointerY)
    );
  });

  if (found) {
    return found as MaybeTransformHandleType;
  }

  if (canResizeFromSides(editorInterface)) {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    const SPACING = SIDE_RESIZING_THRESHOLD / zoom.value;

    const sides = getSelectionBorders(
      pointFrom(x1 - SPACING, y1 - SPACING),
      pointFrom(x2 + SPACING, y2 + SPACING),
      pointFrom(cx, cy),
      0 as Radians,
    );

    for (const [dir, side] of Object.entries(sides)) {
      // test to see if x, y are on the line segment
      if (
        pointOnLineSegment(
          pointFrom(scenePointerX, scenePointerY),
          side as LineSegment<Point>,
          SPACING,
        )
      ) {
        return dir as TransformHandleType;
      }
    }
  }

  return false;
};

const RESIZE_CURSORS = ["ns", "nesw", "ew", "nwse"];
const rotateResizeCursor = (cursor: string, angle: number) => {
  const index = RESIZE_CURSORS.indexOf(cursor);
  if (index >= 0) {
    const a = Math.round(angle / (Math.PI / 4));
    cursor = RESIZE_CURSORS[(index + a) % RESIZE_CURSORS.length];
  }
  return cursor;
};

/*
 * Returns bi-directional cursor for the element being resized
 */
// arc-shaped double-headed arrow matching the rotation handle icon,
// white halo so it reads on any background
const ROTATION_CURSOR_PATH =
  "M7 7A11 11 0 0 1 17 17M3.5 7L8 3.5v7zM17 20.5L13.5 16h7z";
const ROTATION_CURSOR_ANGLE_STEP = 2;
const rotationCursorCache = new Map<number, string>();

// rotation cursor turned to match the (rotated) rotation handle
export const getRotationCursor = (angle: number): string => {
  const deg =
    (((Math.round((angle * 180) / Math.PI / ROTATION_CURSOR_ANGLE_STEP) *
      ROTATION_CURSOR_ANGLE_STEP) %
      360) +
      360) %
    360;
  let cursor = rotationCursorCache.get(deg);
  if (!cursor) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(${deg} 12 12)"><path d="${ROTATION_CURSOR_PATH}" stroke="#fff" stroke-width="4"/><path d="${ROTATION_CURSOR_PATH}" stroke="#000" stroke-width="1.5"/><path d="M3.5 7L8 3.5v7zM17 20.5L13.5 16h7z" fill="#000"/></g></svg>`;
    cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, grab`;
    rotationCursorCache.set(deg, cursor);
  }
  return cursor;
};

export const getCursorForResizingElement = (resizingElement: {
  element?: ExcalidrawElement;
  transformHandleType: MaybeTransformHandleType;
}): string => {
  const { element, transformHandleType } = resizingElement;
  const shouldSwapCursors =
    element && Math.sign(element.height) * Math.sign(element.width) === -1;
  let cursor = null;

  switch (transformHandleType) {
    case "n":
    case "s":
      cursor = "ns";
      break;
    case "w":
    case "e":
      cursor = "ew";
      break;
    case "nw":
    case "se":
      if (shouldSwapCursors) {
        cursor = "nesw";
      } else {
        cursor = "nwse";
      }
      break;
    case "ne":
    case "sw":
      if (shouldSwapCursors) {
        cursor = "nwse";
      } else {
        cursor = "nesw";
      }
      break;
    case "rotation":
      return getRotationCursor(element?.angle ?? 0);
  }

  if (cursor && element) {
    cursor = rotateResizeCursor(cursor, element.angle);
  }

  return cursor ? `${cursor}-resize` : "";
};

const getSelectionBorders = <Point extends LocalPoint | GlobalPoint>(
  [x1, y1]: Point,
  [x2, y2]: Point,
  center: Point,
  angle: Radians,
) => {
  const topLeft = pointRotateRads(pointFrom(x1, y1), center, angle);
  const topRight = pointRotateRads(pointFrom(x2, y1), center, angle);
  const bottomLeft = pointRotateRads(pointFrom(x1, y2), center, angle);
  const bottomRight = pointRotateRads(pointFrom(x2, y2), center, angle);

  return {
    n: [topLeft, topRight],
    e: [topRight, bottomRight],
    s: [bottomRight, bottomLeft],
    w: [bottomLeft, topLeft],
  };
};
