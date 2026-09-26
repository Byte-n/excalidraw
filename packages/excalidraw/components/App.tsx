import throttle from "lodash.throttle";
import React from "react";
import { flushSync } from "react-dom";
import rough from "roughjs/bin/rough";
import { nanoid } from "nanoid";

import { pointFrom, pointDistance } from "@excalidraw/math";

import {
  KEYS,
  APP_NAME,
  CURSOR_TYPE,
  DEFAULT_VERTICAL_ALIGN,
  DRAGGING_THRESHOLD,
  EVENT,
  FRAME_STYLE,
  IMAGE_RENDER_TIMEOUT,
  POINTER_BUTTON,
  ROUNDNESS,
  SCROLL_TIMEOUT,
  TAP_TWICE_TIMEOUT,
  TEXT_TO_CENTER_SNAP_THRESHOLD,
  THEME,
  YOUTUBE_STATES,
  TOOL_TYPE,
  DEFAULT_TEXT_ALIGN,
  normalizeLink,
  getGridPoint,
  getLineHeight,
  debounce,
  getFontString,
  isToolIcon,
  isWritableElement,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
  updateActiveTool,
  muteFSAbortError,
  isTestEnv,
  isDevEnv,
  normalizeEOL,
  getDateTime,
  AppEventBus,
  type EXPORT_IMAGE_TYPES,
  Emitter,
  DOUBLE_TAP_POSITION_THRESHOLD,
  BIND_MODE_TIMEOUT,
  invariant,
  deriveStylesPanelMode,
  isIOS,
  isSafari,
  type EditorInterface,
  type StylesPanelMode,
  isSelectionLikeTool,
  oneOf,
  getStrokeWidthByKey,
} from "@excalidraw/common";

import {
  getCommonBounds,
  getHoveredElementForBinding,
  LinearElementEditor,
  newElementWith,
  newEmbeddableElement,
  newMagicFrameElement,
  newIframeElement,
  newImageElement,
  newTextElement,
  isBoundToContainer,
  isFrameLikeElement,
  isLinearElement,
  isLinearElementType,
  isUsingAdaptiveRadius,
  isIframeElement,
  isIframeLikeElement,
  isMagicFrameElement,
  isElbowArrow,
  isTextElement,
  isElementCompletelyInViewport,
  embeddableURLValidator,
  maybeParseEmbedSrc,
  getEmbedLink,
  getInitializedImageElements,
  getContainerCenter,
  getContainerElement,
  getColorUpdate,
  redrawTextBoundingBox,
  getFrameChildrenInsertionIndex,
  getElementsOverlappingFrame,
  getVisibleSceneBounds,
  wrapText,
  normalizeText,
  measureText,
  getLineHeightInPx,
  resolveElementRenderState,
  selectGroupsForSelectedElements,
  syncInvalidIndices,
  excludeElementsInFramesFromSelection,
  getSelectionStateForElements,
  makeNextSelectedElementIds,
  Scene,
  Store,
  CaptureUpdateAction,
  type ElementUpdate,
  type ApplyToOptions,
  getElementBounds,
  doBoundsIntersect,
  convertToExcalidrawElements,
  type ExcalidrawElementSkeleton,
} from "@excalidraw/element";

import type { GlobalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  NonDeleted,
  InitializedExcalidrawImageElement,
  ExcalidrawImageElement,
  FileId,
  NonDeletedExcalidrawElement,
  ExcalidrawTextContainer,
  ExcalidrawFrameLikeElement,
  ExcalidrawMagicFrameElement,
  ExcalidrawIframeLikeElement,
  ExcalidrawIframeElement,
  ExcalidrawEmbeddableElement,
  MagicGenerationData,
  ExcalidrawArrowElement,
} from "@excalidraw/element/types";

import type { TransformHandleDirection, StoreDelta } from "@excalidraw/element";

import type { Mutable } from "@excalidraw/common/utility-types";

import {
  actionAddToLibrary,
  actionBringForward,
  actionBringToFront,
  actionCopy,
  actionCopyAsPng,
  actionCopyAsSvg,
  copyText,
  actionCopyStyles,
  actionCut,
  actionDeleteSelected,
  actionDuplicateSelection,
  actionFinalize,
  actionFlipHorizontal,
  actionFlipVertical,
  actionGroup,
  actionPasteStyles,
  actionSelectAll,
  actionSendBackward,
  actionSendToBack,
  actionToggleGridMode,
  actionToggleStats,
  actionToggleZenMode,
  actionUnbindText,
  actionBindText,
  actionUngroup,
  actionLink,
  actionToggleElementLock,
  actionToggleLinearEditor,
  actionToggleObjectsSnapMode,
  actionToggleArrowBinding,
  actionToggleMidpointSnapping,
  actionToggleCropEditor,
  actionMindmapCreateChild,
  actionMindmapCreateSibling,
  actionMindmapToggleCollapse,
  actionMindmapDeletePreservingChildren,
  actionMindmapPromote,
} from "../actions";
import { actionWrapTextInContainer } from "../actions/actionBoundText";
import { actionPaste } from "../actions/actionClipboard";
import { actionCopyElementLink } from "../actions/actionElementLink";
import { actionUnlockAllElements } from "../actions/actionElementLock";
import {
  actionRemoveAllElementsFromFrame,
  actionSelectAllElementsInFrame,
  actionWrapSelectionInFrame,
} from "../actions/actionFrame";
import { createRedoAction, createUndoAction } from "../actions/actionHistory";
import { actionTextAutoResize } from "../actions/actionTextAutoResize";
import { actionToggleViewMode } from "../actions/actionToggleViewMode";
import { actionToggleShapeSwitch } from "../actions/actionToggleShapeSwitch";
import { ActionManager } from "../actions/manager";
import { actions } from "../actions/register";
import { trackEvent } from "../analytics";
import { getDefaultAppState } from "../appState";
import {
  copyTextToSystemClipboard,
  parseClipboard,
  parseDataTransferEvent,
  type ParsedDataTransferFile,
} from "../clipboard";

import { exportCanvas } from "../data";
import Library from "../data/library";
import { restoreElements } from "../data/restore";
import { History } from "../history";
import { defaultLang, languages, setLanguage, t } from "../i18n";

import {
  ImageURLToFile,
  isImageFileHandle,
  SVGStringToFile,
} from "../data/blob";

import { Fonts } from "../fonts";
import { editorJotaiStore, type WritableAtom } from "../editor-jotai";
import {
  isSnappingEnabled,
  getVisibleGaps,
  getReferenceSnapPoints,
  SnapCache,
  isGridModeEnabled,
} from "../snapping";
import { Renderer } from "../scene/Renderer";
import { type SetViewportOptions } from "../viewport";
import { LaserTrails } from "../laserTrails";
import { withBatchedUpdates } from "../reactUtils";

import { isMaybeMermaidDefinition } from "../mermaid";
import { LassoTrail } from "../lasso";
import { EraserTrail } from "../eraser";
import { getShortcutKey } from "../shortcut";
import { tryParseSpreadsheet } from "../charts";

import {
  getColorTargetAppStateUpdates,
  resolveColorTarget,
} from "../actions/colorTargets";

import { AppArrowText } from "./App.arrowText";
import { AppBucketFill } from "./App.bucketFill";
import { AppToolDrag } from "./App.toolDrag";
import { AppCursor } from "./App.cursor";
import { AppDrawShape } from "./App.drawshape";
import { AppDuplicate } from "./App.duplicate";
import { AppFlowchart } from "./App.flowchart";
import { AppMindmap } from "./App.mindmap";
import { AppPan } from "./App.pan";
import { AppViewport } from "./App.viewport";
import { AppWheel } from "./App.wheel";
import { AppFrames } from "./app/frames";
import { AppEmbeds } from "./app/embeds";
import { AppView } from "./app/render";
import * as lifecycle from "./app/lifecycle";
import * as eventListeners from "./app/eventListeners";
import * as sceneController from "./app/scene";
import * as filesController from "./app/files";
import * as gestureController from "./app/gesture";
import * as hitTestController from "./app/hitTest";
import * as textController from "./app/text";
import * as keyboardController from "./app/keyboard";
import * as pointerCanvasController from "./app/pointerCanvas";
import * as pointerEraseController from "./app/pointerErase";
import * as pointerSelectionController from "./app/pointerSelection";
import * as pointerSessionController from "./app/pointerSession";
import {
  cleanupAfterMissingPointerUp,
  createInteractionState,
  handleDraggingScrollBar,
  resetContextMenuTimer,
  resetTapTwice,
  type InteractionState,
} from "./app/pointerSession";
import { CONTEXT_MENU_SEPARATOR } from "./ContextMenu";
import { activeEyeDropperAtom } from "./EyeDropper";

