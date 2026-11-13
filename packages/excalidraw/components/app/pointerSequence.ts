/**
 * sequence affordances: activation-edge connection points and pole activation
 * previews (PR4a).
 *
 * Pure reads: geometry / legality only. Hover mirrors are written by
 * `applyPointerFrame`; the renderer reads the frame + ghost caches.
 */
import { pointFrom } from "@excalidraw/math";

import {
  SEQUENCE_ACTIVATION_HEIGHT,
  SEQUENCE_CONNECTION_INSIDE_TOLERANCE,
  SEQUENCE_CONNECTION_SNAP_DISTANCE,
  SEQUENCE_HIT_HALF_WIDTH,
  SEQUENCE_MIN_ACTIVATION_OFFSET,
  getActivationAnchor,
  getSequenceLifelineLocalPoint,
  getSequenceLifelinePoleActivationPlacement,
  isActivationElement,
  isPointOnSequenceLifelinePole,
  isSequenceLifelineElement,
} from "@excalidraw/element";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import type { SequenceActivationElement } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { registerPointerTargetProvider } from "./pointerFrame";
import {
  canHoverSequenceAffordances,
  getStrictTopmostElementAt,
} from "./pointerQuickCreate";

import type { PointerFrameInput, ProviderFor } from "./pointerFrame";

import type { PointerApp } from "./pointerQuickCreate";

export type SequenceConnectionSide = "left" | "right";

export type SequenceConnectionHover = {
  elementId: string;
  side: SequenceConnectionSide;
  point: { x: number; y: number };
};

export type PoleActivationTarget = {
  lifeline: NonDeletedExcalidrawElement;
  localY: number;
  center: { x: number; y: number };
  angle: number;
};

/**
 * Activation bar vertical edges near the pointer. Only left/right edges count;
 * the pointer must be within the bar's vertical span and within the snap /
 * inside distance. The bar centre does not trigger (dragging the body wins).
 */
export const resolveSequenceConnectionAt = (
  app: PointerApp,
  sceneX: number,
  sceneY: number,
): SequenceConnectionHover | null => {
  const zoom = app.state.zoom.value;
  const snap = SEQUENCE_CONNECTION_SNAP_DISTANCE / zoom;
  const inside = SEQUENCE_CONNECTION_INSIDE_TOLERANCE / zoom;
  let best: {
    element: SequenceActivationElement;
    side: SequenceConnectionSide;
    distance: number;
    localY: number;
  } | null = null;
  for (const element of app.scene.getNonDeletedElementsMap().values()) {
    if (!isActivationElement(element) || element.locked) {
      continue;
    }
    const local = getSequenceLifelineLocalPoint(element, sceneX, sceneY);
    if (local.y < 0 || local.y > element.height) {
      continue;
    }
    const sides: readonly [SequenceConnectionSide, number][] = [
      ["left", local.x],
      ["right", element.width - local.x],
    ];
    for (const [side, insideDepth] of sides) {
      if (insideDepth > inside || insideDepth < -snap) {
        continue;
      }
      const distance = Math.abs(insideDepth);
      if (!best || distance < best.distance) {
        best = { element, side, distance, localY: local.y };
      }
    }
  }
  if (!best) {
    return null;
  }
  const localY = Math.min(Math.max(best.localY, 1), best.element.height - 1);
  const [x, y] = getActivationAnchor(best.element, best.side, localY);
  return { elementId: best.element.id, side: best.side, point: { x, y } };
};

