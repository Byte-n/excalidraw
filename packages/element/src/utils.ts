import {
  DEFAULT_ADAPTIVE_RADIUS,
  DEFAULT_PROPORTIONAL_RADIUS,
  LINE_CONFIRM_THRESHOLD,
  ROUNDNESS,
} from "@excalidraw/common";

import {
  curve,
  curveCatmullRomCubicApproxPoints,
  curveOffsetPoints,
  lineSegment,
  pointDistance,
  pointFrom,
  pointFromArray,
  rectangle,
  type GlobalPoint,
} from "@excalidraw/math";

import type { Curve, LineSegment, LocalPoint } from "@excalidraw/math";

import type { NormalizedZoomValue, Zoom } from "@excalidraw/excalidraw/types";

import {
  getCompositeShapeCornerRadius,
  isShapeElement,
} from "./compositeShape";
import { getMindmapShapeId } from "./mindmap";

import { generateLinearCollisionShape } from "./shape";

import { isElbowArrow } from "./typeChecks";
import { getStickyNoteCornerRadius } from "./stickyNote";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawLinearElement,
  ExcalidrawRectanguloidElement,
} from "./types";

export type LinearPathSegment = LineSegment<GlobalPoint> | Curve<GlobalPoint>;

type ElementShape = [LineSegment<GlobalPoint>[], Curve<GlobalPoint>[]];

const ElementShapesCache = new WeakMap<
  ExcalidrawElement,
  { version: ExcalidrawElement["version"]; shapes: Map<number, ElementShape> }
>();

const getElementShapesCacheEntry = <T extends ExcalidrawElement>(
  element: T,
  offset: number,
): ElementShape | undefined => {
  const record = ElementShapesCache.get(element);

  if (!record) {
    return undefined;
  }

  const { version, shapes } = record;

  if (version !== element.version) {
    ElementShapesCache.delete(element);
    return undefined;
  }

  return shapes.get(offset);
};

const setElementShapesCacheEntry = <T extends ExcalidrawElement>(
  element: T,
  shape: ElementShape,
  offset: number,
) => {
  const record = ElementShapesCache.get(element);

  if (!record) {
    ElementShapesCache.set(element, {
      version: element.version,
      shapes: new Map([[offset, shape]]),
    });

    return;
  }

  const { version, shapes } = record;

  if (version !== element.version) {
    ElementShapesCache.set(element, {
      version: element.version,
      shapes: new Map([[offset, shape]]),
    });

    return;
  }

  shapes.set(offset, shape);
};

/**
 * Returns the **rotated** components of freedraw, line or arrow elements.
 *
 * @param element The linear element to deconstruct
 * @returns The rotated in components.
 */
export function deconstructLinearOrFreeDrawElement(
  element: ExcalidrawLinearElement | ExcalidrawFreeDrawElement,
  elementsMap: ElementsMap,
): ElementShape {
  const cachedShape = getElementShapesCacheEntry(element, 0);

  if (cachedShape) {
    return cachedShape;
  }

  const ops = generateLinearCollisionShape(element, elementsMap);
  const lines: LineSegment<GlobalPoint>[] = [];
  const curves: Curve<GlobalPoint>[] = [];

  for (let idx = 0; idx < ops.length; idx += 1) {
    const op = ops[idx];
    const prevPoint =
      ops[idx - 1] && pointFromArray<LocalPoint>(ops[idx - 1].data.slice(-2));
    switch (op.op) {
      case "move":
        continue;
      case "lineTo":
        if (!prevPoint) {
          throw new Error("prevPoint is undefined");
        }

        lines.push(
          lineSegment<GlobalPoint>(
            pointFrom<GlobalPoint>(
              element.x + prevPoint[0],
              element.y + prevPoint[1],
            ),
            pointFrom<GlobalPoint>(
              element.x + op.data[0],
              element.y + op.data[1],
            ),
          ),
        );
        continue;
      case "bcurveTo":
        if (!prevPoint) {
          throw new Error("prevPoint is undefined");
        }

        curves.push(
          curve<GlobalPoint>(
            pointFrom<GlobalPoint>(
              element.x + prevPoint[0],
              element.y + prevPoint[1],
            ),
            pointFrom<GlobalPoint>(
              element.x + op.data[0],
              element.y + op.data[1],
            ),
            pointFrom<GlobalPoint>(
              element.x + op.data[2],
              element.y + op.data[3],
            ),
            pointFrom<GlobalPoint>(
              element.x + op.data[4],
              element.y + op.data[5],
            ),
          ),
        );
        continue;
      default: {
        console.error("Unknown op type", op.op);
      }
    }
  }

  const shape: ElementShape = [lines, curves];
  setElementShapesCacheEntry(element, shape, 0);

  return shape;
}