import { isSidebarDockedAtom } from "./Sidebar/Sidebar";
import { CursorHints } from "./CursorHint";
import { AppStateObserver, type OnStateChange } from "./AppStateObserver";

import { TOGGLE_TOOLS } from "./Tools";

import { editorInterfaceContextInitialValue } from "./app/context";

import type { textWysiwyg } from "../wysiwyg/textWysiwyg";

import type { RenderInteractiveSceneCallback } from "../scene/types";

import type { ClipboardData, PastedMixedContent } from "../clipboard";
import type { ExportedElements } from "../data";
import type { ContextMenuItems } from "./ContextMenu";

import type {
  AppClassProperties,
  AppProps,
  AppState,
  ElementRenderOverride,
  ElementRenderOffsets,
  ElementRenderOverrides,
  BinaryFileData,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  Gesture,
  GestureEvent,
  LibraryItems,
  PointerDownState,
  SceneData,
  FrameNameBoundsCache,
  SidebarName,
  SidebarTabName,
  KeyboardModifiersObject,
  CollaboratorPointer,
  ToolType,
  OnUserFollowedPayload,
  ElementsPendingErasure,
  ExcalidrawImperativeAPIEventMap,
  GenerateDiagramToCode,
  NullableGridSize,
  UIConfig,
} from "../types";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Action, ActionResult } from "../actions/types";

