/**
 * Composite shape entry point. The shape-id registry, outline geometry and
 * derived calculations live under `./compositeShape/`; this module re-exports
 * the public surface.
 */
export type { ShapeId } from "./types";

export type { CompositeShapePath } from "./compositeShape/outline";
export {
  compositeShapePathToSvg,
  flattenCompositeShapePath,
  getCompositeShapeCornerRadius,
} from "./compositeShape/outline";

export type { CompositeShapeControlPoint } from "./compositeShape/registry";
export {
  SHAPE_IDS,
  CUBE_CONTROL_POINT_MAX,
  CUBE_CONTROL_POINT_MIN,
  buildShapeData,
  getCompositeShapeControlPoints,
  getCompositeShapePoints,
  getCompositeShapeTextBounds,
  isShapeId,
  isShapeElement,
  isShapeWithId,
  isShapeWithIdIn,
  isCompositeShapeOpen,
  updateCompositeShapeControlPoint,
} from "./compositeShape/registry";

export type { CompositeShapeTextBounds } from "./compositeShape/textBounds";

export type { CompositeShapeTextFitMode } from "./compositeShape/textLayout";
export {
  getCompositeShapeDimensionsForText,
  getCompositeShapePaddedTextBounds,
  getCompositeShapeTextFitMinSize,
  getCompositeShapeTextFitMode,
} from "./compositeShape/textLayout";

export type { CompositeShapeGeometry } from "./compositeShape/geometry";
export {
  getCompositeShapeAnchors,
  getCompositeShapeGeometry,
  getCompositeShapeGlobalPath,
  getCompositeShapeGlobalPoints,
  getCompositeShapeOffsetPaths,
} from "./compositeShape/geometry";

export {
  assertShapeData,
  assertShapeElementType,
} from "./compositeShape/validation";

export {
  SHAPE_FAMILIES,
  BASIC_SHAPE_IDS,
  FLOWCHART_SHAPE_IDS,
  ELEMENT_TYPE_BY_FAMILY,
  shapeFamily,
  shapeElementType,
  isBasicShapeId,
  isFlowchartShapeId,
} from "./compositeShape/family";

export type { ShapeFamily } from "./compositeShape/family";
export type { ShapeElementType, BasicShapeId, FlowchartShapeId } from "./types";
