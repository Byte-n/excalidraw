import { flushSync } from "react-dom";
import {
  clamp,
  pointFrom,
  pointDistance,
  vector,
  pointRotateRads,
  vectorFromPoint,
  vectorSubtract,
  vectorDot,
  vectorNormalize,
} from "@excalidraw/math";
import {
  shouldMaintainAspectRatio,
  KEYS,
  CURSOR_TYPE,
  DRAGGING_THRESHOLD,
  POINTER_BUTTON,
  TOUCH_CTX_MENU_TIMEOUT,
  TOOL_TYPE,
  DEFAULT_STICKY_NOTE_SIZE,
  getGridPoint,
  getFontString,
  tupleToCoors,
  viewportCoordsToSceneCoords,
  updateObject,
  updateActiveTool,
  updateStable,
  addEventListener,
  isShallowEqual,
  MINIMUM_ARROW_SIZE,
  invariant,
  getFeatureFlag,
} from "@excalidraw/common";
import {
  getCommonBounds,
  getElementAbsoluteCoords,
  bindOrUnbindBindingElements,
  getHoveredElementForBinding,
  LinearElementEditor,
  deepCopyElement,
  isArrowElement,
  isBindingElement,
  isFrameLikeElement,
  isImageElement,
  isEmbeddableElement,
  isInitializedImageElement,
  isLinearElement,
  isMindmapNodeElement,
  isCompositeShapeElement,
  isElbowArrow,
  isBindableElement,
  isTextElement,
  isStickyNoteElement,
  getNormalizedDimensions,
  isInvisiblySmallElement,
  getStickyNoteMinSize,
  getCommonFrameId,
  getFrameChildren,
  addElementsToFrame,
  replaceAllElementsInFrame,
  removeElementsFromFrame,
  getElementsInResizingFrame,
  getElementsInNewFrame,
  getContainingFrame,
  elementOverlapsWithFrame,
  updateFrameMembershipOfSelectedElements,
  isElementInFrame,
  hitElementBoundingBoxOnly,
  getMinTextElementWidth,
  getElementsInGroup,
  isSelectedViaGroup,
  selectGroupsForSelectedElements,
  makeNextSelectedElementIds,
  dragSelectedElements,
  getDragOffsetXY,
  CaptureUpdateAction,
  handleFocusPointDrag,
  handleFocusPointPointerUp,
  getUncroppedWidthAndHeight,
  getBoundTextElement,
  getCompositeShapeControlPoints,
  redrawTextBoundingBox,
  updateBoundElements,
  updateCompositeShapeControlPoint,
} from "@excalidraw/element";

import { EVENT } from "@excalidraw/common";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawElbowArrowElement,
} from "@excalidraw/element/types";

import { actionFinalize, actionToggleLinearEditor } from "../../actions";
import { isEraserActive } from "../../appState";
import {
  getElementsWithinSelection,
  getSelectedElements,
  isSomeElementSelected,
} from "../../scene";
import { editorJotaiStore } from "../../editor-jotai";
import { snapDraggedElements, SnapCache } from "../../snapping";
import { isOverScrollBars } from "../../scene/scrollbars";
import { convertElementTypePopupAtom } from ".././ConvertElementTypePopup";
import { searchItemInFocusAtom } from ".././SearchMenu";

import {
  withBatchedUpdates,
  withBatchedUpdatesThrottled,
} from "../../reactUtils";

import * as gestureController from "./gesture";

import { getCompositeControlPointLocal } from "./compositeShapeControls";

import type { UnsubscribeCallback } from "../../types";

import type App from "../App";

import type React from "react";

import type { ScrollBars } from "../../scene/types";
import type { AppState, PointerDownState } from "../../types";

type PointerApp = Pick<App, keyof App> & Record<string, any>;

/** Mutable state for one mounted editor's pointer and transient input session. */
export type InteractionState = {
  didTapTwice: boolean;
  tappedTwiceTimer: ReturnType<Window["setTimeout"]> | 0;
  firstTapPosition: { x: number; y: number } | null;
  isDraggingScrollBar: boolean;
  currentScrollBars: ScrollBars;
  touchTimeout: ReturnType<Window["setTimeout"]> | 0;
  invalidateContextMenu: boolean;
  isPlainPaste: boolean;
  plainPasteTimer: ReturnType<Window["setTimeout"]> | 0;
  plainPasteToastShown: boolean;
  lastPointerUp: (() => void) | null;
  eraserButtonCleanup: (() => void) | null;
};

export const createInteractionState = (): InteractionState => ({
  didTapTwice: false,
  tappedTwiceTimer: 0,
  firstTapPosition: null,
  isDraggingScrollBar: false,
  currentScrollBars: { horizontal: null, vertical: null },
  touchTimeout: 0,
  invalidateContextMenu: false,
  isPlainPaste: false,
  plainPasteTimer: 0,
  plainPasteToastShown: false,
  lastPointerUp: null,
  eraserButtonCleanup: null,
});

export const resetTapTwice = gestureController.resetTapTwice;

export const resetInteractionState = (app: {
  interactionState: InteractionState;
  ownerWindow: Window & typeof globalThis;
}) => {
  const state = app.interactionState;
  state.isDraggingScrollBar = false;
  state.lastPointerUp = null;
  state.eraserButtonCleanup = null;
  if (state.tappedTwiceTimer) {
    app.ownerWindow.clearTimeout(state.tappedTwiceTimer);
  }
  state.tappedTwiceTimer = 0;
  resetTapTwice(state);
  if (state.plainPasteTimer) {
    app.ownerWindow.clearTimeout(state.plainPasteTimer);
  }
  state.plainPasteTimer = 0;
  state.isPlainPaste = false;
  if (state.touchTimeout) {
    app.ownerWindow.clearTimeout(state.touchTimeout);
  }
  state.touchTimeout = 0;
  state.invalidateContextMenu = false;
};

/**
 * Owns window listeners used while a scrollbar is being dragged. Keeping the
 * teardown callback on the instance prevents one editor from cleaning up
 * another editor's pointer session.
 */
export const handleDraggingScrollBar = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
  pointerDownState: PointerDownState,
): boolean => {
  if (!(pointerDownState.scrollbars.isOverEither && !app.state.multiElement)) {
    return false;
  }
  const interactionState = app.interactionState as InteractionState;
  interactionState.isDraggingScrollBar = true;
  pointerDownState.lastCoords.x = event.clientX;
  pointerDownState.lastCoords.y = event.clientY;
  const onPointerMove = withBatchedUpdatesThrottled(
    (moveEvent: PointerEvent) => {
      const target = moveEvent.target;
      if (!(target instanceof app.ownerWindow.HTMLElement)) {
        return;
      }
      app.handlePointerMoveOverScrollbars(moveEvent, pointerDownState);
    },
  );
  const onPointerUp = withBatchedUpdates(() => {
    interactionState.lastPointerUp = null;
    interactionState.isDraggingScrollBar = false;
    app.cursor.applyForTool();
    app.setState({ cursorButton: "up" });
    app.savePointer(event.clientX, event.clientY, "up");
    app.ownerWindow.removeEventListener(EVENT.POINTER_MOVE, onPointerMove);
    app.ownerWindow.removeEventListener(EVENT.POINTER_UP, onPointerUp);
    app.ownerWindow.removeEventListener(EVENT.POINTER_CANCEL, onPointerUp);
    onPointerMove.flush();
  });

  interactionState.lastPointerUp = onPointerUp;
  app.ownerWindow.addEventListener(EVENT.POINTER_MOVE, onPointerMove);
  app.ownerWindow.addEventListener(EVENT.POINTER_UP, onPointerUp);
  app.ownerWindow.addEventListener(EVENT.POINTER_CANCEL, onPointerUp);
  return true;
};

export const cleanupAfterMissingPointerUp = (
  app: {
    pan: { end: () => void };
    interactionState: InteractionState;
    missingPointerEventCleanupEmitter: {
      trigger: (event: PointerEvent | null) => { clear: () => void };
    };
  },
  event: PointerEvent | null,
) => {
  app.pan.end();
  app.interactionState.lastPointerUp?.();
  app.interactionState.eraserButtonCleanup?.();
  app.missingPointerEventCleanupEmitter.trigger(event).clear();
};

export const resetContextMenuTimer = (app: {
  interactionState: InteractionState;
  ownerWindow: Window & typeof globalThis;
}) => {
  if (app.interactionState.touchTimeout) {
    app.ownerWindow.clearTimeout(app.interactionState.touchTimeout);
  }
  app.interactionState.touchTimeout = 0;
  app.interactionState.invalidateContextMenu = false;
};

/** Installs the window-level listeners for one pointer-down session and keeps
 * their callbacks on that session's state for deterministic teardown. */
export const attachPointerSessionListeners = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
  pointerDownState: PointerDownState,
) => {
  const onPointerMove =
    app.onPointerMoveFromPointerDownHandler(pointerDownState);
  const onPointerUp = app.onPointerUpFromPointerDownHandler(pointerDownState);
  const onKeyDown = app.onKeyDownFromPointerDownHandler(pointerDownState);
  const onKeyUp = app.onKeyUpFromPointerDownHandler(pointerDownState);

  app.missingPointerEventCleanupEmitter.once(
    (cleanupEvent: PointerEvent | null) =>
      onPointerUp(cleanupEvent || event.nativeEvent),
  );

  if (!app.state.viewModeEnabled || app.isActiveToolPointerCapturing()) {
    app.ownerWindow.addEventListener(EVENT.POINTER_MOVE, onPointerMove);
    app.ownerWindow.addEventListener(EVENT.POINTER_UP, onPointerUp);
    app.ownerWindow.addEventListener(EVENT.POINTER_CANCEL, onPointerUp);
    app.ownerWindow.addEventListener(EVENT.KEYDOWN, onKeyDown);
    app.ownerWindow.addEventListener(EVENT.KEYUP, onKeyUp);
    pointerDownState.eventListeners.onMove = onPointerMove;
    pointerDownState.eventListeners.onUp = onPointerUp;
    pointerDownState.eventListeners.onKeyUp = onKeyUp;
    pointerDownState.eventListeners.onKeyDown = onKeyDown;
  }
};

export type PointerSessionApp = {
  state: AppState;
};

