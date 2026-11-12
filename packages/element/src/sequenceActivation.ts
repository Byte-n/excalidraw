import {
  getSequenceLifelineActivationCenter,
  getSequenceLifelineLocalPoint,
  getSequencePoleLength,
  isActivationElement,
  isSequenceLifelineElement,
} from "./compositeShape";

import type { SequenceLifelineElement } from "./compositeShape";

import type { Scene } from "./Scene";
import type {
  ElementsMap,
  ExcalidrawShapeElement,
  ExcalidrawSequenceElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
  SequenceActivationLink,
  SequenceShapeData,
} from "./types";

/** Non-deleted `sc-activation` element with its narrowed shape data. */
export type SequenceActivationElement = NonDeleted<
  ExcalidrawSequenceElement & {
    shape: Extract<SequenceShapeData, { id: "sc-activation" }>;
  }
>;

/**
 * Activation ↔ lifeline pole binding.
 *
 * The activation owns the link (`shape.link` = lifeline id + local y) and the
 * lifeline records the activation in `boundElements` (`type: "activation"`).
 * Both sides are kept in step here so following, snapping and duplication all
 * read one source of truth.
 */

/** How close (scene px) an activation's center must be to a pole to snap. */
export const SEQUENCE_ACTIVATION_SNAP_DISTANCE = 24;

export const getSequenceActivationLink = (
  element: ExcalidrawShapeElement,
): SequenceActivationLink | undefined =>
  isActivationElement(element) ? element.shape.link : undefined;

/**
 * Keeps the lifeline's `boundElements` in sync: adds this activation (and drops
 * it from the previous lifeline if the attachment moved).
 */
export const syncLifelineBoundActivation = (
  activationId: string,
  lifeline: NonDeletedExcalidrawElement,
  previousLifelineId: string | undefined,
  scene: Scene,
) => {
  const next = withActivationEntry(lifeline.boundElements, activationId, true);
  if (next !== lifeline.boundElements) {
    scene.mutateElement(lifeline, { boundElements: next });
  }
  // Re-syncing to the same pole (e.g. dragging an already-bound activation
  // along its lifeline) must keep the entry we just added — only a move to a
  // *different* lifeline detaches from the old one.
  if (!previousLifelineId || previousLifelineId === lifeline.id) {
    return;
  }
  const previous = scene.getNonDeletedElement(previousLifelineId);
  if (!previous) {
    return;
  }
  const detached = withActivationEntry(
    previous.boundElements,
    activationId,
    false,
  );
  if (detached !== previous.boundElements) {
    scene.mutateElement(previous, { boundElements: detached });
  }
};

const withActivationEntry = (
  entries: NonDeletedExcalidrawElement["boundElements"],
  activationId: string,
  add: boolean,
) => {
  const list = entries ?? [];
  const exists = list.some(
    (entry) => entry.id === activationId && entry.type === "activation",
  );
  if (add === exists) {
    return entries;
  }
  return add
    ? [...list, { id: activationId, type: "activation" as const }]
    : list.filter(
        (entry) => !(entry.id === activationId && entry.type === "activation"),
      );
};

/** Clears the activation's link and removes it from the lifeline's registry. */
export const detachSequenceActivation = (
  activation: SequenceActivationElement,
  scene: Scene,
) => {
  const link = getSequenceActivationLink(activation);
  if (!link) {
    return;
  }
  const lifeline = scene.getNonDeletedElement(link.lifelineId);
  if (lifeline) {
    const next = withActivationEntry(
      lifeline.boundElements,
      activation.id,
      false,
    );
    if (next !== lifeline.boundElements) {
      scene.mutateElement(lifeline, { boundElements: next });
    }
  }
  const { link: _link, ...shape } = activation.shape;
  scene.mutateElement(activation, { shape });
};

/**
 * Re-positions every activation attached to `lifeline` after the lifeline
 * moved / resized / rotated. `localY` is re-clamped, so shrinking the pole
 * keeps attached bars inside it.
 */
