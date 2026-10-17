import {
  BRACE_REFERENCE_HEIGHT,
  BRACE_REFERENCE_WIDTH,
  clampValue,
  compositeShapePathToSvg,
  flattenCompositeShapePath,
  getBaseDiamondOutline,
  getBaseDiamondPoints,
  getBaseEllipseOutline,
  getBaseRectangleOutline,
  getBraceOutline,
  getBubbleOutline,
  getCircularSectorOutline,
  getCloudOutline,
  getCompositeShapeCornerRadius,
  getCrossOutline,
  getCylinderFrontEdge,
  getCylinderOutline,
  getCylinderSideFace,
  getCylinderTopFace,
  getFcCircleOutline,
  getFcCylinderFrontEdge,
  getFcCylinderOutline,
  getFcDelayOutline,
  getFcDiamondOutline,
  getFcDocumentOutline,
  getFcHexagonOutline,
  getFcHorizCylinderOutline,
  getFcHorizCylinderSeam,
  getFcManualInputOutline,
  getFcOffPageConnectorOutline,
  getFcParallelogramOutline,
  getFcPredefinedProcessOutline,
  getFcRoundRectOutline,
  getFcTerminatorOutline,
  getFcTrapezoidOutline,
  getRectangleBubbleOutline,
  getRoundedRectOutline,
  getStarOutline,
  pathFromPoints,
  regularPolygon,
  type CompositeShapePath,
  type ShapePoint,
} from "./outline";
import {
  TEXT_GAP,
  getConvexTextBounds,
  insetRect,
  type CompositeShapeTextBounds,
} from "./textBounds";

import type { Drawable, Options } from "roughjs/bin/core";
import type { RoughGenerator } from "roughjs/bin/generator";

import type { CompositeShapeGeometry } from "./geometry";
import type {
  BaseShapeData,
  BaseShapeId,
  ExcalidrawCompositeShapeElement,
  ExcalidrawElement,
} from "../types";

/** Input every registration entry receives: the element box and shape data. */
export type CompositeShapeGeometryInput = Pick<
  ExcalidrawCompositeShapeElement,
  "width" | "height" | "shape"
> &
  Partial<Pick<ExcalidrawCompositeShapeElement, "roundness">>;

type ShapeInput<K extends BaseShapeId> = {
  width: number;
  height: number;
  shape: Extract<BaseShapeData, { id: K }>;
  roundness?: ExcalidrawCompositeShapeElement["roundness"];
};

type ShapeSizeInput = { width: number; height: number };

/** Persisted parameters of one id, without the id/schemaVersion discriminants. */
type ShapeParams<K extends BaseShapeId> = Omit<
  Extract<BaseShapeData, { id: K }>,
  "id" | "schemaVersion"
>;

type ShapePoints<K extends BaseShapeId> = (
  input: ShapeInput<K>,
) => ShapePoint[];
type ShapeTextBoundsFn<K extends BaseShapeId> = (
  input: ShapeInput<K>,
) => CompositeShapeTextBounds;
type ShapeOutlineFn<K extends BaseShapeId> = (
  input: ShapeInput<K>,
) => CompositeShapePath;
type ShapeDetailsFn<K extends BaseShapeId> = (
  input: ShapeInput<K>,
) => CompositeShapePath[];
type ShapeFillFace = NonNullable<CompositeShapeGeometry["fillFaces"]>[number];
type ShapeFillFacesFn<K extends BaseShapeId> = (
  input: ShapeInput<K>,
) => ShapeFillFace[];
type ShapeAnchorsFn<K extends BaseShapeId> = (
  input: ShapeInput<K>,
) => [ShapePoint, ShapePoint, ShapePoint, ShapePoint];
type ShapePrimitive = NonNullable<CompositeShapeGeometry["primitive"]>;
type ShapePrimitiveFn<K extends BaseShapeId> = (
  input: ShapeInput<K>,
) => ShapePrimitive;

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

type ShapeControlPointsFn<K extends BaseShapeId> = (
  input: ShapeInput<K>,
) => CompositeShapeControlPoint[];

/**
 * Rewrites one draggable control point. Returns the unchanged shape when the
 * value is already in place, and `null` when the kind is not handled here.
 */
type ShapeControlUpdate<K extends BaseShapeId> = (
  kind: CompositeShapeControlPoint["kind"],
  localX: number,
  localY: number,
  width: number,
  height: number,
  shape: Extract<BaseShapeData, { id: K }>,
) => BaseShapeData | null;

/** Persisted-parameter payload validated at file/library/clipboard boundaries. */
type ShapeParamSpec = {
  key: string;
  validate(data: unknown): boolean;
};

/** Rough drawing context handed to a registration's `draw` entry. */
export type ShapeDrawContext = {
  generator: RoughGenerator;
  element: ExcalidrawCompositeShapeElement;
  geometry: CompositeShapeGeometry;
  /** Rough options for the element; `continuousPath` flags open/curved outlines. */
  options(continuousPath: boolean): Options;
  /** Face fill for a shaded multi-face shape. */
  shadeFill(fill: string, tone: ShapeFillFace["tone"]): string;
};

export type ShapeDraw = (context: ShapeDrawContext) => Drawable | Drawable[];

