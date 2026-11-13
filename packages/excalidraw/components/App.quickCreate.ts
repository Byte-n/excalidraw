import { KEYS } from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import {
  LinearElementEditor,
  bindBindingElement,
  calculateAttachPointForElbowArrowBinding,
  resolveAttachPointForNonElbowBinding,
  duplicateElement,
  getActivationAnchor,
  getBindingGap,
  getContainingFrame,
  getElementAbsoluteCoords,
  getQuickCreateConnector,
  getQuickCreateDragPlacement,
  getQuickCreateHandles,
  getQuickCreateResolvedTargetCenter,
  getQuickCreateTargetElement,
  getSequenceLifelineActivationCenter,
  getSequenceLifelineGlobalPoint,
  getSequenceLifelineLocalPoint,
  getSequenceMessageAxis,
  getSequenceMessageAxisFromAnchor,
  constrainSequenceMessagePoint,
  findSequenceMessageTarget,
  getTransformHandles,
  SEQUENCE_ACTIVATION_HEIGHT,
  SEQUENCE_ACTIVATION_WIDTH,
  SEQUENCE_HIT_HALF_WIDTH,
  SEQUENCE_MIN_ACTIVATION_OFFSET,
  hitTestQuickCreateHandle,
  isActivationElement,
  isBindableElement,
  isPointOnSequenceLifelinePole,
  isSequenceLifelineElement,
  isShapeElement,
  isCurvedArrow,
  isElbowArrow,
  isFrameLikeElement,
  isLinearElement,
  newArrowElement,
  syncLifelineBoundActivation,
  updateBoundPoint,
  updateElbowArrowPoints,
  QUICK_CREATE_GHOST_ALPHA,
} from "@excalidraw/element";

import type { GlobalPoint, LocalPoint, Radians } from "@excalidraw/math";

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
  SequenceActivationElement,
  SequenceLifelineElement,
  SequenceMessageAxis,
  NonElbowLandingOpts,
} from "@excalidraw/element";

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
import { hasFrameMoved } from "./app/pointerFrame";
import { getStrictTopmostElementAt } from "./app/pointerQuickCreate";
import { getCatalogItem, isFlowchartShapeId } from "./presetCatalog";

import type { CreationIdentity } from "./app/createPresets";
import type { PointerFrame } from "./app/pointerFrame";
import type {
  CreationSpec,
  PresetCatalogGroupId,
  PresetCatalogItem,
} from "./presetCatalog";

import type { NullableGridSize, PointerDownState } from "../types";

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
/** 生命线杆上悬停预演的激活条身份，口径同上（不推进共享 id / 随机序列） */
export const QUICK_CREATE_POLE_GHOST_ID =
  "preview:quick-create:pole-activation";

/** 激活条装配说明：与图形抽屉里的 `sc-activation` 同一个预设 */
const ACTIVATION_CREATION_SPEC: Extract<CreationSpec, { kind: "shape" }> = {
  kind: "shape",
  tool: "rectangle",
  shapeId: "sc-activation",
};

const POLE_GHOST_IDENTITY: CreationIdentity = {
  id: QUICK_CREATE_POLE_GHOST_ID,
  seed: 1,
};

/**
 * 激活条左右两侧的「动态连接点」：
 *
 * - 指针靠近（屏幕 px）左 / 右边缘就出点，点始终贴在边上、y 跟指针走；
 * - 按住连接点拖拽即建消息，拖拽全程有预演；
 * - 终点落在**起点所在的激活条**上时画折线（自消息），落在其它激活条上是水平
 *   直线，没落在任何激活条上时保持水平延伸、按预演落地。
 */
/** 起点所在激活条的纵向死区（屏幕 px）：太靠近起点时不判定为自消息终点 */
export const SEQUENCE_CONNECTION_MIN_SELF_GAP = 12;
/** 自消息向外绕出的横向距离（场景 px） */
export const SEQUENCE_SELF_MESSAGE_OFFSET = 24;

type SequenceConnectionSide = "left" | "right";

/** 一次进行中的连接线拖拽 */
type SequenceConnectionDrag = {
  elementId: string;
  side: SequenceConnectionSide;
  /** 起端（场景坐标，落在激活条边缘上） */
  exit: QuickCreatePoint;
  /** 起端在激活条本地坐标里的 y，自消息的纵向死区用它 */
  startLocalY: number;
  /** 按下点（场景坐标），判拖拽阈值用 */
  origin: QuickCreatePoint;
  /** 当前指针（场景坐标） */
  pointer: QuickCreatePoint;
  /** 是否已越过拖拽阈值（屏幕 px） */
  moved: boolean;
};

/**
 * 消息落在一根没有可连激活条的杆上：要新建的激活条 + 新条朝向消息源的竖边。
 * 三条创建 / 编辑路径共用这一份落位（`edge` 是不含 binding gap 的边点，
 * `entry` 是箭头端点应落的位置）。
 */
type SequencePoleDrop = {
  lifelineId: string;
  /** 新条中心在生命线本地坐标里的 y */
  localY: number;
  center: QuickCreatePoint;
  angle: Radians;
  /** 新条朝向源的竖边（场景坐标） */
  edge: QuickCreatePoint;
  /** 箭头端点（`edge` 再让出一个 binding gap） */
  entry: QuickCreatePoint;
  /** 该竖边朝外的世界方向 */
  outward: { x: number; y: number };
};

/** 既有箭头端点拖拽时，杆上建条的预演 */
type SequenceEndpointPreview = {
  key: string;
  elements: readonly NonDeletedExcalidrawElement[];
  dropPoint: QuickCreatePoint | null;
};

/**
 * 连接线的一次落位解：锚点是**激活条边缘上**的原始点（绑定时当焦点用），
 * `points` 是已经让出 binding gap、可直接画出来的折线点。
 */
type SequenceMessagePlacement = {
  kind: "self" | "activation" | "pole-activation" | "free";
  /** `activation` 档的目标激活条 id */
  targetElementId?: string;
  /** `pole-activation` 档：落点在杆上，松手时要先新建的激活条 */
  poleActivation?: SequencePoleDrop;
  anchors: { start: QuickCreatePoint; end: QuickCreatePoint };
  points: QuickCreatePoint[];
};

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

