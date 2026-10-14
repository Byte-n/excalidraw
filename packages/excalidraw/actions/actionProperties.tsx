import { pointFrom } from "@excalidraw/math";

import clsx from "clsx";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  BUCKET_FILL_BACKGROUND_PICKS,
  COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE,
  ARROW_TYPE,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  FONT_FAMILY,
  ROUNDNESS,
  STROKE_WIDTH_KEYS,
  VERTICAL_ALIGN,
  KEYS,
  arrayToMap,
  getFontFamilyString,
  getLineHeight,
  isTransparent,
  getStrokeWidthByKey,
  reduceToCommonValue,
  invariant,
  FONT_SIZES,
  type StrokeWidthKey,
} from "@excalidraw/common";

import {
  canBecomePolygon,
  normalizeStickyNote,
  getNonDeletedElements,
  isNonDeletedElement,
  syncStickyNoteInk,
} from "@excalidraw/element";

import {
  bindBindingElement,
  calculateFixedPointForElbowArrowBinding,
  updateBoundElements,
} from "@excalidraw/element";

import { LinearElementEditor } from "@excalidraw/element";

import { newElementWith } from "@excalidraw/element";

import {
  getBoundTextElement,
  getBaseFontSize,
  getBaseFontSizeUpdate,
  redrawTextBoundingBox,
} from "@excalidraw/element";

import {
  isArrowElement,
  isBoundToContainer,
  isElbowArrow,
  isLinearElement,
  isLineElement,
  isStickyNoteElement,
  isTextElement,
  isUsingAdaptiveRadius,
} from "@excalidraw/element";

import {
  getColorTargetElement,
  getColorUpdate,
  hasBackground,
  hasFillStyle,
  hasFrameBackground,
  hasStrokeColor,
} from "@excalidraw/element";

import {
  updateElbowArrowPoints,
  CaptureUpdateAction,
  toggleLinePolygonState,
} from "@excalidraw/element";

import { deriveStylesPanelMode } from "@excalidraw/common";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type {
  Arrowhead,
  ElementsMap,
  ExcalidrawBindableElement,
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  FontFamilyValues,
  StrokeVariability,
  NonDeleted,
  NonDeletedExcalidrawElement,
  TextAlign,
  VerticalAlign,
} from "@excalidraw/element/types";

import type { ElementUpdate, Scene } from "@excalidraw/element";

import type { CaptureUpdateActionType } from "@excalidraw/element";

import { trackEvent } from "../analytics";
import { RadioSelection } from "../components/RadioSelection";
import { IconButton } from "../components/IconButton";
import { ColorPicker } from "../components/ColorPicker/ColorPicker";
import { FontPicker } from "../components/FontPicker/FontPicker";
import {
  IconOptionGrid,
  findIconOption,
  type IconGridOption,
} from "../components/IconPicker";
import { Range } from "../components/Range";
import {
  ArrowheadArrowIcon,
  ArrowheadBarIcon,
  ArrowheadCircleIcon,
  ArrowheadTriangleIcon,
  ArrowheadNoneIcon,
  ArrowheadXArrowIcon,
  StrokeStyleDashedIcon,
  StrokeStyleDottedIcon,
  TextAlignTopIcon,
  TextAlignBottomIcon,
  TextAlignMiddleIcon,
  FillHachureIcon,
  FillCrossHatchIcon,
  FillSolidIcon,
  StrokeWidthBaseIcon,
  StrokeWidthBoldIcon,
  StrokeWidthExtraBoldIcon,
  FontSizeSmallIcon,
  FontSizeMediumIcon,
  FontSizeLargeIcon,
  FontSizeExtraLargeIcon,
  EdgeSharpIcon,
  EdgeRoundIcon,
  TextAlignLeftIcon,
  TextAlignCenterIcon,
  TextAlignRightIcon,
  FillZigZagIcon,
  ArrowheadTriangleOutlineIcon,
  ArrowheadCircleOutlineIcon,
  ArrowheadDiamondIcon,
  ArrowheadDiamondOutlineIcon,
  fontSizeIcon,
  sharpArrowIcon,
  roundArrowIcon,
  elbowArrowIcon,
  ArrowheadCardinalityExactlyOneIcon,
  ArrowheadCardinalityManyIcon,
  ArrowheadCardinalityOneIcon,
  ArrowheadCardinalityOneOrManyIcon,
  ArrowheadCardinalityZeroOrManyIcon,
  ArrowheadCardinalityZeroOrOneIcon,
  strokeVariabilityConstantIcon,
  strokeVariabilityVariableIcon,
} from "../components/icons";

import { Fonts } from "../fonts";
import { getLanguage, t } from "../i18n";
import {
  canHaveArrowheads,
  getSelectedElements,
  getTargetElements,
  isSomeElementSelected,
} from "../scene";

import {
  withCaretPositionPreservation,
  restoreCaretPosition,
} from "../hooks/useTextEditorFocus";

import { getShortcutKey } from "../shortcut";

import {
  getColorTargetAppStateUpdates,
  resolveColorTarget,
} from "./colorTargets";
import { register } from "./register";

import type { AppClassProperties, AppState, Primitive } from "../types";

const FONT_SIZE_RELATIVE_INCREASE_STEP = 0.1;

// 油漆桶弹层在全色板网格中隐藏透明（不可见填充是无操作）——隐藏而非移除，
// 让其余颜色保住既有网格位与热键；模块常量保证 memo 的 === 比较成立
const BUCKET_FILL_EXCLUDED_COLORS: readonly string[] = [
  COLOR_PALETTE.transparent,
];

const getStylesPanelInfo = (app: AppClassProperties) => {
  const stylesPanelMode = deriveStylesPanelMode(app.editorInterface);
  return {
    stylesPanelMode,
    isCompact: stylesPanelMode !== "full",
    isMobile: stylesPanelMode === "mobile",
  } as const;
};

export const changeProperty = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  callback: (element: NonDeletedExcalidrawElement) => ExcalidrawElement,
  includeBoundText = false,
) => {
  const selectedElementIds = arrayToMap(
    getSelectedElements(elements, appState, {
      includeBoundTextElement: includeBoundText,
    }),
  );

  return elements.map((element) => {
    if (
      selectedElementIds.get(element.id) ||
      element.id === appState.editingTextElement?.id
    ) {
      // selected & editing elements are non-deleted
      if (!isNonDeletedElement(element)) {
        // SAFETY: This should never happen, but log it just in case
        console.error(
          "[NONDELETED][INVARIANT] changeProperty(): skipping deleted selected/editing element",
        );
      }
      const nextElement = callback(element as NonDeletedExcalidrawElement);
      // sticky notes keep their data invariants (never-transparent colors,
      // solid fill, minimum size) whatever property was written; a no-op
      // normalization returns the same object
      return isStickyNoteElement(nextElement)
        ? normalizeStickyNote(nextElement)
        : nextElement;
    }
    return element;
  });
};

export const getFormValue = function <T extends Primitive>(
  elements: readonly ExcalidrawElement[],
  app: AppClassProperties,
  /**
   * input value (usually the element attribute value,
   * but depends on what the action's PanelComponent input expects)
   */
  getValue: (element: ExcalidrawElement) => T,
  elementPredicate: true | ((element: ExcalidrawElement) => boolean),
  defaultValue: T | ((isSomeElementSelected: boolean) => T),
): T {
  const editingTextElement = app.state.editingTextElement;
  const nonDeletedElements = getNonDeletedElements(elements);

  let ret: T | null = null;

  if (editingTextElement) {
    ret = getValue(editingTextElement);
  }

  if (!ret) {
    const hasSelection = isSomeElementSelected(nonDeletedElements, app.state);

    if (hasSelection) {
      const selectedElements = app.scene.getSelectedElements(app.state);
      const targetElements =
        elementPredicate === true
          ? selectedElements
          : selectedElements.filter((el) => elementPredicate(el));

      ret =
        reduceToCommonValue(targetElements, getValue) ??
        (typeof defaultValue === "function"
          ? defaultValue(true)
          : defaultValue);
    } else {
      ret =
        typeof defaultValue === "function" ? defaultValue(false) : defaultValue;
    }
  }

  return ret;
};

