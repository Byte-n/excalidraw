/**
 * Composite shape entry point. The shape-id registry, outline geometry and
 * derived calculations live under `./compositeShape/`; this module re-exports
 * the public surface.
 */
export type { ShapeId } from "./types";

export type {
  CompositeShapePath,
  CompositeShapeDetailPath,
} from "./compositeShape/outline";
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

export type {
  CompositeShapeGeometry,
  CompositeShapeSelectionFrame,
} from "./compositeShape/geometry";
export {
  getCompositeShapeAnchors,
  getCompositeShapeGeometry,
  getCompositeShapeGlobalHitPaths,
  getCompositeShapeGlobalHitPoints,
  getCompositeShapeGlobalPath,
  getCompositeShapeGlobalPoints,
  getCompositeShapeOffsetPaths,
  getCompositeShapeSelectionFrame,
  hasCompositeShapeSelectionFrame,
} from "./compositeShape/geometry";

export {
  assertShapeData,
  assertShapeElementType,
} from "./compositeShape/validation";

export {
  SHAPE_FAMILIES,
  BASIC_SHAPE_IDS,
  FLOWCHART_SHAPE_IDS,
  SEQUENCE_SHAPE_IDS,
  ELEMENT_TYPE_BY_FAMILY,
  shapeFamily,
  shapeElementType,
  isBasicShapeId,
  isFlowchartShapeId,
  isSequenceShapeId,
  isShapeElementType,
} from "./compositeShape/family";

export type { ShapeFamily } from "./compositeShape/family";
export type {
  ShapeElementType,
  BasicShapeId,
  FlowchartShapeId,
  SequenceShapeId,
} from "./types";

export {
  SEQUENCE_DEFAULT_POLE_LENGTH,
  SEQUENCE_MIN_POLE_LENGTH,
  SEQUENCE_MIN_HEAD_WIDTH,
  SEQUENCE_MIN_HEAD_HEIGHT,
  SEQUENCE_HIT_HALF_WIDTH,
  SEQUENCE_POLE_LENGTH,
  SEQUENCE_ACTIVATION_WIDTH,
  SEQUENCE_ACTIVATION_HEIGHT,
  SEQUENCE_MIN_ACTIVATION_OFFSET,
  SEQUENCE_MIN_ACTIVATION_HEIGHT,
  SEQUENCE_ACTIVATION_ANCHOR_INSET,
  SEQUENCE_ACTIVATION_ANCHOR_SPACING,
  SEQUENCE_ACTIVATION_ANCHOR_MAX_INTERVALS,
  getSequenceActivationAnchorLocalYs,
  getSequenceActivationAnchors,
  snapSequenceActivationLocalY,
  SEQUENCE_LIFELINE_HEAD_HEIGHTS,
  SEQUENCE_LIFELINE_DEFAULT_WIDTHS,
  SEQUENCE_FRAGMENT_TAB_WIDTH,
  SEQUENCE_FRAGMENT_TAB_HEIGHT,
  SEQUENCE_FRAGMENT_TAB_BEVEL,
  SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT,
  SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT,
  SEQUENCE_FRAGMENT_ROW_DIVIDER_DASH,
  isSequenceLifelineShapeId,
  isSequenceLifelineElement,
  isSequenceFragmentElement,
  isActivationElement,
  isPointInSequenceLifelineHead,
  isPointOnSequenceLifelinePole,
  getSequenceLifelinePoleActivationPlacement,
  getSequenceLifelineActivationCenter,
  getSequenceLifelineActivationLocalY,
  clampSequenceActivationLocalY,
  getSequenceLifelineLocalPoint,
  getSequenceLifelineGlobalPoint,
  getActivationAnchor,
  getActivationAnchorAtSceneY,
  normalizeSequenceLifelineGeometry,
  clampSequenceLifelineHeight,
  getSequenceLifelineDefaultSize,
  getSequenceLifelineGeometry,
  getSequenceLifelineHitPaths,
  getSequenceLifelineTextBounds,
  getSequencePoleLength,
  getSequencePolePath,
  getSequenceElementBox,
  getSequenceFragmentTabPath,
  getSequenceFragmentTextBounds,
  getSequenceFragmentRowLayout,
  getSequenceFragmentRowPaths,
  createSequenceFragmentInitialRows,
  getSequenceFragmentRowIndexAt,
  getSequenceFragmentRowSeparatorYs,
  getSequenceFragmentInsertionBoundaries,
  getSequenceFragmentRowMinHeight,
  SEQUENCE_FRAGMENT_DEFAULT_OPERATOR,
  SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_X,
  SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_Y,
  SEQUENCE_FRAGMENT_TAB_MAX_RIGHT_INSET,
  fitSequenceFragmentOperator,
  insertSequenceFragmentRow,
  resizeSequenceFragmentRow,
  moveSequenceFragmentRow,
  deleteSequenceFragmentRow,
  SEQUENCE_FRAGMENT_HEADER_MIN_HEIGHT,
  normalizeSequenceFragmentRows,
  normalizeSequenceFragmentGeometry,
  appendSequenceFragmentRow,
  getSequenceFragmentResize,
  drawSequenceLifeline,
} from "./compositeShape/sequenceOutline";

export type {
  SequenceLifelineId,
  SequenceLifelineElement,
  SequenceLifelineLocalPoint,
  SequenceHeadGeometry,
  SequenceFragmentRowLayout,
  SequenceFragmentRowAddition,
  SequenceFragmentResize,
  SequenceFragmentRowsUpdate,
} from "./compositeShape/sequenceOutline";
