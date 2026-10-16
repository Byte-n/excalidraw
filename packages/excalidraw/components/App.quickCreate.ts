import { CURSOR_TYPE } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import {
  LinearElementEditor,
  bindBindingElement,
  calculateFixedPointForNonElbowArrowBinding,
  duplicateElement,
  getContainingFrame,
  getElementAbsoluteCoords,
  getElementWithTransformHandleType,
  getQuickCreateConnector,
  getQuickCreateHandles,
  getQuickCreateResolvedTargetCenter,
  getQuickCreateTargetElement,
  getTransformHandles,
  hitTestQuickCreateHandle,
  isBindableElement,
  isCompositeShapeElement,
  isFrameLikeElement,
  isLinearElement,
  newArrowElement,
  updateBoundPoint,
  QUICK_CREATE_GHOST_ALPHA,
} from "@excalidraw/element";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import type {
  ElementsMap,
  ExcalidrawBindableElement,
  ExcalidrawCompositeShapeElement,
  ExcalidrawLinearElement,
  FixedPointBinding,
  NonDeleted,
  NonDeletedExcalidrawElement,
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

import type { CreationIdentity } from "./app/createPresets";

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
 * 方向手柄：单选图形时在指示框四边外侧显示圆点，悬停换加号，点击在对应方向
 * 生成同款副本并用当前连接线样式连一条线。形态对齐 `App.mindmap.ts` 的
 * 「+」按钮：悬停只改字形与光标，按下即建且吞掉本次手势。
 */
export class AppQuickCreate {
  private hovered: {
    direction: QuickCreateDirection;
    elementId: string;
  } | null = null;

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

  constructor(private readonly app: App) {}

  getHovered = () => this.hovered;

  isSuppressed = (): boolean => this.modifierHeld;

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
      this.modifierHeld,
    );

  handlePointerMove = (sceneX: number, sceneY: number) => {
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

  /** 命中方向手柄则消费本次手势并立即建图；返回 true 时调用方须提前 return。 */
  preparePointerDown = (
    pointerDownState: PointerDownState,
    event: React.PointerEvent<HTMLElement>,
  ): boolean => {
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
    this.createConnectedShape(source, hit.direction);
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
   * 悬停预演的两个元素：幽灵副本 + 幽灵连线。只用于绘制——不进 scene、不进
   * store、不进历史，协作端看不到；身份固定，不消耗共享的 id / 随机序列。
   *
   * 几何取自与 `createConnectedShape` 同一套函数、样式原样照抄源图形与当前
   * 连接线，渲染层用 `renderElement` 画，所以看到的线条、箭头、填充就是落地
   * 之后的样子，只有不透明度不同（`QUICK_CREATE_GHOST_ALPHA`）。
   */
  getGhostElements = (
    handle: QuickCreateHandle,
  ): readonly NonDeletedExcalidrawElement[] => {
    const source = getQuickCreateTargetElement(this.app);
    if (!source || !isCompositeShapeElement(source)) {
      return [];
    }
    const placement = this.resolvePlacement(source, handle.direction);
    const key = [
      source.id,
      source.version,
      handle.direction,
      this.getArrowStyleFingerprint(),
      // 落点还取决于场上别的图形：基准位被占时副本会沿绝对轴让位，所以解出来的
      // 目标位置也进缓存键——不然场景一变（别的图形挪过来/挪走）还会画着上一帧
      // 的旧落点与旧折线。
      placement.target.x,
      placement.target.y,
    ].join("|");
    if (this.ghost?.key !== key) {
      this.ghost = {
        key,
        elements: this.buildGhostElements(source, handle.direction, placement),
      };
    }
    return this.ghost.elements;
  };

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
   * 落点与连线的**唯一**来源：悬停预演与真实创建都从这里取几何，所见即所得。
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
    const sourceBounds = getElementAbsoluteCoords(source, elementsMap);
    const geometry: QuickCreateSourceGeometry = {
      center: {
        x: (sourceBounds[0] + sourceBounds[2]) / 2,
        y: (sourceBounds[1] + sourceBounds[3]) / 2,
      },
      angle: source.angle,
      width: source.width,
      height: source.height,
    };
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

  private buildGhostElements = (
    source: NonDeleted<ExcalidrawCompositeShapeElement>,
    direction: QuickCreateDirection,
    placement: QuickCreatePlacement,
  ): readonly NonDeletedExcalidrawElement[] => {
    const ghostShape = this.buildGhostShape(source, placement.target);
    return [
      ghostShape,
      this.buildConnectorArrow(placement, {
        opacityScale: QUICK_CREATE_GHOST_ALPHA,
        identity: GHOST_ARROW_IDENTITY,
        foldElbowRoute: true,
        ghostShape,
      }),
    ];
  };

  /** 幽灵副本：与 `cloneShape` 同款（清掉分组/绑定/容器归属），只压暗一半 */
  private buildGhostShape = (
    source: NonDeleted<ExcalidrawCompositeShapeElement>,
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
    } as NonDeleted<ExcalidrawCompositeShapeElement>);

  /**
   * 连线：把几何解出来的路径按**当前线样式**落成箭头的 x/y 与 points
   * （points 是相对 x/y 的局部坐标，与画布上拖拽建的箭头同一套约定）。
   *
   * - 出口与副本在出线轴上对齐（没让位、源也没转）：两点直线，三种样式都是
   *   老行为。
   * - 错开 + 折线（sharp）：直接用四个拐点 [A, B, C, D]，`roundness` 为 null、
   *   不 elbowed → 画出来就是直角折线（roundness 非 null 会被画成圆角拐弯，
   *   偏 13 个场景单位）。
   * - 错开 + 圆角曲线（round）：**恒为两点** [出口, 入口]（错开时的拐点不塞进
   *   points）。弯曲几何完全归 `element/curveConnector.ts`——它按「圆角 + 非折线」
   *   收下所有箭头，这里只负责把这条箭头建出来，创建路径一个弯曲几何都不算；
   *   两端对齐时几何自然退化成直线。
   * - 错开 + 折线箭头（elbow）：**不塞我们的拐点**，仍旧给两点 + `elbowed`，
   *   交给内置正交路由自己布线（老行为）。预演没有绑定可依、路由跑不起来，
   *   所以预演改为直接拿同一套拐点画折线（`foldElbowRoute`）——渲染层对 elbowed
   *   箭头做的就是「把折角磨圆」，与落地后路由算出的那条直角线形状一致。
   */
  private buildConnectorArrow = (
    placement: QuickCreatePlacement,
    options: {
      opacityScale?: number;
      identity?: CreationIdentity;
      /** 预演专用：折线箭头也按拐点画，避免画成一条斜直线 */
      foldElbowRoute?: boolean;
      /** 预演副本元素：端绑定的锚点按它的轮廓算，与落地写进副本的固定点同源 */
      ghostShape?: NonDeletedExcalidrawElement;
    } = {},
  ): NonDeleted<ExcalidrawLinearElement> => {
    const { connector } = placement;
    const arrowProps = getCurrentItemArrowProps(this.app);
    const { exit, bend, entry } = connector;
    const fold =
      bend && (options.foldElbowRoute || !arrowProps.elbowed) ? bend : null;
    const rounded = !!arrowProps.roundness;
    // 出口就是箭头的起点（x/y），所以这里只列**起点之后**的点。圆角样式恒为两点：
    // 弯曲几何留给渲染期推导，创建路径不碰它。
    const tail: QuickCreatePoint[] =
      fold && !rounded ? [...fold, entry] : [entry];
    const created = newArrowElement({
      type: "arrow",
      x: exit.x,
      y: exit.y,
      ...arrowProps,
      points: [
        pointFrom<LocalPoint>(0, 0),
        ...tail.map((point) =>
          pointFrom<LocalPoint>(point.x - exit.x, point.y - exit.y),
        ),
      ],
      ...(options.opacityScale === undefined
        ? {}
        : { opacity: arrowProps.opacity * options.opacityScale }),
      ...options.identity,
    });
    const arrow: NonDeleted<ExcalidrawLinearElement> = created;
    if (!options.ghostShape) {
      return arrow;
    }
    // 预演元素不在场景里、没有绑定：补上与落地 `bindBindingElement` 写进去的
    // 同源固定点（口径同 `binding.fixedPoint`）。渲染期正是读它解端切线、决定该端
    // 贴在哪条边、曲线朝哪弯，缺了会退回弦主轴、画出错的轴向。
    const bound: NonDeleted<ExcalidrawLinearElement> = {
      ...arrow,
      ...this.getPreviewBindings(placement, arrow, options.ghostShape),
    };
    // 再按与落地 `reflowArrowEndpoints` 同一个函数把两端落到轮廓上。条件也跟落地
    // 同一口径（只有两点连线会 reflow）：折线样式错开时点数是 4，落地只写绑定、
    // 不动点位，预演照做才逐点一致。
    return arrow.points.length === 2
      ? this.projectPreviewEndpoints(bound, options.ghostShape)
      : bound;
  };

  /**
   * 预演专用：把两端按**与落地 `reflowArrowEndpoints` 同一个** `updateBoundPoint`
   * 落到轮廓上（`updateBoundPoint` 是纯函数，返回元素局部坐标点）。预演元素不在
   * 场景里，没法走落地那条 `movePoints`，所以这里只把返回的点写回元素本身。
   * 副本要临时塞进 map：`updateBoundPoint` 解析另一端的绑定时会查它。
   */
  private projectPreviewEndpoints = (
    arrow: NonDeleted<ExcalidrawLinearElement>,
    ghostShape: NonDeletedExcalidrawElement,
  ): NonDeleted<ExcalidrawLinearElement> => {
    const elementsMap: ElementsMap = new Map(
      this.app.scene.getNonDeletedElementsMap(),
    );
    elementsMap.set(ghostShape.id, ghostShape);
    const points = arrow.points.map((p) => pointFrom<LocalPoint>(p[0], p[1]));
    for (const field of ["startBinding", "endBinding"] as const) {
      const binding = arrow[field];
      const target = binding && elementsMap.get(binding.elementId);
      if (binding && target && isBindableElement(target)) {
        const point = updateBoundPoint(
          arrow,
          field,
          binding,
          target,
          elementsMap,
        );
        if (point) {
          points[field === "startBinding" ? 0 : points.length - 1] = point;
        }
      }
    }
    // 与落地 `movePoints` 同款归位：端点的元素局部不变量是 points[0] 恒为 [0,0]，
    // 所以把投影后的起点搬回原点、元素 x/y 反向平移（场景位置不变）
    const [offsetX, offsetY] = points[0];
    return {
      ...arrow,
      x: arrow.x + offsetX,
      y: arrow.y + offsetY,
      points: points.map((p) =>
        pointFrom<LocalPoint>(p[0] - offsetX, p[1] - offsetY),
      ),
    };
  };

  /**
   * 预演连线的等效绑定：附着点的归一化盒坐标。用与落地 `bindBindingElement` 内部
   * **同一个**函数算（传出口 / 入口当 `focusPoint`），两边因此逐位一致；该函数在
   * 给定 `focusPoint` 时不读 `elementsMap`，这里按签名照传。
   */
  private getPreviewBindings = (
    placement: QuickCreatePlacement,
    arrow: NonDeleted<ExcalidrawLinearElement>,
    ghostShape: NonDeletedExcalidrawElement,
  ): {
    startBinding: FixedPointBinding | null;
    endBinding: FixedPointBinding | null;
  } => {
    const { sourceId, connector } = placement;
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const source = this.app.scene.getNonDeletedElement(sourceId);
    return {
      startBinding:
        source && isBindableElement(source)
          ? {
              elementId: sourceId,
              mode: "orbit" as const,
              ...calculateFixedPointForNonElbowArrowBinding(
                arrow,
                source,
                "start",
                elementsMap,
                pointFrom<GlobalPoint>(connector.exit.x, connector.exit.y),
              ),
            }
          : null,
      endBinding: isBindableElement(ghostShape)
        ? {
            elementId: QUICK_CREATE_GHOST_SHAPE_ID,
            mode: "orbit" as const,
            ...calculateFixedPointForNonElbowArrowBinding(
              arrow,
              ghostShape,
              "end",
              elementsMap,
              pointFrom<GlobalPoint>(connector.entry.x, connector.entry.y),
            ),
          }
        : null,
    };
  };

  /**
   * 副本 = 除文字外完全一致（同 shape.id/宽高/角度/圆角/样式与 shape 配置），
   * 只换新 id/seed/version，并清掉原图形的绑定、分组与容器归属。
   * 连线先插入，图形压在上面；两者同一次捕获，撤销一步同时移除。
   */
  createConnectedShape = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
  ) => {
    const placement = this.resolvePlacement(source, direction);
    const clone = this.cloneShape(
      source,
      placement.target.x,
      placement.target.y,
    );
    const arrow = this.buildConnectorArrow(placement);

    this.app.insertNewElements([arrow, clone]);
    // 两端绑定的**锚点**（决定该端贴在哪条边、曲线朝哪弯）用几何解出来的出口 /
    // 入口：这里显式传 `focusPoint`，落地写进 `fixedPoint` 的值因此与预演逐位一致
    // （预演走的是同一个函数）。创建路径的端点本来就落在出口 / 入口上，显式传是
    // 把「锚点取这里」写成明确意图，不改变结果。
    bindBindingElement(
      arrow,
      source as NonDeleted<ExcalidrawBindableElement>,
      "orbit",
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
      "orbit",
      "end",
      this.app.scene,
      pointFrom<GlobalPoint>(
        placement.connector.entry.x,
        placement.connector.entry.y,
      ),
    );
    // 两点连线（直线、圆角连接线，以及交给内置正交路由的折线箭头）按 orbit 绑定
    // 把两端落到图形轮廓上；折线样式的端点**已经**按几何落在两个轮廓上（入口就是
    // 副本轮廓的轴向交点），不能再来一次：reflow 只会沿「副本中心 → 倒数第二个点」
    // 这条射线求交点——对折线来说是错的那条射线，会把入口从轮廓上拽走，旋转副本
    // 尤其明显。圆角连接线现在恒为两点，走的就是这条 reflow。
    if (arrow.points.length === 2) {
      this.reflowArrowEndpoints(arrow);
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
  ): NonDeleted<ExcalidrawCompositeShapeElement> => {
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
    } as NonDeleted<ExcalidrawCompositeShapeElement>;
  };

  /** 按已建立的绑定把两端落到图形轮廓上，弹头才不会藏在图形下面。 */
  private reflowArrowEndpoints = (
    arrow: NonDeleted<ExcalidrawLinearElement>,
  ) => {
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const updates: PointsPositionUpdates = new Map();
    for (const field of ["startBinding", "endBinding"] as const) {
      const binding = arrow[field];
      const target = binding && elementsMap.get(binding.elementId);
      if (binding && target && isBindableElement(target)) {
        const point = updateBoundPoint(
          arrow,
          field,
          binding,
          target,
          elementsMap,
        );
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
}