export function getLinearElementPathSegments(
  element: ExcalidrawLinearElement | ExcalidrawFreeDrawElement,
  elementsMap: ElementsMap,
): LinearPathSegment[] {
  // For now, model elbow arrows as their unrounded logical path. Rounded
  // joints can be incorporated once the path model supports mixed straight
  // and curved segments.
  if (isElbowArrow(element)) {
    return element.points
      .slice(1)
      .map((point, index) =>
        lineSegment<GlobalPoint>(
          pointFrom<GlobalPoint>(
            element.x + element.points[index][0],
            element.y + element.points[index][1],
          ),
          pointFrom<GlobalPoint>(element.x + point[0], element.y + point[1]),
        ),
      );
  }

  const [lines, curves] = deconstructLinearOrFreeDrawElement(
    element,
    elementsMap,
  );

  // Non-elbow paths currently contain only one segment type. Mixed paths
  // should consume an ordered operation stream instead of these type buckets.
  return curves.length > 0 ? curves : lines;
}

/**
 * Get the building components of a rectanguloid element in the form of
 * line segments and curves **unrotated**.
 *
 * @param element Target rectanguloid element
 * @param offset Optional offset to expand the rectanguloid shape
 * @returns Tuple of **unrotated** line segments (0) and curves (1)
 */
export function deconstructRectanguloidElement(
  element: ExcalidrawRectanguloidElement,
  offset: number = 0,
): ElementShape {
  const cachedShape = getElementShapesCacheEntry(element, offset);

  if (cachedShape) {
    return cachedShape;
  }

  let radius =
    element.type === "stickynote"
      ? getStickyNoteCornerRadius(element)
      : getCornerRadius(Math.min(element.width, element.height), element);

  if (radius === 0) {
    radius = 0.01;
  }

  const r = rectangle(
    pointFrom(element.x, element.y),
    pointFrom(element.x + element.width, element.y + element.height),
  );

  const top = lineSegment<GlobalPoint>(
    pointFrom<GlobalPoint>(r[0][0] + radius, r[0][1]),
    pointFrom<GlobalPoint>(r[1][0] - radius, r[0][1]),
  );
  const right = lineSegment<GlobalPoint>(
    pointFrom<GlobalPoint>(r[1][0], r[0][1] + radius),
    pointFrom<GlobalPoint>(r[1][0], r[1][1] - radius),
  );
  const bottom = lineSegment<GlobalPoint>(
    pointFrom<GlobalPoint>(r[0][0] + radius, r[1][1]),
    pointFrom<GlobalPoint>(r[1][0] - radius, r[1][1]),
  );
  const left = lineSegment<GlobalPoint>(
    pointFrom<GlobalPoint>(r[0][0], r[1][1] - radius),
    pointFrom<GlobalPoint>(r[0][0], r[0][1] + radius),
  );

  const baseCorners = [
    curve(
      left[1],
      pointFrom<GlobalPoint>(
        left[1][0] + (2 / 3) * (r[0][0] - left[1][0]),
        left[1][1] + (2 / 3) * (r[0][1] - left[1][1]),
      ),
      pointFrom<GlobalPoint>(
        top[0][0] + (2 / 3) * (r[0][0] - top[0][0]),
        top[0][1] + (2 / 3) * (r[0][1] - top[0][1]),
      ),
      top[0],
    ), // TOP LEFT
    curve(
      top[1],
      pointFrom<GlobalPoint>(
        top[1][0] + (2 / 3) * (r[1][0] - top[1][0]),
        top[1][1] + (2 / 3) * (r[0][1] - top[1][1]),
      ),
      pointFrom<GlobalPoint>(
        right[0][0] + (2 / 3) * (r[1][0] - right[0][0]),
        right[0][1] + (2 / 3) * (r[0][1] - right[0][1]),
      ),
      right[0],
    ), // TOP RIGHT
    curve(
      right[1],
      pointFrom<GlobalPoint>(
        right[1][0] + (2 / 3) * (r[1][0] - right[1][0]),
        right[1][1] + (2 / 3) * (r[1][1] - right[1][1]),
      ),
      pointFrom<GlobalPoint>(
        bottom[1][0] + (2 / 3) * (r[1][0] - bottom[1][0]),
        bottom[1][1] + (2 / 3) * (r[1][1] - bottom[1][1]),
      ),
      bottom[1],
    ), // BOTTOM RIGHT
    curve(
      bottom[0],
      pointFrom<GlobalPoint>(
        bottom[0][0] + (2 / 3) * (r[0][0] - bottom[0][0]),
        bottom[0][1] + (2 / 3) * (r[1][1] - bottom[0][1]),
      ),
      pointFrom<GlobalPoint>(
        left[0][0] + (2 / 3) * (r[0][0] - left[0][0]),
        left[0][1] + (2 / 3) * (r[1][1] - left[0][1]),
      ),
      left[0],
    ), // BOTTOM LEFT
  ];

  const corners =
    offset > 0
      ? baseCorners.map(
          (corner) =>
            curveCatmullRomCubicApproxPoints(
              curveOffsetPoints(corner, offset),
            )!,
        )
      : [
          [baseCorners[0]],
          [baseCorners[1]],
          [baseCorners[2]],
          [baseCorners[3]],
        ];

  const sides = [
    lineSegment<GlobalPoint>(
      corners[0][corners[0].length - 1][3],
      corners[1][0][0],
    ),
    lineSegment<GlobalPoint>(
      corners[1][corners[1].length - 1][3],
      corners[2][0][0],
    ),
    lineSegment<GlobalPoint>(
      corners[2][corners[2].length - 1][3],
      corners[3][0][0],
    ),
    lineSegment<GlobalPoint>(
      corners[3][corners[3].length - 1][3],
      corners[0][0][0],
    ),
  ];
  const shape = [sides, corners.flat()] as ElementShape;

  setElementShapesCacheEntry(element, shape, offset);

  return shape;
}