/** 生命线杆上的激活条预演：中心已按杆夹取、并随生命线旋转 */
type PoleActivationHover = {
  lifelineId: string;
  /** Activation center y in the lifeline's local frame (clamped to the pole) */
  localY: number;
  center: QuickCreatePoint;
  angle: Radians;
};

/**
 * 杆上的一次待决点击。按下时只臂化、不创建：越过拖拽阈值就说明用户是在拖
 * 生命线（P2 语义），抬起时按距离判定。
 */
type PoleActivationClick = PoleActivationHover & {
  origin: QuickCreatePoint;
};

/**
 * 方向手柄：单选图形时在指示框四边外侧显示圆点，悬停换加号，**按下后拖拽**在
 * 指针处生成同款副本并用当前连接线样式连一条线（不拖直接松手则是老行为：建在
 * 让位后的落点）。形态对齐 `App.mindmap.ts` 的「+」按钮：悬停只改字形与光标。
 */
export class AppQuickCreate {
  /** 杆预演的缓存，口径同 `ghost`（渲染层每帧来取） */
  private poleActivationGhost: {
    key: string;
    elements: readonly NonDeletedExcalidrawElement[];
  } | null = null;

  /** 连接线预演的缓存，口径同 `ghost` */
  private sequenceConnectionGhost: {
    key: string;
    elements: readonly NonDeletedExcalidrawElement[];
  } | null = null;

  /**
   * 既有箭头端点拖拽 / 箭头工具建线时的杆上建条预演。与连接点拖拽共用同一份
   * 消息策略（轴、目标、杆上落位），只是入口不同。
   */
  private sequenceEndpointPreview: SequenceEndpointPreview | null = null;

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

  /** Frame-derived views: the frame is the only gesture/hover state (PR4b). */
  private getHandleGesture(
    frame: PointerFrame | null = this.app.pointer.getFrame(),
  ): QuickCreateDrag | null {
    if (
      !frame ||
      frame.owner !== "quickCreate" ||
      frame.target.kind !== "quickCreateHandle"
    ) {
      return null;
    }
    const origin = frame.origin ?? frame.point;
    return {
      direction: frame.target.direction,
      elementId: frame.target.elementId,
      origin: { x: origin[0], y: origin[1] },
      pointer: { x: frame.point[0], y: frame.point[1] },
      moved: hasFrameMoved(frame, this.app.state.zoom.value),
    };
  }

  private getMessageGesture(
    frame: PointerFrame | null = this.app.pointer.getFrame(),
  ): SequenceConnectionDrag | null {
    if (
      !frame ||
      frame.owner !== "sequenceMessage" ||
      frame.target.kind !== "activationEdge"
    ) {
      return null;
    }
    const source = this.app.scene.getNonDeletedElement(frame.target.elementId);
    if (!source || !isActivationElement(source)) {
      return null;
    }
    const origin = frame.origin ?? frame.point;
    const local = getSequenceLifelineLocalPoint(source, origin[0], origin[1]);
    return {
      elementId: source.id,
      side: frame.target.side,
      exit: { x: frame.target.point[0], y: frame.target.point[1] },
      startLocalY: Math.min(Math.max(local.y, 1), source.height - 1),
      origin: { x: origin[0], y: origin[1] },
      pointer: { x: frame.point[0], y: frame.point[1] },
      moved: hasFrameMoved(frame, this.app.state.zoom.value),
    };
  }

  private getPoleClick(
    frame: PointerFrame | null = this.app.pointer.getFrame(),
  ): PoleActivationClick | null {
    if (
      !frame ||
      frame.phase !== "armed" ||
      frame.target.kind !== "poleActivation"
    ) {
      return null;
    }
    const origin = frame.origin ?? frame.point;
    return {
      lifelineId: frame.target.lifelineId,
      localY: frame.target.placement.localY,
      center: {
        x: frame.target.placement.center.x,
        y: frame.target.placement.center.y,
      },
      angle: frame.target.placement.angle,
      origin: { x: origin[0], y: origin[1] },
    };
  }

  /**
   * 连接线拖拽的落点：终点吸附到激活条上（含自消息）时返回贴边点，
   * 自由延伸没有落点返回 null。渲染层用它与起点画同款圆点。
   */
  getSequenceConnectionDropPoint = (
    frame: PointerFrame | null = this.app.pointer.getFrame(),
  ): QuickCreatePoint | null => {
    const drag = this.getMessageGesture(frame);
    if (!drag?.moved) {
      return null;
    }
    const source = this.app.scene.getNonDeletedElement(drag.elementId);
    if (!source || !isActivationElement(source)) {
      return null;
    }
    const placement = this.resolveSequenceMessagePlacement(drag, source);
    return placement && placement.kind !== "free"
      ? placement.anchors.end
      : null;
  };

  /** 连接线预演的元素（渲染层每帧来取；空数组表示不画） */
  getSequenceConnectionGhostElements = (
    frame: PointerFrame | null = this.app.pointer.getFrame(),
  ): readonly NonDeletedExcalidrawElement[] => {
    const drag = this.getMessageGesture(frame);
    if (!drag?.moved) {
      return [];
    }
    const source = this.app.scene.getNonDeletedElement(drag.elementId);
    if (!source || !isActivationElement(source)) {
      return [];
    }
    const placement = this.resolveSequenceMessagePlacement(drag, source);
    if (!placement) {
      return [];
    }
    const poleTarget = placement.poleActivation;
    const key = [
      drag.elementId,
      source.version,
      drag.side,
      drag.exit.x,
      drag.exit.y,
      drag.pointer.x,
      drag.pointer.y,
      this.getArrowStyleFingerprint(),
      placement.kind,
      placement.targetElementId ?? "",
      poleTarget
        ? [
            poleTarget.lifelineId,
            poleTarget.center.x,
            poleTarget.center.y,
            poleTarget.angle,
          ].join(":")
        : "",
    ].join("|");
    if (this.sequenceConnectionGhost?.key !== key) {
      const arrow = this.buildSequenceMessageArrow(placement, {
        opacityScale: QUICK_CREATE_GHOST_ALPHA,
        identity: GHOST_ARROW_IDENTITY,
      });
      this.sequenceConnectionGhost = {
        key,
        elements:
          placement.kind === "pole-activation" && poleTarget
            ? [this.buildPoleActivationGhost(poleTarget), arrow]
            : [arrow],
      };
    }
    return this.sequenceConnectionGhost.elements;
  };

