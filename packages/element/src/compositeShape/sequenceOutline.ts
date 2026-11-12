import {
  DEFAULT_FONT_FAMILY,
  getFontString,
  getLineHeight,
  getVerticalOffset,
  randomId,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import { getLineHeightInPx, measureText } from "../textMeasurements";
import { wrapText } from "../textWrapping";

import {
  FC_ARC_K,
  compositeShapePathToSvg,
  getBaseRectangleOutline,
  getRoundedRectOutline,
  pathFromPoints,
  type CompositeShapeDetailPath,
  type CompositeShapePath,
  type ShapePoint,
} from "./outline";
import {
  TEXT_GAP,
  insetRect,
  type CompositeShapeTextBounds,
} from "./textBounds";

import type { Drawable, Options } from "roughjs/bin/core";

import type {
  ExcalidrawElement,
  ExcalidrawSequenceElement,
  ExcalidrawShapeElement,
  ExcalidrawTextElement,
  SequenceFragmentData,
  SequenceFragmentRow,
  SequenceShapeData,
} from "../types";
import type { ShapeDraw } from "./registry";
import type { TransformHandleDirection } from "../transformHandles";

/**
 * Local-coordinate geometry and drawing for the sequence (Lark
 * sequence-diagram) shapes.
 *
 * Envelope vs. appearance (deliberate): every lifeline declares its `outline`
 * as the whole element box so bounds, hit-testing, anchors, line segments and
 * export viewBox derive from the full envelope — that is what keeps the dashed
 * lifeline pole inside the bounding box and selectable. The visible head glyph,
 * its stroke-only attachments and the pole are painted only by the id's custom
 * `draw`, never by the outline path.
 */

/** Default pole length used when a lifeline is created. */
export const SEQUENCE_DEFAULT_POLE_LENGTH = 360;

/** Minimum pole length enforced when a lifeline is resized or restored. */
export const SEQUENCE_MIN_POLE_LENGTH = 40;

/** Minimum head dimensions accepted by the custom resize gesture. */
export const SEQUENCE_MIN_HEAD_WIDTH = 24;
export const SEQUENCE_MIN_HEAD_HEIGHT = 24;

/**
 * @deprecated use `SEQUENCE_DEFAULT_POLE_LENGTH`. Kept as an alias for
 * callers that still refer to the old constant.
 */
export const SEQUENCE_POLE_LENGTH = SEQUENCE_DEFAULT_POLE_LENGTH;

/** Persisted head heights, sampled from the Lark sequence sample. */
export const SEQUENCE_LIFELINE_HEAD_HEIGHTS = {
  "sc-lifeline-entity": 68.272,
  "sc-lifeline-control": 74.272,
  "sc-lifeline-boundary": 68.272,
  "sc-lifeline-actor": 118.272,
  "sc-lifeline-queue": 60,
  "sc-lifeline-data-base": 90,
  "sc-lifeline-object": 60,
  "sc-lifeline-collection": 68,
} as const;

export type SequenceLifelineId = keyof typeof SEQUENCE_LIFELINE_HEAD_HEIGHTS;

/** Default head widths, sampled from the Lark sequence sample. */
export const SEQUENCE_LIFELINE_DEFAULT_WIDTHS: Record<
  SequenceLifelineId,
  number
> = {
  "sc-lifeline-entity": 64,
  "sc-lifeline-control": 64,
  "sc-lifeline-boundary": 76,
  "sc-lifeline-actor": 84,
  "sc-lifeline-queue": 100,
  "sc-lifeline-data-base": 68,
  "sc-lifeline-object": 120,
  "sc-lifeline-collection": 118,
};

export const isSequenceLifelineShapeId = (
  id: string,
): id is SequenceLifelineId =>
  Object.prototype.hasOwnProperty.call(SEQUENCE_LIFELINE_HEAD_HEIGHTS, id);

/**
 * Narrowing predicate for a persisted sequence element whose shape is one of
 * the eight lifelines. Structural so it can be used at JSON boundaries without
 * importing the registry.
 */
export const isSequenceLifelineElement = <T extends ExcalidrawElement>(
  element: T,
): element is T &
  ExcalidrawSequenceElement & {
    shape: Extract<SequenceShapeData, { id: SequenceLifelineId }>;
  } => {
  const shape = (element as Partial<ExcalidrawSequenceElement>).shape;
  return (
    element.type === "sequence" &&
    !!shape &&
    isSequenceLifelineShapeId(shape.id)
  );
};

/** Default activation bar size, shared by preset defaults and pole placement. */
export const SEQUENCE_ACTIVATION_WIDTH = 30;
export const SEQUENCE_ACTIVATION_HEIGHT = 100;

/** Clearance kept between an auto-created activation and the pole ends. */
export const SEQUENCE_MIN_ACTIVATION_OFFSET = 8;

/** Minimum height of an activation bar (width is fixed, height is the only axis). */
export const SEQUENCE_MIN_ACTIVATION_HEIGHT = 20;

/** Inset kept from an activation's corners for automatic connection anchors. */
export const SEQUENCE_ACTIVATION_ANCHOR_INSET = 8;

/** Preferred spacing between automatic connection anchors along an edge. */
export const SEQUENCE_ACTIVATION_ANCHOR_SPACING = 24;

/** Upper bound on the number of intervals per edge (anchors per edge + 1). */
export const SEQUENCE_ACTIVATION_ANCHOR_MAX_INTERVALS = 8;

/**
 * Local y coordinates of the automatic connection anchors on an activation's
 * left/right edges. The set is symmetric around the vertical center (so the
 * midpoint is always an anchor), stays away from the corners, and never
 * includes the top/bottom edges.
 */
export const getSequenceActivationAnchorLocalYs = (
  height: number,
): number[] => {
  if (!(height > 0)) {
    return [];
  }
  const inset = Math.min(SEQUENCE_ACTIVATION_ANCHOR_INSET, height / 2);
  const usable = height - inset * 2;
  if (usable <= 0) {
    return [height / 2];
  }
  let intervals = Math.max(
    2,
    Math.min(
      SEQUENCE_ACTIVATION_ANCHOR_MAX_INTERVALS,
      Math.round(usable / SEQUENCE_ACTIVATION_ANCHOR_SPACING),
    ),
  );
  // Keep an even interval count so the vertical midpoint is always an anchor.
  if (intervals % 2 !== 0) {
    intervals += 1;
  }
  const step = usable / intervals;
  return Array.from(
    { length: intervals + 1 },
    (_, index) => inset + index * step,
  );
};

/** Nearest automatic anchor y on an activation edge (clamped by construction). */
export const snapSequenceActivationLocalY = (
  height: number,
  localY: number,
): number => {
  const anchors = getSequenceActivationAnchorLocalYs(height);
  if (!anchors.length) {
    return localY;
  }
  return anchors.reduce((best, candidate) =>
    Math.abs(candidate - localY) < Math.abs(best - localY) ? candidate : best,
  );
};

/**
 * Automatic connection anchors for an activation: multiple points along the
 * left and right edges only (local coordinates, unrotated element box).
 */
export const getSequenceActivationAnchors = (
  width: number,
  height: number,
): ShapePoint[] => {
  const anchors: ShapePoint[] = [];
  for (const y of getSequenceActivationAnchorLocalYs(height)) {
    anchors.push([0, y], [width, y]);
  }
  return anchors;
};

/**
 * Narrowing predicate for `sc-activation`. Structural (same reason as
 * `isSequenceLifelineElement`) so it can be used at JSON boundaries without
 * importing the registry.
 */
export const isActivationElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): element is T &
  ExcalidrawSequenceElement & {
    shape: Extract<SequenceShapeData, { id: "sc-activation" }>;
  } => {
  const shape = (
    element as Partial<ExcalidrawSequenceElement> | null | undefined
  )?.shape;
  return (
    !!element &&
    element.type === "sequence" &&
    !!shape &&
    shape.id === "sc-activation"
  );
};

