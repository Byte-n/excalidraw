import { invariant, isTransparent, type Bounds } from "@excalidraw/common";
import {
  curveIntersectLineSegment,
  isPointWithinBounds,
  lineSegment,
  lineSegmentIntersectionPoints,
  pointFrom,
  pointFromVector,
  pointRotateRads,
  pointsEqual,
  polygonFromPoints,
  polygonIncludesPoint,
  vectorFromPoint,
  vectorNormalize,
  vectorScale,
} from "@excalidraw/math";

import {
  ellipse,
  ellipseSegmentInterceptPoints,
} from "@excalidraw/math/ellipse";

import type {
  Curve,
  GlobalPoint,
  LineSegment,
  LocalPoint,
  Radians,
} from "@excalidraw/math";

import type { ElementTitleBounds } from "@excalidraw/excalidraw/types";

import { isPathALoop } from "./utils";
import {
  getCompositeShapeGeometry,
  getCompositeShapeGlobalHitPaths,
  getCompositeShapeGlobalHitPoints,
  getCompositeShapeGlobalPath,
  getCompositeShapeGlobalPoints,
  getCompositeShapeOffsetPaths,
  isCompositeShapeOpen,
  isShapeElement,
} from "./compositeShape";
import {
  getMindmapNodeGeometry,
  getMindmapShapeId,
  isMindmapElementHidden,
} from "./mindmap";
import {
  doBoundsIntersect,
  elementCenterPoint,
  getCenterForBounds,
  getCubicBezierCurveBound,
  getElementBounds,
  pointInsideBounds,
} from "./bounds";
import {
  isBindableElement,
  isFrameLikeElement,
  isFreeDrawElement,
  isIframeLikeElement,
  isImageElement,
  isLinearElement,
  isTableElement,
  isTextElement,
} from "./typeChecks";
import {
  deconstructLinearOrFreeDrawElement,
  deconstructRectanguloidElement,
} from "./utils";

import { LinearElementEditor } from "./linearElementEditor";

import { distanceToElement } from "./distance";

import { getBindingGap } from "./binding";

import { hasBackground } from "./comparisons";

import { getFreedrawFillPolygon, getFreedrawMaxStrokeRadius } from "./shape";

import type { CompositeShapePath } from "./compositeShape";

import type {
  ElementsMap,
  ExcalidrawBindableElement,
  ExcalidrawElement,
  ExcalidrawEllipseElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawLinearElement,
  ExcalidrawRectanguloidElement,
  ExcalidrawShapeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
  Ordered,
} from "./types";

export const shouldTestInside = (element: ExcalidrawElement) => {
  if (element.type === "arrow" || element.type === "mindmap-edge") {
    return false;
  }

  // 组合形状按其完整范围可选，不受背景填充左右；开放形状用矩形文本区，
  // 闭合形状还会被下面的真实轮廓进一步约束。
  if (
    element.type === "composite" ||
    element.type === "flow" ||
    element.type === "sequence" ||
    element.type === "dataflow"
  ) {
    return true;
  }

  const isDraggableFromInside =
    (hasBackground(element) && !isTransparent(element.backgroundColor)) ||
    // the table body is content chrome: clicking a cell's blank area (or the
    // low-contrast border) selects and moves the table, mirroring filled
    // shapes. Children hit-tested above the table keep their priority.
    isTableElement(element) ||
    isIframeLikeElement(element) ||
    isTextElement(element);

  if (element.type === "line") {
    return isDraggableFromInside && isPathALoop(element.points);
  }

  if (element.type === "freedraw") {
    return isDraggableFromInside && isPathALoop(element.points);
  }

  return isDraggableFromInside || isImageElement(element);
};

export type HitTestArgs = {
  point: GlobalPoint;
  element: ExcalidrawElement;
  threshold: number;
  elementsMap: ElementsMap;
  titleBound?: ElementTitleBounds | null;
  overrideShouldTestInside?: boolean;
};

let cachedPoint: GlobalPoint | null = null;
let cachedElement: WeakRef<ExcalidrawElement> | null = null;
let cachedThreshold: number = Infinity;
let cachedHit: boolean = false;
let cachedOverrideShouldTestInside = false;
let cachedTitleBound: ElementTitleBounds | null = null;

