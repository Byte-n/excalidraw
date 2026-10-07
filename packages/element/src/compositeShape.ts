import {
  assertNever,
  DEFAULT_ADAPTIVE_RADIUS,
  DEFAULT_PROPORTIONAL_RADIUS,
  ROUNDNESS,
} from "@excalidraw/common";

import ClipperLib from "clipper-lib";
import {
  bezierEquation,
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

import type {
  BaseShapeData,
  BaseShapeId,
  ExcalidrawCompositeShapeElement,
  ExcalidrawElement,
} from "./types";

export type { BaseShapeId } from "./types";

export const BASE_SHAPE_IDS: readonly BaseShapeId[] = [
  "rectangle",
  "diamond",
  "ellipse",
  "cross",
  "brace-reverse",
  "brace",
  "cloud",
  "double-arrow",
  "forward-arrow",
  "backward-arrow",
  "octagon",
  "pentagon",
  "hexagon",
  "star",
  "triangle",
  "round-rect",
  "rectangle-bubble",
  "pill",
  "bubble",
  "trapezoid",
  "parallelogram",
  "right-pentagon",
  "step",
  "cube",
  "cylinder",
  "pie",
  "circular-ring",
] as const;

export const isBaseShapeId = (id: unknown): id is BaseShapeId =>
  typeof id === "string" && (BASE_SHAPE_IDS as readonly string[]).includes(id);

export const CUBE_CONTROL_POINT_MIN = 0.05;
export const CUBE_CONTROL_POINT_MAX = 0.95;

const TEXT_GAP = 2;

const clampValue = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const sameControlValue = (a: number, b: number) => Math.abs(a - b) < 1e-12;

const normalizeDegrees = (degrees: number) => {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const getCircularShapeRadius = (
  width: number,
  height: number,
  radius: number,
) => Math.min(width, height) * radius;

const getCircularControlPoint = (
  width: number,
  height: number,
  radius: number,
  angle: number,
) => {
  const actualRadius = getCircularShapeRadius(width, height, radius);
  const radians = (angle * Math.PI) / 180;
  return {
    x: width / 2 + Math.cos(radians) * actualRadius,
    y: height / 2 + Math.sin(radians) * actualRadius,
  };
};

export type CompositeShapeControlPoint = {
  kind:
    | "triangle-apex"
    | "trapezoid-width"
    | "cube-depth"
    | "sector-start"
    | "sector-end"
    | "ring-radius";
  x: number;
  y: number;
};

export const getCompositeShapeControlPoints = (
  element: Pick<ExcalidrawCompositeShapeElement, "width" | "height" | "shape">,
): CompositeShapeControlPoint[] => {
  const { width, height, shape } = element;
  switch (shape.id) {
    case "triangle":
      return [{ kind: "triangle-apex", x: shape.triangle.apexX * width, y: 0 }];
    case "trapezoid":
      return [
        {
          kind: "trapezoid-width",
          x: width / 2 + (shape.trapezoid.narrowWidthRatio * width) / 2,
          y: shape.trapezoid.narrowEdge === "top" ? 0 : height,
        },
      ];
    case "cube":
      return [
        {
          kind: "cube-depth",
          x: shape.cube.controlPoint.x * width,
          y: shape.cube.controlPoint.y * height,
        },
      ];
    case "pie":
    case "circular-ring": {
      const data = shape.id === "pie" ? shape.pie : shape.circularRing;
      const points: CompositeShapeControlPoint[] = [
        {
          kind: "sector-start",
          ...getCircularControlPoint(
            width,
            height,
            data.radius,
            data.startRadialLineAngle,
          ),
        },
        {
          kind: "sector-end",
          ...getCircularControlPoint(
            width,
            height,
            data.radius,
            data.startRadialLineAngle + data.centralAngle,
          ),
        },
      ];
      if (shape.id === "circular-ring") {
        points.push({
          kind: "ring-radius",
          ...getCircularControlPoint(
            width,
            height,
            data.radius * data.sectorRatio,
            data.startRadialLineAngle,
          ),
        });
      }
      return points;
    }
    default:
      return [];
  }
};

export const updateCompositeShapeControlPoint = (
  shape: BaseShapeData,
  kind: CompositeShapeControlPoint["kind"],
  localX: number,
  localY: number,
  width: number,
  height: number,
): BaseShapeData => {
  if (
    ![localX, localY, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Invalid composite shape control coordinates");
  }
  switch (kind) {
    case "triangle-apex":
      if (shape.id === "triangle") {
        const apexX = clampValue(localX / width, 0, 1);
        if (sameControlValue(apexX, shape.triangle.apexX)) {
          return shape;
        }
        return {
          ...shape,
          triangle: { apexX },
        };
      }
      break;
    case "trapezoid-width":
      if (shape.id === "trapezoid") {
        const narrowWidthRatio = clampValue(
          (localX - width / 2) / (width / 2),
          0.05,
          1,
        );
        if (
          sameControlValue(narrowWidthRatio, shape.trapezoid.narrowWidthRatio)
        ) {
          return shape;
        }
        return {
          ...shape,
          trapezoid: {
            ...shape.trapezoid,
            narrowWidthRatio,
          },
        };
      }
      break;
    case "cube-depth":
      if (shape.id === "cube") {
        const x = clampValue(
          localX / width,
          CUBE_CONTROL_POINT_MIN,
          CUBE_CONTROL_POINT_MAX,
        );
        const y = clampValue(
          localY / height,
          CUBE_CONTROL_POINT_MIN,
          CUBE_CONTROL_POINT_MAX,
        );
        if (
          sameControlValue(x, shape.cube.controlPoint.x) &&
          sameControlValue(y, shape.cube.controlPoint.y)
        ) {
          return shape;
        }
        return {
          ...shape,
          cube: {
            controlPoint: { x, y },
          },
        };
      }
      break;
    case "sector-start":
    case "sector-end":
    case "ring-radius": {
      if (shape.id !== "pie" && shape.id !== "circular-ring") {
        break;
      }
      const data = shape.id === "pie" ? shape.pie : shape.circularRing;
      const centerX = width / 2;
      const centerY = height / 2;
      const dx = localX - centerX;
      const dy = localY - centerY;
      const distance = Math.hypot(dx, dy);
      if (distance <= 1e-6) {
        break;
      }
      if (kind === "ring-radius" && shape.id === "circular-ring") {
        const sectorRatio = clampValue(
          distance / getCircularShapeRadius(width, height, data.radius),
          0,
          1,
        );
        if (sameControlValue(sectorRatio, shape.circularRing.sectorRatio)) {
          return shape;
        }
        return {
          ...shape,
          circularRing: { ...shape.circularRing, sectorRatio },
        };
      }
      const angle = normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
      const radius = clampValue(distance / Math.min(width, height), 0.01, 0.5);
      const startAngle =
        kind === "sector-start" ? angle : data.startRadialLineAngle;
      const endAngle =
        kind === "sector-end" ? angle : startAngle + data.centralAngle;
      const centralAngle =
        kind === "sector-start" && data.centralAngle >= 360 - 1e-6
          ? 360
          : clampValue(normalizeDegrees(endAngle - startAngle), 0.01, 360);
      const nextData = {
        ...data,
        radius,
        centralAngle,
        startRadialLineAngle: startAngle,
      };
      return shape.id === "pie"
        ? { ...shape, pie: nextData }
        : { ...shape, circularRing: nextData };
    }
  }
  throw new Error(`Control point ${kind} does not belong to ${shape.id}`);
};

export const baseShapeData = (id: BaseShapeId): BaseShapeData => {
  switch (id) {
    case "triangle":
      return { id, schemaVersion: 1, triangle: { apexX: 0.5 } };
    case "trapezoid":
      return {
        id,
        schemaVersion: 1,
        trapezoid: { narrowWidthRatio: 2 / 3, narrowEdge: "top" },
      };
    case "cube":
      return {
        id,
        schemaVersion: 1,
        cube: { controlPoint: { x: 0.82, y: 0.22 } },
      };
    case "pie":
      return {
        id,
        schemaVersion: 1,
        pie: {
          centralAngle: 270,
          radius: 0.5,
          sectorRatio: 1,
          startRadialLineAngle: 270,
        },
      };
    case "circular-ring":
      return {
        id,
        schemaVersion: 1,
        circularRing: {
          centralAngle: 270,
          radius: 0.5,
          sectorRatio: 0.5,
          startRadialLineAngle: 270,
        },
      };
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "cross":
    case "brace-reverse":
    case "brace":
    case "cloud":
    case "double-arrow":
    case "forward-arrow":
    case "backward-arrow":
    case "octagon":
    case "pentagon":
    case "hexagon":
    case "star":
    case "round-rect":
    case "rectangle-bubble":
    case "pill":
    case "bubble":
    case "parallelogram":
    case "right-pentagon":
    case "step":
    case "cylinder":
      return { id, schemaVersion: 1 };
    default:
      return assertNever(id, "Unsupported composite shape");
  }
};

const isFiniteInRange = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

const hasOnlyKeys = (value: object, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, i) => key === expected[i])
  );
};

