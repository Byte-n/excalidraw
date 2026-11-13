/**
 * The only writer for a resolved pointer frame
 * (docs/pointer-pipeline/02-frame-contract.md §4.7, 05-general-hover.md §4.3).
 *
 * PR5a-1: one cursor writer per frame; hover mirrors derived here.
 */
import { clearPointerHover, updateDerivedPointerState } from "./pointerDerived";
import { getCursorForPointerTarget } from "./pointerCursor";
import { renderContainerInteractionHover } from "./interactionTarget";

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

  // 1. full hover cleanup (container providers + derived mirrors)
  clearPointerHover(app);
  if (
    isSequenceTarget(existingFrame?.target) &&
    !isSequenceTarget(frame.target)
  ) {
    app.quickCreate.reset();
  }

  // 2. store the frame first: renderer / cursor helpers read `getFrame()`
  const previousHoverPoint = app.pointer.getLastHoverPoint?.() ?? null;
  const frameChanged = app.pointer.setFrame(frame, { repaint: false });

  // 3. transform-handle readout: exactly one write per frame (set OR clear),
  //    so hovering a handle does not clear + re-set on every pointermove.
  //    The readout follows the pointer, so a move over the same handle still
  //    needs one interactive frame (HEAD got this from clear + set).
  if (frame.target.kind === "transformHandle") {
    const changed = app.transformStatus?.setHoveredHandle(frame.target.handle);
    if (
      !changed &&
      previousHoverPoint &&
      (previousHoverPoint[0] !== frame.point[0] ||
        previousHoverPoint[1] !== frame.point[1])
    ) {
      // unchanged handle but the pointer moved: the readout follows the
      // pointer, so this move still needs one interactive frame
      app.repaint?.request();
    }
  } else {
    app.transformStatus?.clearHovered();
  }

  // 4. target dispatch (hover state only; never the cursor)
  switch (frame.target.kind) {
    case "linearHandle": {
      const editor = app.state.selectedLinearElement;
      if (editor && editor.elementId === frame.target.elementId) {
        app.handleHoverSelectedLinearElement(
          editor,
          frame.point[0],
          frame.point[1],
          { setCursor: false },
        );
      }
      break;
    }
    case "containerControl":
    case "containerBody":
      renderContainerInteractionHover(app, frame.target.candidate);
      break;
    case "connection":
      // The renderer reads the frame's connection target directly; nothing to
      // mirror into app state (PR6).
      break;
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
    mindmapAddButtonChanged
  ) {
    app.repaint.request();
  }

  // 4. derived hover (frame highlight, table cell, hovered ids, link/embed)
  updateDerivedPointerState(app, frame);

  // 5. the single cursor write for this frame
  app.cursor.set(getCursorForPointerTarget(app, frame));
};
