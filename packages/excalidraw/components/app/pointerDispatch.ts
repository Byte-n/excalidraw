/**
 * The only writer for a resolved pointer frame
 * (docs/pointer-pipeline/02-frame-contract.md §4.7).
 *
 * PR3a scope: the `connection` target is mirrored into `suggestedBinding`; every
 * other target clears the mirror. Container control / body targets keep their
 * existing dispatch.
 */
import { CURSOR_TYPE } from "@excalidraw/common";
import { isSameSuggestedBinding } from "@excalidraw/element";

import type {
  ExcalidrawBindableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import {
  clearContainerInteractionHover,
  dispatchContainerInteraction,
} from "./interactionTarget";

import type { PointerFrame } from "./pointerFrame";
import type App from "../App";

type PointerApp = Pick<App, keyof App> & Record<string, any>;

const clearSuggestedBinding = (app: PointerApp) => {
  if (app.state.suggestedBinding) {
    app.setState({ suggestedBinding: null });
  }
};

export const applyPointerFrame = (
  app: PointerApp,
  frame: PointerFrame,
): void => {
  // A hover frame must never displace a sequence-affordance gesture frame:
  // those owners keep the frame until pointerup (synthetic moves may report no
  // buttons). Selection / table / mindmap sessions keep the old behavior.
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

  // 1. clear the previous frame's container hover
  clearContainerInteractionHover(app);

  // 2. store the frame first: the renderer reads `getFrame()`.
  app.pointer.setFrame(frame, { repaint: false });
  const isSequenceTarget = (target: PointerFrame["target"] | undefined) =>
    target?.kind === "quickCreateHandle" ||
    target?.kind === "activationEdge" ||
    target?.kind === "poleActivation";
  // sequence hover visuals are component-external state: repaint on enter / move
  // / leave (same repaint budget as the old hover handler).
  if (
    isSequenceTarget(frame.target) ||
    isSequenceTarget(existingFrame?.target)
  ) {
    app.repaint.request();
  }

  // 3. sequence-affordance visuals read the frame + ghost caches directly
  //    (PR4b): no hover mirrors to write here.
  switch (frame.target.kind) {
    case "quickCreateHandle":
    case "activationEdge":
    case "poleActivation":
      if (
        frame.phase === "hover" &&
        !app.state.viewModeEnabled &&
        app.isInteractionEnabled()
      ) {
        app.cursor.set(CURSOR_TYPE.POINTER);
      }
      break;
    default:
      break;
  }

  // 3. dispatch by target kind
  switch (frame.target.kind) {
    case "containerControl":
    case "containerBody":
      dispatchContainerInteraction(app, frame.target.candidate);
      clearSuggestedBinding(app);
      break;

    case "connection": {
      const element = app.scene.getNonDeletedElement(
        frame.target.elementId,
      ) as NonDeleted<ExcalidrawBindableElement> | null;
      if (!element) {
        clearSuggestedBinding(app);
        break;
      }
      const next = { element, hit: frame.target.hit };
      app.setState((prev) =>
        isSameSuggestedBinding(prev.suggestedBinding, next)
          ? null
          : { suggestedBinding: next },
      );
      break;
    }

    // every other kind is not a connection affordance
    case "textHandle":
    case "linearHandle":
    case "transformHandle":
    case "selectedElement":
    case "element":
    case "canvas":
    case "activationEdge":
    case "poleActivation":
    case "quickCreateHandle":
    case "compositeControl":
    default:
      clearSuggestedBinding(app);
      break;
  }
};