export const handleCanvasPointerDown = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
) => {
  if (
    !app.isInteractionEnabled() &&
    !app.isToolSupported(app.state.activeTool.type)
  ) {
    if (app.isLinksEnabled() || app.isEmbedsEnabled()) {
      // needed by handleElementLinkClick & handleIframeLikeCenterClick
      // (drag-distance & hit checks)
      app.lastPointerDownEvent = event;
    }
    if (app.isNavigationEnabled()) {
      app.updateGestureOnPointerDown(event);
      if (!app.pan.isActive()) {
        // pans on drag same as view mode (the pan session manages its own
        // window listeners & teardown)
        app.pan.start(event);
      }
    }
    return;
  }
  // with the active tool allowed via `interaction.enabled.tools`, the
  // pointer keeps driving it through the full flow below — safe while
  // non-interactive because that implies view mode, whose gates constrain
  // everything except the tool-usage path (laser & custom tools)

  const selectedElements = app.scene.getSelectedElements(app.state);
  const selectedElementIdsBeforePointerDown = app.state.selectedElementIds;

  // If Ctrl is not held, ensure isBindingEnabled reflects the user preference.
  if (!event.ctrlKey) {
    const preferenceEnabled = app.state.bindingPreference === "enabled";
    if (app.state.isBindingEnabled !== preferenceEnabled) {
      app.setState({ isBindingEnabled: preferenceEnabled });
    }
  }

  const scenePointer = viewportCoordsToSceneCoords(event, app.state);
  const { x: scenePointerX, y: scenePointerY } = scenePointer;
  app.lastPointerMoveCoords = {
    x: scenePointerX,
    y: scenePointerY,
  };

  const target = event.target as HTMLElement;
  // capture subsequent pointer events to the canvas
  // app makes other elements non-interactive until pointer up
  if (target.setPointerCapture) {
    target.setPointerCapture(event.pointerId);
  }

  app.maybeCleanupAfterMissingPointerUp(event.nativeEvent);
  // laser pointer is a presentation aid, not an edit — using it while
  // following someone shouldn't break follow
  if (app.state.activeTool.type !== "laser") {
    app.requestUnfollow();
  }

  if (app.state.searchMatches) {
    app.setState((state) => {
      return {
        searchMatches: state.searchMatches && {
          focusedId: null,
          matches: state.searchMatches.matches.map((searchMatch) => ({
            ...searchMatch,
            focus: false,
          })),
        },
      };
    });
    app.updateEditorAtom(searchItemInFocusAtom, null);
  }

  if (editorJotaiStore.get(convertElementTypePopupAtom)) {
    app.updateEditorAtom(convertElementTypePopupAtom, null);
  }

  // since contextMenu options are potentially evaluated on each render,
  // and an contextMenu action may depend on selection state, we must
  // close the contextMenu before we update the selection on pointerDown
  // (e.g. resetting selection)
  if (app.state.contextMenu) {
    app.setState({ contextMenu: null });
  }

  if (app.state.snapLines) {
    app.setAppState({ snapLines: [] });
  }

  if (app.state.openPopup) {
    app.setState({ openPopup: null });
  }

  app.updateGestureOnPointerDown(event);

  // if dragging element is freedraw and another pointerdown event occurs
  // a second finger is on the screen
  // discard the freedraw element if it is very short because it is likely
  // just a spike, otherwise finalize the freedraw element when the second
  // finger is lifted
  if (
    event.pointerType === "touch" &&
    app.state.newElement &&
    app.state.newElement.type === "freedraw"
  ) {
    const element = app.state.newElement as ExcalidrawFreeDrawElement;
    app.updateScene({
      ...(element.points.length < 10
        ? {
            elements: app.scene
              .getElementsIncludingDeleted()
              .filter((el) => el.id !== element.id),
          }
        : {}),
      appState: {
        newElement: null,
        editingTextElement: null,
        suggestedBinding: null,
        selectedElementIds: makeNextSelectedElementIds(
          Object.keys(app.state.selectedElementIds)
            .filter((key) => key !== element.id)
            .reduce((obj: { [id: string]: true }, key) => {
              obj[key] = app.state.selectedElementIds[key];
              return obj;
            }, {}),
          app.state,
        ),
      },
      captureUpdate:
        app.state.openDialog?.name === "elementLinkSelector"
          ? CaptureUpdateAction.EVENTUALLY
          : CaptureUpdateAction.NEVER,
    });
    return;
  }

  // remove any active selection when we start to interact with canvas
  // (mainly, we care about removing selection outside the component which
  //  would prevent our copy handling otherwise)
  const selection = app.ownerDocument.getSelection();
  if (selection?.anchorNode) {
    selection.removeAllRanges();
  }
  app.maybeOpenContextMenuAfterPointerDownOnTouchDevices(
    event,
    selectedElementIdsBeforePointerDown,
  );

  //fires only once, if pen is detected, penMode is enabled
  //the user can disable app by toggling the penMode button
  if (!app.state.penDetected && event.pointerType === "pen") {
    app.setState((prevState) => {
      return {
        penMode: true,
        penDetected: true,
        currentItemStrokeVariability: "variable",
      };
    });
  }

  if (
    !app.editorInterface.isTouchScreen &&
    ["pen", "touch"].includes(event.pointerType)
  ) {
    app.editorInterface = updateObject(app.editorInterface, {
      isTouchScreen: true,
    });
  }

  if (app.pan.isActive()) {
    return;
  }

  app.lastPointerDownEvent = event;

  // we must exit before we set `cursorButton` state and `savePointer`
  // else it will send pointer state & laser pointer events in collab when
  // panning
  if (app.pan.start(event)) {
    return;
  }

  app.setState({
    lastPointerDownWith: event.pointerType,
    cursorButton: "down",
  });
  app.savePointer(event.clientX, event.clientY, "down");

  if (
    event.button === POINTER_BUTTON.ERASER &&
    // must not switch tools while non-interactive (reachable when the
    // active tool is allowed via `interaction.enabled.tools`) or while
    // the active tool is host-controlled
    app.isInteractionEnabled() &&
    !app.props.activeTool &&
    app.state.activeTool.type !== TOOL_TYPE.eraser
  ) {
    app.setState(
      {
        activeTool: updateActiveTool(app.state, {
          type: TOOL_TYPE.eraser,
          lastActiveTool: app.state.activeTool,
        }),
      },
      () => {
        app.handleCanvasPointerDown(event);
        let completed = false;
        const onPointerUp = () => {
          if (completed) {
            return;
          }
          completed = true;
          app.interactionState.eraserButtonCleanup = null;
          unsubPointerUp();
          unsubPointerCancel();
          unsubCleanup?.();
          if (isEraserActive(app.state)) {
            app.setState({
              activeTool: updateActiveTool(app.state, {
                ...(app.state.activeTool.lastActiveTool || {
                  type: TOOL_TYPE.selection,
                }),
                lastActiveTool: null,
              }),
            });
          }
        };

        const unsubPointerUp = addEventListener(
          app.ownerWindow,
          EVENT.POINTER_UP,
          onPointerUp,
          {
            once: true,
          },
        );
        const unsubPointerCancel = addEventListener(
          app.ownerWindow,
          EVENT.POINTER_CANCEL,
          onPointerUp,
          { once: true },
        );
        app.interactionState.eraserButtonCleanup = onPointerUp;
        let unsubCleanup: UnsubscribeCallback | undefined;
        // subscribe inside rAF lest it'd be triggered on the same pointerdown
        // if we start erasing while coming from blurred document since
        // we cleanup pointer events on focus
        app.ownerWindow.requestAnimationFrame(() => {
          if (!completed) {
            unsubCleanup =
              app.missingPointerEventCleanupEmitter.once(onPointerUp);
          }
        });
      },
    );
    return;
  }

  // only handle left mouse button or touch
  if (
    event.button !== POINTER_BUTTON.MAIN &&
    event.button !== POINTER_BUTTON.TOUCH &&
    event.button !== POINTER_BUTTON.ERASER
  ) {
    return;
  }

  // don't select while panning
  if (app.gesture.pointers.size > 1) {
    return;
  }

  // State for the duration of a pointer interaction, which starts with a
  // pointerDown event, ends with a pointerUp event (or another pointerDown)
  const pointerDownState = app.initialPointerDownState(event);

  app.setState({
    selectedElementsAreBeingDragged: false,
  });

  if (
    app.handleTextAutoResizeHandlePointerDown(
      selectedElements,
      pointerDownState.origin,
    )
  ) {
    return;
  }

  if (app.handleDraggingScrollBar(event, pointerDownState)) {
    return;
  }

  app.clearSelectionIfNotUsingSelection();

  if (app.handleSelectionOnPointerDown(event, pointerDownState)) {
    return;
  }

  app.mindmap.preparePointerDown(pointerDownState, {
    shiftKey: event.shiftKey,
    pointerType: event.pointerType,
    selectedElementIdsBeforePointerDown,
  });

  const allowOnPointerDown =
    !app.state.penMode ||
    event.pointerType !== "touch" ||
    app.state.activeTool.type === "selection" ||
    app.state.activeTool.type === "lasso" ||
    app.state.activeTool.type === "text" ||
    app.state.activeTool.type === "image";

  if (!allowOnPointerDown) {
    return;
  }

  if (app.state.activeTool.type === "lasso") {
    const hitSelectedElement =
      pointerDownState.hit.element &&
      app.isASelectedElement(pointerDownState.hit.element);
    const shouldForceLassoReselect =
      event.altKey &&
      event[KEYS.CTRL_OR_CMD] &&
      !pointerDownState.resize.handleType;
    const shouldStartLassoSelection =
      shouldForceLassoReselect ||
      (!pointerDownState.hit.hasHitCommonBoundingBoxOfSelectedElements &&
        !pointerDownState.resize.handleType &&
        !hitSelectedElement);

    if (shouldStartLassoSelection) {
      if (!app.lassoTrail.hasCurrentTrail) {
        app.lassoTrail.startPath(
          pointerDownState.origin.x,
          pointerDownState.origin.y,
          event.shiftKey,
        );
      }

      // block dragging after lasso selection on PCs until the next pointer down
      // (on mobile or tablet, we want to allow user to drag immediately)
      pointerDownState.drag.blockDragging =
        app.editorInterface.formFactor === "desktop";
    }

    // only for mobile or tablet, if we hit an element, select it immediately like normal selection
    if (
      app.editorInterface.formFactor !== "desktop" &&
      pointerDownState.hit.element &&
      !hitSelectedElement
    ) {
      app.setState((prevState) => {
        const nextSelectedElementIds: { [id: string]: true } = {
          ...prevState.selectedElementIds,
          [pointerDownState.hit.element!.id]: true,
        };

        const previouslySelectedElements: ExcalidrawElement[] = [];

        Object.keys(prevState.selectedElementIds).forEach((id) => {
          const element = app.scene.getElement(id);
          element && previouslySelectedElements.push(element);
        });

        const hitElement: ExcalidrawElement = pointerDownState.hit.element!;

        // if hitElement is frame-like, deselect all of its elements
        // if they are selected
        if (isFrameLikeElement(hitElement)) {
          getFrameChildren(previouslySelectedElements, hitElement.id).forEach(
            (element) => {
              delete nextSelectedElementIds[element.id];
            },
          );
        } else if (hitElement.containerRef?.elementId) {
          // if hitElement is in a frame and its frame has been selected
          // disable selection for the given element
          if (nextSelectedElementIds[hitElement.containerRef?.elementId]) {
            delete nextSelectedElementIds[hitElement.id];
          }
        } else {
          // hitElement is neither a frame nor an element in a frame
          // but since hitElement could be in a group with some frames
          // app means selecting hitElement will have the frames selected as well
          // because we want to keep the invariant:
          // - frames and their elements are not selected at the same time
          // we deselect elements in those frames that were previously selected

          const groupIds = hitElement.groupIds;
          const framesInGroups = new Set(
            groupIds
              .flatMap((gid) =>
                getElementsInGroup(app.scene.getNonDeletedElements(), gid),
              )
              .filter((element) => isFrameLikeElement(element))
              .map((frame) => frame.id),
          );

          if (framesInGroups.size > 0) {
            previouslySelectedElements.forEach((element) => {
              if (
                element.containerRef?.elementId &&
                framesInGroups.has(element.containerRef?.elementId)
              ) {
                // deselect element and groups containing the element
                delete nextSelectedElementIds[element.id];
                element.groupIds
                  .flatMap((gid) =>
                    getElementsInGroup(app.scene.getNonDeletedElements(), gid),
                  )
                  .forEach((element) => {
                    delete nextSelectedElementIds[element.id];
                  });
              }
            });
          }
        }

        return {
          ...selectGroupsForSelectedElements(
            {
              editingGroupId: prevState.editingGroupId,
              selectedElementIds: nextSelectedElementIds,
            },
            app.scene.getNonDeletedElements(),
            prevState,
            app,
          ),
          showHyperlinkPopup:
            hitElement.link || isEmbeddableElement(hitElement) ? "info" : false,
        };
      });
      pointerDownState.hit.wasAddedToSelection = true;
    }
  } else if (app.state.activeTool.type === "text") {
    app.handleTextOnPointerDown(event, pointerDownState);
  } else if (
    app.state.activeTool.type === "arrow" ||
    app.state.activeTool.type === "line"
  ) {
    app.handleLinearElementOnPointerDown(
      event,
      app.state.activeTool.type,
      pointerDownState,
    );
  } else if (app.state.activeTool.type === "freedraw") {
    app.handleFreeDrawElementOnPointerDown(
      event,
      app.state.activeTool.type,
      pointerDownState,
    );
  } else if (app.state.activeTool.type === "custom") {
    app.cursor.applyForTool();
  } else if (
    app.state.activeTool.type === TOOL_TYPE.frame ||
    app.state.activeTool.type === TOOL_TYPE.magicframe
  ) {
    app.createFrameElementOnPointerDown(
      pointerDownState,
      app.state.activeTool.type,
    );
  } else if (app.state.activeTool.type === "laser") {
    app.laserTrails.startPath(
      pointerDownState.lastCoords.x,
      pointerDownState.lastCoords.y,
    );
  } else if (app.state.activeTool.type === "autoshape") {
    app.drawShape.handlePointerDown(pointerDownState);
  } else if (app.state.activeTool.type === TOOL_TYPE.bucketfill) {
    // one-shot click tool: pointer down only ARMS the fill — it commits in
    // the shared pointer-up teardown, and only when the interaction stayed
    // a single-pointer click (a second finger, a context menu, or a
    // pointercancel aborts it). Dispatched like any other tool (laser has
    // the same shape) so the shared pointer lifecycle below — public
    // onPointerDown/onPointerUp callbacks, pointer-up teardown,
    // missing-pointer-up cleanup — runs for bucket clicks too. In view
    // mode app branch is unreachable:
    // `pan.start` swallows the pointer-down.
    app.bucketFill.handlePointerDown(scenePointer);
  } else if (app.state.activeTool.type === TOOL_TYPE.mindmap) {
    app.mindmap.handlePointerDown(pointerDownState);
  } else if (
    app.state.activeTool.type !== "eraser" &&
    app.state.activeTool.type !== "hand" &&
    app.state.activeTool.type !== "image"
  ) {
    app.createGenericElementOnPointerDown(
      app.state.activeTool.type,
      pointerDownState,
    );
  }

  app.props?.onPointerDown?.(app.state.activeTool, pointerDownState);
  app.onPointerDownEmitter.trigger(
    app.state.activeTool,
    pointerDownState,
    event,
  );

  if (app.state.activeTool.type === "eraser") {
    app.eraserTrail.startPath(
      pointerDownState.lastCoords.x,
      pointerDownState.lastCoords.y,
    );
  }

  attachPointerSessionListeners(app, event, pointerDownState);
};

