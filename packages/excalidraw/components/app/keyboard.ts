/* eslint-disable dot-notation -- App delegates remain private. */
import {
  ARROW_TYPE,
  CODES,
  CURSOR_TYPE,
  CLASSES,
  ELEMENT_SHIFT_TRANSLATE_AMOUNT,
  ELEMENT_TRANSLATE_AMOUNT,
  KEYS,
  isArrowKey,
  isSelectionLikeTool,
  getFeatureFlag,
  isInputLike,
  isWritableElement,
  oneOf,
} from "@excalidraw/common";
import {
  bindOrUnbindBindingElements,
  calculateFixedPointForNonElbowArrowBinding,
  getHoveredElementForBinding,
  isArrowElement,
  isBindingElement,
  isSimpleArrow,
  isBindingEnabled,
  makeNextSelectedElementIds,
  LinearElementEditor,
  maybeHandleArrowPointlikeDrag,
  getContainerCenter,
  getBoundTextElement,
  isImageElement,
  isBaseShapeId,
  isTextElement,
  isValidTextContainer,
  isLineElement,
  isLinearElement,
  isElbowArrow,
  isFrameLikeElement,
  updateBoundElements,
} from "@excalidraw/element";
import { flushSync } from "react-dom";
import { pointFrom } from "@excalidraw/math";
import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import {
  isToolIcon,
  updateActiveTool,
  BIND_MODE_TIMEOUT,
  invariant,
} from "@excalidraw/common";

import {
  isLinearElementType,
  getElementBounds,
  doBoundsIntersect,
} from "@excalidraw/element";

import type {
  ExcalidrawBindableElement,
  ExcalidrawArrowElement,
  ExcalidrawLinearElement,
  ExcalidrawTextContainer,
  NonDeleted,
} from "@excalidraw/element/types";

import type { GlobalPoint } from "@excalidraw/math";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getSelectedElements, hasBackground } from "../../scene";
import {
  getConversionTypeFromElements,
  convertElementTypePopupAtom,
  convertElementTypes,
} from "../ConvertElementTypePopup";
import { editorJotaiStore } from "../../editor-jotai";
import { getShortcutFromShortcutName } from "../../actions/shortcuts";
import { t } from "../../i18n";
import { findShapeByKey } from "../Tools";
import { trackEvent } from "../../analytics";
import { actionToggleLinearEditor } from "../../actions";
import { activeConfirmDialogAtom } from "../ActiveConfirmDialog";

import { actionFinalize } from "../../actions";

import { TOGGLE_TOOLS } from "../Tools";

import type React from "react";
import type App from "../App";
import type { AppState } from "../../types";

import type { ToolType } from "../../types";

export const toggleLock = (app: App, source: "keyboard" | "ui" = "ui") => {
  if (app.props.activeTool) {
    return;
  }
  if (!app.state.activeTool.locked) {
    trackEvent(
      "toolbar",
      "toggleLock",
      `${source} (${
        app.editorInterface.formFactor === "phone" ? "mobile" : "desktop"
      })`,
    );
  }
  app.setState((prevState) => ({
    activeTool: {
      ...prevState.activeTool,
      ...updateActiveTool(
        app.state,
        prevState.activeTool.locked
          ? { type: app.state.preferredSelectionTool.type }
          : prevState.activeTool,
      ),
      locked: !prevState.activeTool.locked,
    },
  }));
};

export type KeyboardApp = App;

export const maybeHandlePageScrollKeyDown = (
  app: Pick<KeyboardApp, "state" | "viewport">,
  event: KeyboardEvent | React.KeyboardEvent,
): boolean => {
  if (event.key !== KEYS.PAGE_UP && event.key !== KEYS.PAGE_DOWN) {
    return false;
  }
  let offset =
    (event.shiftKey ? app.state.width : app.state.height) /
    app.state.zoom.value;
  if (event.key === KEYS.PAGE_DOWN) {
    offset = -offset;
  }
  if (event.shiftKey) {
    app.viewport.translate((state: AppState) => ({
      scrollX: state.scrollX + offset,
    }));
  } else {
    app.viewport.translate((state: AppState) => ({
      scrollY: state.scrollY + offset,
    }));
  }
  return true;
};

export const handleNavigationModeKeyDown = (
  app: KeyboardApp,
  event: KeyboardEvent,
) => {
  if (maybeHandlePageScrollKeyDown(app, event)) {
    event.preventDefault();
    return;
  }
  app.actionManager.handleKeyDown(event);
};

export const preventBrowserZoomKeyDown = (event: KeyboardEvent) => {
  if (
    event[KEYS.CTRL_OR_CMD] &&
    (event.code === CODES.EQUAL ||
      event.code === CODES.MINUS ||
      event.code === CODES.ZERO ||
      event.code === CODES.NUM_ADD ||
      event.code === CODES.NUM_SUBTRACT ||
      event.code === CODES.NUM_ZERO)
  ) {
    event.preventDefault();
  }
};