/** A sequence element narrowed to one of the eight lifelines. */
export type SequenceLifelineElement = ExcalidrawSequenceElement & {
  shape: Extract<SequenceShapeData, { id: SequenceLifelineId }>;
};

export type SequenceLifelineLocalPoint = { x: number; y: number };

/** Scene point → the lifeline's element-local frame (origin at element.x/y). */
export const getSequenceLifelineLocalPoint = (
  element: ExcalidrawSequenceElement,
  globalX: number,
  globalY: number,
): SequenceLifelineLocalPoint => {
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const [x, y] = pointRotateRads(
    pointFrom<GlobalPoint>(globalX, globalY),
    center,
    -element.angle as Radians,
  );
  return { x: x - element.x, y: y - element.y };
};

/** Element-local point → scene point, rotating about the element center. */
export const getSequenceLifelineGlobalPoint = (
  element: ExcalidrawSequenceElement,
  localX: number,
  localY: number,
): GlobalPoint => {
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  return pointRotateRads(
    pointFrom<GlobalPoint>(element.x + localX, element.y + localY),
    center,
    element.angle,
  );
};

/**
 * Whether a scene point falls on the dashed pole (not the head) within
 * `slop` scene units of the pole center line.
 */
export const isPointOnSequenceLifelinePole = (
  element: ExcalidrawElement,
  globalX: number,
  globalY: number,
  slop: number = SEQUENCE_HIT_HALF_WIDTH,
): boolean => {
  if (!isSequenceLifelineElement(element)) {
    return false;
  }
  const local = getSequenceLifelineLocalPoint(element, globalX, globalY);
  const headHeight = element.shape.lifeline.headHeight;
  const poleEnd =
    headHeight + getSequencePoleLength(element.height, headHeight);
  return (
    local.y >= headHeight &&
    local.y <= poleEnd &&
    Math.abs(local.x - element.width / 2) <= slop
  );
};

/**
 * Activation-center local y clamped to stay inside the pole: keeps
 * `SEQUENCE_MIN_ACTIVATION_OFFSET` clearance at both ends; a pole shorter than
 * the bar centers the bar on the pole.
 */
export const clampSequenceActivationLocalY = (
  lifeline: SequenceLifelineElement,
  localY: number,
  activationHeight: number = SEQUENCE_ACTIVATION_HEIGHT,
): number => {
  const headHeight = lifeline.shape.lifeline.headHeight;
  const poleEnd =
    headHeight + getSequencePoleLength(lifeline.height, headHeight);
  const half = activationHeight / 2;
  const lower = headHeight + SEQUENCE_MIN_ACTIVATION_OFFSET + half;
  const upper = poleEnd - SEQUENCE_MIN_ACTIVATION_OFFSET - half;
  return lower <= upper
    ? Math.min(Math.max(localY, lower), upper)
    : (headHeight + poleEnd) / 2;
};

/**
 * Scene center + angle for an activation attached to the pole at `localY`.
 * `localY` is clamped so the bar never leaves the pole.
 */
export const getSequenceLifelineActivationCenter = (
  lifeline: SequenceLifelineElement,
  localY: number,
  activationHeight: number = SEQUENCE_ACTIVATION_HEIGHT,
): { center: { x: number; y: number }; angle: Radians; localY: number } => {
  const clamped = clampSequenceActivationLocalY(
    lifeline,
    localY,
    activationHeight,
  );
  const [x, y] = getSequenceLifelineGlobalPoint(
    lifeline,
    lifeline.width / 2,
    clamped,
  );
  return { center: { x, y }, angle: lifeline.angle, localY: clamped };
};

/** Unclamped local y of a scene point in the lifeline's frame. */
export const getSequenceLifelineActivationLocalY = (
  lifeline: SequenceLifelineElement,
  globalX: number,
  globalY: number,
): number => getSequenceLifelineLocalPoint(lifeline, globalX, globalY).y;

/**
 * Placement of an activation created by clicking the pole: horizontally
 * centered on the pole, with the **pointer y as the activation's top edge**
 * (the bar grows downward). The resulting center is clamped inside the pole
 * with `SEQUENCE_MIN_ACTIVATION_OFFSET` clearance, so near the pole ends the
 * bar shifts up to stay inside. Returns the rotated scene center, the
 * lifeline angle and the (clamped) center local y persisted by the link.
 */
export const getSequenceLifelinePoleActivationPlacement = (
  element: ExcalidrawElement,
  globalX: number,
  globalY: number,
): {
  center: { x: number; y: number };
  angle: Radians;
  localY: number;
} | null => {
  if (
    !isPointOnSequenceLifelinePole(element, globalX, globalY) ||
    !isSequenceLifelineElement(element)
  ) {
    return null;
  }
  const local = getSequenceLifelineLocalPoint(element, globalX, globalY);
  const { center, angle, localY } = getSequenceLifelineActivationCenter(
    element,
    local.y + SEQUENCE_ACTIVATION_HEIGHT / 2,
  );
  return { center, angle, localY };
};

/**
 * Global point on an activation's left / right edge at `localY` of the
 * activation's local frame (default: vertical center), rotated by `angle`.
 */
export const getActivationAnchor = (
  element: ExcalidrawShapeElement,
  side: "left" | "right",
  localY: number = element.height / 2,
): GlobalPoint => {
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const localX = side === "right" ? element.width : 0;
  return pointRotateRads(
    pointFrom<GlobalPoint>(element.x + localX, element.y + localY),
    center,
    element.angle,
  );
};

/**
 * Same as `getActivationAnchor`, but takes a scene-space y and clamps it into
 * the activation's vertical span first — horizontal messages keep the exit
 * y while still landing on the target bar.
 */
export const getActivationAnchorAtSceneY = (
  element: ExcalidrawShapeElement,
  side: "left" | "right",
  sceneY: number,
): GlobalPoint => {
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const [, rotatedY] = pointRotateRads(
    pointFrom<GlobalPoint>(center[0], sceneY),
    center,
    -element.angle as Radians,
  );
  const localY = Math.min(
    Math.max(rotatedY - element.y, 1),
    element.height - 1,
  );
  return getActivationAnchor(element, side, localY);
};

/**
 * Enforces the lifeline invariants: `headHeight > 0` (validated at the
 * persistence boundary) and `height >= headHeight + SEQUENCE_MIN_POLE_LENGTH`.
 * Only `height` is touched; x/y/width/angle are preserved.
 */