export const maybeOpenContextMenuAfterPointerDownOnTouchDevices = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
  selectedElementIdsBeforePointerDown: AppState["selectedElementIds"],
): void => {
  // deal with opening context menu on touch devices
  if (event.pointerType === "touch") {
    app.interactionState.invalidateContextMenu = false;

    if (app.interactionState.touchTimeout) {
      // If there's already a touchTimeout, app means that there's another
      // touch down and we are doing another touch, so we shouldn't open the
      // context menu.
      app.interactionState.invalidateContextMenu = true;
    } else {
      const scenePoint = viewportCoordsToSceneCoords(event, app.state);
      const hit = app.getElementAtPosition(scenePoint.x, scenePoint.y, {
        includeBoundTextElement: true,
      });
      const node =
        hit?.type === "text" && hit.containerId
          ? app.scene.getNonDeletedElement(hit.containerId)
          : hit;
      const canOpenMindmapMenu =
        app.editorInterface.formFactor === "desktop" ||
        !isMindmapNodeElement(node) ||
        (app.state.activeTool.type === "selection" &&
          !!selectedElementIdsBeforePointerDown[node.id]);
      app.touchMindmapContextMenuAllowed = isMindmapNodeElement(node)
        ? canOpenMindmapMenu
        : null;
      // open the context menu with the first touch's clientX and clientY
      // if the touch is not moving
      app.interactionState.touchTimeout = app.ownerWindow.setTimeout(() => {
        app.interactionState.touchTimeout = 0;
        if (!app.interactionState.invalidateContextMenu && canOpenMindmapMenu) {
          app.handleCanvasContextMenu(event);
        }
      }, TOUCH_CTX_MENU_TIMEOUT);
    }
  }
};

export const initialPointerDownState = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement>,
): PointerDownState => {
  const origin = viewportCoordsToSceneCoords(event, app.state);
  const selectedElements = app.scene.getSelectedElements(app.state);
  const [minX, minY, maxX, maxY] = getCommonBounds(selectedElements);
  const isElbowArrowOnly = selectedElements.findIndex(isElbowArrow) === 0;

  return {
    origin,
    withCmdOrCtrl: event[KEYS.CTRL_OR_CMD],
    originInGrid: tupleToCoors(
      getGridPoint(
        origin.x,
        origin.y,
        event[KEYS.CTRL_OR_CMD] || isElbowArrowOnly
          ? null
          : app.getEffectiveGridSize(),
      ),
    ),
    scrollbars: isOverScrollBars(
      app.interactionState.currentScrollBars,
      event.clientX - app.state.offsetLeft,
      event.clientY - app.state.offsetTop,
    ),
    // we need to duplicate because we'll be updating app state
    lastCoords: { ...origin },
    originalElements: app.scene
      .getNonDeletedElements()
      .reduce((acc, element) => {
        acc.set(element.id, deepCopyElement(element));
        return acc;
      }, new Map() as PointerDownState["originalElements"]),
    compositeControl: { active: null },
    resize: {
      handleType: false,
      isResizing: false,
      offset: { x: 0, y: 0 },
      arrowDirection: "origin",
      center: { x: (maxX + minX) / 2, y: (maxY + minY) / 2 },
    },
    hit: {
      element: null,
      allHitElements: [],
      wasAddedToSelection: false,
      replacedSelection: false,
      hasBeenDuplicated: false,
      arrowLabel: false,
      hasHitCommonBoundingBoxOfSelectedElements:
        app.isHittingCommonBoundingBoxOfSelectedElements(
          origin,
          selectedElements,
        ),
    },
    drag: {
      hasOccurred: false,
      offset: null,
      origin: { ...origin },
      blockDragging: false,
    },
    eventListeners: {
      onMove: null,
      onUp: null,
      onKeyUp: null,
      onKeyDown: null,
    },
    boxSelection: {
      hasOccurred: false,
    },
  };
};

export const onKeyDownFromPointerDownHandler = (
  app: PointerApp,
  pointerDownState: PointerDownState,
): ((event: KeyboardEvent) => void) => {
  return withBatchedUpdates((event: KeyboardEvent) => {
    if (app.mindmap.handlePointerKeyDown(pointerDownState, event)) {
      return;
    }
    if (app.maybeHandleResize(pointerDownState, event)) {
      return;
    }
    app.maybeDragNewGenericElement(pointerDownState, event);
  });
};

export const onKeyUpFromPointerDownHandler = (
  app: PointerApp,
  pointerDownState: PointerDownState,
): ((event: KeyboardEvent) => void) => {
  return withBatchedUpdates((event: KeyboardEvent) => {
    // Prevents focus from escaping excalidraw tab
    event.key === KEYS.ALT && event.preventDefault();
    if (app.maybeHandleResize(pointerDownState, event)) {
      return;
    }
    app.maybeDragNewGenericElement(pointerDownState, event);
  });
};

