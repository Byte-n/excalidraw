/**
 * The only writer for a resolved pointer frame
 * (docs/pointer-pipeline/02-frame-contract.md §4.7, 05-general-hover.md §4.3).
 *
 * PR5a-1: one cursor writer per frame; hover mirrors derived here.
 */
import { applyPointerHoverSideEffects } from "./pointerDerived";
import { getCursorForPointerTarget } from "./pointerCursor";
import { resolvePointerHover } from "./pointerHover";

import type { PointerFrame } from "./pointerFrame";
import type App from "../App";

type PointerApp = Pick<App, keyof App> & Record<string, any>;

const isSequenceTarget = (target: PointerFrame["target"] | undefined) =>
  target?.kind === "quickCreateHandle" ||
  target?.kind === "activationEdge" ||
  target?.kind === "poleActivation";

const sameConnectionTarget = (
  a: PointerFrame["target"] | undefined,
  b: PointerFrame["target"] | undefined,
): boolean => {
  if (a?.kind !== "connection" || b?.kind !== "connection") {
    return false;
  }
  return (
    a.elementId === b.elementId &&
    a.hit.tier === b.hit.tier &&
    a.hit.anchorIndex === b.hit.anchorIndex &&
    a.hit.point[0] === b.hit.point[0] &&
    a.hit.point[1] === b.hit.point[1] &&
    a.hit.anchors.length === b.hit.anchors.length
  );
};

export const applyPointerFrame = (
  app: PointerApp,
  frame: PointerFrame,
): void => {
  // A hover frame must never displace a sequence-affordance gesture frame.
  const existingFrame =
    typeof app.pointer?.getFrame === "function" ? app.pointer.getFrame() : null;
  const sequenceOwnedFrame =
    existingFrame &&
    ((existingFrame.phase === "gesture" &&
      (existingFrame.owner === "quickCreate" ||
        existingFrame.owner === "sequenceMessage")) ||
      (existingFrame.phase === "armed" &&
        existingFrame.target.kind === "poleActivation"));
  if (frame.phase === "hover" && sequenceOwnedFrame) {
    return;
  }

  // 1. affordance preview caches reset with every hover frame; container
  //    hover is part of the snapshot and replaced atomically below.
  app.quickCreate?.reset?.();
  if (
    isSequenceTarget(existingFrame?.target) &&
    !isSequenceTarget(frame.target)
  ) {
    app.quickCreate.reset();
  }

  // 2. store the frame + derived hover atomically: renderer / cursor helpers
  //    read the snapshot. Comparison runs against the previous synchronous
  //    snapshot, never against async React state.
  const previousHoverPoint = app.pointer.getLastHoverPoint?.() ?? null;
  const hover = resolvePointerHover(
    app,
    frame,
    {},
    app.pointer.getHoverSnapshot?.(),
  );
  const commit = app.pointer.commit(frame, { repaint: false, hover });
  const frameChanged = commit.frameChanged;

  // 3. transform-handle readout follows the pointer: a move over the same
  //    handle still needs one interactive frame even though the snapshot's
  //    hover fields are unchanged.
  if (
    frame.target.kind === "transformHandle" &&
    !commit.hoverChanged &&
    previousHoverPoint &&
    (previousHoverPoint[0] !== frame.point[0] ||
      previousHoverPoint[1] !== frame.point[1])
  ) {
    app.repaint?.request();
  }

  // 4. target dispatch (hover state only; never the cursor). Container hover
  //    was already committed atomically with the frame above.
  if (frame.target.kind === "linearHandle") {
    const editor = app.state.selectedLinearElement;
    if (editor && editor.elementId === frame.target.elementId) {
      app.handleHoverSelectedLinearElement(
        editor,
        frame.point[0],
        frame.point[1],
        { setCursor: false },
      );
    }
  }

  // sequence / mindmap add-button hover visuals are component-external state.
  // The add button only repaints when its hover state changes: moving inside
  // the same button must not repaint (the frame point still differs there).
  const previousTarget = existingFrame?.target;
  const nextTarget = frame.target;
  const mindmapAddButtonChanged =
    frameChanged &&
    ((previousTarget?.kind === "mindmapAddButton") !==
      (nextTarget.kind === "mindmapAddButton") ||
      (previousTarget?.kind === "mindmapAddButton" &&
        nextTarget.kind === "mindmapAddButton" &&
        (previousTarget.elementId !== nextTarget.elementId ||
          previousTarget.button !== nextTarget.button)));
  const connectionChanged =
    frameChanged &&
    (nextTarget.kind === "connection" ||
      previousTarget?.kind === "connection") &&
    !sameConnectionTarget(previousTarget, nextTarget);
  if (
    isSequenceTarget(frame.target) ||
    isSequenceTarget(existingFrame?.target) ||
    connectionChanged ||
    mindmapAddButtonChanged ||
    (commit.hoverChanged && frame.target.kind !== "linearHandle")
  ) {
    app.repaint.request();
  }

  // 4. DOM-only hover side effects (link tooltip / popup); every hover
  //    affordance itself was committed atomically above.
  applyPointerHoverSideEffects(app, app.pointer.getHoverSnapshot());

  // 5. the single cursor write for this frame
  app.cursor.set(getCursorForPointerTarget(app, frame));
};
