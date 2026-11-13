import {
  bezierEquation,
  curve,
  pointDistance,
  pointFrom,
  pointRotateRads,
  pointsEqual,
} from "@excalidraw/math";

import type { Curve, GlobalPoint, Radians } from "@excalidraw/math";

import {
  getCompositeShapeGeometry,
  getCompositeShapeGlobalPath,
  getCompositeShapeOffsetPaths,
  isActivationElement,
  isCompositeShapeOpen,
  isSequenceLifelineElement,
  isShapeElement,
} from "../compositeShape";
import { getActivationEdgeSide } from "../compositeShape/sequenceOutline";
import { pathFromPoints } from "../compositeShape/outline";
import { getMindmapNodeGeometry, getMindmapShapeId } from "../mindmap";
import { deconstructRectanguloidElement } from "../utils";

import type { ShapePoint } from "../compositeShape/outline";
import type {
  ExcalidrawBindableElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawRectanguloidElement,
  ExcalidrawSequenceElement,
  ExcalidrawShapeElement,
} from "../types";
import type { ConnectionSpec } from "./spec";
import type { ConnectionCtx, OutlinePath } from "./types";

export type ConnectionOutline = {
  /** Connectable outline O (the parts of the element outline that may bind). */
  outline: OutlinePath[];
  /** Γ: O pushed outward by `gap`. */
  inflated: OutlinePath[];
};

const KAPPA = 0.5522847498;

const elementCenter = (element: {
  x: number;
  y: number;
  width: number;
  height: number;
}): GlobalPoint =>
  pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );

/** Rotate every point of a global-but-unrotated path about the element center. */
const rotatePath = (
  path: OutlinePath,
  element: {
    x: number;
    y: number;
    width: number;
    height: number;
    angle: Radians;
  },
): OutlinePath => {
  const center = elementCenter(element);
  const map = ([x, y]: ShapePoint): ShapePoint =>
    pointRotateRads(pointFrom<GlobalPoint>(x, y), center, element.angle);
  return {
    start: map(path.start),
    commands: path.commands.map((command) =>
      command.type === "line"
        ? { type: "line", to: map(command.to) }
        : {
            type: "cubic",
            control1: map(command.control1),
            control2: map(command.control2),
            to: map(command.to),
          },
    ),
    closed: path.closed,
  };
};

const translatePath = (
  path: OutlinePath,
  dx: number,
  dy: number,
): OutlinePath => ({
  start: [path.start[0] + dx, path.start[1] + dy],
  commands: path.commands.map((command) =>
    command.type === "line"
      ? {
          type: "line",
          to: [command.to[0] + dx, command.to[1] + dy] as ShapePoint,
        }
      : {
          type: "cubic",
          control1: [
            command.control1[0] + dx,
            command.control1[1] + dy,
          ] as ShapePoint,
          control2: [
            command.control2[0] + dx,
            command.control2[1] + dy,
          ] as ShapePoint,
          to: [command.to[0] + dx, command.to[1] + dy] as ShapePoint,
        },
  ),
  closed: path.closed,
});

/**
 * Ellipse with the given (already inflated) radii, in local coordinates. Four
 * cubic segments with the standard kappa; the radial error of this
 * approximation is ~0.027% of the radius.
 */
const ellipsePath = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): OutlinePath => ({
  start: [cx + rx, cy],
  commands: [
    {
      type: "cubic",
      control1: [cx + rx, cy + KAPPA * ry],
      control2: [cx + KAPPA * rx, cy + ry],
      to: [cx, cy + ry],
    },
    {
      type: "cubic",
      control1: [cx - KAPPA * rx, cy + ry],
      control2: [cx - rx, cy + KAPPA * ry],
      to: [cx - rx, cy],
    },
    {
      type: "cubic",
      control1: [cx - rx, cy - KAPPA * ry],
      control2: [cx - KAPPA * rx, cy - ry],
      to: [cx, cy - ry],
    },
    {
      type: "cubic",
      control1: [cx + KAPPA * rx, cy - ry],
      control2: [cx + rx, cy - KAPPA * ry],
      to: [cx + rx, cy],
    },
  ],
  closed: true,
});

/**
 * Γ / outline of an ellipse element: the primitive radii plus `gap`, built in
 * local space then translated to the element origin and rotated.
 */
const buildEllipsePath = (
  element: ExcalidrawShapeElement,
  gap: number,
): OutlinePath => {
  const primitive = getCompositeShapeGeometry(element).primitive;
  if (primitive?.kind !== "ellipse") {
    throw new Error("Missing ellipse geometry");
  }
  const local = ellipsePath(
    primitive.center[0],
    primitive.center[1],
    primitive.radiusX + gap,
    primitive.radiusY + gap,
  );
  return rotatePath(translatePath(local, element.x, element.y), element);
};

