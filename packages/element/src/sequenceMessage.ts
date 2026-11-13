import { pointFrom, pointRotateRads, type GlobalPoint } from "@excalidraw/math";

import { getElementAbsoluteCoords } from "./bounds";
import {
  getSequenceLifelineGlobalPoint,
  getSequenceLifelineLocalPoint,
  isActivationElement,
} from "./compositeShape/sequenceOutline";
import { isArrowElement, isElbowArrow } from "./typeChecks";
import { SEQUENCE_MESSAGE_SNAP_DISTANCE } from "./connection/thresholds";

import type { SequenceActivationElement } from "./sequenceActivation";
import type {
  ElementsMap,
  ExcalidrawLinearElement,
  NonDeletedExcalidrawElement,
  Ordered,
} from "./types";

/**
 * Sequence-message endpoint policy.
 *
 * A message anchored at an activation is not just "an arrow that happens to be
 * bound": it has a direction and an axis. All three ways of creating / editing
 * one must agree on that policy:
 *
 * 1. dragging out from an activation's dynamic connection point
 *    (`AppQuickCreate`);
 * 2. dragging an existing arrow endpoint (`LinearElementEditor`);
 * 3. drawing with the arrow tool from one activation to another.
 *
 * The policy lives here so those paths cannot drift apart:
 *
 * - the axis is the line through the **fixed** endpoint along the activation's
 *   local x axis (so messages stay horizontal, and follow rotation);
 * - the dragged endpoint is clamped to the outward half of that axis, so a
 *   message can never point back into its source;
 * - the only binding target is another activation whose vertical span contains
 *   the axis (the line must actually reach the bar) and which lies in front of
 *   the source.
 *
 * Pole quick-create (a new activation on a bare lifeline) needs app-level
 * scene hits and creation, so it stays in `AppQuickCreate`; it consumes the
 * same axis and target helpers from here.
 */

export type SequenceMessageSide = "left" | "right";

export type SequenceMessageAxis = {
  /** Activation the fixed endpoint belongs to. */
  activation: SequenceActivationElement;
  /** Which vertical edge of `activation` the message leaves / enters. */
  side: SequenceMessageSide;
  /** Fixed endpoint in scene coordinates (edge + binding gap). */
  anchor: GlobalPoint;
  /** `anchor` in the activation's element-local frame. */
  localAnchor: { x: number; y: number };
  /** Scene-space unit vector pointing away from the activation edge. */
  outward: { x: number; y: number };
};

/** Screen distance (at zoom 1) within which a bar counts as a drop target. */
export { SEQUENCE_MESSAGE_SNAP_DISTANCE };

const getSideOutward = (
  activation: SequenceActivationElement,
  side: SequenceMessageSide,
): { x: number; y: number } => {
  const [x, y] = pointRotateRads<GlobalPoint>(
    pointFrom<GlobalPoint>(side === "right" ? 1 : -1, 0),
    pointFrom<GlobalPoint>(0, 0),
    activation.angle,
  );
  return { x, y };
};

/** Build the message axis from a known edge + anchor (used by quick create). */
export const getSequenceMessageAxisFromAnchor = (
  activation: SequenceActivationElement,
  side: SequenceMessageSide,
  anchor: GlobalPoint,
): SequenceMessageAxis => {
  const localAnchor = getSequenceLifelineLocalPoint(
    activation,
    anchor[0],
    anchor[1],
  );
  return {
    activation,
    side,
    anchor,
    localAnchor,
    outward: getSideOutward(activation, side),
  };
};

/** Scene coordinates of an arrow point (handles rotation). */
export const getSequenceMessageArrowPoint = (
  arrow: ExcalidrawLinearElement,
  index: number,
  elementsMap: ElementsMap,
): GlobalPoint => {
  const point = arrow.points[index] ?? arrow.points[arrow.points.length - 1];
  const [, , , , cx, cy] = getElementAbsoluteCoords(arrow, elementsMap);
  return pointRotateRads<GlobalPoint>(
    pointFrom<GlobalPoint>(arrow.x + point[0], arrow.y + point[1]),
    pointFrom<GlobalPoint>(cx, cy),
    arrow.angle,
  );
};

