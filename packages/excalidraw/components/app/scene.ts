/* eslint-disable dot-notation -- Controllers access private App coordination fields. */
import { THEME } from "@excalidraw/common";
import {
  isNonDeletedElement,
  isTextElement,
  getObservedAppState,
  CaptureUpdateAction,
  StoreDelta,
  assertValidContainerRefs,
  assertValidTableData,
  isTableElement,
  normalizeTableDimensions,
  type ApplyToOptions,
  type ElementUpdate,
} from "@excalidraw/element";

import type {
  SceneElementsMap,
  ExcalidrawElement,
} from "@excalidraw/element/types";

import type { Mutable } from "@excalidraw/common/utility-types";

import { getDefaultAppState } from "../../appState";
import {
  copyElementRenderOverrides,
  getElementRenderOffsets,
} from "../../renderOverrides";

import { withBatchedUpdates } from "../../reactUtils";

import type { AppState, SceneData, ElementRenderOverrides } from "../../types";
import type { ActionResult } from "../../actions/types";
import type App from "../App";

export const syncActionResult = (app: App, actionResult: ActionResult) =>
  withBatchedUpdates(() => {
    if (app.unmounted || actionResult === false) {
      return;
    }

    app.store.scheduleAction(actionResult.captureUpdate);

    let didUpdate = false;

    let editingTextElement: AppState["editingTextElement"] | null = null;
    if (actionResult.elements) {
      app.scene.replaceAllElements(actionResult.elements);
      didUpdate = true;
    }

    if (actionResult.files) {
      app["addMissingFiles"](actionResult.files, actionResult.replaceFiles);
      app["addNewImagesToImageCache"]();
    }

    if (actionResult.appState || editingTextElement || app.state.contextMenu) {
      let viewModeEnabled = actionResult?.appState?.viewModeEnabled || false;
      let zenModeEnabled = actionResult?.appState?.zenModeEnabled || false;
      const theme =
        actionResult?.appState?.theme || app.props.theme || THEME.LIGHT;
      const name = actionResult?.appState?.name ?? app.state.name;
      const errorMessage =
        actionResult?.appState?.errorMessage ?? app.state.errorMessage;
      if (typeof app.props.viewModeEnabled !== "undefined") {
        viewModeEnabled = app.props.viewModeEnabled;
      }

      // non-interactive editor implies view mode (overrides both the action
      // result and the host-supplied `viewModeEnabled` prop)
      if (!app.isInteractionEnabled()) {
        viewModeEnabled = true;
      }

      if (typeof app.props.zenModeEnabled !== "undefined") {
        zenModeEnabled = app.props.zenModeEnabled;
      }

      editingTextElement = actionResult.appState?.editingTextElement || null;

      // make sure editingTextElement points to latest element reference
      if (actionResult.elements && editingTextElement) {
        const editingTextElementId = editingTextElement.id;
        const nextElement = actionResult.elements.find(
          (element) => element.id === editingTextElementId,
        );
        editingTextElement =
          nextElement &&
          isNonDeletedElement(nextElement) &&
          isTextElement(nextElement)
            ? nextElement
            : null;
      }

      app.setState((prevAppState) => {
        const actionAppState = actionResult.appState || {};

        return {
          ...prevAppState,
          ...actionAppState,
          // NOTE this will prevent opening context menu using an action
          // or programmatically from the host, so it will need to be
          // rewritten later
          contextMenu: null,
          editingTextElement,
          viewModeEnabled,
          zenModeEnabled,
          theme,
          name,
          errorMessage,
        };
      });

      didUpdate = true;
    }

    if (!didUpdate) {
      app.scene.triggerUpdate();
    }
  })();

export const resetHistory = (app: App) => {
  app["history"].clear();
};

export const resetStore = (app: App) => {
  app.store.clear();
};

export const resetScene = (app: App, opts?: { resetLoadingState: boolean }) =>
  withBatchedUpdates(() => {
    app.elementRenderOverrides = new Map();
    app.elementRenderOffsets = new Map();
    app.scene.replaceAllElements([]);
    app.setState((state) => ({
      ...getDefaultAppState(),
      isLoading: opts?.resetLoadingState ? false : state.isLoading,
      theme: app.state.theme,
    }));
    app.resetStore();
    app.resetHistory();
  })();

