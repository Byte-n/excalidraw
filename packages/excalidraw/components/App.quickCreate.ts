import { CURSOR_TYPE, DRAGGING_THRESHOLD, KEYS } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import {
  LinearElementEditor,
  bindBindingElement,
  calculateAttachPointForElbowArrowBinding,
  resolveAttachPointForNonElbowBinding,
  duplicateElement,
  getContainingFrame,
  getElementAbsoluteCoords,
  getElementWithTransformHandleType,
  getQuickCreateConnector,
  getQuickCreateDragPlacement,
  getQuickCreateHandles,
  getQuickCreateResolvedTargetCenter,
  getQuickCreateTargetElement,
  getTransformHandles,
  hitTestQuickCreateHandle,
  isBindableElement,
  isShapeElement,
  isCurvedArrow,
  isElbowArrow,
  isFrameLikeElement,
  isLinearElement,
  newArrowElement,
  updateBoundPoint,
  updateElbowArrowPoints,
  QUICK_CREATE_GHOST_ALPHA,
} from "@excalidraw/element";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import type {
  ElementsMap,
  ExcalidrawBindableElement,
  ExcalidrawShapeElement,
  ExcalidrawLinearElement,
  ElementBinding,
  NonDeleted,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
  PointerType,
  PointsPositionUpdates,
} from "@excalidraw/element/types";

import type {
  QuickCreateConnector,
  QuickCreateDirection,
  QuickCreateHandle,
  QuickCreatePoint,
  QuickCreateSourceGeometry,
} from "@excalidraw/element";

import { getCurrentItemArrowProps } from "./app/arrowCreation";
import { getPresetSize } from "./app/createPresets";
import { buildPresetElementsCentered } from "./app/presetPlacement";
import {
  getCatalogItem,
  isFlowchartShapeId,
  isSequenceShapeId,
} from "./presetCatalog";

import type { CreationIdentity } from "./app/createPresets";
import type {
  CreationSpec,
  PresetCatalogGroupId,
  PresetCatalogItem,
} from "./presetCatalog";

import type { PointerDownState } from "../types";

import type React from "react";

import type App from "./App";

const MODIFIER_KEYS = new Set(["Shift", "Alt", "Control", "Meta"]);

const isModifierKey = (key: string) => MODIFIER_KEYS.has(key);

/**
 * 预演元素的固定身份（沿用 `createPresets` 的 `preview:` 约定）：预演元素只画
 * 进画布、不入场景，但一旦用构造函数默认的 `randomId()` / `randomInteger()`，
 * 就会推进共享的 id / 随机序列，让**后续真实元素**的身份整体后移。
 */
export const QUICK_CREATE_GHOST_SHAPE_ID = "preview:quick-create";
export const QUICK_CREATE_GHOST_ARROW_ID = "preview:quick-create:arrow";
/**
 * 连线的身份要按对象展开传给构造函数：`ElementConstructorOpts` 的类型不收 `id`
 * （字面量写 `id` 会被多属性检查拦下，展开则不会），运行时是认的。
 */
const GHOST_ARROW_IDENTITY: CreationIdentity = {
  id: QUICK_CREATE_GHOST_ARROW_ID,
  seed: 1,
};

/**
 * 探针副本的身份，约定同上：落地前用来量「图形该往外挪多少」的那份装配结果只
 * 参与计算，却同样会推进共享的 id / 随机序列，固定身份才不让真实落地那份后移。
 */
const GHOST_SHAPE_IDENTITY: CreationIdentity = {
  id: QUICK_CREATE_GHOST_SHAPE_ID,
  seed: 1,
};

/**
 * 一次落位解出来的全部几何：源几何（出口、方向由它算）、目标中心，以及从出口
 * 到入口的连线路径。预演与真实创建共用同一个值——「所见即所得」靠的就是这个。
 */
type QuickCreatePlacement = {
  /** 源元素 id：预演时用它从场景取源元素、算端绑定的锚点 */
  sourceId: string;
  target: QuickCreatePoint;
  connector: QuickCreateConnector;
};

/**
 * 一次进行中的方向手柄手势。按下即臂化（`preparePointerDown`），指针是否越过
 * 阈值在移动相位里定：没越过就还是一次点击，越过才算拖拽。
 *
 * 状态放在 App 实例上而不是 `pointerDownState` 上：渲染层要读它画「按下档」的
 * 手柄与跟随指针的预演（同 `App.mindmap` 的 dragSession）。三个相位各自返回
 * true 吞掉本次手势，收尾口径见 `handlePointerUp`。
 */
type QuickCreateDrag = {
  direction: QuickCreateDirection;
  elementId: string;
  /** 按下点（场景坐标），判阈值用 */
  origin: QuickCreatePoint;
  /** 当前指针（场景坐标）：拖拽时它就是连线落在新副本上的那个点 */
  pointer: QuickCreatePoint;
  /** 是否已越过拖拽阈值（屏幕 px）；越过前松手仍按点击处理 */
  moved: boolean;
};

/**
 * 预演连线的**末端目标**。把原来只认「幽灵副本」的 `ghostShape` 泛化出来：拖拽
 * 期间末端可能压在已有图形上（预演就该连到它的轮廓、与落地同源），也可能落在空白
 * （末端就是指针，不写 `endBinding`）。
 *
 * - `{ kind: "ghost" }` → 悬停/点击预演，末端绑到幽灵副本；
 * - `{ kind: "scene" }` → 拖拽经过已有图形，末端绑到它（元素表里现成有）；
 * - `null` → 拖拽末端自由（落在指针上）。
 *
 * 另一档「不给 endTarget」（落地那条）由调用方直接传裸 `buildConnectorArrow` 表达，
 * 真正的绑定交给 `bindBindingElement`，不走预演这套等效绑定。
 */
type QuickCreatePreviewEnd =
  | { kind: "ghost"; element: NonDeletedExcalidrawElement }
  | { kind: "scene"; elementId: string }
  | null;

/**
 * 拖到空白松手后的待决态：面板开着、连线还没落地。松手点、方向、源都留在这里，
 * appState 只镜像面板要读的定位与分组（见 `QuickCreateMenuState`）。
 */
type QuickCreatePending = {
  sourceId: string;
  direction: QuickCreateDirection;
  /** 松手点（场景坐标）：末端自由时连线就落在这里 */
  pointer: QuickCreatePoint;
  /** 面板定位（相对容器的屏幕坐标），同 contextMenu 的落点口径 */
  screenPoint: { top: number; left: number };
  groupId: PresetCatalogGroupId;
};

/**
 * 方向手柄：单选图形时在指示框四边外侧显示圆点，悬停换加号，**按下后拖拽**在
 * 指针处生成同款副本并用当前连接线样式连一条线（不拖直接松手则是老行为：建在
 * 让位后的落点）。形态对齐 `App.mindmap.ts` 的「+」按钮：悬停只改字形与光标。
 */
export class AppQuickCreate {
  private hovered: {
    direction: QuickCreateDirection;
    elementId: string;
  } | null = null;

  /** 进行中的手势；为 null 时手柄按悬停/点击路径走 */
  private drag: QuickCreateDrag | null = null;

  /**
   * 被 Esc 取消掉的那次按下：抬起时据此吞掉手势，免得取消之后又走一遍通用选择
   * 路径（同 `App.mindmap` 的 cancelledPointerDown）。
   */
  private cancelledPointerDown: PointerDownState | null = null;

  /**
   * 是否有修饰键按住。按住时整组方向手柄与结果预演一起不渲染（渲染层读这个
   * 值传给 getQuickCreateHandles），命中测试同时返回空，做到「看到的和点得到的
   * 一起消失」。状态由 keydown / keyup 维护（见 handleModifierKeyDown/Up），
   * 不能只在 pointermove 里读事件修饰键——指针不动时不会触发 pointermove，
   * 那样要等指针挪动才隐藏。
   */
  private modifierHeld = false;

  /**
   * 悬停预演的缓存。渲染层每帧都会来取一遍预演元素，而元素对象身上挂着两份
   * 缓存（`elementWithCanvasCache` 的离屏位图、`ShapeCache` 的图形命令）都是
   * WeakMap、按对象身份命中：每帧新建对象等于每帧重画一张位图、再分配一块
   * canvas。所以只在「源图形、方向、连接线样式」都没变时复用同一对元素。
   */
  private ghost: {
    key: string;
    elements: readonly NonDeletedExcalidrawElement[];
  } | null = null;

