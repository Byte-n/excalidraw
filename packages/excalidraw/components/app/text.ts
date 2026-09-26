import {
  getActiveTextElement,
  getBoundTextElement,
  isTextElement,
  isValidTextContainer,
} from "@excalidraw/element";

import { flushSync } from "react-dom";
import {
  getContainerElement,
  getStickyNoteLayout,
  isNonDeletedElement,
  isStickyNoteElement,
  newElementWith,
  refreshTextDimensions,
  updateBoundElements,
  fixBindingsAfterDeletion,
} from "@excalidraw/element";
import { makeNextSelectedElementIds } from "@excalidraw/element";
import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { EditorInterface } from "@excalidraw/common";
import type {
  ExcalidrawElement,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { actionTextAutoResize } from "../../actions/actionTextAutoResize";
import { isPointHittingTextAutoResizeHandle } from "../../textAutoResizeHandle";

import { textWysiwyg } from "../../wysiwyg/textWysiwyg";
import { withBatchedUpdates } from "../../reactUtils";

import type { AppState } from "../../types";

export const handleTextWysiwyg = (
  app: any,
  element: NonDeleted<ExcalidrawTextElement>,
  {
    isExistingElement = false,
    initialCaretSceneCoords = null,
  }: {
    isExistingElement?: boolean;
    initialCaretSceneCoords?: { x: number; y: number } | null;
  },
) => {
  const elementsMap = app.scene.getElementsMapIncludingDeleted();

  const updateElement = (nextOriginalText: string, isDeleted: boolean) => {
    const latestTextElement = app.scene.getElement(
      element.id,
    ) as ExcalidrawTextElement | null;
    if (!latestTextElement || !isTextElement(latestTextElement)) {
      return;
    }
    const container = getContainerElement(latestTextElement, elementsMap);
    const stickyContainer =
      container && isStickyNoteElement(container) ? container : null;
    const stickyLayout = stickyContainer
      ? getStickyNoteLayout(stickyContainer, latestTextElement, {
          originalText: nextOriginalText,
        })
      : null;

    app.scene.replaceAllElements([
      ...app.scene.getElementsIncludingDeleted().map((_element: any) => {
        if (
          stickyLayout &&
          _element.id === stickyContainer?.id &&
          isStickyNoteElement(_element)
        ) {
          return newElementWith(_element, stickyLayout.container);
        }
        if (_element.id === latestTextElement.id && isTextElement(_element)) {
          return newElementWith(_element, {
            originalText: nextOriginalText,
            isDeleted: isDeleted ?? _element.isDeleted,
            ...(stickyLayout?.text ??
              refreshTextDimensions(
                _element,
                getContainerElement(_element, elementsMap),
                elementsMap,
                nextOriginalText,
              )),
          });
        }
        return _element;
      }),
    ]);

    if (stickyContainer) {
      const latestContainer = app.scene.getNonDeletedElement(
        stickyContainer.id,
      );
      if (latestContainer) {
        updateBoundElements(latestContainer, app.scene);
      }
    }
  };

  app.textWysiwygSubmitHandler = textWysiwyg({
    canvas: app.canvas,
    getViewportCoords: (x: number, y: number) => {
      const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
        { sceneX: x, sceneY: y },
        app.state,
      );
      return [
        viewportX - app.state.offsetLeft,
        viewportY - app.state.offsetTop,
      ];
    },
    onChange: withBatchedUpdates((nextOriginalText: string) => {
      updateElement(nextOriginalText, false);
      if (isNonDeletedElement(element)) {
        updateBoundElements(element, app.scene);
      }
    }),
    onSubmit: withBatchedUpdates(({ viaKeyboard, nextOriginalText }: any) => {
      app.textWysiwygSubmitHandler = null;
      const isDeleted = !nextOriginalText.trim();
      updateElement(nextOriginalText, isDeleted);
      const didCreateMindmapNode = app.mindmap.handleTextSubmit(element);
      const elementIdToSelect =
        viaKeyboard &&
        !app.isToolLocked() &&
        app.state.activeTool.type !== "autoshape"
          ? element.containerId || (!isDeleted ? element.id : null)
          : null;

      if (elementIdToSelect) {
        flushSync(() => {
          app.setState((prevState: AppState) => ({
            selectedElementIds: makeNextSelectedElementIds(
              {
                ...prevState.selectedElementIds,
                [elementIdToSelect]: true,
              },
              prevState,
            ),
          }));
        });
      }
      if (isDeleted) {
        fixBindingsAfterDeletion(app.scene.getNonDeletedElements(), [element]);
      }
      if (!isDeleted || isExistingElement || didCreateMindmapNode) {
        app.store.scheduleCapture();
      }
      flushSync(() => {
        app.setState({ newElement: null, editingTextElement: null });
      });
      if (app.isToolLocked() || app.state.activeTool.type === "autoshape") {
        app.cursor.applyForTool();
      }
      app.focusContainer();
    }),
    element,
    excalidrawContainer: app.excalidrawContainerRef.current,
    app,
    initialCaretSceneCoords,
    autoSelect: !app.editorInterface.isTouchScreen,
  });
  app.deselectElements();
  updateElement(element.originalText, false);
};