/** Releases transient keyboard state and finalizes arrow bindings. */
export const onKeyUp = (app: KeyboardApp, event: KeyboardEvent) => {
  if (app.mindmap.handleKeyUp(event) || !app.isInteractionEnabled()) {
    return;
  }
  if (event.key === KEYS.SPACE) {
    if (
      (app.state.viewModeEnabled && app.state.activeTool.type !== "laser") ||
      app.state.openDialog?.name === "elementLinkSelector"
    ) {
      app.cursor.set(CURSOR_TYPE.GRAB);
    } else if (isSelectionLikeTool(app.state.activeTool.type)) {
      app.cursor.reset();
    } else {
      app.cursor.applyForTool();
      app.setState({
        selectedElementIds: makeNextSelectedElementIds({}, app.state),
        selectedGroupIds: {},
        editingGroupId: null,
        activeEmbeddable: null,
      });
    }
    app.pan.setSpaceHeld(false);
  }

  if (event.key === KEYS.ALT) {
    app.bucketFill.closeTemporaryEyeDropper();
    maybeHandleArrowPointlikeDrag({ app, event });
  }

  if (
    (event.key === KEYS.ALT && app.state.bindMode === "skip") ||
    (!event[KEYS.CTRL_OR_CMD] && !isBindingEnabled(app.state))
  ) {
    app.setState({ bindMode: "orbit" });
    if (app.lastPointerMoveEvent && getFeatureFlag("COMPLEX_BINDINGS")) {
      const scenePointer = viewportCoordsToSceneCoords(
        {
          clientX: app.lastPointerMoveEvent.clientX,
          clientY: app.lastPointerMoveEvent.clientY,
        },
        app.state,
      );
      const hoveredElement = getHoveredElementForBinding(
        pointFrom(scenePointer.x, scenePointer.y),
        app.scene.getNonDeletedElements(),
        app.scene.getNonDeletedElementsMap(),
      );
      if (app.state.selectedLinearElement) {
        const element = LinearElementEditor.getElement(
          app.state.selectedLinearElement.elementId,
          app.scene.getNonDeletedElementsMap(),
        );
        if (isBindingElement(element)) {
          app.handleDelayedBindModeChange(element, hoveredElement);
        }
      }
    }
  }

  if (!event[KEYS.CTRL_OR_CMD]) {
    const preferenceEnabled = app.state.bindingPreference === "enabled";
    if (app.state.isBindingEnabled !== preferenceEnabled) {
      flushSync(() => {
        app.setState({ isBindingEnabled: preferenceEnabled });
      });
      app.arrowText.refresh();
    }
    maybeHandleArrowPointlikeDrag({ app, event });
  }

  if (isArrowKey(event.key)) {
    const selectedElements = app.scene.getSelectedElements(app.state);
    bindOrUnbindBindingElements(
      selectedElements.filter(isArrowElement),
      app.scene,
      app.state,
    );
    const elementsMap = app.scene.getNonDeletedElementsMap();
    selectedElements.filter(isSimpleArrow).forEach((element) => {
      if (element.startBinding) {
        app.scene.mutateElement(element, {
          startBinding: {
            ...element.startBinding,
            ...calculateFixedPointForNonElbowArrowBinding(
              element,
              elementsMap.get(
                element.startBinding.elementId,
              ) as NonDeleted<ExcalidrawBindableElement>,
              "start",
              elementsMap,
            ),
          },
        });
      }
      if (element.endBinding) {
        app.scene.mutateElement(element, {
          endBinding: {
            ...element.endBinding,
            ...calculateFixedPointForNonElbowArrowBinding(
              element,
              elementsMap.get(
                element.endBinding.elementId,
              ) as NonDeleted<ExcalidrawBindableElement>,
              "end",
              elementsMap,
            ),
          },
        });
      }
    });
    app.setState({ suggestedBinding: null });
  }
  app.flowchart.handleKeyEvent(event);
};

