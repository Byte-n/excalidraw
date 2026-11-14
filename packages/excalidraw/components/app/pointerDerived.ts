/**
 * DOM side effects of pointer hover (docs/pointer-pipeline/05-general-hover.md
 * §4.5). All hover state itself lives in the pointer snapshot; this module only
 * mirrors the link tooltip / popup, which are real DOM surfaces.
 */
import { isEmbeddableElement } from "@excalidraw/element";

import { updateElementLinkHoverAffordance } from "./pointerCanvas";

import type { PointerHoverSnapshot } from "./pointerSnapshot";
import type { PointerApp } from "./pointerCursor";

/** Runs once per committed hover: link tooltip and the view-mode link popup. */
export const applyPointerHoverSideEffects = (
  app: PointerApp,
  hover: PointerHoverSnapshot,
): void => {
  if (
    typeof app.scene?.getNonDeletedElement !== "function" ||
    typeof app.setState !== "function"
  ) {
    return;
  }
  if (!updateElementLinkHoverAffordance(app)) {
    const hitElement =
      hover.elementId && !hover.linkElementId
        ? app.scene.getNonDeletedElement(hover.elementId)
        : null;
    if (
      hitElement &&
      !hitElement.locked &&
      (hitElement.link || isEmbeddableElement(hitElement)) &&
      ((app.editorInterface?.formFactor === "phone" &&
        app.state.selectedElementIds[hitElement.id]) ||
        (app.state.viewModeEnabled &&
          !!hitElement.link &&
          !isEmbeddableElement(hitElement))) &&
      !app.state.contextMenu &&
      !app.state.showHyperlinkPopup
    ) {
      app.setState({ showHyperlinkPopup: "info" });
    }
  }
};