  /**
   * 拖到空白松手后的待决态：面板开着、连线还没落地。松手点、方向、源都留在这里
   * （appState 只镜像面板要读的定位与分组，见 `QuickCreateMenuState`）。提交/取消
   * 时都从场景**重新取源**——待决期间源被撤销/删除就整条作废。
   */
  private pendingInsert: QuickCreatePending | null = null;

  /** 待决连线的预演缓存，口径同 `ghost`（面板开着时渲染层每帧来取一遍）。 */
  private pendingGhost: {
    key: string;
    elements: readonly NonDeletedExcalidrawElement[];
  } | null = null;

  constructor(private readonly app: App) {}

  getHovered = () => this.hovered;

  /** 进行中的手势（渲染层读它画「按下档」手柄与跟随指针的预演） */
  getDrag = () => this.drag;

  /** 面板是否待决：渲染层据此把手柄整组收起、只画那条待决连线。 */
  hasPendingInsert = (): boolean => this.pendingInsert !== null;

  /** 修饰键按住或面板待决时，手柄整组与命中一起消失（`suppressed` 并入待决）。 */
  isSuppressed = (): boolean => this.modifierHeld || this.hasPendingInsert();

  /**
   * 修饰键状态变化时调用。状态没变时直接返回（按住修饰键会重复触发 keydown，
   * 不能每次都重绘）。变化时清掉当前悬停（避免松开修饰键后残留上一次的加号
   * 形态）并重绘一帧：隐藏时让圆点与预演一起消失，恢复时让它们立刻回来。
   */
  setModifierHeld = (held: boolean): void => {
    if (this.modifierHeld === held) {
      return;
    }
    this.modifierHeld = held;
    this.hovered = null;
    this.ghost = null;
    this.app.repaint.request();
  };

  /** 挂在 ownerDocument 的 keydown；只关心修饰键本身（含长按重复触发）。 */
  handleModifierKeyDown = (event: KeyboardEvent): void => {
    if (!isModifierKey(event.key)) {
      return;
    }
    // 用事件上的修饰键标志而非当前这一个 key：同时按住多个修饰键时，
    // 松开其中一个（如 shift 还按着 ctrl）不能恢复显示。
    this.setModifierHeld(
      event.shiftKey || event.altKey || event.ctrlKey || event.metaKey,
    );
  };

  /** 挂在 ownerDocument 的 keyup；keyup 丢失时由 window blur 兜底复位。 */
  handleModifierKeyUp = (event: KeyboardEvent): void => {
    if (!isModifierKey(event.key)) {
      return;
    }
    this.setModifierHeld(
      event.shiftKey || event.altKey || event.ctrlKey || event.metaKey,
    );
  };

  reset = () => {
    // 预演缓存连同悬停一起丢：它带着离屏位图，没悬停就没必要留着占内存
    // （重建一次不算贵，而且只在指针重新落到某个手柄上时才会发生）
    this.ghost = null;
    if (this.hovered) {
      this.hovered = null;
      this.app.repaint.request();
    }
  };

  hitTest = (sceneX: number, sceneY: number, pointerType = "mouse") =>
    hitTestQuickCreateHandle(
      this.app,
      sceneX,
      sceneY,
      pointerType,
      // 面板待决时命中整组返回空（同修饰键口径）：圆点已收起，点得到的也要跟着消失
      this.modifierHeld || this.hasPendingInsert(),
    );

  handlePointerMove = (sceneX: number, sceneY: number) => {
    // 面板待决：手柄整组收起、只留待决连线，不做任何悬停判定（也不 reset——
    // reset 会把待决连线的预演缓存一起丢掉）
    if (this.pendingInsert) {
      return;
    }
    // 手势进行中：悬停判定整组让位（预演改由拖拽态驱动）。这里必须早退而不是
    // 走下面的 reset 分支——reset 会把拖拽预演一起丢掉。
    if (this.drag) {
      return;
    }
    // 修饰键按住时手柄整组不渲染也不命中，悬停态一并清掉。
    // 状态由键盘监听维护，这里只是不再做命中判定。
    if (this.modifierHeld) {
      this.reset();
      return;
    }
    // 手势进行中不作悬停判定（与脑图「+」同一口径）
    if (
      this.app.state.newElement ||
      this.app.state.selectionElement ||
      this.app.state.multiElement ||
      this.app.state.selectedElementsAreBeingDragged ||
      this.app.state.resizingElement ||
      this.app.state.isRotating
    ) {
      this.reset();
      return;
    }
    const hit = this.hitTest(sceneX, sceneY);
    // 让位规则：热区命中的路径很热（每次 pointermove 都走），所以只在已经命中
    // 热区之后才做「指针下是否压着别的元素」的场景命中查询，命中时视为未命中。
    const source = hit
      ? this.app.scene.getNonDeletedElement(hit.elementId)
      : null;
    const effectiveHit =
      hit && source && this.isBlockedByElementAt(sceneX, sceneY, source)
        ? null
        : hit;
    if (
      effectiveHit?.elementId !== this.hovered?.elementId ||
      effectiveHit?.direction !== this.hovered?.direction
    ) {
      this.hovered = effectiveHit
        ? {
            direction: effectiveHit.direction,
            elementId: effectiveHit.elementId,
          }
        : null;
      if (!effectiveHit) {
        // 悬停离开：预演跟着收起，位图缓存一并丢掉（见 reset）
        this.ghost = null;
      }
      // 圆点 ↔ 加号的形态只存在组件字段里、不进 appState，setState({}) 不会让
      // 交互层重渲染（InteractiveCanvas 是 memo），必须显式重绘一帧
      this.app.repaint.request();
    }
    // 在 pointerCanvas 的工具光标之后运行，命中时不被覆盖
    if (
      effectiveHit &&
      !this.app.state.viewModeEnabled &&
      this.app.isInteractionEnabled()
    ) {
      this.app.cursor.set(CURSOR_TYPE.POINTER);
    }
  };

  /**
   * 命中方向手柄则接管本次手势：**只臂化、不建图**，等到抬起时才按「有没有拖过
   * 阈值」决定落点（见 handlePointerUp）。返回 true 时调用方须提前 return。
   */
  preparePointerDown = (
    pointerDownState: PointerDownState,
    event: React.PointerEvent<HTMLElement>,
  ): boolean => {
    // 面板待决：这次 pointerdown 放给通用路径——面板的 Popover 在 pointerdown
    // （落在面板外）时调 cancelPendingInsert 把待决连线落地并关面板。让手柄接管
    // 会让这次点击既不关面板、又长出第二路手势。
    if (this.pendingInsert) {
      return false;
    }
    // 只接管裸的主键点击：带修饰键的点击是选择手势（shift 多选、alt 复制等），
    // 右键留给上下文菜单，一律不吞。
    if (
      event.button !== 0 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return false;
    }
    if (
      !this.app.isInteractionEnabled() ||
      this.app.state.viewModeEnabled ||
      this.app.state.editingTextElement
    ) {
      return false;
    }
    const resolvedPointerType: PointerType =
      event.pointerType === "touch" || event.pointerType === "pen"
        ? event.pointerType
        : "mouse";
    const hit = this.hitTest(
      pointerDownState.origin.x,
      pointerDownState.origin.y,
      resolvedPointerType,
    );
    const source = hit && this.app.scene.getNonDeletedElement(hit.elementId);
    if (!hit || !source) {
      return false;
    }
    // 让位规则（与 handlePointerMove 共用同一个判定，否则会出现「高亮着却点不动」）：
    // 指针底下压着别的元素时，这次手势让给选择——那儿本来就会选中/拖动那个元素，
    // 而手柄的用途是「往这个方向长一份」，目标位置已经有东西了，用户更可能想选中它。
    if (
      this.isBlockedByElementAt(
        pointerDownState.origin.x,
        pointerDownState.origin.y,
        source,
      )
    ) {
      return false;
    }
    const point = {
      x: pointerDownState.origin.x,
      y: pointerDownState.origin.y,
    };
    // 指针同时落在圆点热区与某个变换手柄命中区内时，比「谁的中心更近」：
    // 手柄中心更近或相等 → 让给缩放（鼠标下拖边缩放的语义与加手柄前一致）；
    // 圆点更近 → 圆点接管。touch/pen 的手柄命中矩形更大（28/16px，以边外 4px
    // 为中心），会把圆点中心也包进去，但圆点中心仍更近，所以触屏点圆点照样建图、
    // 点胶囊中心仍是缩放。
    if (
      getElementWithTransformHandleType(
        [source],
        this.app.state,
        point.x,
        point.y,
        this.app.state.zoom,
        resolvedPointerType,
        this.app.scene.getNonDeletedElementsMap(),
        this.app.editorInterface,
      ) &&
      !this.isDotCloserThanTransformHandle(
        source,
        point,
        hit.direction,
        resolvedPointerType,
      )
    ) {
      return false;
    }
    pointerDownState.drag.blockDragging = true;
    pointerDownState.resize.handleType = false;
    pointerDownState.resize.isResizing = false;
    this.hovered = null;
    this.ghost = null;
    this.drag = {
      direction: hit.direction,
      elementId: source.id,
      origin: point,
      pointer: point,
      moved: false,
    };
    // 按下即刻换「按下档」字形（组件字段，setState({}) 不会重绘 InteractiveCanvas）
    this.app.repaint.request();
    return true;
  };

