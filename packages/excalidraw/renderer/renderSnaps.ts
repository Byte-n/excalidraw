import { pointFrom, type GlobalPoint, type LocalPoint } from "@excalidraw/math";

import { THEME } from "@excalidraw/common";

import type { PointSnapLine, PointerSnapLine } from "../snapping";
import type { InteractiveCanvasAppState } from "../types";

const SNAP_COLOR_LIGHT = "#1677ff";
// dark-mode colors are the equivalents of what the former CSS inversion filter
// produced (see `applyDarkModeFilter`)
const SNAP_COLOR_DARK = "#4096ff";
const SNAP_COLOR_DARK_ZEN = "#4096ff";
const SNAP_WIDTH = 1;

export const renderSnaps = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  if (!appState.snapLines.length || appState.selectedLinearElement?.isEditing) {
    return;
  }

  // in zen mode we draw only crosses, so use a different color to keep them
  // visible
  const snapColor =
    appState.theme === THEME.LIGHT
      ? SNAP_COLOR_LIGHT
      : appState.zenModeEnabled
      ? SNAP_COLOR_DARK_ZEN
      : SNAP_COLOR_DARK;
  // in zen mode make the remaining snap marks more visible
  const snapWidth =
    (appState.zenModeEnabled ? SNAP_WIDTH * 1.5 : SNAP_WIDTH) /
    appState.zoom.value;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  for (const snapLine of appState.snapLines) {
    if (snapLine.type === "pointer") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;

      drawPointerSnapLine(snapLine, context, appState);
    } else if (snapLine.type === "gap") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;

      drawGapLine(
        snapLine.points[0],
        snapLine.points[1],
        snapLine.direction,
        appState,
        context,
      );
    } else if (snapLine.type === "points") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;
      drawPointsSnapLine(snapLine, context, appState);
    }
  }

  context.restore();
};

const drawPointsSnapLine = (
  pointSnapLine: PointSnapLine,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  if (!appState.zenModeEnabled) {
    const firstPoint = pointSnapLine.points[0];
    const lastPoint = pointSnapLine.points[pointSnapLine.points.length - 1];

    drawLine(firstPoint, lastPoint, context);
  }

  for (const point of pointSnapLine.points) {
    drawPoint(point, appState, context);
  }
};

const drawPointerSnapLine = (
  pointerSnapLine: PointerSnapLine,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  drawPoint(pointerSnapLine.points[0], appState, context);
  if (!appState.zenModeEnabled) {
    drawLine(pointerSnapLine.points[0], pointerSnapLine.points[1], context);
  }
};

const drawPoint = <Point extends LocalPoint | GlobalPoint>(
  [x, y]: Point,
  appState: InteractiveCanvasAppState,
  context: CanvasRenderingContext2D,
) => {
  context.save();
  context.arc(x, y, 3 / appState.zoom.value, 0, Math.PI * 2);
  context.fillStyle = context.strokeStyle;
  context.fill();
  context.restore();
};

const drawLine = <Point extends LocalPoint | GlobalPoint>(
  from: Point,
  to: Point,
  context: CanvasRenderingContext2D,
) => {
  context.beginPath();
  context.lineTo(from[0], from[1]);
  context.lineTo(to[0], to[1]);
  context.stroke();
};

const drawGapLine = <Point extends LocalPoint | GlobalPoint>(
  from: Point,
  to: Point,
  direction: "horizontal" | "vertical",
  appState: InteractiveCanvasAppState,
  context: CanvasRenderingContext2D,
) => {
  // a horizontal gap snap line
  // |–––––––||–––––––|
  // ^    ^   ^       ^
  // \    \   \       \
  // (1)  (2) (3)     (4)

  const FULL = 8 / appState.zoom.value;
  const HALF = FULL / 2;
  const QUARTER = FULL / 4;

  if (direction === "horizontal") {
    const halfPoint = [(from[0] + to[0]) / 2, from[1]];
    // (1)
    if (!appState.zenModeEnabled) {
      drawLine(
        pointFrom(from[0], from[1] - FULL),
        pointFrom(from[0], from[1] + FULL),
        context,
      );
    }

    // (3)
    drawLine(
      pointFrom(halfPoint[0] - QUARTER, halfPoint[1] - HALF),
      pointFrom(halfPoint[0] - QUARTER, halfPoint[1] + HALF),
      context,
    );
    drawLine(
      pointFrom(halfPoint[0] + QUARTER, halfPoint[1] - HALF),
      pointFrom(halfPoint[0] + QUARTER, halfPoint[1] + HALF),
      context,
    );

    if (!appState.zenModeEnabled) {
      // (4)
      drawLine(
        pointFrom(to[0], to[1] - FULL),
        pointFrom(to[0], to[1] + FULL),
        context,
      );

      // (2)
      drawLine(from, to, context);
    }
  } else {
    const halfPoint = [from[0], (from[1] + to[1]) / 2];
    // (1)
    if (!appState.zenModeEnabled) {
      drawLine(
        pointFrom(from[0] - FULL, from[1]),
        pointFrom(from[0] + FULL, from[1]),
        context,
      );
    }

    // (3)
    drawLine(
      pointFrom(halfPoint[0] - HALF, halfPoint[1] - QUARTER),
      pointFrom(halfPoint[0] + HALF, halfPoint[1] - QUARTER),
      context,
    );
    drawLine(
      pointFrom(halfPoint[0] - HALF, halfPoint[1] + QUARTER),
      pointFrom(halfPoint[0] + HALF, halfPoint[1] + QUARTER),
      context,
    );

    if (!appState.zenModeEnabled) {
      // (4)
      drawLine(
        pointFrom(to[0] - FULL, to[1]),
        pointFrom(to[0] + FULL, to[1]),
        context,
      );

      // (2)
      drawLine(from, to, context);
    }
  }
};