export type TextApp = {
  state: AppState;
  scene: {
    getSelectedElements: (state: AppState) => NonDeleted<ExcalidrawElement>[];
    getNonDeletedElementsMap: () => Map<string, NonDeleted<ExcalidrawElement>>;
  };
  editorInterface: EditorInterface;
  actionManager: {
    executeAction: (...args: any[]) => void;
  };
  cursor: { reset: () => void };
  getElementAtPosition: (...args: any[]) => NonDeletedExcalidrawElement | null;
};

export const isEditingTextContent = (app: Pick<TextApp, "state">) =>
  !!app.state.editingTextElement || isTextElement(app.state.newElement);

export const getSelectedTextElement = (
  app: TextApp,
  container?: ExcalidrawTextContainer | null,
): NonDeleted<ExcalidrawTextElement> | null => {
  const selectedElements = app.scene.getSelectedElements(app.state);
  if (selectedElements.length !== 1) {
    return null;
  }

  const selectedElement = selectedElements[0]!;
  if (isTextElement(selectedElement)) {
    return selectedElement;
  }
  if (!container) {
    return null;
  }
  return getBoundTextElement(
    selectedElement,
    app.scene.getNonDeletedElementsMap(),
  ) as NonDeleted<ExcalidrawTextElement> | null;
};

export const getTextElementAtPosition = (
  app: TextApp,
  x: number,
  y: number,
): NonDeleted<ExcalidrawTextElement> | null => {
  const element = app.getElementAtPosition(x, y, {
    includeBoundTextElement: true,
  });
  return element && isTextElement(element) && !element.isDeleted
    ? element
    : null;
};

export const getSelectedTextEditingContainerAtPosition = (
  app: TextApp,
  hitElement: NonDeletedExcalidrawElement | null,
  sceneCoords: { x: number; y: number },
): ExcalidrawTextContainer | null | undefined => {
  const selectedElements = app.scene.getSelectedElements(app.state);
  if (
    selectedElements.length !== 1 ||
    !hitElement ||
    hitElement.id !== selectedElements[0]!.id
  ) {
    return null;
  }

  const selectedElement = selectedElements[0]!;
  if (isTextElement(selectedElement)) {
    return null;
  }
  if (!isValidTextContainer(selectedElement)) {
    return undefined;
  }

  const textElement = getSelectedTextElement(app, selectedElement);
  const hitTextElement = getTextElementAtPosition(
    app,
    sceneCoords.x,
    sceneCoords.y,
  );
  return textElement && hitTextElement?.id === textElement.id
    ? selectedElement
    : undefined;
};

export const isHittingTextAutoResizeHandle = (
  app: Pick<TextApp, "state" | "editorInterface">,
  selectedElements: NonDeleted<ExcalidrawElement>[],
  point: Readonly<{ x: number; y: number }>,
): boolean => {
  const activeTextElement = getActiveTextElement(selectedElements, app.state);
  return !!(
    activeTextElement &&
    !activeTextElement.isDeleted &&
    !activeTextElement.autoResize &&
    isPointHittingTextAutoResizeHandle(
      point,
      activeTextElement,
      app.state.zoom.value,
      app.editorInterface.formFactor,
    )
  );
};

export const handleTextAutoResizeHandlePointerDown = (
  app: TextApp,
  selectedElements: NonDeleted<ExcalidrawElement>[],
  point: Readonly<{ x: number; y: number }>,
) => {
  const activeTextElement = getActiveTextElement(selectedElements, app.state);
  if (
    !activeTextElement ||
    !isHittingTextAutoResizeHandle(app, selectedElements, point)
  ) {
    return false;
  }

  app.actionManager.executeAction(
    actionTextAutoResize,
    "ui",
    activeTextElement,
  );
  app.cursor.reset();
  return true;
};
