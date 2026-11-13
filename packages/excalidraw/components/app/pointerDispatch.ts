/**
 * The only writer for a resolved pointer frame
 * (docs/pointer-pipeline/02-frame-contract.md §4.7).
 *
 * PR2 scope: container control / body targets are dispatched through the
 * existing `dispatchContainerInteraction` (which owns their hover state and
 * cursor). Every other kind is a no-op until PR3 / PR4 / PR5 migrate it.
 */
import {
  clearContainerInteractionHover,
  dispatchContainerInteraction,
} from "./interactionTarget";

import type { PointerFrame } from "./pointerFrame";
import type App from "../App";

type PointerApp = Pick<App, keyof App> & Record<string, any>;

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
      break;

    // kinds not yet migrated in PR2: the legacy flow stays in charge
    case "textHandle":
    case "linearHandle":
    case "transformHandle":
    case "selectedElement":
    case "element":
    case "canvas":
    case "connection":
    case "activationEdge":
    case "poleActivation":
    case "quickCreateHandle":
    case "compositeControl":
    default:
      break;
  }

  // 3. PR2 keeps cursor ownership in the legacy flow; container targets already
  //    had their cursor set by dispatchContainerInteraction above.
  //    No frame consumer exists yet, so this write must not add repaints of its
  //    own (PR3 / PR4 turn the repaint back on).
  app.pointer.setFrame(frame, { repaint: false });
};
