import {
  getActiveTextElement,
  isSequenceFragmentElement,
  frameLikeContainerRef,
  isContainerBackgroundText,
  isTextElement,
  hitElementLabel,
  isShapeWithId,
  getSequenceFragmentRowIndexAt,
  getSequenceFragmentRowLayout,
  getTextRegionAtPosition,
  textRegionKey,
} from "@excalidraw/element";

import { flushSync } from "react-dom";
import {
  isNonDeletedElement,
  newElementWith,
  refreshTextDimensions,
  updateBoundElements,
  fixBindingsAfterDeletion,
} from "@excalidraw/element";
import { makeNextSelectedElementIds } from "@excalidraw/element";
import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import {
  DEFAULT_VERTICAL_ALIGN,
  TEXT_TO_CENTER_SNAP_THRESHOLD,
  VERTICAL_ALIGN,
  getLineHeight,
} from "@excalidraw/common";

import {
  getLineHeightInPx,
  getTextElementStyle,
  getTextElementText,
  getTextElementTextPatch,
  isLinearElement,
  LinearElementEditor,
  newTextElement,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawSequenceElement,
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { ArrowEndpoint, TextRegionKey } from "@excalidraw/element";
import type { Radians } from "@excalidraw/math";

import { actionTextAutoResize } from "../../actions/actionTextAutoResize";
import { isPointHittingTextAutoResizeHandle } from "../../textAutoResizeHandle";

import { textWysiwyg } from "../../wysiwyg/textWysiwyg";
import { withBatchedUpdates } from "../../reactUtils";

import { isEmbeddedTextElement, startRegionTextEditing } from "./regionText";

import type App from "../App";

import type { AppState } from "../../types";

/** 组合片段按场景点选中的文本区域：正文行取 `row:<rowId>`，表头落到页签。 */
const getFragmentTextRegionAtPosition = (
  fragment: ExcalidrawSequenceElement,
  sceneX: number,
  sceneY: number,
): TextRegionKey => {
  if (!isSequenceFragmentElement(fragment)) {
    return "body";
  }
  const [, localY] = pointRotateRads(
    pointFrom(
      sceneX - fragment.x - fragment.width / 2,
      sceneY - fragment.y - fragment.height / 2,
    ),
    pointFrom(0, 0),
    -fragment.angle as Radians,
  );
  const rowIndex = getSequenceFragmentRowIndexAt(
    fragment.height,
    fragment.shape.fragment,
    localY + fragment.height / 2,
  );
  if (rowIndex < 1) {
    return "body";
  }
  const rows = getSequenceFragmentRowLayout(
    fragment.height,
    fragment.shape.fragment,
  ).rows;
  return rows[rowIndex] ? textRegionKey.row(rows[rowIndex].id) : "body";
};

/** 场景点转换到元素局部坐标（先平移到元素左上角，再反向旋转）。 */
const getLocalPoint = (
  element: ExcalidrawElement,
  sceneX: number,
  sceneY: number,
): LocalPoint => {
  const [x, y] = pointRotateRads(
    pointFrom(
      sceneX - element.x - element.width / 2,
      sceneY - element.y - element.height / 2,
    ),
    pointFrom(0, 0),
    -element.angle as Radians,
  );
  return pointFrom(x + element.width / 2, y + element.height / 2);
};

export const getTextWysiwygSnappedToCenterPosition = (
  app: App,
  x: number,
  y: number,
  appState: AppState,
  container?: ExcalidrawElement | null,
) => {
  if (!container) {
    return;
  }
  let elementCenterX = container.x + container.width / 2;
  let elementCenterY = container.y + container.height / 2;
  if (isLinearElement(container)) {
    const center = LinearElementEditor.getLabelCenter(
      container,
      app.scene.getNonDeletedElementsMap(),
    );
    elementCenterX = center[0];
    elementCenterY = center[1];
  }
  const distanceToCenter = Math.hypot(x - elementCenterX, y - elementCenterY);
  if (distanceToCenter < TEXT_TO_CENTER_SNAP_THRESHOLD) {
    const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
      { sceneX: elementCenterX, sceneY: elementCenterY },
      appState,
    );
    return { viewportX, viewportY, elementCenterX, elementCenterY };
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

    app.scene.replaceAllElements([
      ...app.scene.getElementsIncludingDeleted().map((_element) => {
        if (_element.id === latestTextElement.id && isTextElement(_element)) {
          const textPatch = getTextElementTextPatch(_element, nextOriginalText);
          let layoutPatch: {
            width?: number;
            height?: number;
            x?: number;
            y?: number;
          } = {};
          // 单元格背景文字由表格布局管理尺寸，其余独立文字按内容重排
          if (!isContainerBackgroundText(_element)) {
            const refreshed = refreshTextDimensions(
              _element,
              elementsMap,
              nextOriginalText,
            );
            if (refreshed) {
              const { text: _displayText, ...dimensions } = refreshed;
              layoutPatch = dimensions;
            }
          }
          return newElementWith(_element, {
            ...textPatch,
            ...layoutPatch,
            isDeleted: isDeleted ?? _element.isDeleted,
          });
        }
        return _element;
      }),
    ]);
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
      const elementIdToSelect =
        viaKeyboard &&
        !app.isToolLocked() &&
        app.state.activeTool.type !== "autoshape" &&
        !isContainerBackgroundText(element) &&
        !isDeleted
          ? element.id
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
      if (!isDeleted || isExistingElement) {
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
  updateElement(getTextElementText(element), false);
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
  !!app.state.editingTextElement ||
  !!app.state.editingTextRegion ||
  isTextElement(app.state.newElement);

export const getSelectedTextElement = (
  app: TextApp,
): NonDeleted<ExcalidrawTextElement> | null => {
  const selectedElements = app.scene.getSelectedElements(app.state);
  if (selectedElements.length !== 1) {
    return null;
  }

  const selectedElement = selectedElements[0]!;
  return isTextElement(selectedElement) ? selectedElement : null;
};

export const getTextElementAtPosition = (
  app: TextApp,
  x: number,
  y: number,
): NonDeleted<ExcalidrawTextElement> | null => {
  const element = app.getElementAtPosition(x, y);
  return element && isTextElement(element) && !element.isDeleted
    ? element
    : null;
};

/**
 * 单击已选中的区域文本元素（形状、便签、脑图节点、表格、片段、生命线，
 * 或命中了标签的线性元素）时进入区域编辑；其余返回 null / undefined。
 */
export const getSelectedTextEditingContainerAtPosition = (
  app: TextApp,
  hitElement: NonDeletedExcalidrawElement | null,
  sceneCoords: { x: number; y: number },
): ExcalidrawElement | null | undefined => {
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
  // 线性元素的标签没有独立文字元素，命中标签布局即进入编辑
  if (isLinearElement(selectedElement)) {
    return hitElementLabel(
      pointFrom(sceneCoords.x, sceneCoords.y),
      selectedElement,
      app.scene.getNonDeletedElementsMap(),
    )
      ? selectedElement
      : undefined;
  }
  return isEmbeddedTextElement(selectedElement) ? selectedElement : undefined;
};

export const isHittingTextAutoResizeHandle = (
  app: Pick<TextApp, "state" | "editorInterface" | "scene">,
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
    container?: ExcalidrawElement | null;
    autoEdit?: boolean;
    initialCaretSceneCoords?: { x: number; y: number };
    /**
     * creates the text as a label for this arrow endpoint: the binding then
     * dictates the text's position and alignment, overriding (sceneX, sceneY)
     */
    arrowEndpoint?: ArrowEndpoint | null;
  },
) => {
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

  // 区域文本容器（形状家族、便签、脑图节点、表格、片段、生命线）与线性元素
  // 的标签都直接进入区域编辑，不创建文字元素
  if (container) {
    if (isNonDeletedElement(container)) {
      if (isLinearElement(container)) {
        startRegionTextEditing(app, container, "label", {
          initialCaretSceneCoords,
          autoSelect: true,
        });
        return;
      }
      if (isEmbeddedTextElement(container)) {
        // 数据流处理图形的标题栏是独立区域，其余家族只有正文；
        // 组合片段按命中的行选择 `row:<rowId>`，表头落到 operator 页签
        const region: TextRegionKey =
          isShapeWithId(container, "df-process") &&
          getTextRegionAtPosition(
            container,
            getLocalPoint(container, sceneX, sceneY),
          ) === "title"
            ? "title"
            : isSequenceFragmentElement(container)
            ? getFragmentTextRegionAtPosition(container, sceneX, sceneY)
            : "body";
        startRegionTextEditing(app, container, region, {
          initialCaretSceneCoords,
          autoSelect: true,
        });
      }
    }
    return;
  }

  const existingTextElement = arrowEndpointBinding
    ? null
    : app.getSelectedTextElement() ||
      app.getTextElementAtPosition(sceneX, sceneY);

  const fontFamily = existingTextElement
    ? getTextElementStyle(existingTextElement).fontFamily
    : app.state.currentItemFontFamily;

  const lineHeight = existingTextElement
    ? getTextElementStyle(existingTextElement).lineHeight
    : getLineHeight(fontFamily);
  const fontSize = app.state.currentItemFontSize;

  const parentCenterPosition =
    insertAtParentCenter &&
    app.getTextWysiwygSnappedToCenterPosition(sceneX, sceneY, app.state);

  const textCreationGridPoint = app.getTextCreationGridPoint(sceneX, sceneY);

  const newTextElementPosition = arrowEndpointBinding
    ? { x: sceneX, y: sceneY }
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
            ? sceneY - getLineHeightInPx(fontSize, lineHeight) / 2
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

  const element =
    existingTextElement ||
    newTextElement({
      x: newTextElementPosition.x,
      y: newTextElementPosition.y,
      strokeColor: app.state.currentItemStrokeColor,
      backgroundColor: app.state.currentItemBackgroundColor,
      fillStyle: app.state.currentItemFillStyle,
      strokeWidth: app.getCurrentItemStrokeWidth("text"),
      strokeStyle: app.state.currentItemStrokeStyle,
      opacity: app.state.currentItemOpacity,
      text: "",
      fontSize,
      fontFamily,
      textAlign:
        arrowEndpointBinding?.textAlign ??
        (parentCenterPosition ? "center" : app.state.currentItemTextAlign),
      verticalAlign:
        arrowEndpointBinding?.verticalAlign ??
        (parentCenterPosition ? VERTICAL_ALIGN.MIDDLE : DEFAULT_VERTICAL_ALIGN),
      groupIds: [],
      lineHeight,
      angle: 0 as Radians,
      containerRef: frameLikeContainerRef(topLayerFrame?.id),
    });

  app.setState({ editingTextElement: element });

  if (!existingTextElement) {
    app.insertNewElement(element);
  }

  if (arrowEndpoint && arrowEndpointBinding) {
    app.arrowText.bindText(
      arrowEndpoint,
      element,
      arrowEndpointBinding.attachPoint,
    );
  }

  if (autoEdit || existingTextElement) {
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