/** Validates persisted shape data at file, library and clipboard boundaries. */
export const assertBaseShapeData = (shape: unknown): BaseShapeData => {
  if (!shape || typeof shape !== "object") {
    throw new Error(
      `Unsupported composite shape data: ${JSON.stringify(shape)}`,
    );
  }
  const value = shape as Record<string, unknown>;
  const id = value.id;
  if (!isBaseShapeId(id) || value.schemaVersion !== 1) {
    throw new Error(
      `Unsupported composite shape data: ${JSON.stringify(shape)}`,
    );
  }
  const parameterized =
    id === "triangle" ||
    id === "trapezoid" ||
    id === "cube" ||
    id === "pie" ||
    id === "circular-ring";
  const parameterKey = id === "circular-ring" ? "circularRing" : id;
  let valid = hasOnlyKeys(
    value,
    parameterized
      ? ["id", "schemaVersion", parameterKey]
      : ["id", "schemaVersion"],
  );
  if (id === "triangle") {
    const data = value.triangle as Record<string, unknown> | undefined;
    valid =
      !!data &&
      valid &&
      hasOnlyKeys(data, ["apexX"]) &&
      isFiniteInRange(data.apexX, 0, 1);
  } else if (id === "trapezoid") {
    const data = value.trapezoid as Record<string, unknown> | undefined;
    valid =
      !!data &&
      valid &&
      hasOnlyKeys(data, ["narrowWidthRatio", "narrowEdge"]) &&
      isFiniteInRange(data.narrowWidthRatio, 0.05, 1) &&
      (data.narrowEdge === "top" || data.narrowEdge === "bottom");
  } else if (id === "cube") {
    const data = value.cube as Record<string, unknown> | undefined;
    const controlPoint = data?.controlPoint as
      | Record<string, unknown>
      | undefined;
    valid =
      !!data &&
      !!controlPoint &&
      valid &&
      hasOnlyKeys(data, ["controlPoint"]) &&
      hasOnlyKeys(controlPoint, ["x", "y"]) &&
      isFiniteInRange(
        controlPoint.x,
        CUBE_CONTROL_POINT_MIN,
        CUBE_CONTROL_POINT_MAX,
      ) &&
      isFiniteInRange(
        controlPoint.y,
        CUBE_CONTROL_POINT_MIN,
        CUBE_CONTROL_POINT_MAX,
      );
  } else if (id === "pie" || id === "circular-ring") {
    const key = id === "pie" ? "pie" : "circularRing";
    const data = value[key] as Record<string, unknown> | undefined;
    valid =
      !!data &&
      valid &&
      hasOnlyKeys(data, [
        "centralAngle",
        "radius",
        "sectorRatio",
        "startRadialLineAngle",
      ]) &&
      isFiniteInRange(data.centralAngle, 0.01, 360) &&
      isFiniteInRange(data.radius, 0.01, 1e6) &&
      isFiniteInRange(data.sectorRatio, 0, 1) &&
      isFiniteInRange(data.startRadialLineAngle, -360, 360);
  }
  if (!valid) {
    throw new Error(
      `Unsupported composite shape data: ${JSON.stringify(shape)}`,
    );
  }
  return shape as BaseShapeData;
};

export const isCompositeShapeElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): element is T & ExcalidrawCompositeShapeElement =>
  element?.type === "composite_shape";

export const isCompositeShapeId = <K extends BaseShapeId>(
  element: ExcalidrawElement | null | undefined,
  id: K,
): element is ExcalidrawCompositeShapeElement & {
  shape: Extract<BaseShapeData, { id: K }>;
} => isCompositeShapeElement(element) && element.shape.id === id;

export const isCompositeShapeIdIn = <K extends BaseShapeId>(
  element: ExcalidrawElement | null | undefined,
  ids: readonly K[],
): element is ExcalidrawCompositeShapeElement & {
  shape: Extract<BaseShapeData, { id: K }>;
} =>
  isCompositeShapeElement(element) && ids.some((id) => id === element.shape.id);

const regularPolygon = (
  sides: number,
  width: number,
  height: number,
  rotation = -Math.PI / 2,
) =>
  Array.from({ length: sides }, (_, i) => {
    const angle = rotation + (i * Math.PI * 2) / sides;
    return [
      width / 2 + (width / 2) * Math.cos(angle),
      height / 2 + (height / 2) * Math.sin(angle),
    ] as [number, number];
  });

/** Deterministic local-coordinate outline for every composite shape. */
export const getCompositeShapePoints = (
  element: CompositeShapeGeometryInput,
): [number, number][] => {
  const { width: w, height: h } = element;
  switch (element.shape.id) {
    case "rectangle":
    case "diamond":
    case "ellipse":
      return flattenCompositeShapePath(
        getCompositeShapeGeometry(element).outline,
      );
    case "cross":
      return flattenCompositeShapePath(getCrossOutline(w, h));
    case "forward-arrow":
      return [
        [0, h * 0.28],
        [w * 0.62, h * 0.28],
        [w * 0.62, 0],
        [w, h / 2],
        [w * 0.62, h],
        [w * 0.62, h * 0.72],
        [0, h * 0.72],
      ];
    case "backward-arrow":
      return [
        [w, h * 0.28],
        [w * 0.38, h * 0.28],
        [w * 0.38, 0],
        [0, h / 2],
        [w * 0.38, h],
        [w * 0.38, h * 0.72],
        [w, h * 0.72],
      ];
    case "double-arrow":
      return [
        [0, h / 2],
        [w * 0.22, 0],
        [w * 0.22, h * 0.28],
        [w * 0.78, h * 0.28],
        [w * 0.78, 0],
        [w, h / 2],
        [w * 0.78, h],
        [w * 0.78, h * 0.72],
        [w * 0.22, h * 0.72],
        [w * 0.22, h],
      ];
    case "pentagon":
      return regularPolygon(5, w, h);
    case "hexagon":
      return regularPolygon(6, w, h, 0);
    case "octagon":
      return regularPolygon(8, w, h, -Math.PI / 8);
    case "star":
      return flattenCompositeShapePath(getStarOutline(w, h));
    case "triangle": {
      const apexX = element.shape.triangle.apexX * w;
      return [
        [apexX, 0],
        [w, h],
        [0, h],
      ];
    }
    case "round-rect":
      return flattenCompositeShapePath(
        getRoundedRectOutline(w, h, Math.min(w, h) * 0.18),
      );
    case "pill":
      return flattenCompositeShapePath(
        getRoundedRectOutline(w, h, Math.min(w, h) / 2),
      );
    case "rectangle-bubble":
      return flattenCompositeShapePath(getRectangleBubbleOutline(w, h));
    case "bubble": {
      return flattenCompositeShapePath(getBubbleOutline(w, h));
    }
    case "trapezoid": {
      const ratio = element.shape.trapezoid.narrowWidthRatio;
      const narrow = (w * ratio) / 2;
      return element.shape.trapezoid.narrowEdge === "top"
        ? [
            [w / 2 - narrow, 0],
            [w / 2 + narrow, 0],
            [w, h],
            [0, h],
          ]
        : [
            [0, 0],
            [w, 0],
            [w / 2 + narrow, h],
            [w / 2 - narrow, h],
          ];
    }
    case "parallelogram": {
      const skew = w * 0.18;
      return [
        [skew, 0],
        [w, 0],
        [w - skew, h],
        [0, h],
      ];
    }
    case "right-pentagon":
      return [
        [0, 0],
        [w * 0.65, 0],
        [w, h / 2],
        [w * 0.65, h],
        [0, h],
      ];
    case "step":
      return [
        [0, 0],
        [w * 0.62, 0],
        [w, h / 2],
        [w * 0.62, h],
        [0, h],
        [w * 0.2, h * 0.5],
      ];
    case "cloud":
      return flattenCompositeShapePath(getCloudOutline(w, h));
    case "brace":
      return flattenCompositeShapePath(getBraceOutline(w, h, false));
    case "brace-reverse":
      return flattenCompositeShapePath(getBraceOutline(w, h, true));
    case "cylinder": {
      return flattenCompositeShapePath(getCylinderOutline(w, h));
    }
    case "cube": {
      const frontRightX = w * element.shape.cube.controlPoint.x;
      const depthX = w - frontRightX;
      const depthY = h * element.shape.cube.controlPoint.y;
      return [
        [0, depthY],
        [depthX, 0],
        [w, 0],
        [w, h - depthY],
        [frontRightX, h],
        [0, h],
      ];
    }
    case "pie":
      return flattenCompositeShapePath(
        getCircularSectorOutline(w, h, element.shape.pie, false),
      );
    case "circular-ring":
      return flattenCompositeShapePath(
        getCircularSectorOutline(w, h, element.shape.circularRing, true),
      );
    default:
      return assertNever(element.shape, "Unsupported composite shape");
  }
};

export type CompositeShapeTextBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CompositeShapeTextFitMode = "auto" | "fixed";

const insetRect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): CompositeShapeTextBounds => ({
  x: left,
  y: top,
  width: Math.max(0.01, right - left),
  height: Math.max(0.01, bottom - top),
});