// Checks if the first and last point are close enough
// to be considered a loop
export const isPathALoop = (
  points: ExcalidrawLinearElement["points"],
  /** supply if you want the loop detection to account for current zoom */
  zoomValue: Zoom["value"] = 1 as NormalizedZoomValue,
): boolean => {
  if (points.length >= 3) {
    const [first, last] = [points[0], points[points.length - 1]];
    const distance = pointDistance(first, last);

    // Adjusting LINE_CONFIRM_THRESHOLD to current zoom so that when zoomed in
    // really close we make the threshold smaller, and vice versa.
    return distance <= LINE_CONFIRM_THRESHOLD / zoomValue;
  }
  return false;
};

export const getCornerRadius = (x: number, element: ExcalidrawElement) => {
  if (
    element.type === "mindmap-node" &&
    getMindmapShapeId(element) === "pill"
  ) {
    return Math.min(element.width, element.height) / 2;
  }
  if (isShapeElement(element)) {
    if (element.shape.id === "rectangle") {
      return 0;
    }
    return getCompositeShapeCornerRadius(x, element.roundness);
  }
  if (
    element.roundness?.type === ROUNDNESS.PROPORTIONAL_RADIUS ||
    element.roundness?.type === ROUNDNESS.LEGACY
  ) {
    return x * DEFAULT_PROPORTIONAL_RADIUS;
  }

  if (element.roundness?.type === ROUNDNESS.ADAPTIVE_RADIUS) {
    const fixedRadiusSize = element.roundness?.value ?? DEFAULT_ADAPTIVE_RADIUS;

    const CUTOFF_SIZE = fixedRadiusSize / DEFAULT_PROPORTIONAL_RADIUS;

    if (x <= CUTOFF_SIZE) {
      return x * DEFAULT_PROPORTIONAL_RADIUS;
    }

    return fixedRadiusSize;
  }

  return 0;
};
