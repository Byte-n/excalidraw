/**
 * Composite shape entry point. The shape-id registry, outline geometry and
 * derived calculations live under `./compositeShape/`; this module re-exports
 * the public surface.
 */
export type { BaseShapeId } from "./types";

export type { CompositeShapePath } from "./compositeShape/outline";
export {
  compositeShapePathToSvg,
  flattenCompositeShapePath,
  getCompositeShapeCornerRadius,
} from "./compositeShape/outline";

export type { CompositeShapeControlPoint } from "./compositeShape/registry";
export {
  BASE_SHAPE_IDS,
  CUBE_CONTROL_POINT_MAX,
  CUBE_CONTROL_POINT_MIN,
  baseShapeData,
  getCompositeShapeControlPoints,
  getCompositeShapePoints,
  getCompositeShapeTextBounds,
  isBaseShapeId,
  isCompositeShapeElement,
  isCompositeShapeId,
  isCompositeShapeIdIn,
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

export { assertBaseShapeData } from "./compositeShape/validation";