  /**
   * 时序消息端点的统一策略入口（既有箭头端点拖拽 / 箭头工具建线）。
   *
   * 返回调整后的场景指针：另一端绑在激活条上时，端点被投到消息轴上并按
   * 「只能朝外」夹取；指针落在没有可连激活条的杆上时，再吸附到「预演新条」
   * 朝源的竖边，并更新半透明预演。没有消息轴（另一端不是激活条、折线箭头、
   * 多点自消息）时返回 null，调用方保持通用行为。
   */
  constrainSequenceMessageEndpoint = (
    element: ExcalidrawLinearElement,
    index: number,
    sceneX: number,
    sceneY: number,
  ): QuickCreatePoint | null => {
    const side =
      index === 0
        ? "start"
        : index === element.points.length - 1
        ? "end"
        : null;
    if (!side) {
      this.clearSequenceEndpointPreview();
      return null;
    }
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const axis = getSequenceMessageAxis(element, side, elementsMap);
    if (!axis) {
      this.clearSequenceEndpointPreview();
      return null;
    }
    const pointer = pointFrom<GlobalPoint>(sceneX, sceneY);
    const constrained = constrainSequenceMessagePoint(axis, pointer);
    const constrainedPoint = { x: constrained[0], y: constrained[1] };
    // 有现成激活条可连：交给通用绑定（预演由 suggestedBinding 画），这里只
    // 负责把指针拉回消息轴。
    const target = findSequenceMessageTarget(
      axis,
      pointer,
      this.app.scene.getNonDeletedElements(),
      elementsMap,
      this.app.state.zoom.value,
    );
    if (target) {
      this.clearSequenceEndpointPreview();
      return constrainedPoint;
    }
    const pole = this.resolveSequencePoleDrop(
      axis,
      pointer,
      new Set([element.id]),
    );
    if (!pole) {
      this.clearSequenceEndpointPreview();
      return constrainedPoint;
    }
    const key = [
      element.id,
      element.version,
      pole.lifelineId,
      pole.center.x,
      pole.center.y,
      pole.angle,
    ].join("|");
    if (this.sequenceEndpointPreview?.key !== key) {
      this.sequenceEndpointPreview = {
        key,
        elements: [this.buildPoleActivationGhost(pole)],
        dropPoint: pole.edge,
      };
      this.app.repaint.request();
    }
    return pole.entry;
  };

  /** 端点拖拽的杆上建条预演（渲染层每帧来取） */
  getSequenceEndpointGhostElements =
    (): readonly NonDeletedExcalidrawElement[] =>
      this.sequenceEndpointPreview?.elements ?? [];

  getSequenceEndpointDropPoint = (): QuickCreatePoint | null =>
    this.sequenceEndpointPreview?.dropPoint ?? null;

  hasSequenceEndpointPreview = (): boolean =>
    this.sequenceEndpointPreview !== null;

  /**
   * 端点拖拽收尾：指针落在没有可连激活条的杆上时，先建激活条（与连接点拖拽
   * 同一套装配 / 绑定登记），再由调用方把端点绑过去。返回 null 表示这次落点
   * 不需要新建（已经绑到既有激活条、或落在空白）。
   *
   * 只建元素、不 `scheduleCapture`：调用方（`actionFinalize`）会把这次创建与
   * 端点绑定收进同一条 undo。
   */
  finalizeSequenceMessageEndpoint = (
    element: NonDeleted<ExcalidrawLinearElement>,
    startOrEnd: "start" | "end",
    scenePoint: QuickCreatePoint,
  ): {
    activation: SequenceActivationElement;
    edge: QuickCreatePoint;
    index: number;
  } | null => {
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const axis = getSequenceMessageAxis(element, startOrEnd, elementsMap);
    if (!axis) {
      this.clearSequenceEndpointPreview();
      return null;
    }
    const pointer = pointFrom<GlobalPoint>(scenePoint.x, scenePoint.y);
    const target = findSequenceMessageTarget(
      axis,
      pointer,
      this.app.scene.getNonDeletedElements(),
      elementsMap,
      this.app.state.zoom.value,
    );
    if (target) {
      this.clearSequenceEndpointPreview();
      return null;
    }
    const pole = this.resolveSequencePoleDrop(
      axis,
      pointer,
      new Set([element.id]),
    );
    if (!pole) {
      this.clearSequenceEndpointPreview();
      return null;
    }
    const activation = this.insertPoleActivation(pole, element.id);
    this.clearSequenceEndpointPreview();
    return {
      activation,
      edge: pole.edge,
      index: startOrEnd === "start" ? 0 : element.points.length - 1,
    };
  };

  private clearSequenceEndpointPreview = (): void => {
    if (!this.sequenceEndpointPreview) {
      return;
    }
    this.sequenceEndpointPreview = null;
    this.app.repaint.request();
  };

  /** 建一条挂在杆上的激活条并登记生命线绑定；`beforeId` 用于压在消息下面 */
  private insertPoleActivation = (
    pole: SequencePoleDrop,
    beforeId?: string,
  ): SequenceActivationElement => {
    const activation = this.buildActivationElement(
      pole.center,
      pole.angle,
      undefined,
      { lifelineId: pole.lifelineId, localY: pole.localY },
    ) as SequenceActivationElement;
    const index = beforeId ? this.app.scene.getElementIndex(beforeId) : -1;
    if (index >= 0) {
      this.app.scene.insertElementsAtIndex([activation], index);
    } else {
      this.app.insertNewElements([activation]);
    }
    const lifeline = this.app.scene.getNonDeletedElement(pole.lifelineId);
    if (lifeline) {
      syncLifelineBoundActivation(
        activation.id,
        lifeline,
        undefined,
        this.app.scene,
      );
    }
    return activation;
  };

