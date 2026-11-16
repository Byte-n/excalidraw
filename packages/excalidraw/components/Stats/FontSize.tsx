import {
  getTextElementStyle,
  isTextElement,
  refreshTextDimensions,
  getTextElementStylePatch,
} from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { Scene } from "@excalidraw/element";

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

interface FontSizeProps {
  element: NonDeletedExcalidrawElement;
  scene: Scene;
  appState: AppState;
  property: "fontSize";
}

const MIN_FONT_SIZE = 4;
const STEP_SIZE = 4;

const handleFontSizeChange: DragInputCallbackType<
  FontSizeProps["property"]
> = ({
  accumulatedChange,
  originalElements,
  shouldChangeByStepSize,
  nextValue,
  scene,
}) => {
  const elementsMap = scene.getNonDeletedElementsMap();

  const origElement = originalElements[0];
  if (!origElement) {
    return;
  }
  const latestElement = elementsMap.get(origElement.id);
  if (!latestElement) {
    return;
  }

  if (isTextElement(latestElement)) {
    let nextFontSize;

    if (nextValue !== undefined) {
      nextFontSize = Math.max(Math.round(nextValue), MIN_FONT_SIZE);
    } else {
      const originalFontSize = Math.round(
        getTextElementStyle(origElement as ExcalidrawTextElement).fontSize,
      );
      const changeInFontSize = Math.round(accumulatedChange);
      nextFontSize = Math.max(
        originalFontSize + changeInFontSize,
        MIN_FONT_SIZE,
      );
      if (shouldChangeByStepSize) {
        nextFontSize = getStepSizedValue(nextFontSize, STEP_SIZE);
      }
    }

    if (nextFontSize) {
      scene.mutateElement(
        latestElement,
        getTextElementStylePatch(latestElement, { fontSize: nextFontSize }),
      );
      const refreshed = refreshTextDimensions(latestElement, elementsMap);
      if (refreshed) {
        const { text: _displayText, ...dimensions } = refreshed;
        scene.mutateElement(latestElement, dimensions);
      }
    }
    return;
  }

  const target = getElementEmbeddedTextTarget(latestElement);
  const latestStyle = target
    ? getTextStyleTargetStyle(latestElement, target.region)
    : null;
  const originalStyle = target
    ? getTextStyleTargetStyle(origElement, target.region)
    : null;
  if (!target || !latestStyle || !originalStyle) {
    return;
  }

  let nextFontSize;
  if (nextValue !== undefined) {
    nextFontSize = Math.max(Math.round(nextValue), MIN_FONT_SIZE);
  } else {
    const originalFontSize = Math.round(originalStyle.fontSize);
    const changeInFontSize = Math.round(accumulatedChange);
    nextFontSize = Math.max(originalFontSize + changeInFontSize, MIN_FONT_SIZE);
    if (shouldChangeByStepSize) {
      nextFontSize = getStepSizedValue(nextFontSize, STEP_SIZE);
    }
  }

  if (nextFontSize) {
    updateEmbeddedTextStyles(scene, [
      {
        elementId: latestElement.id,
        region: target.region,
        style: { fontSize: nextFontSize },
      },
    ]);
    applyEmbeddedTextLayout(scene, latestElement.id, target.region);
    scene.triggerUpdate();
  }
};

const FontSize = ({ element, scene, appState, property }: FontSizeProps) => {
  const _element = isTextElement(element) ? element : null;

  const embeddedTarget = _element
    ? null
    : getElementEmbeddedTextTarget(element);
  const embeddedStyle = embeddedTarget
    ? getTextStyleTargetStyle(element, embeddedTarget.region)
    : null;

  if (!_element && !embeddedStyle) {
    return null;
  }

  return (
    <StatsDragInput
      label="F"
      value={
        _element
          ? Math.round(getTextElementStyle(_element).fontSize * 10) / 10
          : Math.round(embeddedStyle!.fontSize * 10) / 10
      }
      elements={_element ? [_element] : [element]}
      dragInputCallback={handleFontSizeChange}
      icon={fontSizeIcon}
      appState={appState}
      scene={scene}
      property={property}
    />
  );
};

export default FontSize;
