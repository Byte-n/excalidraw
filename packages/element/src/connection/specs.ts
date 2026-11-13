import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import {
  getCompositeShapeAnchors,
  isActivationElement,
  isSequenceLifelineElement,
  isShapeElement,
} from "../compositeShape";
import { isBindableElement } from "../typeChecks";

import { buildConnectionPaths } from "./outline";

import type { ExcalidrawBindableElement } from "../types";
import type { ConnectionSpec } from "./spec";
import type { ConnectionCtx } from "./types";

/**
 * Midpoints of the four bounding-box edges, rotated about the element center.
 * These points lie on the outline of every rectanguloid family (rounded corners
 * never reach an edge midpoint).
 */
const midpointAnchors = (element: {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: Radians;
}): GlobalPoint[] => {
  const { x, y, width, height } = element;
  const center = pointFrom<GlobalPoint>(x + width / 2, y + height / 2);
  return (
    [
      [width / 2, 0],
      [width, height / 2],
      [width / 2, height],
      [0, height / 2],
    ] as const
  ).map(([localX, localY]) =>
    pointRotateRads(
      pointFrom<GlobalPoint>(x + localX, y + localY),
      center,
      element.angle,
    ),
  );
};

const connectableFromOutline = (
  element: ExcalidrawBindableElement,
  ctx: ConnectionCtx,
) => buildConnectionPaths(element, 0, ctx);

const rectanguloidSpec: ConnectionSpec = {
  anchors: (element) => midpointAnchors(element),
  connectableOutline: connectableFromOutline,
  interior: "ray",
};

/** Diamond / ellipse / other composite and flow shapes. */
const compositeSpec: ConnectionSpec = {
  anchors: (element) =>
    isShapeElement(element) ? getCompositeShapeAnchors(element) : [],
  connectableOutline: connectableFromOutline,
  interior: "ray",
};

/** Frames never bind from deep inside; their interior yields to the element below. */
const frameSpec: ConnectionSpec = {
  ...rectanguloidSpec,
  interior: "none",
};

/** An activation bar's landing point is dynamic (pointer y on a vertical edge). */
const activationSpec: ConnectionSpec = {
  anchors: () => [],
  connectableOutline: connectableFromOutline,
  interior: "nearest",
};

/** Lifelines are not bindable; defensive empty spec. */
const noConnectionSpec: ConnectionSpec = {
  anchors: () => [],
  connectableOutline: () => [],
  interior: "none",
};

export const getRegisteredConnectionSpec = (
  element: ExcalidrawBindableElement,
): ConnectionSpec => {
  if (isSequenceLifelineElement(element)) {
    return noConnectionSpec;
  }
  if (!isBindableElement(element)) {
    return noConnectionSpec;
  }
  if (isActivationElement(element)) {
    return activationSpec;
  }
  if (isShapeElement(element)) {
    return element.shape.id === "rectangle" ? rectanguloidSpec : compositeSpec;
  }
  if (element.type === "frame" || element.type === "magicframe") {
    return frameSpec;
  }
  return rectanguloidSpec;
};