const titleBoundsEqual = (
  a: ElementTitleBounds | null,
  b: ElementTitleBounds | null,
) =>
  a === b ||
  (!!a &&
    !!b &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height);

export const hitElementItself = ({
  point,
  element,
  threshold,
  elementsMap,
  titleBound = null,
  overrideShouldTestInside = false,
}: HitTestArgs) => {
  if (isMindmapElementHidden(element, elementsMap)) {
    return false;
  }
  // Return cached result if the same point and element version is tested again.
  // A cached hit stays valid for any larger threshold, while a cached miss
  // stays valid only for a threshold no larger than the cached one (a larger
  // threshold could turn a miss into a hit).
  if (
    cachedPoint &&
    pointsEqual(point, cachedPoint) &&
    (cachedHit ? cachedThreshold <= threshold : cachedThreshold >= threshold) &&
    overrideShouldTestInside === cachedOverrideShouldTestInside &&
    titleBoundsEqual(titleBound, cachedTitleBound)
  ) {
    const derefElement = cachedElement?.deref();
    if (
      derefElement &&
      derefElement.id === element.id &&
      derefElement.version === element.version &&
      derefElement.versionNonce === element.versionNonce
    ) {
      return cachedHit;
    }
  }

  // Hit test against an element's title
  const hitTitle = titleBound
    ? isPointWithinBounds(
        pointFrom(titleBound.x - threshold, titleBound.y - threshold),
        point,
        pointFrom(
          titleBound.x + titleBound.width + threshold,
          titleBound.y + titleBound.height + threshold,
        ),
      )
    : false;

  // Hit test against the extended, rotated bounding box of the element first
  const bounds =
    isShapeElement(element) && isCompositeShapeOpen(element.shape.id)
      ? ([
          element.x,
          element.y,
          element.x + element.width,
          element.y + element.height,
        ] as Bounds)
      : getElementBounds(element, elementsMap, true);
  const hitBounds = isPointInRotatedBounds(
    point,
    bounds,
    element.angle,
    // Freedraw bounds follow the centerline points, but the ink extends past them
    isFreeDrawElement(element)
      ? threshold + getFreedrawMaxStrokeRadius(element)
      : threshold,
  );

  // PERF: Bail out early if the point is not even in the
  // rotated bounding box or not hitting the frame name (saves 99%)
  if (!hitBounds && !hitTitle) {
    return false;
  }

  // Do the precise (and relatively costly) hit test
  const hitElement = (
    overrideShouldTestInside ? true : shouldTestInside(element)
  )
    ? // Since `inShape` tests STRICTLY againt the insides of a shape
      // we would need `onShape` as well to include the "borders"
      isPointInElement(point, element, elementsMap) ||
      isPointOnElementOutline(point, element, elementsMap, threshold)
    : isPointOnElementOutline(point, element, elementsMap, threshold);

  const result = hitElement || hitTitle;

  // Cache end result
  cachedPoint = point;
  cachedElement = new WeakRef(element);
  cachedThreshold = threshold;
  cachedOverrideShouldTestInside = overrideShouldTestInside;
  cachedTitleBound = titleBound;
  cachedHit = result;

  return result;
};

const isPointInRotatedBounds = (
  point: GlobalPoint,
  bounds: Bounds,
  angle: Radians,
  tolerance = 0,
) => {
  const adjustedPoint =
    angle === 0
      ? point
      : pointRotateRads(point, getCenterForBounds(bounds), -angle as Radians);

  return isPointWithinBounds(
    pointFrom(bounds[0] - tolerance, bounds[1] - tolerance),
    adjustedPoint,
    pointFrom(bounds[2] + tolerance, bounds[3] + tolerance),
  );
};

export const hitElementBoundingBox = (
  point: GlobalPoint,
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  tolerance = 0,
) => {
  const bounds = getElementBounds(element, elementsMap, true);
  return isPointInRotatedBounds(point, bounds, element.angle, tolerance);
};

export const hitElementBoundingBoxOnly = (
  hitArgs: HitTestArgs,
  elementsMap: ElementsMap,
) =>
  !hitElementItself(hitArgs) &&
  // 线性元素的标签属于元素本身（即使落在包围盒外）
  !hitElementLabel(hitArgs.point, hitArgs.element, elementsMap) &&
  hitElementBoundingBox(hitArgs.point, hitArgs.element, elementsMap);