export const normalizeSequenceLifelineGeometry = <T extends ExcalidrawElement>(
  element: T,
): T => {
  if (!isSequenceLifelineElement(element)) {
    return element;
  }
  const minHeight =
    element.shape.lifeline.headHeight + SEQUENCE_MIN_POLE_LENGTH;
  if (element.height >= minHeight) {
    return element;
  }
  return { ...element, height: minHeight } as T;
};

/** Default element size for a lifeline: head height plus the default pole. */
export const getSequenceLifelineDefaultSize = (
  id: SequenceLifelineId,
): { width: number; height: number } => ({
  width: SEQUENCE_LIFELINE_DEFAULT_WIDTHS[id],
  height: SEQUENCE_LIFELINE_HEAD_HEIGHTS[id] + SEQUENCE_DEFAULT_POLE_LENGTH,
});

/** Clamps a proposed element height to keep at least the minimum pole. */
export const clampSequenceLifelineHeight = (
  headHeight: number,
  height: number,
): number => Math.max(headHeight + SEQUENCE_MIN_POLE_LENGTH, height);

/**
 * Whether a global point falls inside the lifeline's head box. Used to keep
 * text editing on the head while the pole remains a selection/move affordance.
 */
export const isPointInSequenceLifelineHead = (
  element: ExcalidrawElement,
  globalX: number,
  globalY: number,
): boolean => {
  if (!isSequenceLifelineElement(element)) {
    return false;
  }
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const [x, y] = pointRotateRads(
    pointFrom<GlobalPoint>(globalX, globalY),
    center,
    -element.angle as Radians,
  );
  return (
    x >= element.x &&
    x <= element.x + element.width &&
    y >= element.y &&
    y <= element.y + element.shape.lifeline.headHeight
  );
};

/**
 * Bound text is vertically centered inside the shape's text bounds. For a
 * single centered line at the sample label size (14px, default font) the
 * alphabetic baseline lands this far below the bounds' vertical center.
 * Derived from the shared text-layout helpers (`getLineHeightInPx`,
 * `getVerticalOffset`), not guessed.
 */
const LABEL_FONT_SIZE = 14;
const LABEL_LINE_HEIGHT_PX = getLineHeightInPx(
  LABEL_FONT_SIZE,
  getLineHeight(DEFAULT_FONT_FAMILY),
);
const LABEL_BASELINE_FROM_CENTER =
  getVerticalOffset(
    DEFAULT_FONT_FAMILY,
    LABEL_FONT_SIZE,
    LABEL_LINE_HEIGHT_PX,
  ) -
  LABEL_LINE_HEIGHT_PX / 2;

/**
 * Measured gap between the label baseline and the head box bottom for the
 * icon-headed lifelines (`headHeight - baseline`, identical across all four
 * sample heads). The label band's bottom edge is placed on the head bottom.
 */
const ICON_LABEL_BASELINE_GAP = 4.041;

/** Measured label baselines of the box-headed lifelines. */
const BOX_LABEL_BASELINES: Partial<Record<SequenceLifelineId, number>> = {
  "sc-lifeline-queue": 36.095,
  "sc-lifeline-object": 36.095,
  "sc-lifeline-collection": 44.095,
  "sc-lifeline-data-base": 62.095,
};

/**
 * Text-safe rectangle in local coordinates: a band centered horizontally in
 * the head, vertically placed so the rendered baseline meets the measured
 * sample baseline and the band never reaches the pole.
 */
export const getSequenceLifelineTextBounds = (
  id: SequenceLifelineId,
  width: number,
  headHeight: number,
): CompositeShapeTextBounds => {
  const measuredBaseline =
    BOX_LABEL_BASELINES[id] ?? headHeight - ICON_LABEL_BASELINE_GAP;
  const centerY = measuredBaseline - LABEL_BASELINE_FROM_CENTER;
  const half = LABEL_BASELINE_FROM_CENTER + ICON_LABEL_BASELINE_GAP;
  // The collection label centers on its front box (110 of 118) in the sample.
  const right =
    id === "sc-lifeline-collection" ? (width * 110) / 118 : width - TEXT_GAP;
  // Resizing can shrink the head below the sampled label band; keep the band
  // inside the head instead of letting text bounds leak past its bottom.
  const top = Math.min(
    Math.max(0, centerY - half),
    Math.max(0, headHeight - 0.01),
  );
  const bottom = Math.min(Math.max(top + 0.01, centerY + half), headHeight);
  return insetRect(TEXT_GAP, top, right, bottom);
};

// ---------------------------------------------------------------------------
// Path builders.

const ellipseOutline = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): CompositeShapePath => {
  const k = FC_ARC_K;
  return {
    start: [cx + rx, cy],
    commands: [
      {
        type: "cubic",
        control1: [cx + rx, cy + k * ry],
        control2: [cx + k * rx, cy + ry],
        to: [cx, cy + ry],
      },
      {
        type: "cubic",
        control1: [cx - k * rx, cy + ry],
        control2: [cx - rx, cy + k * ry],
        to: [cx - rx, cy],
      },
      {
        type: "cubic",
        control1: [cx - rx, cy - k * ry],
        control2: [cx - k * rx, cy - ry],
        to: [cx, cy - ry],
      },
      {
        type: "cubic",
        control1: [cx + k * rx, cy - ry],
        control2: [cx + rx, cy - k * ry],
        to: [cx + rx, cy],
      },
    ],
    closed: true,
  };
};

const linePath = (x1: number, y1: number, x2: number, y2: number) =>
  pathFromPoints(
    [
      [x1, y1],
      [x2, y2],
    ],
    false,
  );