/**
 * Axis for the **moving** end of a two-point message arrow: the fixed end is
 * the opposite endpoint, and the axis only exists when that end is bound to an
 * activation. Multi-point (self) messages and elbow arrows keep their existing
 * behavior.
 */
export const getSequenceMessageAxis = (
  arrow: ExcalidrawLinearElement,
  startOrEnd: "start" | "end",
  elementsMap: ElementsMap,
): SequenceMessageAxis | null => {
  if (
    !isArrowElement(arrow) ||
    isElbowArrow(arrow) ||
    arrow.points.length !== 2
  ) {
    return null;
  }
  const fixedBinding =
    startOrEnd === "start" ? arrow.endBinding : arrow.startBinding;
  if (!fixedBinding) {
    return null;
  }
  const activation = elementsMap.get(fixedBinding.elementId);
  if (!activation || !isActivationElement(activation)) {
    return null;
  }
  const activationElement = activation as SequenceActivationElement;
  const anchor = getSequenceMessageArrowPoint(
    arrow,
    startOrEnd === "start" ? 1 : 0,
    elementsMap,
  );
  const localAnchor = getSequenceLifelineLocalPoint(
    activationElement,
    anchor[0],
    anchor[1],
  );
  // The side is read from the fixed endpoint itself: activations only bind on
  // their vertical edges, so local x tells left from right.
  const side: SequenceMessageSide =
    localAnchor.x <= activationElement.width / 2 ? "left" : "right";
  return getSequenceMessageAxisFromAnchor(activationElement, side, anchor);
};

/**
 * Project a pointer onto the message axis: keep the fixed y, clamp x to the
 * outward half so the message never crosses back into its source activation.
 */
export const constrainSequenceMessagePoint = (
  axis: SequenceMessageAxis,
  point: GlobalPoint,
): GlobalPoint => {
  const local = getSequenceLifelineLocalPoint(
    axis.activation,
    point[0],
    point[1],
  );
  const x =
    axis.side === "right"
      ? Math.max(local.x, axis.localAnchor.x)
      : Math.min(local.x, axis.localAnchor.x);
  return getSequenceLifelineGlobalPoint(axis.activation, x, axis.localAnchor.y);
};

/**
 * Activation under the pointer that a message may attach to:
 *
 * - not the source activation;
 * - in front of the source (the bar's center is on the outward side);
 * - the message's y (the axis) lies within the target's vertical span, so the
 *   straight line actually reaches it;
 * - the pointer is within `snap` of the bar.
 *
 * This is the one target rule shared by all creation paths.
 */
export const findSequenceMessageTarget = (
  axis: SequenceMessageAxis,
  pointer: GlobalPoint,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  elementsMap: ElementsMap,
  zoom: number,
  snapPx: number = SEQUENCE_MESSAGE_SNAP_DISTANCE,
): SequenceActivationElement | null => {
  const snap = snapPx / (zoom || 1);
  let best: { element: SequenceActivationElement; distance: number } | null =
    null;

  for (const element of elements) {
    if (
      element.id === axis.activation.id ||
      !isActivationElement(element) ||
      element.locked
    ) {
      continue;
    }
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    if (
      (centerX - axis.anchor[0]) * axis.outward.x +
        (centerY - axis.anchor[1]) * axis.outward.y <=
      0
    ) {
      continue;
    }
    // The line (fixed y) must cross the bar's vertical span.
    const lineLocal = getSequenceLifelineLocalPoint(
      element,
      axis.anchor[0],
      axis.anchor[1],
    );
    if (lineLocal.y < 0 || lineLocal.y > element.height) {
      continue;
    }
    const pointerLocal = getSequenceLifelineLocalPoint(
      element,
      pointer[0],
      pointer[1],
    );
    if (
      pointerLocal.x < -snap ||
      pointerLocal.x > element.width + snap ||
      pointerLocal.y < -snap ||
      pointerLocal.y > element.height + snap
    ) {
      continue;
    }
    const dx =
      pointerLocal.x < 0
        ? -pointerLocal.x
        : pointerLocal.x > element.width
        ? pointerLocal.x - element.width
        : 0;
    const dy =
      pointerLocal.y < 0
        ? -pointerLocal.y
        : pointerLocal.y > element.height
        ? pointerLocal.y - element.height
        : 0;
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) {
      best = { element: element as SequenceActivationElement, distance };
    }
  }

  return best?.element ?? null;
};