export const hitElementLabel = (
  point: GlobalPoint,
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): boolean => {
  // 线性元素的标签没有独立文字元素，直接命中区域布局
  if (isLinearElement(element)) {
    if (!element.texts?.label?.text) {
      return false;
    }
    const layout = LinearElementEditor.getLabelSceneLayout(
      element,
      elementsMap,
    );
    return (
      point[0] >= layout.x &&
      point[0] <= layout.x + layout.width &&
      point[1] >= layout.y &&
      point[1] <= layout.y + layout.height
    );
  }

  return false;
};

const bindingBorderTest = (
  element: NonDeleted<ExcalidrawBindableElement>,
  [x, y]: Readonly<GlobalPoint>,
  elementsMap: NonDeletedSceneElementsMap,
  tolerance: number = 0,
): boolean => {
  const p = pointFrom<GlobalPoint>(x, y);
  const shouldTestInside =
    // disable fullshape snapping for frame elements so we
    // can bind to frame children
    !isFrameLikeElement(element);

  // PERF: Run a cheap test to see if the binding element
  // is even close to the element
  const t = Math.max(1, tolerance);
  const bounds = [x - t, y - t, x + t, y + t] as Bounds;
  const elementBounds = getElementBounds(element, elementsMap);
  if (!doBoundsIntersect(bounds, elementBounds)) {
    return false;
  }

  // If the element is inside a frame, we should clip the element
  if (element.containerRef?.elementId) {
    const enclosingFrame = elementsMap.get(element.containerRef?.elementId);
    if (enclosingFrame && isFrameLikeElement(enclosingFrame)) {
      const enclosingFrameBounds = getElementBounds(
        enclosingFrame,
        elementsMap,
      );
      if (!pointInsideBounds(p, enclosingFrameBounds)) {
        return false;
      }
    }
  }

  // Do the intersection test against the element since it's close enough
  const intersections = intersectElementWithLineSegment(
    element,
    elementsMap,
    lineSegment(elementCenterPoint(element, elementsMap), p),
  );
  const distance = distanceToElement(element, elementsMap, p);

  if (isShapeElement(element) && isCompositeShapeOpen(element.shape.id)) {
    return distance <= t;
  }

  return shouldTestInside
    ? intersections.length === 0 || distance <= tolerance
    : intersections.length > 0 && distance <= t;
};

export const getAllHoveredElementAtPoint = (
  point: Readonly<GlobalPoint>,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  elementsMap: NonDeletedSceneElementsMap,
  tolerance?: number,
): NonDeleted<ExcalidrawBindableElement>[] => {
  const candidateElements: NonDeleted<ExcalidrawBindableElement>[] = [];
  // We need to to hit testing from front (end of the array) to back (beginning of the array)
  // because array is ordered from lower z-index to highest and we want element z-index
  // with higher z-index
  for (let index = elements.length - 1; index >= 0; --index) {
    const element = elements[index];

    invariant(
      !element.isDeleted,
      "Elements in the function parameter for getAllElementsAtPositionForBinding() should not contain deleted elements",
    );

    if (
      isBindableElement(element, false) &&
      bindingBorderTest(element, point, elementsMap, tolerance)
    ) {
      candidateElements.push(element);

      if (hasBackground(element) && !isTransparent(element.backgroundColor)) {
        break;
      }
    }
  }

  return candidateElements;
};

export const getHoveredElementForBinding = (
  point: Readonly<GlobalPoint>,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  elementsMap: NonDeletedSceneElementsMap,
  tolerance?: number,
): NonDeleted<ExcalidrawBindableElement> | null => {
  const candidateElements = getAllHoveredElementAtPoint(
    point,
    elements,
    elementsMap,
    tolerance,
  );

  if (!candidateElements || candidateElements.length === 0) {
    return null;
  }

  if (candidateElements.length === 1) {
    return candidateElements[0];
  }

  // Prefer smaller shapes
  return candidateElements
    .sort(
      (a, b) => b.width ** 2 + b.height ** 2 - (a.width ** 2 + a.height ** 2),
    )
    .pop() as NonDeleted<ExcalidrawBindableElement>;
};

