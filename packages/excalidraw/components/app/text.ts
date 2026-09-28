import {
  getActiveTextElement,
  getBoundTextElement,
  frameLikeContainerRef,
  isTextElement,
  isValidTextContainer,
} from "@excalidraw/element";

import { flushSync } from "react-dom";
import {
  getContainerElement,
  getContainerCenter,
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
import {
  DEFAULT_VERTICAL_ALIGN,
  VERTICAL_ALIGN,
  TEXT_TO_CENTER_SNAP_THRESHOLD,
  getFontString,
  getLineHeight,
} from "@excalidraw/common";

import {
  DEFAULT_BOUND_TEXT_LABEL_POSITION,
  getApproxMinLineWidth,
  getApproxMinLineHeight,
  getLineHeightInPx,
  isArrowElement,
  newTextElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { ArrowEndpoint } from "@excalidraw/element";
import type { Radians } from "@excalidraw/math";

import { actionTextAutoResize } from "../../actions/actionTextAutoResize";
import { isPointHittingTextAutoResizeHandle } from "../../textAutoResizeHandle";

import { textWysiwyg } from "../../wysiwyg/textWysiwyg";
import { withBatchedUpdates } from "../../reactUtils";

import type App from "../App";

import type { AppState } from "../../types";

export const getTextWysiwygSnappedToCenterPosition = (
  app: App,
  x: number,
  y: number,
  appState: AppState,
  container?: ExcalidrawTextContainer | null,
) => {
  if (container) {
    let elementCenterX = container.x + container.width / 2;
    let elementCenterY = container.y + container.height / 2;
    const elementCenter = getContainerCenter(
      container,
      app.scene.getNonDeletedElementsMap(),
    );
    if (elementCenter) {
      elementCenterX = elementCenter.x;
      elementCenterY = elementCenter.y;
    }
    const distanceToCenter = Math.hypot(x - elementCenterX, y - elementCenterY);
    if (distanceToCenter < TEXT_TO_CENTER_SNAP_THRESHOLD) {
      const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
        { sceneX: elementCenterX, sceneY: elementCenterY },
        appState,
      );
      return { viewportX, viewportY, elementCenterX, elementCenterY };
    }
  }
};

export const handleTextWysiwyg = (
  app: App,
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
      ...app.scene.getElementsIncludingDeleted().map((_element) => {
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
    onSubmit: withBatchedUpdates(({ viaKeyboard, nextOriginalText }) => {
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

export type TextApp = Pick<
  App,
  | "state"
  | "scene"
  | "editorInterface"
  | "actionManager"
  | "cursor"
  | "getElementAtPosition"
>;

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

export const startTextEditing = (
  app: App,
  {
    sceneX,
    sceneY,
    insertAtParentCenter = true,
    container,
    autoEdit = true,
    initialCaretSceneCoords,
    arrowEndpoint,
  }: {
    /** X position to insert text at */
    sceneX: number;
    /** Y position to insert text at */
    sceneY: number;
    /** whether to attempt to insert at element center if applicable */
    insertAtParentCenter?: boolean;
    container?: ExcalidrawTextContainer | null;
    autoEdit?: boolean;
    initialCaretSceneCoords?: { x: number; y: number };
    /**
     * creates the text as a label for this arrow endpoint: the binding then
     * dictates the text's position and alignment, overriding (sceneX, sceneY)
     */
    arrowEndpoint?: ArrowEndpoint | null;
  },
) => {
  let shouldBindToContainer = false;

  // Resolved here rather than by the caller so that the stroke width the
  // binding gap derives from (see `getBindingGap`) is, by construction, the
  // one the text is created with below.
  const arrowEndpointBinding =
    arrowEndpoint &&
    app.arrowText.getTextBinding(
      arrowEndpoint,
      app.getCurrentItemStrokeWidth("text"),
    );

  if (arrowEndpointBinding) {
    // an arrow endpoint is not a text container — the text is a sibling the
    // arrow binds to, not a label inside it
    container = null;
    insertAtParentCenter = false;
    // the scene position of the text's bound side midpoint, not a caret
    // position
    sceneX = arrowEndpointBinding.anchor[0];
    sceneY = arrowEndpointBinding.anchor[1];
  }

  let parentCenterPosition =
    insertAtParentCenter &&
    app.getTextWysiwygSnappedToCenterPosition(
      sceneX,
      sceneY,
      app.state,
      container,
    );
  if (container && parentCenterPosition) {
    const boundTextElementToContainer = getBoundTextElement(
      container,
      app.scene.getNonDeletedElementsMap(),
    );
    if (!boundTextElementToContainer) {
      shouldBindToContainer = true;
    }
  }
  const existingTextElement = arrowEndpointBinding
    ? null
    : app.getSelectedTextElement(container) ||
      (container && isArrowElement(container)
        ? getBoundTextElement(container, app.scene.getNonDeletedElementsMap())
        : null) ||
      app.getTextElementAtPosition(sceneX, sceneY);

  const fontFamily =
    existingTextElement?.fontFamily || app.state.currentItemFontFamily;

  const lineHeight =
    existingTextElement?.lineHeight || getLineHeight(fontFamily);
  const fontSize = app.state.currentItemFontSize;

  if (
    !existingTextElement &&
    shouldBindToContainer &&
    container &&
    !isArrowElement(container) &&
    !isStickyNoteElement(container)
  ) {
    const fontString = {
      fontSize,
      fontFamily,
    };
    const minWidth = getApproxMinLineWidth(
      getFontString(fontString),
      lineHeight,
    );
    const minHeight = getApproxMinLineHeight(fontSize, lineHeight);
    const newHeight = Math.max(container.height, minHeight);
    const newWidth = Math.max(container.width, minWidth);
    app.scene.mutateElement(container, {
      height: newHeight,
      width: newWidth,
    });
    sceneX = container.x + newWidth / 2;
    sceneY = container.y + newHeight / 2;
    if (parentCenterPosition) {
      parentCenterPosition = app.getTextWysiwygSnappedToCenterPosition(
        sceneX,
        sceneY,
        app.state,
        container,
      );
    }
  }

  const textCreationGridPoint = app.getTextCreationGridPoint(sceneX, sceneY);

  const newTextElementPosition = arrowEndpointBinding
    ? // the anchor is dictated by the arrow, so neither the grid nor the
      // caret-centering fudge may nudge it
      { x: sceneX, y: sceneY }
    : parentCenterPosition
    ? {
        x: parentCenterPosition.elementCenterX,
        y: parentCenterPosition.elementCenterY,
      }
    : !existingTextElement
    ? {
        x: textCreationGridPoint?.x ?? sceneX,
        y:
          textCreationGridPoint === null
            ? // Free text starts from a point cursor, so center the first line box on it.
              sceneY - getLineHeightInPx(fontSize, lineHeight) / 2
            : textCreationGridPoint.y,
      }
    : {
        x: sceneX,
        y: sceneY,
      };

  const topLayerFrame = app.getTopLayerFrameAtSceneCoords({
    x: newTextElementPosition.x,
    y: newTextElementPosition.y,
  });

  // container has higher priority. Only add to frame if container is in the same frame.
  const frameId =
    topLayerFrame &&
    (!shouldBindToContainer ||
      !container ||
      container.containerRef?.elementId === topLayerFrame.id)
      ? topLayerFrame.id
      : null;

  const element =
    existingTextElement ||
    newTextElement({
      x: newTextElementPosition.x,
      y: newTextElementPosition.y,
      // a note's stroke color is its text color: the label inherits it
      strokeColor:
        shouldBindToContainer && isStickyNoteElement(container)
          ? container.strokeColor
          : app.state.currentItemStrokeColor,
      backgroundColor: app.state.currentItemBackgroundColor,
      fillStyle: app.state.currentItemFillStyle,
      strokeWidth: app.getCurrentItemStrokeWidth("text"),
      strokeStyle: app.state.currentItemStrokeStyle,
      roughness: app.state.currentItemRoughness,
      opacity: app.state.currentItemOpacity,
      text: "",
      fontSize,
      baseFontSize:
        shouldBindToContainer && isStickyNoteElement(container)
          ? fontSize
          : null,
      fontFamily,
      textAlign:
        arrowEndpointBinding?.textAlign ??
        (parentCenterPosition ? "center" : app.state.currentItemTextAlign),
      verticalAlign:
        arrowEndpointBinding?.verticalAlign ??
        (parentCenterPosition ? VERTICAL_ALIGN.MIDDLE : DEFAULT_VERTICAL_ALIGN),
      containerId: shouldBindToContainer ? container?.id : undefined,
      labelPosition:
        shouldBindToContainer && container && isArrowElement(container)
          ? DEFAULT_BOUND_TEXT_LABEL_POSITION
          : null,
      groupIds: container?.groupIds ?? [],
      lineHeight,
      angle: container
        ? isArrowElement(container)
          ? (0 as Radians)
          : container.angle
        : (0 as Radians),
      containerRef: shouldBindToContainer
        ? undefined
        : frameLikeContainerRef(frameId),
    });

  if (!existingTextElement && shouldBindToContainer && container) {
    app.scene.mutateElement(container, {
      boundElements: (container.boundElements || []).concat({
        type: "text",
        id: element.id,
      }),
    });
  }
  app.setState({ editingTextElement: element });

  if (!existingTextElement) {
    if (container && shouldBindToContainer) {
      const containerIndex = app.scene.getElementIndex(container.id);
      // TODO should use insertNewElement, after we update it to handle
      // elements with containerId + containerRef at the same time (containerId
      // should take precedence when it comes to z-index)
      app.scene.insertElementsAtIndex([element], containerIndex + 1);
    } else {
      app.insertNewElement(element);
    }
  }

  if (arrowEndpoint && arrowEndpointBinding) {
    app.arrowText.bindText(
      arrowEndpoint,
      element,
      arrowEndpointBinding.fixedPoint,
    );
  }

  if (autoEdit || existingTextElement || container) {
    app.handleTextWysiwyg(element, {
      isExistingElement: !!existingTextElement,
      initialCaretSceneCoords: existingTextElement
        ? initialCaretSceneCoords
        : null,
    });
  } else {
    app.setState({
      newElement: element,
      multiElement: null,
    });
  }
};
