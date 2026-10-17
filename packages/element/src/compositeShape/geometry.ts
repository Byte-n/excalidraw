import ClipperLib from "clipper-lib";

import {
  curve,
  curveIntersectLineSegment,
  lineSegment,
  lineSegmentIntersectionPoints,
  pointDistance,
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
  type LocalPoint,
} from "@excalidraw/math";

import {
  flattenCompositeShapePath,
  type CompositeShapePath,
  type ShapePoint,
} from "./outline";
import {
  getShapeRegistration,
  type CompositeShapeGeometryInput,
} from "./registry";

import type { ExcalidrawShapeElement } from "../types";

/**
 * Derived geometry: the local outline a registration declares, plus the global
 * path, cardinal anchors and outline offsets computed from it.
 */

export type CompositeShapeGeometry = {
  outline: CompositeShapePath;
  details: CompositeShapePath[];
  fillFaces?: { path: CompositeShapePath; tone: "light" | "base" | "dark" }[];
  anchors?: [ShapePoint, ShapePoint, ShapePoint, ShapePoint];
  primitive?:
    | { kind: "rectangle"; width: number; height: number; radius: number }
    | {
        kind: "diamond";
        points: ShapePoint[];
        verticalRadius: number;
        horizontalRadius: number;
      }
    | {
        kind: "ellipse";
        center: ShapePoint;
        radiusX: number;
        radiusY: number;
      };
};
/**
 * Resolves the visible geometry for a composite shape from its registration.
 * Each id declares its outline, details, fill faces, anchors and primitive, so
 * nothing depends on an implicit fallback here.
 */
export const getCompositeShapeGeometry = (
  element: CompositeShapeGeometryInput,
): CompositeShapeGeometry => {
  const registration = getShapeRegistration(element.shape.id);
  const geometry: CompositeShapeGeometry = {
    outline: registration.outline(element),
    details: registration.details?.(element) ?? [],
  };
  const fillFaces = registration.fillFaces?.(element);
  const anchors = registration.anchors?.(element);
  const primitive = registration.primitive?.(element);
  if (fillFaces) {
    geometry.fillFaces = fillFaces;
  }
  if (anchors) {
    geometry.anchors = anchors;
  }
  if (primitive) {
    geometry.primitive = primitive;
  }
  return geometry;
};

