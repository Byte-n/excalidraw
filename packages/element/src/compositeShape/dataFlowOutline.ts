import {
  getBaseEllipseOutline,
  getBaseRectangleOutline,
  getRoundedRectOutline,
  pathFromPoints,
  type CompositeShapePath,
} from "./outline";
import {
  TEXT_GAP,
  insetRect,
  type CompositeShapeTextBounds,
} from "./textBounds";

/** Data-flow shapes use one fixed corner radius, clamped by the box. */
export const DATAFLOW_CORNER_RADIUS = 7;
/** Internal rules stop short of the rounded border by this inset. */
export const DATAFLOW_RULE_INSET = 2;
/** `df-process` draws its title rule at this y. */
export const DATAFLOW_PROCESS_TITLE_HEIGHT = 28;
/** `df-store-left-label` keeps its label column to this width. */
export const DATAFLOW_STORE_LABEL_WIDTH = 36;
/** Open-store rules sit one unit inside the element box. */
export const DATAFLOW_STORE_OPEN_RULE_INSET = 1;

const roundedOutline = (width: number, height: number): CompositeShapePath =>
  getRoundedRectOutline(width, height, DATAFLOW_CORNER_RADIUS);

const innerTextBounds = (width: number, height: number) =>
  insetRect(TEXT_GAP, TEXT_GAP, width - TEXT_GAP, height - TEXT_GAP);

export const getDataflowExternalEntityOutline = roundedOutline;

export const getDataflowProcessOutline = roundedOutline;

export const getDataflowProcessRoundOutline = roundedOutline;

export const getDataflowProcessCircleOutline = (
  width: number,
  height: number,
): CompositeShapePath => getBaseEllipseOutline(width, height);

export const getDataflowStoreOpenOutline = (
  width: number,
  height: number,
): CompositeShapePath => getBaseRectangleOutline(width, height, 0);

export const getDataflowStoreLeftLabelOutline = roundedOutline;

export const getDataflowStorePlainOutline = roundedOutline;

const horizontalRule = (y: number, width: number): CompositeShapePath =>
  pathFromPoints(
    [
      [DATAFLOW_RULE_INSET, y],
      [width - DATAFLOW_RULE_INSET, y],
    ],
    false,
  );

export const getDataflowProcessTitleRule = (
  width: number,
  _height: number,
): CompositeShapePath => horizontalRule(DATAFLOW_PROCESS_TITLE_HEIGHT, width);

export const getDataflowStoreOpenRules = (
  width: number,
  height: number,
): CompositeShapePath[] => [
  pathFromPoints(
    [
      [0, DATAFLOW_STORE_OPEN_RULE_INSET],
      [width, DATAFLOW_STORE_OPEN_RULE_INSET],
    ],
    false,
  ),
  pathFromPoints(
    [
      [0, height - DATAFLOW_STORE_OPEN_RULE_INSET],
      [width, height - DATAFLOW_STORE_OPEN_RULE_INSET],
    ],
    false,
  ),
];

export const getDataflowStoreLeftLabelRule = (
  width: number,
  height: number,
): CompositeShapePath =>
  pathFromPoints(
    [
      [DATAFLOW_STORE_LABEL_WIDTH, DATAFLOW_RULE_INSET],
      [DATAFLOW_STORE_LABEL_WIDTH, height - DATAFLOW_RULE_INSET],
    ],
    false,
  );

export const getDataflowTextBounds = (
  width: number,
  height: number,
): CompositeShapeTextBounds => innerTextBounds(width, height);

export const getDataflowProcessTitleTextBounds = (
  width: number,
  _height: number,
): CompositeShapeTextBounds =>
  insetRect(
    TEXT_GAP,
    TEXT_GAP,
    width - TEXT_GAP,
    DATAFLOW_PROCESS_TITLE_HEIGHT - TEXT_GAP,
  );

export const getDataflowProcessTextBounds = (
  width: number,
  height: number,
): CompositeShapeTextBounds =>
  insetRect(
    TEXT_GAP,
    DATAFLOW_PROCESS_TITLE_HEIGHT + TEXT_GAP,
    width - TEXT_GAP,
    height - TEXT_GAP,
  );

export const getDataflowCircleTextBounds = (
  width: number,
  height: number,
): CompositeShapeTextBounds => {
  const halfWidth = Math.max(0.005, (width / 2 - TEXT_GAP) / Math.SQRT2);
  const halfHeight = Math.max(0.005, (height / 2 - TEXT_GAP) / Math.SQRT2);
  return insetRect(
    width / 2 - halfWidth,
    height / 2 - halfHeight,
    width / 2 + halfWidth,
    height / 2 + halfHeight,
  );
};

export const getDataflowStoreLeftLabelTextBounds = (
  width: number,
  height: number,
): CompositeShapeTextBounds =>
  insetRect(
    DATAFLOW_STORE_LABEL_WIDTH + TEXT_GAP,
    TEXT_GAP,
    width - TEXT_GAP,
    height - TEXT_GAP,
  );