/**
 * Group the flat corner-curve list returned by `deconstructRectanguloidElement`
 * into the four corners (TL, TR, BR, BL) by curve continuity.
 */
const groupCornerCurves = (
  corners: Curve<GlobalPoint>[],
): Curve<GlobalPoint>[][] => {
  const groups: Curve<GlobalPoint>[][] = [];
  for (const corner of corners) {
    const current = groups[groups.length - 1];
    if (current && pointsEqual(current[current.length - 1][3], corner[0])) {
      current.push(corner);
    } else {
      groups.push([corner]);
    }
  }
  return groups;
};

/**
 * Rectanguloid outline (sides + rounded corners) in global but unrotated
 * coordinates, via the same `deconstructRectanguloidElement` geometry used by
 * line intersection / distance.
 */
const buildRectanguloidPath = (
  element: ExcalidrawRectanguloidElement,
  gap: number,
): OutlinePath => {
  const [sides, corners] = deconstructRectanguloidElement(element, gap);
  const groups = groupCornerCurves(corners);
  const path: OutlinePath = {
    start: sides[0][0],
    commands: [],
    closed: true,
  };
  if (groups.length === 4) {
    // top, TR corner, right, BR corner, bottom, BL corner, left, TL corner
    for (let index = 0; index < 4; index++) {
      const side = sides[index];
      path.commands.push({ type: "line", to: side[1] });
      for (const corner of groups[(index + 1) % 4]) {
        path.commands.push({
          type: "cubic",
          control1: corner[1],
          control2: corner[2],
          to: corner[3],
        });
      }
    }
  } else {
    // Unexpected grouping (degenerate shape): keep the sides and append every
    // corner curve in order; still a valid closed approximation.
    for (let index = 0; index < 4; index++) {
      path.commands.push({ type: "line", to: sides[index][1] });
    }
    for (const corner of corners) {
      path.commands.push({
        type: "cubic",
        control1: corner[1],
        control2: corner[2],
        to: corner[3],
      });
    }
  }
  return rotatePath(path, element);
};

const buildBBoxPath = (element: {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: Radians;
}): OutlinePath => {
  const path = pathFromPoints(
    [
      [element.x, element.y],
      [element.x + element.width, element.y],
      [element.x + element.width, element.y + element.height],
      [element.x, element.y + element.height],
    ],
    true,
  );
  return rotatePath(path, element);
};

const offsetPaths = (
  element: ExcalidrawShapeElement,
  gap: number,
): OutlinePath[] =>
  getCompositeShapeOffsetPaths(element, gap).map((points) =>
    pathFromPoints(points, true),
  );

const buildCompositePaths = (
  element: ExcalidrawShapeElement,
  gap: number,
): OutlinePath[] => {
  // Open paths (braces) must not be inflated beyond themselves.
  if (isCompositeShapeOpen(element.shape.id)) {
    return [getCompositeShapeGlobalPath(element)];
  }
  return offsetPaths(element, gap);
};

const buildMindmapNodePaths = (
  node: ExcalidrawMindmapNodeElement,
  gap: number,
): OutlinePath[] => {
  // The pill's roundness only exists on the node itself (the derived geometry
  // is a plain rectangle), so deconstruct the node directly for it.
  if (getMindmapShapeId(node) === "pill") {
    return [buildRectanguloidPath(node, gap)];
  }
  const geometry = getMindmapNodeGeometry(node);
  if (geometry.shape.id === "ellipse") {
    return [buildEllipsePath(geometry, gap)];
  }
  if (geometry.shape.id === "diamond") {
    return offsetPaths(geometry, gap);
  }
  return [buildRectanguloidPath(geometry, gap)];
};

const activationSides = (
  element: ExcalidrawSequenceElement,
  ctx: ConnectionCtx,
): Array<"left" | "right"> => {
  if (ctx.reference) {
    return [getActivationEdgeSide(element, ctx.reference, ctx.reference)];
  }
  return ["left", "right"];
};

/**
 * Activation bar: the vertical edge(s) facing the reference. The edge y range
 * is clamped to `[1, height - 1]`, matching `getActivationBindingPoint`; the
 * inflated edge is pushed outward by `gap` in the element-local x direction
 * (then rotated).
 */
const buildActivationPaths = (
  element: ExcalidrawSequenceElement,
  gap: number,
  ctx: ConnectionCtx,
): OutlinePath[] => {
  const top = Math.min(1, element.height / 2);
  const bottom = Math.max(element.height - 1, top);
  const center = elementCenter(element);
  return activationSides(element, ctx).map((side) => {
    const outward = side === "right" ? gap : -gap;
    const localX = (side === "right" ? element.width : 0) + outward;
    const toGlobal = (localY: number) =>
      pointRotateRads(
        pointFrom<GlobalPoint>(element.x + localX, element.y + localY),
        center,
        element.angle,
      );
    return pathFromPoints([toGlobal(top), toGlobal(bottom)], false);
  });
};