export const getHoveredElementForFocusPoint = (
  point: GlobalPoint,
  arrow: ExcalidrawLinearElement,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  elementsMap: NonDeletedSceneElementsMap,
  tolerance?: number,
): NonDeleted<ExcalidrawBindableElement> | null => {
  const candidateElements: NonDeleted<ExcalidrawBindableElement>[] = [];
  // We need to to hit testing from front (end of the array) to back (beginning of the array)
  // because array is ordered from lower z-index to highest and we want element z-index
  // with higher z-index
  for (let index = elements.length - 1; index >= 0; --index) {
    const element = elements[index];

    invariant(
      !element.isDeleted,
      "Elements in the function parameter for getAllElementsAtPositionForBinding() should not contain deleted elements",
    );

    if (
      isBindableElement(element, false) &&
      bindingBorderTest(element, point, elementsMap, tolerance)
    ) {
      candidateElements.push(element);
    }
  }

  if (!candidateElements || candidateElements.length === 0) {
    return null;
  }

  if (candidateElements.length === 1) {
    return candidateElements[0];
  }

  const distanceFilteredCandidateElements = candidateElements
    // Resolve by distance
    .filter(
      (el) =>
        distanceToElement(el, elementsMap, point) <= getBindingGap(el, arrow) ||
        isPointInElement(point, el, elementsMap),
    );

  if (distanceFilteredCandidateElements.length === 0) {
    return null;
  }

  return distanceFilteredCandidateElements[0] as NonDeleted<ExcalidrawBindableElement>;
};

/**
 * Intersect a line with an element for binding test
 *
 * @param element
 * @param line
 * @param offset
 * @returns
 */
export const intersectElementWithLineSegment = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  line: LineSegment<GlobalPoint>,
  offset: number = 0,
  onlyFirst = false,
): GlobalPoint[] => {
  // First check if the line intersects the element's axis-aligned bounding box
  // as it is much faster than checking intersection against the element's shape
  const intersectorBounds = [
    Math.min(line[0][0] - offset, line[1][0] - offset),
    Math.min(line[0][1] - offset, line[1][1] - offset),
    Math.max(line[0][0] + offset, line[1][0] + offset),
    Math.max(line[0][1] + offset, line[1][1] + offset),
  ] as Bounds;
  const elementBounds = getElementBounds(element, elementsMap);

  if (!doBoundsIntersect(intersectorBounds, elementBounds)) {
    return [];
  }

  // Do the actual intersection test against the element's shape
  switch (element.type) {
    case "mindmap-node":
      if (getMindmapShapeId(element) === "pill") {
        return intersectRectanguloidWithLineSegment(
          element,
          elementsMap,
          line,
          offset,
          onlyFirst,
        );
      }
      return intersectElementWithLineSegment(
        getMindmapNodeGeometry(element),
        elementsMap,
        line,
        offset,
        onlyFirst,
      );
    case "mindmap-edge":
      return [];
    case "stickynote":
    case "image":
    case "text":
    case "iframe":
    case "embeddable":
    case "frame":
    case "selection":
    case "magicframe":
    case "table":
      // TODO(table): P1 grid-aware intersection; the table body is a rectangle
      return intersectRectanguloidWithLineSegment(
        element,
        elementsMap,
        line,
        offset,
        onlyFirst,
      );
    case "composite":
    case "flow":
    case "sequence":
    case "dataflow":
      return element.shape.id === "ellipse"
        ? intersectEllipseWithLineSegment(
            element as ExcalidrawEllipseElement,
            elementsMap,
            line,
            offset,
          )
        : intersectCompositeShapeWithLineSegment(
            element,
            line,
            offset,
            onlyFirst,
          );
    case "line":
    case "freedraw":
    case "arrow":
      return intersectLinearOrFreeDrawWithLineSegment(
        element,
        line,
        elementsMap,
        onlyFirst,
      );
  }
};

const intersectCompositeShapePathsWithLineSegment = (
  paths: GlobalPoint[][],
  segment: LineSegment<GlobalPoint>,
  closed: boolean,
  onlyFirst: boolean,
): GlobalPoint[] => {
  const intersections: GlobalPoint[] = [];
  for (const points of paths) {
    const edgeCount = closed ? points.length : points.length - 1;
    for (let i = 0; i < edgeCount; i++) {
      const hit = lineSegmentIntersectionPoints(
        lineSegment(points[i], points[(i + 1) % points.length]),
        segment,
      );
      if (hit) {
        intersections.push(hit);
        if (onlyFirst) {
          return intersections;
        }
      }
    }
  }
  return intersections;
};

