import { isTransparent } from "@excalidraw/common";

import {
  getColorTargetElement,
  isElbowArrow,
  isTitledElement,
  isImageElement,
  isLinearElement,
  isTextElement,
  hasStrokeColor,
  isShapeId,
  toolIsArrow,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawElementType,
  NonDeletedElementsMap,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { alignActionsPredicate } from "../actions/actionAlign";
import {
  canChangeRoundness,
  canHaveArrowheads,
  getSelectedElements,
  hasBackground,
  hasFillStyle,
  hasFrameBackground,
  hasFreedrawMode,
  hasStrokeStyle,
  hasStrokeWidth,
} from "../scene";

import {
  getElementEmbeddedTextTarget,
  getTextStyleTargetStyle,
} from "./app/textStyleTargets";

import type { ElementOrToolType } from "../types";

import type { AppClassProperties, UIAppState } from "../types";

/** 元素自身是否已有正文 block（composite / flow）。 */
const hasEmbeddedTextStyle = (element: ExcalidrawElement) => {
  const target = getElementEmbeddedTextTarget(element);
  return !!target && getTextStyleTargetStyle(element, target.region) !== null;
};

export const canChangeStrokeColor = (
  appState: UIAppState,
  targetElements: ExcalidrawElement[],
) => {
  let commonSelectedType: ExcalidrawElementType | null =
    targetElements[0]?.type || null;

  for (const element of targetElements) {
    if (element.type !== commonSelectedType) {
      commonSelectedType = null;
      break;
    }
  }

  return (
    (hasStrokeColor(appState.activeTool.type) &&
      commonSelectedType !== "image" &&
      commonSelectedType !== "frame" &&
      commonSelectedType !== "magicframe") ||
    targetElements.some((element) => hasStrokeColor(element.type))
  );
};

export const canChangeBackgroundColor = (
  appState: UIAppState,
  targetElements: ExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  const activeFillTarget =
    appState.activeTool.type === "rectangle" &&
    isShapeId(appState.preferredGenericShape)
      ? appState.preferredGenericShape
      : appState.activeTool.type;
  return (
    hasBackground(activeFillTarget) ||
    // a note's label (the target while editing it) has no fill, but a
    // background pick on it colors the note — so the picker stays available.
    // Frames are filled too, but only once selected: a frame always starts
    // transparent, and the frame tool has no "current background" to
    // preconfigure (see `createFrameElementOnPointerDown`).
    targetElements.some(
      (element) =>
        hasBackground(
          getColorTargetElement(element, "backgroundColor", elementsMap),
        ) || hasFrameBackground(element.type),
    )
  );
};

/**
 * Single source of truth for "which shape-action controls are relevant right
 * now". Each flag answers whether a given control should be shown, given the
 * active tool and the current selection. All three styles-panel layouts
 * (full / compact / mobile) and the compact popovers consume these flags so
 * that visibility logic lives in one place and layout stays pure.
 */
export const getShapeActionPredicates = (
  appState: UIAppState,
  targetElements: ExcalidrawElement[],
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap,
  app: AppClassProperties,
) => {
  const activeToolType = appState.activeTool.type;
  const activeFillTarget =
    activeToolType === "rectangle" && isShapeId(appState.preferredGenericShape)
      ? appState.preferredGenericShape
      : activeToolType;

  // A property is relevant when it applies to the active tool (so it can be
  // preconfigured before drawing) or to any currently selected element.
  const forToolOrSelection = (
    predicate: (type: ElementOrToolType) => boolean,
  ) =>
    predicate(activeToolType) ||
    targetElements.some((element) => predicate(element.type));

  const singleSelected = targetElements.length === 1;

  const isEditingTextOrNewElement = Boolean(
    appState.editingTextElement ||
      appState.editingTextRegion ||
      appState.newElement,
  );
  const isEditingEmbeddedText = Boolean(appState.editingTextRegion);
  const hasSelection = targetElements.length > 0;

  return {
    /** some element(s) selected */
    hasSelection,
    /** actions on selected elements (delete/duplicate/...) */
    showExtraActions: hasSelection && !isEditingTextOrNewElement,

    // color
    strokeColor:
      canChangeStrokeColor(appState, targetElements) ||
      // 区域文本编辑时颜色板充当「字体颜色」，即使宿主元素本身无描边色
      !!appState.editingTextRegion,
    backgroundColor: canChangeBackgroundColor(
      appState,
      targetElements,
      elementsMap,
    ),
    fill:
      // bucket fill never renders transparent (it falls back to a real
      // color), so its fill style stays relevant either way
      activeToolType === "bucketfill" ||
      (hasFillStyle(activeFillTarget) &&
        !isTransparent(appState.currentItemBackgroundColor)) ||
      targetElements.some(
        (element) =>
          hasFillStyle(element) && !isTransparent(element.backgroundColor),
      ),

    // stroke / shape properties
    strokeWidth: forToolOrSelection(
      (type) => hasStrokeWidth(type) && type !== "freedraw",
    ),
    freedrawStrokeWidth: forToolOrSelection((type) => type === "freedraw"),
    freedrawMode: forToolOrSelection(hasFreedrawMode),
    strokeStyle: forToolOrSelection(hasStrokeStyle),
    roundness: forToolOrSelection(canChangeRoundness),
    arrowType: forToolOrSelection(toolIsArrow),
    arrowheads: forToolOrSelection(canHaveArrowheads),

    // text
    text:
      activeToolType === "text" ||
      isEditingEmbeddedText ||
      targetElements.some(isTextElement) ||
      targetElements.some(hasEmbeddedTextStyle),
    textAlign:
      activeToolType === "text" ||
      isEditingEmbeddedText ||
      targetElements.some(isTextElement) ||
      targetElements.some(hasEmbeddedTextStyle),
    verticalAlign:
      isEditingEmbeddedText || targetElements.some(hasEmbeddedTextStyle),

    opacity: activeToolType !== "autoshape" || hasSelection,

    // arrangement
    // z-order controls act on the selection, so they require one: hidden in
    // the tool-config state (no selection), and still hidden while the
    // freedraw or drawShape tool is active without a selected freedraw
    layers:
      hasSelection &&
      ((activeToolType !== "freedraw" &&
        activeToolType !== "autoshape" &&
        !targetElements.some((element) => element.type === "freedraw")) ||
        getSelectedElements(elementsMap, appState).some(
          (element) => element.type === "freedraw",
        )),
    align:
      alignActionsPredicate(appState, app),
    distribute: targetElements.length > 2,

    // per-element actions
    // NOTE: the full panel treats a bound container as linkable; the compact /
    // mobile layouts only link a truly single selection. Both are preserved via
    // the two flags below.
    link: singleSelected,
    linkSingleOnly: singleSelected,
    cropEditor:
      !appState.croppingElementId &&
      singleSelected &&
      isImageElement(targetElements[0]),
    lineEditor:
      !appState.selectedLinearElement?.isEditing &&
      singleSelected &&
      isLinearElement(targetElements[0]) &&
      !isElbowArrow(targetElements[0]),
    /** Frame/MagicFrame/Table 场景：浮动栏「重命名」入口 */
    titleRename: singleSelected && isTitledElement(targetElements[0]),
  };
};

export type ShapeActionPredicates = ReturnType<typeof getShapeActionPredicates>;