  /**
   * 移动相位：维护指针位置与「是否拖过阈值」。**没拖过阈值也返回 true**——手势
   * 已经归方向手柄所有，让给选择路径会让同一次按下先选出别的元素。指针不动的
   * 那些移动事件只更新坐标，阈值一次越过就不再回退（拖回去也算拖过）。
   */
  handlePointerMoveFromPointerDown = (
    pointerDownState: PointerDownState,
    scenePoint: QuickCreatePoint,
  ): boolean => {
    const drag = this.drag;
    if (!drag) {
      return false;
    }
    drag.pointer = { x: scenePoint.x, y: scenePoint.y };
    if (!drag.moved) {
      const distance = Math.hypot(
        scenePoint.x - drag.origin.x,
        scenePoint.y - drag.origin.y,
      );
      drag.moved = distance * this.app.state.zoom.value >= DRAGGING_THRESHOLD;
    }
    // 预演跟手：几何每帧都变，只能显式重绘（setState 不会让 memo 的交互层重画）
    this.app.repaint.request();
    return true;
  };

  /**
   * 抬起相位三分支（只认真正的 `pointerup`，pointercancel 与「丢失抬起」一律不落地）：
   *
   * - **没拖过阈值** → 老的点击路径 `createConnectedShape`（基准位 + 让位，行为不变）；
   * - **拖过阈值且指针下压着可绑定的图形** → `createConnectorOnly`：只建一条两端绑定
   *   的连线（自由指向的语义：把源连到那个图形上）；
   * - **拖过阈值落在空白** → `openInsertMenu`：先不落地，弹「插入图形」面板（§待决态），
   *   预演继续留着，等提交/取消时再收口。
   */
  handlePointerUp = (
    pointerDownState: PointerDownState,
    event: PointerEvent,
    scenePoint: QuickCreatePoint,
  ): boolean => {
    if (this.cancelledPointerDown === pointerDownState) {
      this.cancelledPointerDown = null;
      return true;
    }
    const drag = this.drag;
    if (!drag) {
      return false;
    }
    this.drag = null;
    this.ghost = null;
    const source = this.app.scene.getNonDeletedElement(drag.elementId);
    if (event.type === "pointerup" && source) {
      if (!drag.moved) {
        this.createConnectedShape(source, drag.direction);
      } else {
        // 落点判定与预演同源：都按松手点的场景坐标查「指针下有谁」（锁定元素
        // 天然不命中 → 当空白），于是「预演连到哪个图形」与「落地连到哪个图形」
        // 不会分叉。
        const target = this.resolveDragEndTarget(
          scenePoint.x,
          scenePoint.y,
          source,
        );
        if (target) {
          this.createConnectorOnly(source, drag.direction, scenePoint, target);
        } else {
          this.openInsertMenu(source, drag.direction, scenePoint, event);
        }
      }
    }
    // 无论落地与否都算这次手势已处理：免得通用路径再排一次空的历史捕获
    pointerDownState.drag.hasOccurred = true;
    this.app.repaint.request();
    return true;
  };

