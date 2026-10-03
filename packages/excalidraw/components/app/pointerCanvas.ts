import { TAP_TWICE_TIMEOUT } from "@excalidraw/common";
import {
  isFrameLikeElement,
  isCursorInFrame,
  handleFocusPointHover,
} from "@excalidraw/element";

import { flushSync } from "react-dom";
import {
  KEYS,
  LINE_CONFIRM_THRESHOLD,
  POINTER_BUTTON,
  isTransparent,
  isSelectionLikeTool,
  updateStable,
  DOUBLE_TAP_POSITION_THRESHOLD,
  invariant,
} from "@excalidraw/common";
import {
  getCommonBounds,
  getHoveredElementForBinding,
  isBindingEnabled,
  LinearElementEditor,
  hasBoundTextElement,
  isBindingElementType,
  isImageElement,
  isEmbeddableElement,
  isLinearElement,
  isIframeLikeElement,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  isElbowArrow,
  isTextElement,
  isPathALoop,
  getContainerCenter,
  hitElementItself,
  getSelectedGroupIdForElement,
  getSelectedGroupIds,
  selectGroupsForSelectedElements,
  getCursorForResizingElement,
  getElementWithTransformHandleType,
  getTransformHandleTypeFromCoords,
  isLineElement,
  isSimpleArrow,
  isTableElement,
  isPointInElement,
  maxBindingDistance_simple,
  getSnapOutlineMidPoint,
} from "@excalidraw/element";

import {
  CURSOR_TYPE,
  getFeatureFlag,
  isLocalLink,
  normalizeLink,
  DRAGGING_THRESHOLD,
  EVENT,
  wrapEvent,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import { pointFrom, pointDistance } from "@excalidraw/math";

import { isEligibleFrameChildType } from "@excalidraw/element";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { actionToggleLinearEditor } from "../../actions";
import { isEraserActive, isHandToolActive } from "../../appState";

import {
  getSnapLinesAtPointer,
  isActiveToolNonLinearSnappable,
} from "../../snapping";
import { isOverScrollBars } from "../../scene/scrollbars";

import {
  hideHyperlinkToolip,
  showHyperlinkTooltip,
} from "../hyperlink/Hyperlink";
import { isPointHittingLink } from "../hyperlink/helpers";

import {
  clearContainerInteractionHover,
  dispatchContainerInteraction,
  resolveInteractionTarget,
} from "./interactionTarget";

import { hitCompositeControlPoint } from "./compositeShapeControls";
import { handleTableTitleDoubleClick } from "./table";

import type { AppState, CollaboratorPointer } from "../../types";

import type React from "react";

import type App from "../App";

export const savePointer = (
  app: App,
  x: number,
  y: number,
  button: "up" | "down",
) => {
  if (app.pan.isActive()) {
    return;
  }
  if (
    !app.isInteractionEnabled() &&
    !app.isToolSupported(app.state.activeTool.type)
  ) {
    return;
  }
  if (!x || !y) {
    return;
  }
  const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
    { clientX: x, clientY: y },
    app.state,
  );
  const pointer: CollaboratorPointer = {
    x: sceneX,
    y: sceneY,
    tool: app.state.activeTool.type === "laser" ? "laser" : "pointer",
  };
  app.props.onPointerUpdate?.({
    pointer,
    button,
    pointersMap: app.gesture.pointers,
  });
};

type PointerApp = Pick<App, keyof App> & Record<string, any>;

