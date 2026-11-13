/**
 * Single cursor writer for selection-mode pointer frames
 * (docs/pointer-pipeline/05-general-hover.md §4.4).
 *
 * Every function here is a pure read: it never calls `app.cursor.set`.
 */
import { CURSOR_TYPE, KEYS } from "@excalidraw/common";
import {
  getCursorForResizingElement,
  isElbowArrow,
  isMindmapEdgeElement,
  LinearElementEditor,
} from "@excalidraw/element";

import type { GlobalPoint } from "@excalidraw/math";

import { getToolCursor } from "../App.cursor";

import { getContainerProviderCursor } from "./interactionTarget";

import type { PointerFrame, PointerTarget } from "./pointerFrame";
import type App from "../App";

export type PointerApp = Pick<App, keyof App> & Record<string, any>;

const isCommonBoundingBox = (app: PointerApp, point: GlobalPoint) =>
  typeof app.isHittingCommonBoundingBoxOfSelectedElements === "function" &&
  app.isHittingCommonBoundingBoxOfSelectedElements(
    { x: point[0], y: point[1] },
    app.scene.getSelectedElements(app.state),
  );

const isMindmapTool = (app: PointerApp) =>
  app.state.activeTool?.type === "mindmap";

/**
 * Collapse affordance (badge / minus) is not a target: it overlaps the frame's
 * element or canvas. Kept inside the single cursor writer so no module writes
 * the cursor after dispatch.
 */
const getCollapseAffordanceCursor = (
  app: PointerApp,
  frame: PointerFrame,
): string | null => {
  if (
    typeof app.mindmap?.hitTestCollapseAffordance !== "function" ||
    app.state.viewModeEnabled ||
    (typeof app.isInteractionEnabled === "function" &&
      !app.isInteractionEnabled())
  ) {
    return null;
  }
  return app.mindmap.hitTestCollapseAffordance(frame.point[0], frame.point[1])
    ? CURSOR_TYPE.POINTER
    : null;
};

/**
 * Element-hover cursor priority (05 §4.4): link/embed → text tool / arrow text
 * anchor → mindmap edge → ctrl/bbox → view mode → link selector → draggable
 * element (elbow/ lasso guards) → tool cursor.
 */
export const getElementHoverCursor = (
  app: PointerApp,
  elementId: string,
  point: GlobalPoint | { x: number; y: number },
): string => {
  const scenePoint = Array.isArray(point)
    ? { x: point[0], y: point[1] }
    : (point as { x: number; y: number });
  const element =
    typeof app.scene?.getNonDeletedElement === "function"
      ? app.scene.getNonDeletedElement(elementId)
      : null;
  const selectedElements = app.scene.getSelectedElements?.(app.state) ?? [];
  const selected = app.state.selectedElementIds[elementId];

  // link hover (tooltip/state is derived in updateDerivedPointerState)
  if (app.hitLinkElement?.id === elementId && !selected) {
    return CURSOR_TYPE.POINTER;
  }
  // interactive embed hover
  if (
    app.state.activeEmbeddable?.state === "hover" &&
    app.state.activeEmbeddable.element.id === elementId
  ) {
    return CURSOR_TYPE.POINTER;
  }
  if (app.state.activeTool?.type === "text") {
    return app.state.hoveredArrowTextAnchor
      ? CURSOR_TYPE.POINTER
      : CURSOR_TYPE.TEXT;
  }
  if (element && isMindmapEdgeElement(element)) {
    return app.mindmap?.isCompleteMindmapSelection?.()
      ? getToolCursor(app)
      : CURSOR_TYPE.POINTER;
  }
  if (!app.lastPointerMoveEvent?.[KEYS.CTRL_OR_CMD]) {
    // CTRL is read from the frame input below when available; this fallback
    // covers callers without a frame.
    if (isCommonBoundingBox(app, [scenePoint.x, scenePoint.y] as GlobalPoint)) {
      return CURSOR_TYPE.MOVE;
    }
  }
  if (app.state.viewModeEnabled) {
    return CURSOR_TYPE.GRAB;
  }
  if (app.state.openDialog?.name === "elementLinkSelector") {
    return CURSOR_TYPE.AUTO;
  }
  if (
    element &&
    !element.locked &&
    !app.lastPointerMoveEvent?.[KEYS.CTRL_OR_CMD] &&
    element.id !== app.state.editingTextElement?.id
  ) {
    if (isCommonBoundingBox(app, [scenePoint.x, scenePoint.y] as GlobalPoint)) {
      return CURSOR_TYPE.MOVE;
    }
    const moveAllowed =
      (!isElbowArrow(element) ||
        !(element.startBinding || element.endBinding)) &&
      (app.state.activeTool?.type !== "lasso" || selectedElements.length > 0);
    return moveAllowed ? CURSOR_TYPE.MOVE : CURSOR_TYPE.AUTO;
  }
  return CURSOR_TYPE.AUTO;
};