const intersectCompositeShapePathWithLineSegment = (
  path: CompositeShapePath,
  segment: LineSegment<GlobalPoint>,
  onlyFirst = false,
): GlobalPoint[] => {
  const intersections: GlobalPoint[] = [];
  let previous = pointFrom<GlobalPoint>(...path.start);
  const commands = [
    ...path.commands,
    ...(path.closed ? [{ type: "line" as const, to: path.start }] : []),
  ];
  const normalizeEndpoint = (
    point: GlobalPoint,
    endpoints: readonly GlobalPoint[],
  ): GlobalPoint => {
    // The line equation can turn an exact vertex intersection into values such
    // as 100.00000000000001. Preserve the canonical path endpoint when the
    // error is below floating-point noise so bindings remain deterministic.
    const endpoint = endpoints.find(
      ([x, y]) =>
        Math.abs(point[0] - x) < 1e-10 && Math.abs(point[1] - y) < 1e-10,
    );
    if (endpoint) {
      return endpoint;
    }
    const snap = (value: number) => {
      const rounded = Math.round(value);
      return Math.abs(value - rounded) < 1e-10 ? rounded : value;
    };
    return pointFrom<GlobalPoint>(snap(point[0]), snap(point[1]));
  };
  for (const command of commands) {
    const end = pointFrom<GlobalPoint>(...command.to);
    const endpoints = [previous, end, segment[0], segment[1]];
    const hits =
      command.type === "line"
        ? [lineSegmentIntersectionPoints(lineSegment(previous, end), segment)]
        : curveIntersectLineSegment(
            [
              previous,
              pointFrom<GlobalPoint>(...command.control1),
              pointFrom<GlobalPoint>(...command.control2),
              end,
            ] as Curve<GlobalPoint>,
            segment,
          );
    for (const hit of hits) {
      if (hit) {
        intersections.push(normalizeEndpoint(hit, endpoints));
        if (onlyFirst) {
          return intersections;
        }
      }
    }
    previous = end;
  }
  return intersections;
};

const intersectCompositeShapeWithLineSegment = (
  element: ExcalidrawShapeElement,
  segment: LineSegment<GlobalPoint>,
  offset: number,
  onlyFirst = false,
): GlobalPoint[] => {
  if (offset !== 0 && (offset > 0 || !isCompositeShapeOpen(element.shape.id))) {
    return intersectCompositeShapePathsWithLineSegment(
      getCompositeShapeOffsetPaths(element, offset),
      segment,
      true,
      onlyFirst,
    );
  }

  // Lifelines declare a narrower hit geometry than their outline envelope.
  // Use it for lasso/eraser/frame segments; the offset branch above keeps the
  // long-standing outline behavior for binding/fill flows.
  const geometry = getCompositeShapeGeometry(element);
  if (geometry.hitPaths.length) {
    const intersections: GlobalPoint[] = [];
    for (const path of getCompositeShapeGlobalHitPaths(element)) {
      intersections.push(
        ...intersectCompositeShapePathWithLineSegment(path, segment, onlyFirst),
      );
      if (onlyFirst && intersections.length) {
        return intersections;
      }
    }
    return intersections;
  }

  return intersectCompositeShapePathWithLineSegment(
    getCompositeShapeGlobalPath(element),
    segment,
    onlyFirst,
  );
};

const curveIntersections = (
  curves: Curve<GlobalPoint>[],
  segment: LineSegment<GlobalPoint>,
  intersections: GlobalPoint[],
  center: GlobalPoint,
  angle: Radians,
  onlyFirst = false,
) => {
  for (const c of curves) {
    // Optimize by doing a cheap bounding box check first
    const b1 = getCubicBezierCurveBound(c[0], c[1], c[2], c[3]);
    const b2 = [
      Math.min(segment[0][0], segment[1][0]),
      Math.min(segment[0][1], segment[1][1]),
      Math.max(segment[0][0], segment[1][0]),
      Math.max(segment[0][1], segment[1][1]),
    ] as Bounds;

    if (!doBoundsIntersect(b1, b2)) {
      continue;
    }

    const hits = curveIntersectLineSegment(c, segment);

    if (hits.length > 0) {
      for (const j of hits) {
        intersections.push(pointRotateRads(j, center, angle));
      }

      if (onlyFirst) {
        return intersections;
      }
    }
  }

  return intersections;
};