const translatePath = (
  path: CompositeShapePath,
  dx: number,
  dy: number,
): CompositeShapePath => ({
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

const scalePath = (
  path: CompositeShapePath,
  sx: number,
  sy: number,
): CompositeShapePath => ({
  start: [path.start[0] * sx, path.start[1] * sy],
  commands: path.commands.map((command) =>
    command.type === "line"
      ? {
          type: "line",
          to: [command.to[0] * sx, command.to[1] * sy] as ShapePoint,
        }
      : {
          type: "cubic",
          control1: [
            command.control1[0] * sx,
            command.control1[1] * sy,
          ] as ShapePoint,
          control2: [
            command.control2[0] * sx,
            command.control2[1] * sy,
          ] as ShapePoint,
          to: [command.to[0] * sx, command.to[1] * sy] as ShapePoint,
        },
  ),
  closed: path.closed,
});

const roundedRectAt = (
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): CompositeShapePath =>
  translatePath(getRoundedRectOutline(width, height, radius), x, y);

const transformPath = (
  path: CompositeShapePath,
  map: (point: ShapePoint) => ShapePoint,
): CompositeShapePath => ({
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
});

// ---------------------------------------------------------------------------
// Sample-baked head paths (element-local coordinates at the sample size).

const queueCapsule: CompositeShapePath = {
  start: [84, 0],
  commands: [
    {
      type: "cubic",
      control1: [92.84, 0],
      control2: [100, 13.43],
      to: [100, 30],
    },
    {
      type: "cubic",
      control1: [100, 46.57],
      control2: [92.84, 60],
      to: [84, 60],
    },
    { type: "line", to: [16, 60] },
    { type: "cubic", control1: [7.16, 60], control2: [0, 46.57], to: [0, 30] },
    { type: "cubic", control1: [0, 13.43], control2: [7.16, 0], to: [16, 0] },
    { type: "line", to: [84, 0] },
  ],
  closed: true,
};

const queueInnerArc: CompositeShapePath = {
  start: [85, 59],
  commands: [
    {
      type: "cubic",
      control1: [76.72, 59],
      control2: [70, 46.57],
      to: [70, 30],
    },
    { type: "cubic", control1: [70, 13.43], control2: [76.72, 1], to: [85, 1] },
  ],
  closed: false,
};

const dataBaseCylinder: CompositeShapePath = {
  start: [0, 16],
  commands: [
    { type: "cubic", control1: [0, 7.16], control2: [15.22, 0], to: [34, 0] },
    { type: "cubic", control1: [52.78, 0], control2: [68, 7.16], to: [68, 16] },
    { type: "line", to: [68, 74] },
    {
      type: "cubic",
      control1: [68, 82.84],
      control2: [52.78, 90],
      to: [34, 90],
    },
    { type: "cubic", control1: [15.22, 90], control2: [0, 82.84], to: [0, 74] },
    { type: "line", to: [0, 16] },
  ],
  closed: true,
};

const dataBaseInnerArc: CompositeShapePath = {
  start: [67, 15.5],
  commands: [
    {
      type: "cubic",
      control1: [67, 24.06],
      control2: [52.78, 31],
      to: [34, 31],
    },
    {
      type: "cubic",
      control1: [15.22, 31],
      control2: [1, 24.06],
      to: [1, 15.5],
    },
  ],
  closed: false,
};

/** Fragment top-row tab metrics, sampled from the Lark fragment. */
export const SEQUENCE_FRAGMENT_TAB_WIDTH = 92;
export const SEQUENCE_FRAGMENT_TAB_HEIGHT = 36.272;
export const SEQUENCE_FRAGMENT_TAB_BEVEL = 12;
/** Inner padding of the fragment tab's label. */
export const SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_X = 8;
/**
 * Symmetric vertical padding keeps a one-line operator vertically centered in
 * the sample tab and applies the same inset to every wrapped line.
 */
export const SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_Y = Math.max(
  0,
  (SEQUENCE_FRAGMENT_TAB_HEIGHT - LABEL_LINE_HEIGHT_PX) / 2,
);

/**
 * The operator tab widens with its label first; once it reaches this inset
 * from the fragment's right edge, the label wraps and the tab grows in height.
 */
export const SEQUENCE_FRAGMENT_TAB_MAX_RIGHT_INSET = 24;

/**
 * Default height of a row appended by the fragment "add row" action. Chosen so
 * a new section leaves enough room for a message name and a little padding.
 */
export const SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT = 56;

/** Smallest body-row height a resize can produce. */
export const SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT = 24;

/**
 * The first row is the operator tab row (the "Opt / Loop" label). It can never
 * be shorter than the tab itself, otherwise the tab would cross the divider.
 */
export const SEQUENCE_FRAGMENT_HEADER_MIN_HEIGHT = SEQUENCE_FRAGMENT_TAB_HEIGHT;

/** Default operator label of the first row (the tab). */
export const SEQUENCE_FRAGMENT_DEFAULT_OPERATOR = "Opt / Loop";

/**
 * The fragment's operator tab. The first row's height is the tab height
 * (`operatorWidth` is the grown tab width); both default to the sample tab.
 */
const fragmentTabMetrics = (
  width: number,
  height: number,
  fragment?: SequenceFragmentData,
) => {
  const maxWidth = Math.max(
    SEQUENCE_FRAGMENT_TAB_WIDTH,
    width - SEQUENCE_FRAGMENT_TAB_MAX_RIGHT_INSET,
  );
  const tabWidth = Math.min(
    width,
    Math.min(
      maxWidth,
      Math.max(
        SEQUENCE_FRAGMENT_TAB_WIDTH,
        fragment?.operatorWidth ?? SEQUENCE_FRAGMENT_TAB_WIDTH,
      ),
    ),
  );
  const tabHeight = Math.min(
    height,
    Math.max(
      SEQUENCE_FRAGMENT_TAB_HEIGHT,
      fragment?.rows?.[0]?.height ?? SEQUENCE_FRAGMENT_TAB_HEIGHT,
    ),
  );
  const bevel = Math.min(SEQUENCE_FRAGMENT_TAB_BEVEL, tabWidth / 2, tabHeight);
  return { tabWidth, tabHeight, bevel };
};

/**
 * The fragment's top-row tab: at the sample size a 92 x 36.272 rect with a
 * 12 x 12 bottom-right bevel. Narrower or shorter elements shrink the tab (and
 * the bevel) so the drawn tab never leaves the element box; the width/height
 * default to the sample size for callers that just want the sample tab.
 */
export const getSequenceFragmentTabPath = (
  width: number = SEQUENCE_FRAGMENT_TAB_WIDTH,
  height: number = SEQUENCE_FRAGMENT_TAB_HEIGHT,
  fragment?: SequenceFragmentData,
): CompositeShapePath => {
  const { tabWidth, tabHeight, bevel } = fragmentTabMetrics(
    width,
    height,
    fragment,
  );
  return pathFromPoints(
    [
      [0, 0],
      [0, tabHeight],
      [tabWidth - bevel, tabHeight],
      [tabWidth, tabHeight - bevel],
      [tabWidth, 0],
    ],
    true,
  );
};

/**
 * Text area of the fragment tab. The tab grows with its label first; the text
 * wraps once the tab reaches its max width, and the first row (tab) height
 * follows the wrapped text height. The innermost safe rectangle therefore
 * shrinks only by the tab's padding and its bottom-right bevel.
 */
export const getSequenceFragmentTextBounds = (
  width: number,
  height: number,
  fragment?: SequenceFragmentData,
): CompositeShapeTextBounds => {
  const { tabWidth, tabHeight, bevel } = fragmentTabMetrics(
    width,
    height,
    fragment,
  );
  const padX = Math.min(
    SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_X,
    Math.max(0, (tabWidth - bevel) / 2),
  );
  const padY = Math.min(
    SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_Y,
    Math.max(0, tabHeight / 2),
  );
  return insetRect(
    padX,
    padY,
    Math.max(padX + 0.01, tabWidth - bevel - padX),
    Math.max(padY + 0.01, tabHeight - padY),
  );
};

/**
 * Narrowing predicate for `sc-fragment`. Structural (same reason as
 * `isSequenceLifelineElement`) so it can be used at JSON boundaries without
 * importing the registry.
 */
export const isSequenceFragmentElement = <T extends ExcalidrawElement>(
  element: T | null | undefined,
): element is T &
  ExcalidrawSequenceElement & {
    shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
  } => {
  const shape = (
    element as Partial<ExcalidrawSequenceElement> | null | undefined
  )?.shape;
  return (
    !!element &&
    element.type === "sequence" &&
    !!shape &&
    shape.id === "sc-fragment"
  );
};

export type SequenceFragmentRowLayout = {
  rows: ReadonlyArray<{
    id: string;
    y: number;
    height: number;
    label?: string;
  }>;
  /** Element-local y of each divider between rows (never 0 or `height`). */
  separators: number[];
};

export type SequenceFragmentRowAddition = {
  height: number;
  shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
};

export type SequenceFragmentResize = {
  height: number;
  shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
};

const FRAGMENT_HEIGHT_EPSILON = 1e-9;

/**
 * Derives the rendered row layout from the persisted row weights.
 *
 * Persisted heights are scaled to the current element height, so the layout
 * always sums to `height` even if a resize path has not normalized the shape
 * yet. The first row (the tab row) is kept at least
 * `SEQUENCE_FRAGMENT_TAB_HEIGHT` so the operator tab never crosses a divider.
 */
export const getSequenceFragmentRowLayout = (
  height: number,
  fragment?: SequenceFragmentData,
): SequenceFragmentRowLayout => {
  const rows = fragment?.rows;
  if (!rows?.length || !Number.isFinite(height) || height <= 0) {
    return { rows: [], separators: [] };
  }
  if (rows.length === 1) {
    return {
      rows: [{ ...rows[0], y: 0, height }],
      separators: [],
    };
  }
  const tabHeight = Math.min(SEQUENCE_FRAGMENT_TAB_HEIGHT, height);
  const firstHeight = Math.min(height, Math.max(rows[0].height, tabHeight));
  const restRows = rows.slice(1);
  const restHeight = Math.max(0, height - firstHeight);
  const restSum = restRows.reduce(
    (sum, row) => sum + Math.max(0, row.height),
    0,
  );
  const layoutRows: Array<{
    id: string;
    y: number;
    height: number;
    label?: string;
  }> = [{ ...rows[0], y: 0, height: firstHeight }];
  let y = firstHeight;
  for (let index = 0; index < restRows.length; index++) {
    const row = restRows[index];
    const rowHeight =
      restSum > 0
        ? (restHeight * Math.max(0, row.height)) / restSum
        : restHeight / restRows.length;
    const nextHeight =
      index === restRows.length - 1
        ? Math.max(0, height - y)
        : Math.max(0, rowHeight);
    layoutRows.push({ ...row, y, height: nextHeight });
    y += nextHeight;
  }
  const separators = layoutRows
    .slice(0, -1)
    .map((row) => row.y + row.height)
    .filter(
      (separator) =>
        separator > FRAGMENT_HEIGHT_EPSILON &&
        separator < height - FRAGMENT_HEIGHT_EPSILON,
    );
  return { rows: layoutRows, separators };
};

/** Dash pattern of the fragment's row dividers (mirrors the lifeline pole). */
export const SEQUENCE_FRAGMENT_ROW_DIVIDER_DASH = [4, 4];

/**
 * Stroke-only divider paths for the fragment's rows. The divider between the
 * header (operator tab) row and the first body row is transparent — the tab
 * contour already closes that row — while every later divider is dashed.
 */
export const getSequenceFragmentRowPaths = (
  width: number,
  height: number,
  fragment?: SequenceFragmentData,
): CompositeShapeDetailPath[] => {
  if (!(width > 0)) {
    return [];
  }
  return getSequenceFragmentRowLayout(height, fragment)
    .separators.slice(1)
    .map((y) => ({
      ...pathFromPoints(
        [
          [0, y],
          [width, y],
        ],
        false,
      ),
      strokeLineDash: SEQUENCE_FRAGMENT_ROW_DIVIDER_DASH,
    }));
};

/**
 * The rows a freshly created fragment starts with: the operator-tab header
 * row and `bodyRowCount` condition rows filling the rest of the box. The
 * header never exceeds the box, so a box at (or below) tab height starts
 * header-only.
 */
export const createSequenceFragmentInitialRows = (
  height: number,
  bodyRowCount: number = 1,
): SequenceFragmentRow[] => {
  if (!(height > 0)) {
    return [];
  }
  const headerHeight = Math.min(height, SEQUENCE_FRAGMENT_TAB_HEIGHT);
  const rows: SequenceFragmentRow[] = [
    { id: randomId(), height: headerHeight },
  ];
  const bodyHeight = height - headerHeight;
  if (bodyHeight > FRAGMENT_HEIGHT_EPSILON) {
    const count = Math.max(1, Math.floor(bodyRowCount));
    for (let index = 0; index < count; index++) {
      rows.push({ id: randomId(), height: bodyHeight / count });
    }
  }
  return rows;
};

/** Row index whose span contains `localY` (clamped to the first/last row). */
export const getSequenceFragmentRowIndexAt = (
  height: number,
  fragment: SequenceFragmentData | undefined,
  localY: number,
): number => {
  const layout = getSequenceFragmentRowLayout(height, fragment);
  if (!layout.rows.length) {
    return -1;
  }
  if (localY <= 0) {
    return 0;
  }
  let y = 0;
  for (let index = 0; index < layout.rows.length; index++) {
    const row = layout.rows[index];
    y += row.height;
    if (localY < y || index === layout.rows.length - 1) {
      return index;
    }
  }
  return layout.rows.length - 1;
};

/** Element-local y of every separator between two rows. */
export const getSequenceFragmentRowSeparatorYs = (
  height: number,
  fragment?: SequenceFragmentData,
): number[] => getSequenceFragmentRowLayout(height, fragment).separators;

/**
 * Element-local y of every place a row can be inserted. Boundaries below the
 * header only: the header stays the first row, so there is no "insert above
 * the header" slot.
 */
export const getSequenceFragmentInsertionBoundaries = (
  height: number,
  fragment?: SequenceFragmentData,
): Array<{ boundaryIndex: number; y: number }> => {
  const layout = getSequenceFragmentRowLayout(height, fragment);
  if (!layout.rows.length) {
    return [];
  }
  let y = 0;
  const boundaries: Array<{ boundaryIndex: number; y: number }> = [];
  for (let index = 0; index < layout.rows.length; index++) {
    y += layout.rows[index].height;
    boundaries.push({ boundaryIndex: index + 1, y });
  }
  return boundaries;
};

/** Minimum height a row may be resized to (the header clears the tab). */
export const getSequenceFragmentRowMinHeight = (rowIndex: number): number =>
  rowIndex === 0
    ? SEQUENCE_FRAGMENT_HEADER_MIN_HEIGHT
    : SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT;

export type SequenceFragmentRowsUpdate = {
  height: number;
  shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
};

/** Current rows of a fragment; a fragment without persisted rows starts from the default header + body split. */
const getSequenceFragmentRowsForEdit = (
  element: ExcalidrawElement,
): { fragment?: SequenceFragmentData; rows: SequenceFragmentRow[] } | null => {
  if (!isSequenceFragmentElement(element) || !(element.height > 0)) {
    return null;
  }
  const fragment = element.shape.fragment;
  const rows = fragment?.rows?.length
    ? resolveSequenceFragmentRows(fragment.rows, element.height)
    : createSequenceFragmentInitialRows(element.height);
  return rows.length ? { fragment, rows } : null;
};

const sequenceFragmentRowsUpdate = (
  element: ExcalidrawElement,
  fragment: SequenceFragmentData | undefined,
  rows: SequenceFragmentRow[],
  height: number,
): SequenceFragmentRowsUpdate => ({
  height,
  shape: {
    ...(element as ExcalidrawSequenceElement).shape,
    fragment: { ...(fragment ?? {}), rows },
  } as Extract<SequenceShapeData, { id: "sc-fragment" }>,
});

/**
 * Operator tab auto-layout for the bound label:
 *
 * 1. the tab widens with the single-line text first (up to the fragment's
 *    max width inset);
 * 2. only once that width is exhausted does the text wrap, and the header row
 *    (the tab) grows in height by the wrapped line count.
 *
 * The result also resizes the element by the header delta, because
 * `sum(rows.height) === element.height`. Callers apply it to the fragment and
 * then re-run the bound text layout (`redrawTextBoundingBox`).
 */
export const fitSequenceFragmentOperator = (
  element: ExcalidrawElement,
  text: Pick<
    ExcalidrawTextElement,
    "originalText" | "fontSize" | "fontFamily" | "lineHeight" | "fontWeight"
  >,
): SequenceFragmentRowsUpdate | null => {
  const current = getSequenceFragmentRowsForEdit(element);
  if (!current?.rows.length) {
    return null;
  }
  const maxTabWidth = Math.max(
    SEQUENCE_FRAGMENT_TAB_WIDTH,
    element.width - SEQUENCE_FRAGMENT_TAB_MAX_RIGHT_INSET,
  );
  const font = getFontString({
    fontSize: text.fontSize,
    fontFamily: text.fontFamily,
    fontWeight: text.fontWeight,
  });
  // Hard line breaks are normalized to spaces: wrapping is automatic.
  const singleLine = text.originalText.replace(/\s*[\r\n]+\s*/g, " ");
  const naturalWidth = measureText(singleLine, font, text.lineHeight).width;
  const tabWidth = Math.min(
    maxTabWidth,
    Math.max(
      SEQUENCE_FRAGMENT_TAB_WIDTH,
      naturalWidth +
        SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_X * 2 +
        SEQUENCE_FRAGMENT_TAB_BEVEL,
    ),
  );
  const textWidth = Math.max(
    1,
    tabWidth -
      SEQUENCE_FRAGMENT_TAB_BEVEL -
      SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_X * 2,
  );
  const textHeight = measureText(
    wrapText(singleLine, font, textWidth),
    font,
    text.lineHeight,
  ).height;
  const tabHeight = Math.max(
    SEQUENCE_FRAGMENT_TAB_HEIGHT,
    textHeight + SEQUENCE_FRAGMENT_TAB_TEXT_PADDING_Y * 2,
  );
  const rows = [...current.rows];
  const headerDelta = tabHeight - rows[0].height;
  rows[0] = { ...rows[0], height: tabHeight };
  return {
    height: Math.max(
      SEQUENCE_FRAGMENT_TAB_HEIGHT,
      element.height + headerDelta,
    ),
    shape: {
      ...(element as ExcalidrawSequenceElement).shape,
      fragment: {
        ...(current.fragment ?? {}),
        operatorWidth: tabWidth,
        rows,
      },
    } as Extract<SequenceShapeData, { id: "sc-fragment" }>,
  };
};

/**
 * Inserts one condition row at `boundaryIndex` (1 = below the header, up to
 * `rows.length` = append at the bottom) and grows the element by the same
 * height. The header never moves.
 */
export const insertSequenceFragmentRow = (
  element: ExcalidrawElement,
  boundaryIndex: number,
): (SequenceFragmentRowsUpdate & { rowId: string; index: number }) | null => {
  const current = getSequenceFragmentRowsForEdit(element);
  if (!current) {
    return null;
  }
  const index = Math.max(
    1,
    Math.min(Math.round(boundaryIndex), current.rows.length),
  );
  const row: SequenceFragmentRow = {
    id: randomId(),
    height: SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT,
  };
  const rows = [...current.rows];
  rows.splice(index, 0, row);
  const height = element.height + row.height;
  return {
    ...sequenceFragmentRowsUpdate(element, current.fragment, rows, height),
    rowId: row.id,
    index,
  };
};

/**
 * Sets one row's height and moves every row below it (the element height
 * follows the delta). The row above a separator is the one a drag resizes.
 */
export const resizeSequenceFragmentRow = (
  element: ExcalidrawElement,
  rowId: string,
  nextHeight: number,
): SequenceFragmentRowsUpdate | null => {
  const current = getSequenceFragmentRowsForEdit(element);
  if (!current || !Number.isFinite(nextHeight)) {
    return null;
  }
  const index = current.rows.findIndex((row) => row.id === rowId);
  if (index < 0) {
    return null;
  }
  const min = getSequenceFragmentRowMinHeight(index);
  const height = Math.max(min, nextHeight);
  const rows = current.rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, height } : row,
  );
  return sequenceFragmentRowsUpdate(
    element,
    current.fragment,
    rows,
    element.height + (height - current.rows[index].height),
  );
};

