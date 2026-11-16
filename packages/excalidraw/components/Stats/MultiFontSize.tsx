import {
  getTextElementStyle,
  isTextElement,
  refreshTextDimensions,
  getTextElementStylePatch,
} from "@excalidraw/element";

import { isInGroup } from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import type { Scene, TextBlockStyle, TextRegionKey } from "@excalidraw/element";

import {
  applyEmbeddedTextLayout,
  getElementEmbeddedTextTarget,
  getTextStyleTargetStyle,
  updateEmbeddedTextStyles,
} from "../app/textStyleTargets";
import { fontSizeIcon } from "../icons";

import StatsDragInput from "./DragInput";
import { getStepSizedValue } from "./utils";

import type { DragInputCallbackType } from "./DragInput";
import type { AppState } from "../../types";

interface MultiFontSizeProps {
  elements: readonly NonDeletedExcalidrawElement[];
  scene: Scene;
  elementsMap: NonDeletedSceneElementsMap;
  appState: AppState;
  property: "fontSize";
}

type EmbeddedFontSizeTarget = {
  element: NonDeletedExcalidrawElement;
  region: TextRegionKey;
  style: TextBlockStyle;
};

const MIN_FONT_SIZE = 4;
const STEP_SIZE = 4;

const getApplicableTextElements = (
  elements: readonly (NonDeletedExcalidrawElement | undefined)[],
  elementsMap: NonDeletedSceneElementsMap,
) =>
  elements.reduce(
    (acc: NonDeleted<ExcalidrawTextElement>[], el) => {
      if (!el || isInGroup(el)) {
        return acc;
      }
      if (isTextElement(el)) {
        acc.push(el);
      }
      return acc;
    },

    [],
  );

const getApplicableEmbeddedTargets = (
  elements: readonly (NonDeletedExcalidrawElement | undefined)[],
): EmbeddedFontSizeTarget[] =>
  elements.reduce((acc: EmbeddedFontSizeTarget[], el) => {
    if (!el || isInGroup(el)) {
      return acc;
    }
    const target = getElementEmbeddedTextTarget(el);
    const style = target ? getTextStyleTargetStyle(el, target.region) : null;
    if (target && style) {
      acc.push({ element: el, region: target.region, style });
    }
    return acc;
  }, []);

const getNextFontSize = (
  originalFontSize: number,
  accumulatedChange: number,
  shouldChangeByStepSize: boolean,
) => {
  let nextFontSize = Math.max(
    originalFontSize + Math.round(accumulatedChange),
    MIN_FONT_SIZE,
  );
  if (shouldChangeByStepSize) {
    nextFontSize = getStepSizedValue(nextFontSize, STEP_SIZE);
  }
  return nextFontSize;
};

const handleFontSizeChange: DragInputCallbackType<
  MultiFontSizeProps["property"]
> = ({
  accumulatedChange,
  originalElements,
  shouldChangeByStepSize,
  nextValue,
  scene,
}) => {
  const elementsMap = scene.getNonDeletedElementsMap();

  if (nextValue) {
    const nextFontSize = Math.max(Math.round(nextValue), MIN_FONT_SIZE);

    for (const originalElement of originalElements) {
      const latestElement = elementsMap.get(originalElement.id);
      if (!latestElement) {
        continue;
      }

      if (isTextElement(latestElement)) {
        scene.mutateElement(
          latestElement,
          getTextElementStylePatch(latestElement, { fontSize: nextFontSize }),
        );
        const refreshed = refreshTextDimensions(latestElement, elementsMap);
        if (refreshed) {
          const { text: _displayText, ...dimensions } = refreshed;
          scene.mutateElement(latestElement, dimensions);
        }
        continue;
      }

      const target = getElementEmbeddedTextTarget(latestElement);
      if (!target) {
        continue;
      }
      updateEmbeddedTextStyles(scene, [
        {
          elementId: latestElement.id,
          region: target.region,
          style: { fontSize: nextFontSize },
        },
      ]);
      applyEmbeddedTextLayout(scene, latestElement.id, target.region);
    }

    scene.triggerUpdate();
    return;
  }

  for (const originalElement of originalElements) {
    const latestElement = elementsMap.get(originalElement.id);
    if (!latestElement) {
      continue;
    }

    if (isTextElement(latestElement)) {
      const originalFontSize = Math.round(
        getTextElementStyle(originalElement as ExcalidrawTextElement).fontSize,
      );
      const nextFontSize = getNextFontSize(
        originalFontSize,
        accumulatedChange,
        shouldChangeByStepSize,
      );
      scene.mutateElement(
        latestElement,
        getTextElementStylePatch(latestElement, { fontSize: nextFontSize }),
      );
      const refreshed = refreshTextDimensions(latestElement, elementsMap);
      if (refreshed) {
        const { text: _displayText, ...dimensions } = refreshed;
        scene.mutateElement(latestElement, dimensions);
      }
      continue;
    }

    const target = getElementEmbeddedTextTarget(latestElement);
    const originalStyle = target
      ? getTextStyleTargetStyle(originalElement, target.region)
      : null;
    if (!target || !originalStyle) {
      continue;
    }
    const nextFontSize = getNextFontSize(
      Math.round(originalStyle.fontSize),
      accumulatedChange,
      shouldChangeByStepSize,
    );
    updateEmbeddedTextStyles(scene, [
      {
        elementId: latestElement.id,
        region: target.region,
        style: { fontSize: nextFontSize },
      },
    ]);
    applyEmbeddedTextLayout(scene, latestElement.id);
  }

  scene.triggerUpdate();
};

const MultiFontSize = ({
  elements,
  scene,
  appState,
  property,
  elementsMap,
}: MultiFontSizeProps) => {
  const latestTextElements = getApplicableTextElements(elements, elementsMap);
  const embeddedTargets = getApplicableEmbeddedTargets(elements);

  if (!latestTextElements.length && !embeddedTargets.length) {
    return null;
  }

  const fontSizes = [
    ...latestTextElements.map(
      (textEl) => Math.round(getTextElementStyle(textEl).fontSize * 10) / 10,
    ),
    ...embeddedTargets.map(
      (target) => Math.round(target.style.fontSize * 10) / 10,
    ),
  ];
  const value = new Set(fontSizes).size === 1 ? fontSizes[0] : "Mixed";
  const editable = fontSizes.length > 0;

  return (
    <StatsDragInput
      label="F"
      icon={fontSizeIcon}
      elements={[
        ...latestTextElements,
        ...embeddedTargets.map((target) => target.element),
      ]}
      dragInputCallback={handleFontSizeChange}
      value={value}
      editable={editable}
      scene={scene}
      property={property}
      appState={appState}
    />
  );
};

export default MultiFontSize;