  /** Esc 取消：不建图、不留历史；抬起时由 cancelledPointerDown 吞掉收尾。 */
  handlePointerKeyDown = (
    pointerDownState: PointerDownState,
    event: KeyboardEvent,
  ): boolean => {
    if (!this.drag || event.key !== KEYS.ESCAPE) {
      return false;
    }
    this.cancelledPointerDown = pointerDownState;
    this.drag = null;
    this.ghost = null;
    this.app.repaint.request();
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  /**
   * 让位规则：指针底下是否压着**别的**元素，压着就不让方向手柄接管这次手势。
   *
   * 手柄的用途是「往这个方向长一份」：新副本本来就落在那个方向、源图形边上外
   * 12–32px 的一圈里。那一圈里已经站着别的元素时，用户更可能想选中/拖动它，
   * 而不是在它身上再叠一份；何况副本建出来也会跟它重叠。所以两处命中（悬停与
   * 按下）共用这一个判定，避免出现「高亮着却点不动」。
   *
   * 排除项：
   * - 源元素自身——圆点圆心在源元素本地框边外 offset（常规 22 / 紧凑 18），热区
   *   半径最大 16（触屏），几何上压不到源元素，这里只是兜住（元素旋转后指示框取
   *   的是轴对齐包围盒，而圆点圆心是相对包围盒边算的，朝内的方向全部排除）。
   * - 容器（画框等）——画框只在**边框/标题**上被命中，源图形贴边或贴着标题时
   *   手柄圆心就会压在画框上；若算作被挡，「画框内的图形点圆点照常建图」就废了。
   *   源元素自己所属的容器同理（`getContainingFrame`）。
   * - 线性元素（arrow / line）——连线又细又长，一条 1–2px 的线不该否决一个 ⌀20
   *   的手柄；而且与本功能强相关的连线（源图形的出边）必然压在圆心正上方：它从
   *   图形边的中点朝外走，手柄圆心也在同一条外法线上（边外 22px），几何上必然
   *   穿过圆心。那正是手柄该在的地方——选中一条连线的正常操作是点它的中段/标签，
   *   不是在距图形边 22px 处。不排除的话，任何带连线的图形（流程图节点就是）四边
   *   被连线穿过的那些手柄全成死的，用一次功能后副本上朝回指的那个手柄也立刻死。
   * - 源元素绑定的元素（`source.boundElements` 命中）——上面那条的特例（源图形的
   *   出边箭头、绑定文字），但按绑定关系判更稳：万一有非 arrow 的绑定元素同样排除。
   * - 锁定元素——`getElementAtPosition` 默认不命中锁定元素（与选择路径同一口径：
   *   不传 includeLockedElements 时点击也选不中它），所以锁定元素不算「压着」，
   *   手柄照常可用（让位也没意义：这个手势换不来选中）。
   */
  private isBlockedByElementAt = (
    sceneX: number,
    sceneY: number,
    source: NonDeletedExcalidrawElement,
  ): boolean => {
    const under = this.app.getElementAtPosition(sceneX, sceneY);
    if (!under || under.id === source.id || isLinearElement(under)) {
      return false;
    }
    // 源自己的绑定元素（出边箭头、绑定文字）
    if (source.boundElements?.some((bound) => bound.id === under.id)) {
      return false;
    }
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const containingFrame = getContainingFrame(source, elementsMap);
    return !isFrameLikeElement(under) && under.id !== containingFrame?.id;
  };

  /**
   * 圆点中心是否比最近的变换手柄中心更靠近指针。手柄在 fork 里是
   * `[x, y, width, height]` 四元组（不是 Bounds 的 min/max），中心取
   * `(x + width / 2, y + height / 2)`；旋转元素的中心已按 angle 旋转过。
   */
  private isDotCloserThanTransformHandle = (
    source: NonDeletedExcalidrawElement,
    point: { x: number; y: number },
    direction: QuickCreateDirection,
    pointerType: PointerType,
  ): boolean => {
    const dot = getQuickCreateHandles(this.app, pointerType).find(
      (handle) =>
        handle.direction === direction && handle.elementId === source.id,
    );
    if (!dot) {
      return false;
    }
    const transformHandles = getTransformHandles(
      source,
      this.app.state.zoom,
      this.app.scene.getNonDeletedElementsMap(),
      pointerType,
      {},
    );
    let closestHandleDistance = Infinity;
    for (const transformHandle of Object.values(transformHandles)) {
      if (!transformHandle) {
        continue;
      }
      const [x, y, width, height] = transformHandle;
      closestHandleDistance = Math.min(
        closestHandleDistance,
        Math.hypot(point.x - (x + width / 2), point.y - (y + height / 2)),
      );
    }
    const dotDistance = Math.hypot(
      point.x - dot.center.x,
      point.y - dot.center.y,
    );
    return dotDistance < closestHandleDistance;
  };

  /**
   * 预演元素：悬停/点击档是「幽灵副本 + 幽灵连线」，拖拽档**只剩连线**。
   *
   * 只用于绘制——不进 scene、不进 store、不进历史，协作端看不到；身份固定，
   * 不消耗共享的 id / 随机序列。
   *
   * 几何取自与落地同一套函数、样式原样照抄源图形与当前连接线，渲染层用
   * `renderElement` 画，所以看到的线条、箭头、填充就是落地之后的样子，只有不
   * 透明度不同（`QUICK_CREATE_GHOST_ALPHA`）。
   *
   * 拖拽档末端口径分两支（与落地同源，见 `resolveDragEndTarget`）：指针压在可
   * 绑定图形上 → 预演就连到它的轮廓；空白 → 末端就是指针（不写 `endBinding`）。
   */
  getGhostElements = (
    handle: QuickCreateHandle,
  ): readonly NonDeletedExcalidrawElement[] => {
    const source = getQuickCreateTargetElement(this.app);
    if (!source || !isShapeElement(source)) {
      return [];
    }
    const placement = this.resolvePlacementFor(source, handle.direction);
    const dragging = this.isDraggingHandle(source.id, handle.direction);
    // 拖拽档的末端目标（悬停/点击档不在这里定：那条末端恒是幽灵副本）
    const draggingEnd: QuickCreatePreviewEnd = dragging
      ? this.resolveDragPreviewEnd(
          placement.connector.entry.x,
          placement.connector.entry.y,
          source,
        )
      : null;
    const key = [
      source.id,
      source.version,
      handle.direction,
      this.getArrowStyleFingerprint(),
      // 落位由「出口 + 入口 + 落点」完全决定（出口只由源与方向决定），所以这三样
      // 进缓存键就够了：拖拽中的预演与点击的预演可能落在同一个中心上，但入口不同
      // （拖拽那条的入口就是指针），只比落点会把两种口径混成同一个键。
      placement.connector.entry.x,
      placement.connector.entry.y,
      // 落点还取决于场上别的图形：基准位被占时副本会沿绝对轴让位，所以解出来的
      // 目标位置也进缓存键——不然场景一变（别的图形挪过来/挪走）还会画着上一帧
      // 的旧落点与旧折线。
      placement.target.x,
      placement.target.y,
      // 拖拽末端目标也进键：指针从某个图形上空划过去时绑定不同、线也不同，少了
      // 这截会一直画着上一帧的旧绑定 / 旧自由端。按 `kind` 收窄（拖拽档只会是
      // `scene` 或 `null`，但类型上是三档，直接读 `elementId` 过不了类型检查）。
      dragging
        ? draggingEnd?.kind === "scene"
          ? `scene:${draggingEnd.elementId}`
          : "free"
        : "ghost",
    ].join("|");
    if (this.ghost?.key !== key) {
      this.ghost = {
        key,
        elements: this.buildGhostElements(
          source,
          placement,
          dragging,
          draggingEnd,
        ),
      };
    }
    return this.ghost.elements;
  };

  /** 当前拖拽是否正是这个源的这个方向（预演与落位判定共用，避免两处口径分叉） */
  private isDraggingHandle = (
    sourceId: string,
    direction: QuickCreateDirection,
  ) =>
    this.drag?.moved === true &&
    this.drag.elementId === sourceId &&
    this.drag.direction === direction;

  /** 影响幽灵连线的样式切片：变了预演就得重建，否则会画着上一套样式 */
  private getArrowStyleFingerprint = () => {
    const { state } = this.app;
    return [
      state.currentItemStrokeColor,
      state.currentItemStrokeWidthKey,
      state.currentItemStrokeStyle,
      state.currentItemOpacity,
      state.currentItemArrowType,
      state.currentItemStartArrowhead,
      state.currentItemEndArrowhead,
    ].join("|");
  };

  /**
   * 落位来源：**已越过阈值**的拖拽走指针落位，其余（悬停预演、按下但还没拖、
   * 点击落地）走基准位 + 让位。
   *
   * 阈值前不看指针，是为了让「按下不拖」这条老路径全程所见即所得：悬停时预演
   * 画在基准位，按下去它不该跳到指针那儿，松手也仍然落在基准位。
   */
  private resolvePlacementFor = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
  ): QuickCreatePlacement =>
    this.drag?.moved &&
    this.drag.elementId === source.id &&
    this.drag.direction === direction
      ? this.resolveDragPlacement(source, direction, this.drag.pointer)
      : this.resolvePlacement(source, direction);

  /** 落位与连线几何只需要源的这几项（角度绕元素框中心旋转） */
  private getSourceGeometry = (
    source: NonDeletedExcalidrawElement,
  ): QuickCreateSourceGeometry => {
    const bounds = getElementAbsoluteCoords(
      source,
      this.app.scene.getNonDeletedElementsMap(),
    );
    return {
      center: {
        x: (bounds[0] + bounds[2]) / 2,
        y: (bounds[1] + bounds[3]) / 2,
      },
      angle: source.angle,
      width: source.width,
      height: source.height,
    };
  };

