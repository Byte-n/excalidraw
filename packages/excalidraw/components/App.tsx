import throttle from "lodash.throttle";
import { nanoid } from "nanoid";
import React from "react";
import rough from "roughjs/bin/rough";

import {
  APP_NAME,
  AppEventBus,
  debounce,
  deriveStylesPanelMode,
  Emitter,
  getDateTime,
  getStrokeWidthByKey,
  IMAGE_RENDER_TIMEOUT,
  isDevEnv,
  isTestEnv,
  ROUNDNESS,
  SCROLL_TIMEOUT,
  THEME,
  updateActiveTool,
  type EditorInterface,
  type EXPORT_IMAGE_TYPES,
  type StylesPanelMode,
} from "@excalidraw/common";

import {
  CaptureUpdateAction,
  getColorUpdate,
  getCommonBounds,
  getFrameChildrenInsertionIndex,
  getInitializedImageElements,
  isElementCompletelyInViewport,
  isFrameLikeElement,
  isTableElement,
  isUsingAdaptiveRadius,
  makeNextSelectedElementIds,
  newElementWith,
  resolveElementRenderState,
  Scene,
  Store,
  syncInvalidIndices,
  tableCellContainerRef,
  getTableCellInsertionIndex,
  frameLikeContainerRef,
  type ApplyToOptions,
  type ElementUpdate,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawEmbeddableElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawIframeElement,
  ExcalidrawIframeLikeElement,
  ExcalidrawImageElement,
  ExcalidrawLinearElement,
  ExcalidrawMagicFrameElement,
  ExcalidrawTableElement,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  FileId,
  InitializedExcalidrawImageElement,
  MagicGenerationData,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type {
  LinearElementEditor,
  StoreDelta,
  TransformHandleDirection,
} from "@excalidraw/element";

import type { Mutable } from "@excalidraw/common/utility-types";

import { createRedoAction, createUndoAction } from "../actions/actionHistory";
import { ActionManager } from "../actions/manager";
import { actions } from "../actions/register";
import { getDefaultAppState } from "../appState";
import { type ParsedDataTransferFile } from "../clipboard";

import Library from "../data/library";
import { History } from "../history";
import { defaultLang, languages, setLanguage, t } from "../i18n";

import { editorJotaiStore, type WritableAtom } from "../editor-jotai";
import { Fonts } from "../fonts";
import { LaserTrails } from "../laserTrails";
import { withBatchedUpdates } from "../reactUtils";
import { Renderer } from "../scene/Renderer";
import {
  getReferenceSnapPoints,
  getVisibleGaps,
  isGridModeEnabled,
  isSnappingEnabled,
  SnapCache,
} from "../snapping";
import { type SetViewportOptions } from "../viewport";

import { EraserTrail } from "../eraser";
import { LassoTrail } from "../lasso";

import {
  getColorTargetAppStateUpdates,
  resolveColorTarget,
} from "../actions/colorTargets";

import * as clipboardController from "./app/clipboard";
import * as contextMenuController from "./app/contextMenu";
import * as embedsController from "./app/embeds";
import * as exportController from "./app/export";
import * as magicFrameController from "./app/magicFrame";

import { AppArrowText } from "./App.arrowText";
import { AppBucketFill } from "./App.bucketFill";
import { AppCursor } from "./App.cursor";
import { AppDrawShape } from "./App.drawshape";
import { AppDuplicate } from "./App.duplicate";
import { AppFlowchart } from "./App.flowchart";
import { AppMindmap } from "./App.mindmap";
import { AppPan } from "./App.pan";
import { AppToolDrag } from "./App.toolDrag";
import { AppViewport } from "./App.viewport";
import { AppWheel } from "./App.wheel";
import { AppEmbeds } from "./app/embeds";
import * as eventListeners from "./app/eventListeners";
import * as filesController from "./app/files";
import { AppFrames } from "./app/frames";
import * as gestureController from "./app/gesture";
import * as hitTestController from "./app/hitTest";
import * as keyboardController from "./app/keyboard";
import * as lifecycle from "./app/lifecycle";
import * as pointerCanvasController from "./app/pointerCanvas";
import * as pointerEraseController from "./app/pointerErase";
import * as pointerSelectionController from "./app/pointerSelection";
import * as pointerSessionController from "./app/pointerSession";
import {
  cleanupAfterMissingPointerUp,
  createInteractionState,
  handleDraggingScrollBar,
  resetContextMenuTimer,
  type InteractionState,
} from "./app/pointerSession";
import { AppView } from "./app/render";
import * as sceneController from "./app/scene";
import * as tableController from "./app/table";
import * as textController from "./app/text";
import { activeEyeDropperAtom } from "./EyeDropper";

import { AppStateObserver, type OnStateChange } from "./AppStateObserver";
import { CursorHints } from "./CursorHint";

import { editorInterfaceContextInitialValue } from "./app/context";

import type { textWysiwyg } from "../wysiwyg/textWysiwyg";

import type { RenderInteractiveSceneCallback } from "../scene/types";

import type { ClipboardData, PastedMixedContent } from "../clipboard";
import type { ExportedElements } from "../data";

import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Action, ActionResult } from "../actions/types";
import type {
  AppClassProperties,
  AppProps,
  AppState,
  BinaryFileData,
  BinaryFiles,
  ElementRenderOffsets,
  ElementRenderOverride,
  ElementRenderOverrides,
  ElementsPendingErasure,
  ExcalidrawImperativeAPI,
  ExcalidrawImperativeAPIEventMap,
  FrameNameBoundsCache,
  GenerateDiagramToCode,
  Gesture,
  GestureEvent,
  KeyboardModifiersObject,
  LibraryItems,
  NullableGridSize,
  OnUserFollowedPayload,
  PointerDownState,
  SceneData,
  SidebarName,
  SidebarTabName,
  ToolType,
  UIConfig,
} from "../types";

export {
  ExcalidrawAPIContext,
  ExcalidrawAPISetContext,
  ExcalidrawContainerContext,
  useApp,
  useAppProps,
  useEditorInterface,
  useExcalidrawActionManager,
  useExcalidrawAPI,
  useExcalidrawAppState,
  useExcalidrawContainer,
  useExcalidrawElements,
  useExcalidrawSetAppState,
  useStylesPanelMode,
} from "./app/context";

const editorLifecycleEventBehavior = {
  "editor:mount": { cardinality: "once", replay: "last" },
  "editor:initialize": { cardinality: "once", replay: "last" },
  "editor:unmount": { cardinality: "once", replay: "last" },
} as const;

class App extends React.Component<AppProps, AppState> {
  canvas: AppClassProperties["canvas"];
  interactiveCanvas: AppClassProperties["interactiveCanvas"] = null;
  public sessionExportThemeOverride: AppState["theme"] | undefined;
  /** Pointer gesture state belongs to this editor instance. */
  public gesture: Gesture = {
    pointers: new Map(),
    lastCenter: null,
    initialDistance: null,
    initialScale: null,
  };
  /** All transient pointer/touch/paste state belongs to this mounted editor. */
  public interactionState: InteractionState = createInteractionState();
  rc: RoughCanvas;
  unmounted: boolean = false;
  actionManager: ActionManager;
  editorInterface: EditorInterface = editorInterfaceContextInitialValue;
  private stylesPanelMode: StylesPanelMode = deriveStylesPanelMode(
    editorInterfaceContextInitialValue,
  );

  public excalidrawContainerRef = React.createRef<HTMLDivElement>();

  public get ownerDocument(): Document {
    return (
      this.props.ownerDocument ??
      this.excalidrawContainerRef.current?.ownerDocument ??
      document
    );
  }

  public get ownerWindow(): Window & typeof globalThis {
    return (this.ownerDocument.defaultView ?? window) as Window &
      typeof globalThis;
  }

  public scene: Scene;
  public fonts: Fonts;
  public renderer: Renderer;
  public visibleElements: readonly NonDeletedExcalidrawElement[];
  /** whether the last render had any renderable elements (excludes e.g. the
   * in-progress `newElement` and the edited text element) */
  public hasRenderableElements: boolean = false;
  private resizeObserver: ResizeObserver | undefined;
  public library: AppClassProperties["library"];
  public libraryItemsFromStorage: LibraryItems | undefined;
  public id: string;
  public store: Store;
  private history: History;
  public excalidrawContainerValue: {
    container: HTMLDivElement | null;
    id: string;
  };

  public files: BinaryFiles = {};
  public imageCache: AppClassProperties["imageCache"] = new Map();
  public embeds = new AppEmbeds(this);
  public embedsValidationStatus = this.embeds.validationStatus;

  public elementsPendingErasure: ElementsPendingErasure = new Set();

  private _initialized = false;

  private readonly editorLifecycleEvents = new AppEventBus<
    ExcalidrawImperativeAPIEventMap,
    typeof editorLifecycleEventBehavior
  >(editorLifecycleEventBehavior);

  public onEvent = this.editorLifecycleEvents.on.bind(
    this.editorLifecycleEvents,
  ) as AppEventBus<
    ExcalidrawImperativeAPIEventMap,
    typeof editorLifecycleEventBehavior
  >["on"];

  private appStateObserver = new AppStateObserver(() => this.state);

  public onStateChange: OnStateChange = this.appStateObserver.onStateChange;

  public bucketFill: AppBucketFill = new AppBucketFill(this);
  public duplicate: AppDuplicate = new AppDuplicate(this);
  public toolDrag: AppToolDrag = new AppToolDrag(this);
  public flowchart: AppFlowchart = new AppFlowchart(this);
  public mindmap: AppMindmap = new AppMindmap(this);
  public cursor: AppCursor = new AppCursor(this);
  public arrowText: AppArrowText = new AppArrowText(this);
  public pan: AppPan = new AppPan(this, {
    getPointerCount: () => this.gesture.pointers.size,
  });
  public viewport: AppViewport = new AppViewport(this, {
    getContainer: () => this.excalidrawContainerRef.current,
    getStylesPanelMode: () => this.stylesPanelMode,
    isGestureActive: () =>
      this.gesture.pointers.size >= 2 || this.pan.isActive(),
  });
  public wheel: AppWheel = new AppWheel(this);

