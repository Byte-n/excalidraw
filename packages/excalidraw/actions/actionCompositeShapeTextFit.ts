import {
  CaptureUpdateAction,
  getBoundTextElement,
  getCompositeShapeTextFitMode,
  isSequenceLifelineElement,
  isShapeElement,
  isValidTextContainer,
  redrawTextBoundingBox,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getSelectedElements } from "../scene";

import { register } from "./register";

import type { AppClassProperties, AppState, UIAppState } from "../types";

type CompositeShapeTextFitMode = "auto" | "fixed";

const getSelectedTextFitShapes = (
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "selectedElementIds">,
) =>
  getSelectedElements(elements, appState).filter(
    (element) => isShapeElement(element) && isValidTextContainer(element),
  );

const setTextFitMode = (
  mode: CompositeShapeTextFitMode,
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "selectedElementIds">,
  app: AppClassProperties,
) => {
  const selectedShapes = getSelectedTextFitShapes(elements, appState);
  const elementsMap = app.scene.getNonDeletedElementsMap();
  let changed = false;

  selectedShapes.forEach((shape) => {
    if (getCompositeShapeTextFitMode(shape) === mode) {
      return;
    }

    changed = true;
    // Lifelines keep a fixed width and fit through the head height, so the
    // preserved minimum is the head height, not the whole element height.
    const isLifeline = isSequenceLifelineElement(shape);
    app.scene.mutateElement(shape, {
      textFitMode: mode,
      ...(mode === "auto" && {
        textFitMinWidth: shape.width,
        textFitMinHeight: isLifeline
          ? shape.shape.lifeline.headHeight
          : shape.height,
      }),
    });

    const latestShape = app.scene.getElement(shape.id) || shape;
    const boundText = getBoundTextElement(latestShape, elementsMap);
    if (boundText) {
      redrawTextBoundingBox(boundText, latestShape, app.scene);
    }
  });

  return changed;
};

const isTextFitMode = (
  mode: CompositeShapeTextFitMode,
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "selectedElementIds">,
) => {
  const selectedShapes = getSelectedTextFitShapes(elements, appState);
  return (
    selectedShapes.length > 0 &&
    selectedShapes.every(
      (shape) => getCompositeShapeTextFitMode(shape) === mode,
    )
  );
};

export const actionSetCompositeShapeTextFitFixed = register({
  name: "setCompositeShapeTextFitFixed",
  label: "labels.compositeShapeTextFitFixed",
  trackEvent: { category: "element" },
  checked: (
    appState: Readonly<UIAppState>,
    elements: readonly ExcalidrawElement[] = [],
  ) => isTextFitMode("fixed", elements, appState),
  predicate: (elements, appState) =>
    getSelectedTextFitShapes(elements, appState).length > 0,
  perform: (elements, appState, _, app) => {
    if (!setTextFitMode("fixed", elements, appState, app)) {
      return false;
    }
    return {
      elements,
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});

export const actionSetCompositeShapeTextFitAuto = register({
  name: "setCompositeShapeTextFitAuto",
  label: "labels.compositeShapeTextFitAuto",
  trackEvent: { category: "element" },
  checked: (
    appState: Readonly<UIAppState>,
    elements: readonly ExcalidrawElement[] = [],
  ) => isTextFitMode("auto", elements, appState),
  predicate: (elements, appState) =>
    getSelectedTextFitShapes(elements, appState).length > 0,
  perform: (elements, appState, _, app) => {
    if (!setTextFitMode("auto", elements, appState, app)) {
      return false;
    }
    return {
      elements,
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});