/**
 * Moves a body row to `targetIndex` in the final row array. The header row
 * stays first; the element height is unchanged.
 */
export const moveSequenceFragmentRow = (
  element: ExcalidrawElement,
  rowId: string,
  targetIndex: number,
): SequenceFragmentRowsUpdate | null => {
  const current = getSequenceFragmentRowsForEdit(element);
  if (!current) {
    return null;
  }
  const index = current.rows.findIndex((row) => row.id === rowId);
  if (index < 1) {
    // the header is the operator row and never reorders
    return null;
  }
  const rows = [...current.rows];
  const [row] = rows.splice(index, 1);
  const insertAt = Math.max(1, Math.min(Math.round(targetIndex), rows.length));
  rows.splice(insertAt, 0, row);
  return sequenceFragmentRowsUpdate(
    element,
    current.fragment,
    rows,
    element.height,
  );
};

/** Removes a body row and shrinks the element by its height. */
export const deleteSequenceFragmentRow = (
  element: ExcalidrawElement,
  rowId: string,
): SequenceFragmentRowsUpdate | null => {
  const current = getSequenceFragmentRowsForEdit(element);
  if (!current) {
    return null;
  }
  const index = current.rows.findIndex((row) => row.id === rowId);
  if (index < 1) {
    // the header row is structural
    return null;
  }
  const rows = current.rows.filter((row) => row.id !== rowId);
  const height = Math.max(
    SEQUENCE_FRAGMENT_HEADER_MIN_HEIGHT,
    element.height - current.rows[index].height,
  );
  return sequenceFragmentRowsUpdate(element, current.fragment, rows, height);
};