/** Cursor for a hovered selected linear point handle (legacy precedence). */
const getLinearHoverCursor = (
  app: PointerApp,
  elementId: string,
  point: { x: number; y: number },
): string => {
  const editor = app.state.selectedLinearElement;
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const element = LinearElementEditor.getElement(elementId as any, elementsMap);
  if (!element) {
    return getToolCursor(app);
  }
  const hoverPointIndex = LinearElementEditor.getPointIndexUnderCursor(
    element,
    elementsMap,
    app.state.zoom,
    point.x,
    point.y,
  );
  const isHoveringAPointHandle = LinearElementEditor.isPointHandle(
    element,
    hoverPointIndex,
  );
  const segmentMidPointHoveredCoords =
    isHoveringAPointHandle || !editor
      ? null
      : LinearElementEditor.getSegmentMidpointHitCoords(
          editor,
          point,
          app.state,
          elementsMap,
        );
  if (isHoveringAPointHandle || segmentMidPointHoveredCoords) {
    return CURSOR_TYPE.POINTER;
  }
  if (app.arrowText.isBoundTextGrabbable(element, point.x, point.y)) {
    return CURSOR_TYPE.GRAB;
  }
  if (
    app.hitElement(point.x, point.y, element) &&
    (!isElbowArrow(element) || !(element.startBinding || element.endBinding)) &&
    (app.state.activeTool?.type !== "lasso" ||
      Object.keys(app.state.selectedElementIds).length > 0)
  ) {
    return CURSOR_TYPE.MOVE;
  }
  if (app.state.selectedLinearElement?.hoveredFocusPointBinding) {
    return CURSOR_TYPE.POINTER;
  }
  return getToolCursor(app);
};

/** The single cursor decision for a resolved frame. */
export const getCursorForPointerTarget = (
  app: PointerApp,
  frame: PointerFrame,
): string => {
  const target: PointerTarget = frame.target;
  switch (target.kind) {
    case "textHandle":
      return CURSOR_TYPE.POINTER;
    case "linearHandle":
      return getLinearHoverCursor(app, target.elementId, {
        x: frame.point[0],
        y: frame.point[1],
      });
    case "transformHandle":
      return getCursorForResizingElement({
        transformHandleType: target.handle,
      });
    case "compositeControl":
      return CURSOR_TYPE.MOVE;
    case "selectedElement":
      // mindmap tool keeps the tool cursor on nodes (HEAD behavior); the
      // collapse affordance is the only pointer affordance there
      return isMindmapTool(app)
        ? getCollapseAffordanceCursor(app, frame) ?? getToolCursor(app)
        : getCollapseAffordanceCursor(app, frame) ?? CURSOR_TYPE.MOVE;
    case "element":
      if (isMindmapTool(app)) {
        return getCollapseAffordanceCursor(app, frame) ?? getToolCursor(app);
      }
      return (
        getCollapseAffordanceCursor(app, frame) ??
        getElementHoverCursor(app, target.elementId, frame.point)
      );
    case "mindmapAddButton":
      return CURSOR_TYPE.POINTER;
    case "containerControl":
      return (
        getContainerProviderCursor(app, target.candidate) || getToolCursor(app)
      );
    case "containerBody":
      return CURSOR_TYPE.MOVE;
    case "connection":
      return getToolCursor(app);
    case "quickCreateHandle":
    case "activationEdge":
    case "poleActivation":
      return CURSOR_TYPE.POINTER;
    case "canvas":
    default:
      return getCollapseAffordanceCursor(app, frame) ?? getToolCursor(app);
  }
};
