import {
  DEFAULT_FONT_FAMILY,
  getLineHeight,
  getVerticalOffset,
} from "@excalidraw/common";

import { getLineHeightInPx } from "../textMeasurements";

import {
  FC_ARC_K,
  compositeShapePathToSvg,
  getBaseRectangleOutline,
  getRoundedRectOutline,
  pathFromPoints,
  type CompositeShapePath,
  type ShapePoint,
} from "./outline";
import {
  TEXT_GAP,
  insetRect,
  type CompositeShapeTextBounds,
} from "./textBounds";

import type { Drawable, Options } from "roughjs/bin/core";

import type { SequenceShapeData, SequenceShapeId } from "../types";
import type { ShapeDraw } from "./registry";

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

/** The dashed lifeline pole length, measured from the head's bottom edge. */
export const SEQUENCE_POLE_LENGTH = 360;

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

export const isSequenceLifelineShapeId = (
  id: SequenceShapeId,
): id is SequenceLifelineId => id in SEQUENCE_LIFELINE_HEAD_HEIGHTS;

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
  return insetRect(TEXT_GAP, centerY - half, right, centerY + half);
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
const FRAGMENT_TAB_WIDTH = 92;
const FRAGMENT_TAB_HEIGHT = 36.272;
const FRAGMENT_TAB_BEVEL = 12;
/** Measured baseline of the fragment's tab title (element-local y). */
const FRAGMENT_TAB_BASELINE = 24.229;

/** The fragment's tab clamped to the element box. */
const fragmentTabMetrics = (width: number, height: number) => {
  const tabWidth = Math.min(FRAGMENT_TAB_WIDTH, width);
  const tabHeight = Math.min(FRAGMENT_TAB_HEIGHT, height);
  const bevel = Math.min(FRAGMENT_TAB_BEVEL, tabWidth / 2, tabHeight);
  return { tabWidth, tabHeight, bevel };
};

/**
 * The fragment's top-row tab: at the sample size a 92 x 36.272 rect with a
 * 12 x 12 bottom-right bevel. Narrower or shorter elements shrink the tab (and
 * the bevel) so the drawn tab never leaves the element box; the width/height
 * default to the sample size for callers that just want the sample tab.
 */
export const getSequenceFragmentTabPath = (
  width: number = FRAGMENT_TAB_WIDTH,
  height: number = FRAGMENT_TAB_HEIGHT,
): CompositeShapePath => {
  const { tabWidth, tabHeight, bevel } = fragmentTabMetrics(width, height);
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
 * Text area of the fragment tab, derived the same way as the lifeline label:
 * the measured tab-title baseline (`FRAGMENT_TAB_BASELINE`) drives the band
 * center, and the band is clamped to the (clamped) tab height and width.
 */
export const getSequenceFragmentTextBounds = (
  width: number,
  height: number,
): CompositeShapeTextBounds => {
  const { tabHeight, bevel } = fragmentTabMetrics(width, height);
  const center = FRAGMENT_TAB_BASELINE - LABEL_BASELINE_FROM_CENTER;
  const half = LABEL_BASELINE_FROM_CENTER + ICON_LABEL_BASELINE_GAP;
  const top = Math.min(Math.max(0, center - half), tabHeight);
  const bottom = Math.min(Math.max(top + 0.01, center + half), tabHeight);
  const right =
    Math.min(FRAGMENT_TAB_WIDTH - FRAGMENT_TAB_BEVEL, width - bevel) - TEXT_GAP;
  return insetRect(TEXT_GAP, top, Math.max(TEXT_GAP + 0.01, right), bottom);
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

/** The dashed lifeline pole: centered on the element, from the head bottom. */
export const getSequencePolePath = (
  width: number,
  headHeight: number,
): CompositeShapePath =>
  pathFromPoints(
    [
      [width / 2, headHeight],
      [width / 2, headHeight + SEQUENCE_POLE_LENGTH],
    ],
    false,
  );

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
      compositeShapePathToSvg(getSequencePolePath(element.width, headHeight)),
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
