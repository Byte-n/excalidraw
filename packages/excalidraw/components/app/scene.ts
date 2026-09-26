import { type ApplyToOptions, type ElementUpdate } from "@excalidraw/element";

import type { StoreDelta } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  SceneElementsMap,
} from "@excalidraw/element/types";

import type { Mutable } from "@excalidraw/common/utility-types";

import type App from "../App";
import type { ActionResult } from "../../actions/types";
import type { AppState, ElementRenderOverrides, SceneData } from "../../types";

/** Scene, history and store operations are exposed through this controller. */
export const resetHistory = (app: App) => app.resetHistoryImpl();
export const resetStore = (app: App) => app.resetStoreImpl();
export const resetScene = (app: App, opts?: { resetLoadingState: boolean }) =>
  app.resetSceneImpl(opts);
export const syncActionResult = (app: App, result: ActionResult) =>
  app.syncActionResultImpl(result);
export const updateScene = <K extends keyof AppState>(
  app: App,
  sceneData: {
    elements?: SceneData["elements"];
    appState?: Pick<AppState, K> | null;
    collaborators?: SceneData["collaborators"];
    captureUpdate?: SceneData["captureUpdate"];
  },
) => app.updateSceneImpl(sceneData);
export const setElementRenderOverrides = (
  app: App,
  overrides: ElementRenderOverrides | null,
) => app.setElementRenderOverridesImpl(overrides);
export const applyDeltas = (
  app: App,
  deltas: StoreDelta[],
  options?: ApplyToOptions,
): [SceneElementsMap, AppState, boolean] =>
  app.applyDeltasImpl(deltas, options);
export const mutateElement = <TElement extends Mutable<ExcalidrawElement>>(
  app: App,
  element: TElement,
  updates: ElementUpdate<TElement>,
  informMutation?: boolean,
) => app.mutateElementImpl(element, updates, informMutation);
