import {
  CURSOR_TYPE,
  isLocalLink,
  normalizeLink,
  DRAGGING_THRESHOLD,
  EVENT,
  wrapEvent,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { pointFrom, pointDistance } from "@excalidraw/math";
import { isEligibleFrameChildType } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  hideHyperlinkToolip,
  showHyperlinkTooltip,
} from "../hyperlink/Hyperlink";
import { isPointHittingLink } from "../hyperlink/helpers";

/** Finds the topmost linked element under a pointer. */
export const getElementLinkAtPosition = (
  app: any,
  scenePointer: Readonly<{ x: number; y: number }>,
  hitElementMightBeLocked: NonDeletedExcalidrawElement | null,
): NonDeletedExcalidrawElement | undefined => {
  if (hitElementMightBeLocked?.locked) {
    return undefined;
  }
  const elements = app.scene.getNonDeletedElements();
  let hitElementIndex = -1;
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index];
    if (hitElementMightBeLocked && element.id === hitElementMightBeLocked.id) {
      hitElementIndex = index;
    }
    if (
      element.link &&
      index >= hitElementIndex &&
      isPointHittingLink(
        element,
        app.scene.getNonDeletedElementsMap(),
        app.state,
        pointFrom(scenePointer.x, scenePointer.y),
        app.editorInterface.formFactor === "phone",
      )
    ) {
      return element;
    }
  }
  return undefined;
};

export const applyElementLinkHoverAffordance = (app: any): boolean => {
  if (
    app.hitLinkElement &&
    !app.state.selectedElementIds[app.hitLinkElement.id]
  ) {
    app.cursor.set(CURSOR_TYPE.POINTER);
    showHyperlinkTooltip(
      app.hitLinkElement,
      app.state,
      app.scene.getNonDeletedElementsMap(),
    );
    return true;
  }
  hideHyperlinkToolip();
  return false;
};

export const updateFrameToHighlight = (app: any, frameToHighlight: any) => {
  if (app.state.frameToHighlight !== frameToHighlight) {
    app.setState({ frameToHighlight });
  }
};

export const maybeUpdateFrameToHighlightOnPointerMove = (
  app: any,
  sceneCoords: { x: number; y: number },
  isOverScrollBar: boolean,
) => {
  if (
    app.state.newElement ||
    app.state.multiElement ||
    app.state.selectionElement ||
    app.state.selectedElementsAreBeingDragged
  ) {
    return;
  }
  updateFrameToHighlight(
    app,
    !isOverScrollBar && isEligibleFrameChildType(app.state.activeTool.type)
      ? app.getTopLayerFrameAtSceneCoords(sceneCoords)
      : null,
  );
};

/** Opens an element link after a click that did not turn into a drag. */
export const handleElementLinkClick = (
  app: any,
  event: React.PointerEvent<HTMLCanvasElement>,
) => {
  if (
    !app.hitLinkElement ||
    !app.lastPointerDownEvent ||
    !app.lastPointerUpEvent
  ) {
    return;
  }
  const draggedDistance = pointDistance(
    pointFrom(
      app.lastPointerDownEvent.clientX,
      app.lastPointerDownEvent.clientY,
    ),
    pointFrom(app.lastPointerUpEvent.clientX, app.lastPointerUpEvent.clientY),
  );
  if (draggedDistance > DRAGGING_THRESHOLD) {
    return;
  }
  const down = viewportCoordsToSceneCoords(app.lastPointerDownEvent, app.state);
  const up = viewportCoordsToSceneCoords(app.lastPointerUpEvent, app.state);
  const elementsMap = app.scene.getNonDeletedElementsMap();
  if (
    !isPointHittingLink(
      app.hitLinkElement,
      elementsMap,
      app.state,
      pointFrom(down.x, down.y),
      app.editorInterface.formFactor === "phone",
    ) ||
    !isPointHittingLink(
      app.hitLinkElement,
      elementsMap,
      app.state,
      pointFrom(up.x, up.y),
      app.editorInterface.formFactor === "phone",
    )
  ) {
    return;
  }
  hideHyperlinkToolip();
  if (!app.hitLinkElement.link) {
    return;
  }
  const url = normalizeLink(app.hitLinkElement.link);
  const customEvent = app.props.onLinkOpen
    ? wrapEvent(EVENT.EXCALIDRAW_LINK, event.nativeEvent)
    : undefined;
  app.props.onLinkOpen?.({ ...app.hitLinkElement, link: url }, customEvent);
  if (!customEvent?.defaultPrevented) {
    const target = isLocalLink(url) ? "_self" : "_blank";
    const newWindow = app.ownerWindow.open(undefined, target);
    if (newWindow) {
      newWindow.opener = null;
      newWindow.location = url;
    }
  }
};