type ShapeRegistration<K extends BaseShapeId> = {
  /** Persisted parameters created for this id. */
  defaultParams: ShapeParams<K>;
  /** Local-coordinate vertex table (a polyline view of the outline). */
  points: ShapePoints<K>;
  /** Text-safe rectangle in local coordinates, before text padding. */
  textBounds: ShapeTextBoundsFn<K>;
  /** Whether the outline is an open path (brace family only). */
  open: boolean;
  /** Main contour. */
  outline: ShapeOutlineFn<K>;
  /** Extra stroke-only contours. */
  details?: ShapeDetailsFn<K>;
  /** Faces filled with shaded tones. */
  fillFaces?: ShapeFillFacesFn<K>;
  /** Explicit cardinal anchors, when the shape wants them. */
  anchors?: ShapeAnchorsFn<K>;
  /** Geometric primitive the hit-test uses. */
  primitive?: ShapePrimitiveFn<K>;
  /** Draggable control points. */
  controlPoints?: ShapeControlPointsFn<K>;
  /** Rewrite of one control point. */
  updateControlPoint?: ShapeControlUpdate<K>;
  /** Persisted-parameter key and validator. */
  param?: ShapeParamSpec;
  /** The id's dedicated rough drawing; absent ids draw the outline path. */
  draw?: ShapeDraw;
};

export const CUBE_CONTROL_POINT_MIN = 0.05;
export const CUBE_CONTROL_POINT_MAX = 0.95;

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
  "right-triangle",
  "left-triangle",
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
  "fc-round-rect",
  "fc-terminator",
  "fc-diamond",
  "fc-document",
  "fc-parallelogram",
  "fc-cylinder",
  "fc-horiz-cylinder",
  "fc-predefined-process",
  "fc-manual-input",
  "fc-trapezoid",
  "fc-delay",
  "fc-hexagon",
  "fc-off-page-connector",
  "fc-circle",
] as const;

export const isBaseShapeId = (id: unknown): id is BaseShapeId =>
  typeof id === "string" && (BASE_SHAPE_IDS as readonly string[]).includes(id);

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

const isFiniteInRange = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

export const hasOnlyKeys = (value: object, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, i) => key === expected[i])
  );
};

const validateTriangleParams = (data: unknown) => {
  const value = data as Record<string, unknown> | undefined;
  return (
    !!value &&
    hasOnlyKeys(value, ["apexX"]) &&
    isFiniteInRange(value.apexX, 0, 1)
  );
};

const validateTrapezoidParams = (data: unknown) => {
  const value = data as Record<string, unknown> | undefined;
  return (
    !!value &&
    hasOnlyKeys(value, ["narrowWidthRatio", "narrowEdge"]) &&
    isFiniteInRange(value.narrowWidthRatio, 0.05, 1) &&
    (value.narrowEdge === "top" || value.narrowEdge === "bottom")
  );
};

const validateCubeParams = (data: unknown) => {
  const value = data as Record<string, unknown> | undefined;
  const controlPoint = value?.controlPoint as
    | Record<string, unknown>
    | undefined;
  return (
    !!value &&
    !!controlPoint &&
    hasOnlyKeys(value, ["controlPoint"]) &&
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
    )
  );
};

const validateCircularParams = (data: unknown) => {
  const value = data as Record<string, unknown> | undefined;
  return (
    !!value &&
    hasOnlyKeys(value, [
      "centralAngle",
      "radius",
      "sectorRatio",
      "startRadialLineAngle",
    ]) &&
    isFiniteInRange(value.centralAngle, 0.01, 360) &&
    isFiniteInRange(value.radius, 0.01, 1e6) &&
    isFiniteInRange(value.sectorRatio, 0, 1) &&
    isFiniteInRange(value.startRadialLineAngle, -360, 360)
  );
};

type CircularSectorData = {
  centralAngle: number;
  radius: number;
  sectorRatio: number;
  startRadialLineAngle: number;
};

