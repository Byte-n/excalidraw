/**
 * Derived hover state for selection-mode pointer frames
 * (docs/pointer-pipeline/05-general-hover.md §4.5).
 *
 * These remain legacy mirrors in PR5; only the frame dispatcher writes them.
 * Mindmap hover (`hoveredElementIds`) is derived from the frame since PR5b.
 */
import {
  isEligibleFrameChildType,
  isEmbeddableElement,
  selectGroupsForSelectedElements,
} from "@excalidraw/element";
import { updateStable } from "@excalidraw/common";

import { getMindmapNodeIdFromPointerTarget } from "../App.mindmap";

import { updateIframeLikeElementHover } from "./embeds";
import { clearContainerInteractionHover } from "./interactionTarget";
import { updateElementLinkHoverAffordance } from "./pointerCanvas";

import type { PointerFrame } from "./pointerFrame";
import type { PointerApp } from "./pointerCursor";

export const clearPointerHover = (app: PointerApp): void => {
  clearContainerInteractionHover(app);
  app.quickCreate?.reset?.();
  // frameToHighlight / highlightedTableCell / hoveredElementId are written by
  // updateDerivedPointerState below (single write, compared) so a hover move
  // does not clear + re-set them in two renders.
};

/**
 * Runs once per frame after target dispatch: frame highlight, table cell,
 * hovered element id, arrow text anchor, link/embed hover.
 */
export const updateDerivedPointerState = (
  app: PointerApp,
  frame: PointerFrame,
): void => {
  // lightweight mocks (interaction-target tests) only exercise container state
  if (
    typeof app.scene?.getNonDeletedElement !== "function" ||
    typeof app.getElementAtPosition !== "function" ||
    typeof app.setState !== "function"
  ) {
    return;
  }
  const point = { x: frame.point[0], y: frame.point[1] };
  // frame-like hover highlight (same eligibility as the legacy helper)
  const eligibleFrameTarget = isEligibleFrameChildType(
    app.state.activeTool?.type,
  )
    ? app.getTopLayerFrameAtSceneCoords?.(point) ?? null
    : null;
  if (
    app.state.frameToHighlight !== eligibleFrameTarget &&
    !app.state?.newElement &&
    !app.state?.multiElement &&
    !app.state?.selectionElement
  ) {
    app.setState({ frameToHighlight: eligibleFrameTarget });
  }

  // table cell highlight (same helper as the legacy hover entry)
  app.maybeUpdateTableCellHighlightOnPointerMove?.(point, false);

  // element hit for embed/link hover (hoveredElementId is owned by
  // pointerCanvas' legacy pointer-derived bridge — 05 §3.3 / O4)
  const hitElementMightBeLocked = app.getElementAtPosition(point.x, point.y, {
    preferSelected: true,
    includeLockedElements: true,
  });
  const hitElement = hitElementMightBeLocked?.locked
    ? null
    : hitElementMightBeLocked;

  // arrow text anchor (drives the text-tool highlight + cursor)
  app.arrowText?.updateHoveredAnchor?.(point);

  // embed hover state (cursor is derived from it), then link hover
  const moveEvent = app.lastPointerMoveEvent as any;
  const iframeHovered =
    moveEvent &&
    updateIframeLikeElementHover(app as any, {
      hitElement,
      scenePointer: point,
      moveEvent,
    });
  if (!iframeHovered) {
    app.hitLinkElement = app.isLinksEnabled?.()
      ? app.getElementLinkAtPosition(point, hitElementMightBeLocked)
      : undefined;
  }
  if (!updateElementLinkHoverAffordance(app)) {
    if (
      hitElement &&
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

  // mindmap node hover (PR5b): the frame target is the only source. Bound
  // text maps to its container node. The link selector keeps its own mirror.
  if (app.state?.openDialog?.name !== "elementLinkSelector") {
    const mindmapNodeId = getMindmapNodeIdFromPointerTarget(
      app as any,
      frame.target,
    );
    const nextHovered: Record<string, true> = mindmapNodeId
      ? { [mindmapNodeId]: true }
      : {};
    app.setState((prevState) => {
      const hoveredElementIds = updateStable(
        prevState.hoveredElementIds,
        nextHovered,
      );
      return hoveredElementIds === prevState.hoveredElementIds
        ? null
        : { hoveredElementIds };
    });
  }

  // link-selector hover mirror (kept; PR5b keeps this exception)
  if (app.state?.openDialog?.name === "elementLinkSelector") {
    if (hitElement) {
      app.setState((prevState) => ({
        hoveredElementIds: updateStable(
          prevState.hoveredElementIds,
          selectGroupsForSelectedElements(
            {
              editingGroupId: prevState.editingGroupId,
              selectedElementIds: { [hitElement.id]: true },
            },
            app.scene.getNonDeletedElements(),
            prevState,
            app,
          ).selectedElementIds,
        ),
      }));
    } else {
      app.setState((prevState) => ({
        hoveredElementIds: updateStable(prevState.hoveredElementIds, {}),
      }));
    }
  }
};