export {
  ExcalidrawContainerContext,
  ExcalidrawAPIContext,
  ExcalidrawAPISetContext,
  useApp,
  useAppProps,
  useEditorInterface,
  useStylesPanelMode,
  useExcalidrawContainer,
  useExcalidrawElements,
  useExcalidrawAppState,
  useExcalidrawSetAppState,
  useExcalidrawActionManager,
  useExcalidrawAPI,
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
    if (
      this.state.selectedLinearElement?.initialState &&
      !this.state.selectedLinearElement.initialState.arrowStartIsInside
    ) {
      invariant(
        this.lastPointerMoveCoords,
        "Missing last pointer move coords when changing bind skip mode for arrow start",
      );
      const elementsMap = this.scene.getNonDeletedElementsMap();
      const hoveredElement = getHoveredElementForBinding(
        pointFrom<GlobalPoint>(
          this.lastPointerMoveCoords.x,
          this.lastPointerMoveCoords.y,
        ),
        this.scene.getNonDeletedElements(),
        elementsMap,
      );
      const element = LinearElementEditor.getElement(
        this.state.selectedLinearElement.elementId,
        elementsMap,
      );

      if (
        element?.startBinding &&
        hoveredElement?.id === element.startBinding.elementId
      ) {
        this.setState({
          selectedLinearElement: {
            ...this.state.selectedLinearElement,
            initialState: {
              ...this.state.selectedLinearElement.initialState,
              arrowStartIsInside: true,
            },
          },
        });
      }
    }

    if (this.state.bindMode === "orbit") {
      if (this.bindModeHandler) {
        clearTimeout(this.bindModeHandler);
        this.bindModeHandler = null;
      }

      // PERF: It's okay since it's a single trigger from a key handler
      // or single call from pointer move handler because the bindMode check
      // will not pass the second time
      flushSync(() => {
        this.setState({
          bindMode: "skip",
        });
      });

      if (
        this.lastPointerMoveCoords &&
        this.state.selectedLinearElement?.selectedPointsIndices &&
        this.state.selectedLinearElement?.selectedPointsIndices.length
      ) {
        const { x, y } = this.lastPointerMoveCoords;
        const event =
          this.lastPointerMoveEvent ?? this.lastPointerDownEvent?.nativeEvent;
        invariant(event, "Last event must exist");
        const deltaX = x - this.state.selectedLinearElement.pointerOffset.x;
        const deltaY = y - this.state.selectedLinearElement.pointerOffset.y;
        const newState = this.state.multiElement
          ? LinearElementEditor.handlePointerMove(
              event,
              this,
              deltaX,
              deltaY,
              this.state.selectedLinearElement,
            )
          : LinearElementEditor.handlePointDragging(
              event,
              this,
              deltaX,
              deltaY,
              this.state.selectedLinearElement,
            );
        if (newState) {
          this.setState(newState);
        }
      }
    }
  }

  public resetDelayedBindMode() {
    if (this.bindModeHandler) {
      clearTimeout(this.bindModeHandler);
      this.bindModeHandler = null;
    }

    if (this.state.bindMode !== "orbit") {
      // We need this iteration to complete binding and change
      // back to orbit mode after that
      setTimeout(() =>
        this.setState({
          bindMode: "orbit",
        }),
      );
    }
  }

  private previousHoveredBindableElement: NonDeletedExcalidrawElement | null =
    null;

  public handleDelayedBindModeChange(
    arrow: ExcalidrawArrowElement,
    hoveredElement: NonDeletedExcalidrawElement | null,
  ) {
    if (arrow.isDeleted || isElbowArrow(arrow)) {
      return;
    }

    const effector = () => {
      this.bindModeHandler = null;

      invariant(
        this.lastPointerMoveCoords,
        "Expected lastPointerMoveCoords to be set",
      );

      if (!this.state.multiElement) {
        if (
          !this.state.selectedLinearElement ||
          !this.state.selectedLinearElement.selectedPointsIndices ||
          !this.state.selectedLinearElement.selectedPointsIndices.length
        ) {
          return;
        }

        const startDragged =
          this.state.selectedLinearElement.selectedPointsIndices.includes(0);
        const endDragged =
          this.state.selectedLinearElement.selectedPointsIndices.includes(
            arrow.points.length - 1,
          );

        // Check if the whole arrow is dragged by selecting all endpoints
        if ((!startDragged && !endDragged) || (startDragged && endDragged)) {
          return;
        }
      }

      const { x, y } = this.lastPointerMoveCoords;
      const hoveredElement = getHoveredElementForBinding(
        pointFrom<GlobalPoint>(x, y),
        this.scene.getNonDeletedElements(),
        this.scene.getNonDeletedElementsMap(),
      );

      if (hoveredElement && this.state.bindMode !== "skip") {
        invariant(
          this.state.selectedLinearElement?.elementId === arrow.id,
          "The selectedLinearElement is expected to not change while a bind mode timeout is ticking",
        );

        // Once the start is set to inside binding, it remains so
        const arrowStartIsInside =
          this.state.selectedLinearElement.initialState.arrowStartIsInside ||
          arrow.startBinding?.elementId === hoveredElement.id;

        // Change the global binding mode
        flushSync(() => {
          invariant(
            this.state.selectedLinearElement,
            "this.state.selectedLinearElement must exist",
          );

          this.setState({
            bindMode: "inside",
            selectedLinearElement: {
              ...this.state.selectedLinearElement,
              initialState: {
                ...this.state.selectedLinearElement.initialState,
                arrowStartIsInside,
              },
            },
          });
        });

        const event =
          this.lastPointerMoveEvent ?? this.lastPointerDownEvent?.nativeEvent;
        invariant(event, "Last event must exist");
        const deltaX = x - this.state.selectedLinearElement.pointerOffset.x;
        const deltaY = y - this.state.selectedLinearElement.pointerOffset.y;
        const newState = this.state.multiElement
          ? LinearElementEditor.handlePointerMove(
              event,
              this,
              deltaX,
              deltaY,
              this.state.selectedLinearElement,
            )
          : LinearElementEditor.handlePointDragging(
              event,
              this,
              deltaX,
              deltaY,
              this.state.selectedLinearElement,
            );
        if (newState) {
          this.setState(newState);
        }
      }
    };

    let isOverlapping = false;
    if (this.state.selectedLinearElement?.selectedPointsIndices) {
      const elementsMap = this.scene.getNonDeletedElementsMap();
      const startDragged =
        this.state.selectedLinearElement.selectedPointsIndices.includes(0);
      const endDragged =
        this.state.selectedLinearElement.selectedPointsIndices.includes(
          arrow.points.length - 1,
        );
      const startElement = startDragged
        ? hoveredElement
        : arrow.startBinding && elementsMap.get(arrow.startBinding.elementId);
      const endElement = endDragged
        ? hoveredElement
        : arrow.endBinding && elementsMap.get(arrow.endBinding.elementId);
      const startBounds =
        startElement && getElementBounds(startElement, elementsMap);
      const endBounds = endElement && getElementBounds(endElement, elementsMap);
      isOverlapping = !!(
        startBounds &&
        endBounds &&
        startElement.id !== endElement.id &&
        doBoundsIntersect(startBounds, endBounds)
      );
    }

    const startDragged =
      this.state.selectedLinearElement?.selectedPointsIndices?.includes(0);
    const endDragged =
      this.state.selectedLinearElement?.selectedPointsIndices?.includes(
        arrow.points.length - 1,
      );
    const currentBinding = startDragged
      ? "startBinding"
      : endDragged
      ? "endBinding"
      : null;
    const otherBinding = startDragged
      ? "endBinding"
      : endDragged
      ? "startBinding"
      : null;
    const isAlreadyInsideBindingToSameElement =
      (otherBinding &&
        arrow[otherBinding]?.mode === "inside" &&
        arrow[otherBinding]?.elementId === hoveredElement?.id) ||
      (currentBinding &&
        arrow[currentBinding]?.mode === "inside" &&
        hoveredElement?.id === arrow[currentBinding]?.elementId);

    if (
      currentBinding &&
      otherBinding &&
      arrow[currentBinding]?.mode === "inside" &&
      hoveredElement?.id !== arrow[currentBinding]?.elementId &&
      arrow[otherBinding]?.elementId !== arrow[currentBinding]?.elementId
    ) {
      // Update binding out of place to orbit mode
      this.scene.mutateElement(
        arrow,
        {
          [currentBinding]: {
            ...arrow[currentBinding],
            mode: "orbit",
          },
        },
        {
          informMutation: false,
          isDragging: true,
        },
      );
    }

    if (
      !hoveredElement ||
      (this.previousHoveredBindableElement &&
        hoveredElement.id !== this.previousHoveredBindableElement.id)
    ) {
      // Clear the timeout if we're not hovering a bindable
      if (this.bindModeHandler) {
        clearTimeout(this.bindModeHandler);
        this.bindModeHandler = null;
      }

      // Clear the inside binding mode too
      if (this.state.bindMode === "inside") {
        flushSync(() => {
          this.setState({
            bindMode: "orbit",
          });
        });
      }

      this.previousHoveredBindableElement = null;
    } else if (
      !this.bindModeHandler &&
      (!this.state.newElement || !arrow.startBinding || isOverlapping) &&
      !isAlreadyInsideBindingToSameElement
    ) {
      // We are hovering a bindable element
      this.bindModeHandler = setTimeout(effector, BIND_MODE_TIMEOUT);
    }

    this.previousHoveredBindableElement = hoveredElement;
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
    if (isIframeElement(element)) {
      const data =
        element.customData?.generationData ??
        this.magicGenerations.get(element.id);
      return data?.status !== "pending";
    }
    return true;
  }

  private handleIframeLikeElementHover = ({
    hitElement,
    scenePointer,
    moveEvent,
  }: {
    hitElement: NonDeleted<ExcalidrawElement> | null;
    scenePointer: { x: number; y: number };
    moveEvent: React.PointerEvent<HTMLCanvasElement>;
  }): boolean => {
    if (
      hitElement &&
      isIframeLikeElement(hitElement) &&
      this.isIframeLikeInteractive(hitElement) &&
      (this.state.viewModeEnabled ||
        this.state.activeTool.type === "laser" ||
        this.isIframeLikeElementCenter(
          hitElement,
          moveEvent,
          scenePointer.x,
          scenePointer.y,
        ))
    ) {
      this.cursor.set(CURSOR_TYPE.POINTER);
      this.setState({
        activeEmbeddable: { element: hitElement, state: "hover" },
      });
      return true;
    } else if (this.state.activeEmbeddable?.state === "hover") {
      this.setState({ activeEmbeddable: null });
    }
    return false;
  };

  /** @returns true if iframe-like element click handled */
  private handleIframeLikeCenterClick(): boolean {
    if (
      !this.lastPointerDownEvent ||
      !this.lastPointerUpEvent ||
      // middle-click or something other than primary
      this.lastPointerDownEvent.button !== POINTER_BUTTON.MAIN ||
      // panning
      this.pan.isSpaceHeld() ||
      // wrong tool
      !oneOf(this.state.activeTool.type, ["laser", "selection", "lasso"])
    ) {
      return false;
    }

    const viewportClickStart_scenePoint = pointFrom(
      viewportCoordsToSceneCoords(
        {
          clientX: this.lastPointerDownEvent.clientX,
          clientY: this.lastPointerDownEvent.clientY,
        },
        this.state,
      ),
    );
    const viewportClickEnd_scenePoint = pointFrom(
      viewportCoordsToSceneCoords(
        {
          clientX: this.lastPointerUpEvent.clientX,
          clientY: this.lastPointerUpEvent.clientY,
        },
        this.state,
      ),
    );

    const draggedDistance = pointDistance(
      viewportClickStart_scenePoint,
      viewportClickEnd_scenePoint,
    );

    if (draggedDistance > DRAGGING_THRESHOLD) {
      return false;
    }

    const hitElement = this.getElementAtPosition(
      viewportClickStart_scenePoint[0],
      viewportClickStart_scenePoint[1],
    );

    const shouldActivate =
      hitElement &&
      this.lastPointerUpEvent.timeStamp - this.lastPointerDownEvent.timeStamp <=
        300 &&
      this.gesture.pointers.size < 2 &&
      isIframeLikeElement(hitElement) &&
      this.isIframeLikeInteractive(hitElement) &&
      (this.state.viewModeEnabled ||
        this.state.activeTool.type === "laser" ||
        this.isIframeLikeElementCenter(
          hitElement,
          this.lastPointerUpEvent,
          viewportClickEnd_scenePoint[0],
          viewportClickEnd_scenePoint[1],
        ));

    if (!shouldActivate) {
      return false;
    }

    const iframeLikeElement = hitElement;

    if (
      this.state.activeEmbeddable?.element === iframeLikeElement &&
      this.state.activeEmbeddable?.state === "active"
    ) {
      return true;
    }

    // The delay serves two purposes
    // 1. To prevent first click propagating to iframe on mobile,
    //    else the click will immediately start and stop the video
    // 2. If the user double clicks the frame center to activate it
    //    without the delay youtube will immediately open the video
    //    in fullscreen mode
    setTimeout(() => {
      this.setState({
        activeEmbeddable: { element: iframeLikeElement, state: "active" },
        selectedElementIds: { [iframeLikeElement.id]: true },
        newElement: null,
        selectionElement: null,
      });
    }, 100);

    if (isIframeElement(iframeLikeElement)) {
      return true;
    }

    const iframe = this.getHTMLIFrameElement(iframeLikeElement);

    if (!iframe?.contentWindow) {
      return true;
    }

    if (iframe.src.includes("youtube")) {
      const state = this.embeds.youtubeVideoStates.get(iframeLikeElement.id);
      if (!state) {
        this.embeds.youtubeVideoStates.set(
          iframeLikeElement.id,
          YOUTUBE_STATES.UNSTARTED,
        );
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: "listening",
            id: iframeLikeElement.id,
          }),
          "*",
        );
      }
      switch (state) {
        case YOUTUBE_STATES.PLAYING:
        case YOUTUBE_STATES.BUFFERING:
          iframe.contentWindow?.postMessage(
            JSON.stringify({
              event: "command",
              func: "pauseVideo",
              args: "",
            }),
            "*",
          );
          break;
        default:
          iframe.contentWindow?.postMessage(
            JSON.stringify({
              event: "command",
              func: "playVideo",
              args: "",
            }),
            "*",
          );
      }
    }

    if (iframe.src.includes("player.vimeo.com")) {
      iframe.contentWindow.postMessage(
        JSON.stringify({
          method: "paused", //video play/pause in onWindowMessage handler
        }),
        "*",
      );
    }

    return true;
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
    return (
      el &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      (this.state.activeEmbeddable?.element !== el ||
        this.state.activeEmbeddable?.state === "hover" ||
        !this.state.activeEmbeddable) &&
      sceneX >= el.x + el.width / 3 &&
      sceneX <= el.x + (2 * el.width) / 3 &&
      sceneY >= el.y + el.height / 3 &&
      sceneY <= el.y + (2 * el.height) / 3
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

  public onExportImage = async (
    type: keyof typeof EXPORT_IMAGE_TYPES,
    elements: ExportedElements,
    opts: { exportingFrame: NonDeleted<ExcalidrawFrameLikeElement> | null },
  ) => {
    trackEvent("export", type, "ui");
    const fileHandle = await exportCanvas(
      type,
      elements,
      this.state,
      this.files,
      {
        exportBackground: this.state.exportBackground,
        name: this.getName(),
        viewBackgroundColor: this.state.viewBackgroundColor,
        exportingFrame: opts.exportingFrame,
      },
    )
      .catch(muteFSAbortError)
      .catch((error) => {
        console.error(error);
        this.setState({ errorMessage: error.message });
      });

    if (
      this.state.exportEmbedScene &&
      fileHandle &&
      isImageFileHandle(fileHandle)
    ) {
      this.setState({ fileHandle });
    }
  };

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
  }) => {
    if (data.status === "pending") {
      // We don't wanna persist pending state to storage. It should be in-app
      // state only.
      // Thus reset so that we prefer local cache (if there was some
      // generationData set previously)
      this.scene.mutateElement(
        frameElement,
        {
          customData: { generationData: undefined },
        },
        { informMutation: false, isDragging: false },
      );
    } else {
      this.scene.mutateElement(
        frameElement,
        {
          customData: { generationData: data },
        },
        { informMutation: false, isDragging: false },
      );
    }
    this.magicGenerations.set(frameElement.id, data);
    this.triggerRender();
  };

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
    const generateDiagramToCode = this.plugins.diagramToCode?.generate;

    if (!generateDiagramToCode) {
      this.setState({
        errorMessage: "No diagram to code plugin found",
      });
      return;
    }

    const magicFrameChildren = getElementsOverlappingFrame(
      this.scene.getNonDeletedElements(),
      magicFrame,
      this.scene.getNonDeletedElementsMap(),
    ).filter((el) => !isMagicFrameElement(el));

    if (!magicFrameChildren.length) {
      if (source === "button") {
        this.setState({ errorMessage: "Cannot generate from an empty frame" });
        trackEvent("ai", "generate (no-children)", "d2c");
      } else {
        this.setActiveTool({ type: "magicframe" });
      }
      return;
    }

    const frameElement = this.insertIframeElement({
      sceneX: magicFrame.x + magicFrame.width + 30,
      sceneY: magicFrame.y,
      width: magicFrame.width,
      height: magicFrame.height,
    });

    if (!frameElement) {
      return;
    }

    this.updateMagicGeneration({
      frameElement,
      data: { status: "pending" },
    });

    this.setState({
      selectedElementIds: { [frameElement.id]: true },
    });

    trackEvent("ai", "generate (start)", "d2c");
    try {
      const { html } = await generateDiagramToCode({
        frame: magicFrame,
        children: magicFrameChildren,
        onPartial: (partialResponse) => {
          // only stream into the frame while this generation is still pending
          if (
            this.magicGenerations.get(frameElement.id)?.status !== "pending"
          ) {
            return;
          }
          const htmlStartIndex = partialResponse.search(
            /<!doctype html|<html[\s>]/i,
          );
          if (htmlStartIndex === -1) {
            return;
          }
          // the pending iframe document renders the partial html itself
          // (see the streaming shell in `renderEmbeddables`) — we only feed
          // it snapshots of the html received so far
          this.getHTMLIFrameElement(frameElement)?.contentWindow?.postMessage(
            {
              type: "excalidraw:diagramToCode:partial",
              html: partialResponse.slice(htmlStartIndex),
            },
            "*",
          );
        },
      });

      trackEvent("ai", "generate (success)", "d2c");

      if (!html.trim()) {
        this.updateMagicGeneration({
          frameElement,
          data: {
            status: "error",
            code: "ERR_OAI",
            message: "Nothing genereated :(",
          },
        });
        return;
      }

      const parsedHtml =
        html.includes("<!DOCTYPE html>") && html.includes("</html>")
          ? html.slice(
              html.indexOf("<!DOCTYPE html>"),
              html.indexOf("</html>") + "</html>".length,
            )
          : html;

      this.updateMagicGeneration({
        frameElement,
        data: { status: "done", html: parsedHtml },
      });
    } catch (error: any) {
      trackEvent("ai", "generate (failed)", "d2c");
      this.updateMagicGeneration({
        frameElement,
        data: {
          status: "error",
          code: "ERR_OAI",
          message: error.message || "Unknown error during generation",
        },
      });
    }
  }

  public onIframeSrcCopy(element: ExcalidrawIframeElement) {
    if (element.customData?.generationData?.status === "done") {
      copyTextToSystemClipboard(element.customData.generationData.html);
      this.setToast({
        message: "copied to clipboard",
        closable: false,
        duration: 1500,
      });
    }
  }

  public onMagicframeToolSelect = () => {
    const selectedElements = this.scene.getSelectedElements({
      selectedElementIds: this.state.selectedElementIds,
    });

    if (selectedElements.length === 0) {
      this.setActiveTool({ type: TOOL_TYPE.magicframe });
      trackEvent("ai", "tool-select (empty-selection)", "d2c");
    } else {
      const selectedMagicFrame:
        | NonDeleted<ExcalidrawMagicFrameElement>
        | false =
        selectedElements.length === 1 &&
        isMagicFrameElement(selectedElements[0]) &&
        selectedElements[0];

      // case: user selected elements containing frame-like(s) or are frame
      // members, we don't want to wrap into another magicframe
      // (unless the only selected element is a magic frame which we reuse)
      if (
        !selectedMagicFrame &&
        selectedElements.some((el) => isFrameLikeElement(el) || el.frameId)
      ) {
        this.setActiveTool({ type: TOOL_TYPE.magicframe });
        return;
      }

      trackEvent("ai", "tool-select (existing selection)", "d2c");

      let frame: NonDeleted<ExcalidrawMagicFrameElement>;
      if (selectedMagicFrame) {
        // a single magicframe already selected -> use it
        frame = selectedMagicFrame;
      } else {
        // selected elements aren't wrapped in magic frame yet -> wrap now

        const [minX, minY, maxX, maxY] = getCommonBounds(selectedElements);
        const padding = 50;

        frame = newMagicFrameElement({
          ...FRAME_STYLE,
          x: minX - padding,
          y: minY - padding,
          width: maxX - minX + padding * 2,
          height: maxY - minY + padding * 2,
          opacity: 100,
          locked: false,
        });

        this.insertNewElement(frame);

        for (const child of selectedElements) {
          this.scene.mutateElement(child, { frameId: frame.id });
        }

        this.setState({
          selectedElementIds: { [frame.id]: true },
        });
      }

      this.onMagicFrameGenerate(frame, "upstream");
    }
  };

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

  private onCut = withBatchedUpdates((event: ClipboardEvent) => {
    if (!this.isInteractionEnabled()) {
      return;
    }
    const isExcalidrawActive = this.excalidrawContainerRef.current?.contains(
      this.ownerDocument.activeElement,
    );
    if (!isExcalidrawActive || isWritableElement(event.target)) {
      return;
    }
    this.actionManager.executeAction(actionCut, "keyboard", event);
    event.preventDefault();
    event.stopPropagation();
  });

  private onCopy = withBatchedUpdates((event: ClipboardEvent) => {
    if (!this.isInteractionEnabled()) {
      return;
    }
    const isExcalidrawActive = this.excalidrawContainerRef.current?.contains(
      this.ownerDocument.activeElement,
    );
    if (!isExcalidrawActive || isWritableElement(event.target)) {
      return;
    }
    this.actionManager.executeAction(actionCopy, "keyboard", event);
    event.preventDefault();
    event.stopPropagation();
  });

  private onTouchStart = (event: TouchEvent) => {
    if (!this.isInteractionEnabled()) {
      return;
    }
    if (event.touches.length > 1) {
      this.mindmap.cancelTouchDrag();
    }

    // fix for Apple Pencil Scribble (do not prevent for other devices)
    if (isIOS) {
      event.preventDefault();
    }

    if (!this.interactionState.didTapTwice) {
      this.interactionState.didTapTwice = true;

      if (event.touches.length === 1) {
        this.interactionState.firstTapPosition = {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
        };
      }
      this.ownerWindow.clearTimeout(this.interactionState.tappedTwiceTimer);
      this.interactionState.tappedTwiceTimer = this.ownerWindow.setTimeout(
        () => resetTapTwice(this.interactionState),
        TAP_TWICE_TIMEOUT,
      );
      return;
    }

    // insert text only if we tapped twice with a single finger at approximately the same position
    // event.touches.length === 1 will also prevent inserting text when user's zooming
    if (
      this.interactionState.didTapTwice &&
      event.touches.length === 1 &&
      this.interactionState.firstTapPosition
    ) {
      const touch = event.touches[0];
      const distance = pointDistance(
        pointFrom(touch.clientX, touch.clientY),
        pointFrom(
          this.interactionState.firstTapPosition.x,
          this.interactionState.firstTapPosition.y,
        ),
      );

      // only create text if the second tap is within the threshold of the first tap
      // this prevents accidental text creation during dragging/selection
      if (distance <= DOUBLE_TAP_POSITION_THRESHOLD) {
        // end lasso trail and deselect elements just in case
        this.lassoTrail.endPath();
        this.deselectElements();

        this.handleCanvasDoubleClick({
          clientX: touch.clientX,
          clientY: touch.clientY,
          type: "touch",
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        });
      }
      resetTapTwice(this.interactionState);
      this.ownerWindow.clearTimeout(this.interactionState.tappedTwiceTimer);
      this.interactionState.tappedTwiceTimer = 0;
    }

    if (event.touches.length === 2) {
      this.setState({
        selectedElementIds: makeNextSelectedElementIds({}, this.state),
        activeEmbeddable: null,
      });
    }
  };

  private onTouchEnd = (event: TouchEvent) => {
    if (!this.isInteractionEnabled()) {
      return;
    }
    this.resetContextMenuTimer();
    if (event.touches.length > 0) {
      this.setState({
        previousSelectedElementIds: {},
        selectedElementIds: makeNextSelectedElementIds(
          this.state.previousSelectedElementIds,
          this.state,
        ),
      });
    } else {
      this.gesture.pointers.clear();
    }
  };

  // TODO: Cover with tests
  private async insertClipboardContent(
    data: ClipboardData,
    dataTransferFiles: ParsedDataTransferFile[],
    isPlainPaste: boolean,
  ) {
    const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
      {
        clientX: this.viewport.lastPosition.x,
        clientY: this.viewport.lastPosition.y,
      },
      this.state,
    );

    // ------------------- Error -------------------
    if (data.errorMessage) {
      this.setState({ errorMessage: data.errorMessage });
      return;
    }

    // ------------------- Mixed content with no files -------------------
    if (dataTransferFiles.length === 0 && !isPlainPaste && data.mixedContent) {
      await this.addElementsFromMixedContentPaste(data.mixedContent, {
        isPlainPaste,
        sceneX,
        sceneY,
      });
      return;
    }

    // ------------------- Spreadsheet -------------------

    if (!isPlainPaste && data.text) {
      const result = tryParseSpreadsheet(data.text);
      if (result.ok) {
        this.setState({
          openDialog: {
            name: "charts",
            data: result.data,
            rawText: data.text,
          },
        });
        return;
      }
    }

    // ------------------- Images or SVG code -------------------
    const imageFiles = dataTransferFiles.map((data) => data.file);

    if (imageFiles.length === 0 && data.text && !isPlainPaste) {
      const trimmedText = data.text.trim();
      if (trimmedText.startsWith("<svg") && trimmedText.endsWith("</svg>")) {
        // ignore SVG validation/normalization which will be done during image
        // initialization
        imageFiles.push(SVGStringToFile(trimmedText));
      }
    }

    if (imageFiles.length > 0) {
      if (this.isToolSupported("image")) {
        await this.insertImages(imageFiles, sceneX, sceneY);
      } else {
        this.setState({ errorMessage: t("errors.imageToolNotSupported") });
      }
      return;
    }

    // ------------------- Elements -------------------
    if (data.elements) {
      const elements = (
        data.programmaticAPI
          ? convertToExcalidrawElements(
              data.elements as ExcalidrawElementSkeleton[],
            )
          : data.elements
      ) as readonly ExcalidrawElement[];
      // TODO: remove formatting from elements if isPlainPaste
      this.addElementsFromPasteOrLibrary({
        elements,
        files: data.files || null,
        position:
          this.editorInterface.formFactor === "desktop" ? "cursor" : "center",
        retainSeed: isPlainPaste,
        preserveFrameChildrenOrder: true,
      });
      return;
    }

    // ------------------- Only textual stuff remaining -------------------
    if (!data.text) {
      return;
    }

    // ------------------- Successful Mermaid -------------------
    if (!isPlainPaste && isMaybeMermaidDefinition(data.text)) {
      const api = await import("@excalidraw/mermaid-to-excalidraw");
      try {
        const { elements: skeletonElements, files = {} } =
          await api.parseMermaidToExcalidraw(data.text);

        const elements = convertToExcalidrawElements(skeletonElements, {
          regenerateIds: true,
        });

        this.addElementsFromPasteOrLibrary({
          elements,
          files,
          position:
            this.editorInterface.formFactor === "desktop" ? "cursor" : "center",
        });

        return;
      } catch (err: any) {
        console.warn(
          `parsing pasted text as mermaid definition failed: ${err.message}`,
        );
      }
    }

    // ------------------- Pure embeddable URLs -------------------
    const nonEmptyLines = normalizeEOL(data.text)
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const embbeddableUrls = nonEmptyLines
      .map((str) => maybeParseEmbedSrc(str))
      .filter(
        (string) =>
          embeddableURLValidator(string, this.props.validateEmbeddable) &&
          (/^(http|https):\/\/[^\s/$.?#].[^\s]*$/.test(string) ||
            getEmbedLink(string)?.type === "video"),
      );

    if (
      !isPlainPaste &&
      embbeddableUrls.length > 0 &&
      embbeddableUrls.length === nonEmptyLines.length
    ) {
      const embeddables: NonDeleted<ExcalidrawEmbeddableElement>[] = [];
      for (const url of embbeddableUrls) {
        const prevEmbeddable: ExcalidrawEmbeddableElement | undefined =
          embeddables[embeddables.length - 1];
        const embeddable = this.insertEmbeddableElement({
          sceneX: prevEmbeddable
            ? prevEmbeddable.x + prevEmbeddable.width + 20
            : sceneX,
          sceneY,
          link: normalizeLink(url),
        });
        if (embeddable) {
          embeddables.push(embeddable);
        }
      }
      if (embeddables.length) {
        this.store.scheduleCapture();
        this.setState({
          selectedElementIds: Object.fromEntries(
            embeddables.map((embeddable) => [embeddable.id, true]),
          ),
        });
      }
      return;
    }

    // ------------------- Text -------------------
    this.addTextFromPaste(data.text, isPlainPaste);
  }

  public pasteFromClipboard = withBatchedUpdates(
    async (event: ClipboardEvent) => {
      if (!this.isInteractionEnabled()) {
        return;
      }

      const isPlainPaste = this.interactionState.isPlainPaste;

      // #686
      const target = this.ownerDocument.activeElement;
      const isExcalidrawActive =
        this.excalidrawContainerRef.current?.contains(target);
      if (event && !isExcalidrawActive) {
        return;
      }

      const elementUnderCursor = this.ownerDocument.elementFromPoint(
        this.viewport.lastPosition.x,
        this.viewport.lastPosition.y,
      );
      if (
        event &&
        (!(elementUnderCursor instanceof this.ownerWindow.HTMLCanvasElement) ||
          isWritableElement(target))
      ) {
        return;
      }

      // must be called in the same frame (thus before any awaits) as the paste
      // event else some browsers (FF...) will clear the clipboardData
      // (something something security)
      const dataTransferList = await parseDataTransferEvent(event);

      const filesList = dataTransferList.getFiles();

      const data = await parseClipboard(dataTransferList, isPlainPaste);

      if (this.props.onPaste) {
        try {
          if ((await this.props.onPaste(data, event)) === false) {
            return;
          }
        } catch (error: any) {
          console.error(error);
        }
      }

      await this.insertClipboardContent(data, filesList, isPlainPaste);

      this.setActiveTool(
        { type: this.state.preferredSelectionTool.type },
        { keepSelection: true },
      );
      event?.preventDefault();
    },
  );

  addElementsFromPasteOrLibrary = (opts: {
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles | null;
    position: { clientX: number; clientY: number } | "cursor" | "center";
    retainSeed?: boolean;
    fit?: SetViewportOptions["fit"];
    preserveFrameChildrenOrder?: boolean;
  }) => {
    const elements = restoreElements(opts.elements, null, {
      deleteInvisibleElements: true,
    });
    const clientX =
      typeof opts.position === "object"
        ? opts.position.clientX
        : opts.position === "cursor"
        ? this.viewport.lastPosition.x
        : this.state.width / 2 + this.state.offsetLeft;
    const clientY =
      typeof opts.position === "object"
        ? opts.position.clientY
        : opts.position === "cursor"
        ? this.viewport.lastPosition.y
        : this.state.height / 2 + this.state.offsetTop;

    const duplication = this.duplicate.duplicateAtSceneCoords(
      elements,
      viewportCoordsToSceneCoords({ clientX, clientY }, this.state),
      {
        retainSeed: opts.retainSeed,
        preserveFrameChildrenOrder: opts.preserveFrameChildrenOrder,
      },
    );

    if (!duplication) {
      return;
    }

    const { nextElements, duplicatedElements } = duplication;

    this.scene.replaceAllElements(nextElements);

    duplicatedElements.forEach((newElement) => {
      if (isTextElement(newElement) && isBoundToContainer(newElement)) {
        const container = getContainerElement(
          newElement,
          this.scene.getElementsMapIncludingDeleted(),
        );
        redrawTextBoundingBox(newElement, container, this.scene);
      }
    });

    // paste event may not fire FontFace loadingdone event in Safari, hence loading font faces manually
    if (isSafari) {
      Fonts.loadElementsFonts(duplicatedElements, this.ownerDocument).then(
        (fontFaces) => {
          this.fonts.onLoaded(fontFaces);
        },
      );
    }

    if (opts.files) {
      this.addMissingFiles(opts.files);
    }

    const nextElementsToSelect =
      excludeElementsInFramesFromSelection(duplicatedElements);

    this.store.scheduleCapture();
    this.setState(
      {
        ...this.state,
        // keep sidebar (presumably the library) open if it's docked and
        // can fit.
        //
        // Note, we should close the sidebar only if we're dropping items
        // from library, not when pasting from clipboard. Alas.
        openSidebar:
          this.state.openSidebar &&
          this.editorInterface.canFitSidebar &&
          editorJotaiStore.get(isSidebarDockedAtom)
            ? this.state.openSidebar
            : null,
        ...getSelectionStateForElements(
          nextElementsToSelect,
          this.scene.getNonDeletedElements(),
          this.state,
        ),
      },
      () => {
        if (opts.files) {
          this.addNewImagesToImageCache();
        }
      },
    );
    this.setActiveTool(
      { type: this.state.preferredSelectionTool.type },
      { keepSelection: true },
    );

    if (opts.fit) {
      this.viewport.setViewport({
        target: duplicatedElements,
        fit: opts.fit,
        animation: false,
        offsets: { ui: true },
      });
    }
  };

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
    if (
      !isPlainPaste &&
      mixedContent.some((node) => node.type === "imageUrl") &&
      this.isToolSupported("image")
    ) {
      const imageURLs = mixedContent
        .filter((node) => node.type === "imageUrl")
        .map((node) => node.value);
      const responses = await Promise.all(
        imageURLs.map(async (url) => {
          try {
            return { file: await ImageURLToFile(url) };
          } catch (error: any) {
            let errorMessage = error.message;
            if (error.cause === "FETCH_ERROR") {
              errorMessage = t("errors.failedToFetchImage");
            } else if (error.cause === "UNSUPPORTED") {
              errorMessage = t("errors.unsupportedFileType");
            }
            return { errorMessage };
          }
        }),
      );

      const imageFiles = responses
        .filter((response): response is { file: File } => !!response.file)
        .map((response) => response.file);
      await this.insertImages(imageFiles, sceneX, sceneY);
      const error = responses.find((response) => !!response.errorMessage);
      if (error && error.errorMessage) {
        this.setState({ errorMessage: error.errorMessage });
      }
    } else {
      const textNodes = mixedContent.filter((node) => node.type === "text");
      if (textNodes.length) {
        this.addTextFromPaste(
          textNodes.map((node) => node.value).join("\n\n"),
          isPlainPaste,
        );
      }
    }
  }

  private addTextFromPaste(text: string, isPlainPaste = false) {
    const { x, y } = viewportCoordsToSceneCoords(
      {
        clientX: this.viewport.lastPosition.x,
        clientY: this.viewport.lastPosition.y,
      },
      this.state,
    );

    const textElementProps = {
      x,
      y,
      strokeColor: this.state.currentItemStrokeColor,
      backgroundColor: this.state.currentItemBackgroundColor,
      fillStyle: this.state.currentItemFillStyle,
      strokeWidth: this.getCurrentItemStrokeWidth("text"),
      strokeStyle: this.state.currentItemStrokeStyle,
      roundness: null,
      roughness: this.state.currentItemRoughness,
      opacity: this.state.currentItemOpacity,
      text,
      fontSize: this.state.currentItemFontSize,
      fontFamily: this.state.currentItemFontFamily,
      textAlign: DEFAULT_TEXT_ALIGN,
      verticalAlign: DEFAULT_VERTICAL_ALIGN,
      locked: false,
    };
    const fontString = getFontString({
      fontSize: textElementProps.fontSize,
      fontFamily: textElementProps.fontFamily,
    });
    const lineHeight = getLineHeight(textElementProps.fontFamily);
    const [x1, , x2] = getVisibleSceneBounds(this.state);
    // long texts should not go beyond 800 pixels in width nor should it go below 200 px
    const maxTextWidth = Math.max(Math.min((x2 - x1) * 0.5, 800), 200);
    const LINE_GAP = 10;
    let currentY = y;

    const lines = isPlainPaste ? [text] : text.split("\n");
    const textElements = lines.reduce(
      (acc: ExcalidrawTextElement[], line, idx) => {
        const originalText = normalizeText(line).trim();
        if (originalText.length) {
          const topLayerFrame = this.getTopLayerFrameAtSceneCoords({
            x,
            y: currentY,
          });

          let metrics = measureText(originalText, fontString, lineHeight);
          const isTextUnwrapped = metrics.width > maxTextWidth;

          const text = isTextUnwrapped
            ? wrapText(originalText, fontString, maxTextWidth)
            : originalText;

          metrics = isTextUnwrapped
            ? measureText(text, fontString, lineHeight)
            : metrics;

          const startX = x - metrics.width / 2;
          const startY = currentY - metrics.height / 2;

          const element = newTextElement({
            ...textElementProps,
            x: startX,
            y: startY,
            text,
            originalText,
            lineHeight,
            autoResize: !isTextUnwrapped,
            frameId: topLayerFrame ? topLayerFrame.id : null,
          });
          acc.push(element);
          currentY += element.height + LINE_GAP;
        } else {
          const prevLine = lines[idx - 1]?.trim();
          // add paragraph only if previous line was not empty, IOW don't add
          // more than one empty line
          if (prevLine) {
            currentY +=
              getLineHeightInPx(textElementProps.fontSize, lineHeight) +
              LINE_GAP;
          }
        }

        return acc;
      },
      [],
    );

    if (textElements.length === 0) {
      return;
    }

    this.insertNewElements(textElements);
    this.store.scheduleCapture();
    this.setState({
      selectedElementIds: makeNextSelectedElementIds(
        Object.fromEntries(textElements.map((el) => [el.id, true])),
        this.state,
      ),
    });

    if (
      !isPlainPaste &&
      textElements.length > 1 &&
      this.interactionState.plainPasteToastShown === false &&
      this.editorInterface.formFactor !== "phone"
    ) {
      this.setToast({
        message: t("toast.pasteAsSingleElement", {
          shortcut: getShortcutKey("CtrlOrCmd+Shift+V"),
        }),
        duration: 5000,
      });
      this.interactionState.plainPasteToastShown = true;
    }
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
    if (this.props.activeTool) {
      // the active tool — including its lock state — is host-controlled
      return;
    }
    if (!this.state.activeTool.locked) {
      trackEvent(
        "toolbar",
        "toggleLock",
        `${source} (${
          this.editorInterface.formFactor === "phone" ? "mobile" : "desktop"
        })`,
      );
    }
    this.setState((prevState) => {
      return {
        activeTool: {
          ...prevState.activeTool,
          ...updateActiveTool(
            this.state,
            prevState.activeTool.locked
              ? { type: this.state.preferredSelectionTool.type }
              : prevState.activeTool,
          ),
          locked: !prevState.activeTool.locked,
        },
      };
    });
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
  ) => {
    const { keepSelection = false } = opts;

    if (!this.isToolSupported(tool.type)) {
      console.warn(
        this.isInteractionEnabled()
          ? `"${tool.type}" tool is disabled via "UIOptions.canvasActions.tools.${tool.type}"`
          : `"${tool.type}" tool cannot be activated while the editor is non-interactive (see "interaction.enabled.tools")`,
      );
      return;
    }

    if (
      this.props.activeTool &&
      !this.isSameForcedTool(this.props.activeTool, tool)
    ) {
      console.warn(
        `"${tool.type}" tool activation ignored — the active tool is controlled by the host via "props.activeTool"`,
      );
      return;
    }

    if (this.drawShape.hasPendingGesture()) {
      // switching tools mid-sketch (e.g. paste resets to the selection tool)
      // must not strand the gesture — commit it through the finalize funnel
      // while the drawShape tool is still active
      this.actionManager.executeAction(actionFinalize);
    }

    const isToggleTool = TOGGLE_TOOLS.includes(tool.type);
    const toggle = opts.toggle === true && isToggleTool;

    const nextActiveTool =
      toggle && this.state.activeTool.type === tool.type
        ? // toggle back to the tool that was active before this one
          updateActiveTool(this.state, {
            ...(this.state.activeTool.lastActiveTool || {
              type: this.state.preferredSelectionTool.type,
            }),
            lastActiveTool: null,
          })
        : isToggleTool && this.state.activeTool.type !== tool.type
        ? // activating a toggle tool records the currently active tool so
          // ESC and the next `toggle` activation can switch back to it
          updateActiveTool(this.state, {
            ...tool,
            lastActiveTool: this.state.activeTool,
          })
        : updateActiveTool(this.state, tool);
    if (nextActiveTool.type !== this.state.activeTool.type) {
      this.mindmap.cancelDrag();
    }
    if (nextActiveTool.type !== "mindmap") {
      this.mindmap.clearHover();
    }
    if (nextActiveTool.type === "hand") {
      this.cursor.set(CURSOR_TYPE.GRAB);
    } else if (!this.pan.isSpaceHeld()) {
      this.cursor.applyForTool(nextActiveTool);
    }
    if (isToolIcon(this.ownerDocument.activeElement)) {
      this.focusContainer();
    }
    if (!isLinearElementType(nextActiveTool.type)) {
      this.setState({ suggestedBinding: null });
    }
    if (nextActiveTool.type === "image") {
      this.onImageToolbarButtonClick();
    }

    this.setState((prevState) => {
      const commonResets = {
        snapLines: prevState.snapLines.length ? [] : prevState.snapLines,
        originSnapOffset: null,
        activeEmbeddable: null,
        selectedLinearElement: isSelectionLikeTool(nextActiveTool.type)
          ? prevState.selectedLinearElement
          : null,
        frameToHighlight: null,
        // only the text tool offers arrow-endpoint binding, and the highlight
        // is refreshed on pointermove — don't leave a stale one behind
        hoveredArrowTextAnchor: null,
        ...(nextActiveTool.type !== "mindmap" &&
        Object.keys(prevState.hoveredElementIds).length
          ? { hoveredElementIds: {} }
          : {}),
      } as const;

      if (nextActiveTool.type === "freedraw") {
        this.store.scheduleCapture();
      }

      if (nextActiveTool.type === "lasso") {
        return {
          ...prevState,
          ...commonResets,
          activeTool: nextActiveTool,
          ...(keepSelection
            ? {}
            : {
                selectedElementIds: makeNextSelectedElementIds({}, prevState),
                selectedGroupIds: makeNextSelectedElementIds({}, prevState),
                editingGroupId: null,
                multiElement: null,
              }),
        };
      } else if (nextActiveTool.type !== "selection") {
        return {
          ...prevState,
          ...commonResets,
          activeTool: nextActiveTool,
          selectedElementIds: makeNextSelectedElementIds({}, prevState),
          selectedGroupIds: makeNextSelectedElementIds({}, prevState),
          editingGroupId: null,
          multiElement: null,
        };
      }
      return {
        ...prevState,
        ...commonResets,
        activeTool: nextActiveTool,
      };
    });
  };

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
      currentFrameId?: ExcalidrawElement["frameId"];
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

  public insertNewElements = (elements: readonly ExcalidrawElement[]) => {
    if (!elements.length) {
      return;
    }

    const chunkedElements: ExcalidrawElement[][] = [];

    for (const element of elements) {
      const currentChunk = chunkedElements[chunkedElements.length - 1];

      if (currentChunk?.[0].frameId === element.frameId) {
        currentChunk.push(element);
      } else {
        chunkedElements.push([element]);
      }
    }

    for (const chunk of chunkedElements) {
      const frameId = chunk[0].frameId;

      const insertionIndex = frameId
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

    const frame = element.frameId
      ? this.scene.getNonDeletedElement(element.frameId)
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
  }) => {
    const [gridX, gridY] = getGridPoint(
      sceneX,
      sceneY,
      this.lastPointerDownEvent?.[KEYS.CTRL_OR_CMD]
        ? null
        : this.getEffectiveGridSize(),
    );

    const element = newIframeElement({
      type: "iframe",
      x: gridX,
      y: gridY,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: this.state.currentItemFillStyle,
      strokeWidth: this.getCurrentItemStrokeWidth("iframe"),
      strokeStyle: this.state.currentItemStrokeStyle,
      roughness: this.state.currentItemRoughness,
      roundness: this.getCurrentItemRoundness("iframe"),
      opacity: this.state.currentItemOpacity,
      locked: false,
      width,
      height,
    });

    this.insertNewElement(element);

    return element;
  };

  //create rectangle element with youtube top left on nearest grid point width / hight 640/360
  public insertEmbeddableElement = ({
    sceneX,
    sceneY,
    link,
  }: {
    sceneX: number;
    sceneY: number;
    link: string;
  }) => {
    const [gridX, gridY] = getGridPoint(
      sceneX,
      sceneY,
      this.lastPointerDownEvent?.[KEYS.CTRL_OR_CMD]
        ? null
        : this.getEffectiveGridSize(),
    );

    const embedLink = getEmbedLink(link);

    if (!embedLink) {
      return;
    }

    if (embedLink.error instanceof URIError) {
      this.setToast({
        message: t("toast.unrecognizedLinkFormat"),
        closable: true,
      });
    }

    const element = newEmbeddableElement({
      type: "embeddable",
      x: gridX,
      y: gridY,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: this.state.currentItemFillStyle,
      strokeWidth: this.getCurrentItemStrokeWidth("embeddable"),
      strokeStyle: this.state.currentItemStrokeStyle,
      roughness: this.state.currentItemRoughness,
      roundness: this.getCurrentItemRoundness("embeddable"),
      opacity: this.state.currentItemOpacity,
      locked: false,
      width: embedLink.intrinsicSize.w,
      height: embedLink.intrinsicSize.h,
      link,
    });

    this.insertNewElement(element);

    return element;
  };

  private newImagePlaceholder = ({
    sceneX,
    sceneY,
    addToFrameUnderCursor = true,
  }: {
    sceneX: number;
    sceneY: number;
    addToFrameUnderCursor?: boolean;
  }) => {
    const [gridX, gridY] = getGridPoint(
      sceneX,
      sceneY,
      this.lastPointerDownEvent?.[KEYS.CTRL_OR_CMD]
        ? null
        : this.getEffectiveGridSize(),
    );

    const topLayerFrame = addToFrameUnderCursor
      ? this.getTopLayerFrameAtSceneCoords({
          x: gridX,
          y: gridY,
        })
      : null;

    const placeholderSize = 100 / this.state.zoom.value;

    return newImageElement({
      type: "image",
      strokeColor: this.state.currentItemStrokeColor,
      backgroundColor: this.state.currentItemBackgroundColor,
      fillStyle: this.state.currentItemFillStyle,
      strokeWidth: this.getCurrentItemStrokeWidth("image"),
      strokeStyle: this.state.currentItemStrokeStyle,
      roughness: this.state.currentItemRoughness,
      roundness: null,
      opacity: this.state.currentItemOpacity,
      locked: false,
      frameId: topLayerFrame ? topLayerFrame.id : null,
      x: gridX - placeholderSize / 2,
      y: gridY - placeholderSize / 2,
      width: placeholderSize,
      height: placeholderSize,
    });
  };

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
    // canvas is null when unmounting
    if (canvas !== null) {
      this.interactiveCanvas = canvas;

      // reflect state that landed before the canvas existed — the cursor is
      // otherwise only set imperatively on *changes* (e.g. the host-forced
      // tool seeded from `props.activeTool`, or view-mode drag-to-pan)
      this.cursor.reset();

      // -----------------------------------------------------------------------
      // NOTE wheel, touchstart, touchend events must be registered outside
      // of react because react binds them them passively (so we can't prevent
      // default on them)
      this.interactiveCanvas.addEventListener(
        EVENT.TOUCH_START,
        this.onTouchStart,
        { passive: false },
      );
      this.interactiveCanvas.addEventListener(EVENT.TOUCH_END, this.onTouchEnd);
      // -----------------------------------------------------------------------
    } else {
      this.interactiveCanvas?.removeEventListener(
        EVENT.TOUCH_START,
        this.onTouchStart,
      );
      this.interactiveCanvas?.removeEventListener(
        EVENT.TOUCH_END,
        this.onTouchEnd,
      );
    }
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
  ) => {
    // Always suppress the native menu over the canvas.
    event.preventDefault();
    // a secondary-button press is a pan session: this event is not a click
    // when it comes with the press (macOS and Linux fire it on mousedown,
    // and the session opens the menu on release if no drag follows), nor
    // when it follows a release that was a drag
    if (this.pan.consumesContextMenuEvent()) {
      return;
    }
    this.openContextMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      pointerType:
        "pointerType" in event.nativeEvent
          ? (event.nativeEvent as PointerEvent).pointerType
          : undefined,
    });
  };

  /** opens the context menu for the element under the pointer, or the canvas */
  public openContextMenu = (pointer: {
    clientX: number;
    clientY: number;
    button?: number;
    pointerType?: string;
  }) => {
    // In non-interactive mode there is no menu, so the native one cannot be
    // mistaken for Excalidraw's own.
    if (!this.isInteractionEnabled()) {
      return;
    }

    if (
      this.touchMindmapContextMenuAllowed === false &&
      (pointer.pointerType === "touch" ||
        (pointer.pointerType === undefined &&
          this.lastPointerDownEvent?.pointerType === "touch" &&
          this.gesture.pointers.size > 0))
    ) {
      return;
    }

    // a context menu during a press (touch long-press) means the user is
    // not committing a bucket click
    this.bucketFill.cancel();

    if (
      (pointer.pointerType === "touch" ||
        (pointer.pointerType === "pen" &&
          // always allow if user uses a pen secondary button
          pointer.button !== POINTER_BUTTON.SECONDARY)) &&
      this.state.activeTool.type !== this.state.preferredSelectionTool.type
    ) {
      return;
    }

    const { x, y } = viewportCoordsToSceneCoords(pointer, this.state);
    const element = this.getElementAtPosition(x, y, {
      preferSelected: true,
      includeLockedElements: true,
    });

    const selectedElements = this.scene.getSelectedElements(this.state);
    const isHittingCommonBoundBox =
      this.isHittingCommonBoundingBoxOfSelectedElements(
        { x, y },
        selectedElements,
      );

    const type = element || isHittingCommonBoundBox ? "element" : "canvas";

    const container = this.excalidrawContainerRef.current!;
    const { top: offsetTop, left: offsetLeft } =
      container.getBoundingClientRect();
    const left = pointer.clientX - offsetLeft;
    const top = pointer.clientY - offsetTop;

    trackEvent("contextMenu", "openContextMenu", type);

    this.setState(
      {
        ...(element && !this.state.selectedElementIds[element.id]
          ? {
              ...this.state,
              ...selectGroupsForSelectedElements(
                {
                  editingGroupId: this.state.editingGroupId,
                  selectedElementIds: { [element.id]: true },
                },
                this.scene.getNonDeletedElements(),
                this.state,
                this,
              ),
              selectedLinearElement: isLinearElement(element)
                ? new LinearElementEditor(
                    element,
                    this.scene.getNonDeletedElementsMap(),
                  )
                : null,
            }
          : this.state),
        showHyperlinkPopup: false,
      },
      () => {
        this.setState({
          contextMenu: { top, left, items: this.getContextMenuItems(type) },
        });
      },
    );
  };

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
  private getContextMenuItems = (
    type: "canvas" | "element",
  ): ContextMenuItems => {
    const options: ContextMenuItems = [];

    options.push(actionCopyAsPng, actionCopyAsSvg);

    // canvas contextMenu
    // -------------------------------------------------------------------------

    if (type === "canvas") {
      if (this.state.viewModeEnabled) {
        return [
          ...options,
          actionToggleGridMode,
          actionToggleZenMode,
          actionToggleViewMode,
          actionToggleStats,
        ];
      }

      return [
        actionPaste,
        CONTEXT_MENU_SEPARATOR,
        actionCopyAsPng,
        actionCopyAsSvg,
        copyText,
        CONTEXT_MENU_SEPARATOR,
        actionSelectAll,
        actionUnlockAllElements,
        CONTEXT_MENU_SEPARATOR,
        actionToggleGridMode,
        actionToggleObjectsSnapMode,
        actionToggleArrowBinding,
        actionToggleMidpointSnapping,
        actionToggleZenMode,
        actionToggleViewMode,
        actionToggleStats,
      ];
    }

    // element contextMenu
    // -------------------------------------------------------------------------

    options.push(copyText);

    if (this.state.viewModeEnabled) {
      return [actionCopy, ...options];
    }

    if (this.mindmap.getSelectedNode()) {
      return [
        actionMindmapCreateChild,
        actionMindmapCreateSibling,
        actionMindmapToggleCollapse,
        actionMindmapPromote,
        actionToggleShapeSwitch,
        actionToggleElementLock,
        CONTEXT_MENU_SEPARATOR,
        { ...actionDeleteSelected, label: "labels.deleteMindmapSubtree" },
        actionMindmapDeletePreservingChildren,
      ];
    }

    const zIndexActions: ContextMenuItems =
      this.editorInterface.formFactor === "desktop"
        ? [
            CONTEXT_MENU_SEPARATOR,
            actionSendBackward,
            actionBringForward,
            actionSendToBack,
            actionBringToFront,
          ]
        : [];

    return [
      CONTEXT_MENU_SEPARATOR,
      actionCut,
      actionCopy,
      actionPaste,
      CONTEXT_MENU_SEPARATOR,
      actionSelectAllElementsInFrame,
      actionRemoveAllElementsFromFrame,
      actionWrapSelectionInFrame,
      CONTEXT_MENU_SEPARATOR,
      actionToggleCropEditor,
      CONTEXT_MENU_SEPARATOR,
      ...options,
      CONTEXT_MENU_SEPARATOR,
      actionCopyStyles,
      actionPasteStyles,
      CONTEXT_MENU_SEPARATOR,
      actionGroup,
      actionTextAutoResize,
      actionUnbindText,
      actionBindText,
      actionWrapTextInContainer,
      actionUngroup,
      CONTEXT_MENU_SEPARATOR,
      actionAddToLibrary,
      ...zIndexActions,
      CONTEXT_MENU_SEPARATOR,
      actionFlipHorizontal,
      actionFlipVertical,
      CONTEXT_MENU_SEPARATOR,
      actionToggleLinearEditor,
      CONTEXT_MENU_SEPARATOR,
      actionLink,
      actionCopyElementLink,
      CONTEXT_MENU_SEPARATOR,
      actionDuplicateSelection,
      actionToggleElementLock,
      CONTEXT_MENU_SEPARATOR,
      actionDeleteSelected,
    ];
  };

  getTextWysiwygSnappedToCenterPosition(
    x: number,
    y: number,
    appState: AppState,
    container?: ExcalidrawTextContainer | null,
  ) {
    if (container) {
      let elementCenterX = container.x + container.width / 2;
      let elementCenterY = container.y + container.height / 2;

      const elementCenter = getContainerCenter(
        container,
        this.scene.getNonDeletedElementsMap(),
      );
      if (elementCenter) {
        elementCenterX = elementCenter.x;
        elementCenterY = elementCenter.y;
      }
      const distanceToCenter = Math.hypot(
        x - elementCenterX,
        y - elementCenterY,
      );
      const isSnappedToCenter =
        distanceToCenter < TEXT_TO_CENTER_SNAP_THRESHOLD;
      if (isSnappedToCenter) {
        const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
          { sceneX: elementCenterX, sceneY: elementCenterY },
          appState,
        );
        return { viewportX, viewportY, elementCenterX, elementCenterY };
      }
    }
  }

  public savePointer = (x: number, y: number, button: "up" | "down") => {
    // Pan teardown broadcasts once the viewport has settled. Updates during
    // the drag use a viewport that can lag behind the pointer and flicker.
    if (this.pan.isActive()) {
      return;
    }
    // don't broadcast pointer updates (props.onPointerUpdate) when
    // non-interactive, unless the active tool stays user-driven via
    // `interaction.enabled.tools` — collaborators render e.g. a presenter's
    // laser through these updates
    if (
      !this.isInteractionEnabled() &&
      !this.isToolSupported(this.state.activeTool.type)
    ) {
      return;
    }
    if (!x || !y) {
      return;
    }
    const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
      { clientX: x, clientY: y },
      this.state,
    );

    if (isNaN(sceneX) || isNaN(sceneY)) {
      // sometimes the pointer goes off screen
    }

    const pointer: CollaboratorPointer = {
      x: sceneX,
      y: sceneY,
      tool: this.state.activeTool.type === "laser" ? "laser" : "pointer",
    };

    this.props.onPointerUpdate?.({
      pointer,
      button,
      pointersMap: this.gesture.pointers,
    });
  };

  public resetShouldCacheIgnoreZoomDebounced = debounce(() => {
    if (!this.unmounted) {
      this.setState({ shouldCacheIgnoreZoom: false });
    }
  }, 300);

  private updateDOMRect = (cb?: () => void) => {
    if (this.excalidrawContainerRef?.current) {
      const excalidrawContainer = this.excalidrawContainerRef.current;
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
      } = this.state;

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

      this.setState(
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
      this.viewport.constrain();
    }
  };

  public refresh = () => {
    this.setState({ ...this.getCanvasOffsets() });
  };

  private getCanvasOffsets(): Pick<AppState, "offsetTop" | "offsetLeft"> {
    if (this.excalidrawContainerRef?.current) {
      const excalidrawContainer = this.excalidrawContainerRef.current;
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
