import { getGridPoint } from "@excalidraw/common";

import {
  lineSegment,
  pointDistanceSq,
  pointFrom,
  pointRotateRads,
  vectorFromPoint,
} from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";
import type { NullableGridSize } from "@excalidraw/excalidraw/types";

import { getBindingGap } from "../bindingGap";
import {
  aabbForElement,
  getCenterForBounds,
  getElementAbsoluteCoords,
} from "../bounds";
import { intersectElementWithLineSegment } from "../collision";
import { isShapeWithIdIn } from "../compositeShape";
import { headingForPointFromElement, vectorToHeading } from "../heading";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawLinearElement,
} from "../types";
import type { ConnectionQuery } from "./types";

/**
 * `buildConnectionQuery` inputs. This is the only place the pointer-mode flags
 * are turned into a `ConnectionQuery` (03-connection-integration.md §4.1):
 * grid snapping, Shift (angle lock) and the midpoint-snapping preference are
 * all resolved here so previews and landings cannot drift.
 */
export type BuildConnectionQueryArgs = {
  element: ExcalidrawBindableElement;
  point: GlobalPoint;
  reference?: GlobalPoint;
  arrow?: ConnectionQuery["arrow"];
  zoom: number;
  isMidpointSnappingEnabled: boolean;
  gridSize?: NullableGridSize;
  angleLocked?: boolean;
  elementsMap: ElementsMap;
  /** The other end used by grid snapping; defaults to the arrow's fixed end. */
  adjacentPoint?: GlobalPoint;
  /** Which arrow endpoint is being resolved; new arrows default to start. */
  startOrEnd?: "start" | "end";
};

const isLinearArrow = (
  arrow: BuildConnectionQueryArgs["arrow"],
): arrow is ExcalidrawLinearElement => arrow !== undefined && "points" in arrow;

/** Global coordinates of an arrow point (rotation included). */
const arrowPointGlobal = (
  arrow: ExcalidrawLinearElement,
  index: number,
  elementsMap: ElementsMap,
): GlobalPoint | undefined => {
  const point = arrow.points.at(index);
  if (!point) {
    return undefined;
  }
  const [, , , , cx, cy] = getElementAbsoluteCoords(arrow, elementsMap);
  return pointRotateRads<GlobalPoint>(
    pointFrom<GlobalPoint>(arrow.x + point[0], arrow.y + point[1]),
    pointFrom<GlobalPoint>(cx, cy),
    arrow.angle,
  );
};

/**
 * Snaps a bound arrow endpoint to the grid on the axis parallel to the
 * bindable element's side, while preserving the binding gap distance on the
 * perpendicular axis. In other words, the grid axis closest to the side's
 * perpendicular (normal) is used as the snap axis and the other axis is kept at
 * the binding gap distance.
 */
export const snapBoundPointToGrid = (
  outlinePoint: GlobalPoint,
  bindableElement: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
  gridSize: NullableGridSize,
  arrowElement: Pick<ExcalidrawArrowElement, "elbowed">,
  adjacentPoint?: GlobalPoint,
): GlobalPoint => {
  if (!gridSize) {
    return outlinePoint;
  }

  const aabb = aabbForElement(bindableElement, elementsMap);
  // For ellipses and diamonds use the arrow's incoming direction instead of
  // the position-based heading, which can give the wrong axis when the
  // outline point is near a cardinal zone or an angled diamond face.
  const heading =
    adjacentPoint && isShapeWithIdIn(bindableElement, ["ellipse", "diamond"])
      ? vectorToHeading(vectorFromPoint(adjacentPoint, outlinePoint))
      : headingForPointFromElement(bindableElement, aabb, outlinePoint);

  const bindingGap = getBindingGap(bindableElement, arrowElement);
  const extent =
    Math.max(bindableElement.width, bindableElement.height) + bindingGap * 2;
  const center = getCenterForBounds(aabb);

  // Both heading strategies above return global-axis directions.
  const absNX = Math.abs(heading[0]);
  const absNY = Math.abs(heading[1]);
  if (absNX >= absNY) {
    // Global X is closest to the perpendicular so snap Y, intersect horizontal line
    const [, snappedY] = getGridPoint(
      outlinePoint[0],
      outlinePoint[1],
      gridSize,
    );
    const intersector = lineSegment<GlobalPoint>(
      pointFrom<GlobalPoint>(center[0] - extent, snappedY),
      pointFrom<GlobalPoint>(center[0] + extent, snappedY),
    );
    const intersection = intersectElementWithLineSegment(
      bindableElement,
      elementsMap,
      intersector,
      bindingGap,
    ).sort(
      (a, b) =>
        pointDistanceSq(a, outlinePoint) - pointDistanceSq(b, outlinePoint),
    )[0];

    return intersection ?? pointFrom<GlobalPoint>(outlinePoint[0], snappedY);
  }

  // Global Y is closest to the perpendicular so snap X, intersect vertical line
  const [snappedX] = getGridPoint(outlinePoint[0], outlinePoint[1], gridSize);
  const intersector = lineSegment<GlobalPoint>(
    pointFrom<GlobalPoint>(snappedX, center[1] - extent),
    pointFrom<GlobalPoint>(snappedX, center[1] + extent),
  );
  const intersection = intersectElementWithLineSegment(
    bindableElement,
    elementsMap,
    intersector,
    bindingGap,
  ).sort(
    (a, b) =>
      pointDistanceSq(a, outlinePoint) - pointDistanceSq(b, outlinePoint),
  )[0];

  return intersection ?? pointFrom<GlobalPoint>(snappedX, outlinePoint[1]);
};

/**
 * Builds the single query shape consumed by `resolveConnectionHit`.
 *
 * - grid mode: the point is grid-snapped and anchors are skipped;
 * - Shift (angle lock): anchors are skipped and the ray tier is forced;
 * - midpoint snapping off: anchors are skipped.
 */
export const buildConnectionQuery = (
  args: BuildConnectionQueryArgs,
): ConnectionQuery => {
  const arrow = args.arrow ?? { elbowed: false };
  const startOrEnd = args.startOrEnd ?? "start";
  const gridEnabled = Boolean(args.gridSize);
  const angleLocked = Boolean(args.angleLocked);

  const adjacentPoint =
    args.adjacentPoint ??
    (isLinearArrow(arrow)
      ? arrowPointGlobal(
          arrow,
          startOrEnd === "start" ? 1 : -2,
          args.elementsMap,
        )
      : undefined);

  const point =
    gridEnabled && args.gridSize
      ? snapBoundPointToGrid(
          args.point,
          args.element,
          args.elementsMap,
          args.gridSize,
          arrow as Pick<ExcalidrawArrowElement, "elbowed">,
          adjacentPoint,
        )
      : args.point;

  return {
    element: args.element,
    point,
    reference: args.reference,
    arrow,
    zoom: args.zoom,
    anchorsEnabled:
      args.isMidpointSnappingEnabled && !angleLocked && !gridEnabled,
    angleLocked,
    elementsMap: args.elementsMap,
    startOrEnd,
  };
};