export const onPointerMoveFromPointerDownHandler = (
  app: PointerApp,
  pointerDownState: PointerDownState,
) => {
  return withBatchedUpdatesThrottled((event: PointerEvent) => {
    if (app.state.openDialog?.name === "elementLinkSelector") {
      return;
    }
    const pointerCoords = viewportCoordsToSceneCoords(event, app.state);

    if (
      app.mindmap.handlePointerMoveFromPointerDown(
        pointerDownState,
        event,
        pointerCoords,
      )
    ) {
      return;
    }

    if (app.mindmap.shouldBlockNativePointer(pointerDownState)) {
      return;
    }

    if (app.state.activeLockedId) {
      app.setState({
        activeLockedId: null,
      });
    }

    if (
      app.state.selectedLinearElement &&
      app.state.selectedLinearElement.elbowed &&
      app.state.selectedLinearElement.initialState.segmentMidpoint.index
    ) {
      const [gridX, gridY] = getGridPoint(
        pointerCoords.x,
        pointerCoords.y,
        event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
      );

      let index =
        app.state.selectedLinearElement.initialState.segmentMidpoint.index;
      if (index < 0) {
        const nextCoords = LinearElementEditor.getSegmentMidpointHitCoords(
          {
            ...app.state.selectedLinearElement,
            segmentMidPointHoveredCoords: null,
          },
          { x: gridX, y: gridY },
          app.state,
          app.scene.getNonDeletedElementsMap(),
        );
        index = nextCoords
          ? LinearElementEditor.getSegmentMidPointIndex(
              app.state.selectedLinearElement,
              app.state,
              nextCoords,
              app.scene.getNonDeletedElementsMap(),
            )
          : -1;
      }

      const ret = LinearElementEditor.moveFixedSegment(
        app.state.selectedLinearElement,
        index,
        gridX,
        gridY,
        app.scene,
      );

      app.setState({
        selectedLinearElement: {
          ...app.state.selectedLinearElement,
          isDragging: true,
          segmentMidPointHoveredCoords: ret.segmentMidPointHoveredCoords,
          initialState: ret.initialState,
        },
      });
      return;
    }

    const lastPointerCoords =
      app.previousPointerMoveCoords ?? pointerDownState.origin;
    app.previousPointerMoveCoords = pointerCoords;

    // We need to initialize dragOffsetXY only after we've updated
    // `state.selectedElementIds` on pointerDown. Doing it here in pointerMove
    // event handler should hopefully ensure we're already working with
    // the updated state.
    if (pointerDownState.drag.offset === null) {
      pointerDownState.drag.offset = tupleToCoors(
        getDragOffsetXY(
          app.scene.getSelectedElements(app.state),
          pointerDownState.origin.x,
          pointerDownState.origin.y,
        ),
      );
    }
    const target = event.target;
    if (!(target instanceof app.ownerWindow.HTMLElement)) {
      return;
    }

    if (app.handlePointerMoveOverScrollbars(event, pointerDownState)) {
      return;
    }

    if (isEraserActive(app.state)) {
      app.handleEraser(event, pointerCoords);
      return;
    }

    if (app.state.activeTool.type === "laser") {
      app.laserTrails.addPointToPath(pointerCoords.x, pointerCoords.y);
    }

    if (app.drawShape.handlePointerMove(pointerCoords)) {
      return;
    }

    const [gridX, gridY] = getGridPoint(
      pointerCoords.x,
      pointerCoords.y,
      event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
    );

    if (pointerDownState.compositeControl.active) {
      const control = pointerDownState.compositeControl.active;
      const element = app.scene.getNonDeletedElement(control.elementId);
      if (isCompositeShapeElement(element)) {
        const local = getCompositeControlPointLocal(
          element,
          pointerCoords.x - control.offset.x,
          pointerCoords.y - control.offset.y,
        );
        const shape = updateCompositeShapeControlPoint(
          element.shape,
          control.kind,
          local.x,
          local.y,
          element.width,
          element.height,
        );
        if (shape !== element.shape) {
          const oldPoint = getCompositeShapeControlPoints(element).find(
            (point) => point.kind === control.kind,
          );
          const newPoint = getCompositeShapeControlPoints({
            width: element.width,
            height: element.height,
            shape,
          }).find((point) => point.kind === control.kind);
          app.scene.mutateElement(element, { shape });
          if (oldPoint && newPoint) {
            const oldFixedPoint = [
              oldPoint.x / element.width,
              oldPoint.y / element.height,
            ];
            const newFixedPoint = [
              newPoint.x / element.width,
              newPoint.y / element.height,
            ] as [number, number];
            for (const bound of element.boundElements ?? []) {
              const arrow = app.scene.getNonDeletedElement(bound.id);
              if (!isArrowElement(arrow)) {
                continue;
              }
              const bindingUpdates: {
                startBinding?: typeof arrow.startBinding;
                endBinding?: typeof arrow.endBinding;
              } = {};
              for (const key of ["startBinding", "endBinding"] as const) {
                const binding = arrow[key];
                if (
                  binding?.elementId === element.id &&
                  Math.hypot(
                    binding.fixedPoint[0] - oldFixedPoint[0],
                    binding.fixedPoint[1] - oldFixedPoint[1],
                  ) < 0.01
                ) {
                  bindingUpdates[key] = {
                    ...binding,
                    fixedPoint: newFixedPoint,
                  };
                }
              }
              if (Object.keys(bindingUpdates).length) {
                app.scene.mutateElement(arrow, bindingUpdates);
              }
            }
          }
          const boundText = getBoundTextElement(
            element,
            app.scene.getNonDeletedElementsMap(),
          );
          if (boundText) {
            redrawTextBoundingBox(boundText, element, app.scene);
          }
          updateBoundElements(element, app.scene);
          control.hasChanged = true;
        }
      }
      return;
    }

    if (pointerDownState.resize.isResizing) {
      pointerDownState.lastCoords.x = pointerCoords.x;
      pointerDownState.lastCoords.y = pointerCoords.y;
      if (app.maybeHandleCrop(pointerDownState, event)) {
        return true;
      }
      if (app.maybeHandleResize(pointerDownState, event)) {
        return true;
      }
    }
    const elementsMap = app.scene.getNonDeletedElementsMap();

    if (app.state.selectedLinearElement) {
      const linearElementEditor = app.state.selectedLinearElement;

      // Handle focus point dragging if needed
      if (linearElementEditor.draggedFocusPointBinding) {
        handleFocusPointDrag(
          linearElementEditor,
          elementsMap,
          pointerCoords,
          app.scene,
          app.state,
          app.getEffectiveGridSize(),
          event.altKey,
        );
        app.setState({
          selectedLinearElement: {
            ...linearElementEditor,
            isDragging: false,
            selectedPointsIndices: [],
            initialState: {
              ...linearElementEditor.initialState,
              lastClickedPoint: -1,
            },
          },
        });
        return;
      }

      if (
        app.arrowText.maybeDragLabel(
          linearElementEditor,
          pointerDownState,
          pointerCoords,
        )
      ) {
        return;
      }

      if (
        LinearElementEditor.shouldAddMidpoint(
          app.state.selectedLinearElement,
          pointerCoords,
          app.state,
          elementsMap,
        )
      ) {
        const ret = LinearElementEditor.addMidpoint(
          app.state.selectedLinearElement,
          pointerCoords,
          app,
          !event[KEYS.CTRL_OR_CMD],
          app.scene,
        );
        if (!ret) {
          return;
        }

        // Since we are reading from previous state which is not possible with
        // automatic batching in React 18 hence using flush sync to synchronously
        // update the state. Check https://github.com/excalidraw/excalidraw/pull/5508 for more details.

        flushSync(() => {
          if (app.state.selectedLinearElement) {
            app.setState({
              selectedLinearElement: {
                ...app.state.selectedLinearElement,
                initialState: ret.pointerDownState,
                selectedPointsIndices: ret.selectedPointsIndices,
                segmentMidPointHoveredCoords: null,
                isDragging: true,
              },
            });
          }
        });

        return;
      } else if (
        linearElementEditor.initialState.segmentMidpoint.value !== null &&
        !linearElementEditor.initialState.segmentMidpoint.added
      ) {
        return;
      } else if (linearElementEditor.initialState.lastClickedPoint > -1) {
        const element = LinearElementEditor.getElement(
          linearElementEditor.elementId,
          elementsMap,
        );

        if (element?.isDeleted) {
          return;
        }

        if (isBindingElement(element)) {
          const hoveredElement = getHoveredElementForBinding(
            pointFrom<GlobalPoint>(pointerCoords.x, pointerCoords.y),
            app.scene.getNonDeletedElements(),
            elementsMap,
          );

          if (getFeatureFlag("COMPLEX_BINDINGS")) {
            app.handleDelayedBindModeChange(element, hoveredElement);
          }
        }

        if (
          event.altKey &&
          !app.state.selectedLinearElement?.initialState?.arrowStartIsInside &&
          getFeatureFlag("COMPLEX_BINDINGS")
        ) {
          app.handleSkipBindMode();
        }

        // Ignore drag requests if the arrow modification already happened
        if (linearElementEditor.initialState.lastClickedPoint === -1) {
          return;
        }

        const newState = LinearElementEditor.handlePointDragging(
          event,
          app,
          pointerCoords.x,
          pointerCoords.y,
          linearElementEditor,
        );

        if (newState) {
          pointerDownState.lastCoords.x = pointerCoords.x;
          pointerDownState.lastCoords.y = pointerCoords.y;
          pointerDownState.drag.hasOccurred = true;

          // NOTE: Optimize setState calls because it
          // affects history and performance
          if (
            newState.suggestedBinding !== app.state.suggestedBinding ||
            !isShallowEqual(
              newState.selectedLinearElement?.selectedPointsIndices ?? [],
              app.state.selectedLinearElement?.selectedPointsIndices ?? [],
            ) ||
            newState.selectedLinearElement?.hoverPointIndex !==
              app.state.selectedLinearElement?.hoverPointIndex ||
            newState.selectedLinearElement?.customLineAngle !==
              app.state.selectedLinearElement?.customLineAngle ||
            app.state.selectedLinearElement.isDragging !==
              newState.selectedLinearElement?.isDragging ||
            app.state.selectedLinearElement?.initialState?.altFocusPoint !==
              newState.selectedLinearElement?.initialState?.altFocusPoint
          ) {
            app.setState(newState);
          }

          return;
        }
      }
    }

    const hasHitASelectedElement = pointerDownState.hit.allHitElements.some(
      (element) => app.isASelectedElement(element),
    );

    const isSelectingPointsInLineEditor =
      app.state.selectedLinearElement?.isEditing &&
      event.shiftKey &&
      app.state.selectedLinearElement.elementId ===
        pointerDownState.hit.element?.id;

    if (
      (hasHitASelectedElement ||
        pointerDownState.hit.hasHitCommonBoundingBoxOfSelectedElements) &&
      !isSelectingPointsInLineEditor &&
      !pointerDownState.drag.blockDragging
    ) {
      const selectedElements = app.scene.getSelectedElements(app.state);
      if (
        selectedElements.length > 0 &&
        selectedElements.every((element) => element.locked)
      ) {
        return;
      }

      const selectedElementsHasAFrame = selectedElements.some((e) =>
        isFrameLikeElement(e),
      );
      const frameToHighlight = selectedElementsHasAFrame
        ? null
        : app.getTopLayerFrameAtSceneCoords(pointerCoords, {
            currentFrameId: getCommonFrameId(selectedElements),
            excludeElementIds: app.state.selectedElementIds,
          });
      // Only update the state if there is a difference
      app.updateFrameToHighlight(frameToHighlight);

      // Marking that click was used for dragging to check
      // if elements should be deselected on pointerup
      pointerDownState.drag.hasOccurred = true;

      // prevent immediate dragging during lasso selection to avoid element displacement
      // only allow dragging if we're not in the middle of lasso selection
      // (on mobile, allow dragging if we hit an element)
      if (
        app.state.activeTool.type === "lasso" &&
        app.lassoTrail.hasCurrentTrail &&
        !(
          app.editorInterface.formFactor !== "desktop" &&
          pointerDownState.hit.element
        ) &&
        !app.state.activeTool.fromSelection
      ) {
        return;
      }

      // Clear lasso trail when starting to drag selected elements with lasso tool
      // Only clear if we're actually dragging (not during lasso selection)
      if (
        app.state.activeTool.type === "lasso" &&
        selectedElements.length > 0 &&
        pointerDownState.drag.hasOccurred &&
        !app.state.activeTool.fromSelection
      ) {
        app.lassoTrail.endPath();
      }

      // prevent dragging even if we're no longer holding cmd/ctrl otherwise
      // it would have weird results (stuff jumping all over the screen)
      // Checking for editingTextElement to avoid jump while editing on mobile #6503
      if (
        selectedElements.length > 0 &&
        !pointerDownState.withCmdOrCtrl &&
        !app.state.editingTextElement &&
        app.state.activeEmbeddable?.state !== "active"
      ) {
        const dragOffset = {
          x: pointerCoords.x - pointerDownState.drag.origin.x,
          y: pointerCoords.y - pointerDownState.drag.origin.y,
        };

        const originalElements = [
          ...pointerDownState.originalElements.values(),
        ];

        // We only drag in one direction if shift is pressed
        const lockDirection = event.shiftKey;

        if (lockDirection) {
          const distanceX = Math.abs(dragOffset.x);
          const distanceY = Math.abs(dragOffset.y);

          const lockX = lockDirection && distanceX < distanceY;
          const lockY = lockDirection && distanceX > distanceY;

          if (lockX) {
            dragOffset.x = 0;
          }

          if (lockY) {
            dragOffset.y = 0;
          }
        }

        // #region move crop region
        if (app.state.croppingElementId) {
          const croppingElement = app.scene
            .getNonDeletedElementsMap()
            .get(app.state.croppingElementId);

          if (
            croppingElement &&
            isImageElement(croppingElement) &&
            croppingElement.crop !== null &&
            pointerDownState.hit.element === croppingElement
          ) {
            const crop = croppingElement.crop;
            const image =
              isInitializedImageElement(croppingElement) &&
              app.imageCache.get(croppingElement.fileId)?.image;

            if (image && !(image instanceof Promise)) {
              const uncroppedSize = getUncroppedWidthAndHeight(croppingElement);
              const instantDragOffset = vector(
                pointerCoords.x - lastPointerCoords.x,
                pointerCoords.y - lastPointerCoords.y,
              );

              // to reduce cursor:image drift, we need to take into account
              // the canvas image element scaling so we can accurately
              // track the pixels on movement
              instantDragOffset[0] *= image.naturalWidth / uncroppedSize.width;
              instantDragOffset[1] *=
                image.naturalHeight / uncroppedSize.height;

              const [x1, y1, x2, y2, cx, cy] = getElementAbsoluteCoords(
                croppingElement,
                elementsMap,
              );

              const topLeft = vectorFromPoint(
                pointRotateRads(
                  pointFrom(x1, y1),
                  pointFrom(cx, cy),
                  croppingElement.angle,
                ),
              );
              const topRight = vectorFromPoint(
                pointRotateRads(
                  pointFrom(x2, y1),
                  pointFrom(cx, cy),
                  croppingElement.angle,
                ),
              );
              const bottomLeft = vectorFromPoint(
                pointRotateRads(
                  pointFrom(x1, y2),
                  pointFrom(cx, cy),
                  croppingElement.angle,
                ),
              );
              const topEdge = vectorNormalize(
                vectorSubtract(topRight, topLeft),
              );
              const leftEdge = vectorNormalize(
                vectorSubtract(bottomLeft, topLeft),
              );

              // project instantDrafOffset onto leftEdge and topEdge to decompose
              const offsetVector = vector(
                vectorDot(instantDragOffset, topEdge),
                vectorDot(instantDragOffset, leftEdge),
              );

              const nextCrop = {
                ...crop,
                x: clamp(
                  crop.x -
                    offsetVector[0] * Math.sign(croppingElement.scale[0]),
                  0,
                  image.naturalWidth - crop.width,
                ),
                y: clamp(
                  crop.y -
                    offsetVector[1] * Math.sign(croppingElement.scale[1]),
                  0,
                  image.naturalHeight - crop.height,
                ),
              };

              app.scene.mutateElement(croppingElement, {
                crop: nextCrop,
              });

              return;
            }
          }
        }

        // Snap cache *must* be synchronously popuplated before initial drag,
        // otherwise the first drag even will not snap, causing a jump before
        // it snaps to its position if previously snapped already.
        app.maybeCacheVisibleGaps(event, selectedElements);
        app.maybeCacheReferenceSnapPoints(event, selectedElements);

        const { snapOffset, snapLines } = snapDraggedElements(
          originalElements,
          dragOffset,
          app,
          event,
          app.scene.getNonDeletedElementsMap(),
        );

        app.setState({ snapLines });

        // when we're editing the name of a frame, we want the user to be
        // able to select and interact with the text input
        if (!app.state.editingFrame) {
          dragSelectedElements(
            pointerDownState,
            selectedElements,
            dragOffset,
            app.scene,
            snapOffset,
            event[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
          );
        }

        app.setState({
          selectedElementsAreBeingDragged: true,
          // element is being dragged and selectionElement that was created on pointer down
          // should be removed
          selectionElement: null,
        });

        // We duplicate the selected element if alt is pressed on pointer move
        if (event.altKey && !pointerDownState.hit.hasBeenDuplicated) {
          app.duplicate.duplicateDraggedSelection(pointerDownState, event);
        }

        return;
      }
    }

    if (app.state.selectionElement) {
      pointerDownState.lastCoords.x = pointerCoords.x;
      pointerDownState.lastCoords.y = pointerCoords.y;
      if (event.altKey) {
        app.setActiveTool(
          { type: "lasso", fromSelection: true },
          { keepSelection: event.shiftKey },
        );
        app.lassoTrail.startPath(
          pointerDownState.origin.x,
          pointerDownState.origin.y,
          event.shiftKey,
        );
        app.setAppState({
          selectionElement: null,
        });
        return;
      }
      app.maybeDragNewGenericElement(pointerDownState, event);
    } else if (app.state.activeTool.type === "lasso") {
      if (!event.altKey && app.state.activeTool.fromSelection) {
        app.setActiveTool({ type: "selection" });
        app.createGenericElementOnPointerDown("selection", pointerDownState);
        pointerDownState.lastCoords.x = pointerCoords.x;
        pointerDownState.lastCoords.y = pointerCoords.y;
        app.maybeDragNewGenericElement(pointerDownState, event);
        app.lassoTrail.endPath();
      } else {
        app.lassoTrail.addPointToPath(
          pointerCoords.x,
          pointerCoords.y,
          event.shiftKey,
        );
      }
    } else {
      // It is very important to read app.state within each move event,
      // otherwise we would read a stale one!
      const newElement = app.state.newElement;

      if (!newElement) {
        return;
      }

      if (newElement.type === "freedraw") {
        const points = newElement.points;
        const dx = pointerCoords.x - newElement.x;
        const dy = pointerCoords.y - newElement.y;

        const lastPoint = points.length > 0 && points[points.length - 1];
        const discardPoint =
          lastPoint && lastPoint[0] === dx && lastPoint[1] === dy;

        if (!discardPoint) {
          const pressures = newElement.simulatePressure
            ? newElement.pressures
            : [...newElement.pressures, event.pressure];

          app.scene.mutateElement(
            newElement,
            {
              points: [...points, pointFrom<LocalPoint>(dx, dy)],
              pressures,
            },
            {
              informMutation: false,
              isDragging: false,
            },
          );

          app.setState({
            newElement,
          });
        }
      } else if (isLinearElement(newElement) && !newElement.isDeleted) {
        pointerDownState.drag.hasOccurred = true;
        const points = newElement.points;

        invariant(
          points.length > 1,
          "Do not create linear elements with less than 2 points",
        );

        let linearElementEditor = app.state.selectedLinearElement;

        if (
          !linearElementEditor ||
          linearElementEditor.elementId !== newElement.id
        ) {
          linearElementEditor = new LinearElementEditor(
            newElement,
            app.scene.getNonDeletedElementsMap(),
          );
        }

        const lastClickedPointOutOfBounds =
          linearElementEditor &&
          (linearElementEditor.initialState.lastClickedPoint < 0 ||
            linearElementEditor.initialState.lastClickedPoint >= points.length);
        if (lastClickedPointOutOfBounds) {
          console.warn(
            "Last clicked point is out of bounds. Attempting to fix it.",
          );
          linearElementEditor = {
            ...linearElementEditor,
            selectedPointsIndices: [points.length - 1],
            initialState: {
              ...linearElementEditor.initialState,
              prevSelectedPointsIndices: null,
              lastClickedPoint: points.length - 1,
            },
            hoverPointIndex: points.length - 1,
          };
        }

        app.setState({
          newElement,
          ...LinearElementEditor.handlePointDragging(
            event,
            app,
            gridX,
            gridY,
            linearElementEditor,
          )!,
        });
      } else {
        pointerDownState.lastCoords.x = pointerCoords.x;
        pointerDownState.lastCoords.y = pointerCoords.y;
        app.maybeDragNewGenericElement(pointerDownState, event, false);
      }
    }

    if (app.state.activeTool.type === "selection") {
      pointerDownState.boxSelection.hasOccurred = true;

      const elements = app.scene.getNonDeletedElements();

      // box-select line editor points
      if (app.state.selectedLinearElement?.isEditing) {
        LinearElementEditor.handleBoxSelection(
          event,
          app.state,
          app.setState.bind(app),
          app.scene.getNonDeletedElementsMap(),
        );
        // regular box-select
      } else {
        let shouldReuseSelection = true;

        if (!event.shiftKey && isSomeElementSelected(elements, app.state)) {
          if (pointerDownState.withCmdOrCtrl && pointerDownState.hit.element) {
            app.setState((prevState) =>
              selectGroupsForSelectedElements(
                {
                  ...prevState,
                  selectedElementIds: {
                    [pointerDownState.hit.element!.id]: true,
                  },
                },
                app.scene.getNonDeletedElements(),
                prevState,
                app,
              ),
            );
          } else {
            shouldReuseSelection = false;
          }
        }
        const elementsWithinSelection = app.state.selectionElement
          ? getElementsWithinSelection(
              elements,
              app.state.selectionElement,
              app.scene.getNonDeletedElementsMap(),
              false,
              app.state.boxSelectionMode,
            )
          : [];

        app.setState((prevState) => {
          const nextSelectedElementIds = {
            ...(shouldReuseSelection && prevState.selectedElementIds),
            ...elementsWithinSelection.reduce(
              (acc: Record<ExcalidrawElement["id"], true>, element) => {
                acc[element.id] = true;
                return acc;
              },
              {},
            ),
          };

          if (pointerDownState.hit.element) {
            // if using ctrl/cmd, select the hitElement only if we
            // haven't box-selected anything else
            if (!elementsWithinSelection.length) {
              nextSelectedElementIds[pointerDownState.hit.element.id] = true;
            } else {
              delete nextSelectedElementIds[pointerDownState.hit.element.id];
            }
          }

          const normalizedSelectedElementIds =
            app.mindmap.normalizeMindmapSelection(nextSelectedElementIds);

          prevState = !shouldReuseSelection
            ? { ...prevState, selectedGroupIds: {}, editingGroupId: null }
            : prevState;

          return {
            ...selectGroupsForSelectedElements(
              {
                editingGroupId: prevState.editingGroupId,
                selectedElementIds: normalizedSelectedElementIds,
              },
              app.scene.getNonDeletedElements(),
              prevState,
              app,
            ),
            // select linear element only when we haven't box-selected anything else
            selectedLinearElement:
              elementsWithinSelection.length === 1 &&
              isLinearElement(elementsWithinSelection[0])
                ? new LinearElementEditor(
                    elementsWithinSelection[0],
                    app.scene.getNonDeletedElementsMap(),
                  )
                : null,
            showHyperlinkPopup:
              elementsWithinSelection.length === 1 &&
              (elementsWithinSelection[0].link ||
                isEmbeddableElement(elementsWithinSelection[0]))
                ? "info"
                : false,
          };
        });
      }
    }
  });
};

export const handlePointerMoveOverScrollbars = (
  app: PointerApp,
  event: PointerEvent,
  pointerDownState: PointerDownState,
): boolean => {
  if (pointerDownState.scrollbars.isOverHorizontal) {
    const x = event.clientX;
    const dx = x - pointerDownState.lastCoords.x;
    app.viewport.translate({
      scrollX:
        app.state.scrollX -
        (dx *
          (app.interactionState.currentScrollBars.horizontal?.deltaMultiplier ||
            1)) /
          app.state.zoom.value,
    });
    pointerDownState.lastCoords.x = x;
    return true;
  }

  if (pointerDownState.scrollbars.isOverVertical) {
    const y = event.clientY;
    const dy = y - pointerDownState.lastCoords.y;
    app.viewport.translate({
      scrollY:
        app.state.scrollY -
        (dy *
          (app.interactionState.currentScrollBars.vertical?.deltaMultiplier ||
            1)) /
          app.state.zoom.value,
    });
    pointerDownState.lastCoords.y = y;
    return true;
  }
  return false;
};

export const onPointerUpFromPointerDownHandler = (
  app: PointerApp,
  pointerDownState: PointerDownState,
): ((event: PointerEvent) => void) => {
  return withBatchedUpdates((childEvent: PointerEvent) => {
    const elementsMap = app.scene.getNonDeletedElementsMap();

    app.removePointer(childEvent);
    pointerDownState.drag.blockDragging = false;
    if (pointerDownState.eventListeners.onMove) {
      pointerDownState.eventListeners.onMove.flush();
    }

    // an armed bucket fill commits only on a GENUINE pointer up. The
    // missing-pointer-up cleanup replays app handler with the pointer
    // DOWN event (e.g. when a second finger lands mid-press — pinch/pan
    // intent), and a tool switch mid-press orphans the click — both must
    // discard the fill instead of committing an unwanted edit.
    if (
      childEvent.type === "pointerup" &&
      app.state.activeTool.type === TOOL_TYPE.bucketfill
    ) {
      app.bucketFill.handlePointerUp();
    } else {
      app.bucketFill.cancel();
    }
    const {
      newElement,
      resizingElement,
      croppingElementId,
      multiElement,
      activeTool,
      isResizing,
      isRotating,
      isCropping,
    } = app.state;

    app.activeResizeHandle = null;
    app.setState((prevState) => ({
      isResizing: false,
      isRotating: false,
      isCropping: false,
      resizingElement: null,
      selectionElement: null,
      frameToHighlight: null,
      elementsToHighlight: null,
      cursorButton: "up",
      snapLines: updateStable(prevState.snapLines, []),
      originSnapOffset: null,
    }));

    // just in case, tool changes mid drag, always clean up
    app.lassoTrail.endPath();
    app.previousPointerMoveCoords = null;

    SnapCache.setReferenceSnapPoints(null);
    SnapCache.setVisibleGaps(null);

    app.savePointer(childEvent.clientX, childEvent.clientY, "up");

    // if current elements are still selected
    // and the pointer is just over a locked element
    // do not allow activeLockedId to be set

    const hitElements = pointerDownState.hit.allHitElements;

    const sceneCoords = viewportCoordsToSceneCoords(
      { clientX: childEvent.clientX, clientY: childEvent.clientY },
      app.state,
    );
    const mindmapHandled = app.mindmap.handlePointerUp(
      pointerDownState,
      childEvent,
      sceneCoords,
    );

    if (
      app.state.activeTool.type === "selection" &&
      !pointerDownState.boxSelection.hasOccurred &&
      !pointerDownState.resize.isResizing &&
      !hitElements.some((el) => app.state.selectedElementIds[el.id])
    ) {
      const hitLockedElement = app.getElementAtPosition(
        sceneCoords.x,
        sceneCoords.y,
        {
          includeLockedElements: true,
        },
      );

      if (!app.isEditingTextContent()) {
        app.store.scheduleCapture();
      }

      if (hitLockedElement?.locked) {
        app.setState({
          activeLockedId:
            hitLockedElement.groupIds.length > 0
              ? hitLockedElement.groupIds.at(-1) || ""
              : hitLockedElement.id,
        });
      } else {
        app.setState({
          activeLockedId: null,
        });
      }
    } else {
      app.setState({
        activeLockedId: null,
      });
    }

    if (getFeatureFlag("COMPLEX_BINDINGS")) {
      app.resetDelayedBindMode();
    }

    app.setState({
      selectedElementsAreBeingDragged: false,
      bindMode: "orbit",
    });

    if (
      pointerDownState.drag.hasOccurred &&
      pointerDownState.hit?.element?.id
    ) {
      const element = elementsMap.get(pointerDownState.hit.element.id);
      if (isBindableElement(element)) {
        // Renormalize elbow arrows when they are changed via indirect move
        element.boundElements
          ?.filter((e) => e.type === "arrow")
          .map((e) => elementsMap.get(e.id))
          .filter((e) => isElbowArrow(e))
          .forEach((e) => {
            !!e && app.scene.mutateElement(e, {});
          });
      }
    }

    // Handle end of dragging a point of a linear element, might close a loop
    // and sets binding element
    if (
      app.state.selectedLinearElement?.isEditing &&
      !app.state.newElement &&
      app.state.selectedLinearElement.draggedFocusPointBinding === null
    ) {
      if (
        !pointerDownState.boxSelection.hasOccurred &&
        pointerDownState.hit?.element?.id !==
          app.state.selectedLinearElement.elementId &&
        app.state.selectedLinearElement.draggedFocusPointBinding === null
      ) {
        app.actionManager.executeAction(actionFinalize);
      } else {
        const editingLinearElement = LinearElementEditor.handlePointerUp(
          childEvent,
          app.state.selectedLinearElement,
          app.state,
          app.scene,
        );
        app.actionManager.executeAction(actionFinalize, "ui", {
          event: childEvent,
          sceneCoords,
          hitBoundText: pointerDownState.hit.arrowLabel,
        });
        if (editingLinearElement !== app.state.selectedLinearElement) {
          app.setState({
            selectedLinearElement: editingLinearElement,
            suggestedBinding: null,
          });
        }
      }
    } else if (app.state.selectedLinearElement) {
      // Normalize elbow arrow points, remove close parallel segments
      if (app.state.selectedLinearElement.elbowed) {
        const element = LinearElementEditor.getElement(
          app.state.selectedLinearElement.elementId,
          app.scene.getNonDeletedElementsMap(),
        );
        if (element) {
          app.scene.mutateElement(element as ExcalidrawElbowArrowElement, {});
        }
      }

      if (app.state.selectedLinearElement.draggedFocusPointBinding) {
        handleFocusPointPointerUp(app.state.selectedLinearElement, app.scene);
        app.setState({
          selectedLinearElement: {
            ...app.state.selectedLinearElement,
            draggedFocusPointBinding: null,
            initialState: {
              ...app.state.selectedLinearElement.initialState,
              arrowOtherEndpointInitialBinding: null,
            },
          },
        });
      } else if (
        pointerDownState.hit?.element?.id !==
        app.state.selectedLinearElement.elementId
      ) {
        const selectedELements = app.scene.getSelectedElements(app.state);
        // set selectedLinearElement to null if there is more than one element selected since we don't want to show linear element handles
        if (selectedELements.length > 1) {
          app.setState({ selectedLinearElement: null });
        }
      } else if (app.state.selectedLinearElement.isDragging) {
        app.setState({
          selectedLinearElement: {
            ...app.state.selectedLinearElement,
            isDragging: false,
          },
        });
        app.actionManager.executeAction(actionFinalize, "ui", {
          event: childEvent,
          sceneCoords,
          hitBoundText: pointerDownState.hit.arrowLabel,
        });
      }

      if (
        app.state.newElement &&
        app.state.multiElement &&
        isLinearElement(app.state.newElement) &&
        app.state.selectedLinearElement
      ) {
        const { multiElement } = app.state;

        app.setState({
          selectedLinearElement: {
            ...app.state.selectedLinearElement,
            lastCommittedPoint:
              multiElement.points[multiElement.points.length - 1],
          },
        });
      }
    }

    app.missingPointerEventCleanupEmitter.clear();

    app.ownerWindow.removeEventListener(
      EVENT.POINTER_MOVE,
      pointerDownState.eventListeners.onMove!,
    );
    app.ownerWindow.removeEventListener(
      EVENT.POINTER_UP,
      pointerDownState.eventListeners.onUp!,
    );
    app.ownerWindow.removeEventListener(
      EVENT.POINTER_CANCEL,
      pointerDownState.eventListeners.onUp!,
    );
    app.ownerWindow.removeEventListener(
      EVENT.KEYDOWN,
      pointerDownState.eventListeners.onKeyDown!,
    );
    app.ownerWindow.removeEventListener(
      EVENT.KEYUP,
      pointerDownState.eventListeners.onKeyUp!,
    );

    app.props?.onPointerUp?.(activeTool, pointerDownState);
    app.onPointerUpEmitter.trigger(
      app.state.activeTool,
      pointerDownState,
      childEvent,
    );

    if (pointerDownState.compositeControl.active) {
      if (pointerDownState.compositeControl.active.hasChanged) {
        app.store.scheduleCapture();
        app.scene.triggerUpdate();
      }
      return;
    }

    if (mindmapHandled) {
      return;
    }

    if (newElement?.type === "freedraw") {
      const pointerCoords = viewportCoordsToSceneCoords(childEvent, app.state);

      const points = newElement.points;
      let dx = pointerCoords.x - newElement.x;
      let dy = pointerCoords.y - newElement.y;

      // Allows dots to avoid being flagged as infinitely small
      if (dx === points[0][0] && dy === points[0][1]) {
        dy += 0.0001;
        dx += 0.0001;
      }

      const pressures = newElement.simulatePressure
        ? []
        : [...newElement.pressures, childEvent.pressure];

      app.scene.mutateElement(newElement, {
        points: [...points, pointFrom<LocalPoint>(dx, dy)],
        pressures,
      });

      app.actionManager.executeAction(actionFinalize);

      return;
    }

    if (
      isLinearElement(newElement) &&
      app.state.activeTool.type !== "autoshape"
    ) {
      const pointerCoords = viewportCoordsToSceneCoords(childEvent, app.state);

      const dragDistance =
        pointDistance(
          pointFrom(pointerCoords.x, pointerCoords.y),
          pointFrom(pointerDownState.origin.x, pointerDownState.origin.y),
        ) * app.state.zoom.value;

      if (
        (!pointerDownState.drag.hasOccurred ||
          dragDistance < MINIMUM_ARROW_SIZE) &&
        newElement &&
        !multiElement
      ) {
        if (app.editorInterface.isTouchScreen) {
          const FIXED_DELTA_X = Math.min(
            (app.state.width * 0.7) / app.state.zoom.value,
            100,
          );

          app.scene.mutateElement(
            newElement,
            {
              x: newElement.x - FIXED_DELTA_X / 2,
              points: [
                pointFrom<LocalPoint>(0, 0),
                pointFrom<LocalPoint>(FIXED_DELTA_X, 0),
              ],
            },
            { informMutation: false, isDragging: false },
          );

          app.actionManager.executeAction(actionFinalize);
        } else {
          // Movement out of commit area will create the point
          app.setState({
            multiElement: newElement,
            newElement,
          });
        }
      } else if (pointerDownState.drag.hasOccurred && !multiElement) {
        app.store.scheduleCapture();

        if (isLinearElement(newElement)) {
          app.actionManager.executeAction(actionFinalize, "ui", {
            event: childEvent,
            sceneCoords,
          });
        }
        app.setState({ suggestedBinding: null });
        if (!app.isToolLocked()) {
          app.setState(
            (prevState) => ({
              newElement: null,
              activeTool: updateActiveTool(app.state, {
                type: app.state.preferredSelectionTool.type,
              }),
              selectedElementIds: makeNextSelectedElementIds(
                {
                  ...prevState.selectedElementIds,
                  [newElement.id]: true,
                },
                prevState,
              ),
              selectedLinearElement: new LinearElementEditor(
                newElement,
                app.scene.getNonDeletedElementsMap(),
              ),
            }),
            // reset once the tool revert has settled
            () => app.cursor.reset(),
          );
        } else {
          app.setState({
            newElement: null,
          });
        }
        // so that the scene gets rendered again to display the newly drawn linear as well
        app.scene.triggerUpdate();
      }
      return;
    }

    if (isTextElement(newElement)) {
      const minWidth = getMinTextElementWidth(
        getFontString({
          fontSize: newElement.fontSize,
          fontFamily: newElement.fontFamily,
        }),
        newElement.lineHeight,
      );

      if (newElement.width < minWidth) {
        app.scene.mutateElement(newElement, {
          autoResize: true,
        });
      }

      app.cursor.reset();

      app.handleTextWysiwyg(newElement, {
        isExistingElement: true,
      });
    }

    if (newElement && isStickyNoteElement(newElement)) {
      // a gesture under the drag threshold is a click: the default square,
      // centered on the pointer. A drag keeps its size — previewed
      // unclamped while the pointer is down — and snaps to the minimum
      // only now, growing away from the origin corner like the drag did
      const zoom = app.state.zoom.value;
      const isClick =
        newElement.width * zoom < DRAGGING_THRESHOLD &&
        newElement.height * zoom < DRAGGING_THRESHOLD;
      let nextGeometry;
      if (isClick) {
        const size = DEFAULT_STICKY_NOTE_SIZE;
        // Snap after centering: half the default size need not be on the grid.
        const [x, y] = getGridPoint(
          pointerDownState.origin.x - size / 2,
          pointerDownState.origin.y - size / 2,
          childEvent[KEYS.CTRL_OR_CMD] ? null : app.getEffectiveGridSize(),
        );
        nextGeometry = {
          x,
          y,
          width: size,
          height: size,
        };
      } else {
        // one line at the current font ceiling must fit, or the note would
        // grow on the first keystroke
        const minSize = getStickyNoteMinSize({
          fontSize: app.state.currentItemFontSize,
          fontFamily: app.state.currentItemFontFamily,
        });
        let width = Math.max(newElement.width, minSize.width);
        let height = Math.max(newElement.height, minSize.height);
        if (!shouldMaintainAspectRatio(childEvent)) {
          // a plain drag is proportional (Shift frees it); the two floors
          // differ, so the square is kept through the snap
          width = height = Math.max(width, height);
        }
        const { originInGrid } = pointerDownState;
        nextGeometry = {
          // a drag toward the top/left put the note's origin before the
          // pointer origin; that far edge stays put when the size grows
          x:
            newElement.x < originInGrid.x
              ? originInGrid.x - width
              : newElement.x,
          y:
            newElement.y < originInGrid.y
              ? originInGrid.y - height
              : newElement.y,
          width,
          height,
        };
      }

      app.scene.mutateElement(
        newElement,
        { ...nextGeometry, baseHeight: nextGeometry.height },
        { informMutation: false, isDragging: false },
      );

      app.store.scheduleCapture();
      app.scene.triggerUpdate();

      if (activeTool.locked) {
        app.setState((prevState) => ({
          newElement: null,
          selectedElementIds: makeNextSelectedElementIds({}, prevState),
        }));
        app.cursor.applyForTool();
        return;
      }

      app.cursor.reset();
      app.setState({
        newElement: null,
        activeTool: updateActiveTool(app.state, {
          type: app.state.preferredSelectionTool.type,
        }),
      });
      app.startTextEditing({
        sceneX: newElement.x + newElement.width / 2,
        sceneY: newElement.y + newElement.height / 2,
        container: newElement,
      });
      return;
    }

    if (
      activeTool.type !== "selection" &&
      newElement &&
      isInvisiblySmallElement(newElement)
    ) {
      // remove invisible element which was added in onPointerDown
      // update the store snapshot, so that invisible elements are not captured by the store
      app.updateScene({
        elements: app.scene
          .getElementsIncludingDeleted()
          .filter((el) => el.id !== newElement.id),
        appState: {
          newElement: null,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      return;
    }

    if (isFrameLikeElement(newElement)) {
      const elementsInsideFrame = getElementsInNewFrame(
        app.scene.getElementsIncludingDeleted(),
        newElement,
        app.scene.getNonDeletedElementsMap(),
      );

      app.scene.replaceAllElements(
        addElementsToFrame(
          app.scene.getElementsMapIncludingDeleted(),
          elementsInsideFrame,
          newElement,
        ),
      );
    }

    if (newElement) {
      app.scene.mutateElement(newElement, getNormalizedDimensions(newElement), {
        informMutation: false,
        isDragging: false,
      });
      // the above does not guarantee the scene to be rendered again, hence the trigger below
      app.scene.triggerUpdate();
    }

    if (pointerDownState.drag.hasOccurred) {
      const sceneCoords = viewportCoordsToSceneCoords(childEvent, app.state);

      // when editing the points of a linear element, we check if the
      // linear element still is in the frame afterwards
      // if not, the linear element will be removed from its frame (if any)
      if (
        app.state.selectedLinearElement &&
        app.state.selectedLinearElement.isDragging
      ) {
        const linearElement = app.scene.getElement(
          app.state.selectedLinearElement.elementId,
        );

        if (linearElement?.containerRef?.elementId) {
          const frame = getContainingFrame(linearElement, elementsMap);

          if (frame && linearElement) {
            if (
              !elementOverlapsWithFrame(
                linearElement,
                frame,
                app.scene.getNonDeletedElementsMap(),
              )
            ) {
              // remove the linear element from all groups
              // before removing it from the frame as well
              app.scene.mutateElement(linearElement, {
                groupIds: [],
              });

              removeElementsFromFrame(
                [linearElement],
                app.scene.getNonDeletedElementsMap(),
              );

              app.scene.triggerUpdate();
            }
          }
        }
      } else {
        // update the relationships between selected elements and frames
        const selectedElements = app.scene.getSelectedElements(app.state);
        const topLayerFrame = app.getTopLayerFrameAtSceneCoords(sceneCoords, {
          currentFrameId: getCommonFrameId(selectedElements),
          excludeElementIds: app.state.selectedElementIds,
        });
        let nextElements = app.scene.getElementsMapIncludingDeleted();

        const updateGroupIdsAfterEditingGroup = (
          elements: ExcalidrawElement[],
        ) => {
          if (elements.length > 0) {
            for (const element of elements) {
              const index = element.groupIds.indexOf(app.state.editingGroupId!);

              app.scene.mutateElement(
                element,
                {
                  groupIds: element.groupIds.slice(0, index),
                },
                { informMutation: false, isDragging: false },
              );
            }

            nextElements.forEach((element) => {
              if (
                element.groupIds.length &&
                getElementsInGroup(
                  nextElements,
                  element.groupIds[element.groupIds.length - 1],
                ).length < 2
              ) {
                app.scene.mutateElement(
                  element,
                  {
                    groupIds: [],
                  },
                  { informMutation: false, isDragging: false },
                );
              }
            });

            app.setState({
              editingGroupId: null,
            });
          }
        };

        if (topLayerFrame && !app.state.selectedElementIds[topLayerFrame.id]) {
          const elementsToAdd = selectedElements.filter((element) =>
            isElementInFrame(element, nextElements, app.state),
          );

          if (app.state.editingGroupId) {
            updateGroupIdsAfterEditingGroup(elementsToAdd);
          }

          nextElements = addElementsToFrame(
            nextElements,
            elementsToAdd,
            topLayerFrame,
          );
        } else if (!topLayerFrame) {
          if (app.state.editingGroupId) {
            const elementsToRemove = selectedElements.filter(
              (element) =>
                element.containerRef?.elementId &&
                !isElementInFrame(element, nextElements, app.state),
            );

            updateGroupIdsAfterEditingGroup(elementsToRemove);
          }
        }

        nextElements = updateFrameMembershipOfSelectedElements(
          nextElements,
          app.state,
          app,
        );

        app.scene.replaceAllElements(nextElements);
      }
    }

    if (resizingElement) {
      app.store.scheduleCapture();
    }

    if (resizingElement && isInvisiblySmallElement(resizingElement)) {
      // update the store snapshot, so that invisible elements are not captured by the store
      app.updateScene({
        elements: app.scene
          .getElementsIncludingDeleted()
          .filter((el) => el.id !== resizingElement.id),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }

    // handle frame membership for resizing frames and/or selected elements
    if (pointerDownState.resize.isResizing) {
      let nextElements = updateFrameMembershipOfSelectedElements(
        app.scene.getElementsIncludingDeleted(),
        app.state,
        app,
      );

      const selectedFrames = app.scene
        .getSelectedElements(app.state)
        .filter(isFrameLikeElement);

      for (const frame of selectedFrames) {
        nextElements = replaceAllElementsInFrame(
          nextElements,
          getElementsInResizingFrame(
            app.scene.getElementsIncludingDeleted(),
            frame,
            app.state,
            elementsMap,
          ),
          frame,
        );
      }

      app.scene.replaceAllElements(nextElements);
    }

    // Code below handles selection when element(s) weren't
    // drag or added to selection on pointer down phase.
    const hitElement = pointerDownState.hit.element;
    if (
      app.state.selectedLinearElement?.elementId !== hitElement?.id &&
      isLinearElement(hitElement)
    ) {
      const selectedElements = app.scene.getSelectedElements(app.state);
      // set selectedLinearElement when no other element selected except
      // the one we've hit
      if (selectedElements.length === 1) {
        app.setState({
          selectedLinearElement: new LinearElementEditor(
            hitElement,
            app.scene.getNonDeletedElementsMap(),
          ),
        });
      }
    }

    // click outside the cropping region to exit
    if (
      // not in the cropping mode at all
      !croppingElementId ||
      // in the cropping mode
      (croppingElementId &&
        // not cropping and no hit element
        ((!hitElement && !isCropping) ||
          // hitting something else
          (hitElement && hitElement.id !== croppingElementId)))
    ) {
      app.finishImageCropping();
    }

    const pointerStart = app.lastPointerDownEvent;
    const pointerEnd = app.lastPointerUpEvent || app.lastPointerMoveEvent;

    if (isEraserActive(app.state) && pointerStart && pointerEnd) {
      app.eraserTrail.endPath();

      const draggedDistance = pointDistance(
        pointFrom(pointerStart.clientX, pointerStart.clientY),
        pointFrom(pointerEnd.clientX, pointerEnd.clientY),
      );

      if (draggedDistance === 0) {
        const scenePointer = viewportCoordsToSceneCoords(
          {
            clientX: pointerEnd.clientX,
            clientY: pointerEnd.clientY,
          },
          app.state,
        );
        const hitElements = app.getElementsAtPosition(
          scenePointer.x,
          scenePointer.y,
        );
        hitElements.forEach((hitElement) =>
          app.elementsPendingErasure.add(hitElement.id),
        );
      }
      app.eraseElements();
      return;
    } else if (app.elementsPendingErasure.size) {
      app.restoreReadyToEraseElements();
    }

    if (
      hitElement &&
      !pointerDownState.drag.hasOccurred &&
      !pointerDownState.hit.wasAddedToSelection &&
      // if we're editing a line, pointerup shouldn't switch selection if
      // box selected
      (!app.state.selectedLinearElement?.isEditing ||
        !pointerDownState.boxSelection.hasOccurred) &&
      // hitElement can be set when alt + ctrl to toggle lasso and we will
      // just respect the selected elements from lasso instead
      app.state.activeTool.type !== "lasso"
    ) {
      // when inside line editor, shift selects points instead
      if (childEvent.shiftKey && !app.state.selectedLinearElement?.isEditing) {
        if (app.state.selectedElementIds[hitElement.id]) {
          if (isSelectedViaGroup(app.state, hitElement)) {
            app.setState((_prevState) => {
              const nextSelectedElementIds = {
                ..._prevState.selectedElementIds,
              };

              // We want to unselect all groups hitElement is part of
              // as well as all elements that are part of the groups
              // hitElement is part of
              for (const groupedElement of hitElement.groupIds.flatMap(
                (groupId) =>
                  getElementsInGroup(
                    app.scene.getNonDeletedElements(),
                    groupId,
                  ),
              )) {
                delete nextSelectedElementIds[groupedElement.id];
              }

              return {
                selectedGroupIds: {
                  ..._prevState.selectedElementIds,
                  ...hitElement.groupIds
                    .map((gId) => ({ [gId]: false }))
                    .reduce((prev, acc) => ({ ...prev, ...acc }), {}),
                },
                selectedElementIds: makeNextSelectedElementIds(
                  nextSelectedElementIds,
                  _prevState,
                ),
              };
            });
            // if not dragging a linear element point (outside editor)
          } else if (!app.state.selectedLinearElement?.isDragging) {
            // remove element from selection while
            // keeping prev elements selected

            app.setState((prevState) => {
              const newSelectedElementIds = {
                ...prevState.selectedElementIds,
              };
              delete newSelectedElementIds[hitElement!.id];
              const newSelectedElements = getSelectedElements(
                app.scene.getNonDeletedElements(),
                { selectedElementIds: newSelectedElementIds },
              );

              return {
                ...selectGroupsForSelectedElements(
                  {
                    editingGroupId: prevState.editingGroupId,
                    selectedElementIds: newSelectedElementIds,
                  },
                  app.scene.getNonDeletedElements(),
                  prevState,
                  app,
                ),
                // set selectedLinearElement only if thats the only element selected
                selectedLinearElement:
                  newSelectedElements.length === 1 &&
                  isLinearElement(newSelectedElements[0])
                    ? new LinearElementEditor(
                        newSelectedElements[0],
                        app.scene.getNonDeletedElementsMap(),
                      )
                    : prevState.selectedLinearElement,
              };
            });
          }
        } else if (
          hitElement.containerRef?.elementId &&
          app.state.selectedElementIds[hitElement.containerRef?.elementId]
        ) {
          // when hitElement is part of a selected frame, deselect the frame
          // to avoid frame and containing elements selected simultaneously
          app.setState((prevState) => {
            const nextSelectedElementIds: {
              [id: string]: true;
            } = {
              ...prevState.selectedElementIds,
              [hitElement.id]: true,
            };
            // deselect the frame
            delete nextSelectedElementIds[hitElement.containerRef?.elementId!];

            // deselect groups containing the frame
            (
              app.scene.getElement(hitElement.containerRef?.elementId!)
                ?.groupIds ?? []
            )
              .flatMap((gid) =>
                getElementsInGroup(app.scene.getNonDeletedElements(), gid),
              )
              .forEach((element) => {
                delete nextSelectedElementIds[element.id];
              });

            return {
              ...selectGroupsForSelectedElements(
                {
                  editingGroupId: prevState.editingGroupId,
                  selectedElementIds: nextSelectedElementIds,
                },
                app.scene.getNonDeletedElements(),
                prevState,
                app,
              ),
              showHyperlinkPopup:
                hitElement.link || isEmbeddableElement(hitElement)
                  ? "info"
                  : false,
            };
          });
        } else {
          // add element to selection while keeping prev elements selected
          app.setState((_prevState) => ({
            selectedElementIds: makeNextSelectedElementIds(
              {
                ..._prevState.selectedElementIds,
                [hitElement!.id]: true,
              },
              _prevState,
            ),
          }));
        }
      } else {
        app.setState((prevState) => ({
          ...selectGroupsForSelectedElements(
            {
              editingGroupId: prevState.editingGroupId,
              selectedElementIds: { [hitElement.id]: true },
            },
            app.scene.getNonDeletedElements(),
            prevState,
            app,
          ),
          selectedLinearElement:
            isLinearElement(hitElement) &&
            // Don't set `selectedLinearElement` if its same as the hitElement, app is mainly to prevent resetting the `hoverPointIndex` to -1.
            // Future we should update the API to take care of setting the correct `hoverPointIndex` when initialized
            prevState.selectedLinearElement?.elementId !== hitElement.id
              ? new LinearElementEditor(
                  hitElement,
                  app.scene.getNonDeletedElementsMap(),
                )
              : prevState.selectedLinearElement,
        }));
      }
    }

    if (
      // do not clear selection if lasso is active
      app.state.activeTool.type !== "lasso" &&
      // not elbow midpoint dragged
      !(hitElement && isElbowArrow(hitElement)) &&
      // not dragged
      !pointerDownState.drag.hasOccurred &&
      // not resized
      !app.state.isResizing &&
      // only hitting the bounding box of the previous hit element
      ((hitElement &&
        hitElementBoundingBoxOnly(
          {
            point: pointFrom(
              pointerDownState.origin.x,
              pointerDownState.origin.y,
            ),
            element: hitElement,
            elementsMap,
            threshold: app.getElementHitThreshold(hitElement),
            frameNameBound: isFrameLikeElement(hitElement)
              ? app.frameNameBoundsCache.get(hitElement)
              : null,
          },
          elementsMap,
        )) ||
        (!hitElement &&
          pointerDownState.hit.hasHitCommonBoundingBoxOfSelectedElements))
    ) {
      if (app.state.selectedLinearElement?.isEditing) {
        // Exit editing mode but keep the element selected
        app.actionManager.executeAction(actionToggleLinearEditor);
      } else {
        // Deselect selected elements
        app.setState({
          selectedElementIds: makeNextSelectedElementIds({}, app.state),
          selectedGroupIds: {},
          editingGroupId: null,
          activeEmbeddable: null,
        });
      }
      // reset cursor
      app.cursor.set(CURSOR_TYPE.AUTO);
      return;
    }

    const selectedTextEditingContainer =
      app.getSelectedTextEditingContainerAtPosition(hitElement, sceneCoords);

    if (
      activeTool.type === app.state.preferredSelectionTool.type &&
      !app.state.editingTextElement &&
      !pointerDownState.drag.hasOccurred &&
      !pointerDownState.hit.wasAddedToSelection &&
      !childEvent.shiftKey &&
      !childEvent[KEYS.CTRL_OR_CMD] &&
      !childEvent.altKey &&
      childEvent.pointerType !== "touch" &&
      hitElement &&
      ((isTextElement(hitElement) &&
        app.state.selectedElementIds[hitElement.id] &&
        app.scene.getSelectedElements(app.state).length === 1) ||
        selectedTextEditingContainer)
    ) {
      app.startTextEditing({
        sceneX: sceneCoords.x,
        sceneY: sceneCoords.y,
        container: selectedTextEditingContainer,
        initialCaretSceneCoords: app.lastPointerUpIsDoubleClick
          ? undefined
          : sceneCoords,
      });
      return;
    }

    if (!app.isToolLocked() && activeTool.type !== "freedraw" && newElement) {
      app.setState((prevState) => ({
        selectedElementIds: makeNextSelectedElementIds(
          {
            ...prevState.selectedElementIds,
            [newElement.id]: true,
          },
          prevState,
        ),
        showHyperlinkPopup:
          isEmbeddableElement(newElement) && !newElement.link
            ? "editor"
            : prevState.showHyperlinkPopup,
      }));
    }

    if (
      !app.isEditingTextContent() &&
      (activeTool.type !== "selection" ||
        isSomeElementSelected(app.scene.getNonDeletedElements(), app.state) ||
        !isShallowEqual(
          app.state.previousSelectedElementIds,
          app.state.selectedElementIds,
        ))
    ) {
      app.store.scheduleCapture();
    }

    if (
      (pointerDownState.drag.hasOccurred && !app.state.selectedLinearElement) ||
      isResizing ||
      isRotating ||
      isCropping
    ) {
      // We only allow binding via linear elements, specifically via dragging
      // the endpoints ("start" or "end").
      const linearElements = app.scene
        .getSelectedElements(app.state)
        .filter(isArrowElement);

      bindOrUnbindBindingElements(linearElements, app.scene, app.state);
    }

    if (activeTool.type === "laser") {
      app.laserTrails.endPath();
      return;
    }

    if (activeTool.type === "autoshape") {
      app.actionManager.executeAction(actionFinalize);
      return;
    }

    if (
      !app.isToolLocked() &&
      activeTool.type !== "freedraw" &&
      // bucket fill stays active for back-to-back fills regardless of the
      // tool lock (paint-bucket UX)
      activeTool.type !== TOOL_TYPE.bucketfill &&
      (activeTool.type !== "lasso" ||
        // if lasso is turned on but from selection => reset to selection
        (activeTool.type === "lasso" && activeTool.fromSelection))
    ) {
      app.setState(
        {
          newElement: null,
          suggestedBinding: null,
          activeTool: updateActiveTool(app.state, {
            type: app.state.preferredSelectionTool.type,
          }),
        },
        // reset once the tool revert has settled
        () => {
          app.cursor.reset();
          app.cursor.refreshHover();
        },
      );
    } else {
      app.setState(
        {
          newElement: null,
          suggestedBinding: null,
        },
        () => app.cursor.refreshHover(),
      );
    }
  });
};

export const removePointer = (
  app: PointerApp,
  event: React.PointerEvent<HTMLElement> | PointerEvent,
) => {
  if (app.interactionState.touchTimeout) {
    app.resetContextMenuTimer();
  }

  if (event.type === "pointercancel") {
    // the browser took the pointer over (scroll, palm rejection) — no
    // pointerup will follow, so the armed bucket fill must not commit
    app.bucketFill.cancel();
    app.mindmap.cancelTouchDrag();
  }

  gestureController.removeGesturePointer(app, event.pointerId);
};

export const handleTouchMove = (
  app: PointerApp,
  event: React.TouchEvent<HTMLCanvasElement>,
) => {
  if (!app.isInteractionEnabled()) {
    return;
  }
  app.interactionState.invalidateContextMenu = true;
};