export const updateScene = <K extends keyof AppState>(
  app: App,
  sceneData: {
    elements?: SceneData["elements"];
    appState?: Pick<AppState, K> | null;
    collaborators?: SceneData["collaborators"];
    /**
     *  Controls which updates should be captured by the `Store`. Captured updates are emmitted and listened to by other components, such as `History` for undo / redo purposes.
     *
     *  - `CaptureUpdateAction.IMMEDIATELY`: Updates are immediately undoable. Use for most local updates.
     *  - `CaptureUpdateAction.NEVER`: Updates never make it to undo/redo stack. Use for remote updates or scene initialization.
     *  - `CaptureUpdateAction.EVENTUALLY`: Updates will be eventually be captured as part of a future increment.
     *
     * Check [API docs](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api#captureUpdate) for more details.
     *
     * @default CaptureUpdateAction.EVENTUALLY
     */
    captureUpdate?: SceneData["captureUpdate"];
  },
) => {
  if (sceneData.elements?.some(isTableElement)) {
    const ids = new Set<string>();
    for (const element of sceneData.elements) {
      if (ids.has(element.id)) {
        throw new Error(`Duplicate element id: ${element.id}`);
      }
      ids.add(element.id);
      if (isTableElement(element)) {
        assertValidTableData(element.table);
        normalizeTableDimensions(element);
      }
    }
    assertValidContainerRefs(sceneData.elements);
  }
  return withBatchedUpdates(() => {
    const { elements, appState, collaborators, captureUpdate } = sceneData;

    if (captureUpdate) {
      const nextElements = elements ? elements : undefined;
      const observedAppState = appState
        ? getObservedAppState({
            ...app.store.snapshot.appState,
            ...appState,
          })
        : undefined;

      app.store.scheduleMicroAction({
        action: captureUpdate,
        elements: nextElements,
        appState: observedAppState,
      });
    }

    if (appState) {
      app.setState(appState as Pick<AppState, K> | null);
    }

    if (elements) {
      if (captureUpdate === CaptureUpdateAction.NEVER) {
        app.mindmap.handleRemoteSceneUpdate(elements);
      }
      app.scene.replaceAllElements(elements);
    }

    if (collaborators) {
      app.laserTrails.updateCollabTrails(collaborators);
      app.setState({ collaborators });
    }
  })();
};

export const setElementRenderOverrides = (
  app: App,
  overrides: ElementRenderOverrides | null,
) => {
  if (app.unmounted) {
    return;
  }
  const nextOverrides = copyElementRenderOverrides(overrides);
  // clearing an already clear snapshot is the one cheap no-op worth having
  if (!nextOverrides.size && !app.elementRenderOverrides.size) {
    return;
  }
  app.elementRenderOverrides = nextOverrides;
  app.elementRenderOffsets = getElementRenderOffsets(
    app.elementRenderOverrides,
    app.elementRenderOffsets,
  );
  app["renderOverridesUpdatePending"] = true;
  // Preserve AppState identity and explicitly request a visual-only commit.
  app.forceUpdate();
};

export const setMindmapDragOpacity = (
  app: App,
  ids: readonly string[] | null,
) => {
  const next = new Map(app.elementRenderOverrides);
  app["mindmapDragOpacityIds"].forEach((id) => {
    const previous = app["mindmapDragOpacityPrevious"].get(id);
    if (previous) {
      next.set(id, previous);
    } else {
      next.delete(id);
    }
  });
  app["mindmapDragOpacityIds"] = new Set(ids ?? []);
  app["mindmapDragOpacityPrevious"].clear();
  app["mindmapDragOpacityIds"].forEach((id) => {
    const previous = next.get(id);
    app["mindmapDragOpacityPrevious"].set(id, previous);
    next.set(id, { ...(previous ?? {}), opacity: 24 });
  });
  app.setElementRenderOverrides(next.size ? next : null);
};

export const applyDeltas = (
  app: App,
  deltas: StoreDelta[],
  options?: ApplyToOptions,
): [SceneElementsMap, AppState, boolean] => {
  // squash all deltas together, starting with a fresh new delta instance
  const aggregatedDelta = StoreDelta.squash(...deltas);

  // create new instance of elements map & appState, so we don't accidentaly mutate existing ones
  const nextAppState = { ...app.state };
  const nextElements = new Map(
    app.scene.getElementsMapIncludingDeleted(),
  ) as SceneElementsMap;

  return StoreDelta.applyTo(
    aggregatedDelta,
    nextElements,
    nextAppState,
    options,
  );
};

export const mutateElement = <TElement extends Mutable<ExcalidrawElement>>(
  app: App,
  element: TElement,
  updates: ElementUpdate<TElement>,
  informMutation = true,
) => {
  return app.scene.mutateElement(element, updates, {
    informMutation,
    isDragging: false,
  });
};