export const updateSequenceActivationsForLifeline = (
  lifeline: NonDeletedExcalidrawElement,
  scene: Scene,
  simultaneouslyUpdatedElementIds?: ReadonlySet<string>,
): NonDeletedExcalidrawElement[] => {
  if (!isSequenceLifelineElement(lifeline)) {
    return [];
  }
  const moved: NonDeletedExcalidrawElement[] = [];
  const elementsMap = scene.getNonDeletedElementsMap();
  for (const bound of lifeline.boundElements ?? []) {
    if (bound.type !== "activation") {
      continue;
    }
    if (simultaneouslyUpdatedElementIds?.has(bound.id)) {
      continue;
    }
    const activation = elementsMap.get(bound.id);
    if (!activation || !isActivationElement(activation)) {
      continue;
    }
    const link = getSequenceActivationLink(activation);
    if (link?.lifelineId !== lifeline.id) {
      continue;
    }
    const placed = getSequenceLifelineActivationCenter(
      lifeline,
      link.localY,
      activation.height,
    );
    const x = placed.center.x - activation.width / 2;
    const y = placed.center.y - activation.height / 2;
    if (
      x !== activation.x ||
      y !== activation.y ||
      placed.angle !== activation.angle ||
      placed.localY !== link.localY
    ) {
      scene.mutateElement(activation, {
        x,
        y,
        angle: placed.angle,
        shape: {
          ...activation.shape,
          link: { ...link, localY: placed.localY },
        },
      });
      const updated = scene.getNonDeletedElement(activation.id);
      if (updated) {
        moved.push(updated);
      }
    }
  }
  return moved;
};

export type SequenceActivationSnap = {
  lifeline: NonDeleted<SequenceLifelineElement>;
  localY: number;
  center: { x: number; y: number };
  angle: ExcalidrawSequenceElement["angle"];
};

/**
 * Nearest pole an activation placed at `(centerX, centerY)` can snap to.
 * The activation center must project onto the pole's vertical span; only the
 * horizontal distance is measured against `threshold`.
 */
export const findSequenceActivationSnap = (
  elementsMap: ElementsMap,
  centerX: number,
  centerY: number,
  threshold: number = SEQUENCE_ACTIVATION_SNAP_DISTANCE,
  excludeLifelineId?: string,
): SequenceActivationSnap | null => {
  let best: {
    lifeline: NonDeleted<SequenceLifelineElement>;
    localY: number;
    dx: number;
  } | null = null;
  for (const element of elementsMap.values()) {
    if (
      element.id === excludeLifelineId ||
      element.isDeleted ||
      !isSequenceLifelineElement(element)
    ) {
      continue;
    }
    const headHeight = element.shape.lifeline.headHeight;
    const poleEnd =
      headHeight + getSequencePoleLength(element.height, headHeight);
    const local = getSequenceLifelineLocalPoint(element, centerX, centerY);
    if (local.y < headHeight || local.y > poleEnd) {
      continue;
    }
    const dx = Math.abs(local.x - element.width / 2);
    if (dx > threshold) {
      continue;
    }
    if (!best || dx < best.dx) {
      best = {
        lifeline: element as NonDeleted<SequenceLifelineElement>,
        localY: local.y,
        dx,
      };
    }
  }
  if (!best) {
    return null;
  }
  const placed = getSequenceLifelineActivationCenter(
    best.lifeline,
    best.localY,
  );
  return {
    lifeline: best.lifeline,
    localY: placed.localY,
    center: placed.center,
    angle: placed.angle,
  };
};

/**
 * Drag result for an activation: snap to the nearest pole (centering it), or
 * stay free. `link` is the new link (null when free).
 */
export const getSequenceActivationDragPlacement = (
  elementsMap: ElementsMap,
  centerX: number,
  centerY: number,
  height: number,
  threshold: number = SEQUENCE_ACTIVATION_SNAP_DISTANCE,
): {
  snap: SequenceActivationSnap | null;
  center: { x: number; y: number };
} => {
  const snap = findSequenceActivationSnap(
    elementsMap,
    centerX,
    centerY,
    threshold,
  );
  if (!snap) {
    return { snap: null, center: { x: centerX, y: centerY } };
  }
  const placed = getSequenceLifelineActivationCenter(
    snap.lifeline,
    snap.localY,
    height,
  );
  return {
    snap: { ...snap, localY: placed.localY, center: placed.center },
    center: placed.center,
  };
};