const offsetElementAfterFontResize = (
  prevElement: ExcalidrawTextElement,
  nextElement: ExcalidrawTextElement,
  scene: Scene,
) => {
  if (isBoundToContainer(nextElement) || !nextElement.autoResize) {
    return nextElement;
  }
  return scene.mutateElement(nextElement, {
    x:
      prevElement.textAlign === "left"
        ? prevElement.x
        : prevElement.x +
          (prevElement.width - nextElement.width) /
            (prevElement.textAlign === "center" ? 2 : 1),
    // centering vertically is non-standard, but for Excalidraw I think
    // it makes sense
    y: prevElement.y + (prevElement.height - nextElement.height) / 2,
  });
};

const changeFontSize = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  app: AppClassProperties,
  getNewFontSize: (element: ExcalidrawTextElement) => number,
  fallbackValue?: ExcalidrawTextElement["fontSize"],
) => {
  const newFontSizes = new Set<number>();
  const elementsMap = app.scene.getNonDeletedElementsMap();

  const updatedElements = changeProperty(
    elements,
    appState,
    (oldElement) => {
      if (isTextElement(oldElement)) {
        const newFontSize = getNewFontSize(oldElement);
        newFontSizes.add(newFontSize);
        const container = app.scene.getContainerElement(oldElement);

        let newElement: ExcalidrawTextElement = newElementWith(
          oldElement,
          getBaseFontSizeUpdate(oldElement, newFontSize, elementsMap),
        );
        redrawTextBoundingBox(newElement, container, app.scene);

        newElement = offsetElementAfterFontResize(
          oldElement,
          newElement,
          app.scene,
        );

        return newElement;
      }
      return oldElement;
    },
    true,
  );

  // Update arrow elements after text elements have been updated
  getSelectedElements(elements, appState, {
    includeBoundTextElement: true,
  }).forEach((element) => {
    if (isTextElement(element)) {
      updateBoundElements(element, app.scene);
    }
  });

  return {
    elements: updatedElements,
    appState: {
      ...appState,
      // update state only if we've set all select text elements to
      // the same font size
      currentItemFontSize:
        newFontSizes.size === 1
          ? [...newFontSizes][0]
          : fallbackValue ?? appState.currentItemFontSize,
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
};

// -----------------------------------------------------------------------------

export const actionChangeStrokeColor = register<
  Partial<AppState> & { color?: string }
>({
  name: "changeStrokeColor",
  label: "labels.stroke",
  trackEvent: false,
  perform: (elements, appState, value) => {
    const { color, ...appStateUpdates } = value ?? {};
    if (color === undefined) {
      return {
        appState: { ...appState, ...appStateUpdates },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }
    // resolved from the state the action runs against — never from the
    // render-time closure of the memoized picker (see `resolveColorTarget`)
    const target = resolveColorTarget(appState, elements, "strokeColor");
    const elementsMap = arrayToMap(elements);

    return {
      elements: syncStickyNoteInk(
        changeProperty(elements, appState, (el) =>
          hasStrokeColor(el.type)
            ? newElementWith(
                el,
                getColorUpdate(el, "strokeColor", color, elementsMap),
              )
            : el,
        ),
        elementsMap,
      ),
      appState: {
        ...appState,
        ...appStateUpdates,
        ...getColorTargetAppStateUpdates(target, color),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    const target = resolveColorTarget(appState, elements, "strokeColor");
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const strokeTargets = getSelectedElements(elements, appState).filter(
      (element) => hasStrokeColor(element.type),
    );
    const editingText =
      appState.editingTextElement &&
      elementsMap.get(appState.editingTextElement.id);
    if (
      editingText &&
      isTextElement(editingText) &&
      !strokeTargets.some((element) => element.id === editingText.id)
    ) {
      strokeTargets.push(editingText);
    }
    const isTextScene =
      appState.activeTool.type === "text" ||
      (strokeTargets.length > 0 && strokeTargets.every(isTextElement));
    const isInk = target.kind === "sticky" || isTextScene;
    const label = isInk ? t("labels.fontColor") : t("labels.stroke");

    return (
      <ColorPicker
        topPicks={target.topPicks}
        palette={target.palette}
        presetColors={target.presetColors}
        excludedColors={target.excludedColors}
        customizableTopPicks={target.customizableTopPicks}
        type="elementStroke"
        label={label}
        popupTitle={label}
        compact
        color={getFormValue(
          elements,
          app,
          (element) => element.strokeColor,
          true,
          (hasSelection) => (!hasSelection ? target.currentValue : null),
        )}
        onChange={(color) => updateData({ color })}
        elements={elements}
        appState={appState}
        updateData={updateData}
      />
    );
  },
});

/**
 * Whether a background pick lands on this element. Frames take a fill of their
 * own (`hasFrameBackground`) without joining `supportsFill`, which the
 * hit-test and bucket tool share.
 */
const takesBackgroundPick = (element: ExcalidrawElement) =>
  hasBackground(element) || hasFrameBackground(element.type);

export const actionChangeBackgroundColor = register<
  Partial<AppState> & { color?: string }
>({
  name: "changeBackgroundColor",
  label: "labels.changeBackground",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    const { color, ...appStateUpdates } = value ?? {};
    if (color === undefined) {
      return {
        appState: { ...appState, ...appStateUpdates },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }
    const target = resolveColorTarget(appState, elements, "backgroundColor");
    const elementsMap = arrayToMap(elements);

    let nextElements;

    const selectedElements = app.scene.getSelectedElements(appState);
    const shouldEnablePolygon =
      !isTransparent(color) &&
      // `every` is vacuously true with nothing selected (editing text)
      selectedElements.length > 0 &&
      selectedElements.every(
        (el) => isLineElement(el) && canBecomePolygon(el.points),
      );

    if (shouldEnablePolygon) {
      const selectedElementsMap = arrayToMap(selectedElements);
      nextElements = elements.map((el) => {
        if (selectedElementsMap.has(el.id) && isLineElement(el)) {
          return newElementWith(el, {
            backgroundColor: color,
            ...toggleLinePolygonState(el, true),
          });
        }
        return el;
      });
    } else {
      nextElements = changeProperty(elements, appState, (el) =>
        // a note's label passes the pick on to the note (below)
        getColorTargetElement(el, "backgroundColor", elementsMap) === el &&
        takesBackgroundPick(el)
          ? newElementWith(
              el,
              getColorUpdate(el, "backgroundColor", color, elementsMap),
            )
          : el,
      );
      // editing a note's label (no selection): the label has no fill, the
      // pick colors the note — text and background in one editing pass
      const editingText =
        appState.editingTextElement &&
        elementsMap.get(appState.editingTextElement.id);
      const editingTarget =
        editingText &&
        getColorTargetElement(editingText, "backgroundColor", elementsMap);
      if (
        editingTarget &&
        editingTarget !== editingText &&
        hasBackground(editingTarget)
      ) {
        nextElements = nextElements.map((el) =>
          el.id === editingTarget.id
            ? newElementWith(
                el,
                getColorUpdate(el, "backgroundColor", color, elementsMap),
              )
            : el,
        );
      }
    }

    return {
      // the default yellow paper carries its own ink: the sync forces it on
      // a switch onto yellow and releases an untouched one when leaving. Ink
      // reconciliation stays with the stroke actions — a background pick
      // leaves unrelated notes untouched.
      elements: syncStickyNoteInk(nextElements, elementsMap, {
        reconcileInk: false,
      }),
      appState: {
        ...appState,
        ...appStateUpdates,
        ...getColorTargetAppStateUpdates(target, color),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    const target = resolveColorTarget(appState, elements, "backgroundColor");
    // 便签背景为六色纸专用色板，标签「纸色」（设计稿场景矩阵 bg:paper）；
    // while editing a note's label the picker shows and sets the note's fill
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const label =
      target.kind === "sticky"
        ? t("labels.paperColor")
        : t("labels.background");

    return (
      <ColorPicker
        topPicks={target.topPicks}
        palette={target.palette}
        presetColors={target.presetColors}
        excludedColors={target.excludedColors}
        customizableTopPicks={target.customizableTopPicks}
        type="elementBackground"
        label={label}
        compact
        // 便签纸色变体（设计稿）：弹层只有六色纸 + 明度，无自定义与取色
        picksOnly={target.kind === "sticky"}
        color={getFormValue(
          elements,
          app,
          (element) =>
            getColorTargetElement(element, "backgroundColor", elementsMap)
              .backgroundColor,
          (element) =>
            takesBackgroundPick(
              getColorTargetElement(element, "backgroundColor", elementsMap),
            ),
          (hasSelection) => (!hasSelection ? target.currentValue : null),
        )}
        onChange={(color) => updateData({ color })}
        elements={elements}
        appState={appState}
        updateData={updateData}
      />
    );
  },
});

export const actionChangeBucketFillBackgroundColor = register<
  Pick<AppState, "currentItemBackgroundColor">
>({
  name: "changeBucketFillBackgroundColor",
  label: "labels.changeBackground",
  trackEvent: false,
  // the bucket fill tool has no element to mutate; it shares
  // `currentItemBackgroundColor` but hides `transparent` (an invisible fill
  // would be a no-op) and shows the effective fallback color instead
  perform: (elements, appState, value) => {
    return {
      appState: {
        ...appState,
        ...value,
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    return (
      <ColorPicker
        topPicks={BUCKET_FILL_BACKGROUND_PICKS}
        palette={DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE}
        // 弹层预设行 = 油漆桶快捷色（无透明——不可见填充是无操作）
        presetColors={BUCKET_FILL_BACKGROUND_PICKS}
        excludedColors={BUCKET_FILL_EXCLUDED_COLORS}
        // customized independently of the background picker's picks even
        // though both drive `currentItemBackgroundColor` — the bucket
        // strip's defaults and use case differ (no transparent)
        customizableTopPicks="bucketFill"
        type="elementBackground"
        label={t("labels.background")}
        compact
        color={app.bucketFill.getBucketFillBackgroundColor(
          appState.currentItemBackgroundColor,
        )}
        onChange={(color) => updateData({ currentItemBackgroundColor: color })}
        elements={elements}
        appState={appState}
        updateData={updateData}
      />
    );
  },
});

export const actionChangeFillStyle = register<ExcalidrawElement["fillStyle"]>({
  name: "changeFillStyle",
  label: "labels.fill",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    trackEvent(
      "element",
      "changeFillStyle",
      `${value} (${
        app.editorInterface.formFactor === "phone" ? "mobile" : "desktop"
      })`,
    );
    return {
      elements: changeProperty(elements, appState, (el) =>
        hasFillStyle(el) ? newElementWith(el, { fillStyle: value }) : el,
      ),
      appState: { ...appState, currentItemFillStyle: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    const selectedElements = getSelectedElements(elements, appState);
    const selectedFillStyleElements = selectedElements.filter((element) =>
      hasFillStyle(element),
    );
    const allElementsZigZag =
      selectedFillStyleElements.length > 0 &&
      selectedFillStyleElements.every((el) => el.fillStyle === "zigzag");

    return (
      <fieldset className="tb-group">
        <legend className="tb-legend">{t("labels.fill")}</legend>
        <div className="buttonList">
          <RadioSelection
            type="button"
            options={[
              {
                value: "hachure",
                text: `${
                  allElementsZigZag ? t("labels.zigzag") : t("labels.hachure")
                } (${getShortcutKey("Alt-Click")})`,
                icon: allElementsZigZag ? FillZigZagIcon : FillHachureIcon,
                active: allElementsZigZag ? true : undefined,
                testId: `fill-hachure`,
              },
              {
                value: "cross-hatch",
                text: t("labels.crossHatch"),
                icon: FillCrossHatchIcon,
                testId: `fill-cross-hatch`,
              },
              {
                value: "solid",
                text: t("labels.solid"),
                icon: FillSolidIcon,
                testId: `fill-solid`,
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) => element.fillStyle,
              (element) => hasFillStyle(element),
              (hasSelection) =>
                hasSelection ? null : appState.currentItemFillStyle,
            )}
            onClick={(value, event) => {
              const nextValue =
                event.altKey &&
                value === "hachure" &&
                selectedFillStyleElements.every(
                  (el) => el.fillStyle === "hachure",
                )
                  ? "zigzag"
                  : value;

              updateData(nextValue);
            }}
          />
        </div>
      </fieldset>
    );
  },
});

const getStrokeWidthKeyForElement = (
  element: ExcalidrawElement,
): StrokeWidthKey | null => {
  return (
    STROKE_WIDTH_KEYS.find(
      (key) => getStrokeWidthByKey(element.type, key) === element.strokeWidth,
    ) ?? null
  );
};

const getStrokeWidthForElement = (
  element: ExcalidrawElement,
  strokeWidthKey: StrokeWidthKey,
): ExcalidrawElement["strokeWidth"] => {
  return getStrokeWidthByKey(element.type, strokeWidthKey);
};

export const actionChangeStrokeWidth = register<StrokeWidthKey>({
  name: "changeStrokeWidth",
  label: "labels.strokeWidth",
  trackEvent: false,
  perform: (elements, appState, value) => {
    invariant(value, "actionChangeStrokeWidth: value must be defined");

    return {
      elements: changeProperty(elements, appState, (el) =>
        newElementWith(el, {
          strokeWidth: getStrokeWidthForElement(el, value),
        }),
      ),
      appState: { ...appState, currentItemStrokeWidthKey: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => (
    <fieldset className="tb-group">
      <legend className="tb-legend">{t("labels.strokeWidth")}</legend>
      <div className="buttonList">
        <RadioSelection<StrokeWidthKey>
          group="stroke-width"
          options={[
            {
              value: "thin",
              text: t("labels.thin"),
              icon: StrokeWidthBaseIcon,
              testId: "strokeWidth-thin",
            },
            {
              value: "medium",
              text: t("labels.medium"),
              icon: StrokeWidthBoldIcon,
              testId: "strokeWidth-medium",
            },
            {
              value: "bold",
              text: t("labels.bold"),
              icon: StrokeWidthExtraBoldIcon,
              testId: "strokeWidth-bold",
            },
          ]}
          value={getFormValue(
            elements,
            app,
            getStrokeWidthKeyForElement,
            (element) => element.hasOwnProperty("strokeWidth"),
            (hasSelection) =>
              hasSelection ? null : appState.currentItemStrokeWidthKey,
          )}
          onChange={(value) => updateData(value)}
        />
      </div>
    </fieldset>
  ),
});

export const actionChangeFreedrawMode = register<StrokeVariability>({
  name: "changeFreedrawMode",
  label: "labels.pressure",
  trackEvent: false,
  perform: (elements, appState, value) => {
    const variability = value || "constant";

    return {
      elements: changeProperty(elements, appState, (el) => {
        if (el.type !== "freedraw") {
          return el;
        }
        return newElementWith(el, {
          strokeOptions: {
            ...el.strokeOptions,
            variability,
          },
        }) as ExcalidrawElement;
      }),
      appState: { ...appState, currentItemStrokeVariability: variability },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const strokeVariability =
      getFormValue(
        elements,
        app,
        (element) =>
          (element as ExcalidrawFreeDrawElement).strokeOptions?.variability,
        (element) => element.type === "freedraw",
        (hasSelection) =>
          hasSelection ? null : appState.currentItemStrokeVariability,
      ) ?? appState.currentItemStrokeVariability;

    // in the compact UI the pressure setting is rendered as a single button
    // that cycles between the two variability modes on click
    if (data?.cycle) {
      const isVariable = strokeVariability === "variable";
      return (
        <IconButton
          type="button"
          icon={
            isVariable
              ? strokeVariabilityVariableIcon
              : strokeVariabilityConstantIcon
          }
          title={t("labels.pressure")}
          aria-label={t("labels.pressure")}
          onClick={() => updateData(isVariable ? "constant" : "variable")}
        />
      );
    }

    return (
      <fieldset className="tb-group">
        <legend className="tb-legend">{t("labels.pressure")}</legend>
        <div className="buttonList">
          <RadioSelection<StrokeVariability>
            group="strokeOptions.variability"
            options={[
              {
                value: "constant",
                text: t("labels.pressure_constant"),
                icon: strokeVariabilityConstantIcon,
              },
              {
                value: "variable",
                text: t("labels.pressure_variable"),
                icon: strokeVariabilityVariableIcon,
              },
            ]}
            value={strokeVariability}
            onChange={(value) => updateData(value)}
          />
        </div>
      </fieldset>
    );
  },
});

export const actionChangeStrokeStyle = register<
  ExcalidrawElement["strokeStyle"]
>({
  name: "changeStrokeStyle",
  label: "labels.strokeStyle",
  trackEvent: false,
  perform: (elements, appState, value) => {
    return {
      elements: changeProperty(elements, appState, (el) =>
        newElementWith(el, {
          strokeStyle: value,
        }),
      ),
      appState: { ...appState, currentItemStrokeStyle: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => (
    <fieldset className="tb-group">
      <legend className="tb-legend">{t("labels.strokeStyle")}</legend>
      <div className="buttonList">
        <RadioSelection
          group="strokeStyle"
          options={[
            {
              value: "solid",
              text: t("labels.strokeStyle_solid"),
              icon: StrokeWidthBaseIcon,
            },
            {
              value: "dashed",
              text: t("labels.strokeStyle_dashed"),
              icon: StrokeStyleDashedIcon,
            },
            {
              value: "dotted",
              text: t("labels.strokeStyle_dotted"),
              icon: StrokeStyleDottedIcon,
            },
          ]}
          value={getFormValue(
            elements,
            app,
            (element) => element.strokeStyle,
            (element) => element.hasOwnProperty("strokeStyle"),
            (hasSelection) =>
              hasSelection ? null : appState.currentItemStrokeStyle,
          )}
          onChange={(value) => updateData(value)}
        />
      </div>
    </fieldset>
  ),
});

export const actionChangeOpacity = register<ExcalidrawElement["opacity"]>({
  name: "changeOpacity",
  label: "labels.opacity",
  trackEvent: false,
  perform: (elements, appState, value) => {
    return {
      elements: changeProperty(
        elements,
        appState,
        (el) =>
          newElementWith(el, {
            opacity: value,
          }),
        true,
      ),
      appState: { ...appState, currentItemOpacity: value },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, app, updateData }) => {
    const opacity = getFormValue(
      elements,
      app,
      (element) => element.opacity,
      true,
      (hasSelection) => (hasSelection ? null : appState.currentItemOpacity),
    );

    return (
      <fieldset className="tb-group">
        <legend className="tb-legend">{t("labels.opacity")}</legend>
        <Range
          label={t("labels.opacity")}
          hideLabel
          value={opacity ?? appState.currentItemOpacity}
          hasCommonValue={opacity !== null}
          onChange={updateData}
          min={0}
          max={100}
          step={10}
          testId="opacity"
        />
      </fieldset>
    );
  },
});

export const actionChangeFontSize = register<ExcalidrawTextElement["fontSize"]>(
  {
    name: "changeFontSize",
    label: "labels.fontSize",
    trackEvent: false,
    perform: (elements, appState, value, app) => {
      return changeFontSize(
        elements,
        appState,
        app,
        () => {
          invariant(value, "actionChangeFontSize: Expected a font size value");
          return value;
        },
        value,
      );
    },
    PanelComponent: ({ elements, appState, updateData, app, data }) => {
      const { isCompact } = getStylesPanelInfo(app);

      return (
        <fieldset className="tb-group">
          <legend className="tb-legend">{t("labels.fontSize")}</legend>
          <div className="buttonList">
            <RadioSelection
              group="font-size"
              options={[
                {
                  value: FONT_SIZES.sm,
                  text: t("labels.small"),
                  icon: FontSizeSmallIcon,
                  testId: "fontSize-small",
                },
                {
                  value: FONT_SIZES.md,
                  text: t("labels.medium"),
                  icon: FontSizeMediumIcon,
                  testId: "fontSize-medium",
                },
                {
                  value: FONT_SIZES.lg,
                  text: t("labels.large"),
                  icon: FontSizeLargeIcon,
                  testId: "fontSize-large",
                },
                {
                  value: FONT_SIZES.xl,
                  text: t("labels.veryLarge"),
                  icon: FontSizeExtraLargeIcon,
                  testId: "fontSize-veryLarge",
                },
              ]}
              value={getFormValue(
                elements,
                app,
                (element) => {
                  const elementsMap = app.scene.getNonDeletedElementsMap();
                  if (isTextElement(element)) {
                    return getBaseFontSize(element, elementsMap);
                  }
                  const boundTextElement = getBoundTextElement(
                    element,
                    elementsMap,
                  );
                  if (boundTextElement) {
                    return getBaseFontSize(boundTextElement, elementsMap);
                  }
                  return null;
                },
                (element) =>
                  isTextElement(element) ||
                  getBoundTextElement(
                    element,
                    app.scene.getNonDeletedElementsMap(),
                  ) !== null,
                (hasSelection) =>
                  hasSelection
                    ? null
                    : appState.currentItemFontSize || DEFAULT_FONT_SIZE,
              )}
              onChange={(value) => {
                withCaretPositionPreservation(
                  () => updateData(value),
                  isCompact,
                  !!appState.editingTextElement,
                  data?.onPreventClose,
                );
              }}
            />
          </div>
        </fieldset>
      );
    },
  },
);

export const actionDecreaseFontSize = register({
  name: "decreaseFontSize",
  label: "labels.decreaseFontSize",
  icon: fontSizeIcon,
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    return changeFontSize(elements, appState, app, (element) =>
      Math.round(
        // get previous value before relative increase (doesn't work fully
        // due to rounding and float precision issues)
        (1 / (1 + FONT_SIZE_RELATIVE_INCREASE_STEP)) *
          getBaseFontSize(element, app.scene.getNonDeletedElementsMap()),
      ),
    );
  },
  keyTest: (event) => {
    return (
      event[KEYS.CTRL_OR_CMD] &&
      event.shiftKey &&
      // KEYS.COMMA needed for MacOS
      (event.key === KEYS.CHEVRON_LEFT || event.key === KEYS.COMMA)
    );
  },
});

export const actionIncreaseFontSize = register({
  name: "increaseFontSize",
  label: "labels.increaseFontSize",
  icon: fontSizeIcon,
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    return changeFontSize(elements, appState, app, (element) =>
      Math.round(
        getBaseFontSize(element, app.scene.getNonDeletedElementsMap()) *
          (1 + FONT_SIZE_RELATIVE_INCREASE_STEP),
      ),
    );
  },
  keyTest: (event) => {
    return (
      event[KEYS.CTRL_OR_CMD] &&
      event.shiftKey &&
      // KEYS.PERIOD needed for MacOS
      (event.key === KEYS.CHEVRON_RIGHT || event.key === KEYS.PERIOD)
    );
  },
});

type ChangeFontFamilyData = Partial<
  Pick<
    AppState,
    "openPopup" | "currentItemFontFamily" | "currentHoveredFontFamily"
  >
> & {
  /** cache of selected & editing elements populated on opened popup */
  cachedElements?: ElementsMap;
  /** flag to reset all elements to their cached versions  */
  resetAll?: true;
  /** flag to reset all containers to their cached versions */
  resetContainers?: true;
};

export const actionChangeFontFamily = register<{
  currentItemFontFamily: any;
  currentHoveredFontFamily: any;
}>({
  name: "changeFontFamily",
  label: "labels.fontFamily",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    const { cachedElements, resetAll, resetContainers, ...nextAppState } =
      value as ChangeFontFamilyData;

    if (resetAll) {
      const nextElements = changeProperty(
        elements,
        appState,
        (element) => {
          const cachedElement = cachedElements?.get(element.id);
          if (cachedElement) {
            const newElement = newElementWith(element, {
              ...cachedElement,
            } as ElementUpdate<NonDeletedExcalidrawElement>);

            return newElement;
          }

          return element;
        },
        true,
      );

      return {
        elements: nextElements,
        appState: {
          ...appState,
          ...nextAppState,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      };
    }

    invariant(value, "actionChangeFontFamily: value must be defined");

    const { currentItemFontFamily, currentHoveredFontFamily } = value;

    let nextCaptureUpdateAction: CaptureUpdateActionType =
      CaptureUpdateAction.EVENTUALLY;
    let nextFontFamily: FontFamilyValues | undefined;
    let skipOnHoverRender = false;

    if (currentItemFontFamily) {
      nextFontFamily = currentItemFontFamily;
      nextCaptureUpdateAction = CaptureUpdateAction.IMMEDIATELY;
    } else if (currentHoveredFontFamily) {
      nextFontFamily = currentHoveredFontFamily;
      nextCaptureUpdateAction = CaptureUpdateAction.EVENTUALLY;

      const selectedTextElements = getSelectedElements(elements, appState, {
        includeBoundTextElement: true,
      }).filter((element) => isTextElement(element));

      // skip on hover re-render for more than 200 text elements or for text element with more than 5000 chars combined
      if (selectedTextElements.length > 200) {
        skipOnHoverRender = true;
      } else {
        let i = 0;
        let textLengthAccumulator = 0;

        while (
          i < selectedTextElements.length &&
          textLengthAccumulator < 5000
        ) {
          const textElement = selectedTextElements[i] as ExcalidrawTextElement;
          textLengthAccumulator += textElement?.originalText.length || 0;
          i++;
        }

        if (textLengthAccumulator > 5000) {
          skipOnHoverRender = true;
        }
      }
    }

    const result = {
      appState: {
        ...appState,
        ...nextAppState,
      },
      captureUpdate: nextCaptureUpdateAction,
    };

    if (nextFontFamily && !skipOnHoverRender) {
      const elementContainerMapping = new Map<
        ExcalidrawTextElement,
        ExcalidrawElement | null
      >();
      let uniqueChars = new Set<string>();
      let skipFontFaceCheck = false;

      const fontsCache = Array.from(Fonts.loadedFontsCache.values());
      const fontFamily = Object.entries(FONT_FAMILY).find(
        ([_, value]) => value === nextFontFamily,
      )?.[0];

      // skip `document.font.check` check on hover, if at least one font family has loaded as it's super slow (could result in slightly different bbox, which is fine)
      if (
        currentHoveredFontFamily &&
        fontFamily &&
        fontsCache.some((sig) => sig.startsWith(fontFamily))
      ) {
        skipFontFaceCheck = true;
      }

      // following causes re-render so make sure we changed the family
      // otherwise it could cause unexpected issues, such as preventing opening the popover when in wysiwyg
      Object.assign(result, {
        elements: changeProperty(
          elements,
          appState,
          (oldElement) => {
            if (
              isTextElement(oldElement) &&
              (oldElement.fontFamily !== nextFontFamily ||
                currentItemFontFamily) // force update on selection
            ) {
              const newElement: ExcalidrawTextElement = newElementWith(
                oldElement,
                {
                  fontFamily: nextFontFamily,
                  lineHeight: getLineHeight(nextFontFamily!),
                },
              );

              const cachedContainer =
                cachedElements?.get(oldElement.containerId || "") || {};

              const container = app.scene.getContainerElement(oldElement);

              if (resetContainers && container && cachedContainer) {
                // reset the container back to it's cached version
                app.scene.mutateElement(container, { ...cachedContainer });
              }

              if (!skipFontFaceCheck) {
                uniqueChars = new Set([
                  ...uniqueChars,
                  ...Array.from(newElement.originalText),
                ]);
              }

              elementContainerMapping.set(newElement, container);

              return newElement;
            }

            return oldElement;
          },
          true,
        ),
      });

      // size is irrelevant, but necessary
      const fontString = `10px ${getFontFamilyString({
        fontFamily: nextFontFamily,
      })}`;
      const chars = Array.from(uniqueChars.values()).join();
      const ownerDocument = app.props.ownerDocument ?? document;

      if (skipFontFaceCheck || ownerDocument.fonts.check(fontString, chars)) {
        // we either skip the check (have at least one font face loaded) or do the check and find out all the font faces have loaded
        for (const [element, container] of elementContainerMapping) {
          // trigger synchronous redraw
          redrawTextBoundingBox(element, container, app.scene);
        }
      } else {
        // otherwise try to load all font faces for the given chars and redraw elements once our font faces loaded
        ownerDocument.fonts.load(fontString, chars).then((fontFaces) => {
          for (const [element, container] of elementContainerMapping) {
            // use latest element state to ensure we don't have closure over an old instance in order to avoid possible race conditions (i.e. font faces load out-of-order while rapidly switching fonts)
            const latestElement = app.scene.getElement(element.id);
            const latestContainer = container
              ? app.scene.getElement(container.id)
              : null;

            if (latestElement) {
              // trigger async redraw
              redrawTextBoundingBox(
                latestElement as ExcalidrawTextElement,
                latestContainer,
                app.scene,
              );
            }
          }

          // trigger update once we've mutated all the elements, which also updates our cache
          app.fonts.onLoaded(fontFaces);
        });
      }
    }

    return result;
  },
  PanelComponent: ({ elements, appState, app, updateData }) => {
    const cachedElementsRef = useRef<ElementsMap>(new Map());
    const prevSelectedFontFamilyRef = useRef<number | null>(null);
    // relying on state batching as multiple `FontPicker` handlers could be called in rapid succession and we want to combine them
    const [batchedData, setBatchedData] = useState<ChangeFontFamilyData>({});
    const isUnmounted = useRef(true);
    const { isCompact } = getStylesPanelInfo(app);

    const selectedFontFamily = useMemo(() => {
      const getFontFamily = (
        elementsArray: readonly ExcalidrawElement[],
        elementsMap: ElementsMap,
      ) =>
        getFormValue(
          elementsArray,
          app,
          (element) => {
            if (isTextElement(element)) {
              return element.fontFamily;
            }
            const boundTextElement = getBoundTextElement(element, elementsMap);
            if (boundTextElement) {
              return boundTextElement.fontFamily;
            }
            return null;
          },
          (element) =>
            isTextElement(element) ||
            getBoundTextElement(element, elementsMap) !== null,
          (hasSelection) =>
            hasSelection
              ? null
              : appState.currentItemFontFamily || DEFAULT_FONT_FAMILY,
        );

      // popup opened, use cached elements
      if (
        batchedData.openPopup === "fontFamily" &&
        appState.openPopup === "fontFamily"
      ) {
        return getFontFamily(
          Array.from(cachedElementsRef.current?.values() ?? []),
          cachedElementsRef.current,
        );
      }

      // popup closed, use all elements
      if (!batchedData.openPopup && appState.openPopup !== "fontFamily") {
        return getFontFamily(elements, app.scene.getNonDeletedElementsMap());
      }

      // popup props are not in sync, hence we are in the middle of an update, so keeping the previous value we've had
      return prevSelectedFontFamilyRef.current;
    }, [batchedData.openPopup, appState, elements, app]);

    useEffect(() => {
      prevSelectedFontFamilyRef.current = selectedFontFamily;
    }, [selectedFontFamily]);

    useEffect(() => {
      if (Object.keys(batchedData).length) {
        updateData(batchedData);
        // reset the data after we've used the data
        setBatchedData({});
      }
      // call update only on internal state changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batchedData]);

    useEffect(() => {
      isUnmounted.current = false;

      return () => {
        isUnmounted.current = true;
      };
    }, []);

    return (
      <FontPicker
        isOpened={appState.openPopup === "fontFamily"}
        selectedFontFamily={selectedFontFamily}
        hoveredFontFamily={appState.currentHoveredFontFamily}
        compactMode
        onSelect={(fontFamily) => {
          withCaretPositionPreservation(
            () => {
              setBatchedData({
                openPopup: null,
                currentHoveredFontFamily: null,
                currentItemFontFamily: fontFamily,
              });
              // defensive clear so immediate close won't abuse the cached elements
              cachedElementsRef.current.clear();
            },
            isCompact,
            !!appState.editingTextElement,
          );
        }}
        onHover={(fontFamily) => {
          setBatchedData({
            currentHoveredFontFamily: fontFamily,
            cachedElements: new Map(cachedElementsRef.current),
            resetContainers: true,
          });
        }}
        onLeave={() => {
          setBatchedData({
            currentHoveredFontFamily: null,
            cachedElements: new Map(cachedElementsRef.current),
            resetAll: true,
          });
        }}
        onPopupChange={(open) => {
          if (open) {
            // open, populate the cache from scratch
            cachedElementsRef.current.clear();

            const { editingTextElement } = appState;

            // still check type to be safe
            if (editingTextElement?.type === "text") {
              // retrieve the latest version from the scene, as `editingTextElement` isn't mutated
              const latesteditingTextElement = app.scene.getElement(
                editingTextElement.id,
              );

              // inside the wysiwyg editor
              cachedElementsRef.current.set(
                editingTextElement.id,
                newElementWith(
                  latesteditingTextElement || editingTextElement,
                  {},
                  true,
                ),
              );
            } else {
              const selectedElements = getSelectedElements(elements, appState, {
                includeBoundTextElement: true,
              });

              for (const element of selectedElements) {
                cachedElementsRef.current.set(
                  element.id,
                  newElementWith(element, {}, true),
                );
              }
            }

            setBatchedData({
              ...batchedData,
              openPopup: "fontFamily",
            });
          } else {
            const fontFamilyData = {
              currentHoveredFontFamily: null,
              cachedElements: new Map(cachedElementsRef.current),
              resetAll: true,
            } as ChangeFontFamilyData;

            setBatchedData({
              ...fontFamilyData,
            });
            cachedElementsRef.current.clear();

            // Refocus text editor when font picker closes if we were editing text
            if (isCompact && appState.editingTextElement) {
              restoreCaretPosition(null, app.ownerDocument); // Just refocus without saved position
            }
          }
        }}
      />
    );
  },
});

export const actionChangeTextAlign = register<TextAlign>({
  name: "changeTextAlign",
  label: "Change text alignment",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    return {
      elements: changeProperty(
        elements,
        appState,
        (oldElement) => {
          if (isTextElement(oldElement)) {
            const newElement: ExcalidrawTextElement = newElementWith(
              oldElement,
              { textAlign: value },
            );
            redrawTextBoundingBox(
              newElement,
              app.scene.getContainerElement(oldElement),
              app.scene,
            );
            return newElement;
          }

          return oldElement;
        },
        true,
      ),
      appState: {
        ...appState,
        currentItemTextAlign: value,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const { isCompact } = getStylesPanelInfo(app);

    return (
      <fieldset className="tb-group">
        <legend className="tb-legend">{t("labels.textAlign")}</legend>
        <div className="buttonList">
          <RadioSelection<TextAlign | false>
            group="text-align"
            options={[
              {
                value: "left",
                text: t("labels.left"),
                icon: TextAlignLeftIcon,
                testId: "align-left",
              },
              {
                value: "center",
                text: t("labels.center"),
                icon: TextAlignCenterIcon,
                testId: "align-horizontal-center",
              },
              {
                value: "right",
                text: t("labels.right"),
                icon: TextAlignRightIcon,
                testId: "align-right",
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) => {
                if (isTextElement(element)) {
                  return element.textAlign;
                }
                const boundTextElement = getBoundTextElement(
                  element,
                  elementsMap,
                );
                if (boundTextElement) {
                  return boundTextElement.textAlign;
                }
                return null;
              },
              (element) =>
                isTextElement(element) ||
                getBoundTextElement(element, elementsMap) !== null,
              (hasSelection) =>
                hasSelection ? null : appState.currentItemTextAlign,
            )}
            onChange={(value) => {
              withCaretPositionPreservation(
                () => updateData(value),
                isCompact,
                !!appState.editingTextElement,
                data?.onPreventClose,
              );
            }}
          />
        </div>
      </fieldset>
    );
  },
});

export const actionChangeVerticalAlign = register<VerticalAlign>({
  name: "changeVerticalAlign",
  label: "Change vertical alignment",
  trackEvent: { category: "element" },
  perform: (elements, appState, value, app) => {
    return {
      elements: changeProperty(
        elements,
        appState,
        (oldElement) => {
          if (isTextElement(oldElement)) {
            const newElement: ExcalidrawTextElement = newElementWith(
              oldElement,
              { verticalAlign: value },
            );

            redrawTextBoundingBox(
              newElement,
              app.scene.getContainerElement(oldElement),
              app.scene,
            );
            return newElement;
          }

          return oldElement;
        },
        true,
      ),
      appState: {
        ...appState,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, data }) => {
    const { isCompact } = getStylesPanelInfo(app);
    return (
      <fieldset className="tb-group">
        <legend className="tb-legend">{t("labels.verticalAlign")}</legend>
        <div className="buttonList">
          <RadioSelection<VerticalAlign | false>
            group="text-align"
            options={[
              {
                value: VERTICAL_ALIGN.TOP,
                text: t("labels.alignTop"),
                icon: <TextAlignTopIcon theme={appState.theme} />,
                testId: "align-top",
              },
              {
                value: VERTICAL_ALIGN.MIDDLE,
                text: t("labels.centerVertically"),
                icon: <TextAlignMiddleIcon theme={appState.theme} />,
                testId: "align-middle",
              },
              {
                value: VERTICAL_ALIGN.BOTTOM,
                text: t("labels.alignBottom"),
                icon: <TextAlignBottomIcon theme={appState.theme} />,
                testId: "align-bottom",
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) => {
                if (isTextElement(element) && element.containerId) {
                  return element.verticalAlign;
                }
                const boundTextElement = getBoundTextElement(
                  element,
                  app.scene.getNonDeletedElementsMap(),
                );
                if (boundTextElement) {
                  return boundTextElement.verticalAlign;
                }
                return null;
              },
              (element) =>
                isTextElement(element) ||
                getBoundTextElement(
                  element,
                  app.scene.getNonDeletedElementsMap(),
                ) !== null,
              (hasSelection) => (hasSelection ? null : VERTICAL_ALIGN.MIDDLE),
            )}
            onChange={(value) => {
              withCaretPositionPreservation(
                () => updateData(value),
                isCompact,
                !!appState.editingTextElement,
                data?.onPreventClose,
              );
            }}
          />
        </div>
      </fieldset>
    );
  },
});

export const actionChangeRoundness = register<"sharp" | "round">({
  name: "changeRoundness",
  label: "Change edge roundness",
  trackEvent: false,
  perform: (elements, appState, value) => {
    return {
      elements: changeProperty(elements, appState, (el) => {
        if (isElbowArrow(el)) {
          return el;
        }

        const nextElement = newElementWith(el, {
          roundness:
            value === "round"
              ? {
                  type: isUsingAdaptiveRadius(el.type)
                    ? ROUNDNESS.ADAPTIVE_RADIUS
                    : ROUNDNESS.PROPORTIONAL_RADIUS,
                }
              : null,
        });

        return nextElement;
      }),
      appState: {
        ...appState,
        currentItemRoundness: value,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app, renderAction }) => {
    const targetElements = getTargetElements(
      getNonDeletedElements(elements),
      appState,
    );

    const hasLegacyRoundness = targetElements.some(
      (el) => el.roundness?.type === ROUNDNESS.LEGACY,
    );

    return (
      <fieldset className="tb-group">
        <legend className="tb-legend">{t("labels.edges")}</legend>
        <div className="buttonList">
          <RadioSelection
            group="edges"
            options={[
              {
                value: "sharp",
                text: t("labels.sharp"),
                icon: EdgeSharpIcon,
              },
              {
                value: "round",
                text: t("labels.round"),
                icon: EdgeRoundIcon,
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) =>
                hasLegacyRoundness
                  ? null
                  : element.roundness
                  ? "round"
                  : "sharp",
              (element) =>
                !isArrowElement(element) && element.hasOwnProperty("roundness"),
              (hasSelection) =>
                hasSelection ? null : appState.currentItemRoundness,
            )}
            onChange={(value) => updateData(value)}
          />
          {renderAction("togglePolygon")}
        </div>
      </fieldset>
    );
  },
});

const getArrowheadOptions = (flip: boolean) => {
  return {
    visibleSections: [
      {
        name: "default",
        options: [
          {
            value: null,
            text: t("labels.arrowhead_none"),
            keyBinding: "q",
            icon: <ArrowheadNoneIcon flip={flip} />,
          },
          {
            value: "arrow",
            text: t("labels.arrowhead_arrow"),
            keyBinding: "w",
            icon: <ArrowheadArrowIcon flip={flip} />,
          },
          {
            value: "triangle",
            text: t("labels.arrowhead_triangle"),
            icon: <ArrowheadTriangleIcon flip={flip} />,
            keyBinding: "e",
          },
          {
            value: "triangle_outline",
            text: t("labels.arrowhead_triangle_outline"),
            icon: <ArrowheadTriangleOutlineIcon flip={flip} />,
            keyBinding: "r",
          },
        ],
      },
    ],
    hiddenSections: [
      {
        name: "default",
        options: [
          {
            value: "circle",
            text: t("labels.arrowhead_circle"),
            keyBinding: "a",
            icon: <ArrowheadCircleIcon flip={flip} />,
          },
          {
            value: "circle_outline",
            text: t("labels.arrowhead_circle_outline"),
            keyBinding: "s",
            icon: <ArrowheadCircleOutlineIcon flip={flip} />,
          },
          {
            value: "diamond",
            text: t("labels.arrowhead_diamond"),
            icon: <ArrowheadDiamondIcon flip={flip} />,
            keyBinding: "d",
          },
          {
            value: "diamond_outline",
            text: t("labels.arrowhead_diamond_outline"),
            icon: <ArrowheadDiamondOutlineIcon flip={flip} />,
            keyBinding: "f",
          },
          {
            value: "bar",
            text: t("labels.arrowhead_bar"),
            keyBinding: "z",
            icon: <ArrowheadBarIcon flip={flip} />,
          },
          {
            value: "x_arrow",
            text: t("labels.arrowhead_x_arrow"),
            keyBinding: null,
            icon: <ArrowheadXArrowIcon flip={flip} />,
          },
        ],
      },
      {
        name: t("labels.cardinality"),
        options: [
          {
            value: "cardinality_one",
            text: t("labels.arrowhead_cardinality_one"),
            icon: <ArrowheadCardinalityOneIcon flip={flip} />,
            keyBinding: "x",
          },
          {
            value: "cardinality_many",
            text: t("labels.arrowhead_cardinality_many"),
            icon: <ArrowheadCardinalityManyIcon flip={flip} />,
            keyBinding: "c",
          },
          {
            value: "cardinality_one_or_many",
            text: t("labels.arrowhead_cardinality_one_or_many"),
            icon: <ArrowheadCardinalityOneOrManyIcon flip={flip} />,
            keyBinding: "v",
          },
          {
            value: "cardinality_exactly_one",
            text: t("labels.arrowhead_cardinality_exactly_one"),
            icon: <ArrowheadCardinalityExactlyOneIcon flip={flip} />,
            keyBinding: null,
          },
          {
            value: "cardinality_zero_or_one",
            text: t("labels.arrowhead_cardinality_zero_or_one"),
            icon: <ArrowheadCardinalityZeroOrOneIcon flip={flip} />,
            keyBinding: null,
          },
          {
            value: "cardinality_zero_or_many",
            text: t("labels.arrowhead_cardinality_zero_or_many"),
            icon: <ArrowheadCardinalityZeroOrManyIcon flip={flip} />,
            keyBinding: null,
          },
        ],
      },
    ],
  } as const;
};

export const actionChangeArrowhead = register<{
  position: "start" | "end";
  type: Arrowhead;
}>({
  name: "changeArrowhead",
  label: "Change arrowheads",
  trackEvent: false,
  perform: (elements, appState, value) => {
    invariant(value, "actionChangeArrowhead: value must be defined");

    return {
      elements: changeProperty(elements, appState, (el) => {
        if (isLinearElement(el)) {
          const { position, type } = value;

          if (position === "start") {
            const element: ExcalidrawLinearElement = newElementWith(el, {
              startArrowhead: type,
            });
            return element;
          } else if (position === "end") {
            const element: ExcalidrawLinearElement = newElementWith(el, {
              endArrowhead: type,
            });
            return element;
          }
        }

        return el;
      }),
      appState: {
        ...appState,
        [value.position === "start"
          ? "currentItemStartArrowhead"
          : "currentItemEndArrowhead"]: value.type,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    const isRTL = getLanguage().rtl;
    const startArrowheadOptions = useMemo(
      () => getArrowheadOptions(!isRTL),
      [isRTL],
    );
    const endArrowheadOptions = useMemo(
      () => getArrowheadOptions(!!isRTL),
      [isRTL],
    );

    // 端点库（设计稿「箭头端点库」）：顶部「起点/终点」双触发器切换当前编辑
    // 的端点，下方共享同一网格（弹层内不再开弹层）；默认编辑起点
    const [activePosition, setActivePosition] = useState<"start" | "end">(
      "start",
    );

    const startValue = getFormValue<Arrowhead | null>(
      elements,
      app,
      (element) =>
        isLinearElement(element) && canHaveArrowheads(element.type)
          ? element.startArrowhead
          : appState.currentItemStartArrowhead,
      true,
      (hasSelection) =>
        hasSelection ? null : appState.currentItemStartArrowhead,
    );
    const endValue = getFormValue<Arrowhead | null>(
      elements,
      app,
      (element) =>
        isLinearElement(element) && canHaveArrowheads(element.type)
          ? element.endArrowhead
          : appState.currentItemEndArrowhead,
      true,
      (hasSelection) =>
        hasSelection ? null : appState.currentItemEndArrowhead,
    );

    const flattenSections = (
      sections: readonly {
        readonly options: ReadonlyArray<IconGridOption<Arrowhead | null>>;
      }[],
    ) => sections.flatMap((section) => section.options);

    // 常用 10 枚 = 原可见区（无/箭头/三角/空心三角）+ 原隐藏前区
    // （圆点/空心圆/菱形/空心菱形/竖线/X 形）；关系型 6 枚进折叠区
    const activeOptions =
      activePosition === "start" ? startArrowheadOptions : endArrowheadOptions;
    const commonOptions = flattenSections([
      activeOptions.visibleSections[0],
      activeOptions.hiddenSections[0],
    ]);
    const relationalOptions = flattenSections([
      activeOptions.hiddenSections[1],
    ]);

    return (
      <fieldset className="tb-group">
        <legend className="tb-legend">{t("labels.arrowheads")}</legend>
        <div className="tb-heads">
          {(["start", "end"] as const).map((position) => {
            const options =
              position === "start"
                ? startArrowheadOptions
                : endArrowheadOptions;
            const current = findIconOption(
              flattenSections([
                ...options.visibleSections,
                ...options.hiddenSections,
              ]),
              (option) =>
                option.value === (position === "start" ? startValue : endValue),
            );
            const positionLabel = t(
              position === "start"
                ? "labels.arrowheadStart"
                : "labels.arrowheadEnd",
            );
            return (
              <button
                key={position}
                type="button"
                className={clsx("tb-headtrig", {
                  "is-on": activePosition === position,
                })}
                aria-pressed={activePosition === position}
                title={`${positionLabel} · ${current?.text ?? ""}`}
                aria-label={`${positionLabel} · ${current?.text ?? ""}`}
                onClick={() => setActivePosition(position)}
              >
                {current?.icon}
                <span>
                  {positionLabel} · {current?.text}
                </span>
              </button>
            );
          })}
        </div>
        <IconOptionGrid
          label={t("labels.arrowheads")}
          value={activePosition === "start" ? startValue : endValue}
          commonOptions={commonOptions}
          commonLabel={t("labels.arrowheadsCommon")}
          collapsibleOptions={relationalOptions}
          collapsibleLabel={t("labels.arrowheadsRelational")}
          collapsePersistKey="excalidraw-arrowheads-relational-open"
          onChange={(type) => updateData({ position: activePosition, type })}
          onClose={() => app.setState({ openPopup: null })}
        />
      </fieldset>
    );
  },
});

export const actionChangeArrowProperties = register({
  name: "changeArrowProperties",
  label: "Change arrow properties",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    // This action doesn't perform any changes directly
    // It's just a container for the arrow type and arrowhead actions
    return false;
  },
  PanelComponent: ({ elements, appState, updateData, app, renderAction }) => {
    // 场景矩阵箭头分组顺序：箭头类型在前、端点在后（atype|heads）
    return (
      <div className="selected-shape-actions">
        {renderAction("changeArrowType")}
        {renderAction("changeArrowhead")}
      </div>
    );
  },
});

export const actionChangeArrowType = register<keyof typeof ARROW_TYPE>({
  name: "changeArrowType",
  label: "Change arrow types",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    const newElements = changeProperty(elements, appState, (el) => {
      if (!isArrowElement(el)) {
        return el;
      }
      const elementsMap = app.scene.getNonDeletedElementsMap();
      const startPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
        el,
        0,
        elementsMap,
      );
      const endPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
        el,
        -1,
        elementsMap,
      );
      let newElement = newElementWith(el, {
        x: value === ARROW_TYPE.elbow ? startPoint[0] : el.x,
        y: value === ARROW_TYPE.elbow ? startPoint[1] : el.y,
        roundness:
          value === ARROW_TYPE.round
            ? {
                type: ROUNDNESS.PROPORTIONAL_RADIUS,
              }
            : null,
        elbowed: value === ARROW_TYPE.elbow,
        angle: value === ARROW_TYPE.elbow ? (0 as Radians) : el.angle,
        points:
          value === ARROW_TYPE.elbow || el.elbowed
            ? [
                LinearElementEditor.pointFromAbsoluteCoords(
                  {
                    ...el,
                    x: startPoint[0],
                    y: startPoint[1],
                    angle: 0 as Radians,
                  },
                  startPoint,
                  elementsMap,
                ),
                LinearElementEditor.pointFromAbsoluteCoords(
                  {
                    ...el,
                    x: startPoint[0],
                    y: startPoint[1],
                    angle: 0 as Radians,
                  },
                  endPoint,
                  elementsMap,
                ),
              ]
            : el.points,
      });

      if (isElbowArrow(newElement)) {
        newElement.fixedSegments = null;

        const elementsMap = app.scene.getNonDeletedElementsMap();

        app.dismissLinearEditor();

        const startGlobalPoint =
          LinearElementEditor.getPointAtIndexGlobalCoordinates(
            newElement,
            0,
            elementsMap,
          );
        const endGlobalPoint =
          LinearElementEditor.getPointAtIndexGlobalCoordinates(
            newElement,
            -1,
            elementsMap,
          );
        const startElement =
          newElement.startBinding &&
          (elementsMap.get(
            newElement.startBinding.elementId,
          ) as ExcalidrawBindableElement);
        const endElement =
          newElement.endBinding &&
          (elementsMap.get(
            newElement.endBinding.elementId,
          ) as ExcalidrawBindableElement);

        const startBinding =
          startElement && newElement.startBinding
            ? {
                // @ts-ignore TS cannot discern check above
                ...newElement.startBinding!,
                ...calculateFixedPointForElbowArrowBinding(
                  newElement,
                  startElement,
                  "start",
                  elementsMap,
                  appState.isBindingEnabled,
                ),
              }
            : null;
        const endBinding =
          endElement && newElement.endBinding
            ? {
                // @ts-ignore TS cannot discern check above
                ...newElement.endBinding,
                ...calculateFixedPointForElbowArrowBinding(
                  newElement,
                  endElement,
                  "end",
                  elementsMap,
                  appState.isBindingEnabled,
                ),
              }
            : null;

        newElement = {
          ...newElement,
          startBinding,
          endBinding,
          ...updateElbowArrowPoints(newElement, elementsMap, {
            points: [startGlobalPoint, endGlobalPoint].map(
              (p): LocalPoint =>
                pointFrom(p[0] - newElement.x, p[1] - newElement.y),
            ),
            startBinding,
            endBinding,
            fixedSegments: null,
          }),
        } as typeof newElement;
      } else {
        const elementsMap = app.scene.getNonDeletedElementsMap();
        if (newElement.startBinding) {
          const startElement = elementsMap.get(
            newElement.startBinding.elementId,
          ) as NonDeleted<ExcalidrawBindableElement>;
          if (startElement) {
            bindBindingElement(
              newElement,
              startElement,
              appState.bindMode === "inside" ? "inside" : "orbit",
              "start",
              app.scene,
            );
          }
        }
        if (newElement.endBinding) {
          const endElement = elementsMap.get(
            newElement.endBinding.elementId,
          ) as NonDeleted<ExcalidrawBindableElement>;
          if (endElement) {
            bindBindingElement(
              newElement,
              endElement,
              appState.bindMode === "inside" ? "inside" : "orbit",
              "end",
              app.scene,
            );
          }
        }
      }

      return newElement;
    });

    const newState = {
      ...appState,
      currentItemArrowType: value,
    };

    // Change the arrow type and update any other state settings for
    // the arrow.
    const selectedId = appState.selectedLinearElement?.elementId;
    if (selectedId) {
      const selected = newElements.find((el) => el.id === selectedId);
      if (selected) {
        newState.selectedLinearElement = new LinearElementEditor(
          selected as NonDeleted<ExcalidrawLinearElement>,
          arrayToMap(elements),
        );
      }
    }

    return {
      elements: newElements,
      appState: newState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => {
    return (
      <fieldset className="tb-group">
        <legend className="tb-legend">{t("labels.arrowtypes")}</legend>
        <div className="buttonList">
          <RadioSelection
            group="arrowtypes"
            options={[
              {
                value: ARROW_TYPE.sharp,
                text: t("labels.arrowtype_sharp"),
                icon: sharpArrowIcon,
                testId: "sharp-arrow",
              },
              {
                value: ARROW_TYPE.round,
                text: t("labels.arrowtype_round"),
                icon: roundArrowIcon,
                testId: "round-arrow",
              },
              {
                value: ARROW_TYPE.elbow,
                text: t("labels.arrowtype_elbowed"),
                icon: elbowArrowIcon,
                testId: "elbow-arrow",
              },
            ]}
            value={getFormValue(
              elements,
              app,
              (element) => {
                if (isArrowElement(element)) {
                  return element.elbowed
                    ? ARROW_TYPE.elbow
                    : element.roundness
                    ? ARROW_TYPE.round
                    : ARROW_TYPE.sharp;
                }

                return null;
              },
              (element) => isArrowElement(element),
              (hasSelection) =>
                hasSelection ? null : appState.currentItemArrowType,
            )}
            onChange={(value) => updateData(value)}
          />
        </div>
      </fieldset>
    );
  },
});