  /**
   * 「消息落在杆上、且该处没有可连的激活条」的唯一落位：新条**顶边对齐
   * 消息线**、水平居中于杆、随生命线旋转，入口取新条朝向源的那条竖边。
   * 连接点拖拽与既有端点拖拽都走这里。
   */
  private resolveSequencePoleDrop = (
    axis: SequenceMessageAxis,
    pointer: GlobalPoint,
    ignoreIds?: ReadonlySet<string>,
  ): SequencePoleDrop | null => {
    const lifeline = this.resolvePoleActivationLifeline(
      pointer[0],
      pointer[1],
      ignoreIds,
    );
    if (!lifeline) {
      return null;
    }
    const anchorLocal = getSequenceLifelineLocalPoint(
      lifeline,
      axis.anchor[0],
      axis.anchor[1],
    );
    // 顶边 = 消息线：中心取「消息线 + 半高」，再按杆两端夹取
    const placed = getSequenceLifelineActivationCenter(
      lifeline,
      anchorLocal.y + SEQUENCE_ACTIVATION_HEIGHT / 2,
    );
    const top = placed.localY - SEQUENCE_ACTIVATION_HEIGHT / 2;
    const bottom = placed.localY + SEQUENCE_ACTIVATION_HEIGHT / 2;
    if (
      anchorLocal.y < top ||
      anchorLocal.y > bottom ||
      this.poleActivationOverlapsExisting(lifeline, placed.localY)
    ) {
      return null;
    }
    const side: SequenceConnectionSide =
      anchorLocal.x <= lifeline.width / 2 ? "left" : "right";
    const entryLocalY = Math.min(Math.max(anchorLocal.y, top + 1), bottom - 1);
    const entryLocalX =
      lifeline.width / 2 +
      (side === "left"
        ? -SEQUENCE_ACTIVATION_WIDTH
        : SEQUENCE_ACTIVATION_WIDTH) /
        2;
    const [edgeX, edgeY] = getSequenceLifelineGlobalPoint(
      lifeline,
      entryLocalX,
      entryLocalY,
    );
    // 与已有激活条的目标判定同口径：目标必须在出发边前方
    if (
      (edgeX - axis.anchor[0]) * axis.outward.x +
        (edgeY - axis.anchor[1]) * axis.outward.y <=
      0
    ) {
      return null;
    }
    // 新条按预设装配，描边宽度与真实创建同源（`ACTIVATION_CREATION_SPEC`）
    const entryGap = getBindingGap(
      {
        strokeWidth: this.app.getCurrentItemStrokeWidth(
          ACTIVATION_CREATION_SPEC.tool,
        ),
      },
      { elbowed: false },
    );
    const outward = this.getSequenceSideOutward(side, placed.angle);
    return {
      lifelineId: lifeline.id,
      localY: placed.localY,
      center: placed.center,
      angle: placed.angle,
      edge: { x: edgeX, y: edgeY },
      entry: {
        x: edgeX + outward.x * entryGap,
        y: edgeY + outward.y * entryGap,
      },
      outward,
    };
  };

  /** 方向手柄的源元素：单选的 quick-create 目标（时序图形已被排除） */
  getHandleTargetElement = (): NonDeletedExcalidrawElement | null =>
    getQuickCreateTargetElement(this.app);