/**
 * Build the connectable outline / inflated outline paths for an element at the
 * given gap. The same dispatch serves both O (`gap = 0`) and Γ, so both come
 * from the same source geometry.
 */
export const buildConnectionPaths = (
  element: ExcalidrawBindableElement,
  gap: number,
  ctx: ConnectionCtx,
): OutlinePath[] => {
  if (isSequenceLifelineElement(element)) {
    return [];
  }
  if (isActivationElement(element)) {
    return buildActivationPaths(element, gap, ctx);
  }
  if (element.type === "mindmap-node") {
    return buildMindmapNodePaths(element, gap);
  }
  if (isShapeElement(element)) {
    if (element.shape.id === "ellipse") {
      return [buildEllipsePath(element, gap)];
    }
    if (element.shape.id === "diamond") {
      return offsetPaths(element, gap);
    }
    if (element.shape.id === "rectangle") {
      return [buildRectanguloidPath(element, gap)];
    }
    return buildCompositePaths(element, gap);
  }
  if (element.type === "text") {
    return [buildBBoxPath(element)];
  }
  return [buildRectanguloidPath(element, gap)];
};

export const buildConnectionOutline = (
  element: ExcalidrawBindableElement,
  gap: number,
  spec: ConnectionSpec,
  ctx: ConnectionCtx,
): ConnectionOutline => {
  // Text never has a projection gap (`getProjectionBindingGap` returns 0).
  const effectiveGap = element.type === "text" ? 0 : gap;
  return {
    outline: spec.connectableOutline(element, ctx),
    inflated: buildConnectionPaths(element, effectiveGap, ctx),
  };
};

const projectOnLineSegment = (
  point: GlobalPoint,
  start: GlobalPoint,
  end: GlobalPoint,
): GlobalPoint => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return start;
  }
  const t =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return pointFrom<GlobalPoint>(
    start[0] + clamped * dx,
    start[1] + clamped * dy,
  );
};

/** Nearest point on a cubic: dense sampling + ternary refinement. */
const nearestOnCubic = (
  point: GlobalPoint,
  cubic: Curve<GlobalPoint>,
  steps: number,
): GlobalPoint => {
  let bestT = 0;
  let bestPoint = cubic[0];
  let bestDistance = pointDistance(point, cubic[0]);
  for (let index = 1; index <= steps; index++) {
    const t = index / steps;
    const candidate = bezierEquation(cubic, t);
    const distance = pointDistance(point, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
      bestPoint = candidate;
    }
  }
  let low = Math.max(0, bestT - 1 / steps);
  let high = Math.min(1, bestT + 1 / steps);
  for (let iteration = 0; iteration < 40; iteration++) {
    const first = low + (high - low) / 3;
    const second = high - (high - low) / 3;
    const firstDistance = pointDistance(point, bezierEquation(cubic, first));
    const secondDistance = pointDistance(point, bezierEquation(cubic, second));
    if (firstDistance <= secondDistance) {
      high = second;
    } else {
      low = first;
    }
  }
  const refined = bezierEquation(cubic, (low + high) / 2);
  return pointDistance(point, refined) < bestDistance ? refined : bestPoint;
};

export const nearestPointOnOutline = (
  paths: OutlinePath[],
  point: GlobalPoint,
  opts: { zoom: number },
): { point: GlobalPoint; distance: number; pathIndex: number } => {
  const zoom = opts.zoom > 0 ? opts.zoom : 1;
  let bestPoint = point;
  let bestDistance = Infinity;
  let bestPathIndex = -1;
  paths.forEach((path, pathIndex) => {
    let previous = pointFrom<GlobalPoint>(...path.start);
    const commands = [
      ...path.commands,
      ...(path.closed ? [{ type: "line" as const, to: path.start }] : []),
    ];
    for (const command of commands) {
      const end = pointFrom<GlobalPoint>(...command.to);
      let candidate: GlobalPoint;
      if (command.type === "line") {
        candidate = projectOnLineSegment(point, previous, end);
      } else {
        const cubic = curve(
          previous,
          pointFrom<GlobalPoint>(...command.control1),
          pointFrom<GlobalPoint>(...command.control2),
          end,
        );
        const chordLength = pointDistance(previous, end);
        const steps = Math.max(16, Math.ceil((chordLength * zoom) / 4));
        candidate = nearestOnCubic(point, cubic, steps);
      }
      const distance = pointDistance(point, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPoint = candidate;
        bestPathIndex = pathIndex;
      }
      previous = end;
    }
  });
  return { point: bestPoint, distance: bestDistance, pathIndex: bestPathIndex };
};