/**
 * Scales persisted row heights to `height`, keeping every row positive and
 * making the last row absorb float drift so the sum is exact.
 */
export const normalizeSequenceFragmentRows = (
  rows: ReadonlyArray<SequenceFragmentRow>,
  height: number,
): SequenceFragmentRow[] => {
  if (!rows.length || !(height > 0)) {
    return [...rows];
  }
  const sum = rows.reduce((total, row) => total + Math.max(0, row.height), 0);
  if (sum <= 0) {
    return [...rows];
  }
  const scale = height / sum;
  const scaled = rows.map((row) => ({
    ...row,
    height: Math.max(row.height, Number.EPSILON) * scale,
  }));
  const scaledSum = scaled.reduce((total, row) => total + row.height, 0);
  const lastIndex = scaled.length - 1;
  scaled[lastIndex] = {
    ...scaled[lastIndex],
    height: Math.max(
      Number.EPSILON,
      scaled[lastIndex].height + height - scaledSum,
    ),
  };
  return scaled;
};

/**
 * Persisted rows that match the rendered layout (first row at least the tab
 * height, sum exactly `height`), falling back to plain proportional scaling
 * when the box is too short to keep every row positive.
 */
const resolveSequenceFragmentRows = (
  rows: ReadonlyArray<SequenceFragmentRow>,
  height: number,
): SequenceFragmentRow[] => {
  const layout = getSequenceFragmentRowLayout(height, { rows });
  if (
    layout.rows.length === rows.length &&
    layout.rows.every((row) => row.height > 0)
  ) {
    return rows.map((row, index) => ({
      ...row,
      height: layout.rows[index].height,
    }));
  }
  return normalizeSequenceFragmentRows(rows, height);
};

