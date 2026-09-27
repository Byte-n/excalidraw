import {
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
  type Radians,
} from "@excalidraw/math";
import { getCompositeShapeControlPoints } from "@excalidraw/element";

import type { ExcalidrawCompositeShapeElement } from "@excalidraw/element/types";

export const getCompositeControlPointGlobal = (
  element: ExcalidrawCompositeShapeElement,
  point: { x: number; y: number },
): GlobalPoint =>
  pointRotateRads(
    pointFrom<GlobalPoint>(element.x + point.x, element.y + point.y),
    pointFrom<GlobalPoint>(
      element.x + element.width / 2,
      element.y + element.height / 2,
    ),
    element.angle,
  );

export const getCompositeControlPointLocal = (
  element: ExcalidrawCompositeShapeElement,
  sceneX: number,
  sceneY: number,
) => {
  const [x, y] = pointRotateRads(
    pointFrom<GlobalPoint>(sceneX, sceneY),
    pointFrom<GlobalPoint>(
      element.x + element.width / 2,
      element.y + element.height / 2,
    ),
    -element.angle as Radians,
  );
  return { x: x - element.x, y: y - element.y };
};

export const hitCompositeControlPoint = (
  element: ExcalidrawCompositeShapeElement,
  sceneX: number,
  sceneY: number,
  zoom: number,
  pointerType: string,
) => {
  if (element.width <= 0 || element.height <= 0) {
    return undefined;
  }
  const radius =
    (pointerType === "touch" ? 18 : pointerType === "pen" ? 13 : 10) / zoom;
  return getCompositeShapeControlPoints(element).find((point) => {
    const [x, y] = getCompositeControlPointGlobal(element, point);
    return Math.hypot(sceneX - x, sceneY - y) <= radius;
  });
};
