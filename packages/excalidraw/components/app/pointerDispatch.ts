/**
 * The only writer for a resolved pointer frame
 * (docs/pointer-pipeline/02-frame-contract.md §4.7).
 *
 * PR3a scope: the `connection` target is mirrored into `suggestedBinding`; every
 * other target clears the mirror. Container control / body targets keep their
 * existing dispatch.
 */
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
  // 1. clear the previous frame's container hover
  clearContainerInteractionHover(app);

  // 2. dispatch by target kind
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

  // 3. PR2 keeps cursor ownership in the legacy flow; container targets already
  //    had their cursor set by dispatchContainerInteraction above.
  app.pointer.setFrame(frame, { repaint: false });
};
