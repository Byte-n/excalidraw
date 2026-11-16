import {
  CaptureUpdateAction,
  isFrameLikeElement,
  isSequenceLifelineElement,
  layoutElements,
  updateFrameMembershipOfSelectedElements,
} from "@excalidraw/element";

import type { LayoutAlgorithmId } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { register } from "./register";

import type { AppClassProperties, AppState } from "../types";
import type { Action } from "./types";

const canArrangeSelection: Action["predicate"] = (
  _elements,
  appState,
  _appProps,
  app,
) => {
  const selected = app.scene.getSelectedElements(appState);
  return (
    selected.length > 1 &&
    !selected.some((element) => isFrameLikeElement(element))
  );
};

const canArrangeSequence: Action["predicate"] = (
  _elements,
  appState,
  _appProps,
  app,
) => {
  const selected = app.scene.getSelectedElements(appState);
  return (
    selected.some((element) => isSequenceLifelineElement(element)) &&
    !selected.some((element) => isFrameLikeElement(element))
  );
};

const arrangeSelectedElements = (
  elements: readonly ExcalidrawElement[],
  appState: Readonly<AppState>,
  app: AppClassProperties,
  algorithm: LayoutAlgorithmId,
) => {
  const selected = app.scene.getSelectedElements(appState);
  const result = layoutElements(elements, {
    ids: selected.map((element) => element.id),
    algorithm,
  });
  return updateFrameMembershipOfSelectedElements(
    result.elements,
    appState,
    app,
  );
};

const arrangeAction = (
  name: "arrangeRow" | "arrangeColumn" | "arrangeGrid" | "arrangeStack",
  label: string,
  algorithm: LayoutAlgorithmId,
) =>
  register({
    name,
    label,
    trackEvent: { category: "element" },
    predicate: canArrangeSelection,
    perform: (elements, appState, _value, app) => ({
      appState,
      elements: arrangeSelectedElements(elements, appState, app, algorithm),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  });

export const actionArrangeRow = arrangeAction(
  "arrangeRow",
  "labels.arrangeRow",
  "row",
);
export const actionArrangeColumn = arrangeAction(
  "arrangeColumn",
  "labels.arrangeColumn",
  "column",
);
export const actionArrangeGrid = arrangeAction(
  "arrangeGrid",
  "labels.arrangeGrid",
  "grid",
);
export const actionArrangeStack = arrangeAction(
  "arrangeStack",
  "labels.arrangeStack",
  "stack",
);

export const actionArrangeSequence = register({
  name: "arrangeSequence",
  label: "labels.arrangeSequence",
  trackEvent: { category: "element" },
  predicate: canArrangeSequence,
  perform: (elements, appState, _value, app) => ({
    appState,
    elements: arrangeSelectedElements(elements, appState, app, "sequence"),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  }),
});
