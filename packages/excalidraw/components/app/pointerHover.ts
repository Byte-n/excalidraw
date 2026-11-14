/**
 * Full hover resolution for a pointer position. Pure read: it never writes the
 * cursor, React state or repaint — `AppPointerState` commits the result.
 */
import {
  isEligibleFrameChildType,
  isFrameLikeElement,
  isIframeLikeElement,
  selectGroupsForSelectedElements,
} from "@excalidraw/element";

import { getMindmapNodeIdFromPointerTarget } from "../App.mindmap";

import { derivePointerHover, EMPTY_POINTER_HOVER } from "./pointerSnapshot";
import { getTableCellHighlightAtSceneCoords } from "./table";

import type { PointerHoverSnapshot } from "./pointerSnapshot";
import type { PointerApp } from "./pointerCursor";
import type { PointerFrame } from "./pointerFrame";

export type PointerHoverOptions = {
  /** Scene point for legacy (frameless) pointer moves. */
  point?: { x: number; y: number };
  isOverScrollBar?: boolean;
  /** Drag sessions own the frame highlight through `setFrameHighlight`. */
  preserveFrameHighlight?: boolean;
};

const selectionKey = (app: PointerApp) =>
  Object.keys(app.state.selectedElementIds).sort().join(",");

const getFrameHighlight = (app: PointerApp, point: { x: number; y: number }) =>
  isEligibleFrameChildType(app.state.activeTool.type)
    ? app.getTopLayerFrameAtSceneCoords?.(point) ?? null
    : null;

const getEmbedElementId = (
  app: PointerApp,
  hitElementMightBeLocked: any,
  point: { x: number; y: number },
) => {
  const moveEvent = app.lastPointerMoveEvent;
  if (
    !hitElementMightBeLocked ||
    hitElementMightBeLocked.locked ||
    !isIframeLikeElement(hitElementMightBeLocked) ||
    !moveEvent ||
    typeof app.isIframeLikeInteractive !== "function" ||
    !app.isIframeLikeInteractive(hitElementMightBeLocked) ||
    !(
      app.state.viewModeEnabled ||
      app.state.activeTool.type === "laser" ||
      app.isIframeLikeElementCenter(
        hitElementMightBeLocked,
        moveEvent,
        point.x,
        point.y,
      )
    )
  ) {
    return null;
  }
  return hitElementMightBeLocked.id;
};

export const resolvePointerHover = (
  app: PointerApp,
  frame: PointerFrame | null,
  options: PointerHoverOptions = {},
  previous: PointerHoverSnapshot = EMPTY_POINTER_HOVER,
): PointerHoverSnapshot => {
  const point = frame
    ? { x: frame.point[0], y: frame.point[1] }
    : options.point;
  if (!point) {
    return previous;
  }

  const hitElementMightBeLocked = app.getElementAtPosition(point.x, point.y, {
    preferSelected: true,
    includeLockedElements: true,
  });
  const hitElement =
    hitElementMightBeLocked && !hitElementMightBeLocked.locked
      ? hitElementMightBeLocked
      : null;

  let elementIds: Readonly<Record<string, true>> =
    EMPTY_POINTER_HOVER.elementIds;
  if (app.state.openDialog?.name === "elementLinkSelector") {
    if (hitElement) {
      elementIds = selectGroupsForSelectedElements(
        {
          editingGroupId: app.state.editingGroupId,
          selectedElementIds: { [hitElement.id]: true },
        },
        app.scene.getNonDeletedElements(),
        app.state,
        app as any,
      ).selectedElementIds;
    }
  } else if (typeof app.scene?.getNonDeletedElement === "function") {
    const mindmapNodeId = getMindmapNodeIdFromPointerTarget(
      app as any,
      frame?.target,
    );
    if (mindmapNodeId) {
      elementIds = { [mindmapNodeId]: true };
    }
  }

  const linkElement =
    typeof app.isLinksEnabled === "function" &&
    app.isLinksEnabled() &&
    typeof app.getElementLinkAtPosition === "function"
      ? app.getElementLinkAtPosition(point, hitElementMightBeLocked)
      : null;

  let frameToHighlight = previous.frameToHighlight;
  if (!options.preserveFrameHighlight) {
    const frame = getFrameHighlight(app, point);
    frameToHighlight =
      frame && isFrameLikeElement(frame)
        ? (frame as PointerHoverSnapshot["frameToHighlight"])
        : null;
  }

  const containerHover = derivePointerHover(frame);
  const embedElementId = getEmbedElementId(app, hitElementMightBeLocked, point);

  return {
    ...containerHover,
    elementId: hitElementMightBeLocked?.id ?? null,
    elementIds,
    frameToHighlight,
    cell: getTableCellHighlightAtSceneCoords(
      app as any,
      point,
      options.isOverScrollBar ?? false,
    ),
    arrowTextAnchor:
      app.state.activeTool.type === "text" &&
      !app.state.editingTextElement &&
      !app.state.newElement &&
      typeof app.arrowText?.getAnchorAtPosition === "function"
        ? app.arrowText.getAnchorAtPosition(point.x, point.y)
        : null,
    linkElementId: embedElementId ? null : linkElement?.id ?? null,
    embedElementId,
    transformHandle:
      frame?.target.kind === "transformHandle" ? frame.target.handle : null,
    transformSelectionKey:
      frame?.target.kind === "transformHandle" ? selectionKey(app) : null,
  };
};
