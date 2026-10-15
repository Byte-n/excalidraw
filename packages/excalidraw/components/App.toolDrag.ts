import {
  DEFAULT_STICKY_NOTE_SIZE,
  DRAGGING_THRESHOLD,
  EVENT,
  KEYS,
  getGridPoint,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import {
  getStickyNoteCreationInk,
  isStickyNoteElement,
  newStickyNoteElement,
} from "@excalidraw/element";

import type {
  DirectContainerRef,
  ExcalidrawNonSelectionElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { trackEvent } from "../analytics";

import type { PresetBuildResult } from "./app/presetPlacement";
import type { CreationIdentity } from "./app/createPresets";
import type App from "./App";
import type { ToolType } from "../types";

type ScenePoint = { x: number; y: number };

/** what a drag places: any elements the new-element canvas can preview */
type DraggedElement = NonDeleted<ExcalidrawNonSelectionElement>;

/**
 * What a drag can pull out of the toolbar/抽屉 and drop where the pointer is
 * released. `createElements` assembles the (already positioned) elements —
 * single for the toolbar tools, a whole preset (泳道表格、脑图整图) for the
 * 图形抽屉; `onDrop` 是落地后的按类型补动作（进入文字/根节点编辑）。
 */
export type DraggableTool = {
  /** 埋点标签（抽屉预设即目录项 id）；缺省由 `handleButtonPointerDown` 用工具类型兜底 */
  id?: string;
  /**
   * 装配落地的元素，位置以 `at`（指针场景坐标）为锚：单元素工具即元素
   * 包围盒中心对到 `at`，多元素预设即整组包围盒中心对到 `at`。`identity` 供
   * 离屏预览传固定身份（见 `CreationIdentity`）。
   */
  createElements: (
    app: App,
    at: ScenePoint,
    identity?: CreationIdentity,
  ) => PresetBuildResult;
  /** what the tool does once its elements are on the canvas (e.g. start editing) */
  onDrop?: (app: App, result: PresetBuildResult) => void;
};

const centered = (center: ScenePoint, width: number, height: number) => ({
  x: center.x - width / 2,
  y: center.y - height / 2,
  width,
  height,
});

/**
 * 两个投放容器 ref 是否「同值」。`getContainerRefForDropAt` 每次都返回新对象，
 * 所以只有逐字段比较才能判断归属是否真的变了；同值时不重造元素（no-op）。
 */
const sameContainerRef = (
  a: DirectContainerRef | undefined,
  b: DirectContainerRef | undefined,
) => {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.kind !== b.kind || a.elementId !== b.elementId) {
    return false;
  }
  if (a.kind === "tableCell" && b.kind === "tableCell") {
    return a.cellId === b.cellId && a.role === b.role;
  }
  return true;
};

/**
 * The tools that can be dragged out of the toolbar. Add an entry to make a
 * tool's button draggable — the gesture, preview and drop are shared.
 */
export const DRAGGABLE_TOOLS: Partial<Record<ToolType, DraggableTool>> = {
  stickynote: {
    createElements: (app, center) => {
      const size = DEFAULT_STICKY_NOTE_SIZE;
      const { state } = app;
      const containerRef = app.getContainerRefForDropAt(center);
      return {
        elements: [
          newStickyNoteElement({
            type: "stickynote",
            ...centered(center, size, size),
            baseHeight: size,
            // the default yellow paper pairs with its own ink
            strokeColor: getStickyNoteCreationInk(
              state.currentItemStickynoteBackgroundColor,
              state.currentItemStickynoteStrokeColor,
            ),
            backgroundColor: state.currentItemStickynoteBackgroundColor,
            fillStyle: state.currentItemFillStyle,
            strokeWidth: app.getCurrentItemStrokeWidth("stickynote"),
            strokeStyle: state.currentItemStrokeStyle,
            opacity: state.currentItemOpacity,
            roundness: app.getCurrentItemRoundness("stickynote"),
            locked: false,
            containerRef,
          }),
        ],
      };
    },
    onDrop: (app, result) => {
      const note = result.elements[0];
      if (isStickyNoteElement(note)) {
        app.startTextEditing({
          sceneX: note.x + note.width / 2,
          sceneY: note.y + note.height / 2,
          container: note,
        });
      }
    },
  },
};

/** CSS opacity of the preview canvas while dragging */
export const TOOL_DRAG_PREVIEW_OPACITY = 0.5;

/**
 * Dragging a tool out of the toolbar (or a preset out of the 图形抽屉). The
 * preview elements exist only here until the drop — they are not in the
 * scene, the store or the history, so collaborators never see them and an
 * aborted drag leaves nothing behind. They are painted by the
 * `NewElementCanvas`, drawn exactly as they will land, with the canvas itself
 * made translucent.
 *
 * The button/cell arms on pointerdown; the drag starts once the pointer has
 * moved `DRAGGING_THRESHOLD`, so a plain press still selects the tool. The
 * gesture lives on the owner window (the pointer leaves the button at once),
 * like the other pointer gestures in `App`.
 */
export class AppToolDrag {
  constructor(private app: App) {}

  /** the elements under the pointer while dragging, `null` otherwise */
  public previewElements: readonly DraggedElement[] | null = null;

  /** the first preview element — kept for existing readers/tests */
  get preview(): DraggedElement | null {
    return this.previewElements?.[0] ?? null;
  }

  private armed: {
    pointerId: number;
    clientX: number;
    clientY: number;
  } | null = null;

  private tool: DraggableTool | null = null;
  /** 埋点用的事件标签：工具类型或抽屉预设 id */
  private label: string | null = null;

  /**
   * 跨过阈值时**只装配一次**的元素（含整组）。之后 pointermove 只做整体
   * 平移 + 网格吸附——每次 move 重建会推进共享的 id/seed 序列并重复测量
   * 文字（见 `CreationIdentity`、`App.createPreview` 的 cache 注释）。
   */
  private built: PresetBuildResult | null = null;
  /** `built` 元素所对齐的指针场景坐标（平移的参照原点） */
  private builtAt: ScenePoint | null = null;

  static isDraggable = (type: ToolType) => type in DRAGGABLE_TOOLS;

  isDragging = () => this.previewElements !== null;

  /**
   * Arm a drag from a tool button's pointerdown. Returns whether the tool is
   * draggable (the caller lets a non-draggable press fall through).
   */
  handleButtonPointerDown = (type: ToolType, event: PointerEvent) => {
    const tool = DRAGGABLE_TOOLS[type];
    if (!tool) {
      return false;
    }
    return this.arm(tool, type, event);
  };

  /**
   * Arm a drag from any other source (图形抽屉的预设格子)。与工具按钮共用同一
   * 套武装/预览/落地逻辑，只是埋点标签换成预设 id。
   */
  handlePresetPointerDown = (source: DraggableTool, event: PointerEvent) => {
    return this.arm(source, source.id ?? "preset", event);
  };

  private arm = (tool: DraggableTool, label: string, event: PointerEvent) => {
    if (event.button !== 0 || !this.app.isInteractionEnabled()) {
      return false;
    }
    this.cancel();
    this.armed = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    this.tool = tool;
    this.label = label;
    this.addListeners();
    return true;
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.armed || event.pointerId !== this.armed.pointerId) {
      return;
    }
    if (!this.previewElements) {
      const moved = Math.hypot(
        event.clientX - this.armed.clientX,
        event.clientY - this.armed.clientY,
      );
      if (moved < DRAGGING_THRESHOLD) {
        return;
      }
      trackEvent("toolbar", this.label!, "drag");
      // 跨过阈值：只装配一次（含 multi 预设），记住锚点
      const at = viewportCoordsToSceneCoords(event, this.app.state);
      this.built = this.tool!.createElements(this.app, at);
      this.builtAt = at;
    }
    this.updatePreview(event);
    this.app.triggerRender();
  };

  /**
   * 平移已装配的元素到当前指针，再按网格吸附。参照元素取第一个（单元素
   * 工具即它本身，与现状同为「指针位置 → 元素居中/吸附」口径）；吸附偏移整组
   * 一起套用，所以预设内部布局不会变形。
   */
  private updatePreview = (event: PointerEvent) => {
    const { built, builtAt } = this;
    if (!built || !builtAt) {
      return;
    }
    const at = viewportCoordsToSceneCoords(event, this.app.state);
    const dx = at.x - builtAt.x;
    const dy = at.y - builtAt.y;
    const moved = built.elements.map((element) => ({
      ...element,
      x: element.x + dx,
      y: element.y + dy,
    }));
    const anchor = moved[0];
    const [x, y] = getGridPoint(
      anchor.x,
      anchor.y,
      event[KEYS.CTRL_OR_CMD] ? null : this.app.getEffectiveGridSize(),
    );
    const snapX = x - anchor.x;
    const snapY = y - anchor.y;
    this.previewElements = moved.map((element) => ({
      ...element,
      x: element.x + snapX,
      y: element.y + snapY,
    }));
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.armed || event.pointerId !== this.armed.pointerId) {
      return;
    }
    const { previewElements, tool, label, built } = this;
    // the button's own click handles a press that never became a drag
    if (!previewElements || !built) {
      this.cancel();
      return;
    }
    const result: PresetBuildResult = {
      elements: [...previewElements],
      rootId: built.rootId,
    };
    this.cancel();
    if (!this.isOverCanvas(event)) {
      return;
    }
    const { app } = this;
    // 旧引擎每次 pointermove 都用 `createElement(app, 松手点)` 重解析投放容器
    // （`getContainerRefForDropAt`），元素归属因此由**松手处**决定（如从工具栏
    // 拖出的便签落在 Frame 里就绑定该 Frame）。新引擎只在跨过阈值时装配一次、
    // 容器取自按钮旁，这里在插入前按松手点重解析并补回旧语义。
    //
    // 只更新主要元素 `result.elements[0]`：`buildPresetElementsAt` 也是把投放
    // 容器交给主要元素，表格预设注入的标签文案自带单元格 ref，不能被覆盖。
    // 脑图整图（`rootId` 存在）装配时不带投放容器，必须保持不带，故整体跳过。
    if (!result.rootId) {
      const dropPoint = viewportCoordsToSceneCoords(event, app.state);
      const containerRef = app.getContainerRefForDropAt(dropPoint);
      const primary = result.elements[0];
      if (primary && !sameContainerRef(primary.containerRef, containerRef)) {
        result.elements = [
          { ...primary, containerRef },
          ...result.elements.slice(1),
        ];
      }
    }
    // 整组统一插入——整次拖入是**一步可撤销**（含多元素预设整图）
    app.insertNewElements(result.elements);
    app.store.scheduleCapture();
    app.setState({
      selectedElementIds: Object.fromEntries(
        result.elements.map((element) => [element.id, true]),
      ) as Record<string, true>,
      selectedGroupIds: {},
    });
    // the drop is a one-off placement: whatever tool was active (an arrow,
    // say) must not stay armed under the dropped elements or their editor
    app.setActiveTool(
      { type: app.state.preferredSelectionTool.type },
      { keepSelection: true },
    );
    trackEvent("toolbar", label!, "drop");
    tool!.onDrop?.(app, result);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === KEYS.ESCAPE) {
      event.stopPropagation();
      this.cancel();
    }
  };

  /** drop the gesture without a trace */
  cancel = () => {
    const wasDragging = this.previewElements !== null;
    this.armed = null;
    this.tool = null;
    this.label = null;
    this.built = null;
    this.builtAt = null;
    this.previewElements = null;
    this.removeListeners();
    if (wasDragging) {
      this.app.triggerRender();
    }
  };

  private isOverCanvas = (event: PointerEvent) => {
    // the element under the pointer. `elementFromPoint` sees through the
    // implicit capture a touch gives the button; jsdom doesn't implement it,
    // so fall back to the event's target
    const target = (this.app.ownerDocument.elementFromPoint?.(
      event.clientX,
      event.clientY,
    ) ?? event.target) as Element | null;
    return !!target?.closest?.(".excalidraw__canvas");
  };

  private addListeners = () => {
    const { ownerWindow } = this.app;
    ownerWindow.addEventListener(EVENT.POINTER_MOVE, this.onPointerMove);
    ownerWindow.addEventListener(EVENT.POINTER_UP, this.onPointerUp);
    ownerWindow.addEventListener(EVENT.POINTER_CANCEL, this.cancel);
    ownerWindow.addEventListener(EVENT.BLUR, this.cancel);
    ownerWindow.addEventListener(EVENT.KEYDOWN, this.onKeyDown, true);
  };

  private removeListeners = () => {
    const { ownerWindow } = this.app;
    ownerWindow.removeEventListener(EVENT.POINTER_MOVE, this.onPointerMove);
    ownerWindow.removeEventListener(EVENT.POINTER_UP, this.onPointerUp);
    ownerWindow.removeEventListener(EVENT.POINTER_CANCEL, this.cancel);
    ownerWindow.removeEventListener(EVENT.BLUR, this.cancel);
    ownerWindow.removeEventListener(EVENT.KEYDOWN, this.onKeyDown, true);
  };
}