  /** 杆上激活条预演的元素（渲染层每帧来取；空数组表示不画） */
  getPoleActivationGhostElements = (
    frame: PointerFrame | null = this.app.pointer.getFrame(),
  ): readonly NonDeletedExcalidrawElement[] => {
    if (
      !frame ||
      (frame.phase !== "hover" && frame.phase !== "armed") ||
      frame.target.kind !== "poleActivation"
    ) {
      return [];
    }
    const hover = {
      lifelineId: frame.target.lifelineId,
      localY: frame.target.placement.localY,
      center: {
        x: frame.target.placement.center.x,
        y: frame.target.placement.center.y,
      },
      angle: frame.target.placement.angle,
    };
    const key = [
      hover.lifelineId,
      hover.center.x,
      hover.center.y,
      hover.angle,
    ].join("|");
    if (this.poleActivationGhost?.key !== key) {
      this.poleActivationGhost = {
        key,
        elements: [this.buildPoleActivationGhost(hover)],
      };
    }
    return this.poleActivationGhost.elements;
  };

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
    this.clearAffordanceCaches();
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
    this.clearAffordanceCaches();
  };

  /** 清掉悬停/手势的预演缓存（不动 frame / 待决态 / 手势本身）。 */
  private clearAffordanceCaches = () => {
    this.ghost = null;
    this.poleActivationGhost = null;
    this.sequenceConnectionGhost = null;
    this.sequenceEndpointPreview = null;
  };

  hitTest = (sceneX: number, sceneY: number, pointerType = "mouse") => {
    const target = this.getHandleTargetElement();
    if (!target) {
      return null;
    }
    return hitTestQuickCreateHandle(
      this.app,
      sceneX,
      sceneY,
      pointerType,
      // 面板待决时命中整组返回空（同修饰键口径）：圆点已收起，点得到的也要跟着消失
      this.modifierHeld || this.hasPendingInsert(),
      target,
    );
  };

  /** 严格取指针下的最上层元素（纯函数实现见 pointerQuickCreate）。 */
  private getStrictTopmostElementAt = (
    sceneX: number,
    sceneY: number,
    ignoreIds?: ReadonlySet<string>,
  ): NonDeletedExcalidrawElement | null =>
    getStrictTopmostElementAt(this.app, sceneX, sceneY, ignoreIds);

  /**
   * 候选激活条是否会与同一根杆上已有的激活条相交。在生命线本地坐标系里比较：
   * 生命线旋转时两者一起转，区间仍然成立；两侧都留
   * `SEQUENCE_MIN_ACTIVATION_OFFSET` 的间隙，避免边界相切。
   */
  private poleActivationOverlapsExisting = (
    lifeline: NonDeletedExcalidrawElement,
    localY: number,
  ): boolean => {
    if (!isSequenceLifelineElement(lifeline)) {
      return false;
    }
    const candidateStart =
      localY - SEQUENCE_ACTIVATION_HEIGHT / 2 - SEQUENCE_MIN_ACTIVATION_OFFSET;
    const candidateEnd =
      localY + SEQUENCE_ACTIVATION_HEIGHT / 2 + SEQUENCE_MIN_ACTIVATION_OFFSET;
    const poleX = lifeline.width / 2;
    const corners = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ] as const;
    for (const element of this.app.scene.getNonDeletedElements()) {
      if (element.id === lifeline.id || !isActivationElement(element)) {
        continue;
      }
      const cos = Math.cos(element.angle);
      const sin = Math.sin(element.angle);
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [ux, uy] of corners) {
        const local = getSequenceLifelineLocalPoint(
          lifeline,
          cx + ux * element.width * cos - uy * element.height * sin,
          cy + ux * element.width * sin + uy * element.height * cos,
        );
        minX = Math.min(minX, local.x);
        maxX = Math.max(maxX, local.x);
        minY = Math.min(minY, local.y);
        maxY = Math.max(maxY, local.y);
      }
      // 只避让「压在这根杆上」的条：横向 AABB 必须覆盖杆中心（含杆走廊）
      if (
        minX > poleX + SEQUENCE_HIT_HALF_WIDTH ||
        maxX < poleX - SEQUENCE_HIT_HALF_WIDTH
      ) {
        continue;
      }
      if (candidateStart < maxY && candidateEnd > minY) {
        return true;
      }
    }
    return false;
  };

  /**
   * 指针下可用于建条的生命线：严格最上层命中必须落在杆走廊上（不含头部）。
   * 悬停建条与消息拖拽落点共用这一个判定，两条路径的「能建」口径因此一致。
   */
  private resolvePoleActivationLifeline = (
    sceneX: number,
    sceneY: number,
    ignoreIds?: ReadonlySet<string>,
  ): NonDeleted<SequenceLifelineElement> | null => {
    const topmost = this.getStrictTopmostElementAt(sceneX, sceneY, ignoreIds);
    if (!topmost || topmost.locked || !isSequenceLifelineElement(topmost)) {
      return null;
    }
    return isPointOnSequenceLifelinePole(topmost, sceneX, sceneY)
      ? topmost
      : null;
  };

  /**
   * 拖拽落位：终点先看指针是否压在激活条上。
   *
   * - 压在**起点那条**上 → 自消息（折线），起点附近的死区不吸附；
   * - 压在**其它**激活条上 → 水平直线，终点取目标朝向源的那条边、y 与起端齐平；
   * - 都没压到 → 水平自由延伸，只朝出发边的前方走。
   */
  private resolveSequenceMessagePlacement = (
    drag: SequenceConnectionDrag,
    source: SequenceActivationElement,
  ): SequenceMessagePlacement | null => {
    const exit = drag.exit;
    // 三条创建 / 编辑路径共用同一份消息策略：轴、目标、杆上落位都从这里来。
    const axis = getSequenceMessageAxisFromAnchor(
      source,
      drag.side,
      pointFrom<GlobalPoint>(exit.x, exit.y),
    );
    const outward = axis.outward;
    const gap = getBindingGap(source, { elbowed: false });
    const zoom = this.app.state.zoom.value;
    const pointer = pointFrom<GlobalPoint>(drag.pointer.x, drag.pointer.y);

    // 自消息：指针还在起点这条激活条上，且纵向离开起点足够远
    const sourceLocal = getSequenceLifelineLocalPoint(
      source,
      drag.pointer.x,
      drag.pointer.y,
    );
    if (
      sourceLocal.x >= 0 &&
      sourceLocal.x <= source.width &&
      sourceLocal.y >= 0 &&
      sourceLocal.y <= source.height
    ) {
      const targetLocalY = Math.min(
        Math.max(sourceLocal.y, 1),
        source.height - 1,
      );
      if (
        Math.abs(targetLocalY - drag.startLocalY) * zoom >=
        SEQUENCE_CONNECTION_MIN_SELF_GAP
      ) {
        const end = this.getSequenceActivationEdgePoint(
          source,
          drag.side,
          targetLocalY,
        );
        const loopStart = {
          x: exit.x + outward.x * SEQUENCE_SELF_MESSAGE_OFFSET,
          y: exit.y + outward.y * SEQUENCE_SELF_MESSAGE_OFFSET,
        };
        const loopEnd = {
          x: end.x + outward.x * SEQUENCE_SELF_MESSAGE_OFFSET,
          y: end.y + outward.y * SEQUENCE_SELF_MESSAGE_OFFSET,
        };
        return {
          kind: "self",
          targetElementId: source.id,
          anchors: { start: exit, end },
          points: [
            {
              x: exit.x + outward.x * gap,
              y: exit.y + outward.y * gap,
            },
            loopStart,
            loopEnd,
            {
              x: end.x + outward.x * gap,
              y: end.y + outward.y * gap,
            },
          ],
        };
      }
      // 落在死区里：不吸附，按自由端处理（指针还在条内，水平线会被夹到起点）
      return this.getSequenceFreePlacement(drag, axis, gap);
    }

    // 其它激活条：指针压在条上，且起端 y 落在目标的纵向范围内才水平连过去
    const target = findSequenceMessageTarget(
      axis,
      pointer,
      this.app.scene.getNonDeletedElements(),
      this.app.scene.getNonDeletedElementsMap(),
      zoom,
    );
    if (target) {
      const targetLocal = getSequenceLifelineLocalPoint(target, exit.x, exit.y);
      const targetLocalY = Math.min(
        Math.max(targetLocal.y, 1),
        target.height - 1,
      );
      const targetSide: SequenceConnectionSide =
        targetLocal.x <= target.width / 2 ? "left" : "right";
      const entry = this.getSequenceActivationEdgePoint(
        target,
        targetSide,
        targetLocalY,
      );
      const entryOutward = this.getSequenceSideOutward(
        targetSide,
        target.angle,
      );
      const entryGap = getBindingGap(target, { elbowed: false });
      return {
        kind: "activation",
        targetElementId: target.id,
        anchors: { start: exit, end: entry },
        points: [
          {
            x: exit.x + outward.x * gap,
            y: exit.y + outward.y * gap,
          },
          {
            x: entry.x + entryOutward.x * entryGap,
            y: entry.y + entryOutward.y * entryGap,
          },
        ],
      };
    }

    // 杆上没有可连的激活条：预演在杆上新建一条，顶边对齐消息线
    const pole = this.resolveSequencePoleDrop(axis, pointer);
    if (pole) {
      return {
        kind: "pole-activation",
        poleActivation: pole,
        anchors: { start: exit, end: pole.edge },
        points: [
          {
            x: exit.x + outward.x * gap,
            y: exit.y + outward.y * gap,
          },
          pole.entry,
        ],
      };
    }

    return this.getSequenceFreePlacement(drag, axis, gap);
  };

  /**
   * 自由端：只朝出发边的前方水平延伸，y 与起端齐平。终点不绑定，所以不留 gap。
   */
  private getSequenceFreePlacement = (
    drag: SequenceConnectionDrag,
    axis: SequenceMessageAxis,
    gap: number,
  ): SequenceMessagePlacement => {
    const exit = { x: axis.anchor[0], y: axis.anchor[1] };
    const outward = axis.outward;
    // 只朝出发边的前方延伸：把指针位移投影到这条边的外法线上，负值夹到 0
    const forward = Math.max(
      0,
      (drag.pointer.x - exit.x) * outward.x +
        (drag.pointer.y - exit.y) * outward.y,
    );
    const end = constrainSequenceMessagePoint(
      axis,
      pointFrom<GlobalPoint>(drag.pointer.x, drag.pointer.y),
    );
    // 起点让出 binding gap；还没拖出 gap 时收成一点，避免画出一条反向的线
    const startOffset = Math.min(gap, forward);
    return {
      kind: "free",
      anchors: { start: exit, end: { x: end[0], y: end[1] } },
      points: [
        {
          x: exit.x + outward.x * startOffset,
          y: exit.y + outward.y * startOffset,
        },
        { x: end[0], y: end[1] },
      ],
    };
  };

  /** 激活条一条竖边上、指定本地 y 的场景点 */
  private getSequenceActivationEdgePoint = (
    element: ExcalidrawShapeElement,
    side: SequenceConnectionSide,
    localY: number,
  ): QuickCreatePoint => {
    const [x, y] = getActivationAnchor(element, side, localY);
    return { x, y };
  };

  /** 某条边朝外的世界方向（随元素 angle 旋转） */
  private getSequenceSideOutward = (
    side: SequenceConnectionSide,
    angle: Radians,
  ): { x: number; y: number } => {
    const [x, y] = pointRotateRads<GlobalPoint>(
      pointFrom<GlobalPoint>(side === "right" ? 1 : -1, 0),
      pointFrom<GlobalPoint>(0, 0),
      angle,
    );
    return { x, y };
  };

  /**
   * 按下时臂化「杆上点击」：这里**不创建**，也不吞手势——拖拽时仍交给通用选择
   * 路径移动生命线；是点击还是拖拽由 `handlePointerUp` 按 frame.origin 判定。
   * 状态只在 frame 里（PR4b），这里只清预演缓存。
   */
  armPoleClick = (
    frame: PointerFrame,
    pointerDownState: PointerDownState,
  ): boolean => {
    if (frame.target.kind !== "poleActivation") {
      return false;
    }
    this.clearAffordanceCaches();
    void pointerDownState;
    return true;
  };

  /** 方向手柄 pointerdown：只接管手势，落点由抬起时判定。 */
  startHandleGesture = (
    frame: PointerFrame,
    pointerDownState: PointerDownState,
  ): boolean => {
    if (frame.target.kind !== "quickCreateHandle") {
      return false;
    }
    if (!this.app.scene.getNonDeletedElement(frame.target.elementId)) {
      return false;
    }
    pointerDownState.drag.blockDragging = true;
    pointerDownState.resize.handleType = false;
    pointerDownState.resize.isResizing = false;
    this.clearAffordanceCaches();
    this.app.pointer.setFrame({
      ...frame,
      phase: "gesture",
      owner: "quickCreate",
      origin: frame.origin ?? frame.point,
    });
    this.app.repaint.request();
    return true;
  };

  /** 激活条连接点 pointerdown：接管消息拖拽手势。 */
  startMessageGesture = (
    frame: PointerFrame,
    pointerDownState: PointerDownState,
  ): boolean => {
    if (frame.target.kind !== "activationEdge") {
      return false;
    }
    const source = this.app.scene.getNonDeletedElement(frame.target.elementId);
    if (!source || !isActivationElement(source)) {
      return false;
    }
    pointerDownState.drag.blockDragging = true;
    pointerDownState.resize.handleType = false;
    pointerDownState.resize.isResizing = false;
    this.clearAffordanceCaches();
    this.app.pointer.setFrame({
      ...frame,
      phase: "gesture",
      owner: "sequenceMessage",
      origin: frame.origin ?? frame.point,
    });
    this.app.repaint.request();
    return true;
  };

  /**
   * 移动相位：frame 是唯一状态，这里只维护缓存与阈值判定。没拖过阈值也返回
   * true——手势已经归方向手柄所有，让给选择路径会让同一次按下先选出别的元素。
   */
  handleGestureMove = (
    frame: PointerFrame,
    scenePoint: QuickCreatePoint,
  ): boolean => {
    void scenePoint;
    if (frame.owner === "sequenceMessage" && this.getMessageGesture(frame)) {
      this.sequenceConnectionGhost = null;
      this.app.repaint.request();
      return true;
    }
    if (frame.owner === "quickCreate" && this.getHandleGesture(frame)) {
      this.ghost = null;
      this.app.repaint.request();
      return true;
    }
    // 杆上臂化：越过阈值即丢弃这次点击（拖生命线，不创建）
    if (frame.phase === "armed" && frame.target.kind === "poleActivation") {
      if (hasFrameMoved(frame, this.app.state.zoom.value)) {
        this.poleActivationGhost = null;
        // 臂化被丢弃：frame 也一并清空（否则预演继续挂在 armed 上）
        this.app.pointer.clear();
        this.app.repaint.request();
      }
      return false;
    }
    return false;
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
    frame: PointerFrame | null,
    pointerDownState: PointerDownState,
    event: PointerEvent,
    scenePoint: QuickCreatePoint,
  ): boolean => {
    if (this.cancelledPointerDown === pointerDownState) {
      this.cancelledPointerDown = null;
      this.app.pointer.clear();
      return true;
    }
    // 端点拖拽的杆上预演随本次手势结束；真正落地由 actionFinalize 重新解析
    this.clearSequenceEndpointPreview();
    // 激活条连接线：结束时按松手点解落位；没越过阈值（只是点了下连接点）
    // 或起端已被删除就不落地。
    const sequenceDrag = this.getMessageGesture(frame);
    if (frame?.owner === "sequenceMessage" && sequenceDrag) {
      this.sequenceConnectionGhost = null;
      const source = this.app.scene.getNonDeletedElement(
        sequenceDrag.elementId,
      );
      if (
        event.type === "pointerup" &&
        sequenceDrag.moved &&
        source &&
        isActivationElement(source)
      ) {
        this.createSequenceMessage(source, sequenceDrag);
      }
      pointerDownState.drag.hasOccurred = true;
      this.app.pointer.clear();
      this.app.repaint.request();
      return true;
    }
    // 杆上单击：按下时只臂化，这里按 frame.origin 判定。
    const poleClick = this.getPoleClick(frame);
    if (poleClick && frame) {
      if (
        event.type === "pointerup" &&
        !hasFrameMoved(frame, this.app.state.zoom.value)
      ) {
        this.createPoleActivation(poleClick);
        pointerDownState.drag.hasOccurred = true;
        this.app.pointer.clear();
        this.app.repaint.request();
        return true;
      }
      return false;
    }
    const drag = this.getHandleGesture(frame);
    if (frame?.owner !== "quickCreate" || !drag) {
      return false;
    }
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
    this.app.pointer.clear();
    this.app.repaint.request();
    return true;
  };

  /** Whether a cancelled pointerdown still needs teardown on pointerup. */
  hasPointerGesture = (): boolean => Boolean(this.cancelledPointerDown);

  /** Esc 取消：不建图、不留历史；抬起时由 cancelledPointerDown 吞掉收尾。 */
  handlePointerKeyDown = (
    pointerDownState: PointerDownState,
    event: KeyboardEvent,
  ): boolean => {
    // 激活条连接线：Esc 取消本次手势，抬起时由 cancelledPointerDown 吞掉收尾
    if (event.key === KEYS.ESCAPE && this.sequenceEndpointPreview) {
      this.clearSequenceEndpointPreview();
      // 不吞键：让通用路径照常取消正在进行的端点拖拽 / 建线
      return false;
    }
    const frame = this.app.pointer.getFrame();
    if (event.key === KEYS.ESCAPE && frame?.owner === "sequenceMessage") {
      this.cancelledPointerDown = pointerDownState;
      this.sequenceConnectionGhost = null;
      this.app.pointer.clear();
      this.app.repaint.request();
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    // 杆上待决的单击：Esc 只撤销这次「待创建」，不吞键——通用路径仍要照常
    // 取消可能正在进行的生命线拖拽
    if (
      event.key === KEYS.ESCAPE &&
      frame?.phase === "armed" &&
      frame.target.kind === "poleActivation"
    ) {
      this.poleActivationGhost = null;
      this.app.pointer.clear();
      this.app.repaint.request();
      return false;
    }
    if (event.key !== KEYS.ESCAPE || frame?.owner !== "quickCreate") {
      return false;
    }
    this.cancelledPointerDown = pointerDownState;
    this.ghost = null;
    this.app.pointer.clear();
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
    const source =
      this.getHandleTargetElement() ??
      this.app.scene.getNonDeletedElement(handle.elementId);
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

  // ---------------------------------------------------------------------------
  // 生命线杆上的激活条
  // ---------------------------------------------------------------------------

  /** 按预设装配一条激活条（真实创建与预演共用），中心与角度由落点给出 */
  private buildActivationElement = (
    center: QuickCreatePoint,
    angle: Radians,
    identity?: CreationIdentity,
    link?: { lifelineId: string; localY: number },
  ): NonDeleted<ExcalidrawShapeElement> => {
    const built = buildPresetElementsCentered(
      this.app,
      ACTIVATION_CREATION_SPEC,
      center,
      identity,
    );
    const element = built.elements[0] as NonDeleted<ExcalidrawShapeElement>;
    return {
      ...element,
      angle,
      shape: link ? { ...element.shape, link } : element.shape,
    } as NonDeleted<ExcalidrawShapeElement>;
  };

  /** 激活条预演：与真实创建同一套装配，固定身份、只压暗一半 */
  private buildPoleActivationGhost = (target: {
    center: QuickCreatePoint;
    angle: Radians;
  }): NonDeletedExcalidrawElement => {
    const element = this.buildActivationElement(
      target.center,
      target.angle,
      POLE_GHOST_IDENTITY,
    );
    return {
      ...element,
      opacity: element.opacity * QUICK_CREATE_GHOST_ALPHA,
    };
  };

  /** 杆上单击：在预演位置创建一条激活条并选中它 */
  private createPoleActivation = (click: PoleActivationClick): void => {
    const activation = this.buildActivationElement(
      click.center,
      click.angle,
      undefined,
      { lifelineId: click.lifelineId, localY: click.localY },
    );
    this.app.insertNewElements([activation]);
    // 生命线侧登记绑定：之后移动 / 缩放生命线时激活条跟随
    const lifeline = this.app.scene.getNonDeletedElement(click.lifelineId);
    if (lifeline) {
      syncLifelineBoundActivation(
        activation.id,
        lifeline,
        undefined,
        this.app.scene,
      );
    }
    this.app.setState({
      selectedElementIds: { [activation.id]: true },
      selectedGroupIds: {},
      selectedLinearElement: null,
      hoveredElementIds: {},
      editingGroupId: null,
    });
    this.app.store.scheduleCapture();
  };

  // ---------------------------------------------------------------------------
  // 激活条动态连接点与消息
  // ---------------------------------------------------------------------------

  /**
   * 按几何点装配消息箭头。消息的线型只由落点决定（不跟当前箭头样式走）：
   * 两点 → 水平/直连，四点的自消息 → 折线；一律直角，不继承圆角。
   */
  private buildSequenceMessageArrow = (
    placement: SequenceMessagePlacement,
    options: {
      opacityScale?: number;
      identity?: CreationIdentity;
    } = {},
  ): NonDeleted<ExcalidrawLinearElement> => {
    const arrowProps = getCurrentItemArrowProps(this.app);
    const [first] = placement.points;
    const created = newArrowElement({
      type: "arrow",
      x: first.x,
      y: first.y,
      ...arrowProps,
      // 消息线型由落点决定：自消息固定折线，其余固定直线
      elbowed: false,
      roundness: null,
      fixedSegments: null,
      points: placement.points.map((point) =>
        pointFrom<LocalPoint>(point.x - first.x, point.y - first.y),
      ),
      ...(options.opacityScale === undefined
        ? {}
        : { opacity: arrowProps.opacity * options.opacityScale }),
      ...options.identity,
    });
    return created;
  };

  /**
   * 从连接点拖出消息：按预演同源的几何落地。终点吸附到已有激活条时两端绑定
   * （自消息两端都绑起点那条）；落在杆上时先建一条激活条再绑定；未吸附则只绑
   * 起端、末端自由落在此处。整条消息、新建的激活条与绑定同属一步撤销。
   */
  private createSequenceMessage = (
    source: SequenceActivationElement,
    drag: SequenceConnectionDrag,
  ): void => {
    const placement = this.resolveSequenceMessagePlacement(drag, source);
    if (!placement) {
      return;
    }
    // 自由端与起端重合（还没拖出条外）时不落地空箭头；自由端还要至少拖出
    // 一个 binding gap，否则绑定的起端会把箭头拉成反向的一小截。
    if (placement.kind !== "self") {
      const length = Math.hypot(
        placement.anchors.end.x - placement.anchors.start.x,
        placement.anchors.end.y - placement.anchors.start.y,
      );
      const minLength =
        placement.kind === "free"
          ? getBindingGap(source, { elbowed: false })
          : 1;
      if (length < minLength) {
        return;
      }
    }
    const arrow = this.buildSequenceMessageArrow(placement);
    // 落点在杆上：先按预演位置建激活条并登记到生命线，再把它当终点绑定
    const poleTarget = placement.poleActivation;
    const newActivation =
      placement.kind === "pole-activation" && poleTarget
        ? this.insertPoleActivation(poleTarget)
        : null;
    this.app.insertNewElements([arrow]);
    bindBindingElement(
      arrow,
      source as NonDeleted<ExcalidrawBindableElement>,
      "start",
      this.app.scene,
      pointFrom<GlobalPoint>(
        placement.anchors.start.x,
        placement.anchors.start.y,
      ),
      true,
      true,
      this.getNonElbowLandingOpts(
        pointFrom<GlobalPoint>(
          placement.anchors.end.x,
          placement.anchors.end.y,
        ),
      ),
    );
    const target =
      newActivation ??
      (placement.kind !== "free" && placement.targetElementId
        ? this.app.scene.getNonDeletedElement(placement.targetElementId)
        : null);
    if (target && isActivationElement(target) && isBindableElement(target)) {
      bindBindingElement(
        arrow,
        target,
        "end",
        this.app.scene,
        pointFrom<GlobalPoint>(
          placement.anchors.end.x,
          placement.anchors.end.y,
        ),
        true,
        true,
        this.getNonElbowLandingOpts(
          pointFrom<GlobalPoint>(
            placement.anchors.start.x,
            placement.anchors.start.y,
          ),
        ),
      );
    }
    // 两点消息按 orbit 绑定把两端落到位；自消息的四个点已经按几何落好
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
    this.app.store.scheduleCapture();
  };

  /** 当前拖拽是否正是这个源的这个方向（预演与落位判定共用，避免两处口径分叉） */
  private isDraggingHandle = (
    sourceId: string,
    direction: QuickCreateDirection,
  ) => {
    const drag = this.getHandleGesture();
    return (
      drag?.moved === true &&
      drag.elementId === sourceId &&
      drag.direction === direction
    );
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
   * 落位来源：**已越过阈值**的拖拽走指针落位，其余（悬停预演、按下但还没拖、
   * 点击落地）走基准位 + 让位。
   *
   * 阈值前不看指针，是为了让「按下不拖」这条老路径全程所见即所得：悬停时预演
   * 画在基准位，按下去它不该跳到指针那儿，松手也仍然落在基准位。
   */
  private resolvePlacementFor = (
    source: NonDeletedExcalidrawElement,
    direction: QuickCreateDirection,
  ): QuickCreatePlacement => {
    const drag = this.getHandleGesture();
    return drag?.moved &&
      drag.elementId === source.id &&
      drag.direction === direction
      ? this.resolveDragPlacement(source, direction, drag.pointer)
      : this.resolvePlacement(source, direction);
  };

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
   * Landing parameters shared by the preview and the actual binding: both must
   * run `resolveConnectionHit` with the same viewport flags for bit-identical
   * endpoints.
   */
  private getNonElbowLandingOpts = (reference?: GlobalPoint) =>
    ({
      zoom: this.app.state.zoom.value,
      isMidpointSnappingEnabled:
        this.app.state.isMidpointSnappingEnabled &&
        !this.app.state.gridModeEnabled,
      angleLocked: false,
      gridSize: this.app.state.gridModeEnabled
        ? (this.app.state.gridSize as NullableGridSize)
        : undefined,
      reference,
    } as NonElbowLandingOpts);

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
            true,
            this.app.state.isMidpointSnappingEnabled,
            this.getNonElbowLandingOpts(
              startOrEnd === "start"
                ? pointFrom<GlobalPoint>(connector.entry.x, connector.entry.y)
                : pointFrom<GlobalPoint>(connector.exit.x, connector.exit.y),
            ),
          )
        : resolveAttachPointForNonElbowBinding(
            arrow,
            target,
            startOrEnd,
            elementsMap,
            pointFrom<GlobalPoint>(focusPoint.x, focusPoint.y),
            true,
            this.getNonElbowLandingOpts(
              startOrEnd === "start"
                ? pointFrom<GlobalPoint>(connector.entry.x, connector.entry.y)
                : pointFrom<GlobalPoint>(connector.exit.x, connector.exit.y),
            ),
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
      true,
      true,
      this.getNonElbowLandingOpts(
        pointFrom<GlobalPoint>(
          placement.connector.entry.x,
          placement.connector.entry.y,
        ),
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
      true,
      true,
      this.getNonElbowLandingOpts(
        pointFrom<GlobalPoint>(
          placement.connector.exit.x,
          placement.connector.exit.y,
        ),
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
      true,
      true,
      this.getNonElbowLandingOpts(
        pointFrom<GlobalPoint>(
          placement.connector.entry.x,
          placement.connector.entry.y,
        ),
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
        true,
        true,
        this.getNonElbowLandingOpts(
          pointFrom<GlobalPoint>(
            placement.connector.exit.x,
            placement.connector.exit.y,
          ),
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
    // Some presets assemble more than the shape itself (the fragment's default
    // row labels); insert them together so the fast path matches the drawer.
    const presetElements = built.elements.map((element, index) =>
      index === 0 ? shape : element,
    );
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
    this.app.insertNewElements([arrow, ...presetElements]);
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
      true,
      true,
      this.getNonElbowLandingOpts(
        pointFrom<GlobalPoint>(
          placement.connector.entry.x,
          placement.connector.entry.y,
        ),
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
      true,
      true,
      this.getNonElbowLandingOpts(
        pointFrom<GlobalPoint>(
          placement.connector.exit.x,
          placement.connector.exit.y,
        ),
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
    const groupId: PresetCatalogGroupId = isFlowchartShapeId(source.shape.id)
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