export const getCompositeShapeGlobalPath = (
  element: ExcalidrawShapeElement,
): CompositeShapePath => {
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const transform = ([x, y]: ShapePoint): ShapePoint =>
    pointRotateRads(
      pointFrom<GlobalPoint>(element.x + x, element.y + y),
      center,
      element.angle,
    );
  const path = getCompositeShapeGeometry(element).outline;
  return {
    start: transform(path.start),
    commands: path.commands.map((command) =>
      command.type === "line"
        ? { type: "line", to: transform(command.to) }
        : {
            type: "cubic",
            control1: transform(command.control1),
            control2: transform(command.control2),
            to: transform(command.to),
          },
    ),
    closed: path.closed,
  };
};
// Clipper uses integer coordinates; millipixels retain subpixel geometry.
const CLIPPER_SCALE = 1000;
export const getCompositeShapeOffsetPaths = (
  element: ExcalidrawShapeElement,
  offset: number,
): GlobalPoint[][] => {
  const outline = getCompositeShapeGlobalPath(element);
  const points = flattenCompositeShapePath(outline);
  if (offset === 0 || (offset < 0 && !outline.closed)) {
    return [points.map(([x, y]) => pointFrom<GlobalPoint>(x, y))];
  }
  const clipper = new ClipperLib.ClipperOffset(
    2,
    CLIPPER_SCALE * Math.min(0.25, Math.abs(offset) / 10),
  );
  clipper.AddPath(
    points.map(([x, y]) => ({
      X: Math.round(x * CLIPPER_SCALE),
      Y: Math.round(y * CLIPPER_SCALE),
    })),
    ClipperLib.JoinType.jtRound,
    outline.closed
      ? ClipperLib.EndType.etClosedPolygon
      : ClipperLib.EndType.etOpenRound,
  );
  const paths: ClipperLib.Paths = [];
  clipper.Execute(paths, offset * CLIPPER_SCALE);
  return paths.map((path) =>
    path.map(({ X, Y }) =>
      pointFrom<GlobalPoint>(X / CLIPPER_SCALE, Y / CLIPPER_SCALE),
    ),
  );
};
/** Cardinal anchors lie on the shape path, including curved and open paths. */
export const getCompositeShapeAnchors = (
  element: ExcalidrawShapeElement,
): GlobalPoint[] => {
  const geometry = getCompositeShapeGeometry(element);
  const path = geometry.outline;
  const center = pointFrom<LocalPoint>(element.width / 2, element.height / 2);
  const rotationCenter = pointFrom<GlobalPoint>(
    element.x + center[0],
    element.y + center[1],
  );
  const toGlobal = (anchor: ShapePoint) =>
    pointRotateRads(
      pointFrom<GlobalPoint>(element.x + anchor[0], element.y + anchor[1]),
      rotationCenter,
      element.angle,
    );
  if (geometry.anchors) {
    return geometry.anchors.map(toGlobal);
  }
  const extent = Math.max(element.width, element.height) * 2 + 1;
  const axes = [
    lineSegment(
      pointFrom<LocalPoint>(center[0] - extent, center[1]),
      pointFrom<LocalPoint>(center[0] + extent, center[1]),
    ),
    lineSegment(
      pointFrom<LocalPoint>(center[0], center[1] - extent),
      pointFrom<LocalPoint>(center[0], center[1] + extent),
    ),
  ];
  const intersections: LocalPoint[][] = [[], []];
  let previous = pointFrom<LocalPoint>(...path.start);
  const segments = [
    ...path.commands,
    ...(path.closed ? [{ type: "line" as const, to: path.start }] : []),
  ];
  for (const command of segments) {
    const to = pointFrom<LocalPoint>(...command.to);
    for (let axis = 0; axis < axes.length; axis++) {
      if (command.type === "line") {
        const hit = lineSegmentIntersectionPoints(
          lineSegment(previous, to),
          axes[axis],
        );
        if (hit) {
          intersections[axis].push(hit);
        }
      } else {
        intersections[axis].push(
          ...curveIntersectLineSegment(
            curve(
              previous,
              pointFrom<LocalPoint>(...command.control1),
              pointFrom<LocalPoint>(...command.control2),
              to,
            ),
            axes[axis],
          ),
        );
      }
    }
    previous = to;
  }

  const fallback = flattenCompositeShapePath(path).map(([x, y]) =>
    pointFrom<LocalPoint>(x, y),
  );
  const candidates = [
    intersections[0].filter(([x]) => x >= center[0]),
    intersections[1].filter(([, y]) => y >= center[1]),
    intersections[0].filter(([x]) => x <= center[0]),
    intersections[1].filter(([, y]) => y <= center[1]),
  ];
  const targets = [
    pointFrom<LocalPoint>(center[0] + extent, center[1]),
    pointFrom<LocalPoint>(center[0], center[1] + extent),
    pointFrom<LocalPoint>(center[0] - extent, center[1]),
    pointFrom<LocalPoint>(center[0], center[1] - extent),
  ];
  return candidates.map((points, index) => {
    const set = points.length ? points : fallback;
    const anchor = set.reduce((best, point) =>
      pointDistance(point, targets[index]) < pointDistance(best, targets[index])
        ? point
        : best,
    );
    return toGlobal(anchor);
  });
};
export const getCompositeShapeGlobalPoints = (
  element: ExcalidrawShapeElement,
): GlobalPoint[] => {
  return flattenCompositeShapePath(getCompositeShapeGlobalPath(element)).map(
    ([x, y]) => pointFrom<GlobalPoint>(x, y),
  );
};