/** Control points of the pie family; the ring adds an inner-radius handle. */
const circularControlPoints = (
  width: number,
  height: number,
  data: CircularSectorData,
  ring: boolean,
): CompositeShapeControlPoint[] => {
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
  if (ring) {
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
};

/** Radial-line drag shared by the pie family. */
const dragCircularSector = (
  kind: CompositeShapeControlPoint["kind"],
  localX: number,
  localY: number,
  width: number,
  height: number,
  data: CircularSectorData,
): CircularSectorData => {
  const angle = normalizeDegrees(
    (Math.atan2(localY - height / 2, localX - width / 2) * 180) / Math.PI,
  );
  const radius = clampValue(
    Math.hypot(localX - width / 2, localY - height / 2) /
      Math.min(width, height),
    0.01,
    0.5,
  );
  const startAngle =
    kind === "sector-start" ? angle : data.startRadialLineAngle;
  const endAngle =
    kind === "sector-end" ? angle : startAngle + data.centralAngle;
  const centralAngle =
    kind === "sector-start" && data.centralAngle >= 360 - 1e-6
      ? 360
      : clampValue(normalizeDegrees(endAngle - startAngle), 0.01, 360);
  return {
    ...data,
    radius,
    centralAngle,
    startRadialLineAngle: startAngle,
  };
};

const updatePieControlPoint: ShapeControlUpdate<"pie"> = (
  kind,
  localX,
  localY,
  width,
  height,
  shape,
) => {
  if (
    kind !== "sector-start" &&
    kind !== "sector-end" &&
    kind !== "ring-radius"
  ) {
    return null;
  }
  if (Math.hypot(localX - width / 2, localY - height / 2) <= 1e-6) {
    return null;
  }
  return {
    ...shape,
    pie: dragCircularSector(kind, localX, localY, width, height, shape.pie),
  };
};

const updateRingControlPoint: ShapeControlUpdate<"circular-ring"> = (
  kind,
  localX,
  localY,
  width,
  height,
  shape,
) => {
  if (
    kind !== "sector-start" &&
    kind !== "sector-end" &&
    kind !== "ring-radius"
  ) {
    return null;
  }
  const distance = Math.hypot(localX - width / 2, localY - height / 2);
  if (distance <= 1e-6) {
    return null;
  }
  if (kind === "ring-radius") {
    const sectorRatio = clampValue(
      distance /
        getCircularShapeRadius(width, height, shape.circularRing.radius),
      0,
      1,
    );
    if (sameControlValue(sectorRatio, shape.circularRing.sectorRatio)) {
      return shape;
    }
    return { ...shape, circularRing: { ...shape.circularRing, sectorRatio } };
  }
  return {
    ...shape,
    circularRing: dragCircularSector(
      kind,
      localX,
      localY,
      width,
      height,
      shape.circularRing,
    ),
  };
};

// ---------------------------------------------------------------------------
// Dedicated rough drawings.

/** Default drawing: the outline path, followed by any detail paths. */
export const drawShapeOutlinePath: ShapeDraw = ({
  generator,
  geometry,
  options,
}) => {
  const pathOptions = { ...options(false), preserveVertices: true };
  const outline = generator.path(
    compositeShapePathToSvg(geometry.outline),
    pathOptions,
  );
  if (!geometry.details.length) {
    return outline;
  }
  return [
    outline,
    ...geometry.details.map((path) =>
      generator.path(compositeShapePathToSvg(path), {
        ...pathOptions,
        fill: undefined,
      }),
    ),
  ];
};

const drawShapePolygon: ShapeDraw = ({ generator, element, options }) =>
  generator.polygon(getCompositeShapePoints(element), options(false));

const drawOpenOutline: ShapeDraw = ({ generator, geometry, options }) =>
  generator.path(compositeShapePathToSvg(geometry.outline), {
    ...options(true),
    fill: undefined,
  });

const drawShadedFaces: ShapeDraw = ({
  generator,
  element,
  geometry,
  options,
  shadeFill,
}) => {
  const roughOptions = options(false);
  const faceOptions = { ...roughOptions, preserveVertices: true };
  const faces = roughOptions.fill
    ? geometry.fillFaces!.map(({ path, tone }, index) =>
        generator.path(compositeShapePathToSvg(path), {
          ...faceOptions,
          fill: shadeFill(roughOptions.fill!, tone),
          stroke: "none",
          strokeWidth: 0,
          seed: element.seed + index + 1,
        }),
      )
    : [];
  const outline = generator.path(compositeShapePathToSvg(geometry.outline), {
    ...faceOptions,
    fill: undefined,
  });
  const detailSets = geometry.details.flatMap(
    (path) =>
      generator.path(compositeShapePathToSvg(path), {
        ...faceOptions,
        fill: undefined,
      }).sets,
  );
  return [...faces, { ...outline, sets: [...outline.sets, ...detailSets] }];
};

const drawEllipseShape: ShapeDraw = ({ generator, geometry, options }) => {
  const primitive = geometry.primitive;
  if (primitive?.kind !== "ellipse") {
    throw new Error("Missing ellipse geometry");
  }
  return generator.ellipse(
    primitive.center[0],
    primitive.center[1],
    primitive.radiusX * 2,
    primitive.radiusY * 2,
    options(false),
  );
};

const drawDiamondShape: ShapeDraw = ({
  generator,
  element,
  geometry,
  options,
}) => {
  const primitive = geometry.primitive;
  if (primitive?.kind !== "diamond") {
    throw new Error("Missing diamond geometry");
  }
  if (element.roundness) {
    return generator.path(
      compositeShapePathToSvg(geometry.outline),
      options(true),
    );
  }
  return generator.polygon(primitive.points, options(false));
};

const drawRectangleShape: ShapeDraw = ({ generator, geometry, options }) => {
  const primitive = geometry.primitive;
  if (primitive?.kind !== "rectangle") {
    throw new Error("Missing rectangle geometry");
  }
  return primitive.radius
    ? generator.path(compositeShapePathToSvg(geometry.outline), options(true))
    : generator.rectangle(
        0,
        0,
        primitive.width,
        primitive.height,
        options(false),
      );
};

// ---------------------------------------------------------------------------
// Registration builders. Each entry reads as "what this id looks like".

/** The outline is the source of truth; the vertex table is its flattening. */
const defineShape = <K extends BaseShapeId>(
  outline: ShapeOutlineFn<K>,
  textBounds: ShapeTextBoundsFn<K>,
  extras: Partial<ShapeRegistration<K>> = {},
): ShapeRegistration<K> => ({
  defaultParams: {} as ShapeParams<K>,
  points: (input) => flattenCompositeShapePath(outline(input)),
  textBounds,
  open: false,
  draw: drawShapeOutlinePath,
  ...extras,
  outline,
});

/** The vertex table is the source of truth; the outline closes it as a polygon. */
const polygonShape = <K extends BaseShapeId>(
  points: ShapePoints<K>,
  makeTextBounds: (points: ShapePoints<K>) => ShapeTextBoundsFn<K>,
  extras: Partial<ShapeRegistration<K>> = {},
): ShapeRegistration<K> => ({
  defaultParams: {} as ShapeParams<K>,
  points,
  textBounds: makeTextBounds(points),
  open: false,
  draw: drawShapePolygon,
  ...extras,
  outline: (input) => pathFromPoints(points(input), true),
});

/** A polygon id whose declared outline builder is its source of truth. */
const convexPolygonShape = <K extends BaseShapeId>(
  outline: ShapeOutlineFn<K>,
): ShapeRegistration<K> =>
  defineShape(
    outline,
    (input) =>
      getConvexTextBounds(
        flattenCompositeShapePath(outline(input)),
        input.width,
        input.height,
      ),
    { draw: drawShapePolygon },
  );

/** Text area computed from the convex hull of the shape's own vertex table. */
const convexTextBoundsFrom =
  <K extends BaseShapeId>(points: ShapePoints<K>): ShapeTextBoundsFn<K> =>
  (input) =>
    getConvexTextBounds(points(input), input.width, input.height);

const ellipseInscribedTextBounds = <K extends BaseShapeId>(
  input: ShapeInput<K>,
): CompositeShapeTextBounds => {
  const { width: w, height: h } = input;
  const halfWidth = Math.max(0.005, (w / 2 - TEXT_GAP) / Math.SQRT2);
  const halfHeight = Math.max(0.005, (h / 2 - TEXT_GAP) / Math.SQRT2);
  return insetRect(
    w / 2 - halfWidth,
    h / 2 - halfHeight,
    w / 2 + halfWidth,
    h / 2 + halfHeight,
  );
};

const cylinderTextBounds = <K extends BaseShapeId>(
  input: ShapeInput<K>,
): CompositeShapeTextBounds => {
  const { width: w, height: h } = input;
  const ry = Math.min(w * 0.2, h / 4);
  const inset = Math.max(TEXT_GAP, Math.min(w, ry) * 0.08);
  return insetRect(inset, 2 * ry + TEXT_GAP, w - inset, h - ry - TEXT_GAP);
};

/** Text area for shapes whose visible body ends above a lower annotation. */
const roundedBodyTextBounds =
  (
    radiusOf: (width: number, bodyHeight: number) => number,
    bodyHeightOf: (height: number) => number,
  ) =>
  <K extends BaseShapeId>(input: ShapeInput<K>): CompositeShapeTextBounds => {
    const { width: w, height: h } = input;
    const bodyHeight = bodyHeightOf(h);
    const radius = radiusOf(w, bodyHeight);
    const corner = Math.max(0, radius - TEXT_GAP) / Math.SQRT2;
    return insetRect(
      radius - corner,
      radius - corner,
      w - radius + corner,
      bodyHeight - radius + corner,
    );
  };

/** Text area for shapes rounded by a single corner radius. */
const roundedCornerTextBounds =
  (radiusOf: (width: number, height: number) => number) =>
  <K extends BaseShapeId>(input: ShapeInput<K>): CompositeShapeTextBounds => {
    const { width: w, height: h } = input;
    const radius = radiusOf(w, h);
    const corner = Math.max(0, radius - TEXT_GAP) / Math.SQRT2;
    return insetRect(
      radius - corner,
      radius - corner,
      w - radius + corner,
      h - radius + corner,
    );
  };

const rectangleOutline = (input: ShapeSizeInput) =>
  getBaseRectangleOutline(input.width, input.height, 0);

/** Triangle vertex table with the apex standing at `apexX` of the width. */
const trianglePointsAtApex = (
  apexX: number,
  { width, height }: ShapeSizeInput,
): ShapePoint[] => [
  [apexX * width, 0],
  [width, height],
  [0, height],
];

const trianglePoints: ShapePoints<"triangle"> = (input) =>
  trianglePointsAtApex(input.shape.triangle.apexX, input);

const rightTrianglePoints: ShapePoints<"right-triangle"> = (input) =>
  trianglePointsAtApex(0, input);

const leftTrianglePoints: ShapePoints<"left-triangle"> = (input) =>
  trianglePointsAtApex(1, input);

/** Text area of a triangle whose apex sits at `apexX` of the width. */
const triangleTextBoundsAt = (
  apexX: number,
  input: ShapeSizeInput,
): CompositeShapeTextBounds => {
  const { width: w, height: h } = input;
  const top = Math.min(h - TEXT_GAP, h * 0.55);
  const left = apexX * (1 - top / h) + TEXT_GAP / w;
  return insetRect(
    left * w,
    top,
    Math.min(w - TEXT_GAP, (left + top / h - 0.08) * w),
    h - TEXT_GAP,
  );
};

const trapezoidPoints: ShapePoints<"trapezoid"> = (input) => {
  const { width: w, height: h, shape } = input;
  const narrow = (w * shape.trapezoid.narrowWidthRatio) / 2;
  return shape.trapezoid.narrowEdge === "top"
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
};

const cubePoints: ShapePoints<"cube"> = (input) => {
  const { width: w, height: h, shape } = input;
  const frontRightX = w * shape.cube.controlPoint.x;
  const depthX = w - frontRightX;
  const depthY = h * shape.cube.controlPoint.y;
  return [
    [0, depthY],
    [depthX, 0],
    [w, 0],
    [w, h - depthY],
    [frontRightX, h],
    [0, h],
  ];
};

const forwardArrowPoints: ShapePoints<"forward-arrow"> = (input) => {
  const { width: w, height: h } = input;
  return [
    [0, h * 0.28],
    [w * 0.62, h * 0.28],
    [w * 0.62, 0],
    [w, h / 2],
    [w * 0.62, h],
    [w * 0.62, h * 0.72],
    [0, h * 0.72],
  ];
};

const backwardArrowPoints: ShapePoints<"backward-arrow"> = (input) => {
  const { width: w, height: h } = input;
  return [
    [w, h * 0.28],
    [w * 0.38, h * 0.28],
    [w * 0.38, 0],
    [0, h / 2],
    [w * 0.38, h],
    [w * 0.38, h * 0.72],
    [w, h * 0.72],
  ];
};

const doubleArrowPoints: ShapePoints<"double-arrow"> = (input) => {
  const { width: w, height: h } = input;
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
};

const parallelogramPoints: ShapePoints<"parallelogram"> = (input) => {
  const { width: w, height: h } = input;
  const skew = w * 0.18;
  return [
    [skew, 0],
    [w, 0],
    [w - skew, h],
    [0, h],
  ];
};

const rightPentagonPoints: ShapePoints<"right-pentagon"> = (input) => {
  const { width: w, height: h } = input;
  return [
    [0, 0],
    [w * 0.65, 0],
    [w, h / 2],
    [w * 0.65, h],
    [0, h],
  ];
};

const stepPoints: ShapePoints<"step"> = (input) => {
  const { width: w, height: h } = input;
  return [
    [0, 0],
    [w * 0.62, 0],
    [w, h / 2],
    [w * 0.62, h],
    [0, h],
    [w * 0.2, h * 0.5],
  ];
};

export const SHAPES: { [K in BaseShapeId]: ShapeRegistration<K> } = {
  rectangle: defineShape(
    rectangleOutline,
    (input) =>
      insetRect(
        TEXT_GAP,
        TEXT_GAP,
        input.width - TEXT_GAP,
        input.height - TEXT_GAP,
      ),
    {
      primitive: (input) => ({
        kind: "rectangle",
        width: input.width,
        height: input.height,
        radius: 0,
      }),
      draw: drawRectangleShape,
    },
  ),
  diamond: defineShape(
    (input) => {
      const { width: w, height: h } = input;
      const points = getBaseDiamondPoints(w, h);
      return getBaseDiamondOutline(
        points,
        getCompositeShapeCornerRadius(points[0][0], input.roundness),
        getCompositeShapeCornerRadius(points[1][1], input.roundness),
      );
    },
    (input) => {
      const { width: w, height: h } = input;
      const normal = Math.hypot(1 / w, 1 / h);
      const scale = Math.max(0.01, 0.5 - TEXT_GAP * normal);
      return insetRect(
        (w * (1 - scale)) / 2,
        (h * (1 - scale)) / 2,
        (w * (1 + scale)) / 2,
        (h * (1 + scale)) / 2,
      );
    },
    {
      primitive: (input) => {
        const { width: w, height: h } = input;
        const points = getBaseDiamondPoints(w, h);
        return {
          kind: "diamond",
          points,
          verticalRadius: getCompositeShapeCornerRadius(
            points[0][0],
            input.roundness,
          ),
          horizontalRadius: getCompositeShapeCornerRadius(
            points[1][1],
            input.roundness,
          ),
        };
      },
      draw: drawDiamondShape,
    },
  ),
  ellipse: defineShape(
    (input) => getBaseEllipseOutline(input.width, input.height),
    ellipseInscribedTextBounds,
    {
      primitive: (input) => ({
        kind: "ellipse",
        center: [input.width / 2, input.height / 2],
        radiusX: input.width / 2,
        radiusY: input.height / 2,
      }),
      draw: drawEllipseShape,
    },
  ),
  cross: defineShape(
    (input) => getCrossOutline(input.width, input.height),
    (input) => {
      const inset = 33.241798 / 120;
      return insetRect(
        inset * input.width,
        inset * input.height,
        (1 - inset) * input.width,
        (1 - inset) * input.height,
      );
    },
  ),
  "brace-reverse": defineShape(
    (input) => getBraceOutline(input.width, input.height, true),
    (input) => {
      const { width: w, height: h } = input;
      const scale = Math.min(
        h / BRACE_REFERENCE_HEIGHT,
        w / BRACE_REFERENCE_WIDTH,
      );
      return insetRect(
        TEXT_GAP,
        TEXT_GAP,
        w - 22.647705 * scale - TEXT_GAP,
        h - TEXT_GAP,
      );
    },
    { open: true, draw: drawOpenOutline },
  ),
  brace: defineShape(
    (input) => getBraceOutline(input.width, input.height, false),
    (input) => {
      const { width: w, height: h } = input;
      const scale = Math.min(
        h / BRACE_REFERENCE_HEIGHT,
        w / BRACE_REFERENCE_WIDTH,
      );
      return insetRect(
        22.647699 * scale + TEXT_GAP,
        TEXT_GAP,
        w - TEXT_GAP,
        h - TEXT_GAP,
      );
    },
    { open: true, draw: drawOpenOutline },
  ),
  cloud: defineShape(
    (input) => getCloudOutline(input.width, input.height),
    (input) =>
      insetRect(
        input.width * 0.16 + TEXT_GAP,
        input.height * 0.18 + TEXT_GAP,
        input.width * 0.84 - TEXT_GAP,
        input.height * 0.79 - TEXT_GAP,
      ),
  ),
  "double-arrow": polygonShape(doubleArrowPoints, () => (input) => {
    const { width: w, height: h } = input;
    const top = h * 0.28 + TEXT_GAP;
    const slope = (0.44 * w) / h;
    const horizontalGap = TEXT_GAP * Math.hypot(1, slope);
    return insetRect(
      w * 0.22 - slope * top + horizontalGap,
      top,
      w * 0.78 + slope * top - horizontalGap,
      h * 0.72 - TEXT_GAP,
    );
  }),
  "forward-arrow": polygonShape(forwardArrowPoints, () => (input) => {
    const { width: w, height: h } = input;
    const top = h * 0.28 + TEXT_GAP;
    const slope = (0.76 * w) / h;
    return insetRect(
      TEXT_GAP,
      top,
      w * 0.62 + slope * top - TEXT_GAP * Math.hypot(1, slope),
      h * 0.72 - TEXT_GAP,
    );
  }),
  "backward-arrow": polygonShape(backwardArrowPoints, () => (input) => {
    const { width: w, height: h } = input;
    const top = h * 0.28 + TEXT_GAP;
    const slope = (0.76 * w) / h;
    return insetRect(
      w * 0.38 - slope * top + TEXT_GAP * Math.hypot(1, slope),
      top,
      w - TEXT_GAP,
      h * 0.72 - TEXT_GAP,
    );
  }),
  octagon: polygonShape(
    (input) => regularPolygon(8, input.width, input.height, -Math.PI / 8),
    convexTextBoundsFrom,
  ),
  pentagon: polygonShape(
    (input) => regularPolygon(5, input.width, input.height),
    convexTextBoundsFrom,
  ),
  hexagon: polygonShape(
    (input) => regularPolygon(6, input.width, input.height, 0),
    convexTextBoundsFrom,
  ),
  star: defineShape(
    (input) => getStarOutline(input.width, input.height),
    (input) => {
      const { width: w, height: h } = input;
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
    },
  ),
  triangle: polygonShape(
    trianglePoints,
    () => (input) => triangleTextBoundsAt(input.shape.triangle.apexX, input),
    {
      defaultParams: { triangle: { apexX: 0.5 } },
      param: { key: "triangle", validate: validateTriangleParams },
      controlPoints: (input) => [
        {
          kind: "triangle-apex",
          x: input.shape.triangle.apexX * input.width,
          y: 0,
        },
      ],
      updateControlPoint: (kind, localX, _localY, width, _height, shape) => {
        if (kind !== "triangle-apex") {
          return null;
        }
        const apexX = clampValue(localX / width, 0, 1);
        if (sameControlValue(apexX, shape.triangle.apexX)) {
          return shape;
        }
        return { ...shape, triangle: { apexX } };
      },
    },
  ),
  "right-triangle": polygonShape(
    rightTrianglePoints,
    () => (input) => triangleTextBoundsAt(0, input),
  ),
  "left-triangle": polygonShape(
    leftTrianglePoints,
    () => (input) => triangleTextBoundsAt(1, input),
  ),
  "round-rect": defineShape(
    (input) =>
      getRoundedRectOutline(
        input.width,
        input.height,
        Math.min(input.width, input.height) * 0.18,
      ),
    roundedBodyTextBounds(
      (w, bodyHeight) => Math.min(w, bodyHeight) * 0.18,
      (h) => h,
    ),
  ),
  "rectangle-bubble": defineShape(
    (input) => getRectangleBubbleOutline(input.width, input.height),
    roundedBodyTextBounds(
      (w, bodyHeight) => Math.min(w, bodyHeight) * 0.08,
      (h) => h * 0.84,
    ),
  ),
  pill: defineShape(
    (input) =>
      getRoundedRectOutline(
        input.width,
        input.height,
        Math.min(input.width, input.height) / 2,
      ),
    roundedBodyTextBounds(
      (w, h) => Math.min(w, h) / 2,
      (h) => h,
    ),
  ),
  bubble: defineShape(
    (input) => getBubbleOutline(input.width, input.height),
    (input) =>
      insetRect(
        input.width * 0.16 + TEXT_GAP,
        input.height * 0.18 + TEXT_GAP,
        input.width * 0.84 - TEXT_GAP,
        input.height * 0.87 - TEXT_GAP,
      ),
  ),
  trapezoid: polygonShape(
    trapezoidPoints,
    () => (input) => {
      const { width: w, height: h, shape } = input;
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
    },
    {
      defaultParams: {
        trapezoid: { narrowWidthRatio: 2 / 3, narrowEdge: "top" },
      },
      param: { key: "trapezoid", validate: validateTrapezoidParams },
      controlPoints: (input) => [
        {
          kind: "trapezoid-width",
          x:
            input.width / 2 +
            (input.shape.trapezoid.narrowWidthRatio * input.width) / 2,
          y: input.shape.trapezoid.narrowEdge === "top" ? 0 : input.height,
        },
      ],
      updateControlPoint: (kind, localX, _localY, width, _height, shape) => {
        if (kind !== "trapezoid-width") {
          return null;
        }
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
          trapezoid: { ...shape.trapezoid, narrowWidthRatio },
        };
      },
    },
  ),
  parallelogram: defineShape(
    (input) => pathFromPoints(parallelogramPoints(input), true),
    convexTextBoundsFrom(parallelogramPoints),
    {
      points: parallelogramPoints,
      anchors: (input) => {
        const { width: w, height: h } = input;
        const skew = w * 0.18;
        return [
          [w - skew / 2, h / 2],
          [(w - skew) / 2, h],
          [skew / 2, h / 2],
          [(w + skew) / 2, 0],
        ];
      },
    },
  ),
  "right-pentagon": polygonShape(
    rightPentagonPoints,
    () => (input) =>
      insetRect(
        TEXT_GAP,
        TEXT_GAP,
        input.width * 0.65 - TEXT_GAP,
        input.height - TEXT_GAP,
      ),
  ),
  step: polygonShape(stepPoints, () => (input) => {
    const { width: w, height: h } = input;
    const slope = (0.76 * w) / h;
    return insetRect(
      w * 0.2 + TEXT_GAP,
      TEXT_GAP,
      w * 0.62 + slope * TEXT_GAP - TEXT_GAP * Math.hypot(1, slope),
      h - TEXT_GAP,
    );
  }),
  cube: {
    defaultParams: { cube: { controlPoint: { x: 0.82, y: 0.22 } } },
    points: cubePoints,
    textBounds: (input) => {
      const { width: w, height: h, shape } = input;
      const frontRightX = shape.cube.controlPoint.x * w;
      const top = shape.cube.controlPoint.y * h;
      const frontHeight = h - top;
      return {
        x: TEXT_GAP,
        y: top + TEXT_GAP,
        width: Math.max(0.01, frontRightX - TEXT_GAP * 2),
        height: Math.max(0.01, frontHeight - TEXT_GAP * 2),
      };
    },
    open: false,
    outline: (input) => pathFromPoints(cubePoints(input), true),
    fillFaces: (input) => {
      const { width: w, height: h, shape } = input;
      const frontRightX = w * shape.cube.controlPoint.x;
      const depthY = h * shape.cube.controlPoint.y;
      return [
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
      ];
    },
    details: (input) => {
      const { width: w, height: h, shape } = input;
      const frontRightX = w * shape.cube.controlPoint.x;
      const depthY = h * shape.cube.controlPoint.y;
      return [
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
      ];
    },
    controlPoints: (input) => [
      {
        kind: "cube-depth",
        x: input.shape.cube.controlPoint.x * input.width,
        y: input.shape.cube.controlPoint.y * input.height,
      },
    ],
    updateControlPoint: (kind, localX, localY, width, height, shape) => {
      if (kind !== "cube-depth") {
        return null;
      }
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
      return { ...shape, cube: { controlPoint: { x, y } } };
    },
    param: { key: "cube", validate: validateCubeParams },
    draw: drawShadedFaces,
  },
  cylinder: defineShape(
    (input) => getCylinderOutline(input.width, input.height),
    cylinderTextBounds,
    {
      details: (input) => [getCylinderFrontEdge(input.width, input.height)],
      fillFaces: (input) => [
        { path: getCylinderSideFace(input.width, input.height), tone: "base" },
        { path: getCylinderTopFace(input.width, input.height), tone: "light" },
      ],
      draw: drawShadedFaces,
    },
  ),
  pie: defineShape(
    (input) =>
      getCircularSectorOutline(
        input.width,
        input.height,
        input.shape.pie,
        false,
      ),
    (input) => {
      const { width: w, height: h } = input;
      const side = Math.max(TEXT_GAP * 2, Math.min(w, h) * 0.42);
      return insetRect(
        (w - side) / 2,
        (h - side) / 2,
        (w + side) / 2,
        (h + side) / 2,
      );
    },
    {
      defaultParams: {
        pie: {
          centralAngle: 270,
          radius: 0.5,
          sectorRatio: 1,
          startRadialLineAngle: 270,
        },
      },
      param: { key: "pie", validate: validateCircularParams },
      controlPoints: (input) =>
        circularControlPoints(
          input.width,
          input.height,
          input.shape.pie,
          false,
        ),
      updateControlPoint: updatePieControlPoint,
    },
  ),
  "circular-ring": defineShape(
    (input) =>
      getCircularSectorOutline(
        input.width,
        input.height,
        input.shape.circularRing,
        true,
      ),
    (input) => {
      const { width: w, height: h, shape } = input;
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
    },
    {
      defaultParams: {
        circularRing: {
          centralAngle: 270,
          radius: 0.5,
          sectorRatio: 0.5,
          startRadialLineAngle: 270,
        },
      },
      param: { key: "circularRing", validate: validateCircularParams },
      controlPoints: (input) =>
        circularControlPoints(
          input.width,
          input.height,
          input.shape.circularRing,
          true,
        ),
      updateControlPoint: updateRingControlPoint,
    },
  ),
  "fc-round-rect": defineShape(
    (input) => getFcRoundRectOutline(input.width, input.height),
    roundedCornerTextBounds((w, h) => Math.min(w, h) * 0.0875),
  ),
  "fc-terminator": defineShape(
    (input) => getFcTerminatorOutline(input.width, input.height),
    roundedCornerTextBounds((w, h) => Math.min(w, h) / 2),
  ),
  "fc-diamond": convexPolygonShape((input) =>
    getFcDiamondOutline(input.width, input.height),
  ),
  "fc-document": defineShape(
    (input) => getFcDocumentOutline(input.width, input.height),
    (input) =>
      insetRect(
        TEXT_GAP,
        TEXT_GAP,
        input.width - TEXT_GAP,
        input.height * 0.85 - TEXT_GAP,
      ),
  ),
  "fc-parallelogram": convexPolygonShape((input) =>
    getFcParallelogramOutline(input.width, input.height),
  ),
  "fc-cylinder": defineShape(
    (input) => getFcCylinderOutline(input.width, input.height),
    cylinderTextBounds,
    {
      details: (input) => [getFcCylinderFrontEdge(input.width, input.height)],
    },
  ),
  "fc-horiz-cylinder": defineShape(
    (input) => getFcHorizCylinderOutline(input.width, input.height),
    (input) => {
      const { width: w, height: h } = input;
      const rx = Math.min(h * 0.2, w / 4);
      return insetRect(
        rx + TEXT_GAP,
        TEXT_GAP,
        w - 1.875 * rx - TEXT_GAP,
        h - TEXT_GAP,
      );
    },
    {
      details: (input) => [getFcHorizCylinderSeam(input.width, input.height)],
    },
  ),
  "fc-predefined-process": defineShape(
    (input) => getFcPredefinedProcessOutline(input.width, input.height),
    (input) =>
      insetRect(
        input.width * 0.1083 + TEXT_GAP,
        TEXT_GAP,
        input.width * 0.8917 - TEXT_GAP,
        input.height - TEXT_GAP,
      ),
    {
      details: (input) => {
        const { width: w, height: h } = input;
        return [
          pathFromPoints(
            [
              [w * 0.1083, h * 0.025],
              [w * 0.1083, h * 0.975],
            ],
            false,
          ),
          pathFromPoints(
            [
              [w * 0.8917, h * 0.025],
              [w * 0.8917, h * 0.975],
            ],
            false,
          ),
        ];
      },
    },
  ),
  "fc-manual-input": convexPolygonShape((input) =>
    getFcManualInputOutline(input.width, input.height),
  ),
  "fc-trapezoid": convexPolygonShape((input) =>
    getFcTrapezoidOutline(input.width, input.height),
  ),
  "fc-delay": defineShape(
    (input) => getFcDelayOutline(input.width, input.height),
    (input) => {
      const { width: w, height: h } = input;
      const radius = h / 2;
      const corner = Math.max(0, radius - TEXT_GAP) / Math.SQRT2;
      return insetRect(
        TEXT_GAP,
        h / 2 - corner,
        w - radius + corner,
        h / 2 + corner,
      );
    },
  ),
  "fc-hexagon": convexPolygonShape((input) =>
    getFcHexagonOutline(input.width, input.height),
  ),
  "fc-off-page-connector": convexPolygonShape((input) =>
    getFcOffPageConnectorOutline(input.width, input.height),
  ),
  "fc-circle": defineShape(
    (input) => getFcCircleOutline(input.width, input.height),
    ellipseInscribedTextBounds,
  ),
};