  /**
   * 落点与连线的**唯一**来源：悬停预演、拖拽预演与真实创建都从这里取几何，所见即所得。
   *
   * 落点先用老规则算基准位（源中心沿旋转后的方向向量外移「源半尺寸 + 间隙 +
   * 副本半尺寸」），基准位压着已有图形时再沿**绝对轴**让位（见
   * `getQuickCreateResolvedTargetCenter`）。连线按落点算出口、入口与转折点；
   * 曲线样式的**弯曲**几何不在这里落地：那档只用出口/入口当两个端点，弯曲形状
   * 在渲染期由两端 + 各自所依附边的外法线推导（见 `element/curveConnector.ts`）。
   */
  private resolvePlacement = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
  ): QuickCreatePlacement => {
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const geometry = this.getSourceGeometry(source);
    const size = { width: source.width, height: source.height };
    const target = getQuickCreateResolvedTargetCenter(
      { ...geometry, id: source.id, boundElements: source.boundElements },
      direction,
      size,
      elementsMap,
    );
    return {
      sourceId: source.id,
      target,
      connector: getQuickCreateConnector(geometry, direction, target, size),
    };
  };

  /**
   * 拖拽落位（口径 A1）：指针就是连线落在新副本上的那个点，副本身心由它反推
   * （轮廓恰好经过指针）。出口仍是手柄那条边的中点（口径 B1），**不参与让位**。
   */
  private resolveDragPlacement = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
    pointer: QuickCreatePoint,
  ): QuickCreatePlacement => ({
    sourceId: source.id,
    ...getQuickCreateDragPlacement(
      this.getSourceGeometry(source),
      direction,
      pointer,
      { width: source.width, height: source.height },
    ),
  });

  /**
   * 预演元素：
   * - **悬停/点击档** → `[幽灵副本, 幽灵连线]`，末端绑到副本（老口径）；
   * - **拖拽档** → 只剩 `[连线]`——拖到的位置还没有图形，画一个预演副本是假
   *   承诺；末端按 `draggingEnd` 定：压在可绑定图形上就绑到它，空白则自由落在
   *   指针上（不写 `endBinding`）。
   */
  private buildGhostElements = (
    source: NonDeleted<ExcalidrawShapeElement>,
    placement: QuickCreatePlacement,
    dragging: boolean,
    draggingEnd: QuickCreatePreviewEnd,
  ): readonly NonDeletedExcalidrawElement[] => {
    if (dragging) {
      return [
        this.buildConnectorArrow(placement, {
          opacityScale: QUICK_CREATE_GHOST_ALPHA,
          identity: GHOST_ARROW_IDENTITY,
          endTarget: draggingEnd,
        }),
      ];
    }
    const ghostShape = this.buildGhostShape(source, placement.target);
    return [
      ghostShape,
      this.buildConnectorArrow(placement, {
        opacityScale: QUICK_CREATE_GHOST_ALPHA,
        identity: GHOST_ARROW_IDENTITY,
        endTarget: { kind: "ghost", element: ghostShape },
      }),
    ];
  };

  /** 幽灵副本：与 `cloneShape` 同款（清掉分组/绑定/容器归属），只压暗一半 */
  private buildGhostShape = (
    source: NonDeleted<ExcalidrawShapeElement>,
    target: { x: number; y: number },
  ): NonDeletedExcalidrawElement =>
    ({
      ...source,
      id: QUICK_CREATE_GHOST_SHAPE_ID,
      x: target.x - source.width / 2,
      y: target.y - source.height / 2,
      groupIds: [],
      boundElements: null,
      index: null,
      containerRef: undefined,
      opacity: source.opacity * QUICK_CREATE_GHOST_ALPHA,
    } as NonDeleted<ExcalidrawShapeElement>);

  /**
   * 连线：把几何解出来的路径按**当前线样式**落成箭头的 x/y 与 points
   * （points 是相对 x/y 的局部坐标，与画布上拖拽建的箭头同一套约定）。
   *
   * **点位数只由线型决定，创建路径一律给两点 [出口, 入口]**：
   *
   * - 直线：画出来就是这条（副本让位错开时也只是斜着直连——线型是「直线」）。
   * - 圆角曲线：弯曲几何另有归属（`element/curveConnector.ts`，判据只看圆角），
   *   创建路径一个弯曲几何都不算。
   * - 折线箭头：两点 + `elbowed` 交给内置正交路由布线，**落地与预演都走它**
   *   （预演那条见 `routePreviewElbowArrow`），所以这里不再自己拼拐点。
   */
  private buildConnectorArrow = (
    placement: QuickCreatePlacement,
    options: {
      opacityScale?: number;
      identity?: CreationIdentity;
      /**
       * 预演末端目标（见 `QuickCreatePreviewEnd`）：**缺省**表示不做预演——落地
       * 那条自己走 `bindBindingElement`；给了（含 `null`）就补上与落地同源的等效
       * 绑定并把两端落到位。
       */
      endTarget?: QuickCreatePreviewEnd;
    } = {},
  ): NonDeleted<ExcalidrawLinearElement> => {
    const { connector } = placement;
    const arrowProps = getCurrentItemArrowProps(this.app);
    const { exit, entry } = connector;
    const created = newArrowElement({
      type: "arrow",
      x: exit.x,
      y: exit.y,
      ...arrowProps,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(entry.x - exit.x, entry.y - exit.y),
      ],
      ...(options.opacityScale === undefined
        ? {}
        : { opacity: arrowProps.opacity * options.opacityScale }),
      ...options.identity,
    });
    const arrow: NonDeleted<ExcalidrawLinearElement> = created;
    // 落地那条（不给 endTarget）：只出裸箭头，两端绑定交给 bindBindingElement
    if (options.endTarget === undefined) {
      return arrow;
    }
    // 预演元素不在场景里、没有绑定：补上与落地 `bindBindingElement` 写进去的
    // 同源固定点（口径同 `binding.attachPoint`）。渲染期正是读它解端切线、决定该端
    // 贴在哪条边、曲线朝哪弯，缺了会退回弦主轴、画出错的轴向。
    const bound: NonDeleted<ExcalidrawLinearElement> = {
      ...arrow,
      ...this.getPreviewBindings(placement, arrow, options.endTarget),
    };
    // 再按与落地 `projectArrowEndpoints` 同一个 `updateBoundPoint` 把两端落到位，
    // 折线档继续按内置路由收口（落地那条由 `movePoints` → `mutateElement` 接手）
    return this.projectPreviewEndpoints(bound, options.endTarget);
  };

  /**
   * 预演专用：把两端按**与落地同一个** `updateBoundPoint` 落到位（它是纯函数，
   * 返回元素局部坐标点）。预演元素不在场景里，没法走落地那条 `movePoints`，所以
   * 这里只把返回的点写回元素本身。幽灵副本要临时塞进 map：解析另一端的绑定时会查它。
   *
   * 最后一步与落地同一处收口：折线档的点位由内置正交路由决定，预演也跑它一遍
   * （见 `routePreviewElbowArrow`）。
   */
  private projectPreviewEndpoints = (
    arrow: NonDeleted<ExcalidrawLinearElement>,
    endTarget: QuickCreatePreviewEnd,
  ): NonDeleted<ExcalidrawLinearElement> => {
    const elementsMap = this.getPreviewElementsMap(endTarget);
    const points = arrow.points.map((p) => pointFrom<LocalPoint>(p[0], p[1]));
    for (const field of ["startBinding", "endBinding"] as const) {
      const binding = arrow[field];
      const target = binding && elementsMap.get(binding.elementId);
      if (binding && target && isBindableElement(target)) {
        const point = updateBoundPoint(arrow, binding, target, elementsMap);
        if (point) {
          points[field === "startBinding" ? 0 : points.length - 1] = point;
        }
      }
    }
    // 与落地 `movePoints` 同款归位：端点的元素局部不变量是 points[0] 恒为 [0,0]，
    // 所以把投影后的起点搬回原点、元素 x/y 反向平移（场景位置不变）
    const [offsetX, offsetY] = points[0];
    return this.routePreviewElbowArrow(
      {
        ...arrow,
        x: arrow.x + offsetX,
        y: arrow.y + offsetY,
        points: points.map((p) =>
          pointFrom<LocalPoint>(p[0] - offsetX, p[1] - offsetY),
        ),
      },
      elementsMap,
    );
  };

  /**
   * 折线档的预演必须跑**同一套内置正交路由**：落地那条只给两点 + `elbowed`，
   * `mutateElement` 会把 points 转交 `updateElbowArrowPoints` 重新布线（拐点由 A*
   * 网格搜索定、每段轴对齐、两端各留一个折线 gap，末段恒垂直于所依附的那条边），
   * 我们自己也拼不出这套结果。
   *
   * 之前预演是自己拼一个「出线轴中点」的单折 Z，只在落点与出口**同轴**时与路由
   * 恰好同形——点击那条路正是如此（副本落在手柄轴或绝对轴上，入口永远在副本的
   * 轴向边上），所以一直没暴露；拖拽的自由落点让入口落到任意一条边上，末段朝向
   * 与拐点就都分叉了（对照数据见 `.tmp/a.md`）。
   *
   * 输入与落地逐项对齐：同一对绑定（含折线档自己的固定点口径）、同一个含副本的
   * 元素表、同一组 options（落地那条经 `movePoints` 传下来的 `isDragging` 为假）；
   * 返回值也照 `mutateElement` 那样整份套回元素（路由会把原点挪到首点、重算尺寸）。
   */
  private routePreviewElbowArrow = (
    arrow: NonDeleted<ExcalidrawLinearElement>,
    elementsMap: ElementsMap,
  ): NonDeleted<ExcalidrawLinearElement> => {
    if (!isElbowArrow(arrow)) {
      return arrow;
    }
    return {
      ...arrow,
      ...updateElbowArrowPoints(
        arrow,
        elementsMap as NonDeletedSceneElementsMap,
        {
          points: arrow.points,
          startBinding: arrow.startBinding,
          endBinding: arrow.endBinding,
        },
        { isDragging: false },
      ),
    } as NonDeleted<ExcalidrawLinearElement>;
  };

  /** 预演用的元素表：场景 + 幽灵副本（绑定求解与路由都要按 id 查它）。
   *  `scene` 档的目标本就在场景里，`null` 档没有末端元素，都不用额外塞。 */
  private getPreviewElementsMap = (
    endTarget: QuickCreatePreviewEnd,
  ): ElementsMap => {
    const elementsMap: ElementsMap = new Map(
      this.app.scene.getNonDeletedElementsMap(),
    );
    if (endTarget?.kind === "ghost") {
      elementsMap.set(endTarget.element.id, endTarget.element);
    }
    return elementsMap;
  };

  /**
   * 预演连线的等效绑定：附着点的归一化盒坐标。用与落地 `bindBindingElement` 内部
   * **同一个**函数算，两边因此逐位一致——注意落地是按 `isElbowArrow` 分叉的
   * （`binding.ts:1158`），折线档走它自己那一支：不照做的话两端会差一个 binding gap。
   *
   * 起端恒绑源（末端与否无关）；末端按 `endTarget` 定：`ghost`/`scene` 各有元素，
   * `null` 则留空（自由端不写 `endBinding`）。
   */
  private getPreviewBindings = (
    placement: QuickCreatePlacement,
    arrow: NonDeleted<ExcalidrawLinearElement>,
    endTarget: QuickCreatePreviewEnd,
  ): {
    startBinding: ElementBinding | null;
    endBinding: ElementBinding | null;
  } => {
    const { sourceId, connector } = placement;
    const elementsMap = this.getPreviewElementsMap(endTarget);
    const source = this.app.scene.getNonDeletedElement(sourceId);
    const endElement =
      endTarget?.kind === "ghost"
        ? endTarget.element
        : endTarget?.kind === "scene"
        ? this.app.scene.getNonDeletedElement(endTarget.elementId)
        : null;
    const elbowed = isElbowArrow(arrow) ? arrow : null;
    const attachPointFor = (
      target: NonDeleted<ExcalidrawBindableElement>,
      startOrEnd: "start" | "end",
      focusPoint: QuickCreatePoint,
    ) =>
      elbowed
        ? calculateAttachPointForElbowArrowBinding(
            elbowed,
            target,
            startOrEnd,
            elementsMap,
          )
        : resolveAttachPointForNonElbowBinding(
            arrow,
            target,
            startOrEnd,
            elementsMap,
            pointFrom<GlobalPoint>(focusPoint.x, focusPoint.y),
          );
    return {
      startBinding:
        source && isBindableElement(source)
          ? {
              elementId: sourceId,
              ...attachPointFor(source, "start", connector.exit),
            }
          : null,
      endBinding:
        endElement && isBindableElement(endElement)
          ? {
              elementId: endElement.id,
              ...attachPointFor(endElement, "end", connector.entry),
            }
          : null,
    };
  };

  /**
   * 副本 = 除文字外完全一致（同 shape.id/宽高/角度/圆角/样式与 shape 配置），
   * 只换新 id/seed/version，并清掉原图形的绑定、分组与容器归属。
   * 连线先插入，图形压在上面；两者同一次捕获，撤销一步同时移除。
   *
   * `pointer` 给出时走**拖拽落位**（指针 = 连线端点，不让位），缺省走点击的
   * 基准位 + 让位。
   */
  createConnectedShape = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
    pointer?: QuickCreatePoint,
  ) => {
    const placement = pointer
      ? this.resolveDragPlacement(source, direction, pointer)
      : this.resolvePlacement(source, direction);
    const clone = this.cloneShape(
      source,
      placement.target.x,
      placement.target.y,
    );
    const arrow = this.buildConnectorArrow(placement);

    this.app.insertNewElements([arrow, clone]);
    // 两端绑定的**锚点**（决定该端贴在哪条边、曲线朝哪弯）用几何解出来的出口 /
    // 入口：这里显式传 `focusPoint`，落地写进 `attachPoint` 的值因此与预演逐位一致
    // （预演走的是同一个函数）。创建路径的端点本来就落在出口 / 入口上，显式传是
    // 把「锚点取这里」写成明确意图，不改变结果。
    bindBindingElement(
      arrow,
      source as NonDeleted<ExcalidrawBindableElement>,
      "start",
      this.app.scene,
      pointFrom<GlobalPoint>(
        placement.connector.exit.x,
        placement.connector.exit.y,
      ),
    );
    bindBindingElement(
      arrow,
      clone as NonDeleted<ExcalidrawBindableElement>,
      "end",
      this.app.scene,
      pointFrom<GlobalPoint>(
        placement.connector.entry.x,
        placement.connector.entry.y,
      ),
    );
    // 两点连线（直线、圆角连接线，以及交给内置正交路由的折线箭头）按 orbit 绑定
    // 把两端落到位（`updateBoundPoint`）；折线样式的端点**已经**按几何落在两个
    // 轮廓上（入口就是副本轮廓的轴向交点），不能再来一次：那条规则只会沿「副本
    // 中心 → 倒数第二个点」这条射线求交点——对折线来说是错的那条射线，会把入口
    // 从轮廓上拽走，旋转副本尤其明显。圆角连接线现在恒为两点，走的就是这一步。
    if (arrow.points.length === 2) {
      this.projectArrowEndpoints(arrow);
    }

    this.app.setState({
      selectedElementIds: { [clone.id]: true },
      selectedGroupIds: {},
      selectedLinearElement: null,
      hoveredElementIds: {},
      editingGroupId: null,
    });
    // 副本与连线同一次插入，一步可撤销
    this.app.store.scheduleCapture();
  };

  private cloneShape = (
    source: NonDeletedExcalidrawElement,
    centerX: number,
    centerY: number,
  ): NonDeleted<ExcalidrawShapeElement> => {
    const copy = duplicateElement(null, new Map(), source, true);
    return {
      ...copy,
      x: centerX - source.width / 2,
      y: centerY - source.height / 2,
      groupIds: [],
      boundElements: null,
      index: null,
      // 画框归属：本 fork 元素没有 frameId 字段，归属走 containerRef
      // （与 frameChildrenIndex 同口径），清掉才不会被画框当成员
      containerRef: undefined,
    } as NonDeleted<ExcalidrawShapeElement>;
  };

  /** 按已建立的绑定把两端落到位；落点口径在共享的 `updateBoundPoint` 里。 */
  private projectArrowEndpoints = (
    arrow: NonDeleted<ExcalidrawLinearElement>,
  ) => {
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const updates: PointsPositionUpdates = new Map();
    for (const field of ["startBinding", "endBinding"] as const) {
      const binding = arrow[field];
      const target = binding && elementsMap.get(binding.elementId);
      if (binding && target && isBindableElement(target)) {
        const point = updateBoundPoint(arrow, binding, target, elementsMap);
        if (point) {
          updates.set(field === "startBinding" ? 0 : arrow.points.length - 1, {
            point,
          });
        }
      }
    }
    if (updates.size) {
      LinearElementEditor.movePoints(arrow, this.app.scene, updates);
    }
  };

  // ---------------------------------------------------------------------------
  // 拖拽档落地与「插入图形」待决态
  // ---------------------------------------------------------------------------

  /**
   * 落点判定（拖拽档）：松手点下压着的**可绑定**图形。命中不了就当空白处理——
   * 口径与 `isBlockedByElementAt` 一致：锁定元素 `getElementAtPosition` 默认不命中，
   * 因此算空白；连线（arrow/line）与画框不是「能连到的东西」，一并排除；源自身排除。
   */
  private resolveDragEndTarget = (
    sceneX: number,
    sceneY: number,
    source: NonDeletedExcalidrawElement,
  ): NonDeleted<ExcalidrawBindableElement> | null => {
    const under = this.app.getElementAtPosition(sceneX, sceneY);
    if (
      !under ||
      under.id === source.id ||
      isLinearElement(under) ||
      isFrameLikeElement(under) ||
      !isBindableElement(under)
    ) {
      return null;
    }
    return under as NonDeleted<ExcalidrawBindableElement>;
  };

  /** 预演用的末端目标：把 `resolveDragEndTarget` 的结果包成 `scene` 档或自由端 */
  private resolveDragPreviewEnd = (
    sceneX: number,
    sceneY: number,
    source: NonDeletedExcalidrawElement,
  ): QuickCreatePreviewEnd => {
    const target = this.resolveDragEndTarget(sceneX, sceneY, source);
    return target ? { kind: "scene", elementId: target.id } : null;
  };

  /**
   * 只建一条连线：拖到已有图形松手，或面板取消（保留连线）都走这里。两端都绑定
   * （起端源、末端目标），选中新连线，**一步撤销**。
   *
   * `target` 为空表示末端自由（面板取消那条口径）：末端落在松手点、不写 `endBinding`。
   */
  createConnectorOnly = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
    pointer: QuickCreatePoint,
    target: NonDeleted<ExcalidrawBindableElement> | null,
  ): void => {
    const placement = this.resolveDragPlacement(source, direction, pointer);
    const arrow = this.buildConnectorArrow(placement);
    this.app.insertNewElements([arrow]);
    // 绑定锚点用几何解出来的出口 / 入口：与预演逐位一致（预演走同一个更新函数）
    bindBindingElement(
      arrow,
      source as NonDeleted<ExcalidrawBindableElement>,
      "start",
      this.app.scene,
      pointFrom<GlobalPoint>(
        placement.connector.exit.x,
        placement.connector.exit.y,
      ),
    );
    if (target) {
      bindBindingElement(
        arrow,
        target,
        "end",
        this.app.scene,
        pointFrom<GlobalPoint>(
          placement.connector.entry.x,
          placement.connector.entry.y,
        ),
      );
    }
    // 两点连线的两端按 orbit 绑定落到位（口径同 createConnectedShape，折线档已按几何落好）
    if (arrow.points.length === 2) {
      this.projectArrowEndpoints(arrow);
    }
    this.app.setState({
      selectedElementIds: { [arrow.id]: true },
      selectedGroupIds: {},
      selectedLinearElement: null,
      hoveredElementIds: {},
      editingGroupId: null,
    });
    // 只这一条连线，一步可撤销
    this.app.store.scheduleCapture();
  };

  /**
   * 落地补偿量的探针：返回 `delta = P − E`（直线 / 折线档落到图形位置上，圆角曲线档
   * 落到末端焦点上，见下）。
   *
   * 口径（用户要求）：**箭头保持拖拽预演那条，一点都不能变**，但**绑定方式照旧**
   * ——该吸附轮廓、该带 binding gap 就照旧。所以能动的只有**补偿**（图形位置或末端焦点）：
   * 把 gap 算进去。
   *
   * 为什么平移图形即可精确抵消：
   * 1. 落地时 `bindBindingElement(..., focusPoint = 松手点 P)` 走
   *    `projectPointOntoBoundElementOutline`（轮廓交点 + 一个 binding gap，
   *    `BASE_BINDING_GAP` 再加 `getBindingGap(...)`，随线宽），登记成
   *    `endBinding.attachPoint`；
   * 2. 端点最后由 `updateBoundPoint` 还原，它是**纯刚性**的：`attachPoint` 建连时
   *    定死，此后只随图形平移 / 缩放 / 旋转，不再求交、也不再依赖另一端（见
   *    `binding.ts` 里它的说明）。折线档同理：末端由 `updateElbowArrowPoints` 从同一
   *    批锚点推出，锚点随图形平移、端点也就跟着平移。所以**图形平移多少，端点就
   *    跟着平移多少**；
   * 3. 于是先在图形位于 `placement.target`（轮廓恰好过 P，也就是拖拽预演的口径）时
   *    算出「落地会得到的端点」E，再按补偿 `delta = P − E` 落实（直线 / 折线档把图形
   *    整体平移 `delta`）——落地端点正好回到 P，而连线的几何（入口就是 P 的那条
   *    预演连线）一点没动。
   *
   * 补偿如何落实（返回值里的 `curved` 只决定**要不要多补一步焦点**，判据取与
   * `binding.ts:1747` 的末端分叉**同一个** `isCurvedArrow`）：
   * - **图形位置一律外移 `delta`**（三档都做）：轮廓让到松手点之外一个 gap 处，箭头
   *   末端才停在松手点上、且与轮廓之间留出正常的 binding gap；
   * - **圆角曲线档再多补一步**：它的端点按「焦点 + 所依附边的外法线 × gap」算
   *   （`projectPointOntoBoundElementOutline` 的曲线分支），**只看焦点与那条边的
   *   法线、与图形位置无关** → 光挪图形末端一动不动（会留在轮廓上、零间隙），
   *   得把**同一个 `delta`** 再加到末端**焦点**上：`end = (P + delta) + gap·n`，
   *   代入 `delta = P − E = −gap·n` 得 `end = P`。
   *   直线 / 折线档不需要这一步：它们的端点随图形刚性平移，挪图形就够了。
   *
   * E 由**预演那套纯函数**探针给出：`buildConnectorArrow` 走的就是 `getPreviewBindings`
   * + `projectPreviewEndpoints`（折线档还跑 `routePreviewElbowArrow` 同一套路由），
   * 与落地逐位同源（见那里的说明），所以这里不进场景、不插任何东西。
   *
   * 探针副本用固定身份装配（同 `GHOST_ARROW_IDENTITY` 的约定）：它不入场景，却会
   * 消耗共享的 id / 随机序列，用真身份会让随后真实落地那份的身份整体后移。
   */
  private probeLandingEndOffset = (
    source: NonDeletedExcalidrawElement,
    spec: CreationSpec,
    // 拖拽落位的几何（`getQuickCreateDragPlacement` 的返回值：只有 target 与 connector，
    // 不带 sourceId），补上源的 id 就是一次完整的落位（`buildConnectorArrow` 起端要用它）
    geometry: Omit<QuickCreatePlacement, "sourceId">,
    pointer: QuickCreatePoint,
  ): { delta: QuickCreatePoint; curved: boolean } => {
    const placement: QuickCreatePlacement = {
      sourceId: source.id,
      ...geometry,
    };
    const probeShape = this.applySourceStyle(
      source,
      buildPresetElementsCentered(
        this.app,
        spec,
        placement.target,
        GHOST_SHAPE_IDENTITY,
      ).elements[0],
    );
    const probe = this.buildConnectorArrow(placement, {
      endTarget: { kind: "ghost", element: probeShape },
    });
    // 取探针末端的世界坐标（要含探针图形的元素表：解析它的绑定时会查它）。
    // `GlobalPoint` 是 `[x, y]` 元组，不是 `{ x, y }`。
    const end = LinearElementEditor.getPointAtIndexGlobalCoordinates(
      probe,
      -1,
      this.getPreviewElementsMap({ kind: "ghost", element: probeShape }),
    );
    return {
      delta: { x: pointer.x - end[0], y: pointer.y - end[1] },
      // 判据与 `binding.ts:1747` 同一支：探针箭头就是落地那条的元素，直接问它
      curved: isCurvedArrow(probe),
    };
  };

  /**
   * 面板里选了图形：装配所选图形 + 连线，**一步撤销**。
   *
   * 落点仍由 `getQuickCreateDragPlacement`（与拖拽预演同一个）给出，**连线几何完全
   * 不动**（入口就是松手点 P）；补偿 `delta = P − E`（见 `probeLandingEndOffset`）：图形
   * 位置一律外移 `delta` 让出 binding gap，圆角曲线档再多补一次末端**焦点**（它的端点与
   * 图形位置无关，见那里）。三档末端因此都回到松手点，且都与轮廓留着一个 gap。
   * 装配走 `buildPresetElementsCentered`（与抽屉同一条链路，含画框归属）。
   *
   * **绝不 `setActiveTool`、绝不写 `preferredGenericShape`**：与 `presetPlacement` 的
   * 既有约定一致，弹窗起点与工具栏当前工具脱钩。
   */
  createConnectorAndShape = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
    pointer: QuickCreatePoint,
    item: PresetCatalogItem,
  ): void => {
    const spec = item.creation;
    // 两组目录（basic / flowchart）的条目全是 shape，别的 kind 不作数
    if (spec.kind !== "shape") {
      return;
    }
    // 尺寸取**所选图形自己的预设**（`getPresetSize` 与抽屉、预览同源），不是
    // `PRESET_SIZES[spec.tool]` —— 后者只覆盖便签/画框这类按工具定尺寸的预设，
    // 图形预设的尺寸按 shape id 区分（见 `components/shapePresetDefaults.ts`）。
    // 落位间隙算的就是这个 size，落地那条又走 `buildPresetElementsCentered` →
    // 同一个解析，两边必须同源，否则图形会与箭头末端错开。
    const size = getPresetSize(spec.tool, spec.shapeId, {
      width: source.width,
      height: source.height,
    });
    const placement = getQuickCreateDragPlacement(
      this.getSourceGeometry(source),
      direction,
      pointer,
      size,
    );
    // 只补偿、不动连线几何：先量出 `delta = P − E`，再按线型分两支落实。
    // - **图形位置一律外移 `delta`**：轮廓让到松手点之外一个 gap 处，箭头末端才停在
    //   松手点上、且与轮廓之间留出正常的 binding gap（三档视觉一致）；
    // - 圆角曲线档**再多一步**：它的端点由「焦点 + 所依附边的外法线 × gap」定、
    //   **与图形位置无关**（`binding.ts:1747`），光挪图形末端会一动不动地留在原处
    //   （于是插进图形里、零间隙），所以要把**同一个 delta** 再加到末端**焦点**上。
    const { delta, curved } = this.probeLandingEndOffset(
      source,
      spec,
      placement,
      pointer,
    );
    const target = {
      x: placement.target.x + delta.x,
      y: placement.target.y + delta.y,
    };
    const built = buildPresetElementsCentered(this.app, spec, target);
    const shape = this.applySourceStyle(source, built.elements[0]);
    // **落地必须沿用预演这条连线，不能重算**：预演的入口是「出口 → 松手点」这条
    // 射线与轮廓的交点（`getQuickCreateDragPlacement`），而 `getQuickCreateConnector`
    // 取的是图形**轴向中线**（左右手柄取水平中线）与轮廓的交点——两者不是同一个点，
    // 重算会让箭头落点跳向、方向一转，肉眼看得见。连线的几何仍是预演那个 `target` /
    // `connector`（`delta` 只进补偿：图形位置或末端焦点，都不进连线几何）。
    const arrow = this.buildConnectorArrow({
      sourceId: source.id,
      target: placement.target,
      connector: placement.connector,
    });
    // 与老路径同序：连线在下、图形压在上面。**插入的是盖过样式的那一份**——
    // `applySourceStyle` 返回新对象，插装配原件等于「样式跟随源」没生效。
    this.app.insertNewElements([arrow, shape]);
    // 绑定照旧：锚点仍取几何解出来的出口 / 入口，与预演那条逐位一致
    bindBindingElement(
      arrow,
      source as NonDeleted<ExcalidrawBindableElement>,
      "start",
      this.app.scene,
      pointFrom<GlobalPoint>(
        placement.connector.exit.x,
        placement.connector.exit.y,
      ),
    );
    bindBindingElement(
      arrow,
      shape as NonDeleted<ExcalidrawBindableElement>,
      "end",
      this.app.scene,
      pointFrom<GlobalPoint>(
        // 末端焦点：曲线档把 delta 也加在焦点上（它的端点只看焦点与边法线，图形位置
        // 挪了也拉不回来），其余档焦点就是松手点（位移已经加在图形位置上）。
        // 拖拽落位的 `connector.entry` 本就等于松手点。
        curved ? pointer.x + delta.x : pointer.x,
        curved ? pointer.y + delta.y : pointer.y,
      ),
    );
    // 两端照旧投影（与 `createConnectedShape` 同口径）：末端带 binding gap 是仓库
    // 统一口径，末端最终落在哪已由补偿 `delta` 抵消回松手点（见 `probeLandingEndOffset`）
    if (arrow.points.length === 2) {
      this.projectArrowEndpoints(arrow);
    }
    this.app.setState({
      selectedElementIds: { [shape.id]: true },
      selectedGroupIds: {},
      selectedLinearElement: null,
      hoveredElementIds: {},
      editingGroupId: null,
    });
    // 连线 + 图形同一次插入，一步可撤销
    this.app.store.scheduleCapture();
  };

  /**
   * 源样式覆盖：把源的描边色 / 填充色 / 填充样式 / 描边粗细 / 描边线型 / 透明度 /
   * 角度照抄到新图形上（口径「新图形跟随源」）。**不碰圆角**——本 fork 复合矩形刻意
   * 直角，圆角只由所选图形自己的 `shape.id` 决定（见 `shape.ts` 的 mindmap-node 分支）。
   *
   * 返回的是**新对象**（id 不变），所以调用方必须插这一份、不能插装配原件。
   * 泛型只为保住入参的元素类型（装配结果是 `ExcalidrawNonSelectionElement`），
   * 否则 `insertNewElements` 收不下。
   */
  private applySourceStyle = <TElement extends NonDeletedExcalidrawElement>(
    source: NonDeletedExcalidrawElement,
    element: TElement,
  ): TElement =>
    ({
      ...element,
      strokeColor: source.strokeColor,
      backgroundColor: source.backgroundColor,
      fillStyle: source.fillStyle,
      strokeWidth: source.strokeWidth,
      strokeStyle: source.strokeStyle,
      opacity: source.opacity,
      angle: source.angle,
    } as TElement);

  /**
   * 拖到空白松手：先不落地，弹出「插入图形」面板。面板定位用 pointerup 的客户区坐标
   * 减容器偏移（同 `contextMenu.ts` 的既有做法）；分组由源图形的 `shape.id` 推出
   * （`fc-*` → flowchart，其余 → basic）。面板要读的最小信息同时镜像进 appState。
   */
  private openInsertMenu = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
    pointer: QuickCreatePoint,
    event: PointerEvent,
  ): void => {
    if (!isShapeElement(source)) {
      return;
    }
    const container = this.app.excalidrawContainerRef.current;
    const { top: offsetTop, left: offsetLeft } = container
      ? container.getBoundingClientRect()
      : { top: 0, left: 0 };
    const screenPoint = {
      top: event.clientY - offsetTop,
      left: event.clientX - offsetLeft,
    };
    const groupId: PresetCatalogGroupId = isSequenceShapeId(source.shape.id)
      ? "sequence"
      : isFlowchartShapeId(source.shape.id)
      ? "flowchart"
      : "basic";
    this.pendingInsert = {
      sourceId: source.id,
      direction,
      pointer,
      screenPoint,
      groupId,
    };
    this.pendingGhost = null;
    this.app.setState({
      quickCreateMenu: {
        top: screenPoint.top,
        left: screenPoint.left,
        groupId,
      },
    });
    this.app.repaint.request();
  };

  /**
   * 待决连线的预演（渲染层在待决期间画它）：末端自由、落在松手点。缓存口径同 `ghost`
   * ——面板开着时渲染层每帧来取一遍，不能每帧新建对象。
   */
  getPendingElements = (): readonly NonDeletedExcalidrawElement[] => {
    const pending = this.pendingInsert;
    if (!pending) {
      return [];
    }
    const source = this.app.scene.getNonDeletedElement(pending.sourceId);
    if (!source || !isShapeElement(source)) {
      return [];
    }
    const key = [
      pending.sourceId,
      source.version,
      pending.direction,
      this.getArrowStyleFingerprint(),
      pending.pointer.x,
      pending.pointer.y,
    ].join("|");
    if (this.pendingGhost?.key !== key) {
      const placement = this.resolveDragPlacement(
        source,
        pending.direction,
        pending.pointer,
      );
      this.pendingGhost = {
        key,
        elements: [
          this.buildConnectorArrow(placement, {
            opacityScale: QUICK_CREATE_GHOST_ALPHA,
            identity: GHOST_ARROW_IDENTITY,
            endTarget: null,
          }),
        ],
      };
    }
    return this.pendingGhost.elements;
  };

  /**
   * 面板里点了某个图形：落地那条**待决连线 + 所选图形**。先关面板、清待决，再从场景
   * 重新取源——待决期间源被撤销/删除（或取不到目录条目）就作废，别把用户那次拖拽吞掉。
   */
  commitPendingInsert = (itemId: string): void => {
    const pending = this.takePendingInsert();
    if (!pending) {
      return;
    }
    const source = this.app.scene.getNonDeletedElement(pending.sourceId);
    if (!source || !isShapeElement(source)) {
      this.app.repaint.request();
      return;
    }
    const item = getCatalogItem(itemId);
    if (item && item.creation.kind === "shape") {
      this.createConnectorAndShape(
        source,
        pending.direction,
        pending.pointer,
        item,
      );
    } else {
      // 条目取不到（不该发生）→ 退化成只落连线，别把用户那次拖拽一起吞掉
      this.createConnectorOnly(
        source,
        pending.direction,
        pending.pointer,
        null,
      );
    }
    this.app.repaint.request();
  };

  /**
   * 面板未选就关闭（Esc / 点面板外）：**保留连线**（用户口径），末端自由落在松手点，
   * 一步撤销。与提交共用收口——差别只是「要不要多建一个图形」。
   */
  cancelPendingInsert = (): void => {
    const pending = this.takePendingInsert();
    if (!pending) {
      return;
    }
    const source = this.app.scene.getNonDeletedElement(pending.sourceId);
    if (!source || !isShapeElement(source)) {
      this.app.repaint.request();
      return;
    }
    this.createConnectorOnly(source, pending.direction, pending.pointer, null);
    this.app.repaint.request();
  };

  /**
   * 关面板 + 清待决（**幂等**）：提交/取消共用，也供面板外 pointerdown 收口——重复
   * 调用第二次拿到 null 直接返回。取回待决是为了让调用方接着走落地分支。
   */
  private takePendingInsert = (): QuickCreatePending | null => {
    const pending = this.pendingInsert;
    this.pendingInsert = null;
    this.pendingGhost = null;
    if (this.app.state.quickCreateMenu) {
      this.app.setState({ quickCreateMenu: null });
    }
    return pending;
  };
}
