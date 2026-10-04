/* eslint-disable dot-notation -- Controllers access private App coordination fields. */
import {
  isFrameLikeElement,
  CaptureUpdateAction,
  isElementLink,
  isMeasureTextSupported,
  Scene,
  ShapeCache,
  selectGroupsForSelectedElements,
  makeNextSelectedElementIds,
} from "@excalidraw/element";

import {
  updateActiveTool,
  arrayToMap,
  getFormFactor as getDefaultFormFactor,
  loadDesktopUIModePreference,
  createUserAgentDescriptor,
  MQ_RIGHT_SIDEBAR_MIN_WIDTH,
  updateObject,
  type EditorInterface,
  deriveStylesPanelMode,
  setDesktopUIMode as storeDesktopUIMode,
  isTestEnv,
  isDevEnv,
  isBrave,
  THEME,
} from "@excalidraw/common";

import React from "react";

import type {
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { hideHyperlinkToolip } from "../../components/hyperlink/Hyperlink";
import { restoreElements, restoreAppState } from "../../data/restore";

import { getScrollToContentState, isSomeElementSelected } from "../../scene";

import { convertElementTypePopupAtom } from "../ConvertElementTypePopup";
import { activeEyeDropperAtom } from "../EyeDropper";
import { editorJotaiStore } from "../../editor-jotai";
import BraveMeasureTextError from "../BraveMeasureTextError";
import { Fonts } from "../../fonts";
import { Renderer } from "../../scene/Renderer";
import { SnapCache } from "../../snapping";
import { isEraserActive } from "../../appState";
import { actionFinalize } from "../../actions";

import { resetInteractionState, resetContextMenuTimer } from "./pointerSession";

import type { AppProps, AppState } from "../../types";

import type App from "../App";

export const terminateActiveInteraction = (app: App) => {
  // Complete any active pointer interaction before clearing the state it
  // relies on. Among other things this tears down window-level listeners.
  app.maybeCleanupAfterMissingPointerUp(null);

  app.pan.setSpaceHeld(false);
  resetInteractionState(app);

  app.gesture.pointers.clear();
  app.gesture.lastCenter = null;
  app.gesture.initialDistance = null;
  app.gesture.initialScale = null;

  resetContextMenuTimer(app);

  if (app.bindModeHandler) {
    app.ownerWindow.clearTimeout(app.bindModeHandler);
    app.bindModeHandler = null;
  }

  app.flowchart.clear();
  app.mindmap.clear();

  // These components install their own DOM listeners rather than going
  // through App's input handlers, so they must be explicitly unmounted.
  editorJotaiStore.set(activeEyeDropperAtom, null);
  editorJotaiStore.set(convertElementTypePopupAtom, null);

  if (app.state.editingFrame) {
    const frame = app.scene.getNonDeletedElement(app.state.editingFrame);
    app["resetEditingFrame"](frame && isFrameLikeElement(frame) ? frame : null);
  }

  // textWysiwyg's submit path uses flushSync. Defer until after the current
  // componentDidUpdate lifecycle, then submit whichever text-editing session
  // is active if editing is still disabled.
  app.ownerWindow.queueMicrotask(() => {
    if (!app.isInteractionEnabled() || app.state.viewModeEnabled) {
      app["textWysiwygSubmitHandler"]?.();
    }
  });

  app.setState({
    contextMenu: null,
    openMenu: null,
    openPopup: null,
    cursorButton: "up",
    bindMode: "orbit",
    activeEmbeddable: null,
    activeLockedId: null,
    selectedElementsAreBeingDragged: false,
    selectionElement: null,
    resizingElement: null,
    isResizing: false,
    isRotating: false,
    isCropping: false,
    croppingElementId: null,
    suggestedBinding: null,
    frameToHighlight: null,
    elementsToHighlight: null,
    snapLines: [],
    showHyperlinkPopup: false,
  });
  app["deselectElements"]();
  if (!app.isInteractionEnabled()) {
    app.setState({ originSnapOffset: null });
    app.cursor.reset();
  }
};

export const handleInteractionStateChange = (
  app: App,
  prevProps: AppProps,
  prevState: AppState,
) => {
  const wasInteractionEnabled = app.isInteractionEnabled(prevProps);
  const interactionEnabledChanged =
    wasInteractionEnabled !== app.isInteractionEnabled();
  const viewModePropChanged =
    prevProps.viewModeEnabled !== app.props.viewModeEnabled;

  // Preserve internally toggled view mode while interactive and
  // uncontrolled. Synchronize it when its prop changes, when interaction is
  // re-enabled, or when non-interactive mode needs to force it on.
  let nextViewModeEnabled = app.state.viewModeEnabled;
  if (!app.isInteractionEnabled()) {
    nextViewModeEnabled = true;
  } else if (viewModePropChanged || interactionEnabledChanged) {
    nextViewModeEnabled = !!app.props.viewModeEnabled;
  }
  if (nextViewModeEnabled !== app.state.viewModeEnabled) {
    app.setState({ viewModeEnabled: nextViewModeEnabled });
  }

  const editingWasEnabled = wasInteractionEnabled && !prevState.viewModeEnabled;
  const editingEnabled =
    app.isInteractionEnabled() && !app.state.viewModeEnabled;
  const becameNonInteractive =
    interactionEnabledChanged && !app.isInteractionEnabled();

  if (becameNonInteractive || (editingWasEnabled && !editingEnabled)) {
    app["terminateActiveInteraction"]();
  }

  if (interactionEnabledChanged) {
    // listener tiers depend on `props.interaction` even when
    // `state.viewModeEnabled` ends up unchanged
    app.addEventListeners();
  }

  // NOTE link icons appearing/disappearing is handled by the re-render
  // itself (`renderConfig.renderLinks`)
  if (app.isLinksEnabled(prevProps) !== app.isLinksEnabled()) {
    if (!app.isLinksEnabled()) {
      app.hitLinkElement = undefined;
      hideHyperlinkToolip();
      app.cursor.reset();
    }
  }

  if (app.isEmbedsEnabled(prevProps) !== app.isEmbedsEnabled()) {
    if (!app.isEmbedsEnabled()) {
      app.setState({ activeEmbeddable: null });
    }
  }

  if (
    app.isToolSupported(prevState.activeTool.type, prevProps) !==
    app.isToolSupported(app.state.activeTool.type)
  ) {
    if (!app.isToolSupported(app.state.activeTool.type)) {
      // end a possibly mid-stroke laser trail (the stroke's own window
      // listeners tear down on the next pointerup)
      app.laserTrails.endPath();
    }
    app.cursor.reset();
  }

  // invariant: while non-interactive, the active tool is either
  // input-enabled (`interaction.enabled.tools`) or the neutral default —
  // reset stale tool state (e.g. a presenter's laser after handing off)
  // so it doesn't leak through `onChange` / collab pointer payloads or
  // linger until interaction is re-enabled
  if (
    !app.isInteractionEnabled() &&
    !app.isToolSupported(app.state.activeTool.type) &&
    app.state.activeTool.type !== "selection"
  ) {
    app.setState({
      activeTool: updateActiveTool(app.state, { type: "selection" }),
    });
  }

  if (
    app.isBrowserZoomEnabled(prevProps) !== app.isBrowserZoomEnabled() ||
    app.isNavigationEnabled(prevProps) !== app.isNavigationEnabled()
  ) {
    app.addEventListeners();
    app.cursor.reset();
  }

  if (prevState.viewModeEnabled !== app.state.viewModeEnabled) {
    if (app.isInteractionEnabled()) {
      app.addEventListeners();
    }
    if (!app.state.viewModeEnabled) {
      app["deselectElements"]();
    }
    app.cursor.reset();
  }
};

export const handleForcedToolChange = (
  app: App,
  prevProps: AppProps,
  prevState: AppState,
) => {
  const forcedTool = app.props.activeTool;
  if (!forcedTool) {
    return;
  }

  const forcedToolChanged = !app["isSameForcedTool"](
    prevProps.activeTool,
    forcedTool,
  );

  if ((forcedTool.type as string) === "image") {
    if (forcedToolChanged) {
      console.warn(`"image" tool cannot be forced via "props.activeTool"`);
    }
    return;
  }

  if (app["isSameForcedTool"](forcedTool, app.state.activeTool)) {
    return;
  }

  // (re)force only on relevant changes so that a standing refusal (tool
  // disabled, or not enabled while non-interactive) warns once instead of
  // on every update
  if (
    forcedToolChanged ||
    prevState.activeTool !== app.state.activeTool ||
    app.isToolSupported(forcedTool.type, prevProps) !==
      app.isToolSupported(forcedTool.type, app.props)
  ) {
    app.setActiveTool(forcedTool);
  }
};

export const initializeScene = async (app: App) => {
  if ("launchQueue" in app.ownerWindow && "LaunchParams" in app.ownerWindow) {
    (app.ownerWindow as any).launchQueue.setConsumer(
      async (launchParams: { files: any[] }) => {
        if (!launchParams.files.length) {
          return;
        }
        const fileHandle = launchParams.files[0];
        const blob: Blob = await fileHandle.getFile();
        app.loadFileToCanvas(
          new File([blob], blob.name || "", { type: blob.type }),
          fileHandle,
        );
      },
    );
  }

  if (app.props.theme) {
    app.setState({ theme: app.props.theme });
  }
  if (!app.state.isLoading) {
    app.setState({ isLoading: true });
  }
  let initialData = null;
  try {
    if (typeof app.props.initialData === "function") {
      initialData = (await app.props.initialData()) || null;
    } else {
      initialData = (await app.props.initialData) || null;
    }
    if (initialData?.libraryItems) {
      app.library
        .updateLibrary({
          libraryItems: initialData.libraryItems,
          merge: true,
        })
        .catch((error) => {
          console.error(error);
        });
    }
  } catch (error: any) {
    console.error(error);
    initialData = {
      appState: {
        errorMessage:
          error.message ||
          "Encountered an error during importing or restoring scene data",
      },
    };
  }
  const restoredElements = restoreElements(initialData?.elements, null, {
    repairBindings: true,
    deleteInvisibleElements: true,
  });
  let restoredAppState = restoreAppState(initialData?.appState, null);
  const activeTool = restoredAppState.activeTool;

  if (!restoredAppState.preferredSelectionTool.initialized) {
    restoredAppState.preferredSelectionTool = {
      type: app.editorInterface.formFactor === "phone" ? "lasso" : "selection",
      initialized: true,
    };
  }

  restoredAppState = {
    ...restoredAppState,
    theme: app.props.theme || restoredAppState.theme,
    // we're falling back to current (pre-init) state when deciding
    // whether to open the library, to handle a case where we
    // update the state outside of initialData (e.g. when loading the app
    // with a library install link, which should auto-open the library)
    openSidebar: restoredAppState?.openSidebar || app.state.openSidebar,
    activeTool:
      activeTool.type === "image" ||
      activeTool.type === "lasso" ||
      activeTool.type === "selection"
        ? {
            ...activeTool,
            type: restoredAppState.preferredSelectionTool.type,
          }
        : restoredAppState.activeTool,
    isLoading: false,
    toast: app.state.toast,
  };

  const viewportAppState = {
    ...restoredAppState,
    width: app.state.width,
    height: app.state.height,
    offsetTop: app.state.offsetTop,
    offsetLeft: app.state.offsetLeft,
  };
  const initialViewport = app.props.initialState?.viewport;

  if (initialViewport) {
    const restoredNonDeletedElements = restoredElements.filter(
      (element) => !element.isDeleted,
    ) as readonly NonDeletedExcalidrawElement[];
    const restoredElementsMap = arrayToMap(
      restoredNonDeletedElements,
    ) as NonDeletedSceneElementsMap;

    const initialViewportState = app.viewport.resolveInitialViewport(
      initialViewport,
      restoredElementsMap,
      viewportAppState,
    );

    if (initialViewportState) {
      restoredAppState = {
        ...restoredAppState,
        ...initialViewportState,
      };
    }
  } else if (initialData?.scrollToContent) {
    restoredAppState = {
      ...restoredAppState,
      ...getScrollToContentState(restoredElements, viewportAppState),
    };
  }

  app.resetStore();
  app.resetHistory();
  app.syncActionResult({
    elements: restoredElements,
    appState: restoredAppState,
    files: initialData?.files,
    captureUpdate: CaptureUpdateAction.NEVER,
  });

  // clear the shape and image cache so that any images in initialData
  // can be loaded fresh
  app["clearImageShapeCache"]();

  // manually loading the font faces seems faster even in browsers that do fire the loadingdone event
  app.fonts.loadSceneFonts().then((fontFaces) => {
    app.fonts.onLoaded(fontFaces);
  });

  if (isElementLink(app.ownerWindow.location.href)) {
    app.viewport.setViewport({
      target: app.ownerWindow.location.href,
      fit: "scale-down",
      animation: false,
    });
  }
};

export const getFormFactor = (
  app: App,
  editorWidth: number,
  editorHeight: number,
) => {
  return (
    app.props.UIOptions.getFormFactor?.(editorWidth, editorHeight) ??
    getDefaultFormFactor(editorWidth, editorHeight)
  );
};

export const refreshEditorInterface = (app: App) => {
  const container = app.excalidrawContainerRef.current;
  if (!container) {
    return;
  }

  const { width: editorWidth, height: editorHeight } =
    container.getBoundingClientRect();

  const storedDesktopUIMode = loadDesktopUIModePreference();
  const userAgentDescriptor = createUserAgentDescriptor(
    app.ownerWindow.navigator.userAgent,
  );
  // allow host app to control formFactor and desktopUIMode via props
  const sidebarBreakpoint =
    app.props.UIOptions.dockedSidebarBreakpoint != null
      ? app.props.UIOptions.dockedSidebarBreakpoint
      : MQ_RIGHT_SIDEBAR_MIN_WIDTH;
  const nextEditorInterface = updateObject(app.editorInterface, {
    desktopUIMode: storedDesktopUIMode ?? app.editorInterface.desktopUIMode,
    formFactor: app["getFormFactor"](editorWidth, editorHeight),
    userAgent: userAgentDescriptor,
    canFitSidebar: editorWidth > sidebarBreakpoint,
    isLandscape: editorWidth > editorHeight,
  });

  app.editorInterface = nextEditorInterface;
  app["reconcileStylesPanelMode"](nextEditorInterface);
};

export const reconcileStylesPanelMode = (
  app: App,
  nextEditorInterface: EditorInterface,
) => {
  const nextStylesPanelMode = deriveStylesPanelMode(nextEditorInterface);
  if (nextStylesPanelMode === app["stylesPanelMode"]) {
    return;
  }

  app["stylesPanelMode"] = nextStylesPanelMode;

  // the panel footprint differs between modes (compact vs full), so a
  // measurement taken in the previous mode no longer applies
  app.viewport.invalidateUIOffset("stylesPanel");
};

export const setDesktopUIMode = (
  app: App,
  mode: EditorInterface["desktopUIMode"],
) => {
  const nextMode = storeDesktopUIMode(mode);
  app.editorInterface = updateObject(app.editorInterface, {
    desktopUIMode: nextMode,
  });
  app["reconcileStylesPanelMode"](app.editorInterface);
};

export async function componentDidMount(app: App) {
  app.unmounted = false;
  app.api = app["createExcalidrawAPI"]();

  app.excalidrawContainerValue.container = app.excalidrawContainerRef.current;

  if (isTestEnv() || isDevEnv()) {
    app.ownerWindow.h ||= {} as Window["h"];
    const setState = app.setState.bind(app);
    Object.defineProperties(app.ownerWindow.h, {
      state: {
        configurable: true,
        get: () => {
          return app.state;
        },
      },
      setState: {
        configurable: true,
        value: (...args: Parameters<typeof setState>) => {
          return app.setState(...args);
        },
      },
      app: {
        configurable: true,
        value: app,
      },
      history: {
        configurable: true,
        value: app["history"],
      },
      store: {
        configurable: true,
        value: app.store,
      },
      fonts: {
        configurable: true,
        value: app.fonts,
      },
    });
  }

  app.store.onDurableIncrementEmitter.on((increment) => {
    app["history"].record(increment.delta);
  });

  // per. optimmisation, only subscribe if there is the `onIncrement` prop registered, to avoid unnecessary computation
  if (app.props.onIncrement) {
    app.store.onStoreIncrementEmitter.on((increment) => {
      app.props.onIncrement?.(increment);
    });
  }

  app.scene.onUpdate(app.triggerRender);
  app.addEventListeners();

  if (app.props.autoFocus && app.excalidrawContainerRef.current) {
    app.focusContainer();
  }

  if (
    typeof app.ownerWindow.ResizeObserver === "function" &&
    app.excalidrawContainerRef.current
  ) {
    app["resizeObserver"] = new app.ownerWindow.ResizeObserver(() => {
      app.refreshEditorInterface();
      app["updateDOMRect"]();
    });
    app["resizeObserver"]?.observe(app.excalidrawContainerRef.current);
  }

  const searchParams = new URLSearchParams(
    app.ownerWindow.location.search.slice(1),
  );

  if (searchParams.has("web-share-target")) {
    // Obtain a file that was shared via the Web Share Target API.
    app.restoreFileFromShare();
  } else {
    app["updateDOMRect"](app.initializeScene);
  }

  // note that this check seems to always pass in localhost
  if (isBrave() && !isMeasureTextSupported()) {
    app.setState({
      errorMessage: React.createElement(BraveMeasureTextError),
    });
  }

  const mountPayload = {
    excalidrawAPI: app.api,
    container: app.excalidrawContainerRef.current,
  };

  app["editorLifecycleEvents"].emit("editor:mount", mountPayload);
  app.props.onMount?.(mountPayload);
  app.props.onExcalidrawAPI?.(app.api);
}

export function componentWillUnmount(app: App) {
  app.maybeCleanupAfterMissingPointerUp(null);
  resetInteractionState(app);

  // we're recreating the api object reference so that the
  // <ExcalidrawAPIContext.Provider/> picks up on it
  app.api = { ...app.api, isDestroyed: true };

  for (const key of Object.keys(app.api) as (keyof typeof app.api)[]) {
    if (
      (key.startsWith("get") || key === "onStateChange" || key === "onEvent") &&
      typeof app.api[key] === "function"
    ) {
      (app.api as any)[key] = () => {
        throw new Error(
          "ExcalidrawAPI is no longer usable after the editor has been unmounted and will return invalid/empty data. You should check for `ExcalidrawAPI.isDestroyed` before calling get* methods on subscribing to state/event changes.",
        );
      };
    }
  }

  app["editorLifecycleEvents"].emit("editor:unmount");
  app.props.onUnmount?.();
  app.props.onExcalidrawAPI?.(null);
  app.elementRenderOverrides = new Map();
  app.elementRenderOffsets = new Map();

  (app.ownerWindow as any).launchQueue?.setConsumer(() => {});

  app.renderer.destroy();
  app.scene.destroy();
  app.scene = new Scene();
  app.fonts = new Fonts(app.scene, app.ownerDocument);
  app.renderer = new Renderer(app.scene);
  app.files = {};
  app.imageCache.clear();
  app["resizeObserver"]?.disconnect();
  app.unmounted = true;
  app.viewport.destroy();
  app.removeEventListeners();
  app.library.destroy();
  app.laserTrails.stop();
  app.drawShape.stop();
  app.toolDrag.cancel();
  app.eraserTrail.stop();
  app.onChangeEmitter.clear();
  app.store.onStoreIncrementEmitter.clear();
  app.store.onDurableIncrementEmitter.clear();
  app["appStateObserver"].clear();
  app["editorLifecycleEvents"].clear();
  ShapeCache.destroy();
  SnapCache.destroy();
  app.ownerWindow.clearTimeout(app.interactionState.touchTimeout);
  isSomeElementSelected.clearCache();
  selectGroupsForSelectedElements.clearCache();
  app.interactionState.touchTimeout = 0;
  app.ownerDocument.documentElement.style.overscrollBehaviorX = "";
}

export function componentDidUpdate(
  app: App,
  prevProps: AppProps,
  prevState: AppState,
) {
  const renderOverridesUpdatePending = app["renderOverridesUpdatePending"];
  app["renderOverridesUpdatePending"] = false;
  // Only a requested visual update can skip the document pipeline. Real
  // props/state changes batched with it must still commit and notify.
  if (
    renderOverridesUpdatePending &&
    prevProps === app.props &&
    prevState === app.state
  ) {
    return;
  }

  // must be updated *before* state change listeners are triggered below
  if (!app["_initialized"] && !app.state.isLoading) {
    app["_initialized"] = true;
    app["editorLifecycleEvents"].emit("editor:initialize", app.api);
    app.props.onInitialize?.(app.api);
  }

  handleInteractionStateChange(app, prevProps, prevState);
  handleForcedToolChange(app, prevProps, prevState);

  app["appStateObserver"].flush(prevState);

  app["updateEmbeddables"]();
  const elements = app.scene.getElementsIncludingDeleted();
  const elementsMap = app.scene.getElementsMapIncludingDeleted();

  const shouldExportWithDarkMode =
    (app.sessionExportThemeOverride ?? app.state.theme) === THEME.DARK;

  if (app.state.exportWithDarkMode !== shouldExportWithDarkMode) {
    app.setState({ exportWithDarkMode: shouldExportWithDarkMode });
  }

  if (!app.state.showWelcomeScreen && !elements.length) {
    app.setState({ showWelcomeScreen: true });
  }

  if (
    prevState.zoom.value !== app.state.zoom.value ||
    prevState.scrollX !== app.state.scrollX ||
    prevState.scrollY !== app.state.scrollY
  ) {
    app.props?.onScrollChange?.(
      app.state.scrollX,
      app.state.scrollY,
      app.state.zoom,
    );
    app.onScrollChangeEmitter.trigger(
      app.state.scrollX,
      app.state.scrollY,
      app.state.zoom,
    );
  }

  if (
    Object.keys(app.state.selectedElementIds).length &&
    isEraserActive(app.state)
  ) {
    app.setState({
      activeTool: updateActiveTool(app.state, { type: "selection" }),
    });
  }
  if (
    app.state.activeTool.type === "eraser" &&
    prevState.theme !== app.state.theme
  ) {
    app.cursor.applyForTool();
  }
  if (
    app.state.activeTool.type === "bucketfill" &&
    prevState.currentItemBackgroundColor !==
      app.state.currentItemBackgroundColor
  ) {
    app.cursor.applyForTool();
  }

  // Hide hyperlink popup if shown when element type is not selection
  if (
    prevState.activeTool.type === "selection" &&
    app.state.activeTool.type !== "selection" &&
    app.state.showHyperlinkPopup
  ) {
    app.setState({ showHyperlinkPopup: false });
  }
  if (prevProps.langCode !== app.props.langCode) {
    app["updateLanguage"]();
  }

  if (isEraserActive(prevState) && !isEraserActive(app.state)) {
    app.eraserTrail.endPath();
  }

  // cleanup
  if (
    (prevState.openDialog?.name === "elementLinkSelector" ||
      app.state.openDialog?.name === "elementLinkSelector") &&
    prevState.openDialog?.name !== app.state.openDialog?.name
  ) {
    app["deselectElements"]();
    app.setState({
      hoveredElementIds: {},
    });
  }

  if (prevProps.zenModeEnabled !== app.props.zenModeEnabled) {
    app.setState({ zenModeEnabled: !!app.props.zenModeEnabled });
  }

  if (prevProps.theme !== app.props.theme && app.props.theme) {
    app.setState({ theme: app.props.theme });
  }

  app.excalidrawContainerRef.current?.classList.toggle(
    "theme--dark",
    app.state.theme === THEME.DARK,
  );

  if (
    app.state.selectedLinearElement?.isEditing &&
    !app.state.selectedElementIds[app.state.selectedLinearElement.elementId]
  ) {
    // defer so that the scheduleCapture flag isn't reset via current update
    app.ownerWindow.setTimeout(() => {
      // execute only if the condition still holds when the deferred callback
      // executes (it can be scheduled multiple times depending on how
      // many times the component renders)
      app.state.selectedLinearElement?.isEditing &&
        app.actionManager.executeAction(actionFinalize);
    });
  }

  // selection may only contain non-deleted elements. Resolved post-commit,
  // so the elements we filter against are the latest.
  const selectedElementIds = Object.keys(app.state.selectedElementIds);
  if (selectedElementIds.length) {
    const staleSelectedElementIds = selectedElementIds.filter((id) => {
      const element = app.scene.getElement(id);
      return !element || element.isDeleted;
    });

    // only update when actually stale, so we retain the object identity
    // `selectedElementIds` is cached on (e.g. `Scene.getSelectedElements`)
    if (staleSelectedElementIds.length) {
      app.setState((prevState) => {
        const nextSelectedElementIds = { ...prevState.selectedElementIds };
        for (const id of staleSelectedElementIds) {
          delete nextSelectedElementIds[id];
        }
        return {
          selectedElementIds: makeNextSelectedElementIds(
            nextSelectedElementIds,
            prevState,
          ),
        };
      });
    }
  }

  // failsafe in case the state is being updated in incorrect order resulting
  // in the editingTextElement being now a deleted element. Resolved against
  // the scene by id, since the state holds an immutable snapshot whose
  // `isDeleted` never flips once the element is deleted.
  if (app.state.editingTextElement) {
    const sceneElement = app.scene.getElement(app.state.editingTextElement.id);
    if (!sceneElement || sceneElement.isDeleted) {
      app.setState({ editingTextElement: null });
    }
  }

  // Forced false while a viewport animation runs — the scroll-back-to-content
  // button must not render mid-animation (clicking it would fight the
  // animation, which overwrites the viewport every frame). The animation's
  // final commit lands after the animation is unregistered, settling this
  // on the target viewport.
  const scrolledOutside =
    // hide when editing text
    app.state.editingTextElement || app.viewport.isAnimating
      ? false
      : !app.visibleElements.length && app.hasRenderableElements;
  if (app.state.scrolledOutside !== scrolledOutside) {
    app.setState({ scrolledOutside });
  }

  app.store.commit(elementsMap, app.state);

  // Do not notify consumers if we're still loading the scene. Among other
  // potential issues, this fixes a case where the tab isn't focused during
  // init, which would trigger onChange with empty elements, which would then
  // override whatever is in localStorage currently.
  if (!app.state.isLoading) {
    app.props.onChange?.(elements, app.state, app.files);
    app.onChangeEmitter.trigger(elements, app.state, app.files);
  }
}

export const updateDOMRect = (app: App, cb?: () => void) => {
  if (app.excalidrawContainerRef?.current) {
    const excalidrawContainer = app.excalidrawContainerRef.current;
    const {
      width,
      height,
      left: offsetLeft,
      top: offsetTop,
    } = excalidrawContainer.getBoundingClientRect();
    const {
      width: currentWidth,
      height: currentHeight,
      offsetTop: currentOffsetTop,
      offsetLeft: currentOffsetLeft,
    } = app.state;

    if (
      width === currentWidth &&
      height === currentHeight &&
      offsetLeft === currentOffsetLeft &&
      offsetTop === currentOffsetTop
    ) {
      if (cb) {
        cb();
      }
      return;
    }

    app.setState(
      {
        width,
        height,
        offsetLeft,
        offsetTop,
      },
      () => {
        cb && cb();
      },
    );
    // a smaller viewport may push the min zoom up / shrink the pan range
    app.viewport.constrain();
  }
};

export const getCanvasOffsets = (app: App) => {
  if (app.excalidrawContainerRef?.current) {
    const excalidrawContainer = app.excalidrawContainerRef.current;
    const { left, top } = excalidrawContainer.getBoundingClientRect();
    return {
      offsetLeft: left,
      offsetTop: top,
    };
  }
  return {
    offsetLeft: 0,
    offsetTop: 0,
  };
};