/**
 * Enforces the fragment invariants:
 * - rows exist (a fragment starts with a header row plus one body row);
 * - `sum(rows.height) === element.height`;
 * - the header row clears the tab;
 * - the tab label uses the fixed text fit (editing it never resizes the box),
 *   which is what keeps it single-line.
 */
export const normalizeSequenceFragmentGeometry = <T extends ExcalidrawElement>(
  element: T,
): T => {
  if (!isSequenceFragmentElement(element) || !(element.height > 0)) {
    return element;
  }
  const fragment = element.shape.fragment;
  const baseRows = fragment?.rows?.length
    ? fragment.rows
    : createSequenceFragmentInitialRows(element.height);
  if (!baseRows.length) {
    return element;
  }
  const rows = resolveSequenceFragmentRows(baseRows, element.height);
  const previousRows = fragment?.rows ?? [];
  const textFitMode = element.textFitMode ?? "fixed";
  const unchanged =
    previousRows.length === rows.length &&
    element.textFitMode === textFitMode &&
    rows.every(
      (row, index) =>
        row.id === previousRows[index].id &&
        Math.abs(row.height - previousRows[index].height) < 1e-6,
    );
  if (unchanged) {
    return element;
  }
  return {
    ...element,
    textFitMode,
    shape: {
      ...element.shape,
      fragment: { ...(fragment ?? {}), rows },
    },
  } as T;
};

/**
 * Appends a row to the bottom of the fragment and grows the element by the
 * same amount. Returns `null` for non-fragments or uninitialized (0-height)
 * drafts. When the fragment has no row data yet, the existing box becomes the
 * first row, so the first "add row" simply splits the box in two.
 */
export const appendSequenceFragmentRow = (
  element: ExcalidrawElement,
): SequenceFragmentRowAddition | null => {
  const current = getSequenceFragmentRowsForEdit(element);
  if (!current) {
    return null;
  }
  const rowHeight = SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT;
  return {
    height: element.height + rowHeight,
    shape: {
      ...(element as ExcalidrawSequenceElement).shape,
      fragment: {
        ...(current.fragment ?? {}),
        rows: [...current.rows, { id: randomId(), height: rowHeight }],
      },
    } as Extract<SequenceShapeData, { id: "sc-fragment" }>,
  };
};

/**
 * Row-preserving resize math. The bottom edge (s / se / sw) changes only the
 * last row and stops at `SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT`; every other
 * direction scales all rows proportionally.
 */
export const getSequenceFragmentResize = (
  element: ExcalidrawElement,
  handleDirection: TransformHandleDirection,
  nextHeight: number,
): SequenceFragmentResize | null => {
  if (!(nextHeight > 0)) {
    return null;
  }
  const current = getSequenceFragmentRowsForEdit(element);
  if (!current) {
    return null;
  }
  const fragment = current.fragment;
  const rows = current.rows;
  let height = nextHeight;
  let nextRows: SequenceFragmentRow[];
  if (handleDirection.includes("s")) {
    const delta = nextHeight - element.height;
    const last = rows[rows.length - 1];
    const minHeight = getSequenceFragmentRowMinHeight(rows.length - 1);
    const lastHeight = last.height + delta;
    if (lastHeight < minHeight) {
      // The bottom edge stops once the last row reaches its minimum.
      nextRows = rows.map((row, index) =>
        index === rows.length - 1 ? { ...row, height: minHeight } : row,
      );
      height = element.height - last.height + minHeight;
    } else {
      nextRows = rows.map((row, index) =>
        index === rows.length - 1 ? { ...row, height: lastHeight } : row,
      );
    }
  } else {
    const scale = nextHeight / element.height;
    nextRows = rows.map((row) => ({
      ...row,
      height: row.height * scale,
    }));
  }
  const sum = nextRows.reduce((total, row) => total + row.height, 0);
  if (Math.abs(sum - height) > FRAGMENT_HEIGHT_EPSILON) {
    nextRows = normalizeSequenceFragmentRows(nextRows, height);
  }
  return {
    height,
    shape: {
      ...(element as ExcalidrawSequenceElement).shape,
      fragment: { ...fragment, rows: nextRows },
    } as Extract<SequenceShapeData, { id: "sc-fragment" }>,
  };
};

/** Fixed sample extents of the icon-headed glyphs (head + attachments union). */
const ENTITY_GLYPH_BOX = { width: 40, height: 39, top: 1 };
const CONTROL_GLYPH_BOX = { width: 38, height: 44, top: 1 };
const BOUNDARY_GLYPH_BOX = { width: 50, height: 38, top: 1 };
const ACTOR_GLYPH_BOX = { width: 58, height: 88, top: 1 };

/**
 * Shrinks an icon glyph only when the element is smaller than its fixed sample
 * extent: `s = min(1, width / glyphWidth, headHeight / glyphHeight)`. At
 * `s === 1` the glyph is returned untouched (byte-identical to the sample); for
 * `s < 1` it scales about its own box center — horizontal centering stays on
 * the element center — and is nudged back inside the element box if the scale
 * would push it past the head top or bottom.
 */
const fitIconGlyph = (
  glyph: SequenceHeadGeometry,
  box: { width: number; height: number; top: number },
  width: number,
  headHeight: number,
): SequenceHeadGeometry => {
  const s = Math.min(1, width / box.width, headHeight / box.height);
  if (s === 1) {
    return glyph;
  }
  const ox = width / 2;
  const oy = box.top + box.height / 2;
  const scale = (path: CompositeShapePath) =>
    transformPath(
      path,
      ([x, y]) => [ox + (x - ox) * s, oy + (y - oy) * s] as ShapePoint,
    );
  let head = glyph.head.map(scale);
  let attachments = glyph.attachments.map(scale);
  const scaledTop = oy - (box.height / 2) * s;
  const scaledBottom = oy + (box.height / 2) * s;
  const dy =
    scaledTop < 0
      ? -scaledTop
      : scaledBottom > headHeight
      ? headHeight - scaledBottom
      : 0;
  if (dy !== 0) {
    head = head.map((path) => translatePath(path, 0, dy));
    attachments = attachments.map((path) => translatePath(path, 0, dy));
  }
  return { head, attachments };
};