const lineIntersections = (
  lines: LineSegment<GlobalPoint>[],
  segment: LineSegment<GlobalPoint>,
  intersections: GlobalPoint[],
  center: GlobalPoint,
  angle: Radians,
  onlyFirst = false,
) => {
  for (const l of lines) {
    const intersection = lineSegmentIntersectionPoints(l, segment);
    if (intersection) {
      intersections.push(pointRotateRads(intersection, center, angle));

      if (onlyFirst) {
        return intersections;
      }
    }
  }

  return intersections;
};

const intersectLinearOrFreeDrawWithLineSegment = (
  element: ExcalidrawLinearElement | ExcalidrawFreeDrawElement,
  segment: LineSegment<GlobalPoint>,
  elementsMap: ElementsMap,
  onlyFirst = false,
): GlobalPoint[] => {
  // NOTE: This is the only one which return the decomposed elements
  // rotated! This is due to taking advantage of roughjs definitions.
  const [lines, curves] = deconstructLinearOrFreeDrawElement(
    element,
    elementsMap,
  );
  const intersections: GlobalPoint[] = [];

  for (const l of lines) {
    const intersection = lineSegmentIntersectionPoints(l, segment);
    if (intersection) {
      intersections.push(intersection);

      if (onlyFirst) {
        return intersections;
      }
    }
  }

  for (const c of curves) {
    // Optimize by doing a cheap bounding box check first
    const b1 = getCubicBezierCurveBound(c[0], c[1], c[2], c[3]);
    const b2 = [
      Math.min(segment[0][0], segment[1][0]),
      Math.min(segment[0][1], segment[1][1]),
      Math.max(segment[0][0], segment[1][0]),
      Math.max(segment[0][1], segment[1][1]),
    ] as Bounds;

    if (!doBoundsIntersect(b1, b2)) {
      continue;
    }

    const hits = curveIntersectLineSegment(c, segment, {
      iterLimit: 10,
    });

    if (hits.length > 0) {
      intersections.push(...hits);

      if (onlyFirst) {
        return intersections;
      }
    }
  }

  return intersections;
};

const intersectRectanguloidWithLineSegment = (
  element: ExcalidrawRectanguloidElement,
  elementsMap: ElementsMap,
  segment: LineSegment<GlobalPoint>,
  offset: number = 0,
  onlyFirst = false,
): GlobalPoint[] => {
  const center = elementCenterPoint(element, elementsMap);
  // To emulate a rotated rectangle we rotate the point in the inverse angle
  // instead. It's all the same distance-wise.
  const rotatedA = pointRotateRads<GlobalPoint>(
    segment[0],
    center,
    -element.angle as Radians,
  );
  const rotatedB = pointRotateRads<GlobalPoint>(
    segment[1],
    center,
    -element.angle as Radians,
  );
  const rotatedIntersector = lineSegment(rotatedA, rotatedB);

  // Get the element's building components we can test against
  const [sides, corners] = deconstructRectanguloidElement(element, offset);

  const intersections: GlobalPoint[] = [];

  lineIntersections(
    sides,
    rotatedIntersector,
    intersections,
    center,
    element.angle,
    onlyFirst,
  );

  if (onlyFirst && intersections.length > 0) {
    return intersections;
  }

  curveIntersections(
    corners,
    rotatedIntersector,
    intersections,
    center,
    element.angle,
    onlyFirst,
  );

  return intersections;
};

/**
 *
 * @param element
 * @param a
 * @param b
 * @returns
 */
/**
 *
 * @param element
 * @param a
 * @param b
 * @returns
 */
const intersectEllipseWithLineSegment = (
  element: ExcalidrawEllipseElement,
  elementsMap: ElementsMap,
  l: LineSegment<GlobalPoint>,
  offset: number = 0,
): GlobalPoint[] => {
  const center = elementCenterPoint(element, elementsMap);
  const primitive = getCompositeShapeGeometry(element).primitive;
  if (primitive?.kind !== "ellipse") {
    throw new Error("Missing ellipse geometry");
  }

  const rotatedA = pointRotateRads(l[0], center, -element.angle as Radians);
  const rotatedB = pointRotateRads(l[1], center, -element.angle as Radians);

  return ellipseSegmentInterceptPoints(
    ellipse(center, primitive.radiusX + offset, primitive.radiusY + offset),
    lineSegment(rotatedA, rotatedB),
  ).map((p) => pointRotateRads(p, center, element.angle));
};