/** Finds the topmost linked element under a pointer. */
export const getElementLinkAtPosition = (
  app: PointerApp,
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

export const applyElementLinkHoverAffordance = (app: PointerApp): boolean => {
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

export const updateFrameToHighlight = (
  app: PointerApp,
  frameToHighlight: any,
) => {
  if (app.state.frameToHighlight !== frameToHighlight) {
    app.setState({ frameToHighlight });
  }
};

export const maybeUpdateFrameToHighlightOnPointerMove = (
  app: PointerApp,
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

export const handleCanvasPointerUp = (
  app: PointerApp,
  event: React.PointerEvent<HTMLCanvasElement>,
) => {
  if (!app.isInteractionEnabled()) {
    if (app.isLinksEnabled() || app.isEmbedsEnabled()) {
      app.handleInteractiveContentPointerUp(event);
    }
    return;
  }
  if (getFeatureFlag("COMPLEX_BINDINGS")) {
    app.resetDelayedBindMode();
  }

  app.removePointer(event);
  app.lastPointerUpIsDoubleClick = app.isDoubleClick(
    app.lastPointerUpEvent,
    event,
  );
  app.lastPointerUpEvent = event;

  if (!event.ctrlKey) {
    const preferenceEnabled = app.state.bindingPreference === "enabled";
    if (app.state.isBindingEnabled !== preferenceEnabled) {
      app.setState({ isBindingEnabled: preferenceEnabled });
    }
  }

  const scenePointer = viewportCoordsToSceneCoords(
    { clientX: event.clientX, clientY: event.clientY },
    app.state,
  );
  const { x: scenePointerX, y: scenePointerY } = scenePointer;
  app.lastPointerMoveCoords = {
    x: scenePointerX,
    y: scenePointerY,
  };

  if (app.handleIframeLikeCenterClick()) {
    return;
  }

  if (
    !app.maybeHandleElementLinkClick(event, scenePointer) &&
    app.state.viewModeEnabled
  ) {
    app.setState({
      activeEmbeddable: null,
      selectedElementIds: {},
    });
  }
};

/** Opens an element link after a click that did not turn into a drag. */
export const handleElementLinkClick = (
  app: PointerApp,
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
  if (customEvent) {
    app.props.onLinkOpen?.({ ...app.hitLinkElement, link: url }, customEvent);
  }
  if (!customEvent?.defaultPrevented) {
    const target = isLocalLink(url) ? "_self" : "_blank";
    const newWindow = app.ownerWindow.open(undefined, target);
    if (newWindow) {
      newWindow.opener = null;
      newWindow.location = url;
    }
  }
};

export const shouldHandleBrowserCanvasDoubleClick = (
  app: PointerApp,
  type: string,
) => {
  // TODO remove app once we consolidate double-click logic and handle
  // ourselves for all event types together
  if (type === "touch") {
    return true;
  }
  if (app.lastCompletedCanvasClicks.length === 0) {
    return true;
  }

  if (app.lastCompletedCanvasClicks.length < 2) {
    return false;
  }

  const [firstClick, secondClick] = app.lastCompletedCanvasClicks;

  return (
    pointDistance(
      pointFrom(firstClick.x, firstClick.y),
      pointFrom(secondClick.x, secondClick.y),
    ) <= DOUBLE_TAP_POSITION_THRESHOLD
  );
};

export const handleCanvasDoubleClick = (
  app: PointerApp,
  event: Pick<
    React.MouseEvent<HTMLCanvasElement>,
    | "type"
    | "clientX"
    | "clientY"
    | "altKey"
    | "ctrlKey"
    | "metaKey"
    | "shiftKey"
  >,
) => {
  if (
    !app.isInteractionEnabled() ||
    app.state.editingTextElement ||
    !app.shouldHandleBrowserCanvasDoubleClick(event.type)
  ) {
    return;
  }
  const mindmapScenePoint = viewportCoordsToSceneCoords(event, app.state);
  if (app.mindmap.handleDoubleClick(mindmapScenePoint.x, mindmapScenePoint.y)) {
    return;
  }

  // case: double-clicking with arrow/line tool selected would both create
  // text and enter multiElement mode
  if (app.state.multiElement) {
    return;
  }
  // double click only creates/edits text in selection mode, or with the
  // autoshape tool (double-click-to-type without leaving the tool; all the
  // selection-dependent branches below are inert there since autoshape
  // never selects anything)
  if (
    app.state.activeTool.type !== app.state.preferredSelectionTool.type &&
    app.state.activeTool.type !== "autoshape"
  ) {
    return;
  }

  const selectedElements = app.scene.getSelectedElements(app.state);

  let { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(event, app.state);

  if (selectedElements.length === 1 && isLinearElement(selectedElements[0])) {
    const selectedLinearElement: ExcalidrawLinearElement = selectedElements[0];

    if (
      ((event[KEYS.CTRL_OR_CMD] && isSimpleArrow(selectedLinearElement)) ||
        isLineElement(selectedLinearElement)) &&
      (!app.state.selectedLinearElement?.isEditing ||
        app.state.selectedLinearElement.elementId !== selectedLinearElement.id)
    ) {
      // Use the proper action to ensure immediate history capture
      app.actionManager.executeAction(actionToggleLinearEditor);
      return;
    } else if (
      app.state.selectedLinearElement &&
      isElbowArrow(selectedElements[0])
    ) {
      const hitCoords = LinearElementEditor.getSegmentMidpointHitCoords(
        app.state.selectedLinearElement,
        { x: sceneX, y: sceneY },
        app.state,
        app.scene.getNonDeletedElementsMap(),
      );
      const midPoint = hitCoords
        ? LinearElementEditor.getSegmentMidPointIndex(
            app.state.selectedLinearElement,
            app.state,
            hitCoords,
            app.scene.getNonDeletedElementsMap(),
          )
        : -1;

      if (midPoint && midPoint > -1) {
        app.store.scheduleCapture();
        LinearElementEditor.deleteFixedSegment(
          selectedElements[0],
          app.scene,
          midPoint,
        );

        const nextCoords = LinearElementEditor.getSegmentMidpointHitCoords(
          {
            ...app.state.selectedLinearElement,
            segmentMidPointHoveredCoords: null,
          },
          { x: sceneX, y: sceneY },
          app.state,
          app.scene.getNonDeletedElementsMap(),
        );
        const nextIndex = nextCoords
          ? LinearElementEditor.getSegmentMidPointIndex(
              app.state.selectedLinearElement,
              app.state,
              nextCoords,
              app.scene.getNonDeletedElementsMap(),
            )
          : null;

        app.setState({
          selectedLinearElement: {
            ...app.state.selectedLinearElement,
            initialState: {
              ...app.state.selectedLinearElement.initialState,
              segmentMidpoint: {
                index: nextIndex,
                value: hitCoords,
                added: false,
              },
            },
            segmentMidPointHoveredCoords: nextCoords,
          },
        });

        return;
      }
    } else if (
      app.state.selectedLinearElement?.isEditing &&
      app.state.selectedLinearElement.elementId === selectedLinearElement.id &&
      isLineElement(selectedLinearElement)
    ) {
      return;
    }
  }

  if (selectedElements.length === 1 && isImageElement(selectedElements[0])) {
    app.startImageCropping(selectedElements[0]);
    return;
  }

  app.cursor.reset();

  const selectedGroupIds = getSelectedGroupIds(app.state);

  if (selectedGroupIds.length > 0) {
    const hitElement = app.getElementAtPosition(sceneX, sceneY);

    const selectedGroupId =
      hitElement &&
      getSelectedGroupIdForElement(hitElement, app.state.selectedGroupIds);

    if (selectedGroupId) {
      app.store.scheduleCapture();
      app.setState((prevState) => ({
        ...prevState,
        ...selectGroupsForSelectedElements(
          {
            editingGroupId: selectedGroupId,
            selectedElementIds: { [hitElement!.id]: true },
          },
          app.scene.getNonDeletedElements(),
          prevState,
          app,
        ),
      }));
      return;
    }
  }

  // double-clicking a cell's blank area (or its background text) edits that
  // cell's background text; hits above the table fall through to the generic
  // text handling below
  if (
    handleTableTitleDoubleClick(app, { x: sceneX, y: sceneY }) ||
    app.handleTableCellDoubleClick(sceneX, sceneY)
  ) {
    return;
  }

  app.cursor.reset();
  if (!app.state.viewModeEnabled) {
    const hitElement = app.getElementAtPosition(sceneX, sceneY);

    if (isIframeLikeElement(hitElement)) {
      if (app.isIframeLikeInteractive(hitElement)) {
        app.setState({
          activeEmbeddable: { element: hitElement, state: "active" },
        });
      }
      return;
    }

    // shouldn't edit/create text when inside line editor (often false positive)

    if (!app.state.selectedLinearElement?.isEditing) {
      const container =
        // skip binding to container on dblclick when holding ctrl
        !event[KEYS.CTRL_OR_CMD] &&
        app.getTextBindableContainerAtPosition(sceneX, sceneY);

      if (container) {
        if (
          // with autoshape, any hit inside a bindable shape means "type in
          // app shape" — unlike selection mode, a transparent unfilled
          // container binds even when its stroke wasn't hit (Alt keeps the
          // free-text-at-point escape hatch)
          app.state.activeTool.type === "autoshape" ||
          hasBoundTextElement(container) ||
          !isTransparent(container.backgroundColor) ||
          hitElementItself({
            point: pointFrom(sceneX, sceneY),
            element: container,
            elementsMap: app.scene.getNonDeletedElementsMap(),
            threshold: app.getElementHitThreshold(container),
          })
        ) {
          const midPoint = getContainerCenter(
            container,
            app.scene.getNonDeletedElementsMap(),
          );

          sceneX = midPoint.x;
          sceneY = midPoint.y;
        }
      }

      app.startTextEditing({
        sceneX,
        sceneY,
        insertAtParentCenter: !event.altKey,
        container: container || null,
      });
    }
  }
};

export const handleCanvasClick = (
  app: PointerApp,
  event: React.MouseEvent<HTMLCanvasElement>,
) => {
  if (!app.isInteractionEnabled()) {
    return;
  }
  if (event.button !== POINTER_BUTTON.MAIN) {
    app.lastCompletedCanvasClicks = [];
    return;
  }

  app.lastCompletedCanvasClicks = [
    ...app.lastCompletedCanvasClicks.slice(-1),
    {
      x: event.clientX,
      y: event.clientY,
    },
  ];
};

export const maybeHandleElementLinkClick = (
  app: PointerApp,
  event: React.PointerEvent<HTMLCanvasElement>,
  scenePointer: { x: number; y: number },
): boolean => {
  if (app.editorInterface.isTouchScreen) {
    const hitElement = app.getElementAtPosition(
      scenePointer.x,
      scenePointer.y,
      {
        includeLockedElements: true,
      },
    );
    app.hitLinkElement = app.getElementLinkAtPosition(scenePointer, hitElement);
  }

  if (
    app.hitLinkElement &&
    app.lastPointerDownEvent &&
    !app.state.selectedElementIds[app.hitLinkElement.id]
  ) {
    app.handleElementLinkClick(event);
    return true;
  }
  return false;
};

export const handleInteractiveContentPointerMove = (
  app: PointerApp,
  event: React.PointerEvent<HTMLCanvasElement>,
) => {
  const scenePointer = viewportCoordsToSceneCoords(event, app.state);
  const hitElementMightBeLocked = app.getElementAtPosition(
    scenePointer.x,
    scenePointer.y,
    { includeLockedElements: true },
  );

  if (app.isEmbedsEnabled()) {
    const hitElement = hitElementMightBeLocked?.locked
      ? null
      : hitElementMightBeLocked;
    if (
      app.handleIframeLikeElementHover({
        hitElement,
        scenePointer,
        moveEvent: event,
      })
    ) {
      return;
    }
  }

  app.hitLinkElement = app.isLinksEnabled()
    ? app.getElementLinkAtPosition(scenePointer, hitElementMightBeLocked)
    : undefined;
  if (!app.applyElementLinkHoverAffordance()) {
    app.cursor.reset();
  }
};

export const handleInteractiveContentPointerUp = (
  app: PointerApp,
  event: React.PointerEvent<HTMLCanvasElement>,
) => {
  app.lastPointerUpEvent = event;

  if (app.isEmbedsEnabled() && app.handleIframeLikeCenterClick()) {
    return;
  }

  const scenePointer = viewportCoordsToSceneCoords(event, app.state);
  if (
    app.isLinksEnabled() &&
    app.maybeHandleElementLinkClick(event, scenePointer)
  ) {
    return;
  }

  // clicking outside an active embed deactivates it (view-mode style;
  // clicks inside it are consumed by the embed itself)
  if (app.state.activeEmbeddable?.state === "active") {
    app.setState({ activeEmbeddable: null });
  }
};

export const handleCanvasPointerMove = (
  app: PointerApp,
  event: React.PointerEvent<HTMLCanvasElement>,
) => {
  if (!app.isInteractionEnabled()) {
    if (app.isToolSupported(app.state.activeTool.type)) {
      // keep broadcasting the pointer (`props.onPointerUpdate`) between
      // strokes of the enabled tool, so e.g. a presenter's cursor stays
      // visible to collaborators while the laser isn't drawing
      app.savePointer(event.clientX, event.clientY, app.state.cursorButton);
    }
    if (app.isNavigationEnabled()) {
      // two-finger pinch zoom/pan (single-pointer panning is handled by
      // the pan session set up on pointerdown)
      app.updateMultiTouchGesture(event);
    }
    if (
      (app.isLinksEnabled() || app.isEmbedsEnabled()) &&
      !app.pan.isActive()
    ) {
      app.handleInteractiveContentPointerMove(event);
    }
    return;
  }
  app.savePointer(event.clientX, event.clientY, app.state.cursorButton);
  app.lastPointerMoveEvent = event.nativeEvent;
  const scenePointer = viewportCoordsToSceneCoords(event, app.state);
  const { x: scenePointerX, y: scenePointerY } = scenePointer;
  app.lastPointerMoveCoords = {
    x: scenePointerX,
    y: scenePointerY,
  };

  app.updateMultiTouchGesture(event);

  if (app.interactionState.isTableGestureActive) {
    return;
  }

  app.mindmap.handlePointerMove(scenePointerX, scenePointerY);

  if (
    app.pan.isSpaceHeld() ||
    app.pan.isActive() ||
    app.interactionState.isDraggingScrollBar ||
    isHandToolActive(app.state)
  ) {
    return;
  }

  const isPointerOverScrollBars = isOverScrollBars(
    app.interactionState.currentScrollBars,
    event.clientX - app.state.offsetLeft,
    event.clientY - app.state.offsetTop,
  );
  const isOverScrollBar = isPointerOverScrollBars.isOverEither;
  if (
    !app.state.newElement &&
    !app.state.selectionElement &&
    !app.state.selectedElementsAreBeingDragged &&
    !app.state.multiElement
  ) {
    if (isOverScrollBar) {
      app.cursor.set(CURSOR_TYPE.AUTO);
    } else {
      app.cursor.applyForTool();
    }
  }

  app.maybeUpdateFrameToHighlightOnPointerMove(
    {
      x: scenePointerX,
      y: scenePointerY,
    },
    isOverScrollBar,
  );

  app.maybeUpdateTableCellHighlightOnPointerMove(
    {
      x: scenePointerX,
      y: scenePointerY,
    },
    isOverScrollBar,
  );

  const canDispatchInteraction =
    !event.buttons &&
    !isOverScrollBar &&
    !app.state.viewModeEnabled &&
    !app.state.editingTextElement &&
    !app.state.newElement &&
    !app.state.selectionElement &&
    !app.state.multiElement &&
    !app.state.selectedElementsAreBeingDragged &&
    isSelectionLikeTool(app.state.activeTool.type);

  if (canDispatchInteraction) {
    // Unified interaction target (interaction-target-resolution.md): container
    // providers own their hover state and cursor; every other target keeps
    // the generic flow below.
    const interactionTarget = resolveInteractionTarget(
      app,
      scenePointer,
      event,
    );
    if (
      interactionTarget.kind === "containerControl" ||
      interactionTarget.kind === "containerBody"
    ) {
      dispatchContainerInteraction(app, interactionTarget.candidate);
      return;
    }
    // moving onto a non-container target must not leave container hover behind
    clearContainerInteractionHover(app);
  } else {
    // dispatch ineligible (dragging, creating, gesturing): the legacy
    // structure-hover channel keeps its behavior for those flows
    app.maybeUpdateTableStructureHoverOnPointerMove(
      {
        x: scenePointerX,
        y: scenePointerY,
      },
      isOverScrollBar,
    );
  }

  if (
    !app.state.newElement &&
    isActiveToolNonLinearSnappable(app.state.activeTool.type)
  ) {
    const { originOffset, snapLines } = getSnapLinesAtPointer(
      app.scene.getNonDeletedElements(),
      app,
      {
        x: scenePointerX,
        y: scenePointerY,
      },
      event,
      app.scene.getNonDeletedElementsMap(),
    );

    app.setState((prevState) => {
      const nextSnapLines = updateStable(prevState.snapLines, snapLines);
      const nextOriginOffset = prevState.originSnapOffset
        ? updateStable(prevState.originSnapOffset, originOffset)
        : originOffset;

      if (
        prevState.snapLines === nextSnapLines &&
        prevState.originSnapOffset === nextOriginOffset
      ) {
        return null;
      }
      return {
        snapLines: nextSnapLines,
        originSnapOffset: nextOriginOffset,
      };
    });
  } else if (
    !app.state.newElement &&
    !app.state.selectedElementsAreBeingDragged &&
    !app.state.selectionElement
  ) {
    app.setState((prevState) => {
      if (prevState.snapLines.length) {
        return {
          snapLines: [],
        };
      }
      return null;
    });
  }

  if (
    app.state.selectedLinearElement?.isEditing &&
    !app.state.selectedLinearElement.isDragging
  ) {
    const editingLinearElement = app.state.newElement
      ? null
      : LinearElementEditor.handlePointerMoveInEditMode(
          event,
          scenePointerX,
          scenePointerY,
          app,
        );

    if (
      editingLinearElement &&
      editingLinearElement !== app.state.selectedLinearElement
    ) {
      // Since we are reading from previous state which is not possible with
      // automatic batching in React 18 hence using flush sync to synchronously
      // update the state. Check https://github.com/excalidraw/excalidraw/pull/5508 for more details.
      flushSync(() => {
        app.setState({
          selectedLinearElement: editingLinearElement,
        });
      });
    }
  }

  if (isBindingElementType(app.state.activeTool.type)) {
    // Hovering with a selected tool or creating new linear element via click
    // and point
    const { newElement } = app.state;
    if (!newElement && isBindingEnabled(app.state)) {
      const globalPoint = pointFrom<GlobalPoint>(scenePointerX, scenePointerY);
      const elementsMap = app.scene.getNonDeletedElementsMap();
      const hoveredElement = getHoveredElementForBinding(
        globalPoint,
        app.scene.getNonDeletedElements(),
        elementsMap,
        maxBindingDistance_simple(app.state.zoom),
      );
      if (hoveredElement) {
        app.setState({
          suggestedBinding: {
            element: hoveredElement,
            midPoint: getSnapOutlineMidPoint(
              globalPoint,
              hoveredElement,
              elementsMap,
              app.state.zoom,
            ),
          },
        });
      } else if (app.state.suggestedBinding) {
        app.setState({
          suggestedBinding: null,
        });
      }
    }
  }

  if (app.state.multiElement && app.state.selectedLinearElement) {
    const { multiElement, selectedLinearElement } = app.state;
    const { x: rx, y: ry, points } = multiElement;
    const lastPoint = points[points.length - 1];

    const { lastCommittedPoint } = selectedLinearElement;

    app.cursor.applyForTool();

    if (lastPoint === lastCommittedPoint) {
      if (
        // if we haven't yet created a temp point and we're beyond commit-zone
        // threshold, add a point
        pointDistance(
          pointFrom(scenePointerX - rx, scenePointerY - ry),
          lastPoint,
        ) >= LINE_CONFIRM_THRESHOLD
      ) {
        app.store.scheduleCapture();
        flushSync(() => {
          invariant(
            app.state.selectedLinearElement?.initialState,
            "initialState must be set",
          );
          app.setState({
            selectedLinearElement: {
              ...app.state.selectedLinearElement,
              lastCommittedPoint: points[points.length - 1],
              selectedPointsIndices: [multiElement.points.length],
              initialState: {
                ...app.state.selectedLinearElement.initialState,
                lastClickedPoint: multiElement.points.length,
              },
            },
          });
        });
        app.scene.mutateElement(
          multiElement,
          {
            points: [
              ...points,
              pointFrom<LocalPoint>(scenePointerX - rx, scenePointerY - ry),
            ],
          },
          { informMutation: false, isDragging: false },
        );
      } else {
        app.cursor.set(CURSOR_TYPE.POINTER);
        // in app branch, we're inside the commit zone, and no uncommitted
        // point exists. Thus do nothing (don't add/remove points).
      }
    } else if (
      points.length > 2 &&
      lastCommittedPoint &&
      pointDistance(
        pointFrom(scenePointerX - rx, scenePointerY - ry),
        lastCommittedPoint,
      ) < LINE_CONFIRM_THRESHOLD
    ) {
      app.cursor.set(CURSOR_TYPE.POINTER);
      app.scene.mutateElement(
        multiElement,
        {
          points: points.slice(0, -1),
        },
        { informMutation: false, isDragging: false },
      );
      const newLastIdx = multiElement.points.length - 1;
      app.setState({
        selectedLinearElement: {
          ...selectedLinearElement,
          selectedPointsIndices: selectedLinearElement.selectedPointsIndices
            ? [
                ...new Set(
                  selectedLinearElement.selectedPointsIndices.map((idx) =>
                    Math.min(idx, newLastIdx),
                  ),
                ),
              ]
            : selectedLinearElement.selectedPointsIndices,
          lastCommittedPoint: multiElement.points[newLastIdx],
          initialState: {
            ...selectedLinearElement.initialState,
            lastClickedPoint: newLastIdx,
          },
        },
      });
    } else {
      if (isPathALoop(points, app.state.zoom.value)) {
        app.cursor.set(CURSOR_TYPE.POINTER);
      }

      // Update arrow points
      const elementsMap = app.scene.getNonDeletedElementsMap();

      if (isSimpleArrow(multiElement)) {
        const hoveredElement = getHoveredElementForBinding(
          pointFrom<GlobalPoint>(scenePointerX, scenePointerY),
          app.scene.getNonDeletedElements(),
          elementsMap,
        );

        if (getFeatureFlag("COMPLEX_BINDINGS")) {
          app.handleDelayedBindModeChange(multiElement, hoveredElement);
        }
      }

      invariant(
        app.state.selectedLinearElement,
        "Expected selectedLinearElement to be set to operate on a linear element",
      );

      const newState = LinearElementEditor.handlePointerMove(
        event.nativeEvent,
        app,
        scenePointerX,
        scenePointerY,
        app.state.selectedLinearElement,
      );
      if (newState) {
        app.setState(newState);
      }
    }

    return;
  }

  // Set suggested binding if we're hovering with an arrow tool
  // and not dragging out a new element
  if (app.state.activeTool.type === "arrow" && !app.state.newElement) {
    const scenePointer = pointFrom<GlobalPoint>(scenePointerX, scenePointerY);
    const hit = getHoveredElementForBinding(
      scenePointer,
      app.scene.getNonDeletedElements(),
      app.scene.getNonDeletedElementsMap(),
      maxBindingDistance_simple(app.state.zoom),
    );
    const elementsMap = app.scene.getNonDeletedElementsMap();
    if (hit && !isPointInElement(scenePointer, hit, elementsMap)) {
      app.setState({
        suggestedBinding: {
          element: hit,
          midPoint: getSnapOutlineMidPoint(
            scenePointer,
            hit,
            elementsMap,
            app.state.zoom,
          ),
        },
      });
    }
  }

  const isPressingAnyButton = Boolean(event.buttons);
  const isLaserTool = app.state.activeTool.type === "laser";
  if (
    isPressingAnyButton ||
    // checking against laser so that if you mouseover with a laser tool
    // over a link/embeddable, we change the cursor
    (!isLaserTool &&
      app.state.activeTool.type !== "selection" &&
      app.state.activeTool.type !== "lasso" &&
      app.state.activeTool.type !== "text" &&
      app.state.activeTool.type !== "eraser")
  ) {
    return;
  }

  const elements = app.scene.getNonDeletedElements();

  const selectedElements = app.scene.getSelectedElements(app.state);

  if (app.isHittingTextAutoResizeHandle(selectedElements, scenePointer)) {
    app.cursor.set(CURSOR_TYPE.POINTER);
    return;
  }

  if (
    selectedElements.length === 1 &&
    !isOverScrollBar &&
    !app.state.selectedLinearElement?.isEditing
  ) {
    const selected = selectedElements[0];
    if (
      (app.state.activeTool.type === "selection" ||
        app.state.activeTool.type === "lasso") &&
      selected.type === "composite_shape" &&
      !selected.locked &&
      !app.state.viewModeEnabled &&
      !app.state.editingTextElement &&
      !app.state.croppingElementId &&
      hitCompositeControlPoint(
        selected,
        scenePointerX,
        scenePointerY,
        app.state.zoom.value,
        event.pointerType,
      )
    ) {
      app.cursor.set(CURSOR_TYPE.MOVE);
      return;
    }
    // for linear elements, we'd like to prioritize point dragging over edge resizing
    // therefore, we update and check hovered point index first
    if (app.state.selectedLinearElement) {
      app.handleHoverSelectedLinearElement(
        app.state.selectedLinearElement,
        scenePointerX,
        scenePointerY,
      );
    }

    if (
      (!app.state.selectedLinearElement ||
        app.state.selectedLinearElement.hoverPointIndex === -1) &&
      app.state.openDialog?.name !== "elementLinkSelector" &&
      !(selectedElements.length === 1 && isElbowArrow(selectedElements[0])) &&
      // HACK: Disable transform handles for linear elements on mobile until a
      // better way of showing them is found
      !(
        isLinearElement(selectedElements[0]) &&
        (app.editorInterface.userAgent.isMobileDevice ||
          selectedElements[0].points.length === 2)
      )
    ) {
      const elementWithTransformHandleType = getElementWithTransformHandleType(
        elements,
        app.state,
        scenePointerX,
        scenePointerY,
        app.state.zoom,
        event.pointerType,
        app.scene.getNonDeletedElementsMap(),
        app.editorInterface,
      );
      if (
        elementWithTransformHandleType &&
        elementWithTransformHandleType.transformHandleType
      ) {
        app.cursor.set(
          getCursorForResizingElement(elementWithTransformHandleType),
        );
        return;
      }
    }
  } else if (
    selectedElements.length > 1 &&
    !isOverScrollBar &&
    app.state.openDialog?.name !== "elementLinkSelector"
  ) {
    const transformHandleType = getTransformHandleTypeFromCoords(
      getCommonBounds(
        selectedElements.filter(
          (element) => !app.scene.getMindmapHiddenElementIds().has(element.id),
        ),
      ),
      scenePointerX,
      scenePointerY,
      app.state.zoom,
      event.pointerType,
      app.editorInterface,
    );
    if (
      transformHandleType &&
      !(
        transformHandleType === "rotation" &&
        selectedElements.some(
          (element) =>
            isMindmapNodeElement(element) ||
            isMindmapEdgeElement(element) ||
            isTableElement(element),
        )
      )
    ) {
      app.cursor.set(
        getCursorForResizingElement({
          transformHandleType,
        }),
      );
      return;
    }
  }

  if (isEraserActive(app.state)) {
    return;
  }

  const hitElementMightBeLocked = app.getElementAtPosition(
    scenePointerX,
    scenePointerY,
    {
      preferSelected: true,
      includeLockedElements: true,
    },
  );

  let hitElement: NonDeleted<ExcalidrawElement> | null = null;
  if (hitElementMightBeLocked && hitElementMightBeLocked.locked) {
    hitElement = null;
  } else {
    hitElement = hitElementMightBeLocked;
  }

  const hoveredArrowTextAnchor =
    app.arrowText.updateHoveredAnchor(scenePointer);

  if (
    !app.handleIframeLikeElementHover({
      hitElement,
      scenePointer,
      moveEvent: event,
    })
  ) {
    app.hitLinkElement = app.getElementLinkAtPosition(
      scenePointer,
      hitElementMightBeLocked,
    );
  }

  if (!app.applyElementLinkHoverAffordance()) {
    if (isLaserTool) {
      return;
    }
    if (
      hitElement &&
      (hitElement.link || isEmbeddableElement(hitElement)) &&
      app.state.selectedElementIds[hitElement.id] &&
      !app.state.contextMenu &&
      !app.state.showHyperlinkPopup
    ) {
      app.setState({ showHyperlinkPopup: "info" });
    } else if (app.state.activeTool.type === "text") {
      app.cursor.set(
        hoveredArrowTextAnchor
          ? CURSOR_TYPE.POINTER
          : isTextElement(hitElement)
          ? CURSOR_TYPE.TEXT
          : CURSOR_TYPE.CROSSHAIR,
      );
    } else if (
      hitElement &&
      isMindmapEdgeElement(hitElement) &&
      !app.mindmap.isCompleteMindmapSelection()
    ) {
      app.cursor.set(CURSOR_TYPE.POINTER);
    } else if (
      !event[KEYS.CTRL_OR_CMD] &&
      app.isHittingCommonBoundingBoxOfSelectedElements(
        scenePointer,
        selectedElements,
      )
    ) {
      app.cursor.set(CURSOR_TYPE.MOVE);
    } else if (app.state.viewModeEnabled) {
      app.cursor.set(CURSOR_TYPE.GRAB);
    } else if (app.state.openDialog?.name === "elementLinkSelector") {
      app.cursor.set(CURSOR_TYPE.AUTO);
    } else if (isOverScrollBar) {
      app.cursor.set(CURSOR_TYPE.AUTO);
    } else if (
      // if using cmd/ctrl, we're not dragging
      !event[KEYS.CTRL_OR_CMD] &&
      // editing text -> don't show move cursor when hovering over its bbox
      hitElement?.id !== app.state.editingTextElement?.id
    ) {
      if (
        (hitElement ||
          app.isHittingCommonBoundingBoxOfSelectedElements(
            scenePointer,
            selectedElements,
          )) &&
        !hitElement?.locked
      ) {
        if (
          !hitElement ||
          // Elbow arrows can only be moved when unconnected
          !isElbowArrow(hitElement) ||
          !(hitElement.startBinding || hitElement.endBinding)
        ) {
          if (
            app.state.activeTool.type !== "lasso" ||
            selectedElements.length > 0
          ) {
            app.cursor.set(CURSOR_TYPE.MOVE);
          }
        }
      }
    } else {
      app.cursor.set(CURSOR_TYPE.AUTO);
    }

    if (app.state.selectedLinearElement) {
      app.handleHoverSelectedLinearElement(
        app.state.selectedLinearElement,
        scenePointerX,
        scenePointerY,
      );
    }
  }

  if (app.state.openDialog?.name === "elementLinkSelector" && hitElement) {
    app.setState((prevState) => {
      return {
        hoveredElementIds: updateStable(
          prevState.hoveredElementIds,
          selectGroupsForSelectedElements(
            {
              editingGroupId: prevState.editingGroupId,
              selectedElementIds: { [hitElement!.id]: true },
            },
            app.scene.getNonDeletedElements(),
            prevState,
            app,
          ).selectedElementIds,
        ),
      };
    });
  } else if (
    app.state.openDialog?.name === "elementLinkSelector" &&
    !hitElement
  ) {
    app.setState((prevState) => ({
      hoveredElementIds: updateStable(prevState.hoveredElementIds, {}),
    }));
  }
};

export const isDoubleClick = (
  app: PointerApp,
  lastPointerEvent:
    | PointerEvent
    | React.PointerEvent<HTMLElement>
    | undefined
    | null,
  currentPointerEvent: PointerEvent | React.PointerEvent<HTMLElement>,
) => {
  return (
    lastPointerEvent != null &&
    currentPointerEvent.timeStamp - lastPointerEvent.timeStamp <=
      TAP_TWICE_TIMEOUT
  );
};

export const getTopLayerFrameAtSceneCoords = (
  app: PointerApp,
  sceneCoords: {
    x: number;
    y: number;
  },
  opts?: {
    /** to exclude selected elements when dragging, etc. */
    excludeElementIds?: AppState["selectedElementIds"];
    currentFrameId?: string | null;
  },
) => {
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const framesUnderCursor = app.scene
    .getNonDeletedFramesLikes()
    .filter(
      (frame) =>
        !frame.locked && isCursorInFrame(sceneCoords, frame, elementsMap),
    );

  if (!framesUnderCursor.length) {
    return null;
  }

  const topLayerFrame = framesUnderCursor.at(-1)!;

  const hitElement = app
    .getElementsAtPosition(sceneCoords.x, sceneCoords.y, {
      includeLockedElements: true,
    })
    .findLast((element) => !opts?.excludeElementIds?.[element.id]);

  if (hitElement) {
    if (
      isFrameLikeElement(hitElement) &&
      // case: we're hitting a locked frame itself (frame's outline
      // or later its bg once implemented)
      !hitElement.locked
    ) {
      return topLayerFrame;
    }

    const hitElementIndex = app.scene.getElementIndex(hitElement.id);
    const topLayerFrameIndex = app.scene.getElementIndex(topLayerFrame.id);

    if (
      hitElementIndex !== -1 &&
      topLayerFrameIndex !== -1 &&
      hitElementIndex <= topLayerFrameIndex
    ) {
      return topLayerFrame;
    }

    // to support a case of dragging a pre-existing frame child underneath
    // a non-frame element covering the cursor
    const currentFrame = opts?.currentFrameId
      ? framesUnderCursor.find((frame) => frame.id === opts.currentFrameId) ??
        null
      : null;

    if (currentFrame) {
      return currentFrame;
    }

    return hitElement.containerRef?.elementId
      ? framesUnderCursor.find(
          (frame) => frame.id === hitElement.containerRef?.elementId,
        ) ?? null
      : null;
  }

  return topLayerFrame;
};

export const handleHoverSelectedLinearElement = (
  app: PointerApp,
  linearElementEditor: LinearElementEditor,
  scenePointerX: number,
  scenePointerY: number,
) => {
  const elementsMap = app.scene.getNonDeletedElementsMap();

  const element = LinearElementEditor.getElement(
    linearElementEditor.elementId,
    elementsMap,
  );

  if (!element) {
    return;
  }
  if (app.state.selectedLinearElement) {
    // the same hit tests, in the same precedence, as
    // `LinearElementEditor.handlePointerDown`, so the cursor never promises
    // an interaction (e.g. grabbing the label) that pointer down won't
    // deliver. Both handle radii exceed the element's own hit threshold,
    // so these must not be gated on hitting the element itself.
    const hoverPointIndex = LinearElementEditor.getPointIndexUnderCursor(
      element,
      elementsMap,
      app.state.zoom,
      scenePointerX,
      scenePointerY,
    );
    const isHoveringAPointHandle = LinearElementEditor.isPointHandle(
      element,
      hoverPointIndex,
    );
    const segmentMidPointHoveredCoords = isHoveringAPointHandle
      ? null
      : LinearElementEditor.getSegmentMidpointHitCoords(
          linearElementEditor,
          { x: scenePointerX, y: scenePointerY },
          app.state,
          elementsMap,
        );

    if (isHoveringAPointHandle || segmentMidPointHoveredCoords) {
      app.cursor.set(CURSOR_TYPE.POINTER);
    } else if (
      // an arrow's bound text is draggable along the arrow. The handles
      // and the midpoint knob sitting under the label keep precedence so a
      // labeled arrow can still be bent at its middle, while the label
      // itself is grabbable even where it extends beyond the arrow's own
      // hit area.
      app.arrowText.isBoundTextGrabbable(element, scenePointerX, scenePointerY)
    ) {
      app.cursor.set(CURSOR_TYPE.GRAB);
    } else if (
      app.hitElement(scenePointerX, scenePointerY, element) &&
      // Elbow arrows can only be moved when unconnected
      (!isElbowArrow(element) ||
        !(element.startBinding || element.endBinding)) &&
      (app.state.activeTool.type !== "lasso" ||
        Object.keys(app.state.selectedElementIds).length > 0)
    ) {
      app.cursor.set(CURSOR_TYPE.MOVE);
    }

    if (app.state.selectedLinearElement.hoverPointIndex !== hoverPointIndex) {
      app.setState({
        selectedLinearElement: {
          ...app.state.selectedLinearElement,
          hoverPointIndex,
        },
      });
    }

    if (
      !LinearElementEditor.arePointsEqual(
        app.state.selectedLinearElement.segmentMidPointHoveredCoords,
        segmentMidPointHoveredCoords,
      )
    ) {
      app.setState({
        selectedLinearElement: {
          ...app.state.selectedLinearElement,
          segmentMidPointHoveredCoords,
        },
      });
    }

    // Check for focus point hover
    let hoveredFocusPointBinding: "start" | "end" | null = null;
    const arrow = element as any;
    if (arrow.startBinding || arrow.endBinding) {
      hoveredFocusPointBinding = handleFocusPointHover(
        element as ExcalidrawArrowElement,
        scenePointerX,
        scenePointerY,
        app.scene,
        app.state,
      );
    }

    if (
      app.state.selectedLinearElement.hoveredFocusPointBinding !==
      hoveredFocusPointBinding
    ) {
      app.setState({
        selectedLinearElement: {
          ...app.state.selectedLinearElement,
          isDragging: false,
          hoveredFocusPointBinding,
        },
      });
    }

    // Set cursor to pointer when hovering over a focus point
    if (hoveredFocusPointBinding) {
      app.cursor.set(CURSOR_TYPE.POINTER);
    }
  } else {
    app.cursor.set(CURSOR_TYPE.AUTO);
  }
};