/**
 * Widened view of the table, keyed by any id. Unknown ids resolve to
 * `undefined` so callers can choose between skipping and rejecting them.
 */
const SHAPE_TABLE = SHAPES as unknown as Partial<
  Record<BaseShapeId, ShapeRegistration<BaseShapeId>>
>;

export const getShapeRegistration = (
  id: BaseShapeId,
): ShapeRegistration<BaseShapeId> => {
  const registration = SHAPE_TABLE[id];
  if (!registration) {
    throw new Error("Unsupported composite shape");
  }
  return registration;
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

export const getCompositeShapePoints = (
  element: CompositeShapeGeometryInput,
): ShapePoint[] => getShapeRegistration(element.shape.id).points(element);

/**
 * A local rectangle that stays inside the visible body, before text padding.
 */
export const getCompositeShapeTextBounds = (
  element: Pick<ExcalidrawCompositeShapeElement, "width" | "height" | "shape">,
): CompositeShapeTextBounds =>
  getShapeRegistration(element.shape.id).textBounds(element);

export const isCompositeShapeOpen = (id: BaseShapeId): boolean =>
  getShapeRegistration(id).open;

export const baseShapeData = (id: BaseShapeId): BaseShapeData => {
  const registration = getShapeRegistration(id);
  return {
    id,
    schemaVersion: 1,
    ...registration.defaultParams,
  } as BaseShapeData;
};

export const getCompositeShapeControlPoints = (
  element: Pick<ExcalidrawCompositeShapeElement, "width" | "height" | "shape">,
): CompositeShapeControlPoint[] =>
  SHAPE_TABLE[element.shape.id]?.controlPoints?.(element) ?? [];

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
  const update = getShapeRegistration(shape.id).updateControlPoint;
  const next = update
    ? update(kind, localX, localY, width, height, shape)
    : null;
  if (!next) {
    throw new Error(`Control point ${kind} does not belong to ${shape.id}`);
  }
  return next;
};