  bindModeHandler: ReturnType<typeof setTimeout> | null = null;
  public textWysiwygSubmitHandler: ReturnType<typeof textWysiwyg> | null = null;

  hitLinkElement?: NonDeletedExcalidrawElement;
  lastPointerDownEvent: React.PointerEvent<HTMLElement> | null = null;
  private touchMindmapContextMenuAllowed: boolean | null = null;
  /**
   * the handle of the resize in progress while `state.isResizing` — for UI
   * that words itself by handle (a sticky note's corners resize
   * proportionally, its edges freely); not app state, so it costs no
   * re-render of its own
   */
  activeResizeHandle: TransformHandleDirection | null = null;
  lastPointerUpEvent: React.PointerEvent<HTMLElement> | PointerEvent | null =
    null;
  // TODO this is a hack and we should ideally unify touch and pointer events
  // and implement our own double click handling end-to-end (currently we're
  // using a mix of native browser for click events and manual for touch -
  // and browser doubleClick sucks to begin with)
  lastPointerUpIsDoubleClick: boolean = false;
  lastPointerMoveEvent: PointerEvent | null = null;
  /** current frame pointer cords */
  lastPointerMoveCoords: { x: number; y: number } | null = null;
  private lastCompletedCanvasClicks: { x: number; y: number }[] = [];
  /** previous frame pointer coords */
  previousPointerMoveCoords: { x: number; y: number } | null = null;

  drawShape = new AppDrawShape(this);
  laserTrails = new LaserTrails(this);
  eraserTrail = new EraserTrail(this);
  lassoTrail = new LassoTrail(this);
  cursorHints = new CursorHints(this);

  onChangeEmitter = new Emitter<
    [
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ]
  >();

  onPointerDownEmitter = new Emitter<
    [
      activeTool: AppState["activeTool"],
      pointerDownState: PointerDownState,
      event: React.PointerEvent<HTMLElement>,
    ]
  >();

  onPointerUpEmitter = new Emitter<
    [
      activeTool: AppState["activeTool"],
      pointerDownState: PointerDownState,
      event: PointerEvent,
    ]
  >();
  onUserFollowEmitter = new Emitter<[payload: OnUserFollowedPayload]>();
  onScrollChangeEmitter = new Emitter<
    [scrollX: number, scrollY: number, zoom: AppState["zoom"]]
  >();

  missingPointerEventCleanupEmitter = new Emitter<
    [event: PointerEvent | null]
  >();
  onRemoveEventListenersEmitter = new Emitter<[]>();

  api: ExcalidrawImperativeAPI;
  public elementRenderOverrides: ElementRenderOverrides = new Map();
  private mindmapDragOpacityIds = new Set<string>();
  private mindmapDragOpacityPrevious = new Map<
    string,
    ElementRenderOverride | undefined
  >();
  /** offsets of `elementRenderOverrides`; keeps its identity while they don't change */
  public elementRenderOffsets: ElementRenderOffsets = new Map();
  private renderOverridesUpdatePending = false;

  public getRenderOverrideConfig = () => ({
    elementRenderOverrides: this.elementRenderOverrides,
  });

  public getElementRenderState = (
    element: ExcalidrawElement,
    overrides: ElementRenderOverrides | null = this.elementRenderOverrides,
  ) =>
    resolveElementRenderState(element, this.scene.getNonDeletedElementsMap(), {
      elementRenderOverrides: overrides ?? undefined,
      elementsPendingErasure: this.elementsPendingErasure,
      pendingFlowchartNodes: null,
    });

  private createExcalidrawAPI(): ExcalidrawImperativeAPI {
    const api: ExcalidrawImperativeAPI = {
      isDestroyed: false,
      updateScene: this.updateScene,
      applyDeltas: this.applyDeltas,
      mutateElement: this.mutateElement,
      updateLibrary: this.library.updateLibrary,
      addFiles: this.addFiles,
      resetScene: this.resetScene,
      getSceneElementsIncludingDeleted: this.getSceneElementsIncludingDeleted,
      getSceneElementsMapIncludingDeleted:
        this.getSceneElementsMapIncludingDeleted,
      history: {
        clear: this.resetHistory,
      },
      setViewport: this.viewport.setViewport,
      getViewportOffsets: this.viewport.getOffsets,
      setElementRenderOverrides: this.setElementRenderOverrides,
      getSceneElements: this.getSceneElements,
      getAppState: () => this.state,
      getFiles: () => this.files,
      getName: this.getName,
      registerAction: (action: Action) => {
        this.actionManager.registerAction(action);
      },
      refresh: this.refresh,
      setToast: this.setToast,
      id: this.id,
      setActiveTool: this.setActiveTool,
      setCursor: this.cursor.set,
      resetCursor: this.cursor.reset,
      getEditorInterface: () => this.editorInterface,
      updateFrameRendering: this.updateFrameRendering,
      toggleSidebar: this.toggleSidebar,
      onChange: (cb) => this.onChangeEmitter.on(cb),
      onIncrement: (cb) => this.store.onStoreIncrementEmitter.on(cb),
      onPointerDown: (cb) => this.onPointerDownEmitter.on(cb),
      onPointerUp: (cb) => this.onPointerUpEmitter.on(cb),
      onScrollChange: (cb) => this.onScrollChangeEmitter.on(cb),
      onUserFollow: (cb) => this.onUserFollowEmitter.on(cb),
      onStateChange: this.onStateChange,
      onEvent: this.onEvent,
    };
    return api;
  }

  constructor(props: AppProps) {
    super(props);
    const defaultAppState = getDefaultAppState();
    const {
      viewModeEnabled = false,
      zenModeEnabled = false,
      gridModeEnabled = false,
      objectsSnapModeEnabled = false,
      theme = defaultAppState.theme,
      name = `${t("labels.untitled")}-${getDateTime()}`,
    } = props;

    // seed the host-forced tool so the first render already has it
    // (`handleForcedToolChange` keeps it in sync from then on)
    let forcedActiveTool: AppState["activeTool"] | null = null;
    if (props.activeTool) {
      if ((props.activeTool.type as string) === "image") {
        console.warn(`"image" tool cannot be forced via "props.activeTool"`);
      } else if (!this.isToolSupported(props.activeTool.type, props)) {
        console.warn(
          `"${props.activeTool.type}" tool ("props.activeTool") cannot be activated — disabled via "UIOptions.tools", or not enabled while non-interactive (see "interaction.enabled.tools")`,
        );
      } else {
        forcedActiveTool = updateActiveTool(defaultAppState, props.activeTool);
      }
    }

    this.state = {
      ...defaultAppState,
      theme,
      exportWithDarkMode: theme === THEME.DARK,
      isLoading: true,
      ...this.getCanvasOffsets(),
      // non-interactive editor implies view mode so that all edit-mode
      // gates apply
      viewModeEnabled: this.isInteractionEnabled(props)
        ? viewModeEnabled
        : true,
      activeTool: forcedActiveTool ?? defaultAppState.activeTool,
      zenModeEnabled,
      objectsSnapModeEnabled,
      gridModeEnabled: gridModeEnabled ?? defaultAppState.gridModeEnabled,
      name,
      width: this.ownerWindow.innerWidth,
      height: this.ownerWindow.innerHeight,
    };

    this.refreshEditorInterface();
    this.stylesPanelMode = deriveStylesPanelMode(this.editorInterface);

    this.id = nanoid();
    this.library = new Library(this);
    this.actionManager = new ActionManager(
      this.syncActionResult,
      () => this.state,
      () => this.scene.getElementsIncludingDeleted(),
      this,
    );
    this.scene = new Scene();

    this.canvas = this.ownerDocument.createElement("canvas");
    this.rc = rough.canvas(this.canvas);
    this.renderer = new Renderer(this.scene);
    this.visibleElements = [];

    this.store = new Store(this);
    this.history = new History(this.store);

    this.excalidrawContainerValue = {
      container: this.excalidrawContainerRef.current,
      id: this.id,
    };

    this.fonts = new Fonts(this.scene, this.ownerDocument);
    this.history = new History(this.store);

    this.actionManager.registerAll(actions);
    this.actionManager.registerAction(createUndoAction(this.history));
    this.actionManager.registerAction(createRedoAction(this.history));

    // in case internal editor APIs call this early, otherwise we need
    // to construct this in componentDidMount because componentWillUnmount
    // will invalidate it (so in StrictMode, doing this in constructor alone
    // would be a problem)
    this.api = this.createExcalidrawAPI();
  }

  /**
   * Whether the editor accepts user input (pointer, keyboard, wheel, touch,
   * clipboard, drag&drop). When `false`, the editor is fully inert for the
   * user, but remains controllable through the imperative API.
   *
   * All user-input entry points must consult this getter (directly or by
   * not being attached/rendered at all).
   */
  public isInteractionEnabled(
    props: Pick<AppProps, "interaction"> = this.props,
  ): boolean {
    return props.interaction !== false && typeof props.interaction !== "object";
  }

  /**
   * Whether element links render their link icon and are clickable.
   * True when fully interactive, or when `interaction: { enabled: { links:
   * true } }`
   * (in which case clicking anywhere on a linked element opens the link,
   * same as in view mode).
   */
  public isLinksEnabled(
    props: Pick<AppProps, "interaction"> = this.props,
  ): boolean {
    if (typeof props.interaction === "object" && props.interaction !== null) {
      return (
        props.interaction.enabled?.links === true ||
        props.interaction.enabled?.interactiveContent === true
      );
    }
    return props.interaction !== false;
  }