/** Candidate activation overlapping an existing activation on the same pole. */
export const poleActivationOverlapsExisting = (
  app: PointerApp,
  lifeline: NonDeletedExcalidrawElement,
  localY: number,
): boolean => {
  if (!isSequenceLifelineElement(lifeline)) {
    return false;
  }
  const candidateStart =
    localY - SEQUENCE_ACTIVATION_HEIGHT / 2 - SEQUENCE_MIN_ACTIVATION_OFFSET;
  const candidateEnd =
    localY + SEQUENCE_ACTIVATION_HEIGHT / 2 + SEQUENCE_MIN_ACTIVATION_OFFSET;
  const poleX = lifeline.width / 2;
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const;
  for (const element of app.scene.getNonDeletedElements()) {
    if (element.id === lifeline.id || !isActivationElement(element)) {
      continue;
    }
    const cos = Math.cos(element.angle);
    const sin = Math.sin(element.angle);
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [ux, uy] of corners) {
      const local = getSequenceLifelineLocalPoint(
        lifeline,
        cx + ux * element.width * cos - uy * element.height * sin,
        cy + ux * element.width * sin + uy * element.height * cos,
      );
      minX = Math.min(minX, local.x);
      maxX = Math.max(maxX, local.x);
      minY = Math.min(minY, local.y);
      maxY = Math.max(maxY, local.y);
    }
    if (
      minX > poleX + SEQUENCE_HIT_HALF_WIDTH ||
      maxX < poleX - SEQUENCE_HIT_HALF_WIDTH
    ) {
      continue;
    }
    if (candidateStart < maxY && candidateEnd > minY) {
      return true;
    }
  }
  return false;
};

/**
 * A legal pole activation landing: strict topmost is an unlocked lifeline at
 * its pole corridor, and the candidate does not overlap existing activations.
 */
export const resolvePoleActivationTargetAt = (
  app: PointerApp,
  sceneX: number,
  sceneY: number,
  ignoreIds?: ReadonlySet<string>,
): PoleActivationTarget | null => {
  const topmost = getStrictTopmostElementAt(app, sceneX, sceneY, ignoreIds);
  if (!topmost || topmost.locked || !isSequenceLifelineElement(topmost)) {
    return null;
  }
  const lifeline = topmost;
  if (!isPointOnSequenceLifelinePole(lifeline, sceneX, sceneY)) {
    return null;
  }
  const placement = getSequenceLifelinePoleActivationPlacement(
    lifeline,
    sceneX,
    sceneY,
  );
  if (
    !placement ||
    poleActivationOverlapsExisting(app, lifeline, placement.localY)
  ) {
    return null;
  }
  return {
    lifeline,
    localY: placement.localY,
    center: placement.center,
    angle: placement.angle,
  };
};

const activationEdgeProvider: ProviderFor<"activationEdge"> = {
  kind: "activationEdge",
  resolve: (app, input: PointerFrameInput) => {
    if (input.mode !== "selection" || !canHoverSequenceAffordances(app)) {
      return null;
    }
    if (app.quickCreate.isSuppressed()) {
      return null;
    }
    const [x, y] = input.point;
    const candidate = resolveSequenceConnectionAt(app, x, y);
    if (!candidate) {
      return null;
    }
    // 04 §4.8: the topmost interactive element must be this activation, so a
    // connection point never shines through an element stacked above it.
    const topmost = getStrictTopmostElementAt(app, x, y);
    if (topmost?.id !== candidate.elementId) {
      return null;
    }
    return {
      kind: "activationEdge",
      elementId: candidate.elementId,
      side: candidate.side,
      point: pointFrom<GlobalPoint>(candidate.point.x, candidate.point.y),
    };
  },
};

const poleActivationProvider: ProviderFor<"poleActivation"> = {
  kind: "poleActivation",
  resolve: (app, input: PointerFrameInput) => {
    if (input.mode !== "selection" || !canHoverSequenceAffordances(app)) {
      return null;
    }
    if (app.quickCreate.isSuppressed()) {
      return null;
    }
    const [x, y] = input.point;
    const target = resolvePoleActivationTargetAt(app, x, y);
    if (!target) {
      return null;
    }
    return {
      kind: "poleActivation",
      lifelineId: target.lifeline.id,
      placement: {
        center: target.center,
        angle: target.angle as Radians,
        localY: target.localY,
      },
    };
  },
};

registerPointerTargetProvider(activationEdgeProvider);
registerPointerTargetProvider(poleActivationProvider);