/** Maximize a centered rectangle under the inset half-plane of each convex edge. */
const getConvexTextBounds = (
  points: ShapePoint[],
  width: number,
  height: number,
): CompositeShapeTextBounds => {
  const centerX = width / 2;
  const centerY = height / 2;
  const constraints = points.map(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const normalX = dy;
    const normalY = -dx;
    const sign =
      normalX * (centerX - x1) + normalY * (centerY - y1) > 0 ? -1 : 1;
    return {
      x: Math.abs(normalX),
      y: Math.abs(normalY),
      limit:
        sign * (normalX * (x1 - centerX) + normalY * (y1 - centerY)) -
        TEXT_GAP * Math.hypot(dx, dy),
    };
  });
  let halfWidth = 0;
  let halfHeight = 0;
  const consider = (x: number, y: number) => {
    if (
      x >= 0 &&
      y >= 0 &&
      constraints.every(
        (edge) => edge.x * x + edge.y * y <= edge.limit + 1e-7,
      ) &&
      x * y > halfWidth * halfHeight
    ) {
      halfWidth = x;
      halfHeight = y;
    }
  };
  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const a = constraints[i];
      const b = constraints[j];
      const determinant = a.x * b.y - b.x * a.y;
      if (Math.abs(determinant) > 1e-9) {
        consider(
          (a.limit * b.y - b.limit * a.y) / determinant,
          (a.x * b.limit - b.x * a.limit) / determinant,
        );
      }
    }
  }
  // The area maximum can also lie in the middle of a single active edge.
  for (const edge of constraints) {
    if (edge.x > 0 && edge.y > 0) {
      consider(edge.limit / (2 * edge.x), edge.limit / (2 * edge.y));
    }
  }
  return insetRect(
    centerX - halfWidth,
    centerY - halfHeight,
    centerX + halfWidth,
    centerY + halfHeight,
  );
};

export const getCompositeShapeTextFitMode = (
  element: Pick<ExcalidrawCompositeShapeElement, "textFitMode">,
): CompositeShapeTextFitMode => element.textFitMode ?? "auto";

export const getCompositeShapeTextFitMinSize = (
  element: Pick<
    ExcalidrawCompositeShapeElement,
    "width" | "height" | "textFitMinWidth" | "textFitMinHeight"
  >,
) => ({
  width:
    Number.isFinite(element.textFitMinWidth) && element.textFitMinWidth! > 0
      ? element.textFitMinWidth!
      : element.width,
  height:
    Number.isFinite(element.textFitMinHeight) && element.textFitMinHeight! > 0
      ? element.textFitMinHeight!
      : element.height,
});

/** A local rectangle that stays inside the visible body, before text padding. */
export const getCompositeShapeTextBounds = (
  element: Pick<ExcalidrawCompositeShapeElement, "width" | "height" | "shape">,
): CompositeShapeTextBounds => {
  const { width: w, height: h, shape } = element;
  switch (shape.id) {
    case "rectangle":
      return insetRect(TEXT_GAP, TEXT_GAP, w - TEXT_GAP, h - TEXT_GAP);
    case "octagon":
    case "pentagon":
    case "hexagon":
    case "parallelogram":
      return getConvexTextBounds(getCompositeShapePoints(element), w, h);
    case "trapezoid": {
      const halfInset = (w * (1 - shape.trapezoid.narrowWidthRatio)) / 2;
      const sideGap = TEXT_GAP * Math.hypot(1, halfInset / h);
      const distanceFromNarrowEdge =
        halfInset === 0
          ? TEXT_GAP
          : clampValue(
              ((2 * halfInset * (h - TEXT_GAP)) / h -
                w * shape.trapezoid.narrowWidthRatio +
                2 * sideGap) *
                (h / (4 * halfInset)),
              TEXT_GAP,
              Math.max(TEXT_GAP, h - TEXT_GAP),
            );
      const left = halfInset * (1 - distanceFromNarrowEdge / h) + sideGap;
      const top =
        shape.trapezoid.narrowEdge === "top"
          ? distanceFromNarrowEdge
          : TEXT_GAP;
      const bottom =
        shape.trapezoid.narrowEdge === "top"
          ? h - TEXT_GAP
          : h - distanceFromNarrowEdge;
      return insetRect(left, top, w - left, bottom);
    }
    case "right-pentagon":
      return insetRect(TEXT_GAP, TEXT_GAP, w * 0.65 - TEXT_GAP, h - TEXT_GAP);
    case "diamond": {
      const normal = Math.hypot(1 / w, 1 / h);
      const scale = Math.max(0.01, 0.5 - TEXT_GAP * normal);
      return insetRect(
        (w * (1 - scale)) / 2,
        (h * (1 - scale)) / 2,
        (w * (1 + scale)) / 2,
        (h * (1 + scale)) / 2,
      );
    }
    case "triangle": {
      const top = Math.min(h - TEXT_GAP, h * 0.55);
      const left = shape.triangle.apexX * (1 - top / h) + TEXT_GAP / w;
      return insetRect(
        left * w,
        top,
        Math.min(w - TEXT_GAP, (left + top / h - 0.08) * w),
        h - TEXT_GAP,
      );
    }
    case "ellipse": {
      const halfWidth = Math.max(0.005, (w / 2 - TEXT_GAP) / Math.SQRT2);
      const halfHeight = Math.max(0.005, (h / 2 - TEXT_GAP) / Math.SQRT2);
      return insetRect(
        w / 2 - halfWidth,
        h / 2 - halfHeight,
        w / 2 + halfWidth,
        h / 2 + halfHeight,
      );
    }
    case "pie": {
      const side = Math.max(TEXT_GAP * 2, Math.min(w, h) * 0.42);
      return insetRect(
        (w - side) / 2,
        (h - side) / 2,
        (w + side) / 2,
        (h + side) / 2,
      );
    }
    case "circular-ring": {
      const radius = Math.min(w, h) / 2;
      const innerRadius =
        radius * clampValue(shape.circularRing.sectorRatio, 0, 1);
      const side = Math.max(TEXT_GAP * 2, (radius - innerRadius) * 0.8);
      return insetRect(
        (w - side) / 2,
        (h - side) / 2,
        (w + side) / 2,
        (h + side) / 2,
      );
    }
    case "round-rect":
    case "pill":
    case "rectangle-bubble": {
      const bodyHeight = shape.id === "rectangle-bubble" ? h * 0.84 : h;
      const radius =
        shape.id === "pill"
          ? Math.min(w, h) / 2
          : Math.min(w, bodyHeight) * (shape.id === "round-rect" ? 0.18 : 0.08);
      const corner = Math.max(0, radius - TEXT_GAP) / Math.SQRT2;
      return insetRect(
        radius - corner,
        radius - corner,
        w - radius + corner,
        bodyHeight - radius + corner,
      );
    }
    case "cross": {
      const inset = 33.241798 / 120;
      return insetRect(inset * w, inset * h, (1 - inset) * w, (1 - inset) * h);
    }
    case "forward-arrow": {
      const top = h * 0.28 + TEXT_GAP;
      const slope = (0.76 * w) / h;
      return insetRect(
        TEXT_GAP,
        top,
        w * 0.62 + slope * top - TEXT_GAP * Math.hypot(1, slope),
        h * 0.72 - TEXT_GAP,
      );
    }
    case "backward-arrow": {
      const top = h * 0.28 + TEXT_GAP;
      const slope = (0.76 * w) / h;
      return insetRect(
        w * 0.38 - slope * top + TEXT_GAP * Math.hypot(1, slope),
        top,
        w - TEXT_GAP,
        h * 0.72 - TEXT_GAP,
      );
    }
    case "double-arrow": {
      const top = h * 0.28 + TEXT_GAP;
      const slope = (0.44 * w) / h;
      const horizontalGap = TEXT_GAP * Math.hypot(1, slope);
      return insetRect(
        w * 0.22 - slope * top + horizontalGap,
        top,
        w * 0.78 + slope * top - horizontalGap,
        h * 0.72 - TEXT_GAP,
      );
    }
    case "star": {
      const sx = w / 104;
      const sy = h / 100;
      const left = 24.8 * sx + TEXT_GAP;
      const right = 79.5 * sx - TEXT_GAP;
      const leftSlope =
        ((32.069168 - 37.05859) * sy) / ((34.493912 - 1.07729793) * sx);
      const rightSlope =
        ((36.88018 - 31.777708) * sy) / ((102.622231 - 69.326935) * sx);
      const leftTop = 37.05859 * sy + leftSlope * (left - 1.07729793 * sx);
      const rightTop = 31.777708 * sy + rightSlope * (right - 69.326935 * sx);
      const top = Math.max(
        leftTop + TEXT_GAP * Math.hypot(1, leftSlope),
        rightTop + TEXT_GAP * Math.hypot(1, rightSlope),
      );
      return insetRect(left, top, right, 84.5 * sy - TEXT_GAP);
    }
    case "step": {
      const slope = (0.76 * w) / h;
      return insetRect(
        w * 0.2 + TEXT_GAP,
        TEXT_GAP,
        w * 0.62 + slope * TEXT_GAP - TEXT_GAP * Math.hypot(1, slope),
        h - TEXT_GAP,
      );
    }
    case "cloud":
      return insetRect(
        w * 0.16 + TEXT_GAP,
        h * 0.18 + TEXT_GAP,
        w * 0.84 - TEXT_GAP,
        h * 0.79 - TEXT_GAP,
      );
    case "bubble":
      return insetRect(
        w * 0.16 + TEXT_GAP,
        h * 0.18 + TEXT_GAP,
        w * 0.84 - TEXT_GAP,
        h * 0.87 - TEXT_GAP,
      );
    case "brace":
    case "brace-reverse": {
      const scale = Math.min(
        h / BRACE_REFERENCE_HEIGHT,
        w / BRACE_REFERENCE_WIDTH,
      );
      return shape.id === "brace"
        ? insetRect(
            22.647699 * scale + TEXT_GAP,
            TEXT_GAP,
            w - TEXT_GAP,
            h - TEXT_GAP,
          )
        : insetRect(
            TEXT_GAP,
            TEXT_GAP,
            w - 22.647705 * scale - TEXT_GAP,
            h - TEXT_GAP,
          );
    }
    case "cube": {
      const frontRightX = shape.cube.controlPoint.x * w;
      const top = shape.cube.controlPoint.y * h;
      const frontHeight = h - top;
      return {
        x: TEXT_GAP,
        y: top + TEXT_GAP,
        width: Math.max(0.01, frontRightX - TEXT_GAP * 2),
        height: Math.max(0.01, frontHeight - TEXT_GAP * 2),
      };
    }
    case "cylinder": {
      const ry = Math.min(w * 0.2, h / 4);
      const inset = Math.max(TEXT_GAP, Math.min(w, ry) * 0.08);
      return insetRect(inset, 2 * ry + TEXT_GAP, w - inset, h - ry - TEXT_GAP);
    }
    default:
      return assertNever(shape, "Unsupported composite shape text bounds");
  }
};