  /**
   * Whether canvas navigation — panning & zooming, view-mode style — is
   * enabled. True when fully interactive, or when `interaction: { enabled:
   * { navigation: true } }`. Respects `appState.scrollConstraints`.
   */
  public isNavigationEnabled(
    props: Pick<AppProps, "interaction"> = this.props,
  ): boolean {
    if (typeof props.interaction === "object" && props.interaction !== null) {
      return props.interaction.enabled?.navigation === true;
    }
    return props.interaction !== false;
  }

  /**
   * Whether embeddable & iframe elements are interactive (hover & click to
   * activate, view-mode style). True when fully interactive, or when
   * allowed via `interaction.enabled.embeds` / `.interactiveContent`.
   */
  public isEmbedsEnabled(
    props: Pick<AppProps, "interaction"> = this.props,
  ): boolean {
    if (typeof props.interaction === "object" && props.interaction !== null) {
      return (
        props.interaction.enabled?.embeds === true ||
        props.interaction.enabled?.interactiveContent === true
      );
    }
    return props.interaction !== false;
  }

  /**
   * Whether the browser's own zoom (ctrl/cmd + wheel, pinch, keyboard
   * shortcuts) stays available over the non-interactive editor.
   * Prevented by default.
   */
  public isBrowserZoomEnabled(
    props: Pick<AppProps, "interaction"> = this.props,
  ): boolean {
    if (typeof props.interaction === "object" && props.interaction !== null) {
      return props.interaction.enabled?.browserZoom === true;
    }
    return false;
  }

  /**
   * Whether the tool can be activated & driven by user input. False when
   * disabled via `UIOptions.tools`, or when the editor is non-interactive
   * and the tool isn't kept user-driven via `interaction.enabled.tools`.
   *
   * (Once UI tool availability is split from input availability — e.g.
   * `props.ui.tools` vs `interaction.disabled.tools` — the UI axis moves
   * out into its own predicate.)
   *
   * We purposely widen the `tool` type so this helper can be called with
   * any tool without having to type check it.
   */
  public isToolSupported = <T extends ToolType | "custom">(
    tool: T,
    props: Pick<AppProps, "interaction" | "UIOptions"> = this.props,
  ): boolean => {
    if (
      props.UIOptions.tools?.[
        tool as Extract<T, keyof AppProps["UIOptions"]["tools"]>
      ] === false
    ) {
      return false;
    }
    if (this.isInteractionEnabled(props)) {
      return true;
    }
    const tools =
      typeof props.interaction === "object" && props.interaction !== null
        ? props.interaction.enabled?.tools
        : undefined;
    if (tool === "laser") {
      return tools?.laser === true;
    }
    if (tool === "custom") {
      return tools?.custom === true;
    }
    return false;
  };

  /**
   * Whether the active tool is locked in place — via the tool lock
   * (padlock / Q) or by being host-forced (`props.activeTool`). A locked
   * tool doesn't revert to the selection tool after use, and elements drawn
   * with it aren't selected. Forcing deliberately does not mutate
   * `activeTool.locked`, which is the user's persisted padlock preference.
   */
  public isToolLocked(): boolean {
    return this.state.activeTool.locked || this.props.activeTool != null;
  }

  /**
   * Whether the active tool captures the primary pointer instead of the
   * view-mode drag-to-pan — the laser and host-implemented custom tools do;
   * while non-interactive, any tool allowed via
   * `interaction.enabled.tools` does. (Editing tools capture the pointer
   * trivially since view mode implies they're not active; this predicate only
   * matters where view-mode gates apply.)
   */
  public isActiveToolPointerCapturing(): boolean {
    if (!this.isInteractionEnabled()) {
      // an active tool that isn't allowed via `interaction.enabled.tools`
      // is inert — including the laser
      return this.isToolSupported(this.state.activeTool.type);
    }
    return (
      this.state.activeTool.type === "laser" ||
      this.state.activeTool.type === "custom"
    );
  }

  /** Whether Excalidraw's full default UI is rendered. */
  public isDefaultUIEnabled(props: Pick<AppProps, "ui"> = this.props): boolean {
    return (
      props.ui !== false && (typeof props.ui !== "object" || props.ui === null)
    );
  }

  /** Whether an individual default UI control is rendered. */
  public isUIControlEnabled(
    control: keyof UIConfig["enabled"],
    props: Pick<AppProps, "ui"> = this.props,
  ): boolean {
    if (typeof props.ui === "object" && props.ui !== null) {
      return props.ui.enabled?.[control] === true;
    }
    return props.ui !== false;
  }

