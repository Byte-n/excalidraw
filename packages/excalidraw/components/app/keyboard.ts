import {
  CODES,
  CURSOR_TYPE,
  KEYS,
  isArrowKey,
  isSelectionLikeTool,
  getFeatureFlag,
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
} from "@excalidraw/element";
import { flushSync } from "react-dom";
import { pointFrom } from "@excalidraw/math";
import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import type {
  ExcalidrawBindableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type { AppState } from "../../types";

export type KeyboardApp = {
  state: AppState;
  viewport: { translate: (...args: any[]) => void };
  actionManager: { handleKeyDown: (event: KeyboardEvent) => boolean };
  scene: {
    getSelectedElements: (state: AppState) => any[];
    getNonDeletedElementsMap: () => Map<string, any>;
    mutateElement: (...args: any[]) => void;
    triggerUpdate: () => void;
  };
  ownerDocument: Document;
  isInteractionEnabled: () => boolean;
  setState: (state: any) => void;
  pan: { setSpaceHeld: (held: boolean) => void };
  cursor: {
    set: (cursor: string) => void;
    reset: () => void;
    applyForTool: () => void;
  };
  mindmap: { handleKeyUp: (event: KeyboardEvent) => boolean };
  bucketFill: {
    closeTemporaryEyeDropper: () => void;
  };
  arrowText: { refresh: () => void };
  flowchart: { handleKeyEvent: (event: KeyboardEvent) => void };
  lastPointerMoveEvent: PointerEvent | null;
};

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
export const onKeyUp = (app: any, event: KeyboardEvent) => {
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
      app.scene as any,
      app.state,
    );
    const elementsMap = app.scene.getNonDeletedElementsMap();
    selectedElements.filter(isSimpleArrow).forEach((element: any) => {
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