/**
 * The actual content rectangle used by text layout. Keep this as the single
 * source of truth for both forward (shape -> text area) and reverse (text area
 * -> shape size) calculations.
 */
export const getCompositeShapePaddedTextBounds = (
  element: Pick<ExcalidrawCompositeShapeElement, "width" | "height" | "shape">,
): CompositeShapeTextBounds => {
  return getCompositeShapeTextBounds(element);
};

type CompositeShapeDimension = "width" | "height";

const getCompositeShapeSizeAt = (
  element: Pick<ExcalidrawCompositeShapeElement, "width" | "height" | "shape">,
  dimension: CompositeShapeDimension,
  value: number,
) =>
  getCompositeShapePaddedTextBounds({
    ...element,
    [dimension]: value,
  } as Pick<ExcalidrawCompositeShapeElement, "width" | "height" | "shape">);

const solveCompositeShapeDimension = (
  element: Pick<ExcalidrawCompositeShapeElement, "width" | "height" | "shape">,
  dimension: CompositeShapeDimension,
  required: number,
  minimum: number,
) => {
  if (!Number.isFinite(required) || required <= 0) {
    return Math.max(minimum, element[dimension]);
  }
  const areaDimension = dimension;
  const current = Math.max(0.01, element[dimension]);
  let low = Math.max(0.01, minimum);
  let high = Math.max(current, low);
  const fits = (value: number) =>
    getCompositeShapeSizeAt(element, areaDimension, value)[areaDimension] >=
    required;

  if (fits(low)) {
    return low;
  }
  while (!fits(high) && high < 1_000_000) {
    high *= 2;
  }
  if (!fits(high)) {
    return high;
  }
  for (let i = 0; i < 28; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
};

/**
 * Returns dimensions whose forward safe area can contain the requested text.
 * The alternating solves handle shapes whose safe area depends on both axes
 * (for example cylinder and brace) without using shape-specific inverses.
 */
export const getCompositeShapeDimensionsForText = (
  element: Pick<
    ExcalidrawCompositeShapeElement,
    "width" | "height" | "shape" | "textFitMinWidth" | "textFitMinHeight"
  >,
  textWidth: number,
  textHeight: number,
) => {
  const minimum = getCompositeShapeTextFitMinSize(element);
  let width = Math.max(0.01, minimum.width);
  let height = Math.max(0.01, minimum.height);
  const shape = { ...element, width, height };
  for (let i = 0; i < 20; i++) {
    width = solveCompositeShapeDimension(
      { ...shape, width, height },
      "width",
      textWidth,
      minimum.width,
    );
    height = solveCompositeShapeDimension(
      { ...shape, width, height },
      "height",
      textHeight,
      minimum.height,
    );
  }
  const normalize = (value: number, original: number) => {
    if (value > original) {
      return Math.ceil(value - 1e-6);
    }
    return Math.abs(value - Math.round(value)) < 1e-6
      ? Math.round(value)
      : value;
  };
  return {
    width: normalize(width, element.width),
    height: normalize(height, element.height),
  };
};

export const isCompositeShapeOpen = (id: BaseShapeId) => {
  switch (id) {
    case "brace":
    case "brace-reverse":
      return true;
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "cross":
    case "cloud":
    case "double-arrow":
    case "forward-arrow":
    case "backward-arrow":
    case "octagon":
    case "pentagon":
    case "hexagon":
    case "star":
    case "triangle":
    case "round-rect":
    case "rectangle-bubble":
    case "pill":
    case "bubble":
    case "trapezoid":
    case "parallelogram":
    case "right-pentagon":
    case "step":
    case "cube":
    case "cylinder":
    case "pie":
    case "circular-ring":
      return false;
    default:
      return assertNever(id, "Unsupported composite shape");
  }
};

type ShapePoint = [number, number];
type CompositeShapeGeometryInput = Pick<
  ExcalidrawCompositeShapeElement,
  "width" | "height" | "shape"
> &
  Partial<Pick<ExcalidrawCompositeShapeElement, "roundness">>;

export const getCompositeShapeCornerRadius = (
  size: number,
  roundness: ExcalidrawCompositeShapeElement["roundness"] | undefined,
) => {
  if (
    roundness?.type === ROUNDNESS.PROPORTIONAL_RADIUS ||
    roundness?.type === ROUNDNESS.LEGACY
  ) {
    return size * DEFAULT_PROPORTIONAL_RADIUS;
  }
  if (roundness?.type === ROUNDNESS.ADAPTIVE_RADIUS) {
    const fixedRadius = roundness.value ?? DEFAULT_ADAPTIVE_RADIUS;
    return Math.min(size * DEFAULT_PROPORTIONAL_RADIUS, fixedRadius);
  }
  return 0;
};

const getBaseDiamondPoints = (w: number, h: number): ShapePoint[] => {
  const x = Math.floor(w / 2) + 1;
  const y = Math.floor(h / 2) + 1;
  return [
    [x, 0],
    [w, y],
    [x, h],
    [0, y],
  ];
};

type ShapePathCommand =
  | { type: "line"; to: ShapePoint }
  | {
      type: "cubic";
      control1: ShapePoint;
      control2: ShapePoint;
      to: ShapePoint;
    };

export type CompositeShapePath = {
  start: ShapePoint;
  commands: ShapePathCommand[];
  closed: boolean;
};

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

const pathFromPoints = (
  points: ShapePoint[],
  closed: boolean,
): CompositeShapePath => ({
  start: points[0],
  commands: points.slice(1).map((to) => ({ type: "line", to })),
  closed,
});

const getCircularSectorOutline = (
  w: number,
  h: number,
  data: {
    centralAngle: number;
    radius: number;
    sectorRatio: number;
    startRadialLineAngle: number;
  },
  ring: boolean,
): CompositeShapePath => {
  const radius = Math.min(w, h) / 2;
  const sourceRadius =
    data.radius <= 1 ? radius * data.radius * 2 : data.radius;
  const r = Math.min(radius, Math.max(0.01, sourceRadius));
  const center: ShapePoint = [w / 2, h / 2];
  const steps = Math.max(8, Math.ceil(data.centralAngle / 10));
  const point = (angle: number, distance: number): ShapePoint => {
    const radians = (angle * Math.PI) / 180;
    return [
      center[0] + Math.cos(radians) * distance,
      center[1] + Math.sin(radians) * distance,
    ];
  };
  const outer = Array.from({ length: steps + 1 }, (_, i) =>
    point(data.startRadialLineAngle + (data.centralAngle * i) / steps, r),
  );
  if (!ring) {
    return pathFromPoints([center, ...outer], true);
  }
  const innerRadius = r * clampValue(data.sectorRatio, 0, 1);
  const inner = Array.from({ length: steps + 1 }, (_, i) =>
    point(
      data.startRadialLineAngle +
        data.centralAngle -
        (data.centralAngle * i) / steps,
      innerRadius,
    ),
  );
  return pathFromPoints([...outer, ...inner], true);
};

/** Cross outline captured from the Lark whiteboard export at 120 x 120. */
const getCrossOutline = (w: number, h: number): CompositeShapePath => {
  const sx = w / 120;
  const sy = h / 120;
  const point = (x: number, y: number): ShapePoint => [
    x === 0 ? 0 : x === 120 ? w : x * sx,
    y === 0 ? 0 : y === 120 ? h : y * sy,
  ];
  const line = (x: number, y: number) => ({
    type: "line" as const,
    to: point(x, y),
  });
  const cubic = (
    control1: [number, number],
    control2: [number, number],
    to: [number, number],
  ) => ({
    type: "cubic" as const,
    control1: point(...control1),
    control2: point(...control2),
    to: point(...to),
  });

  return {
    start: point(87.758202, 33.241901),
    commands: [
      line(118, 33.241901),
      cubic(
        [118.552277, 33.241901],
        [119.023674, 33.437164],
        [119.4142, 33.827686],
      ),
      cubic([119.804726, 34.218208], [119.999992, 34.689613], [120, 35.241901]),
      line(120, 84.758202),
      cubic(
        [119.999992, 85.310486],
        [119.804726, 85.781883],
        [119.4142, 86.172409],
      ),
      cubic([119.023674, 86.562935], [118.552277, 86.758194], [118, 86.758202]),
      line(87.758202, 86.758202),
      cubic(
        [87.482056, 86.758202],
        [87.246346, 86.855827],
        [87.051086, 87.051086],
      ),
      cubic(
        [86.855827, 87.246346],
        [86.758194, 87.482056],
        [86.758202, 87.758202],
      ),
      line(86.758202, 118),
      cubic(
        [86.758194, 118.552277],
        [86.562935, 119.023674],
        [86.172409, 119.4142],
      ),
      cubic([85.781883, 119.804726], [85.310486, 119.999992], [84.758202, 120]),
      line(35.241798, 120),
      cubic(
        [34.68951, 119.999992],
        [34.218105, 119.804726],
        [33.827583, 119.4142],
      ),
      cubic([33.437061, 119.023674], [33.241798, 118.552277], [33.241798, 118]),
      line(33.241798, 87.758202),
      cubic(
        [33.241798, 87.482056],
        [33.144169, 87.246346],
        [32.948906, 87.051086],
      ),
      cubic(
        [32.753643, 86.855827],
        [32.517941, 86.758202],
        [32.241798, 86.758202],
      ),
      line(2, 86.758202),
      cubic(
        [1.44771516, 86.758194],
        [0.97631067, 86.562935],
        [0.5857864, 86.172409],
      ),
      cubic([0.19526213, 85.781883], [0, 85.310486], [0, 84.758202]),
      line(0, 35.241901),
      cubic([0, 34.689613], [0.19526213, 34.218208], [0.5857864, 33.827686]),
      cubic([0.97631067, 33.437164], [1.44771516, 33.241901], [2, 33.241901]),
      line(32.241798, 33.241901),
      cubic(
        [32.517941, 33.241898],
        [32.753639, 33.144268],
        [32.948902, 32.949005],
      ),
      cubic(
        [33.144165, 32.753742],
        [33.241798, 32.518044],
        [33.241798, 32.241901],
      ),
      line(33.241798, 2),
      cubic([33.241798, 1.447714], [33.437061, 0.97631], [33.827583, 0.585785]),
      cubic([34.218105, 0.195261], [34.68951, 0], [35.241798, 0]),
      line(84.758202, 0),
      cubic([85.310486, 0], [85.781883, 0.195263], [86.172409, 0.585788]),
      cubic([86.562935, 0.976312], [86.758194, 1.447716], [86.758202, 2]),
      line(86.758202, 32.241901),
      cubic(
        [86.758194, 32.518044],
        [86.855827, 32.753742],
        [87.051086, 32.949005],
      ),
      cubic(
        [87.246346, 33.144268],
        [87.482056, 33.241898],
        [87.758202, 33.241901],
      ),
    ],
    closed: true,
  };
};

/** Rounded five-point star outline captured from the Lark export at 104 x 100. */
const getStarOutline = (w: number, h: number): CompositeShapePath => {
  const sx = w / 104;
  const sy = h / 100;
  const point = (x: number, y: number): ShapePoint => [x * sx, y * sy];
  const line = (x: number, y: number) => ({
    type: "line" as const,
    to: point(x, y),
  });
  const cubic = (
    c1: [number, number],
    c2: [number, number],
    to: [number, number],
  ) => ({
    type: "cubic" as const,
    control1: point(...c1),
    control2: point(...c2),
    to: point(...to),
  });
  return {
    start: point(43.562038, 14.7307625),
    commands: [
      line(50.306068, 1.1146363),
      cubic(
        [50.389004, 0.94718492],
        [51.917461, 0.00175935],
        [52.104324, 0.0023236],
      ),
      cubic(
        [52.291187, 0.00288784],
        [53.46059, 0.52615827],
        [53.585529, 0.66511571],
      ),
      line(68.579651, 31.227667),
      cubic(
        [68.732719, 31.541471],
        [68.981819, 31.724819],
        [69.326935, 31.777708],
      ),
      line(102.622231, 36.88018),
      cubic(
        [103.318871, 37.114922],
        [104.311089, 38.598186],
        [104.262146, 39.33168],
      ),
      cubic(
        [104.218147, 39.511822],
        [104.150398, 39.682545],
        [103.723625, 40.281105],
      ),
      line(79.898766, 63.777264),
      cubic(
        [79.653351, 64.019295],
        [79.558441, 64.310402],
        [79.614037, 64.650574],
      ),
      line(85.107193, 98.258926),
      cubic(
        [85.141525, 98.627319],
        [84.815529, 99.679314],
        [84.298676, 100.206985],
      ),
      cubic(
        [83.983818, 100.401291],
        [83.452339, 100.564713],
        [83.266418, 100.577103],
      ),
      cubic(
        [82.896431, 100.576172],
        [82.358673, 100.434784],
        [82.19416, 100.347282],
      ),
      line(52.828991, 84.727715),
      cubic(
        [52.518242, 84.562424],
        [52.206985, 84.561462],
        [51.895222, 84.724838],
      ),
      line(22.040283, 100.369843),
      cubic(
        [21.701529, 100.518524],
        [20.600519, 100.540787],
        [19.936874, 100.216728],
      ),
      cubic(
        [19.653233, 99.979218],
        [19.144396, 99.002586],
        [19.140091, 98.264069],
      ),
      line(24.758688, 65.120529),
      cubic(
        [24.816296, 64.780708],
        [24.72312, 64.489059],
        [24.479158, 64.245583],
      ),
      line(0.48433936, 40.29845),
      cubic(
        [0.24217814, 40.021023],
        [-0.108959243, 38.982506],
        [-0.00181681, 38.25518],
      ),
      cubic(
        [0.056382045, 38.079098],
        [0.90814471, 37.134609],
        [1.07729793, 37.05859],
      ),
      line(34.493912, 32.069168),
      cubic(
        [34.839375, 32.018383],
        [35.089592, 31.83654],
        [35.244568, 31.523643],
      ),
      line(43.562038, 14.7307625),
    ],
    closed: true,
  };
};

const getRoundedRectOutline = (
  width: number,
  height: number,
  radius: number,
): CompositeShapePath => {
  const r = Math.min(radius, width / 2, height / 2);
  const k = 0.5522848;
  return {
    start: [r, 0],
    commands: [
      { type: "line", to: [width - r, 0] },
      {
        type: "cubic",
        control1: [width - r + k * r, 0],
        control2: [width, r - k * r],
        to: [width, r],
      },
      { type: "line", to: [width, height - r] },
      {
        type: "cubic",
        control1: [width, height - r + k * r],
        control2: [width - r + k * r, height],
        to: [width - r, height],
      },
      { type: "line", to: [r, height] },
      {
        type: "cubic",
        control1: [r - k * r, height],
        control2: [0, height - r + k * r],
        to: [0, height - r],
      },
      { type: "line", to: [0, r] },
      {
        type: "cubic",
        control1: [0, r - k * r],
        control2: [r - k * r, 0],
        to: [r, 0],
      },
    ],
    closed: true,
  };
};

const getBaseRectangleOutline = (
  w: number,
  h: number,
  radius: number,
): CompositeShapePath => {
  if (!radius) {
    return pathFromPoints(
      [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ],
      true,
    );
  }
  const r = Math.min(radius, w / 2, h / 2);
  return {
    start: [r, 0],
    commands: [
      { type: "line", to: [w - r, 0] },
      {
        type: "cubic",
        control1: [w - r / 3, 0],
        control2: [w, r / 3],
        to: [w, r],
      },
      { type: "line", to: [w, h - r] },
      {
        type: "cubic",
        control1: [w, h - r / 3],
        control2: [w - r / 3, h],
        to: [w - r, h],
      },
      { type: "line", to: [r, h] },
      {
        type: "cubic",
        control1: [r / 3, h],
        control2: [0, h - r / 3],
        to: [0, h - r],
      },
      { type: "line", to: [0, r] },
      { type: "cubic", control1: [0, r / 3], control2: [r / 3, 0], to: [r, 0] },
    ],
    closed: true,
  };
};

const getBaseDiamondOutline = (
  points: ShapePoint[],
  verticalRadius: number,
  horizontalRadius: number,
): CompositeShapePath => {
  if (!verticalRadius && !horizontalRadius) {
    return pathFromPoints(points, true);
  }
  const [top, right, bottom, left] = points;
  const v = verticalRadius;
  const h = horizontalRadius;
  const start: ShapePoint = [top[0] + v, top[1] + h];
  return {
    start,
    commands: [
      { type: "line", to: [right[0] - v, right[1] - h] },
      {
        type: "cubic",
        control1: right,
        control2: right,
        to: [right[0] - v, right[1] + h],
      },
      { type: "line", to: [bottom[0] + v, bottom[1] - h] },
      {
        type: "cubic",
        control1: bottom,
        control2: bottom,
        to: [bottom[0] - v, bottom[1] - h],
      },
      { type: "line", to: [left[0] + v, left[1] + h] },
      {
        type: "cubic",
        control1: left,
        control2: left,
        to: [left[0] + v, left[1] - h],
      },
      { type: "line", to: [top[0] - v, top[1] + h] },
      { type: "cubic", control1: top, control2: top, to: start },
    ],
    closed: true,
  };
};

const getBaseEllipseOutline = (w: number, h: number): CompositeShapePath => {
  const rx = w / 2;
  const ry = h / 2;
  const k = 0.5522847498307936;
  return {
    start: [rx, 0],
    commands: [
      {
        type: "cubic",
        control1: [rx + k * rx, 0],
        control2: [w, ry - k * ry],
        to: [w, ry],
      },
      {
        type: "cubic",
        control1: [w, ry + k * ry],
        control2: [rx + k * rx, h],
        to: [rx, h],
      },
      {
        type: "cubic",
        control1: [rx - k * rx, h],
        control2: [0, ry + k * ry],
        to: [0, ry],
      },
      {
        type: "cubic",
        control1: [0, ry - k * ry],
        control2: [rx - k * rx, 0],
        to: [rx, 0],
      },
    ],
    closed: true,
  };
};

const getRectangleBubbleOutline = (
  w: number,
  h: number,
): CompositeShapePath => {
  const bodyHeight = h * 0.84;
  const outline = getRoundedRectOutline(
    w,
    bodyHeight,
    Math.min(w, bodyHeight) * 0.08,
  );
  outline.commands.splice(
    4,
    0,
    { type: "line", to: [w * 0.84, bodyHeight] },
    { type: "line", to: [w * 0.76, h] },
    { type: "line", to: [w * 0.66, bodyHeight] },
  );
  return outline;
};

const getCloudOutline = (w: number, h: number): CompositeShapePath => {
  const scale = ([x, y]: ShapePoint): ShapePoint => [x * w, y * h];
  const curves: [ShapePoint, ShapePoint, ShapePoint][] = [
    [
      [0.55, 0],
      [0.61, 0.045],
      [0.625, 0.115],
    ],
    [
      [0.73, 0.04],
      [0.87, 0.1],
      [0.855, 0.305],
    ],
    [
      [1.03, 0.33],
      [1.06, 0.49],
      [0.975, 0.56],
    ],
    [
      [1.02, 0.6],
      [1, 0.69],
      [0.865, 0.735],
    ],
    [
      [0.9, 0.88],
      [0.75, 1],
      [0.625, 0.9],
    ],
    [
      [0.58, 1.04],
      [0.39, 1.04],
      [0.335, 0.89],
    ],
    [
      [0.19, 0.98],
      [0.05, 0.88],
      [0.095, 0.76],
    ],
    [
      [0.02, 0.75],
      [0.005, 0.62],
      [0.045, 0.55],
    ],
    [
      [-0.04, 0.52],
      [-0.03, 0.34],
      [0.135, 0.3],
    ],
    [
      [0.1, 0.16],
      [0.22, 0.045],
      [0.335, 0.115],
    ],
    [
      [0.39, 0.04],
      [0.43, 0],
      [0.48, 0],
    ],
  ];
  return {
    start: scale([0.48, 0]),
    commands: curves.map(([control1, control2, to]) => ({
      type: "cubic",
      control1: scale(control1),
      control2: scale(control2),
      to: scale(to),
    })),
    closed: true,
  };
};

// Lark's bubble outline, measured from the 120 x 80 vector path in the PDF
// reference. The source path uses many short cubic segments, so preserve them
// instead of approximating the body with a polygon and a separate tail.
const getBubbleOutline = (w: number, h: number): CompositeShapePath => {
  const scale = ([x, y]: ShapePoint): ShapePoint => [
    (x * w) / 120,
    (y * h) / 80,
  ];
  return {
    start: scale([6, 78]),
    commands: [
      { type: "line", to: scale([11.7986107, 63.819939]) },
      {
        type: "cubic",
        control1: scale([10.6284132, 62.767506]),
        control2: scale([9.5383997, 61.679371]),
        to: scale([8.5285711, 60.555534]),
      },
      {
        type: "cubic",
        control1: scale([7.5187426, 59.431698]),
        control2: scale([6.5939612, 58.277573]),
        to: scale([5.7542276, 57.093159]),
      },
      {
        type: "cubic",
        control1: scale([4.9144945, 55.908749]),
        control2: scale([4.1638527, 54.699757]),
        to: scale([3.5023015, 53.466179]),
      },
      {
        type: "cubic",
        control1: scale([2.8407507, 52.232597]),
        control2: scale([2.2714765, 50.980373]),
        to: scale([1.794479, 49.709503]),
      },
      {
        type: "cubic",
        control1: scale([1.31748164, 48.438637]),
        control2: scale([0.93505788, 47.155243]),
        to: scale([0.64720768, 45.859325]),
      },
      {
        type: "cubic",
        control1: scale([0.35935745, 44.563408]),
        control2: scale([0.167466938, 43.261204]),
        to: scale([0.071536094, 41.952713]),
      },
      {
        type: "cubic",
        control1: scale([-0.024394751, 40.64423]),
        control2: scale([-0.023903981, 39.335758]),
        to: scale([0.073008403, 38.027306]),
      },
      {
        type: "cubic",
        control1: scale([0.16992079, 36.718849]),
        control2: scale([0.36278811, 35.41671]),
        to: scale([0.65161037, 34.120888]),
      },
      {
        type: "cubic",
        control1: scale([0.94043267, 32.825066]),
        control2: scale([1.32381904, 31.5418]),
        to: scale([1.8017697, 30.271091]),
      },
      {
        type: "cubic",
        control1: scale([2.2797203, 29.000383]),
        control2: scale([2.8499336, 27.748348]),
        to: scale([3.5124094, 26.514988]),
      },
      {
        type: "cubic",
        control1: scale([4.1748857, 25.28163]),
        control2: scale([4.9264345, 24.072886]),
        to: scale([5.767056, 22.888756]),
      },
      {
        type: "cubic",
        control1: scale([6.6076775, 21.704626]),
        control2: scale([7.5333238, 20.55081]),
        to: scale([8.5439949, 19.427311]),
      },
      {
        type: "cubic",
        control1: scale([9.5546675, 18.303814]),
        control2: scale([10.6454973, 17.216042]),
        to: scale([11.8164854, 16.1639938]),
      },
      {
        type: "cubic",
        control1: scale([12.9874735, 15.111948]),
        control2: scale([14.2329807, 14.1006937]),
        to: scale([15.5530071, 13.1302309]),
      },
      {
        type: "cubic",
        control1: scale([16.873035, 12.1597691]),
        control2: scale([18.261227, 11.2347717]),
        to: scale([19.717581, 10.3552399]),
      },
      {
        type: "cubic",
        control1: scale([21.173935, 9.4757071]),
        control2: scale([22.691439, 8.645874]),
        to: scale([24.270092, 7.8657417]),
      },
      {
        type: "cubic",
        control1: scale([25.848749, 7.0856094]),
        control2: scale([27.480951, 6.3589339]),
        to: scale([29.166702, 5.6857152]),
      },
      {
        type: "cubic",
        control1: scale([30.852455, 5.012496]),
        control2: scale([32.583637, 4.3959756]),
        to: scale([34.360252, 3.836153]),
      },
      {
        type: "cubic",
        control1: scale([36.136868, 3.2763309]),
        control2: scale([37.950363, 2.775903]),
        to: scale([39.800732, 2.3348691]),
      },
      {
        type: "cubic",
        control1: scale([41.6511, 1.8938351]),
        control2: scale([43.529438, 1.51431894]),
        to: scale([45.435738, 1.19632065]),
      },
      {
        type: "cubic",
        control1: scale([47.342045, 0.87832242]),
        control2: scale([49.267132, 0.62337327]),
        to: scale([51.211006, 0.43147311]),
      },
      {
        type: "cubic",
        control1: scale([53.154884, 0.23957297]),
        control2: scale([55.108189, 0.111645944]),
        to: scale([57.070915, 0.047692046]),
      },
      {
        type: "cubic",
        control1: scale([59.033649, -0.0162618533]),
        control2: scale([60.996361, -0.0159346685]),
        to: scale([62.959042, 0.048673578]),
      },
      {
        type: "cubic",
        control1: scale([64.921722, 0.113281831]),
        control2: scale([66.874931, 0.24186003]),
        to: scale([68.818665, 0.43440819]),
      },
      {
        type: "cubic",
        control1: scale([70.762398, 0.62695634]),
        control2: scale([72.687302, 0.88254726]),
        to: scale([74.593361, 1.20118093]),
      },
      {
        type: "cubic",
        control1: scale([76.49942, 1.51981473]),
        control2: scale([78.377472, 1.8999567]),
        to: scale([80.227509, 2.3416073]),
      },
      {
        type: "cubic",
        control1: scale([82.077545, 2.7832582]),
        control2: scale([83.890663, 3.2842908]),
        to: scale([85.666862, 3.8447049]),
      },
      {
        type: "cubic",
        control1: scale([87.443062, 4.4051194]),
        control2: scale([89.173782, 5.0222168]),
        to: scale([90.859024, 5.6959972]),
      },
      {
        type: "cubic",
        control1: scale([92.544273, 6.3697782]),
        control2: scale([94.175941, 7.0969982]),
        to: scale([95.754013, 7.8776569]),
      },
      {
        type: "cubic",
        control1: scale([97.332077, 8.6583157]),
        control2: scale([98.848953, 9.4886541]),
        to: scale([100.304649, 10.3686714]),
      },
      {
        type: "cubic",
        control1: scale([101.760345, 11.2486906]),
        control2: scale([103.14785, 12.1741505]),
        to: scale([104.467148, 13.1450529]),
      },
      {
        type: "cubic",
        control1: scale([105.786446, 14.1159554]),
        control2: scale([107.031189, 15.1276255]),
        to: scale([108.201385, 16.1800613]),
      },
      {
        type: "cubic",
        control1: scale([109.37159, 17.232498]),
        control2: scale([110.461609, 18.320635]),
        to: scale([111.471436, 19.444469]),
      },
      {
        type: "cubic",
        control1: scale([112.481262, 20.568304]),
        control2: scale([113.406036, 21.722427]),
        to: scale([114.245766, 22.906836]),
      },
      {
        type: "cubic",
        control1: scale([115.085503, 24.091248]),
        control2: scale([115.836143, 25.300241]),
        to: scale([116.497696, 26.533821]),
      },
      {
        type: "cubic",
        control1: scale([117.159248, 27.767401]),
        control2: scale([117.728516, 29.019623]),
        to: scale([118.205505, 30.290491]),
      },
      {
        type: "cubic",
        control1: scale([118.68251, 31.561361]),
        control2: scale([119.064934, 32.844753]),
        to: scale([119.352783, 34.140671]),
      },
      {
        type: "cubic",
        control1: scale([119.640633, 35.436588]),
        control2: scale([119.832527, 36.738792]),
        to: scale([119.928452, 38.047279]),
      },
      {
        type: "cubic",
        control1: scale([120.024391, 39.35577]),
        control2: scale([120.023903, 40.664242]),
        to: scale([119.926987, 41.972698]),
      },
      {
        type: "cubic",
        control1: scale([119.83007, 43.281151]),
        control2: scale([119.637207, 44.58329]),
        to: scale([119.348381, 45.879112]),
      },
      {
        type: "cubic",
        control1: scale([119.05957, 47.174934]),
        control2: scale([118.676186, 48.458199]),
        to: scale([118.198227, 49.728909]),
      },
      {
        type: "cubic",
        control1: scale([117.720284, 50.999619]),
        control2: scale([117.150063, 52.251652]),
        to: scale([116.487579, 53.485008]),
      },
      {
        type: "cubic",
        control1: scale([115.825111, 54.718365]),
        control2: scale([115.073563, 55.927109]),
        to: scale([114.232941, 57.11124]),
      },
      {
        type: "cubic",
        control1: scale([113.392311, 58.295372]),
        control2: scale([112.46666, 59.449184]),
        to: scale([111.455986, 60.572681]),
      },
      {
        type: "cubic",
        control1: scale([110.44532, 61.696182]),
        control2: scale([109.354492, 62.783958]),
        to: scale([108.18351, 63.836006]),
      },
      {
        type: "cubic",
        control1: scale([107.012527, 64.888054]),
        control2: scale([105.767014, 65.899307]),
        to: scale([104.446983, 66.869766]),
      },
      {
        type: "cubic",
        control1: scale([103.126961, 67.840233]),
        control2: scale([101.738777, 68.765228]),
        to: scale([100.282425, 69.64476]),
      },
      {
        type: "cubic",
        control1: scale([98.826073, 70.5243]),
        control2: scale([97.308563, 71.354134]),
        to: scale([95.729904, 72.134262]),
      },
      {
        type: "cubic",
        control1: scale([93.271416, 73.34919]),
        control2: scale([90.688614, 74.432388]),
        to: scale([87.981506, 75.383842]),
      },
      {
        type: "cubic",
        control1: scale([85.274406, 76.335297]),
        control2: scale([82.474503, 77.143944]),
        to: scale([79.581795, 77.809784]),
      },
      {
        type: "cubic",
        control1: scale([76.689087, 78.475624]),
        control2: scale([73.737251, 78.990913]),
        to: scale([70.726273, 79.355637]),
      },
      {
        type: "cubic",
        control1: scale([67.715294, 79.72036]),
        control2: scale([64.680229, 79.930283]),
        to: scale([61.621071, 79.985397]),
      },
      {
        type: "cubic",
        control1: scale([58.561916, 80.04052]),
        control2: scale([55.514271, 79.940201]),
        to: scale([52.478138, 79.684433]),
      },
      {
        type: "cubic",
        control1: scale([49.442009, 79.428673]),
        control2: scale([46.452728, 79.020439]),
        to: scale([43.510296, 78.45974]),
      },
      {
        type: "cubic",
        control1: scale([40.567863, 77.89904]),
        control2: scale([37.706524, 77.192398]),
        to: scale([34.926281, 76.339813]),
      },
      {
        type: "cubic",
        control1: scale([32.146034, 75.487236]),
        control2: scale([29.479242, 74.498634]),
        to: scale([26.925903, 73.374008]),
      },
      { type: "line", to: scale([6, 78]) },
    ],
    closed: true,
  };
};

const BRACE_REFERENCE_WIDTH = 164;
const BRACE_REFERENCE_HEIGHT = 120;

/** Lark's open brace paths, scaled by height and anchored to an edge. */
const getBraceOutline = (
  w: number,
  h: number,
  reverse: boolean,
): CompositeShapePath => {
  const scaleY = h / BRACE_REFERENCE_HEIGHT;
  const scaleX = Math.min(scaleY, w / BRACE_REFERENCE_WIDTH);
  const point = (x: number, y: number): ShapePoint => [
    reverse ? w - (BRACE_REFERENCE_WIDTH - x) * scaleX : x * scaleX,
    y * scaleY,
  ];

  if (reverse) {
    return {
      start: point(164, 0),
      commands: [
        {
          type: "cubic",
          control1: point(156.544205, 0),
          control2: point(150.5, 6.0441599),
          to: point(150.5, 13.5),
        },
        { type: "line", to: point(150.5, 45.004131) },
        {
          type: "cubic",
          control1: point(150.5, 50.144131),
          control2: point(147.969498, 54.954834),
          to: point(143.733795, 57.866833),
        },
        { type: "line", to: point(141.352295, 59.504131) },
        { type: "line", to: point(143.733795, 61.004131) },
        {
          type: "cubic",
          control1: point(146.040298, 62.589832),
          control2: point(150.5, 67.465431),
          to: point(150.5, 70.264435),
        },
        { type: "line", to: point(150.5, 106.5) },
        {
          type: "cubic",
          control1: point(150.5, 113.956001),
          control2: point(156.544205, 120),
          to: point(164, 120),
        },
      ],
      closed: false,
    };
  }

  return {
    start: point(0, 0),
    commands: [
      {
        type: "cubic",
        control1: point(7.45584, 0),
        control2: point(13.5, 6.0441599),
        to: point(13.5, 13.5),
      },
      { type: "line", to: point(13.5, 45.004131) },
      {
        type: "cubic",
        control1: point(13.5, 50.144131),
        control2: point(16.0304985, 54.954834),
        to: point(20.266199, 57.866833),
      },
      { type: "line", to: point(22.647699, 59.504131) },
      { type: "line", to: point(17.1845, 63.260029) },
      {
        type: "cubic",
        control1: point(14.8780003, 64.845726),
        control2: point(13.5, 67.465431),
        to: point(13.5, 70.264435),
      },
      { type: "line", to: point(13.5, 106.5) },
      {
        type: "cubic",
        control1: point(13.5, 113.956001),
        control2: point(7.4558301, 120),
        to: point(0, 120),
      },
    ],
    closed: false,
  };
};

const getCylinderOutline = (w: number, h: number): CompositeShapePath => {
  const ry = Math.min(w * 0.2, h / 4);
  const k = 0.5522848;
  const halfWidth = w / 2;
  return {
    start: [0, ry],
    commands: [
      {
        type: "cubic",
        control1: [0, ry - k * ry],
        control2: [halfWidth - k * halfWidth, 0],
        to: [halfWidth, 0],
      },
      {
        type: "cubic",
        control1: [halfWidth + k * halfWidth, 0],
        control2: [w, ry - k * ry],
        to: [w, ry],
      },
      { type: "line", to: [w, h - ry] },
      {
        type: "cubic",
        control1: [w, h - ry + k * ry],
        control2: [halfWidth + k * halfWidth, h],
        to: [halfWidth, h],
      },
      {
        type: "cubic",
        control1: [halfWidth - k * halfWidth, h],
        control2: [0, h - ry + k * ry],
        to: [0, h - ry],
      },
    ],
    closed: true,
  };
};

const getCylinderFrontEdge = (w: number, h: number): CompositeShapePath => {
  const ry = Math.min(w * 0.2, h / 4);
  const halfWidth = w / 2;
  const k = 0.5522848;
  // The PDF's front edge is inset 1 unit horizontally and 0.5 vertically at 80px width.
  const insetX = w / 80;
  const frontRy = ry * (31 / 32);
  return {
    start: [w - insetX, frontRy],
    commands: [
      {
        type: "cubic",
        control1: [w - insetX, frontRy + k * frontRy],
        control2: [halfWidth + k * halfWidth, 2 * frontRy],
        to: [halfWidth, 2 * frontRy],
      },
      {
        type: "cubic",
        control1: [halfWidth - k * halfWidth, 2 * frontRy],
        control2: [insetX, frontRy + k * frontRy],
        to: [insetX, frontRy],
      },
    ],
    closed: false,
  };
};

const getCylinderTopFace = (w: number, h: number): CompositeShapePath => {
  const ry = Math.min(w * 0.2, h / 4);
  const halfWidth = w / 2;
  const k = 0.5522848;
  return {
    start: [0, ry],
    commands: [
      {
        type: "cubic",
        control1: [0, ry - k * ry],
        control2: [halfWidth - k * halfWidth, 0],
        to: [halfWidth, 0],
      },
      {
        type: "cubic",
        control1: [halfWidth + k * halfWidth, 0],
        control2: [w, ry - k * ry],
        to: [w, ry],
      },
      {
        type: "cubic",
        control1: [w, ry + k * ry],
        control2: [halfWidth + k * halfWidth, 2 * ry],
        to: [halfWidth, 2 * ry],
      },
      {
        type: "cubic",
        control1: [halfWidth - k * halfWidth, 2 * ry],
        control2: [0, ry + k * ry],
        to: [0, ry],
      },
    ],
    closed: true,
  };
};

const getCylinderSideFace = (w: number, h: number): CompositeShapePath => {
  const ry = Math.min(w * 0.2, h / 4);
  const halfWidth = w / 2;
  const k = 0.5522848;
  return {
    start: [0, ry],
    commands: [
      {
        type: "cubic",
        control1: [0, ry + k * ry],
        control2: [halfWidth - k * halfWidth, 2 * ry],
        to: [halfWidth, 2 * ry],
      },
      {
        type: "cubic",
        control1: [halfWidth + k * halfWidth, 2 * ry],
        control2: [w, ry + k * ry],
        to: [w, ry],
      },
      { type: "line", to: [w, h - ry] },
      {
        type: "cubic",
        control1: [w, h - ry + k * ry],
        control2: [halfWidth + k * halfWidth, h],
        to: [halfWidth, h],
      },
      {
        type: "cubic",
        control1: [halfWidth - k * halfWidth, h],
        control2: [0, h - ry + k * ry],
        to: [0, h - ry],
      },
    ],
    closed: true,
  };
};

/** Local paths are the source for both visible strokes and binding geometry. */
export const getCompositeShapeGeometry = (
  element: CompositeShapeGeometryInput,
): CompositeShapeGeometry => {
  const { width: w, height: h } = element;
  if (element.shape.id === "rectangle") {
    const radius = getCompositeShapeCornerRadius(
      Math.min(w, h),
      element.roundness,
    );
    return {
      outline: getBaseRectangleOutline(w, h, radius),
      details: [],
      primitive: { kind: "rectangle", width: w, height: h, radius },
    };
  }
  if (element.shape.id === "diamond") {
    const points = getBaseDiamondPoints(w, h);
    const verticalRadius = getCompositeShapeCornerRadius(
      points[0][0],
      element.roundness,
    );
    const horizontalRadius = getCompositeShapeCornerRadius(
      points[1][1],
      element.roundness,
    );
    return {
      outline: getBaseDiamondOutline(points, verticalRadius, horizontalRadius),
      details: [],
      primitive: { kind: "diamond", points, verticalRadius, horizontalRadius },
    };
  }
  if (element.shape.id === "ellipse") {
    return {
      outline: getBaseEllipseOutline(w, h),
      details: [],
      primitive: {
        kind: "ellipse",
        center: [w / 2, h / 2],
        radiusX: w / 2,
        radiusY: h / 2,
      },
    };
  }
  const outline =
    element.shape.id === "cross"
      ? getCrossOutline(element.width, element.height)
      : element.shape.id === "star"
      ? getStarOutline(element.width, element.height)
      : element.shape.id === "cylinder"
      ? getCylinderOutline(element.width, element.height)
      : element.shape.id === "round-rect"
      ? getRoundedRectOutline(
          element.width,
          element.height,
          Math.min(element.width, element.height) * 0.18,
        )
      : element.shape.id === "pill"
      ? getRoundedRectOutline(
          element.width,
          element.height,
          Math.min(element.width, element.height) / 2,
        )
      : element.shape.id === "rectangle-bubble"
      ? getRectangleBubbleOutline(element.width, element.height)
      : element.shape.id === "cloud"
      ? getCloudOutline(element.width, element.height)
      : element.shape.id === "brace" || element.shape.id === "brace-reverse"
      ? getBraceOutline(
          element.width,
          element.height,
          element.shape.id === "brace-reverse",
        )
      : element.shape.id === "bubble"
      ? getBubbleOutline(element.width, element.height)
      : element.shape.id === "pie"
      ? getCircularSectorOutline(
          element.width,
          element.height,
          element.shape.pie,
          false,
        )
      : element.shape.id === "circular-ring"
      ? getCircularSectorOutline(
          element.width,
          element.height,
          element.shape.circularRing,
          true,
        )
      : pathFromPoints(
          getCompositeShapePoints(element),
          !isCompositeShapeOpen(element.shape.id),
        );

  if (element.shape.id === "cylinder") {
    return {
      outline,
      details: [getCylinderFrontEdge(element.width, element.height)],
      fillFaces: [
        {
          path: getCylinderSideFace(element.width, element.height),
          tone: "base",
        },
        {
          path: getCylinderTopFace(element.width, element.height),
          tone: "light",
        },
      ],
    };
  }

  if (element.shape.id === "parallelogram") {
    const { width: w, height: h } = element;
    const skew = w * 0.18;
    return {
      outline,
      details: [],
      anchors: [
        [w - skew / 2, h / 2],
        [(w - skew) / 2, h],
        [skew / 2, h / 2],
        [(w + skew) / 2, 0],
      ],
    };
  }

  if (element.shape.id !== "cube") {
    return { outline, details: [] };
  }

  const frontRightX = w * element.shape.cube.controlPoint.x;
  const depthY = h * element.shape.cube.controlPoint.y;
  return {
    outline,
    fillFaces: [
      {
        path: pathFromPoints(
          [
            [frontRightX, depthY],
            [w, 0],
            [w, h - depthY],
            [frontRightX, h],
          ],
          true,
        ),
        tone: "dark",
      },
      {
        path: pathFromPoints(
          [
            [0, depthY],
            [w - frontRightX, 0],
            [w, 0],
            [frontRightX, depthY],
          ],
          true,
        ),
        tone: "light",
      },
      {
        path: pathFromPoints(
          [
            [0, depthY],
            [frontRightX, depthY],
            [frontRightX, h],
            [0, h],
          ],
          true,
        ),
        tone: "base",
      },
    ],
    details: [
      pathFromPoints(
        [
          [0, depthY],
          [frontRightX, depthY],
          [w, 0],
        ],
        false,
      ),
      pathFromPoints(
        [
          [frontRightX, depthY],
          [frontRightX, h],
        ],
        false,
      ),
    ],
  };
};

export const compositeShapePathToSvg = (path: CompositeShapePath): string =>
  [
    `M ${path.start[0]} ${path.start[1]}`,
    ...path.commands.map((command) =>
      command.type === "line"
        ? `L ${command.to[0]} ${command.to[1]}`
        : `C ${command.control1[0]} ${command.control1[1]}, ${command.control2[0]} ${command.control2[1]}, ${command.to[0]} ${command.to[1]}`,
    ),
    ...(path.closed ? ["Z"] : []),
  ].join(" ");

export const flattenCompositeShapePath = (
  path: CompositeShapePath,
): ShapePoint[] => {
  const points: ShapePoint[] = [path.start];
  let previous = path.start;
  for (const command of path.commands) {
    if (command.type === "line") {
      points.push(command.to);
    } else {
      const cubic = curve(
        pointFrom<LocalPoint>(...previous),
        pointFrom<LocalPoint>(...command.control1),
        pointFrom<LocalPoint>(...command.control2),
        pointFrom<LocalPoint>(...command.to),
      );
      const steps = Math.max(
        16,
        Math.ceil(
          Math.max(
            pointDistance(cubic[0], cubic[1]),
            pointDistance(cubic[1], cubic[2]),
            pointDistance(cubic[2], cubic[3]),
          ) / 4,
        ),
      );
      for (let i = 1; i <= steps; i++) {
        points.push(bezierEquation(cubic, i / steps));
      }
    }
    previous = command.to;
  }
  return points;
};

export const getCompositeShapeGlobalPath = (
  element: ExcalidrawCompositeShapeElement,
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
  element: ExcalidrawCompositeShapeElement,
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
  element: ExcalidrawCompositeShapeElement,
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
  element: ExcalidrawCompositeShapeElement,
): GlobalPoint[] => {
  return flattenCompositeShapePath(getCompositeShapeGlobalPath(element)).map(
    ([x, y]) => pointFrom<GlobalPoint>(x, y),
  );
};