  updateEditorAtom = <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ): Result => {
    const result = editorJotaiStore.set(atom, ...args);
    this.triggerRender();
    return result;
  };

  private onWindowMessage = (event: MessageEvent) =>
    this.embeds.onWindowMessage(event);

  public handleSkipBindMode() {
    return keyboardController.handleSkipBindMode(this);
  }

  public resetDelayedBindMode() {
    return keyboardController.resetDelayedBindMode(this);
  }

  private previousHoveredBindableElement: NonDeletedExcalidrawElement | null =
    null;

  public handleDelayedBindModeChange(
    arrow: ExcalidrawLinearElement,
    hoveredElement: NonDeletedExcalidrawElement | null,
  ) {
    return keyboardController.handleDelayedBindModeChange(
      this,
      arrow,
      hoveredElement,
    );
  }

  /**
   * Returns gridSize taking into account `gridModeEnabled`.
   * If disabled, returns null.
   */
  public getEffectiveGridSize = () => {
    return (
      isGridModeEnabled(this) ? this.state.gridSize : null
    ) as NullableGridSize;
  };

  public getTextCreationGridPoint = (x: number, y: number) => {
    const effectiveGridSize = this.getEffectiveGridSize();

    if (effectiveGridSize === null) {
      return null;
    }

    const getTextCreationGridCoordinate = (coordinate: number) => {
      const topLeftGridPoint =
        Math.floor(coordinate / effectiveGridSize) * effectiveGridSize;

      return topLeftGridPoint;
    };

    return {
      x: getTextCreationGridCoordinate(x),
      y: getTextCreationGridCoordinate(y),
    };
  };

  public getHTMLIFrameElement(element: ExcalidrawIframeLikeElement) {
    return this.embeds.getHTMLIFrameElement(element);
  }

  /**
   * AI-generated iframe elements aren't interactive while their generation
   * is still in progress (the partial content is render-only).
   */
  private isIframeLikeInteractive(element: ExcalidrawElement): boolean {
    return embedsController.isIframeLikeInteractive(this, element);
  }

  private handleIframeLikeElementHover = ({
    hitElement,
    scenePointer,
    moveEvent,
  }: {
    hitElement: NonDeleted<ExcalidrawElement> | null;
    scenePointer: { x: number; y: number };
    moveEvent: React.PointerEvent<HTMLCanvasElement>;
  }) =>
    embedsController.handleIframeLikeElementHover(this, {
      hitElement,
      scenePointer,
      moveEvent,
    });

  /** @returns true if iframe-like element click handled */
  private handleIframeLikeCenterClick(): boolean {
    return embedsController.handleIframeLikeCenterClick(this);
  }

  private isDoubleClick = (
    lastPointerEvent:
      | PointerEvent
      | React.PointerEvent<HTMLElement>
      | undefined
      | null,
    currentPointerEvent: PointerEvent | React.PointerEvent<HTMLElement>,
  ) => {
    return pointerCanvasController.isDoubleClick(
      this,
      lastPointerEvent,
      currentPointerEvent,
    );
  };

  private isIframeLikeElementCenter(
    el: ExcalidrawIframeLikeElement | null,
    event: React.PointerEvent<HTMLElement> | PointerEvent,
    sceneX: number,
    sceneY: number,
  ) {
    return embedsController.isIframeLikeElementCenter(
      this,
      el,
      event,
      sceneX,
      sceneY,
    );
  }

  public updateEmbedValidationStatus = (
    element: ExcalidrawEmbeddableElement,
    status: boolean,
  ) => this.embeds.updateEmbedValidationStatus(element, status);

  private updateEmbeddables = () => this.embeds.updateEmbeddables();

  public renderEmbeddables() {
    return this.embeds.renderEmbeddables();
  }

  public frames = new AppFrames(this);
  public frameNameBoundsCache: FrameNameBoundsCache =
    this.frames.frameNameBoundsCache;

  private resetEditingFrame = (frame: ExcalidrawFrameLikeElement | null) =>
    this.frames.resetEditingFrame(frame);

  public toggleOverscrollBehavior = (event: React.PointerEvent) => {
    // when pointer inside editor, disable overscroll behavior to prevent
    // panning to trigger history back/forward on MacOS Chrome
    this.ownerDocument.documentElement.style.overscrollBehaviorX =
      event.type === "pointerenter" ? "none" : "auto";
  };

  public render() {
    return <AppView app={this} />;
  }

  public focusContainer: AppClassProperties["focusContainer"] = () => {
    this.excalidrawContainerRef.current?.focus();
  };

  public getSceneElementsIncludingDeleted = () => {
    return this.scene.getElementsIncludingDeleted();
  };

  public getSceneElementsMapIncludingDeleted = () => {
    return this.scene.getElementsMapIncludingDeleted();
  };

  public getSceneElements = () => {
    return this.scene.getNonDeletedElements();
  };

  public onInsertElements = (elements: readonly ExcalidrawElement[]) => {
    this.addElementsFromPasteOrLibrary({
      elements,
      position: "center",
      files: null,
    });
  };

  public onExportImage = (
    type: keyof typeof EXPORT_IMAGE_TYPES,
    elements: ExportedElements,
    opts: { exportingFrame: NonDeleted<ExcalidrawFrameLikeElement> | null },
  ) => exportController.onExportImage(this, type, elements, opts);

  public magicGenerations = new Map<
    ExcalidrawIframeElement["id"],
    MagicGenerationData
  >();

  private updateMagicGeneration = ({
    frameElement,
    data,
  }: {
    frameElement: ExcalidrawIframeElement;
    data: MagicGenerationData;
  }) =>
    magicFrameController.updateMagicGeneration(this, {
      frameElement,
      data,
    });

  public plugins: {
    diagramToCode?: {
      generate: GenerateDiagramToCode;
    };
  } = {};

  public setPlugins(plugins: Partial<App["plugins"]>) {
    Object.assign(this.plugins, plugins);
  }

  public async onMagicFrameGenerate(
    magicFrame: Readonly<NonDeleted<ExcalidrawMagicFrameElement>>,
    source: "button" | "upstream",
  ) {
    return magicFrameController.onMagicFrameGenerate(this, magicFrame, source);
  }

  public onIframeSrcCopy(element: ExcalidrawIframeElement) {
    return magicFrameController.onIframeSrcCopy(this, element);
  }

  public onMagicframeToolSelect = () =>
    magicFrameController.onMagicframeToolSelect(this);

  public openEyeDropper = ({ type }: { type: "stroke" | "background" }) => {
    this.updateEditorAtom(activeEyeDropperAtom, {
      swapPreviewOnAlt: true,
      colorPickerType:
        type === "stroke" ? "elementStroke" : "elementBackground",
      onSelect: (color, event) => {
        const property =
          (type === "background" && event.altKey) ||
          (type === "stroke" && !event.altKey)
            ? "strokeColor"
            : "backgroundColor";
        const selectedElements = this.scene.getSelectedElements(this.state);
        if (
          !selectedElements.length ||
          this.state.activeTool.type !== "selection"
        ) {
          // no target: the pick becomes the default of whichever color
          // domain (regular / sticky note) the active tool draws in
          this.syncActionResult({
            appState: {
              ...this.state,
              ...getColorTargetAppStateUpdates(
                resolveColorTarget(
                  this.state,
                  this.scene.getNonDeletedElements(),
                  property,
                ),
                color,
              ),
            },
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        } else {
          const elementsMap = this.scene.getNonDeletedElementsMap();
          // a note's visible text is its label, so stroke picks include it
          const targetIds = new Set(
            this.scene
              .getSelectedElements({
                selectedElementIds: this.state.selectedElementIds,
                includeBoundTextElement: property === "strokeColor",
              })
              .map((element) => element.id),
          );
          this.updateScene({
            elements: this.scene
              .getElementsIncludingDeleted()
              .map((el) =>
                targetIds.has(el.id)
                  ? newElementWith(
                      el,
                      getColorUpdate(el, property, color, elementsMap),
                    )
                  : el,
              ),
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        }
      },
      keepOpenOnAlt: false,
    });
  };

  public dismissLinearEditor = () => {
    setTimeout(() => {
      if (this.state.selectedLinearElement?.isEditing) {
        this.setState({
          selectedLinearElement: {
            ...this.state.selectedLinearElement,
            isEditing: false,
          },
        });
      }
    });
  };

  public syncActionResult = withBatchedUpdates((actionResult: ActionResult) =>
    sceneController.syncActionResult(this, actionResult),
  );

  public resetHistory = () => sceneController.resetHistory(this);
  public resetStore = () => sceneController.resetStore(this);
  public resetScene = (opts?: { resetLoadingState: boolean }) =>
    sceneController.resetScene(this, opts);
  public initializeScene = () => lifecycle.initializeScene(this);
  public componentDidMount() {
    return lifecycle.componentDidMount(this);
  }
  public componentWillUnmount() {
    return lifecycle.componentWillUnmount(this);
  }
  public componentDidUpdate(prevProps: AppProps, prevState: AppState) {
    return lifecycle.componentDidUpdate(this, prevProps, prevState);
  }
  public addEventListeners = () => eventListeners.addEventListeners(this);
  public removeEventListeners = () => eventListeners.removeEventListeners(this);

  public scheduleCapture = () => this.store.scheduleCapture();

  // Lifecycle

  private onBlur = withBatchedUpdates(() => eventListeners.onBlur(this));

  private onUnload = () => eventListeners.onUnload(this);

  private disableEvent: EventListener = (event) =>
    eventListeners.disableEvent(event);

  // handles only the navigation keyboard: page-scroll keys and
  // `navigation`-flagged action shortcuts (canvas zoom & zoom-to-fit — see
  // `ActionManager.handleKeyDown` gates); the rest of the keyboard handling
  // stays disabled while non-interactive
  private handleNavigationModeKeyDown = (event: KeyboardEvent) => {
    keyboardController.handleNavigationModeKeyDown(this, event);
  };

  /**
   * PageUp/PageDown scroll the canvas by a page — vertically, or
   * horizontally with shift. Respects `appState.scrollConstraints`
   * (via `viewport.translate`).
   */
  public maybeHandlePageScrollKeyDown = (
    event: KeyboardEvent | React.KeyboardEvent,
  ): boolean => {
    return keyboardController.maybeHandlePageScrollKeyDown(this, event);
  };

  private preventBrowserZoomKeyDown = (event: KeyboardEvent) => {
    keyboardController.preventBrowserZoomKeyDown(event);
  };

  /** Ends active input sessions before switching to a view-mode/non-interactive
   *  mode. */
  private terminateActiveInteraction = () =>
    lifecycle.terminateActiveInteraction(this);

  /** whether the two values reference the same tool (incl. custom subtype) */
  private isSameForcedTool = (
    a: { type: string; customType?: string | null } | null | undefined,
    b: { type: string; customType?: string | null } | null | undefined,
  ) =>
    a?.type === b?.type &&
    (a?.type === "custom" ? a.customType ?? null : null) ===
      (b?.type === "custom" ? b.customType ?? null : null);

  private getFormFactor = (editorWidth: number, editorHeight: number) =>
    lifecycle.getFormFactor(this, editorWidth, editorHeight);

  public refreshEditorInterface = () => lifecycle.refreshEditorInterface(this);

  private reconcileStylesPanelMode = (nextEditorInterface: EditorInterface) =>
    lifecycle.reconcileStylesPanelMode(this, nextEditorInterface);

  /** TO BE USED LATER */
  private setDesktopUIMode = (mode: EditorInterface["desktopUIMode"]) =>
    lifecycle.setDesktopUIMode(this, mode);

  private clearImageShapeCache(filesMap?: BinaryFiles) {
    return filesController.clearImageShapeCache(this, filesMap);
  }

  private onResize = withBatchedUpdates(() => eventListeners.onResize(this));

  /** generally invoked only if fullscreen was invoked programmatically */
  private onFullscreenChange = () => eventListeners.onFullscreenChange(this);

  public renderInteractiveSceneCallback = ({
    scrollBars,
  }: RenderInteractiveSceneCallback) => {
    if (scrollBars) {
      this.interactionState.currentScrollBars = scrollBars;
    }

    this.scheduleImageRefresh();
  };

  private onScroll = debounce(
    () => eventListeners.onScroll(this),
    SCROLL_TIMEOUT,
  );

  // Copy/paste

  private onCut = withBatchedUpdates((event: ClipboardEvent) =>
    clipboardController.onCut(this, event),
  );

  private onCopy = withBatchedUpdates((event: ClipboardEvent) =>
    clipboardController.onCopy(this, event),
  );

  private onTouchStart = (event: TouchEvent) =>
    gestureController.onTouchStart(this, event);

  private onTouchEnd = (event: TouchEvent) =>
    gestureController.onTouchEnd(this, event);

  // TODO: Cover with tests
  private async insertClipboardContent(
    data: ClipboardData,
    dataTransferFiles: ParsedDataTransferFile[],
    isPlainPaste: boolean,
  ) {
    return clipboardController.insertClipboardContent(
      this,
      data,
      dataTransferFiles,
      isPlainPaste,
    );
  }

  public pasteFromClipboard = withBatchedUpdates((event: ClipboardEvent) =>
    clipboardController.pasteFromClipboard(this, event),
  );

  addElementsFromPasteOrLibrary = (opts: {
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles | null;
    position: { clientX: number; clientY: number } | "cursor" | "center";
    retainSeed?: boolean;
    fit?: SetViewportOptions["fit"];
    preserveFrameChildrenOrder?: boolean;
  }) => clipboardController.addElementsFromPasteOrLibrary(this, opts);

  // TODO rewrite this to paste both text & images at the same time if
  // pasted data contains both
  private async addElementsFromMixedContentPaste(
    mixedContent: PastedMixedContent,
    {
      isPlainPaste,
      sceneX,
      sceneY,
    }: { isPlainPaste: boolean; sceneX: number; sceneY: number },
  ) {
    return clipboardController.addElementsFromMixedContentPaste(
      this,
      mixedContent,
      {
        isPlainPaste,
        sceneX,
        sceneY,
      },
    );
  }

  private addTextFromPaste(text: string, isPlainPaste = false) {
    return clipboardController.addTextFromPaste(this, text, isPlainPaste);
  }

  setAppState: React.Component<any, AppState>["setState"] = (
    state,
    callback,
  ) => {
    this.setState(state, callback);
  };

  removePointer = (event: React.PointerEvent<HTMLElement> | PointerEvent) => {
    return pointerSessionController.removePointer(this, event);
  };

  toggleLock = (source: "keyboard" | "ui" = "ui") => {
    keyboardController.toggleLock(this, source);
  };

  updateFrameRendering = (
    opts:
      | Partial<AppState["frameRendering"]>
      | ((
          prevState: AppState["frameRendering"],
        ) => Partial<AppState["frameRendering"]>),
  ) => {
    this.setState((prevState) => {
      const next =
        typeof opts === "function" ? opts(prevState.frameRendering) : opts;
      return {
        frameRendering: {
          enabled: next?.enabled ?? prevState.frameRendering.enabled,
          clip: next?.clip ?? prevState.frameRendering.clip,
          name: next?.name ?? prevState.frameRendering.name,
          outline: next?.outline ?? prevState.frameRendering.outline,
        },
      };
    });
  };

  togglePenMode = (force: boolean | null) => {
    this.setState((prevState) => {
      return {
        penMode: force ?? !prevState.penMode,
        penDetected: true,
        currentItemStrokeVariability: !prevState.penDetected
          ? "variable"
          : prevState.currentItemStrokeVariability,
      };
    });
  };

  // scroll `elements` into view only if they aren't already fully visible.
  // Targets their bounds rather than the elements so it also works for
  // elements not yet committed to the canvas.
  revealIfHidden = (elements: NonDeletedExcalidrawElement[]) => {
    if (
      !elements.length ||
      isElementCompletelyInViewport(
        elements,
        this.canvas.width / this.ownerWindow.devicePixelRatio,
        this.canvas.height / this.ownerWindow.devicePixelRatio,
        {
          offsetLeft: this.state.offsetLeft,
          offsetTop: this.state.offsetTop,
          scrollX: this.state.scrollX,
          scrollY: this.state.scrollY,
          zoom: this.state.zoom,
        },
        this.scene.getNonDeletedElementsMap(),
        this.viewport.getOffsets(),
      )
    ) {
      return;
    }

    this.viewport.setViewport({
      target: getCommonBounds(elements),
      fit: "scale-down",
      animation: { duration: 300 },
      offsets: { ui: true },
    });
  };

  /** emits a follow/unfollow intent to the host (which owns the
   *  `userToFollow` state) via both the `onUserFollow` prop and the
   *  imperative API emitter */
  public emitUserFollowIntent = (payload: OnUserFollowedPayload) => {
    this.onUserFollowEmitter.trigger(payload);
    this.props.onUserFollow?.(payload);
  };

  /** emits an UNFOLLOW intent if currently following someone — use on
   *  user-initiated viewport changes which should break follow mode */
  public requestUnfollow = () => {
    if (this.props.userToFollow) {
      this.emitUserFollowIntent({
        userToFollow: this.props.userToFollow,
        action: "UNFOLLOW",
      });
    }
  };

  setToast = (toast: AppState["toast"]) => {
    this.setState({ toast });
  };

  restoreFileFromShare = async () => {
    try {
      const webShareTargetCache = await caches.open("web-share-target");

      const response = await webShareTargetCache.match("shared-file");
      if (response) {
        const blob = await response.blob();
        const file = new File([blob], blob.name || "", { type: blob.type });
        this.loadFileToCanvas(file, null);
        await webShareTargetCache.delete("shared-file");
        this.ownerWindow.history.replaceState(
          null,
          APP_NAME,
          this.ownerWindow.location.pathname,
        );
      }
    } catch (error: any) {
      this.setState({ errorMessage: error.message });
    }
  };

  /**
   * adds supplied files to existing files in the appState.
   * NOTE if file already exists in editor state, the file data is not updated
   * */
  public addFiles: ExcalidrawImperativeAPI["addFiles"] = (files) =>
    filesController.addFiles(this, files);

  private addMissingFiles = (
    files: BinaryFiles | BinaryFileData[],
    replace = false,
  ) => filesController.addMissingFiles(this, files, replace);

  /** Applies transient opacity to the source branch during a mindmap drag. */
  public setMindmapDragOpacity = (ids: readonly string[] | null) =>
    sceneController.setMindmapDragOpacity(this, ids);

  public updateScene = <K extends keyof AppState>(sceneData: {
    elements?: SceneData["elements"];
    appState?: Pick<AppState, K> | null;
    collaborators?: SceneData["collaborators"];
    captureUpdate?: SceneData["captureUpdate"];
  }) => sceneController.updateScene(this, sceneData);
  /**
   * see {@link ExcalidrawImperativeAPI.setElementRenderOverrides} for details
   */
  public setElementRenderOverrides = (
    overrides: ElementRenderOverrides | null,
  ) => sceneController.setElementRenderOverrides(this, overrides);
  public applyDeltas = (deltas: StoreDelta[], options?: ApplyToOptions) =>
    sceneController.applyDeltas(this, deltas, options);
  public mutateElement = <TElement extends Mutable<ExcalidrawElement>>(
    element: TElement,
    updates: ElementUpdate<TElement>,
    informMutation = true,
  ) => sceneController.mutateElement(this, element, updates, informMutation);

  public triggerRender = (
    /** force always re-renders canvas even if no change */
    force?: boolean,
  ) => {
    if (force === true) {
      this.scene.triggerUpdate();
    } else {
      this.setState({});
    }
  };

  /**
   * @returns whether the menu was toggled on or off
   */
  public toggleSidebar = ({
    name,
    tab,
    force,
  }: {
    name: SidebarName | null;
    tab?: SidebarTabName;
    force?: boolean;
  }): boolean => {
    let nextName;
    if (force === undefined) {
      nextName =
        this.state.openSidebar?.name === name &&
        this.state.openSidebar?.tab === tab
          ? null
          : name;
    } else {
      nextName = force ? name : null;
    }

    const nextState: AppState["openSidebar"] = nextName
      ? { name: nextName }
      : null;
    if (nextState && tab) {
      nextState.tab = tab;
    }

    this.setState({ openSidebar: nextState });

    return !!nextName;
  };

  private updateCurrentCursorPosition = withBatchedUpdates(
    (event: MouseEvent) => {
      this.viewport.lastPosition.x = event.clientX;
      this.viewport.lastPosition.y = event.clientY;
    },
  );

  // Input handling
  public onKeyDown = withBatchedUpdates(
    (event: React.KeyboardEvent | KeyboardEvent) =>
      keyboardController.onKeyDown(this, event),
  );

  private onKeyUp = withBatchedUpdates((event: KeyboardEvent) =>
    keyboardController.onKeyUp(this, event),
  );

  setActiveTool = (
    tool: ({ type: ToolType } | { type: "custom"; customType: string }) & {
      locked?: boolean;
      fromSelection?: boolean;
    },
    opts: {
      keepSelection?: boolean;
      /**
       * When `true`, re-activating an already-active toggle tool (see
       * `TOGGLE_TOOLS`) switches back to the previously active tool.
       * Activation is idempotent by default; toggle tools always record the
       * previously active tool regardless (so ESC and the next `toggle`
       * activation can switch back to it).
       */
      toggle?: boolean;
    } = {},
  ) => keyboardController.setActiveTool(this, tool, opts);

  setOpenDialog = (dialogType: AppState["openDialog"]) => {
    this.setState({ openDialog: dialogType });
  };

  /**
   * returns whether user is making a gesture with >= 2 fingers (points)
   * on o touch screen (not on a trackpad). Currently only relates to Darwin
   * (iOS/iPadOS,MacOS), but may work on other devices in the future if
   * GestureEvent is standardized.
   */
  private isTouchScreenMultiTouchGesture = () => {
    return gestureController.isTouchScreenMultiTouchGesture(this);
  };

  public getName = () => {
    return (
      this.state.name ||
      this.props.name ||
      `${t("labels.untitled")}-${getDateTime()}`
    );
  };

  // fires only on Safari
  private onGestureStart = withBatchedUpdates((event: GestureEvent) => {
    gestureController.onGestureStart(this, event);
  });

  // fires only on Safari
  private onGestureChange = withBatchedUpdates((event: GestureEvent) => {
    gestureController.onGestureChange(this, event);
  });

  // fires only on Safari
  private onGestureEnd = withBatchedUpdates((event: GestureEvent) => {
    gestureController.onGestureEnd(this, event);
  });

  public handleTextWysiwyg(
    element: NonDeleted<ExcalidrawTextElement>,
    options: {
      isExistingElement?: boolean;
      initialCaretSceneCoords?: { x: number; y: number } | null;
    },
  ) {
    return textController.handleTextWysiwyg(this, element, options);
  }

  public deselectElements() {
    this.setState({
      selectedElementIds: makeNextSelectedElementIds({}, this.state),
      selectedGroupIds: {},
      editingGroupId: null,
      activeEmbeddable: null,
    });
  }

  public getSelectedTextElement(
    container?: ExcalidrawTextContainer | null,
  ): NonDeleted<ExcalidrawTextElement> | null {
    return textController.getSelectedTextElement(this, container);
  }

  private getSelectedTextEditingContainerAtPosition(
    hitElement: NonDeletedExcalidrawElement | null,
    sceneCoords: { x: number; y: number },
  ): ExcalidrawTextContainer | null | undefined {
    return textController.getSelectedTextEditingContainerAtPosition(
      this,
      hitElement,
      sceneCoords,
    );
  }

  getTextElementAtPosition(
    x: number,
    y: number,
  ): NonDeleted<ExcalidrawTextElement> | null {
    return textController.getTextElementAtPosition(this, x, y);
  }

  private isHittingTextAutoResizeHandle = (
    selectedElements: NonDeleted<ExcalidrawElement>[],
    point: Readonly<{ x: number; y: number }>,
  ): boolean => {
    return textController.isHittingTextAutoResizeHandle(
      this,
      selectedElements,
      point,
    );
  };

  private handleTextAutoResizeHandlePointerDown = (
    selectedElements: NonDeleted<ExcalidrawElement>[],
    point: Readonly<{ x: number; y: number }>,
  ) => {
    return textController.handleTextAutoResizeHandlePointerDown(
      this,
      selectedElements,
      point,
    );
  };

  // NOTE: Hot path for hit testing, so avoid unnecessary computations
  public getElementAtPosition(
    x: number,
    y: number,
    opts?: (
      | {
          includeBoundTextElement?: boolean;
          includeLockedElements?: boolean;
        }
      | {
          allHitElements: NonDeleted<ExcalidrawElement>[];
        }
    ) & {
      preferSelected?: boolean;
    },
  ): NonDeleted<ExcalidrawElement> | null {
    return hitTestController.getElementAtPosition(this, x, y, opts);
  }

  // NOTE: Hot path for hit testing, so avoid unnecessary computations
  getElementsAtPosition(
    x: number,
    y: number,
    opts?: {
      includeBoundTextElement?: boolean;
      includeLockedElements?: boolean;
    },
  ): NonDeleted<ExcalidrawElement>[] {
    return hitTestController.getElementsAtPosition(this, x, y, opts);
  }

  getElementHitThreshold(element: ExcalidrawElement) {
    return hitTestController.getElementHitThreshold(this, element);
  }

  hitElement(
    x: number,
    y: number,
    element: NonDeletedExcalidrawElement,
    considerBoundingBox = true,
  ) {
    return hitTestController.hitElement(
      this,
      x,
      y,
      element,
      considerBoundingBox,
    );
  }

  getTextBindableContainerAtPosition(x: number, y: number) {
    return hitTestController.getTextBindableContainerAtPosition(this, x, y);
  }

  /**
   * Whether a text element's content is still being authored.
   *
   * Creating a text reverts the tool to selection during pointerdown, so the
   * pointerup that follows looks like an ordinary canvas click and would
   * capture the still-empty element as a history entry of its own. Undo would
   * then rewind only the typing, restoring an invisible, zero-content element
   * (and, for an endpoint label, leaving the arrow bound to it) rather than
   * removing it. The editor's own submit captures the finished text instead,
   * so the whole create-and-type lands in a single entry.
   */
  private isEditingTextContent() {
    return textController.isEditingTextContent(this);
  }

  public startTextEditing = (
    options: Parameters<typeof textController.startTextEditing>[1],
  ) => textController.startTextEditing(this, options);

  public startImageCropping = (image: ExcalidrawImageElement) => {
    this.store.scheduleCapture();
    this.setState({
      croppingElementId: image.id,
    });
  };

  public finishImageCropping = () => {
    if (this.state.croppingElementId) {
      this.store.scheduleCapture();
      this.setState({
        croppingElementId: null,
      });
    }
  };

  private shouldHandleBrowserCanvasDoubleClick = (type: string) => {
    return pointerCanvasController.shouldHandleBrowserCanvasDoubleClick(
      this,
      type,
    );
  };

  public handleCanvasDoubleClick = (
    event: Pick<
      React.MouseEvent<HTMLCanvasElement>,
      | "type"
      | "clientX"
      | "clientY"
      | "altKey"
      | "ctrlKey"
      | "metaKey"
      | "shiftKey"
    >,
  ) => {
    return pointerCanvasController.handleCanvasDoubleClick(this, event);
  };

  public handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    return pointerCanvasController.handleCanvasClick(this, event);
  };

  private getElementLinkAtPosition = (
    scenePointer: Readonly<{ x: number; y: number }>,
    hitElementMightBeLocked: NonDeletedExcalidrawElement | null,
  ): NonDeletedExcalidrawElement | undefined => {
    return pointerCanvasController.getElementLinkAtPosition(
      this,
      scenePointer,
      hitElementMightBeLocked,
    );
  };

  private handleElementLinkClick = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    pointerCanvasController.handleElementLinkClick(this, event);
  };

  /**
   * Applies (or clears) the element-link hover affordances — pointer cursor
   * and tooltip — based on the current `hitLinkElement`. Returns whether a
   * link is being hovered.
   */
  private applyElementLinkHoverAffordance = (): boolean => {
    return pointerCanvasController.applyElementLinkHoverAffordance(this);
  };

  /**
   * On touchscreens (where no hover precedes the tap) re-derives
   * `hitLinkElement`, then opens the hit element link, if any.
   * Returns whether a link click was handled.
   */
  private maybeHandleElementLinkClick = (
    event: React.PointerEvent<HTMLCanvasElement>,
    scenePointer: { x: number; y: number },
  ): boolean => {
    return pointerCanvasController.maybeHandleElementLinkClick(
      this,
      event,
      scenePointer,
    );
  };

  /**
   * Restricted pointer handling for the non-interactive editor with links
   * and/or embeds allowed (`interaction.enabled.links` / `.embeds` /
   * `.interactiveContent`) — runs only the element-link & embed concerns
   * (shared with the full pointer handlers above) so they behave like in
   * view mode without the rest of the canvas pointer machinery.
   */
  private handleInteractiveContentPointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    return pointerCanvasController.handleInteractiveContentPointerMove(
      this,
      event,
    );
  };

  private handleInteractiveContentPointerUp = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    return pointerCanvasController.handleInteractiveContentPointerUp(
      this,
      event,
    );
  };

  /**
   * finds candidate frame under cursor (when dragging frame children/elements
   * inside frames)
   */
  public getTopLayerFrameAtSceneCoords = (
    /**
     * should be already grid aligned (basically should be what the call site
     * sets the element's coords to, if applicable)
     */
    sceneCoords: {
      x: number;
      y: number;
    },
    opts?: {
      /** to exclude selected elements when dragging, etc. */
      excludeElementIds?: AppState["selectedElementIds"];
      currentFrameId?: string | null;
    },
  ) => {
    return pointerCanvasController.getTopLayerFrameAtSceneCoords(
      this,
      sceneCoords,
      opts,
    );
  };

  private updateFrameToHighlight = (
    frameToHighlight: AppState["frameToHighlight"],
  ) => {
    pointerCanvasController.updateFrameToHighlight(this, frameToHighlight);
  };

  private maybeUpdateFrameToHighlightOnPointerMove = (
    sceneCoords: { x: number; y: number },
    isOverScrollBar: boolean,
  ) => {
    // currently this function is being called even during pointerdown so we
    // need to make sure we don't re-set the state when dragging and similar
    //
    // But, we still want to reset on pointermove in case the state is stale
    // so we updte even for non-eligible tool types
    pointerCanvasController.maybeUpdateFrameToHighlightOnPointerMove(
      this,
      sceneCoords,
      isOverScrollBar,
    );
  };

  public updateTableCellHighlight = (
    highlightedTableCell: AppState["highlightedTableCell"],
  ) => {
    tableController.updateTableCellHighlight(this, highlightedTableCell);
  };

  public maybeUpdateTableCellHighlightOnPointerMove = (
    sceneCoords: { x: number; y: number },
    isOverScrollBar: boolean,
  ) => {
    tableController.maybeUpdateTableCellHighlightOnPointerMove(
      this,
      sceneCoords,
      isOverScrollBar,
    );
  };

  /**
   * The cell a drop lands in — shared by the drag preview and the pointer-up
   * commit (phase-1.md:87), so both always judge by the same rule.
   */
  public getTableCellDropTargetAtSceneCoords = (
    sceneCoords: { x: number; y: number },
    opts?: {
      excludeElementIds?: AppState["selectedElementIds"];
      currentTableId?: string | null;
    },
  ) => {
    return tableController.getTableCellDropTargetAtSceneCoords(
      this,
      sceneCoords,
      opts,
    );
  };

  /**
   * What container a new element created at `sceneCoords` belongs to: the
   * deepest visible table cell wins, then the top-layer frame, then the
   * canvas (phase-1.md:87).
   */
  public getContainerRefForDropAt = (sceneCoords: { x: number; y: number }) => {
    const cellTarget = tableController.getTableCellDropTargetAtSceneCoords(
      this,
      sceneCoords,
    );
    if (cellTarget) {
      return tableCellContainerRef(
        cellTarget.table.id,
        cellTarget.cellId,
        "content",
      );
    }
    const frame = this.getTopLayerFrameAtSceneCoords(sceneCoords);
    return frameLikeContainerRef(frame?.id);
  };

  public handleTableCellDoubleClick = (sceneX: number, sceneY: number) => {
    return tableController.handleTableCellDoubleClick(this, sceneX, sceneY);
  };

  public selectTableCellAtPoint = (
    sceneCoords: { x: number; y: number },
    shiftKey: boolean,
  ) => tableController.selectTableCellAtPoint(this, sceneCoords, shiftKey);

  public moveTableCellSelectionFocus = (
    direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
    extend: boolean,
  ) => tableController.moveTableCellSelectionFocus(this, direction, extend);

  public editSelectedTableCellBackgroundText = () =>
    tableController.editSelectedTableCellBackgroundText(this);

  public commitTableCellMerge = () =>
    tableController.commitTableCellMerge(this);

  public commitTableCellSplit = () =>
    tableController.commitTableCellSplit(this);

  public clearSelectedTableCells = (
    kind: "content" | "backgroundText" | "style",
  ) => tableController.clearSelectedTableCells(this, kind);

  public copySelectedTableCellFormat = () =>
    tableController.copySelectedTableCellFormat(this);

  public pasteSelectedTableCellFormat = () =>
    tableController.pasteSelectedTableCellFormat(this);

  public centerSelectedTableCellContent = () =>
    tableController.centerSelectedTableCellContent(this);

  /**
   * Pointer down on a table structure zone (grip/separator/insert/select):
   * arms the gesture, or performs the select click; returns consumption.
   */
  public armTableStructureGestureOnPointerDown = (
    pointerDownState: PointerDownState,
  ): boolean => {
    return tableController.armTableStructureGestureOnPointerDown(
      this,
      pointerDownState,
    );
  };

  /** Per-frame progress of an armed table structure/scale gesture. */
  public handleTableGestureMove = (
    pointerDownState: PointerDownState,
    pointerCoords: { x: number; y: number },
  ): boolean => {
    return tableController.handleTableGestureMove(
      this,
      pointerDownState,
      pointerCoords,
    );
  };

  /** Esc during an armed gesture: restore the arm-time scene, no history. */
  public cancelTableGesture = (pointerDownState: PointerDownState): boolean => {
    return tableController.cancelTableGesture(this, pointerDownState);
  };

  /** Pointer up of an armed gesture: commit what the preview showed. */
  public finalizeTableGestureOnPointerUp = (
    pointerDownState: PointerDownState,
    sceneCoords: { x: number; y: number },
  ): boolean => {
    return tableController.finalizeTableGestureOnPointerUp(
      this,
      pointerDownState,
      sceneCoords,
    );
  };

  public maybeUpdateTableStructureHoverOnPointerMove = (
    sceneCoords: { x: number; y: number },
    isOverScrollBar: boolean,
  ): void => {
    tableController.maybeUpdateTableStructureHoverOnPointerMove(
      this,
      sceneCoords,
      isOverScrollBar,
    );
  };

  public deleteSelectedTableRowCol = (): boolean => {
    return tableController.deleteSelectedTableRowCol(this);
  };

  public moveSelectedTableRowCol = (direction: -1 | 1): boolean => {
    return tableController.moveSelectedTableRowCol(this, direction);
  };

  /**
   * Keyboard insert entry: a row/column selection receives the new row right
   * below (new column right next to) it; without a matching selection the
   * row/column appends at the table's end (phase-1.md:89).
   */
  public insertTableRowCol = (kind: "insertRow" | "insertColumn"): boolean => {
    const selection = this.state.tableRowColSelection;
    if (!selection) {
      return false;
    }
    const table = this.scene.getNonDeletedElement(selection.tableId);
    if (!table || !isTableElement(table)) {
      return false;
    }
    const wantsRow = kind === "insertRow";
    const entries = wantsRow ? table.table.rows : table.table.columns;
    const selectedIndex = entries.findIndex(
      (entry) => entry.id === selection.id,
    );
    const boundaryIndex =
      selection.kind === (wantsRow ? "row" : "column") && selectedIndex !== -1
        ? selectedIndex + 1
        : entries.length;
    tableController.commitTableInsert(this, table, kind, boundaryIndex);
    return true;
  };

  public insertNewElements = (elements: readonly ExcalidrawElement[]) => {
    if (!elements.length) {
      return;
    }

    const chunkedElements: ExcalidrawElement[][] = [];

    for (const element of elements) {
      const currentChunk = chunkedElements[chunkedElements.length - 1];

      if (
        currentChunk &&
        currentChunk[0].containerRef?.elementId ===
          element.containerRef?.elementId
      ) {
        currentChunk.push(element);
      } else {
        chunkedElements.push([element]);
      }
    }

    for (const chunk of chunkedElements) {
      const containerRef = chunk[0].containerRef;
      const frameId = containerRef?.elementId;

      const insertionIndex =
        frameId && containerRef?.kind === "tableCell"
          ? getTableCellInsertionIndex(
              this.scene.getElementsIncludingDeleted(),
              frameId,
              containerRef.cellId,
            )
          : frameId
          ? getFrameChildrenInsertionIndex(
              this.scene.getElementsIncludingDeleted(),
              frameId,
            )
          : null;
      this.scene.insertElementsAtIndex(chunk, insertionIndex);
    }
  };

  public insertNewElement = (element: ExcalidrawElement) => {
    this.insertNewElements([element]);

    const containerRef = element.containerRef;
    if (containerRef?.kind === "tableCell") {
      this.updateTableCellHighlight({
        tableId: containerRef.elementId,
        cellId: containerRef.cellId,
      });
      return;
    }

    const frame = containerRef?.elementId
      ? this.scene.getNonDeletedElement(containerRef.elementId)
      : null;

    this.updateFrameToHighlight(
      frame && isFrameLikeElement(frame) ? frame : null,
    );
  };

  public handleCanvasPointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    return pointerCanvasController.handleCanvasPointerMove(this, event);
  };

  private handleEraser = (
    event: PointerEvent,
    scenePointer: { x: number; y: number },
  ) => {
    pointerEraseController.handleEraser(this, event, scenePointer);
  };

  // set touch moving for mobile context menu
  public handleTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
    return pointerSessionController.handleTouchMove(this, event);
  };

  /**
   * Applies the hover affordances of a selected linear element: the cursor,
   * plus the hovered-handle state that renders them highlighted.
   */
  handleHoverSelectedLinearElement(
    linearElementEditor: LinearElementEditor,
    scenePointerX: number,
    scenePointerY: number,
  ) {
    return pointerCanvasController.handleHoverSelectedLinearElement(
      this,
      linearElementEditor,
      scenePointerX,
      scenePointerY,
    );
  }

  public handleCanvasPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    return pointerSessionController.handleCanvasPointerDown(this, event);
  };

  public handleCanvasPointerUp = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    pointerCanvasController.handleCanvasPointerUp(this, event);
  };

  private maybeOpenContextMenuAfterPointerDownOnTouchDevices = (
    event: React.PointerEvent<HTMLElement>,
    selectedElementIdsBeforePointerDown: AppState["selectedElementIds"],
  ): void => {
    return pointerSessionController.maybeOpenContextMenuAfterPointerDownOnTouchDevices(
      this,
      event,
      selectedElementIdsBeforePointerDown,
    );
  };

  private resetContextMenuTimer = () => {
    resetContextMenuTimer(this);
  };

  /**
   * pointerup may not fire in certian cases (user tabs away...), so in order
   * to properly cleanup pointerdown state, we need to fire any hanging
   * pointerup handlers manually
   */
  public maybeCleanupAfterMissingPointerUp = (event: PointerEvent | null) => {
    cleanupAfterMissingPointerUp(this, event);
  };

  private updateGestureOnPointerDown(
    event: React.PointerEvent<HTMLElement>,
  ): void {
    gestureController.updateGestureOnPointerDown(this, event);
  }

  /**
   * Tracks the pointer within the ongoing multi-touch gesture and applies
   * the two-finger pinch zoom/pan, if any.
   */
  private updateMultiTouchGesture = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    gestureController.updateMultiTouchGesture(this, event);
  };

  private initialPointerDownState(
    event: React.PointerEvent<HTMLElement>,
  ): PointerDownState {
    return pointerSessionController.initialPointerDownState(this, event);
  }

  // Returns whether the event is a dragging a scrollbar
  private handleDraggingScrollBar(
    event: React.PointerEvent<HTMLElement>,
    pointerDownState: PointerDownState,
  ): boolean {
    return handleDraggingScrollBar(this, event, pointerDownState);
  }

  private clearSelectionIfNotUsingSelection = (): void => {
    pointerSelectionController.clearSelectionIfNotUsingSelection(this);
  };

  /**
   * @returns whether the pointer event has been completely handled
   */
  private handleSelectionOnPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    pointerDownState: PointerDownState,
  ): boolean => {
    return pointerSelectionController.handleSelectionOnPointerDown(
      this,
      event,
      pointerDownState,
    );
  };
  private isASelectedElement(hitElement: ExcalidrawElement | null): boolean {
    return pointerSelectionController.isASelectedElement(this, hitElement);
  }

  private isHittingCommonBoundingBoxOfSelectedElements(
    point: Readonly<{ x: number; y: number }>,
    selectedElements: readonly ExcalidrawElement[],
  ): boolean {
    return pointerSelectionController.isHittingCommonBoundingBoxOfSelectedElements(
      this,
      point,
      selectedElements,
    );
  }

  private handleTextOnPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    pointerDownState: PointerDownState,
  ): void => {
    return pointerSelectionController.handleTextOnPointerDown(
      this,
      event,
      pointerDownState,
    );
  };

  private handleFreeDrawElementOnPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    elementType: ExcalidrawFreeDrawElement["type"],
    pointerDownState: PointerDownState,
  ) => {
    return pointerSelectionController.handleFreeDrawElementOnPointerDown(
      this,
      event,
      elementType,
      pointerDownState,
    );
  };

  public insertIframeElement = ({
    sceneX,
    sceneY,
    width,
    height,
  }: {
    sceneX: number;
    sceneY: number;
    width: number;
    height: number;
  }) =>
    embedsController.insertIframeElement(this, {
      sceneX,
      sceneY,
      width,
      height,
    });

  //create rectangle element with youtube top left on nearest grid point width / hight 640/360
  public insertEmbeddableElement = ({
    sceneX,
    sceneY,
    link,
  }: {
    sceneX: number;
    sceneY: number;
    link: string;
  }) =>
    embedsController.insertEmbeddableElement(this, {
      sceneX,
      sceneY,
      link,
    });

  private newImagePlaceholder = ({
    sceneX,
    sceneY,
    addToFrameUnderCursor = true,
  }: {
    sceneX: number;
    sceneY: number;
    addToFrameUnderCursor?: boolean;
  }) =>
    filesController.newImagePlaceholder(this, {
      sceneX,
      sceneY,
      addToFrameUnderCursor,
    });

  private handleLinearElementOnPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    elementType: ExcalidrawLinearElement["type"],
    pointerDownState: PointerDownState,
  ): void => {
    return pointerSelectionController.handleLinearElementOnPointerDown(
      this,
      event,
      elementType,
      pointerDownState,
    );
  };

  public getCurrentItemRoundness(
    elementType:
      | "selection"
      | "rectangle"
      | "stickynote"
      | "diamond"
      | "ellipse"
      | "iframe"
      | "embeddable",
  ) {
    return this.state.currentItemRoundness === "round"
      ? {
          type: isUsingAdaptiveRadius(elementType)
            ? ROUNDNESS.ADAPTIVE_RADIUS
            : ROUNDNESS.PROPORTIONAL_RADIUS,
        }
      : null;
  }

  public getCurrentItemStrokeWidth(
    elementType: ExcalidrawElement["type"] | ToolType,
  ) {
    return getStrokeWidthByKey(
      elementType,
      this.state.currentItemStrokeWidthKey,
    );
  }

  private createGenericElementOnPointerDown = (
    elementType:
      | Extract<ToolType, "selection" | "rectangle" | "diamond" | "ellipse">
      | "embeddable"
      | "stickynote",
    pointerDownState: PointerDownState,
  ): void => {
    return pointerSelectionController.createGenericElementOnPointerDown(
      this,
      elementType,
      pointerDownState,
    );
  };

  private createFrameElementOnPointerDown = (
    pointerDownState: PointerDownState,
    type: Extract<ToolType, "frame" | "magicframe">,
  ): void => {
    return pointerSelectionController.createFrameElementOnPointerDown(
      this,
      pointerDownState,
      type,
    );
  };

  private createTableElementOnPointerDown = (
    pointerDownState: PointerDownState,
  ): void => {
    return tableController.createTableElementOnPointerDown(
      this,
      pointerDownState,
    );
  };

  private finalizeNewTableElementOnPointerUp = (
    newElement: NonDeleted<ExcalidrawTableElement>,
  ): void => {
    return tableController.finalizeNewTableElementOnPointerUp(this, newElement);
  };

  public maybeCacheReferenceSnapPoints(
    event: KeyboardModifiersObject,
    selectedElements: readonly NonDeletedExcalidrawElement[],
    recomputeAnyways: boolean = false,
  ) {
    if (
      isSnappingEnabled({
        event,
        app: this,
        selectedElements,
      }) &&
      (recomputeAnyways || !SnapCache.getReferenceSnapPoints())
    ) {
      SnapCache.setReferenceSnapPoints(
        getReferenceSnapPoints(
          this.scene.getNonDeletedElements(),
          selectedElements,
          this.state,
          this.scene.getNonDeletedElementsMap(),
        ),
      );
    }
  }

  public maybeCacheVisibleGaps(
    event: KeyboardModifiersObject,
    selectedElements: readonly NonDeletedExcalidrawElement[],
    recomputeAnyways: boolean = false,
  ) {
    if (
      isSnappingEnabled({
        event,
        app: this,
        selectedElements,
      }) &&
      (recomputeAnyways || !SnapCache.getVisibleGaps())
    ) {
      SnapCache.setVisibleGaps(
        getVisibleGaps(
          this.scene.getNonDeletedElements(),
          selectedElements,
          this.state,
          this.scene.getNonDeletedElementsMap(),
        ),
      );
    }
  }

  private onKeyDownFromPointerDownHandler(
    pointerDownState: PointerDownState,
  ): (event: KeyboardEvent) => void {
    return pointerSessionController.onKeyDownFromPointerDownHandler(
      this,
      pointerDownState,
    );
  }

  private onKeyUpFromPointerDownHandler(
    pointerDownState: PointerDownState,
  ): (event: KeyboardEvent) => void {
    return pointerSessionController.onKeyUpFromPointerDownHandler(
      this,
      pointerDownState,
    );
  }

  private onPointerMoveFromPointerDownHandler(
    pointerDownState: PointerDownState,
  ) {
    return pointerSessionController.onPointerMoveFromPointerDownHandler(
      this,
      pointerDownState,
    );
  }

  // Returns whether the pointer move happened over either scrollbar
  private handlePointerMoveOverScrollbars(
    event: PointerEvent,
    pointerDownState: PointerDownState,
  ): boolean {
    return pointerSessionController.handlePointerMoveOverScrollbars(
      this,
      event,
      pointerDownState,
    );
  }

  private onPointerUpFromPointerDownHandler(
    pointerDownState: PointerDownState,
  ): (event: PointerEvent) => void {
    return pointerSessionController.onPointerUpFromPointerDownHandler(
      this,
      pointerDownState,
    );
  }

  private restoreReadyToEraseElements = () => {
    pointerEraseController.restoreReadyToEraseElements(this);
  };

  private eraseElements = () => {
    pointerEraseController.eraseElements(this);
  };

  /**
   * use during async image initialization,
   * when the placeholder image could have been modified in the meantime,
   * and when you don't want to loose those modifications
   */
  private getLatestInitializedImageElement = (
    imagePlaceholder: ExcalidrawImageElement,
    fileId: FileId,
  ) =>
    filesController.getLatestInitializedImageElement(
      this,
      imagePlaceholder,
      fileId,
    );

  private onImageToolbarButtonClick = () =>
    filesController.onImageToolbarButtonClick(this);

  private getImageNaturalDimensions = (
    imageElement: ExcalidrawImageElement,
    imageHTML: HTMLImageElement,
  ) => filesController.getImageNaturalDimensions(this, imageElement, imageHTML);

  /** generally you should use `addNewImagesToImageCache()` directly if you need
   *  to render new images. This is just a failsafe  */
  private initializeImage = (
    placeholderImageElement: ExcalidrawImageElement,
    imageFile: File,
  ) =>
    filesController.initializeImage(this, placeholderImageElement, imageFile);

  private updateImageCache = (
    elements: readonly InitializedExcalidrawImageElement[],
    files: BinaryFiles = this.files,
  ) => filesController.updateImageCache(this, elements, files);

  private addNewImagesToImageCache = (
    imageElements: InitializedExcalidrawImageElement[] = getInitializedImageElements(
      this.scene.getNonDeletedElements(),
    ),
    files: BinaryFiles = this.files,
  ) => filesController.addNewImagesToImageCache(this, imageElements, files);

  private scheduleImageRefresh = throttle(() => {
    this.addNewImagesToImageCache();
  }, IMAGE_RENDER_TIMEOUT);

  private clearSelection(hitElement: ExcalidrawElement | null): void {
    return pointerSelectionController.clearSelection(this, hitElement);
  }

  public handleInteractiveCanvasRef = (canvas: HTMLCanvasElement | null) => {
    eventListeners.handleInteractiveCanvasRef(this, canvas);
  };

  private insertImages = (imageFiles: File[], sceneX: number, sceneY: number) =>
    filesController.insertImages(this, imageFiles, sceneX, sceneY);

  public handleAppOnDrop = (event: React.DragEvent<HTMLDivElement>) =>
    filesController.handleAppOnDrop(this, event);

  public loadFileToCanvas = (
    file: File,
    fileHandle: FileSystemFileHandle | null,
  ) => filesController.loadFileToCanvas(this, file, fileHandle);

  public handleCanvasContextMenu = (
    event: React.MouseEvent<HTMLElement | HTMLCanvasElement>,
  ) => contextMenuController.handleCanvasContextMenu(this, event);

  /** opens the context menu for the element under the pointer, or the canvas */
  public openContextMenu = (pointer: {
    clientX: number;
    clientY: number;
    button?: number;
    pointerType?: string;
  }) => contextMenuController.openContextMenu(this, pointer);

  private maybeDragNewGenericElement = (
    pointerDownState: PointerDownState,
    event: MouseEvent | KeyboardEvent,
    informMutation = true,
  ): void => {
    return pointerSelectionController.maybeDragNewGenericElement(
      this,
      pointerDownState,
      event,
      informMutation,
    );
  };

  private maybeHandleCrop = (
    pointerDownState: PointerDownState,
    event: MouseEvent | KeyboardEvent,
  ): boolean => {
    return pointerSelectionController.maybeHandleCrop(
      this,
      pointerDownState,
      event,
    );
  };

  private maybeHandleResize = (
    pointerDownState: PointerDownState,
    event: MouseEvent | KeyboardEvent,
  ): boolean => {
    return pointerSelectionController.maybeHandleResize(
      this,
      pointerDownState,
      event,
    );
  };
  private getContextMenuItems = (type: "canvas" | "element") =>
    contextMenuController.getContextMenuItems(this, type);

  getTextWysiwygSnappedToCenterPosition(
    x: number,
    y: number,
    appState: AppState,
    container?: ExcalidrawTextContainer | null,
  ) {
    return textController.getTextWysiwygSnappedToCenterPosition(
      this,
      x,
      y,
      appState,
      container,
    );
  }

  public savePointer = (x: number, y: number, button: "up" | "down") =>
    pointerCanvasController.savePointer(this, x, y, button);

  public resetShouldCacheIgnoreZoomDebounced = debounce(() => {
    if (!this.unmounted) {
      this.setState({ shouldCacheIgnoreZoom: false });
    }
  }, 300);

  private updateDOMRect = (cb?: () => void) =>
    lifecycle.updateDOMRect(this, cb);

  public refresh = () => {
    this.setState({ ...this.getCanvasOffsets() });
  };

  private getCanvasOffsets(): Pick<AppState, "offsetTop" | "offsetLeft"> {
    return lifecycle.getCanvasOffsets(this);
  }

  watchState = () => {};

  private async updateLanguage() {
    const currentLang =
      languages.find((lang) => lang.code === this.props.langCode) ||
      defaultLang;
    await setLanguage(currentLang);
    this.setAppState({});
  }
}

// -----------------------------------------------------------------------------
// TEST HOOKS
// -----------------------------------------------------------------------------
declare global {
  interface Window {
    h: {
      scene: Scene;
      elements: readonly ExcalidrawElement[];
      state: AppState;
      setState: React.Component<any, AppState>["setState"];
      watchState: (prev: any, next: any) => void | undefined;
      app: InstanceType<typeof App>;
      history: History;
      store: Store;
    };
  }
}

export const createTestHook = () => {
  if (isTestEnv() || isDevEnv()) {
    window.h = window.h || ({} as Window["h"]);

    Object.defineProperties(window.h, {
      elements: {
        configurable: true,
        get() {
          return this.app?.scene.getElementsIncludingDeleted();
        },
        set(elements: ExcalidrawElement[]) {
          return this.app?.scene.replaceAllElements(
            syncInvalidIndices(elements),
          );
        },
      },
      scene: {
        configurable: true,
        get() {
          return this.app?.scene;
        },
      },
    });
  }
};

createTestHook();
export default App;