/**
 * Check if the given point is considered on the given shape's border
 *
 * @param point
 * @param element
 * @param tolerance
 * @returns
 */
const isPointOnElementOutline = (
  point: GlobalPoint,
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  tolerance = 1,
) => distanceToElement(element, elementsMap, point) <= tolerance;

/**
 * Check if the given point is considered inside the element's border
 *
 * @param point
 * @param element
 * @returns
 */
export const isPointInElement = (
  point: GlobalPoint,
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): boolean => {
  if (
    element.type === "mindmap-edge" ||
    isMindmapElementHidden(element, elementsMap)
  ) {
    return false;
  }
  if (isShapeElement(element) && isCompositeShapeOpen(element.shape.id)) {
    const center = pointFrom<GlobalPoint>(
      element.x + element.width / 2,
      element.y + element.height / 2,
    );
    const localPoint = pointRotateRads(
      point,
      center,
      -element.angle as Radians,
    );
    return isPointWithinBounds(
      pointFrom(element.x, element.y),
      localPoint,
      pointFrom(element.x + element.width, element.y + element.height),
    );
  }
  if (
    element.type === "mindmap-node" &&
    getMindmapShapeId(element) !== "pill"
  ) {
    return isPointInElement(
      point,
      getMindmapNodeGeometry(element),
      elementsMap,
    );
  }
  if (
    (isLinearElement(element) || isFreeDrawElement(element)) &&
    !isPathALoop(element.points)
  ) {
    // There isn't any "inside" for a non-looping path
    return false;
  }

  if (isFreeDrawElement(element)) {
    // Test before the rotated-bounds check below: the smoothed fill can bulge
    // past the recorded points, and how much of it those bounds would clip
    // depends on the angle. An asymmetric loop's rotated bounds center is also
    // not its rotation pivot.
    const [x1, y1, x2, y2] = getElementBounds(element, elementsMap, true);
    const [px, py] = pointRotateRads(
      point,
      pointFrom<GlobalPoint>((x1 + x2) / 2, (y1 + y2) / 2),
      -element.angle as Radians,
    );

    // The fill follows the centerline rather than the stroke outline, and uses
    // the same even-odd rule as RoughJS's filled curves.
    return polygonIncludesPoint(
      pointFrom<LocalPoint>(px - element.x, py - element.y),
      getFreedrawFillPolygon(element),
    );
  }

  const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);

  if (!isPointWithinBounds(pointFrom(x1, y1), point, pointFrom(x2, y2))) {
    return false;
  }

  if (isShapeElement(element)) {
    const geometry = getCompositeShapeGeometry(element);
    if (geometry.hitPaths.length) {
      return getCompositeShapeGlobalHitPoints(element).some((points) =>
        polygonIncludesPoint(point, polygonFromPoints(points)),
      );
    }
    const primitive = geometry.primitive;
    if (primitive?.kind === "ellipse") {
      const center = pointFrom<GlobalPoint>(
        element.x + primitive.center[0],
        element.y + primitive.center[1],
      );
      const [px, py] = pointRotateRads(
        point,
        center,
        -element.angle as Radians,
      );
      const dx = (px - center[0]) / primitive.radiusX;
      const dy = (py - center[1]) / primitive.radiusY;
      return dx * dx + dy * dy <= 1;
    }
    return polygonIncludesPoint(
      point,
      polygonFromPoints(getCompositeShapeGlobalPoints(element)),
    );
  }

  const center = pointFrom<GlobalPoint>((x1 + x2) / 2, (y1 + y2) / 2);
  const otherPoint = pointFromVector(
    vectorScale(
      vectorNormalize(vectorFromPoint(point, center, 0.1)),
      Math.max(element.width, element.height) * 2,
    ),
    center,
  );
  const intersector = lineSegment(point, otherPoint);
  const intersections = intersectElementWithLineSegment(
    element,
    elementsMap,
    intersector,
  ).filter((p, pos, arr) => arr.findIndex((q) => pointsEqual(q, p)) === pos);

  return intersections.length % 2 === 1;
};