export type SequenceHeadGeometry = {
  /** Filled + stroked primitives of the head glyph. */
  head: CompositeShapePath[];
  /** Stroke-only attachment paths. */
  attachments: CompositeShapePath[];
};

/**
 * Head glyph and stroke-only attachments, expressed in element-local
 * coordinates. Icon-headed ids keep a fixed glyph size centered horizontally
 * (a width change only moves it); box-headed ids fill the head box.
 */
export const getSequenceLifelineGeometry = (
  id: SequenceLifelineId,
  width: number,
  headHeight: number,
): SequenceHeadGeometry => {
  const cx = width / 2;
  switch (id) {
    case "sc-lifeline-entity":
      return fitIconGlyph(
        {
          head: [ellipseOutline(cx, 20, 19, 19)],
          attachments: [linePath(cx - 20, 40, cx + 20, 40)],
        },
        ENTITY_GLYPH_BOX,
        width,
        headHeight,
      );
    case "sc-lifeline-control":
      return fitIconGlyph(
        {
          head: [ellipseOutline(cx, 26, 19, 19)],
          attachments: [
            linePath(cx - 2, 7, cx + 4, 1),
            linePath(cx - 2, 7, cx + 4, 13),
          ],
        },
        CONTROL_GLYPH_BOX,
        width,
        headHeight,
      );
    case "sc-lifeline-boundary":
      return fitIconGlyph(
        {
          head: [ellipseOutline(cx + 6, 20, 19, 19)],
          attachments: [
            linePath(cx - 25, 2, cx - 25, 38),
            linePath(cx - 25, 20, cx - 13, 20),
          ],
        },
        BOUNDARY_GLYPH_BOX,
        width,
        headHeight,
      );
    case "sc-lifeline-actor":
      return fitIconGlyph(
        {
          head: [ellipseOutline(cx, 17.09, 15.95, 16.09)],
          attachments: [
            linePath(cx, 33.18, cx, 42.07),
            linePath(cx, 42.07, cx - 29, 42.07),
            linePath(cx, 42.07, cx + 29, 42.07),
            linePath(cx, 42.07, cx, 67.49),
            linePath(cx, 67.49, cx - 23.2, 89),
            linePath(cx, 67.49, cx + 23.2, 89),
          ],
        },
        ACTOR_GLYPH_BOX,
        width,
        headHeight,
      );
    case "sc-lifeline-queue": {
      const sx = width / 100;
      const sy = headHeight / 60;
      return {
        head: [scalePath(queueCapsule, sx, sy)],
        attachments: [scalePath(queueInnerArc, sx, sy)],
      };
    }
    case "sc-lifeline-data-base": {
      const sx = width / 68;
      const sy = headHeight / 90;
      return {
        head: [scalePath(dataBaseCylinder, sx, sy)],
        attachments: [scalePath(dataBaseInnerArc, sx, sy)],
      };
    }
    case "sc-lifeline-object":
      return {
        head: [getRoundedRectOutline(width, headHeight, 7)],
        attachments: [],
      };
    case "sc-lifeline-collection": {
      const sx = width / 118;
      const sy = headHeight / 68;
      return {
        // back card first, then the front card on top
        head: [
          roundedRectAt(8 * sx, 0, 110 * sx, 60 * sy, 4),
          roundedRectAt(0, 8 * sy, 110 * sx, 60 * sy, 4),
        ],
        attachments: [],
      };
    }
  }
};

/**
 * Pole length derived from the element height. The minimum keeps the pole
 * itself selectable/draggable even if an invalid element slips through; the
 * persisted invariant normally guarantees `height >= headHeight + MIN`.
 */
export const getSequencePoleLength = (height: number, headHeight: number) =>
  Math.max(SEQUENCE_MIN_POLE_LENGTH, height - headHeight);

/** The dashed lifeline pole: centered on the element, from the head bottom. */
export const getSequencePolePath = (
  width: number,
  headHeight: number,
  height: number,
): CompositeShapePath =>
  pathFromPoints(
    [
      [width / 2, headHeight],
      [width / 2, headHeight + getSequencePoleLength(height, headHeight)],
    ],
    false,
  );

/** Half-width of the selectable corridor around the dashed pole. */
export const SEQUENCE_HIT_HALF_WIDTH = 5;

/**
 * Interactive geometry of a lifeline: the head rectangle plus a narrow
 * corridor around the pole. The element box (envelope) stays the outline for
 * bounds and export; only hit-testing, distance and line intersection use
 * these paths.
 */
export const getSequenceLifelineHitPaths = (
  width: number,
  headHeight: number,
  height: number,
): CompositeShapePath[] => {
  const poleEnd = headHeight + getSequencePoleLength(height, headHeight);
  return [
    pathFromPoints(
      [
        [0, 0],
        [width, 0],
        [width, headHeight],
        [0, headHeight],
      ],
      true,
    ),
    pathFromPoints(
      [
        [width / 2 - SEQUENCE_HIT_HALF_WIDTH, headHeight],
        [width / 2 + SEQUENCE_HIT_HALF_WIDTH, headHeight],
        [width / 2 + SEQUENCE_HIT_HALF_WIDTH, poleEnd],
        [width / 2 - SEQUENCE_HIT_HALF_WIDTH, poleEnd],
      ],
      true,
    ),
  ];
};

/** The whole element box; the envelope every lifeline declares as its outline. */
export const getSequenceElementBox = (
  width: number,
  height: number,
): CompositeShapePath => getBaseRectangleOutline(width, height, 0);

/**
 * Draws a lifeline: filled+stroked head glyph, then stroke-only attachments,
 * then the dashed pole. The pole clones the element options and forces
 * `strokeLineDash: [4, 4]` (the mirror of the arrowhead precedent in
 * `shape.ts`, which strips the dash), so its color follows `strokeColor` and
 * its geometry is independent of the element's `strokeStyle`.
 */
export const drawSequenceLifeline: ShapeDraw = ({
  generator,
  element,
  options,
}) => {
  const shape: SequenceShapeData = element.shape as SequenceShapeData;
  const id = shape.id;
  const headHeight =
    isSequenceLifelineShapeId(id) && "lifeline" in shape
      ? shape.lifeline.headHeight
      : element.height;
  const { head, attachments } = getSequenceLifelineGeometry(
    id as SequenceLifelineId,
    element.width,
    headHeight,
  );
  const baseOptions = { ...options(false), preserveVertices: true };
  const drawables: Drawable[] = [];
  for (const path of head) {
    drawables.push(generator.path(compositeShapePathToSvg(path), baseOptions));
  }
  const strokeOptions: Options = { ...baseOptions, fill: undefined };
  for (const path of attachments) {
    drawables.push(
      generator.path(compositeShapePathToSvg(path), strokeOptions),
    );
  }
  drawables.push(
    generator.path(
      compositeShapePathToSvg(
        getSequencePolePath(element.width, headHeight, element.height),
      ),
      {
        ...strokeOptions,
        strokeLineDash: [4, 4],
        disableMultiStroke: true,
        strokeWidth: element.strokeWidth,
      },
    ),
  );
  return drawables;
};