export const onKeyDown = (
  app: App,
  event: React.KeyboardEvent | KeyboardEvent,
) => {
  if (!app.isInteractionEnabled()) {
    return;
  }

  if (
    ("isComposing" in event && event.isComposing) ||
    ("nativeEvent" in event && event.nativeEvent.isComposing) ||
    event.key === "Process"
  ) {
    return;
  }

  if (
    app.state.tableCellSelection &&
    !isInputLike(event.target) &&
    !app.state.editingTextElement &&
    !event[KEYS.CTRL_OR_CMD] &&
    !event.altKey
  ) {
    if (event.key === KEYS.ENTER && app.editSelectedTableCellBackgroundText()) {
      event.preventDefault();
      return;
    }
    if (event.key === KEYS.ESCAPE) {
      const tableId = app.state.tableCellSelection.tableId;
      app.setState({
        tableCellSelection: null,
        selectedElementIds: { [tableId]: true },
      });
      event.preventDefault();
      return;
    }
  }

  if (
    !isInputLike(event.target) &&
    !event[KEYS.CTRL_OR_CMD] &&
    !event.altKey &&
    (event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight") &&
    app.moveTableCellSelectionFocus(event.key, event.shiftKey)
  ) {
    event.preventDefault();
    return;
  }

  // normalize `event.key` when CapsLock is pressed #2372

  if (
    "Proxy" in app.ownerWindow &&
    ((!event.shiftKey && /^[A-Z]$/.test(event.key)) ||
      (event.shiftKey && /^[a-z]$/.test(event.key)))
  ) {
    event = new Proxy(event, {
      get(ev, prop) {
        const value = Reflect.get(ev, prop);
        if (typeof value === "function") {
          // fix for Proxies hijacking `this`
          return value.bind(ev);
        }
        return prop === "key"
          ? // CapsLock inverts capitalization based on ShiftKey, so invert
            // it back
            event.shiftKey
            ? ev.key.toUpperCase()
            : ev.key.toLowerCase()
          : value;
      },
    });
  }

  if (!isInputLike(event.target)) {
    if (
      (event.key === KEYS.ESCAPE || event.key === KEYS.ENTER) &&
      app.state.croppingElementId
    ) {
      app.finishImageCropping();
      return;
    }

    const selectedElements = getSelectedElements(
      app.scene.getNonDeletedElementsMap(),
      app.state,
    );

    if (
      selectedElements.length === 1 &&
      isImageElement(selectedElements[0]) &&
      event.key === KEYS.ENTER
    ) {
      app.startImageCropping(selectedElements[0]);
      return;
    }

    // Shape switching
    if (event.key === KEYS.ESCAPE) {
      app.updateEditorAtom(convertElementTypePopupAtom, null);
    } else if (
      event.key === KEYS.TAB &&
      (app.ownerDocument.activeElement ===
        app.excalidrawContainerRef?.current ||
        app.ownerDocument.activeElement?.classList.contains(
          CLASSES.CONVERT_ELEMENT_TYPE_POPUP,
        ))
    ) {
      event.preventDefault();

      const conversionType = getConversionTypeFromElements(selectedElements);

      if (editorJotaiStore.get(convertElementTypePopupAtom)?.type === "panel") {
        if (
          convertElementTypes(app, {
            conversionType,
            direction: event.shiftKey ? "left" : "right",
          })
        ) {
          app.store.scheduleCapture();
        }
      }
      if (conversionType) {
        app.updateEditorAtom(convertElementTypePopupAtom, {
          type: "panel",
        });
      }
    }

    if (app.flowchart.handleKeyEvent(event)) {
      return;
    }
  }

  if (
    event[KEYS.CTRL_OR_CMD] &&
    event.key === KEYS.P &&
    !event.shiftKey &&
    !event.altKey
  ) {
    app.setToast({
      message: t("commandPalette.shortcutHint", {
        shortcut: getShortcutFromShortcutName("commandPalette"),
      }),
    });
    event.preventDefault();
    return;
  }

  if (event[KEYS.CTRL_OR_CMD] && event.key.toLowerCase() === KEYS.V) {
    app.interactionState.isPlainPaste = event.shiftKey;
    app.ownerWindow.clearTimeout(app.interactionState.plainPasteTimer);
    // reset (100ms to be safe that we it runs after the ensuing
    // paste event). Though, technically unnecessary to reset since we
    // (re)set the flag before each paste event.
    app.interactionState.plainPasteTimer = app.ownerWindow.setTimeout(() => {
      app.interactionState.isPlainPaste = false;
    }, 100);
  }

  // prevent browser zoom in input fields
  if (event[KEYS.CTRL_OR_CMD] && isWritableElement(event.target)) {
    if (event.code === CODES.MINUS || event.code === CODES.EQUAL) {
      event.preventDefault();
      return;
    }
  }

  // bail if
  if (
    // inside an input
    (isWritableElement(event.target) &&
      // unless pressing escape (finalize action)
      event.key !== KEYS.ESCAPE) ||
    // or unless using arrows (to move between buttons)
    (isArrowKey(event.key) && isInputLike(event.target))
  ) {
    return;
  }

  if (event.key === KEYS.QUESTION_MARK) {
    app.setState({
      openDialog: { name: "help" },
    });
    return;
  } else if (
    event.key.toLowerCase() === KEYS.E &&
    event.shiftKey &&
    event[KEYS.CTRL_OR_CMD]
  ) {
    event.preventDefault();
    app.setState({ openDialog: { name: "imageExport" } });
    return;
  }

  if (app.maybeHandlePageScrollKeyDown(event)) {
    // Page navigation belongs to the canvas even when a pending locked
    // viewport transition is temporarily withholding the mutation.
    event.preventDefault();
    return;
  }

  if (app.state.openDialog?.name === "elementLinkSelector") {
    return;
  }

  if (app.mindmap.handleKeyEvent(event)) {
    return;
  }

  // Handle Alt key for bind mode
  if (event.key === KEYS.ALT) {
    if (app.state.activeTool.type === "bucketfill") {
      app.bucketFill.openTemporaryEyeDropper();
      event.preventDefault();
      return;
    } else if (getFeatureFlag("COMPLEX_BINDINGS")) {
      app.handleSkipBindMode();
    } else {
      maybeHandleArrowPointlikeDrag({ app, event });
    }
  }

  if (app.actionManager.handleKeyDown(event)) {
    return;
  }

  // view mode hardcoded from upstream -> disable tool switching for now
  const shouldPreventToolSwitching = app.props.viewModeEnabled === true;

  if (
    !shouldPreventToolSwitching &&
    app.state.viewModeEnabled &&
    event.key === KEYS.ESCAPE
  ) {
    app.setActiveTool({ type: "selection" });
    return;
  }

  if (
    !shouldPreventToolSwitching &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !app.state.newElement &&
    !app.state.selectionElement &&
    !app.state.selectedElementsAreBeingDragged
  ) {
    const shape = findShapeByKey(event.key, app, event.shiftKey);

    if (app.state.viewModeEnabled && !oneOf(shape, ["laser", "hand"])) {
      return;
    }

    if (shape) {
      if (app.state.activeTool.type !== shape) {
        trackEvent(
          "toolbar",
          shape,
          `keyboard (${
            app.editorInterface.formFactor === "phone" ? "mobile" : "desktop"
          })`,
        );
      }
      if (shape === "arrow" && app.state.activeTool.type === "arrow") {
        const nextArrowType =
          app.state.currentItemArrowType === ARROW_TYPE.sharp
            ? ARROW_TYPE.round
            : app.state.currentItemArrowType === ARROW_TYPE.round
            ? ARROW_TYPE.elbow
            : ARROW_TYPE.sharp;
        app.setState({ currentItemArrowType: nextArrowType });
        app.cursorHints.onArrowTypeCycled(nextArrowType);
      } else if (shape === "arrow" || shape === "line") {
        app.cursorHints.onToolShortcut(
          shape,
          /^\d$/.test(event.key) ? "digit" : "letter",
        );
      }

      if (
        shape === "bucketfill" &&
        app.state.activeTool.type === "bucketfill"
      ) {
        app.bucketFill.cycleBackgroundColor();
      } else if (shape === "lasso" && app.state.activeTool.type === "laser") {
        app.setActiveTool({
          type: app.state.preferredSelectionTool.type,
        });
      } else {
        app.setActiveTool({ type: shape }, { toggle: true });
      }

      event.stopPropagation();

      return;
    } else if (event.key === KEYS.Q) {
      app.toggleLock("keyboard");
      event.stopPropagation();
      return;
    }
  }

  if (app.state.viewModeEnabled) {
    return;
  }

  if (event[KEYS.CTRL_OR_CMD] && !event.repeat) {
    if (getFeatureFlag("COMPLEX_BINDINGS")) {
      app.resetDelayedBindMode();
    }

    flushSync(() => {
      app.setState({
        isBindingEnabled: app.state.bindingPreference !== "enabled",
      });
    });

    // the toggle changes what a text-tool click at the current position
    // would do, with no pointermove to refresh the affordance
    app.arrowText.refresh();

    maybeHandleArrowPointlikeDrag({ app, event });
  }

  if (isArrowKey(event.key)) {
    let selectedElements = app.scene.getSelectedElements({
      selectedElementIds: app.state.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });

    const arrowIdsToRemove = new Set<string>();

    selectedElements
      .filter((el): el is NonDeleted<ExcalidrawArrowElement> =>
        isBindingElement(el),
      )
      .filter((arrow) => {
        const startElementNotInSelection =
          arrow.startBinding &&
          !selectedElements.some(
            (el) => el.id === arrow.startBinding?.elementId,
          );
        const endElementNotInSelection =
          arrow.endBinding &&
          !selectedElements.some((el) => el.id === arrow.endBinding?.elementId);
        return startElementNotInSelection || endElementNotInSelection;
      })
      .forEach((arrow) => arrowIdsToRemove.add(arrow.id));

    selectedElements = selectedElements.filter(
      (el) => !arrowIdsToRemove.has(el.id),
    );

    const step =
      (app.getEffectiveGridSize() &&
        (event.shiftKey
          ? ELEMENT_TRANSLATE_AMOUNT
          : app.getEffectiveGridSize())) ||
      (event.shiftKey
        ? ELEMENT_SHIFT_TRANSLATE_AMOUNT
        : ELEMENT_TRANSLATE_AMOUNT);

    let offsetX = 0;
    let offsetY = 0;

    if (event.key === KEYS.ARROW_LEFT) {
      offsetX = -step;
    } else if (event.key === KEYS.ARROW_RIGHT) {
      offsetX = step;
    } else if (event.key === KEYS.ARROW_UP) {
      offsetY = -step;
    } else if (event.key === KEYS.ARROW_DOWN) {
      offsetY = step;
    }

    selectedElements.forEach((element) => {
      app.scene.mutateElement(
        element,
        {
          x: element.x + offsetX,
          y: element.y + offsetY,
        },
        { informMutation: false, isDragging: false },
      );

      updateBoundElements(element, app.scene, {
        simultaneouslyUpdated: selectedElements,
      });
    });

    app.scene.triggerUpdate();

    event.preventDefault();
  } else if (event.key === KEYS.ENTER) {
    const selectedElements = app.scene.getSelectedElements(app.state);
    if (selectedElements.length === 1) {
      const selectedElement = selectedElements[0];
      if (event[KEYS.CTRL_OR_CMD] || isLineElement(selectedElement)) {
        if (isLinearElement(selectedElement)) {
          if (
            !app.state.selectedLinearElement?.isEditing ||
            app.state.selectedLinearElement.elementId !== selectedElement.id
          ) {
            app.store.scheduleCapture();
            if (!isElbowArrow(selectedElement)) {
              app.actionManager.executeAction(actionToggleLinearEditor);
            }
          }
        }
      } else if (
        isTextElement(selectedElement) ||
        isValidTextContainer(selectedElement)
      ) {
        let container;
        if (!isTextElement(selectedElement)) {
          container = selectedElement as ExcalidrawTextContainer;
        }
        const midPoint = getContainerCenter(
          selectedElement,
          app.scene.getNonDeletedElementsMap(),
        );
        const sceneX = midPoint.x;
        const sceneY = midPoint.y;
        app.startTextEditing({
          sceneX,
          sceneY,
          container,
        });
        event.preventDefault();
        return;
      } else if (isFrameLikeElement(selectedElement)) {
        app.setState({
          editingFrame: selectedElement.id,
        });
      }
    }
  }

  if (event.key === KEYS.SPACE && app.gesture.pointers.size === 0) {
    app.pan.setSpaceHeld(true);
    app.cursor.set(CURSOR_TYPE.GRAB);
    event.preventDefault();
  }

  if (
    (event.key === KEYS.G || event.key === KEYS.S) &&
    !event.altKey &&
    !event[KEYS.CTRL_OR_CMD]
  ) {
    const selectedElements = app.scene.getSelectedElements(app.state);
    if (app.state.activeTool.type === "selection" && !selectedElements.length) {
      return;
    }

    if (
      event.key === KEYS.G &&
      (hasBackground(
        app.state.activeTool.type === "rectangle" &&
          isBaseShapeId(app.state.preferredGenericShape)
          ? app.state.preferredGenericShape
          : app.state.activeTool.type,
      ) ||
        selectedElements.some((element) => hasBackground(element)))
    ) {
      app.setState({ openPopup: "elementBackground" });
      event.stopPropagation();
    }
    if (event.key === KEYS.S) {
      app.setState({ openPopup: "elementStroke" });
      event.stopPropagation();
    }
  }

  if (
    !event[KEYS.CTRL_OR_CMD] &&
    event.shiftKey &&
    event.key.toLowerCase() === KEYS.F
  ) {
    const selectedElements = app.scene.getSelectedElements(app.state);

    if (app.state.activeTool.type === "selection" && !selectedElements.length) {
      return;
    }

    if (
      app.state.activeTool.type === "text" ||
      selectedElements.find(
        (element) =>
          isTextElement(element) ||
          getBoundTextElement(element, app.scene.getNonDeletedElementsMap()),
      )
    ) {
      event.preventDefault();
      app.setState({ openPopup: "fontFamily" });
    }
  }

  if (
    event[KEYS.CTRL_OR_CMD] &&
    (event.key === KEYS.BACKSPACE || event.key === KEYS.DELETE)
  ) {
    app.updateEditorAtom(activeConfirmDialogAtom, "clearCanvas");
  }

  // eye dropper
  // -----------------------------------------------------------------------
  const lowerCased = event.key.toLocaleLowerCase();
  const isPickingStroke =
    lowerCased === KEYS.S && event.shiftKey && !event[KEYS.CTRL_OR_CMD];
  const isPickingBackground =
    event.key === KEYS.I || (lowerCased === KEYS.G && event.shiftKey);

  if (isPickingStroke || isPickingBackground) {
    app.openEyeDropper({
      type: isPickingStroke ? "stroke" : "background",
    });
  }
  // -----------------------------------------------------------------------
};

export const handleSkipBindMode = (app: App) => {
  if (
    app.state.selectedLinearElement?.initialState &&
    !app.state.selectedLinearElement.initialState.arrowStartIsInside
  ) {
    invariant(
      app.lastPointerMoveCoords,
      "Missing last pointer move coords when changing bind skip mode for arrow start",
    );
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const hoveredElement = getHoveredElementForBinding(
      pointFrom<GlobalPoint>(
        app.lastPointerMoveCoords.x,
        app.lastPointerMoveCoords.y,
      ),
      app.scene.getNonDeletedElements(),
      elementsMap,
    );
    const element = LinearElementEditor.getElement(
      app.state.selectedLinearElement.elementId,
      elementsMap,
    );

    if (
      element?.startBinding &&
      hoveredElement?.id === element.startBinding.elementId
    ) {
      app.setState({
        selectedLinearElement: {
          ...app.state.selectedLinearElement,
          initialState: {
            ...app.state.selectedLinearElement.initialState,
            arrowStartIsInside: true,
          },
        },
      });
    }
  }

  if (app.state.bindMode === "orbit") {
    if (app.bindModeHandler) {
      clearTimeout(app.bindModeHandler);
      app.bindModeHandler = null;
    }

    // PERF: It's okay since it's a single trigger from a key handler
    // or single call from pointer move handler because the bindMode check
    // will not pass the second time
    flushSync(() => {
      app.setState({
        bindMode: "skip",
      });
    });

    if (
      app.lastPointerMoveCoords &&
      app.state.selectedLinearElement?.selectedPointsIndices &&
      app.state.selectedLinearElement?.selectedPointsIndices.length
    ) {
      const { x, y } = app.lastPointerMoveCoords;
      const event =
        app.lastPointerMoveEvent ?? app.lastPointerDownEvent?.nativeEvent;
      invariant(event, "Last event must exist");
      const deltaX = x - app.state.selectedLinearElement.pointerOffset.x;
      const deltaY = y - app.state.selectedLinearElement.pointerOffset.y;
      const newState = app.state.multiElement
        ? LinearElementEditor.handlePointerMove(
            event,
            app,
            deltaX,
            deltaY,
            app.state.selectedLinearElement,
          )
        : LinearElementEditor.handlePointDragging(
            event,
            app,
            deltaX,
            deltaY,
            app.state.selectedLinearElement,
          );
      if (newState) {
        app.setState(newState);
      }
    }
  }
};

export const resetDelayedBindMode = (app: App) => {
  if (app.bindModeHandler) {
    clearTimeout(app.bindModeHandler);
    app.bindModeHandler = null;
  }

  if (app.state.bindMode !== "orbit") {
    // We need this iteration to complete binding and change
    // back to orbit mode after that
    setTimeout(() =>
      app.setState({
        bindMode: "orbit",
      }),
    );
  }
};

export const handleDelayedBindModeChange = (
  app: App,
  arrow: ExcalidrawLinearElement,
  hoveredElement: NonDeletedExcalidrawElement | null,
) => {
  if (arrow.isDeleted || isElbowArrow(arrow)) {
    return;
  }

  const effector = () => {
    app.bindModeHandler = null;

    invariant(
      app.lastPointerMoveCoords,
      "Expected lastPointerMoveCoords to be set",
    );

    if (!app.state.multiElement) {
      if (
        !app.state.selectedLinearElement ||
        !app.state.selectedLinearElement.selectedPointsIndices ||
        !app.state.selectedLinearElement.selectedPointsIndices.length
      ) {
        return;
      }

      const startDragged =
        app.state.selectedLinearElement.selectedPointsIndices.includes(0);
      const endDragged =
        app.state.selectedLinearElement.selectedPointsIndices.includes(
          arrow.points.length - 1,
        );

      // Check if the whole arrow is dragged by selecting all endpoints
      if ((!startDragged && !endDragged) || (startDragged && endDragged)) {
        return;
      }
    }

    const { x, y } = app.lastPointerMoveCoords;
    const hoveredElement = getHoveredElementForBinding(
      pointFrom<GlobalPoint>(x, y),
      app.scene.getNonDeletedElements(),
      app.scene.getNonDeletedElementsMap(),
    );

    if (hoveredElement && app.state.bindMode !== "skip") {
      invariant(
        app.state.selectedLinearElement?.elementId === arrow.id,
        "The selectedLinearElement is expected to not change while a bind mode timeout is ticking",
      );

      // Once the start is set to inside binding, it remains so
      const arrowStartIsInside =
        app.state.selectedLinearElement.initialState.arrowStartIsInside ||
        arrow.startBinding?.elementId === hoveredElement.id;

      // Change the global binding mode
      flushSync(() => {
        invariant(
          app.state.selectedLinearElement,
          "this.state.selectedLinearElement must exist",
        );

        app.setState({
          bindMode: "inside",
          selectedLinearElement: {
            ...app.state.selectedLinearElement,
            initialState: {
              ...app.state.selectedLinearElement.initialState,
              arrowStartIsInside,
            },
          },
        });
      });

      const event =
        app.lastPointerMoveEvent ?? app.lastPointerDownEvent?.nativeEvent;
      invariant(event, "Last event must exist");
      const deltaX = x - app.state.selectedLinearElement.pointerOffset.x;
      const deltaY = y - app.state.selectedLinearElement.pointerOffset.y;
      const newState = app.state.multiElement
        ? LinearElementEditor.handlePointerMove(
            event,
            app,
            deltaX,
            deltaY,
            app.state.selectedLinearElement,
          )
        : LinearElementEditor.handlePointDragging(
            event,
            app,
            deltaX,
            deltaY,
            app.state.selectedLinearElement,
          );
      if (newState) {
        app.setState(newState);
      }
    }
  };

  let isOverlapping = false;
  if (app.state.selectedLinearElement?.selectedPointsIndices) {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const startDragged =
      app.state.selectedLinearElement.selectedPointsIndices.includes(0);
    const endDragged =
      app.state.selectedLinearElement.selectedPointsIndices.includes(
        arrow.points.length - 1,
      );
    const startElement = startDragged
      ? hoveredElement
      : arrow.startBinding && elementsMap.get(arrow.startBinding.elementId);
    const endElement = endDragged
      ? hoveredElement
      : arrow.endBinding && elementsMap.get(arrow.endBinding.elementId);
    const startBounds =
      startElement && getElementBounds(startElement, elementsMap);
    const endBounds = endElement && getElementBounds(endElement, elementsMap);
    isOverlapping = !!(
      startBounds &&
      endBounds &&
      startElement.id !== endElement.id &&
      doBoundsIntersect(startBounds, endBounds)
    );
  }

  const startDragged =
    app.state.selectedLinearElement?.selectedPointsIndices?.includes(0);
  const endDragged =
    app.state.selectedLinearElement?.selectedPointsIndices?.includes(
      arrow.points.length - 1,
    );
  const currentBinding = startDragged
    ? "startBinding"
    : endDragged
    ? "endBinding"
    : null;
  const otherBinding = startDragged
    ? "endBinding"
    : endDragged
    ? "startBinding"
    : null;
  const isAlreadyInsideBindingToSameElement =
    (otherBinding &&
      arrow[otherBinding]?.mode === "inside" &&
      arrow[otherBinding]?.elementId === hoveredElement?.id) ||
    (currentBinding &&
      arrow[currentBinding]?.mode === "inside" &&
      hoveredElement?.id === arrow[currentBinding]?.elementId);

  if (
    currentBinding &&
    otherBinding &&
    arrow[currentBinding]?.mode === "inside" &&
    hoveredElement?.id !== arrow[currentBinding]?.elementId &&
    arrow[otherBinding]?.elementId !== arrow[currentBinding]?.elementId
  ) {
    // Update binding out of place to orbit mode
    app.scene.mutateElement(
      arrow,
      {
        [currentBinding]: {
          ...arrow[currentBinding],
          mode: "orbit",
        },
      },
      {
        informMutation: false,
        isDragging: true,
      },
    );
  }

  if (
    !hoveredElement ||
    (app["previousHoveredBindableElement"] &&
      hoveredElement.id !== app["previousHoveredBindableElement"].id)
  ) {
    // Clear the timeout if we're not hovering a bindable
    if (app.bindModeHandler) {
      clearTimeout(app.bindModeHandler);
      app.bindModeHandler = null;
    }

    // Clear the inside binding mode too
    if (app.state.bindMode === "inside") {
      flushSync(() => {
        app.setState({
          bindMode: "orbit",
        });
      });
    }

    app["previousHoveredBindableElement"] = null;
  } else if (
    !app.bindModeHandler &&
    (!app.state.newElement || !arrow.startBinding || isOverlapping) &&
    !isAlreadyInsideBindingToSameElement
  ) {
    // We are hovering a bindable element
    app.bindModeHandler = setTimeout(effector, BIND_MODE_TIMEOUT);
  }

  app["previousHoveredBindableElement"] = hoveredElement;
};

export const setActiveTool = (
  app: App,
  tool: ({ type: ToolType } | { type: "custom"; customType: string }) & {
    locked?: boolean;
    fromSelection?: boolean;
  },
  opts: {
    keepSelection?: boolean;
    /**
     * When `true`, re-activating an already-active toggle tool (see
     * `TOGGLE_TOOLS`) switches back to the previously active tool.
     * Activation is idempotent by default; toggle tools always record the
     * previously active tool regardless (so ESC and the next `toggle`
     * activation can switch back to it).
     */
    toggle?: boolean;
  } = {},
) => {
  const { keepSelection = false } = opts;

  if (!app.isToolSupported(tool.type)) {
    console.warn(
      app.isInteractionEnabled()
        ? `"${tool.type}" tool is disabled via "UIOptions.canvasActions.tools.${tool.type}"`
        : `"${tool.type}" tool cannot be activated while the editor is non-interactive (see "interaction.enabled.tools")`,
    );
    return;
  }

  if (
    app.props.activeTool &&
    !app["isSameForcedTool"](app.props.activeTool, tool)
  ) {
    console.warn(
      `"${tool.type}" tool activation ignored — the active tool is controlled by the host via "props.activeTool"`,
    );
    return;
  }

  if (app.drawShape.hasPendingGesture()) {
    // switching tools mid-sketch (e.g. paste resets to the selection tool)
    // must not strand the gesture — commit it through the finalize funnel
    // while the drawShape tool is still active
    app.actionManager.executeAction(actionFinalize);
  }

  const isToggleTool = TOGGLE_TOOLS.includes(tool.type);
  const toggle = opts.toggle === true && isToggleTool;

  const nextActiveTool =
    toggle && app.state.activeTool.type === tool.type
      ? // toggle back to the tool that was active before this one
        updateActiveTool(app.state, {
          ...(app.state.activeTool.lastActiveTool || {
            type: app.state.preferredSelectionTool.type,
          }),
          lastActiveTool: null,
        })
      : isToggleTool && app.state.activeTool.type !== tool.type
      ? // activating a toggle tool records the currently active tool so
        // ESC and the next `toggle` activation can switch back to it
        updateActiveTool(app.state, {
          ...tool,
          lastActiveTool: app.state.activeTool,
        })
      : updateActiveTool(app.state, tool);
  if (nextActiveTool.type !== app.state.activeTool.type) {
    if (app.interactionState.isTableGestureActive) {
      app.maybeCleanupAfterMissingPointerUp(null);
    }
    app.mindmap.cancelDrag();
  }
  if (nextActiveTool.type !== "mindmap") {
    app.mindmap.clearHover();
  }
  if (nextActiveTool.type === "hand") {
    app.cursor.set(CURSOR_TYPE.GRAB);
  } else if (!app.pan.isSpaceHeld()) {
    app.cursor.applyForTool(nextActiveTool);
  }
  if (isToolIcon(app.ownerDocument.activeElement)) {
    app.focusContainer();
  }
  if (!isLinearElementType(nextActiveTool.type)) {
    app.setState({ suggestedBinding: null });
  }
  if (nextActiveTool.type === "image") {
    app["onImageToolbarButtonClick"]();
  }

  app.setState((prevState) => {
    const commonResets = {
      snapLines: prevState.snapLines.length ? [] : prevState.snapLines,
      originSnapOffset: null,
      activeEmbeddable: null,
      selectedLinearElement: isSelectionLikeTool(nextActiveTool.type)
        ? prevState.selectedLinearElement
        : null,
      frameToHighlight: null,
      // only the text tool offers arrow-endpoint binding, and the highlight
      // is refreshed on pointermove — don't leave a stale one behind
      hoveredArrowTextAnchor: null,
      ...(nextActiveTool.type !== "mindmap" &&
      Object.keys(prevState.hoveredElementIds).length
        ? { hoveredElementIds: {} }
        : {}),
    } as const;

    if (nextActiveTool.type === "freedraw") {
      app.store.scheduleCapture();
    }

    if (nextActiveTool.type === "lasso") {
      return {
        ...prevState,
        ...commonResets,
        activeTool: nextActiveTool,
        ...(keepSelection
          ? {}
          : {
              selectedElementIds: makeNextSelectedElementIds({}, prevState),
              selectedGroupIds: makeNextSelectedElementIds({}, prevState),
              editingGroupId: null,
              multiElement: null,
            }),
      };
    } else if (nextActiveTool.type !== "selection") {
      return {
        ...prevState,
        ...commonResets,
        activeTool: nextActiveTool,
        selectedElementIds: makeNextSelectedElementIds({}, prevState),
        selectedGroupIds: makeNextSelectedElementIds({}, prevState),
        editingGroupId: null,
        multiElement: null,
      };
    }
    return {
      ...prevState,
      ...commonResets,
      activeTool: nextActiveTool,
    };
  });
};
