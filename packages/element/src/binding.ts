import { arrayToMap, getGridPoint, invariant } from "@excalidraw/common";

import {
  PRECISION,
  clamp,
  lineSegment,
  pointDistance,
  pointDistanceSq,
  pointFrom,
  pointFromVector,
  pointRotateRads,
  pointsEqual,
  vectorFromPoint,
  vectorNormalize,
  vectorScale,
  type GlobalPoint,
} from "@excalidraw/math";

import type { LineSegment, LocalPoint, Radians } from "@excalidraw/math";
import type { AppState, NullableGridSize } from "@excalidraw/excalidraw/types";
import type { MapEntry, Mutable } from "@excalidraw/common/utility-types";
import type { Bounds } from "@excalidraw/common";

import { getCenterForBounds } from "./bounds";
import {
  getCompositeShapeAnchors,
  isShapeElement,
  isShapeWithId,
  isShapeWithIdIn,
} from "./compositeShape";
import {
  getHoveredElementForBinding,
  hitElementItself,
  intersectElementWithLineSegment,
  isPointInElement,
} from "./collision";
import { distanceToElement } from "./distance";
import {
  headingForPointFromElement,
  headingIsHorizontal,
  vectorToHeading,
  type Heading,
} from "./heading";
import { LinearElementEditor } from "./linearElementEditor";
import { mutateElement } from "./mutateElement";
import { INVISIBLY_SMALL_ELEMENT_SIZE } from "./sizeHelpers";
import { getBoundTextElement, handleBindTextResize } from "./textElement";
import {
  isLinearElement,
  isBindableElement,
  isBoundToContainer,
  isCurvedArrow,
  isElbowArrow,
  isRectanguloidElement,
  isTextElement,
} from "./typeChecks";

import { normalFromAttachPoint, type CurveNormal } from "./curveConnector";

import { aabbForElement, elementCenterPoint } from "./bounds";
import { updateElbowArrowPoints } from "./elbowArrow";
import { projectAttachPointOntoDiagonal } from "./utils";

import { isNonDeletedElement } from ".";

import type { Scene } from "./Scene";

import type { ElementUpdate } from "./mutateElement";
import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawLinearElement,
  ExcalidrawBindableElement,
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
  AttachPoint,
  ElementBinding,
  NonDeleted,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
  Ordered,
  PointsPositionUpdates,
} from "./types";

export type BindingStrategy =
  // 建立绑定：这一端落在该元素的 `focusPoint`
  | {
      element: NonDeleted<ExcalidrawBindableElement>;
      focusPoint: GlobalPoint;
    }
  // 解除绑定
  | {
      element: null;
    }
  // 保持现有绑定不动
  | {
      element: undefined;
    };

/**
 * gaps exclude element strokeWidth
 *
 * IMPORTANT: currently must be > 0 (this also applies to the computed gap)
 */
export const BASE_BINDING_GAP = 5;
export const BASE_BINDING_GAP_ELBOW = 5;
export const FOCUS_POINT_SIZE = 10 / 1.5;

// Below this size (in px) a bindable element has no meaningful interior to
// anchor a proportional attachPoint into
const MIN_BINDABLE_SIZE = 1;

export const getBindingGap = (
  // only the stroke width is needed, so the gap can also be computed for a
  // bind target that doesn't exist yet (see `getTextBindingForArrowEndpoint`)
  bindTarget: Pick<ExcalidrawBindableElement, "strokeWidth">,
  opts: Pick<ExcalidrawArrowElement, "elbowed"> | ExcalidrawLinearElement,
): number => {
  return (
    ("elbowed" in opts && opts.elbowed
      ? BASE_BINDING_GAP_ELBOW
      : BASE_BINDING_GAP) +
    bindTarget.strokeWidth / 2
  );
};

/**
 * 投影到绑定目标轮廓上时用的 gap。与 `getBindingGap` 的唯一区别：**文本作为绑定
 * 目标时不加 gap**，端点落在文本的绑定边上。
 *
 * 硬性理由：`attachPoint` 是归一化比例，而 gap 是固定像素。把 gap 烘进比例需要知道
 * 文本高度，而文本随输入增长时包围盒会变 —— 绑定边被钉住、比例不变，端点于是会漂
 * （每增长一行漂一个 gap）。文本工具那条入口一直如此（`getTextBindingForArrowEndpoint`
 * 直接把端点当锚点）；通用投影这一处曾漏掉，于是「拖端点上去」与
 * `convertToExcalidrawElements` 两条入口都多出一个 gap。折线档（
 * `bindPointToSnapToElementOutline` 的主/兜底求交、`avoidRectangularCorner`）也曾
 * 漏掉，同样是这一处补上的。
 *
 * 「文本不留 gap」这条判据只在这里一份：**决定端点落点**的投影一律走本函数（通用
 * 投影 `projectFocusPointOntoInflatedOutline`、`projectPointOntoBoundElementOutline`
 * 函数内的三处求交/外移 + 折线档那三处）。`getBindingGap` 仍然留在下面这些地方 ——
 * 它们**不是**「不影响落点」才不用本函数，而是本波显式保持不动：改这些的 gap 口径会
 * 牵动**非文本**的既有行为，或只是延续上游的常量口径：
 * - 吸附阈值：`hitElementItself` 的命中判定、`pointerSession` 与 `elbowArrow` 的悬停
 *   容差；
 * - 落点载体（非文本）：`snapToMid` 的返回值本身就是射线方向上的落点（gap 直接进
 *   坐标），「离中心太近就放弃吸附」只是它的另一半用途 —— 实测同一点只切
 *   `isMidpointSnappingEnabled`，24 个场景里 15 个落点不同；把它的 gap 换成投影 gap
 *   则有 6 条文本场景落点变化，最大约 60px。`snapBoundPointToGrid` 的网格吸附同样
 *   决定落点（网格档 27 条文本场景里 10 条会变，最大
 *   `[160.012,125] → [220,103.125]`；矩形档 0 条）；
 * - 除数下限：`calculateAttachPointFor*Binding` 的 `sizeFloor`（防小目标把比例炸掉，
 *   上面另有 `MIN_BINDABLE_SIZE` 兜着）；
 * - `reanchorBindingsToOutline`：721 行是**投影**（gap 传进
 *   `intersectElementWithLineSegment`，结果写成 `attachPoint`），710-715 行才是副
 *   作用判定（开路径的「是否已贴住」检查）。两处都到不了文本 —— 该函数唯一调用方
 *   `ConvertElementTypePopup.tsx`（556 行）只对 generic 转换后的元素调用，而
 *   `getGenericType` 只认 `composite` 与 `mindmap-node`（文本返回 null），
 *   所以文本不留 gap 的判据不受这两处影响。
 */
export const getProjectionBindingGap = (
  bindTarget: Pick<ExcalidrawBindableElement, "type" | "strokeWidth">,
  opts: Pick<ExcalidrawArrowElement, "elbowed"> | ExcalidrawLinearElement,
  /**
   * 覆盖基准 gap（同样不含 strokeWidth 补偿）。折线档兜底那一趟历来用常量
   * `BASE_BINDING_GAP_ELBOW` 而非 `getBindingGap` 作基准，那一处沿用它的数值 ——
   * 免得「接上文本判据」顺带挪动非文本的既有落点。
   */
  baseGap?: number,
): number =>
  bindTarget.type === "text" ? 0 : baseGap ?? getBindingGap(bindTarget, opts);

export const maxBindingDistance_simple = (zoom?: AppState["zoom"]): number => {
  const BASE_BINDING_DISTANCE = Math.max(BASE_BINDING_GAP, 15);
  const zoomValue = zoom?.value && zoom.value < 1 ? zoom.value : 1;
  return clamp(
    // reducing zoom impact so that the diff between binding distance and
    // binding gap is kept to minimum when possible
    BASE_BINDING_DISTANCE / (zoomValue * 1.5),
    BASE_BINDING_DISTANCE,
    BASE_BINDING_DISTANCE * 2,
  );
};

export const isBindingEnabled = (appState: {
  isBindingEnabled: AppState["isBindingEnabled"];
}): boolean => {
  return appState.isBindingEnabled;
};

export const bindOrUnbindBindingElement = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  draggingPoints: PointsPositionUpdates,
  scenePointerX: number,
  scenePointerY: number,
  scene: Scene,
  appState: AppState,
  opts?: {
    newArrow?: boolean;
    altKey?: boolean;
    angleLocked?: boolean;
    initialBinding?: boolean;
    gridSize?: NullableGridSize;
  },
) => {
  const { start, end } = getBindingStrategyForDraggingBindingElementEndpoints(
    arrow,
    draggingPoints,
    scenePointerX,
    scenePointerY,
    scene.getNonDeletedElementsMap(),
    scene.getNonDeletedElements(),
    appState,
    {
      ...opts,
      finalize: true,
    },
  );

  const isMidpointSnappingEnabled =
    appState.isMidpointSnappingEnabled &&
    !opts?.angleLocked &&
    !appState.gridModeEnabled;

  bindOrUnbindBindingElementEdge(
    arrow,
    start,
    "start",
    scene,
    appState.isBindingEnabled,
    isMidpointSnappingEnabled,
  );
  bindOrUnbindBindingElementEdge(
    arrow,
    end,
    "end",
    scene,
    appState.isBindingEnabled,
    isMidpointSnappingEnabled,
  );
  if (start.element || end.element) {
    // 策略要求这一端落到某个点上：按刚写下的绑定把端点解出来
    const updates: PointsPositionUpdates = new Map();

    if (start.element) {
      updates.set(0, {
        point:
          updateBoundPoint(
            arrow,
            arrow.startBinding,
            start.element,
            scene.getNonDeletedElementsMap(),
          ) || arrow.points[0],
      });
    }

    if (end.element) {
      updates.set(arrow.points.length - 1, {
        point:
          updateBoundPoint(
            arrow,
            arrow.endBinding,
            end.element,
            scene.getNonDeletedElementsMap(),
          ) || arrow.points[arrow.points.length - 1],
      });
    }

    LinearElementEditor.movePoints(arrow, scene, updates);
  }

  return { start, end };
};

const bindOrUnbindBindingElementEdge = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  strategy: BindingStrategy,
  startOrEnd: "start" | "end",
  scene: Scene,
  shouldSnapToOutline = true,
  isMidpointSnappingEnabled = true,
): void => {
  if (strategy.element === null) {
    unbindBindingElement(arrow, startOrEnd, scene);
  } else if (strategy.element !== undefined) {
    bindBindingElement(
      arrow,
      strategy.element,
      startOrEnd,
      scene,
      strategy.focusPoint,
      shouldSnapToOutline,
      isMidpointSnappingEnabled,
    );
  }
};

const bindingStrategyForElbowArrowEndpointDragging = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  draggingPoints: PointsPositionUpdates,
  elementsMap: NonDeletedSceneElementsMap,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  zoom?: AppState["zoom"],
): {
  start: BindingStrategy;
  end: BindingStrategy;
} => {
  invariant(draggingPoints.size === 1, "Bound elbow arrows cannot be moved");

  const update = draggingPoints.entries().next().value;

  invariant(
    update,
    "There should be a position update for dragging an elbow arrow endpoint",
  );

  const [pointIdx, { point }] = update;
  const globalPoint = LinearElementEditor.getPointGlobalCoordinates(
    arrow,
    point,
    elementsMap,
  );
  const hit = getHoveredElementForBinding(
    globalPoint,
    elements,
    elementsMap,
    maxBindingDistance_simple(zoom),
  );

  const current: BindingStrategy = hit
    ? {
        element: hit,
        focusPoint: LinearElementEditor.getPointAtIndexGlobalCoordinates(
          arrow,
          pointIdx,
          elementsMap,
        ),
      }
    : { element: null };
  const other: BindingStrategy = { element: undefined };

  return pointIdx === 0
    ? { start: current, end: other }
    : { start: other, end: current };
};

export const getBindingStrategyForDraggingBindingElementEndpoints = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  draggingPoints: PointsPositionUpdates,
  screenPointerX: number,
  screenPointerY: number,
  elementsMap: NonDeletedSceneElementsMap,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  appState: AppState,
  opts?: {
    newArrow?: boolean;
    angleLocked?: boolean;
    altKey?: boolean;
    finalize?: boolean;
    initialBinding?: boolean;
    zoom?: AppState["zoom"];
    gridSize?: NullableGridSize;
  },
): { start: BindingStrategy; end: BindingStrategy } => {
  return getBindingStrategyForDraggingBindingElementEndpoints_simple(
    arrow,
    draggingPoints,
    screenPointerX,
    screenPointerY,
    elementsMap,
    elements,
    appState,
    opts,
  );
};

const getBindingStrategyForDraggingBindingElementEndpoints_simple = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  draggingPoints: PointsPositionUpdates,
  scenePointerX: number,
  scenePointerY: number,
  elementsMap: NonDeletedSceneElementsMap,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  appState: AppState,
  opts?: {
    newArrow?: boolean;
    angleLocked?: boolean;
    altKey?: boolean;
    finalize?: boolean;
    initialBinding?: boolean;
    zoom?: AppState["zoom"];
    gridSize?: NullableGridSize;
  },
): { start: BindingStrategy; end: BindingStrategy } => {
  const startIdx = 0;
  const endIdx = arrow.points.length - 1;
  const startDragged = draggingPoints.has(startIdx);
  const endDragged = draggingPoints.has(endIdx);

  let start: BindingStrategy = { element: undefined };
  let end: BindingStrategy = { element: undefined };

  if (arrow.points.length < 2) {
    console.error(
      "Attempting to bind a linear element with less than 2 points",
    );
    // a single-point can't be bound -> cancel
    return { start: { element: undefined }, end: { element: undefined } };
  }

  // If none of the ends are dragged, we don't change anything
  if (!startDragged && !endDragged) {
    return { start, end };
  }

  // If both ends are dragged, we don't bind to anything
  // and break existing bindings
  if (startDragged && endDragged) {
    return { start: { element: null }, end: { element: null } };
  }

  // If binding is disabled and an endpoint is dragged,
  // we actively break the end binding
  if (!isBindingEnabled(appState)) {
    start = startDragged ? { element: null } : start;
    end = endDragged ? { element: null } : end;

    return { start, end };
  }

  // Handle simpler elbow arrow binding
  if (isElbowArrow(arrow)) {
    return bindingStrategyForElbowArrowEndpointDragging(
      arrow,
      draggingPoints,
      elementsMap,
      elements,
      opts?.zoom,
    );
  }

  const localPoint = draggingPoints.get(
    startDragged ? startIdx : endIdx,
  )?.point;
  invariant(
    localPoint,
    `Local point must be defined for ${
      startDragged ? "start" : "end"
    } dragging`,
  );
  const globalPoint = LinearElementEditor.getPointGlobalCoordinates(
    arrow,
    localPoint,
    elementsMap,
  );
  const hit = getHoveredElementForBinding(
    opts?.angleLocked || appState.gridModeEnabled
      ? pointFrom<GlobalPoint>(scenePointerX, scenePointerY)
      : globalPoint,
    elements,
    elementsMap,
    maxBindingDistance_simple(appState.zoom),
  );
  const pointInElement =
    hit &&
    (opts?.angleLocked
      ? isPointInElement(
          pointFrom<GlobalPoint>(scenePointerX, scenePointerY),
          hit,
          elementsMap,
        )
      : isPointInElement(globalPoint, hit, elementsMap));
  // 另一端一律不动。原先这里用三条分支（旧的 `mode === "inside"`、
  // `initialState` 里那个「对角投影出来的备用焦点」、angleLocked 的对角投影）去
  // 重算另一端的落点，那是为了在旧锚点语义下维持它「贴在哪条边」；端点现在在建连
  // 那一刻就定死，拖这一端没有任何理由改写另一端。
  const keep: BindingStrategy = { element: undefined };

  const current: BindingStrategy = hit
    ? {
        element: hit,
        focusPoint:
          pointInElement || opts?.altKey
            ? globalPoint
            : projectAttachPointOntoDiagonal(
                arrow,
                opts?.angleLocked
                  ? globalPoint
                  : appState.gridModeEnabled
                  ? snapBoundPointToGrid(
                      pointFrom<GlobalPoint>(scenePointerX, scenePointerY),
                      hit,
                      elementsMap,
                      appState.gridSize as NullableGridSize,
                      arrow,
                      LinearElementEditor.getPointAtIndexGlobalCoordinates(
                        arrow,
                        startDragged ? 1 : -2,
                        elementsMap,
                      ),
                    )
                  : globalPoint,
                hit,
                startDragged ? "start" : "end",
                elementsMap,
                appState.zoom,
                appState.isMidpointSnappingEnabled &&
                  !opts?.angleLocked &&
                  !appState.gridModeEnabled,
              ) || globalPoint,
      }
    : { element: null };

  return {
    start: startDragged ? current : keep,
    end: endDragged ? current : keep,
  };
};

export const bindOrUnbindBindingElements = (
  selectedArrows: NonDeleted<ExcalidrawLinearElement>[],
  scene: Scene,
  appState: AppState,
): void => {
  selectedArrows.forEach((arrow) => {
    bindOrUnbindBindingElement(
      arrow,
      new Map(),
      Infinity,
      Infinity,
      scene,
      appState,
    );
  });
};

/**
 * Writes a binding onto the arrow and records the arrow on the bind target,
 * keeping the two sides of the relationship in step.
 */
const applyBinding = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  bindableElement: NonDeleted<ExcalidrawBindableElement>,
  binding: ElementBinding,
  startOrEnd: "start" | "end",
  scene: Scene,
): void => {
  scene.mutateElement(arrow, {
    [startOrEnd === "start" ? "startBinding" : "endBinding"]: binding,
  });

  const boundElementsMap = arrayToMap(bindableElement.boundElements || []);
  if (!boundElementsMap.has(arrow.id)) {
    scene.mutateElement(bindableElement, {
      boundElements: (bindableElement.boundElements || []).concat({
        id: arrow.id,
        type: "arrow",
      }),
    });
  }
};

export const bindBindingElement = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  hoveredElement: NonDeleted<ExcalidrawBindableElement>,
  startOrEnd: "start" | "end",
  scene: Scene,
  focusPoint?: GlobalPoint,
  shouldSnapToOutline = true,
  isMidpointSnappingEnabled = true,
): void => {
  const elementsMap = scene.getNonDeletedElementsMap();

  let binding: ElementBinding;

  if (isElbowArrow(arrow)) {
    binding = {
      elementId: hoveredElement.id,
      ...calculateAttachPointForElbowArrowBinding(
        arrow,
        hoveredElement,
        startOrEnd,
        elementsMap,
        shouldSnapToOutline,
        isMidpointSnappingEnabled,
      ),
    };
  } else {
    // 端点在**建连这一刻**定死（见 resolveAttachPointForNonElbowBinding）
    binding = {
      elementId: hoveredElement.id,
      ...resolveAttachPointForNonElbowBinding(
        arrow,
        hoveredElement,
        startOrEnd,
        elementsMap,
        focusPoint,
        shouldSnapToOutline,
      ),
    };
  }

  applyBinding(arrow, hoveredElement, binding, startOrEnd, scene);
};

export const unbindBindingElement = (
  arrow: ExcalidrawLinearElement,
  startOrEnd: "start" | "end",
  scene: Scene,
): ExcalidrawBindableElement["id"] | null => {
  const field = startOrEnd === "start" ? "startBinding" : "endBinding";
  const binding = arrow[field];

  if (binding == null) {
    return null;
  }

  const oppositeBinding =
    arrow[startOrEnd === "start" ? "endBinding" : "startBinding"];
  if (!oppositeBinding || oppositeBinding.elementId !== binding.elementId) {
    // Only remove the record on the bound element if the other
    // end is not bound to the same element
    const boundElement = scene
      .getNonDeletedElementsMap()
      .get(binding.elementId) as NonDeleted<ExcalidrawBindableElement>;
    if (boundElement) {
      scene.mutateElement(boundElement, {
        boundElements: boundElement.boundElements?.filter(
          (element) => element.id !== arrow.id,
        ),
      });
    }
  }

  scene.mutateElement(arrow, { [field]: null });

  return binding.elementId;
};

/**
 * 元素**类型**转换后把绑定重新锚到新轮廓上。
 *
 * 转换保住包围盒、却换掉轮廓（矩形 → 星形 / 八边形 / 大括号…），归一化的
 * `attachPoint` 虽随盒刚性映射，落点却可能离新轮廓上百像素。这与刚性跟随不冲突：
 * 刚性管的是**同一轮廓**下的几何变化；换了轮廓就得重新求一次交点。不变量见
 * `convertElementType.binding.test.tsx`（端点须落在新轮廓的 gap 之内）。
 */
export const reanchorBindingsToOutline = (
  changedElement: NonDeleted<ExcalidrawBindableElement>,
  scene: Scene,
) => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const isBrace = isShapeWithIdIn(changedElement, ["brace", "brace-reverse"]);
  // Open composite shapes such as braces occupy only one side of their
  // element bounds. Use the element's transform center for the reanchor ray;
  // the visual bounds center may sit outside the open path.
  const center = isBrace
    ? pointFrom<GlobalPoint>(
        changedElement.x + changedElement.width / 2,
        changedElement.y + changedElement.height / 2,
      )
    : elementCenterPoint(changedElement, elementsMap);
  const reach = Math.max(changedElement.width, changedElement.height) * 2;

  boundElementsVisitor(elementsMap, changedElement, (element) => {
    if (!isLinearElement(element) || !isNonDeletedElement(element)) {
      return;
    }

    const updates: {
      startBinding?: ElementBinding;
      endBinding?: ElementBinding;
    } = {};

    for (const startOrEnd of ["startBinding", "endBinding"] as const) {
      const binding = element[startOrEnd];
      if (binding?.elementId !== changedElement.id) {
        continue;
      }

      const startOrEndName = startOrEnd === "startBinding" ? "start" : "end";

      if (isElbowArrow(element)) {
        updates[startOrEnd] = {
          ...binding,
          ...calculateAttachPointForElbowArrowBinding(
            element,
            changedElement,
            startOrEndName,
            elementsMap,
          ),
        };
        continue;
      }

      const focusPoint = getGlobalAttachPointForBindableElement(
        binding.attachPoint,
        changedElement,
        elementsMap,
      );

      const bindingGap = getBindingGap(changedElement, element);
      // 只有大括号这类**开路径**才看「是否已贴着路径」：它们只占包围盒的一侧，
      // 不能一律重锚。其余图形无条件重锚 —— 刚性映射会把点甩到新轮廓的内侧或
      // 外侧，两者都算「没贴住」（原先是靠每次几何变化重投影兜住的）。
      if (
        isBrace &&
        distanceToElement(changedElement, elementsMap, focusPoint) <= bindingGap
      ) {
        continue;
      }

      const direction = vectorFromPoint(focusPoint, center);
      if (direction[0] === 0 && direction[1] === 0) {
        continue;
      }
      const rayToOutline = (sign: number) =>
        intersectElementWithLineSegment(
          changedElement,
          elementsMap,
          lineSegment(
            center,
            pointFromVector(
              vectorScale(vectorNormalize(direction), reach * sign),
              center,
            ),
          ),
          // attachPoint 现在就是**端点**本身（悬空一个 binding gap），重锚要连 gap 一起算
          getBindingGap(changedElement, element),
        );
      const intersections = rayToOutline(1);
      if (intersections.length === 0 && isBrace) {
        intersections.push(...rayToOutline(-1));
      }
      const outlinePoint = intersections.sort(
        (a, b) =>
          pointDistanceSq(a, focusPoint) - pointDistanceSq(b, focusPoint),
      )[0];

      if (!outlinePoint) {
        continue;
      }

      updates[startOrEnd] = {
        ...binding,
        ...calculateAttachPointForNonElbowArrowBinding(
          element,
          changedElement,
          startOrEndName,
          elementsMap,
          outlinePoint,
        ),
      };
    }

    if (updates.startBinding || updates.endBinding) {
      scene.mutateElement(element, updates);
    }
  });
};

// Supports translating, rotating and scaling `changedElement` with bound
// linear elements.
export const updateBoundElements = (
  changedElement: NonDeletedExcalidrawElement,
  scene: Scene,
  options?: {
    simultaneouslyUpdated?: readonly NonDeletedExcalidrawElement[];
    simultaneouslyUpdatedElementIds?: ReadonlySet<string>;
    changedElements?: Map<string, ExcalidrawElement>;
  },
) => {
  if (!isBindableElement(changedElement)) {
    return;
  }

  const { simultaneouslyUpdated } = options ?? {};
  const simultaneouslyUpdatedElementIds =
    options?.simultaneouslyUpdatedElementIds ??
    getSimultaneouslyUpdatedElementIds(simultaneouslyUpdated);

  let elementsMap: ElementsMap = scene.getNonDeletedElementsMap();
  if (options?.changedElements) {
    elementsMap = new Map(elementsMap) as typeof elementsMap;
    options.changedElements.forEach((element) => {
      elementsMap.set(element.id, element);
    });
  }

  const visitor = (element: ExcalidrawElement | undefined) => {
    // SAFETY: This should never happen, but log it just in case
    if (element && !isNonDeletedElement(element)) {
      console.error(
        "[NONDELETED][INVARIANT] updateBoundElements(): `isDeleted: true` in visitor",
      );
    }

    if (!isLinearElement(element) || !isNonDeletedElement(element)) {
      return;
    }

    // In case the boundElements are stale
    if (!doesNeedUpdate(element, changedElement)) {
      return;
    }

    // Check for intersections before updating bound elements incase connected elements overlap
    const startBindingElement = element.startBinding
      ? elementsMap.get(element.startBinding.elementId)
      : null;
    const endBindingElement = element.endBinding
      ? // PERF: If the arrow is bound to the same element on both ends.
        startBindingElement?.id === element.endBinding.elementId
        ? startBindingElement
        : elementsMap.get(element.endBinding.elementId)
      : null;

    // `linearElement` is being moved/scaled already, just update the binding
    if (simultaneouslyUpdatedElementIds.has(element.id)) {
      return;
    }

    const updates = bindableElementsVisitor(
      elementsMap,
      element,
      (bindableElement, bindingProp) => {
        if (
          bindableElement &&
          isBindableElement(bindableElement) &&
          (bindingProp === "startBinding" || bindingProp === "endBinding") &&
          (changedElement.id === element[bindingProp]?.elementId ||
            changedElement.id ===
              element[
                bindingProp === "startBinding" ? "endBinding" : "startBinding"
              ]?.elementId)
        ) {
          const point = updateBoundPoint(
            element,
            element[bindingProp],
            bindableElement,
            elementsMap,
          );

          if (point) {
            return [
              bindingProp === "startBinding" ? 0 : element.points.length - 1,
              { point },
            ] as MapEntry<PointsPositionUpdates>;
          }
        }

        return null;
      },
    ).filter(
      (update): update is MapEntry<PointsPositionUpdates> => update !== null,
    );

    LinearElementEditor.movePoints(element, scene, new Map(updates), {
      moveMidPointsWithElement:
        !!startBindingElement &&
        startBindingElement?.id === endBindingElement?.id,
    });

    const boundText = getBoundTextElement(element, elementsMap);
    if (boundText && !boundText.isDeleted) {
      handleBindTextResize(element, scene, false);
    }
  };

  boundElementsVisitor(elementsMap, changedElement, visitor);
};

const updateArrowBindings = (
  latestElement: NonDeleted<ExcalidrawLinearElement>,
  startOrEnd: "startBinding" | "endBinding",
  elementsMap: NonDeletedSceneElementsMap,
  scene: Scene,
  appState: AppState,
) => {
  invariant(
    !isElbowArrow(latestElement),
    "Elbow arrows not supported for indirect updates",
  );

  const binding = latestElement[startOrEnd];
  const bindableElement =
    binding &&
    (elementsMap.get(
      binding.elementId,
    ) as NonDeleted<ExcalidrawBindableElement>);
  const point = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    latestElement,
    startOrEnd === "startBinding" ? 0 : -1,
    elementsMap,
  );
  const hit =
    bindableElement &&
    hitElementItself({
      element: bindableElement,
      point,
      elementsMap,
      threshold: maxBindingDistance_simple(appState.zoom),
    });
  const strategyName = startOrEnd === "startBinding" ? "start" : "end";
  unbindBindingElement(latestElement, strategyName, scene);
  if (hit) {
    const pointIdx =
      startOrEnd === "startBinding" ? 0 : latestElement.points.length - 1;
    const localPoint = latestElement.points[pointIdx];
    const strategy =
      getBindingStrategyForDraggingBindingElementEndpoints_simple(
        latestElement,
        new Map([[pointIdx, { point: localPoint }]]),
        point[0],
        point[1],
        elementsMap,
        scene.getNonDeletedElements(),
        appState,
      );
    const next = strategy[strategyName];
    if (next && next.element && next.element.id === bindableElement.id) {
      bindBindingElement(
        latestElement,
        bindableElement,
        strategyName,
        scene,
        next.focusPoint,
      );
    }
  }
};

export const updateBindings = (
  latestElement: NonDeletedExcalidrawElement,
  scene: Scene,
  appState: AppState,
  options?: {
    simultaneouslyUpdated?: readonly NonDeletedExcalidrawElement[];
    newSize?: { width: number; height: number };
  },
) => {
  if (isLinearElement(latestElement)) {
    const elementsMap = scene.getNonDeletedElementsMap();

    if (latestElement.startBinding) {
      updateArrowBindings(
        latestElement,
        "startBinding",
        elementsMap,
        scene,
        appState,
      );
    }

    if (latestElement.endBinding) {
      updateArrowBindings(
        latestElement,
        "endBinding",
        elementsMap,
        scene,
        appState,
      );
    }
  } else {
    updateBoundElements(latestElement, scene, {
      ...options,
      changedElements: new Map([[latestElement.id, latestElement]]),
    });
  }
};

const doesNeedUpdate = (
  boundElement: NonDeleted<ExcalidrawLinearElement>,
  changedElement: ExcalidrawBindableElement,
) => {
  return (
    boundElement.startBinding?.elementId === changedElement.id ||
    boundElement.endBinding?.elementId === changedElement.id
  );
};

const getSimultaneouslyUpdatedElementIds = (
  simultaneouslyUpdated: readonly ExcalidrawElement[] | undefined,
): Set<ExcalidrawElement["id"]> => {
  return new Set((simultaneouslyUpdated || []).map((element) => element.id));
};

export const getHeadingForElbowArrowSnap = (
  p: Readonly<GlobalPoint>,
  otherPoint: Readonly<GlobalPoint>,
  bindableElement: ExcalidrawBindableElement | undefined | null,
  aabb: Bounds | undefined | null,
  origPoint: GlobalPoint,
  elementsMap: ElementsMap,
  zoom?: AppState["zoom"],
): Heading => {
  const otherPointHeading = vectorToHeading(vectorFromPoint(otherPoint, p));

  if (!bindableElement || !aabb) {
    return otherPointHeading;
  }

  const distance = getDistanceForBinding(
    origPoint,
    bindableElement,
    elementsMap,
    zoom,
  );

  if (!distance) {
    return vectorToHeading(
      vectorFromPoint(p, elementCenterPoint(bindableElement, elementsMap)),
    );
  }

  return headingForPointFromElement(bindableElement, aabb, p);
};

const getDistanceForBinding = (
  point: Readonly<GlobalPoint>,
  bindableElement: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
  zoom?: AppState["zoom"],
) => {
  const distance = distanceToElement(bindableElement, elementsMap, point);
  const bindDistance = maxBindingDistance_simple(zoom);

  return distance > bindDistance ? null : distance;
};

export const bindPointToSnapToElementOutline = (
  arrowElement: ExcalidrawLinearElement,
  bindableElement: ExcalidrawBindableElement,
  startOrEnd: "start" | "end",
  elementsMap: ElementsMap,
  customIntersector?: LineSegment<GlobalPoint>,
  isMidpointSnappingEnabled = true,
): GlobalPoint => {
  const elbowed = isElbowArrow(arrowElement);
  const point = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    arrowElement,
    startOrEnd === "start" ? 0 : -1,
    elementsMap,
  );

  if (arrowElement.points.length < 2) {
    // New arrow creation, so no snapping
    return point;
  }

  const edgePoint =
    isRectanguloidElement(bindableElement) && elbowed
      ? avoidRectangularCorner(
          arrowElement,
          bindableElement,
          elementsMap,
          point,
        )
      : point;
  const adjacentPoint =
    customIntersector && !elbowed
      ? customIntersector[1]
      : LinearElementEditor.getPointAtIndexGlobalCoordinates(
          arrowElement,
          startOrEnd === "start" ? 1 : -2,
          elementsMap,
        );
  // 投影 gap：折线档的落点就是这里求出的交点，所以文本目标同样不留 gap
  // （见 `getProjectionBindingGap`）。
  const bindingGap = getProjectionBindingGap(bindableElement, arrowElement);
  const aabb = aabbForElement(bindableElement, elementsMap);
  const bindableCenter = getCenterForBounds(aabb);

  let intersection: GlobalPoint | null = null;
  if (elbowed) {
    const isHorizontal = headingIsHorizontal(
      headingForPointFromElement(bindableElement, aabb, point),
    );
    const snapPoint = isMidpointSnappingEnabled
      ? snapToMid(bindableElement, elementsMap, edgePoint, 0.05, arrowElement)
      : undefined;
    const resolved = snapPoint || point;
    const otherPoint = pointFrom<GlobalPoint>(
      isHorizontal ? bindableCenter[0] : resolved[0],
      !isHorizontal ? bindableCenter[1] : resolved[1],
    );
    const intersector =
      customIntersector ??
      lineSegment(
        otherPoint,
        pointFromVector(
          vectorScale(
            vectorNormalize(vectorFromPoint(resolved, otherPoint)),
            Math.max(bindableElement.width, bindableElement.height) * 2,
          ),
          otherPoint,
        ),
      );
    intersection = intersectElementWithLineSegment(
      bindableElement,
      elementsMap,
      intersector,
      bindingGap,
    ).sort(pointDistanceSq)[0];

    if (!intersection) {
      const anotherPoint = pointFrom<GlobalPoint>(
        !isHorizontal ? bindableCenter[0] : resolved[0],
        isHorizontal ? bindableCenter[1] : resolved[1],
      );
      const anotherIntersector = lineSegment(
        anotherPoint,
        pointFromVector(
          vectorScale(
            vectorNormalize(vectorFromPoint(resolved, anotherPoint)),
            Math.max(bindableElement.width, bindableElement.height) * 2,
          ),
          anotherPoint,
        ),
      );
      intersection = intersectElementWithLineSegment(
        bindableElement,
        elementsMap,
        anotherIntersector,
        // 兜底那一趟的基准 gap 历来是折线常量（不含 strokeWidth 补偿），沿用其
        // 数值；但文本目标的就不留 gap —— 这一趟同样在决定端点落点。
        getProjectionBindingGap(
          bindableElement,
          arrowElement,
          BASE_BINDING_GAP_ELBOW,
        ),
      ).sort(pointDistanceSq)[0];
    }
  } else {
    let intersector = customIntersector;
    if (!intersector) {
      const halfVector = vectorScale(
        vectorNormalize(vectorFromPoint(edgePoint, adjacentPoint)),
        pointDistance(edgePoint, adjacentPoint) +
          Math.max(bindableElement.width, bindableElement.height) +
          bindingGap * 2,
      );
      intersector =
        customIntersector ??
        lineSegment(
          pointFromVector(halfVector, adjacentPoint),
          pointFromVector(vectorScale(halfVector, -1), adjacentPoint),
        );
    }

    intersection =
      pointDistance(edgePoint, adjacentPoint) < 1
        ? edgePoint
        : intersectElementWithLineSegment(
            bindableElement,
            elementsMap,
            intersector,
            bindingGap,
          ).sort(
            (g, h) =>
              pointDistanceSq(g, adjacentPoint) -
              pointDistanceSq(h, adjacentPoint),
          )[0];
  }

  // 求交一无所获时**原样返回落点**（`edgePoint` 就是落点自己）。折线档有两档已知的
  // 几何退化会落进这一支，都是 HEAD 既有行为，本波只记录不修：
  //
  // (1) 轴对齐相切：落点恰好落在目标某条**外扩边所在的平面**上、另一轴又在盒外时，
  //     主射线与那条边共线（`intersectElementWithLineSegment` 对共线不返回交点），
  //     兜底那一趟也整条错过轮廓 → 两支都求不到交点，落点在轮廓外被原样留下、最多脱
  //     开约 15px（低缩放下约 20px）。**这一档对本波「文本 gap 归零」敏感**：那条相切
  //     平面原本在 `y = text.y - gap`（带小数，几乎撞不上），文本 gap 归零后挪到了文
  //     本自身的边平面（常为整数），网格模式下会**系统性**撞上（实测命中：走这一支的文本
  //     目标 662 点，其中 356 点本就落在轮廓上、原样返回无害，真正被留在轮廓外的是
  //     306 点；矩形 360 点全在轮廓外；非折线 0 点）。要修得动共线语义，影响面远超本波，故不修。
  // (2) 落点贴着目标中心：`snapToMid` 判「离中心太近」而不吸附，`resolved` 留在中心
  //     附近，`otherPoint` / `anotherPoint` 随即与它重合 → 两条射线方向退化（零长），
  //     求交同样无从谈起。落点于是被原样留在**图形内部**（换矩形 / 椭圆同样复现）——
  //     `arrowEndpointTextBinding.test.tsx` 里那条折线用例特意把落点挪到「内部靠左」
  //     绕开它。同样不修。
  if (
    !intersection ||
    // Too close to determine vector from intersection to edgePoint
    pointDistanceSq(edgePoint, intersection) < PRECISION
  ) {
    return edgePoint;
  }

  return intersection;
};

/**
 * 落点落在矩形类目标的角区时，把它挪到「离开角点、贴着最近那条边」的位置。返回的
 * 点就是端点本身（求交失败、或交点离得太近时原样返回），所以 gap 走投影口径 ——
 * 文本目标贴在文本的角上（gap 0），不是角外一个 gap。
 */
export const avoidRectangularCorner = (
  arrowElement: ExcalidrawLinearElement,
  bindTarget: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
  p: GlobalPoint,
): GlobalPoint => {
  const center = elementCenterPoint(bindTarget, elementsMap);
  const nonRotatedPoint = pointRotateRads(
    p,
    center,
    -bindTarget.angle as Radians,
  );

  const bindingGap = getProjectionBindingGap(bindTarget, arrowElement);

  if (nonRotatedPoint[0] < bindTarget.x && nonRotatedPoint[1] < bindTarget.y) {
    // Top left
    if (nonRotatedPoint[1] - bindTarget.y > -bindingGap) {
      return pointRotateRads<GlobalPoint>(
        pointFrom(bindTarget.x - bindingGap, bindTarget.y),
        center,
        bindTarget.angle,
      );
    }
    return pointRotateRads(
      pointFrom(bindTarget.x, bindTarget.y - bindingGap),
      center,
      bindTarget.angle,
    );
  } else if (
    nonRotatedPoint[0] < bindTarget.x &&
    nonRotatedPoint[1] > bindTarget.y + bindTarget.height
  ) {
    // Bottom left
    if (nonRotatedPoint[0] - bindTarget.x > -bindingGap) {
      return pointRotateRads(
        pointFrom(bindTarget.x, bindTarget.y + bindTarget.height + bindingGap),
        center,
        bindTarget.angle,
      );
    }
    return pointRotateRads(
      pointFrom(bindTarget.x - bindingGap, bindTarget.y + bindTarget.height),
      center,
      bindTarget.angle,
    );
  } else if (
    nonRotatedPoint[0] > bindTarget.x + bindTarget.width &&
    nonRotatedPoint[1] > bindTarget.y + bindTarget.height
  ) {
    // Bottom right
    if (nonRotatedPoint[0] - bindTarget.x < bindTarget.width + bindingGap) {
      return pointRotateRads(
        pointFrom(
          bindTarget.x + bindTarget.width,
          bindTarget.y + bindTarget.height + bindingGap,
        ),
        center,
        bindTarget.angle,
      );
    }
    return pointRotateRads(
      pointFrom(
        bindTarget.x + bindTarget.width + bindingGap,
        bindTarget.y + bindTarget.height,
      ),
      center,
      bindTarget.angle,
    );
  } else if (
    nonRotatedPoint[0] > bindTarget.x + bindTarget.width &&
    nonRotatedPoint[1] < bindTarget.y
  ) {
    // Top right
    if (nonRotatedPoint[0] - bindTarget.x < bindTarget.width + bindingGap) {
      return pointRotateRads(
        pointFrom(bindTarget.x + bindTarget.width, bindTarget.y - bindingGap),
        center,
        bindTarget.angle,
      );
    }
    return pointRotateRads(
      pointFrom(bindTarget.x + bindTarget.width + bindingGap, bindTarget.y),
      center,
      bindTarget.angle,
    );
  }

  return p;
};

export const snapToMid = (
  bindTarget: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
  p: GlobalPoint,
  tolerance: number = 0.05,
  arrowElement?: ExcalidrawLinearElement,
): GlobalPoint | undefined => {
  const { x, y, width, height, angle } = bindTarget;
  const center = elementCenterPoint(bindTarget, elementsMap, -0.1, -0.1);
  const nonRotated = pointRotateRads(p, center, -angle as Radians);

  const bindingGap = arrowElement ? getBindingGap(bindTarget, arrowElement) : 0;

  // snap-to-center point is adaptive to element size, but we don't want to go
  // above and below certain px distance
  const verticalThreshold = clamp(tolerance * height, 5, 80);
  const horizontalThreshold = clamp(tolerance * width, 5, 80);

  // Too close to the center makes it hard to resolve direction precisely
  if (pointDistance(center, nonRotated) < bindingGap) {
    return undefined;
  }

  if (
    isShapeElement(bindTarget) &&
    !isShapeWithIdIn(bindTarget, ["rectangle", "diamond", "ellipse"])
  ) {
    let index: number | undefined;
    if (
      nonRotated[0] <= x + width / 2 &&
      Math.abs(nonRotated[1] - center[1]) < verticalThreshold
    ) {
      index = 2;
    } else if (
      nonRotated[1] <= y + height / 2 &&
      Math.abs(nonRotated[0] - center[0]) < horizontalThreshold
    ) {
      index = 3;
    } else if (
      nonRotated[0] >= x + width / 2 &&
      Math.abs(nonRotated[1] - center[1]) < verticalThreshold
    ) {
      index = 0;
    } else if (
      nonRotated[1] >= y + height / 2 &&
      Math.abs(nonRotated[0] - center[0]) < horizontalThreshold
    ) {
      index = 1;
    }
    if (index === undefined) {
      return undefined;
    }
    const anchor = getCompositeShapeAnchors(bindTarget)[index];
    if (bindingGap === 0) {
      return anchor;
    }
    const dx = anchor[0] - center[0];
    const dy = anchor[1] - center[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return anchor;
    }
    const extent = Math.max(width, height) + bindingGap * 2;
    const outside = pointFrom<GlobalPoint>(
      anchor[0] + (dx / length) * extent,
      anchor[1] + (dy / length) * extent,
    );
    const hits = intersectElementWithLineSegment(
      bindTarget,
      elementsMap,
      lineSegment(center, outside),
      bindingGap,
    );
    return (
      hits.sort(
        (a, b) => pointDistanceSq(a, anchor) - pointDistanceSq(b, anchor),
      )[0] ?? anchor
    );
  }

  if (
    nonRotated[0] <= x + width / 2 &&
    nonRotated[1] > center[1] - verticalThreshold &&
    nonRotated[1] < center[1] + verticalThreshold
  ) {
    // LEFT
    return pointRotateRads(
      pointFrom<GlobalPoint>(x - bindingGap, center[1]),
      center,
      angle,
    );
  } else if (
    nonRotated[1] <= y + height / 2 &&
    nonRotated[0] > center[0] - horizontalThreshold &&
    nonRotated[0] < center[0] + horizontalThreshold
  ) {
    // TOP
    return pointRotateRads(
      pointFrom<GlobalPoint>(center[0], y - bindingGap),
      center,
      angle,
    );
  } else if (
    nonRotated[0] >= x + width / 2 &&
    nonRotated[1] > center[1] - verticalThreshold &&
    nonRotated[1] < center[1] + verticalThreshold
  ) {
    // RIGHT
    return pointRotateRads(
      pointFrom<GlobalPoint>(x + width + bindingGap, center[1]),
      center,
      angle,
    );
  } else if (
    nonRotated[1] >= y + height / 2 &&
    nonRotated[0] > center[0] - horizontalThreshold &&
    nonRotated[0] < center[0] + horizontalThreshold
  ) {
    // DOWN
    return pointRotateRads(
      pointFrom<GlobalPoint>(center[0], y + height + bindingGap),
      center,
      angle,
    );
  } else if (isShapeWithId(bindTarget, "diamond")) {
    const distance = bindingGap;
    const topLeft = pointFrom<GlobalPoint>(
      x + width / 4 - distance,
      y + height / 4 - distance,
    );
    const topRight = pointFrom<GlobalPoint>(
      x + (3 * width) / 4 + distance,
      y + height / 4 - distance,
    );
    const bottomLeft = pointFrom<GlobalPoint>(
      x + width / 4 - distance,
      y + (3 * height) / 4 + distance,
    );
    const bottomRight = pointFrom<GlobalPoint>(
      x + (3 * width) / 4 + distance,
      y + (3 * height) / 4 + distance,
    );

    if (
      pointDistance(topLeft, nonRotated) <
      Math.max(horizontalThreshold, verticalThreshold)
    ) {
      return pointRotateRads(topLeft, center, angle);
    }
    if (
      pointDistance(topRight, nonRotated) <
      Math.max(horizontalThreshold, verticalThreshold)
    ) {
      return pointRotateRads(topRight, center, angle);
    }
    if (
      pointDistance(bottomLeft, nonRotated) <
      Math.max(horizontalThreshold, verticalThreshold)
    ) {
      return pointRotateRads(bottomLeft, center, angle);
    }
    if (
      pointDistance(bottomRight, nonRotated) <
      Math.max(horizontalThreshold, verticalThreshold)
    ) {
      return pointRotateRads(bottomRight, center, angle);
    }
  }

  return undefined;
};

/**
 * Snaps a bound arrow endpoint to the grid on the axis parallel to the
 * bindable element's side, while preserving the binding gap distance on the
 * perpendicular axis. In other words, the grid axis closest to the side's
 * perpendicular (normal) is used as the snap axis and the other axis is kept at
 * the binding gap distance.
 */
const snapBoundPointToGrid = (
  outlinePoint: GlobalPoint,
  bindableElement: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
  gridSize: NullableGridSize,
  arrowElement: ExcalidrawLinearElement,
  adjacentPoint?: GlobalPoint,
): GlobalPoint => {
  if (!gridSize) {
    return outlinePoint;
  }

  const aabb = aabbForElement(bindableElement, elementsMap);
  // For ellipses and diamonds use the arrow's incoming direction instead of
  // the position-based heading, which can give the wrong axis when the
  // outline point is near a cardinal zone or an angled diamond face.
  const heading =
    adjacentPoint && isShapeWithIdIn(bindableElement, ["ellipse", "diamond"])
      ? vectorToHeading(vectorFromPoint(adjacentPoint, outlinePoint))
      : headingForPointFromElement(bindableElement, aabb, outlinePoint);

  const bindingGap = getBindingGap(bindableElement, arrowElement);
  const extent =
    Math.max(bindableElement.width, bindableElement.height) + bindingGap * 2;
  const center = getCenterForBounds(aabb);

  // Both heading strategies above return global-axis directions.
  const absNX = Math.abs(heading[0]);
  const absNY = Math.abs(heading[1]);
  if (absNX >= absNY) {
    // Global X is closest to the perpendicular so snap Y, intersect horizontal line
    const [, snappedY] = getGridPoint(
      outlinePoint[0],
      outlinePoint[1],
      gridSize,
    );
    const intersector = lineSegment<GlobalPoint>(
      pointFrom<GlobalPoint>(center[0] - extent, snappedY),
      pointFrom<GlobalPoint>(center[0] + extent, snappedY),
    );
    const intersection = intersectElementWithLineSegment(
      bindableElement,
      elementsMap,
      intersector,
      bindingGap,
    ).sort(
      (a, b) =>
        pointDistanceSq(a, outlinePoint) - pointDistanceSq(b, outlinePoint),
    )[0];

    return intersection ?? pointFrom<GlobalPoint>(outlinePoint[0], snappedY);
  }

  // Global Y is closest to the perpendicular so snap X, intersect vertical line
  const [snappedX] = getGridPoint(outlinePoint[0], outlinePoint[1], gridSize);
  const intersector = lineSegment<GlobalPoint>(
    pointFrom<GlobalPoint>(snappedX, center[1] - extent),
    pointFrom<GlobalPoint>(snappedX, center[1] + extent),
  );
  const intersection = intersectElementWithLineSegment(
    bindableElement,
    elementsMap,
    intersector,
    bindingGap,
  ).sort(
    (a, b) =>
      pointDistanceSq(a, outlinePoint) - pointDistanceSq(b, outlinePoint),
  )[0];

  return intersection ?? pointFrom<GlobalPoint>(snappedX, outlinePoint[1]);
};

/**
 * 落点最近的那条**外扩边**：把落点搬进**未旋转的局部坐标系**，比较它到四条
 * 「外扩一个 gap 的边」的垂直距离（带符号，落在图形外为负），取最近的那条。
 *
 * 距离打平时按 right → bottom → left → top 的固定次序取值。次序本身没有几何
 * 含义，只为了让结果确定 —— 两轴距离恰好相等只发生在正中心、正角点、正方形边
 * 的中点这些对称位置；把 right / bottom 排在前面是因为「从图形内部往右下拖」
 * 是最常见的手势。
 */
const nearestOutlineEdge = (
  bindableElement: NonDeleted<ExcalidrawBindableElement>,
  focusPoint: GlobalPoint,
  elementsMap: ElementsMap,
  gap: number,
): { axis: "x" | "y"; sign: -1 | 1 } => {
  const { x, y, width, height } = bindableElement;
  const local = pointRotateRads(
    focusPoint,
    elementCenterPoint(bindableElement, elementsMap),
    -bindableElement.angle as Radians,
  );

  const candidates = [
    {
      axis: "x" as const,
      sign: 1 as const,
      distance: x + width + gap - local[0],
    },
    {
      axis: "y" as const,
      sign: 1 as const,
      distance: y + height + gap - local[1],
    },
    { axis: "x" as const, sign: -1 as const, distance: local[0] - (x - gap) },
    { axis: "y" as const, sign: -1 as const, distance: local[1] - (y - gap) },
  ];

  return candidates.reduce((a, b) => (b.distance < a.distance ? b : a));
};

/**
 * 退化回落的完整规则（落点与另一端重合、求交无从谈起时用）：
 *
 * 1. 沿**最近那条外扩边的外法线**、从落点向两侧各打一条射线，取外扩轮廓上离落点
 *    最近的那个交点。落点在图形内部时，这就是「沿垂直于最近边的方向就地出图形」，
 *    正是我们要补上的那条路径；落点贴在图形外侧时，反方向那一趟兜住。
 * 2. 上一步整条直线都错过轮廓（落点在最近边之外、且在正角点外侧；或轮廓是凹形、
 *    开口形）时，改为**朝图形中心**打 —— 交点必定在轮廓上，且落在落点这一侧。
 * 3. 仍不相交（开口轮廓外加落点已经离得很远，实际到不了）兜底：把落点搬到最近的
 *    那条**包围盒外扩边**上，另一轴夹进外扩区间。
 *
 * 射线与外扩轮廓求交、取离落点最近的那个交点，这两步与通用分支同源
 * （`intersectElementWithLineSegment` + `gap`），所以矩形、椭圆、菱形、复合形状
 * 走的是同一条几何口径，不需要按图形类型分支。
 */
const projectFocusPointOntoInflatedOutline = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  bindableElement: NonDeleted<ExcalidrawBindableElement>,
  focusPoint: GlobalPoint,
  elementsMap: ElementsMap,
): GlobalPoint => {
  const gap = getProjectionBindingGap(bindableElement, arrow);
  const { x, y, width, height } = bindableElement;
  const center = elementCenterPoint(bindableElement, elementsMap);
  const extent = Math.max(width, height, 1) * 2 + gap * 4;

  const cast = (direction: CurveNormal, length: number) =>
    intersectElementWithLineSegment(
      bindableElement,
      elementsMap,
      lineSegment(
        focusPoint,
        pointFrom<GlobalPoint>(
          focusPoint[0] + direction.x * length,
          focusPoint[1] + direction.y * length,
        ),
      ),
      gap,
    ).sort(
      (a, b) => pointDistanceSq(a, focusPoint) - pointDistanceSq(b, focusPoint),
    )[0];

  const edge = nearestOutlineEdge(
    bindableElement,
    focusPoint,
    elementsMap,
    gap,
  );
  const axisNormal = pointFrom<GlobalPoint>(
    edge.axis === "x" ? edge.sign : 0,
    edge.axis === "y" ? edge.sign : 0,
  );
  const [outwardX, outwardY] = pointRotateRads<GlobalPoint>(
    axisNormal,
    pointFrom<GlobalPoint>(0, 0),
    bindableElement.angle,
  );
  const outward: CurveNormal = { x: outwardX, y: outwardY };

  const alongNormal =
    cast(outward, extent) ?? cast({ x: -outward.x, y: -outward.y }, extent);
  if (alongNormal) {
    return alongNormal;
  }

  const toCenterX = center[0] - focusPoint[0];
  const toCenterY = center[1] - focusPoint[1];
  const distanceToCenter = Math.hypot(toCenterX, toCenterY);
  if (distanceToCenter > 0) {
    const alongCenter = cast(
      { x: toCenterX / distanceToCenter, y: toCenterY / distanceToCenter },
      extent + distanceToCenter,
    );
    if (alongCenter) {
      return alongCenter;
    }
  }

  // 兜底：把最近那根轴的坐标推到它的外扩边，另一轴夹进外扩区间
  const local = pointRotateRads(
    focusPoint,
    center,
    -bindableElement.angle as Radians,
  );
  const clamped =
    edge.axis === "x"
      ? pointFrom<GlobalPoint>(
          edge.sign === 1 ? x + width + gap : x - gap,
          clamp(local[1], y - gap, y + height + gap),
        )
      : pointFrom<GlobalPoint>(
          clamp(local[0], x - gap, x + width + gap),
          edge.sign === 1 ? y + height + gap : y - gap,
        );

  return pointRotateRads(
    clamped,
    pointFrom<GlobalPoint>(center[0], center[1]),
    bindableElement.angle,
  );
};

/**
 * 把「用户落点」（焦点）投到该元素**外扩一个 binding gap 的轮廓**上。端点在建连
 * 那一刻的落点就是它，之后只随图形做刚性变换 —— 重投影只发生在这一处、这一时。
 *
 * 射线取「焦点 → 另一端」（另一端优先由它自己的绑定解出；多段箭头取相邻点）；
 * 曲线档（`isCurvedArrow`）优先按**所依附边的外法线**落，那条法线与
 * `curveConnector.ts` 取端切线用的法线同源（都由比例判边），端点与端切线因此自洽。
 *
 * 射线给不出可用方向的两种情形（两端重合、整条射线错过轮廓 / 交点就是另一端自己）
 * 一律交给 `projectFocusPointOntoInflatedOutline` 就近吸附 —— **这条路径不会原样
 * 返回落点**，否则端点在图形内部被永久冻结。
 *
 * 目标是文本元素时 gap 为 0（见 `getProjectionBindingGap`），端点落在文本绑定边上。
 */
const projectPointOntoBoundElementOutline = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  startOrEnd: "startBinding" | "endBinding",
  bindableElement: NonDeleted<ExcalidrawBindableElement>,
  focusPoint: GlobalPoint,
  elementsMap: ElementsMap,
): GlobalPoint => {
  const otherBinding =
    startOrEnd === "startBinding" ? arrow.endBinding : arrow.startBinding;
  const otherBindableElement =
    otherBinding &&
    (elementsMap.get(otherBinding.elementId) as
      | NonDeleted<ExcalidrawBindableElement>
      | undefined);
  const otherFocusPoint =
    otherBinding && otherBindableElement
      ? getGlobalAttachPointForBindableElement(
          normalizeAttachPoint(otherBinding.attachPoint),
          otherBindableElement,
          elementsMap,
        )
      : undefined;
  const otherArrowPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    arrow,
    startOrEnd === "startBinding" ? 1 : -2,
    elementsMap,
  );
  const otherPoint =
    arrow.points.length === 2
      ? otherFocusPoint || otherArrowPoint
      : otherArrowPoint;
  // 另一端与落点重合时（新建箭头在 pointerdown 那一刻两端还叠在一起）射线退化成
  // 一点，求交无从谈起。这时**没有**可用的方向，改按「就近吸附到最近的那条外扩
  // 边」定方向 —— 见 projectFocusPointOntoInflatedOutline。落点在这里被永久冻结
  // （组合 A 的 attachPoint 就是端点本身），所以这一支**必须**返回轮廓上的点：
  // 原样返回落点会让端点留在图形内部。
  if (pointDistanceSq(focusPoint, otherPoint) <= 0) {
    return projectFocusPointOntoInflatedOutline(
      arrow,
      bindableElement,
      focusPoint,
      elementsMap,
    );
  }

  // 曲线档：锚点贴在该元素某条边上、且该边外法线朝向另一端时，沿法线外移一个 gap
  if (isCurvedArrow(arrow)) {
    const { attachPoint: focusRatio } =
      calculateAttachPointForNonElbowArrowBinding(
        arrow,
        bindableElement,
        startOrEnd === "startBinding" ? "start" : "end",
        elementsMap,
        focusPoint,
      );
    const normal = normalFromAttachPoint(normalizeAttachPoint(focusRatio));
    const gap = getProjectionBindingGap(bindableElement, arrow);
    if (
      normal &&
      hitElementItself({
        element: bindableElement,
        point: focusPoint,
        elementsMap,
        threshold: gap,
        overrideShouldTestInside: true,
      })
    ) {
      const [normalX, normalY] = pointRotateRads<GlobalPoint>(
        pointFrom<GlobalPoint>(normal.x, normal.y),
        pointFrom<GlobalPoint>(0, 0),
        bindableElement.angle,
      );
      if (
        normalX * (otherPoint[0] - focusPoint[0]) +
          normalY * (otherPoint[1] - focusPoint[1]) >
        0
      ) {
        return pointFrom<GlobalPoint>(
          focusPoint[0] + normalX * gap,
          focusPoint[1] + normalY * gap,
        );
      }
    }
  }

  // 通用：焦点与另一端的斜射线 ∩ 外扩 gap 的轮廓，取离另一端最近的交点
  // （文本目标 gap 为 0，即落在文本自己的绑定边上）
  const outlinePoint = intersectElementWithLineSegment(
    bindableElement,
    elementsMap,
    lineSegment(focusPoint, otherPoint),
    getProjectionBindingGap(bindableElement, arrow),
  ).sort(
    (a, b) => pointDistanceSq(a, otherPoint) - pointDistanceSq(b, otherPoint),
  )[0];

  // 交点落在**另一端自己身上**时射线什么也没告诉我们：另一端本身就贴在轮廓上
  // （两端都绑在同一个图形、落点又在图形内部时，射线折出去正好是它）。采用这个
  // 交点会把相邻两点连成零长的一段 —— 箭头就此塌缩成一个点。这种「目标自己就在
  // 轮廓上」的处境与两端重合的退化档没有区别 —— 同样没有可用方向，同样走就近吸附。
  //
  // 守卫防的是**塌缩本身**，不是「元素会被删掉」：箭头工具建的箭头在
  // `pointerSession.ts`（`isLinearElement(newElement) && activeTool.type !==
  // "autoshape"` 那一支）无条件 return，`isInvisiblySmallElement` 的删除检查根本
  // 走不到，零长箭头会**留在场景里**；只有 autoshape 一类工具会真被删。
  //
  // 多段箭头（`points.length > 2`）时 `otherPoint` 是**相邻内点**而非另一端，
  // 触发点因此是「这一段塌成零长」：守卫把它按同一个口径放开（改走就近吸附），
  // 相邻两点随即分开到轮廓的不同位置。偏紧是刻意的 —— 零长的中间段没有任何
  // 有意义的几何，本来也画不出方向。
  if (
    outlinePoint &&
    !pointsEqual<GlobalPoint>(
      outlinePoint,
      otherPoint,
      INVISIBLY_SMALL_ELEMENT_SIZE,
    )
  ) {
    return outlinePoint;
  }

  // 走到这里要么整条射线都错过轮廓（焦点与另一端都在图形内部、斜射线还没等到
  // 穿出图形就结束了），要么交点就是另一端自己。两种情形都**没有可用的方向**：
  // 原样返回落点会让端点在图形内部被永久冻结（`attachPoint` 就是端点本身），
  // 所以与两端重合的退化档一样走「就近吸附到最近那条外扩边」。
  return projectFocusPointOntoInflatedOutline(
    arrow,
    bindableElement,
    focusPoint,
    elementsMap,
  );
};

/**
 * 建连时该端的 `attachPoint`：把落点投到「外扩一个 binding gap 的轮廓」上再取比例，
 * 于是存下来的比例就是端点本身。`bindBindingElement` 与快速创建的预演
 * （`App.quickCreate`）共用它 —— 预演与落地必须逐位一致，口径不能有第二份。
 */
export const resolveAttachPointForNonElbowBinding = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  hoveredElement: NonDeleted<ExcalidrawBindableElement>,
  startOrEnd: "start" | "end",
  elementsMap: ElementsMap,
  focusPoint?: GlobalPoint,
  shouldSnapToOutline = true,
): { attachPoint: AttachPoint } => {
  const endpoint =
    focusPoint ??
    LinearElementEditor.getPointAtIndexGlobalCoordinates(
      arrow,
      startOrEnd === "start" ? 0 : -1,
      elementsMap,
    );

  return calculateAttachPointForNonElbowArrowBinding(
    arrow,
    hoveredElement,
    startOrEnd,
    elementsMap,
    shouldSnapToOutline
      ? projectPointOntoBoundElementOutline(
          arrow,
          startOrEnd === "start" ? "startBinding" : "endBinding",
          hoveredElement,
          endpoint,
          elementsMap,
        )
      : endpoint,
  );
};

/**
 * 该端从绑定解出来的局部点。**纯刚性**：`attachPoint` 就是端点本身，建连时定死，
 * 此后只随图形平移 / 缩放 / 旋转，不再求交、不再投影、也不再依赖另一端。
 */
export const updateBoundPoint = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  binding: ElementBinding | null | undefined,
  bindableElement: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
): LocalPoint | null => {
  if (
    binding == null ||
    // We only need to update the other end if this is a 2 point line element
    (binding.elementId !== bindableElement.id && arrow.points.length > 2) ||
    // Initial arrow created on pointer down needs to not update the points
    pointsEqual(
      arrow.points[arrow.points.length - 1],
      pointFrom<LocalPoint>(0, 0),
    )
  ) {
    return null;
  }

  const attachPoint = getGlobalAttachPointForBindableElement(
    normalizeAttachPoint(binding.attachPoint),
    bindableElement,
    elementsMap,
  );

  return LinearElementEditor.createPointAt(
    arrow,
    elementsMap,
    attachPoint[0],
    attachPoint[1],
    null,
  );
};

export const calculateAttachPointForElbowArrowBinding = (
  linearElement: NonDeleted<ExcalidrawElbowArrowElement>,
  hoveredElement: ExcalidrawBindableElement,
  startOrEnd: "start" | "end",
  elementsMap: ElementsMap,
  shouldSnapToOutline = true,
  isMidpointSnappingEnabled = true,
): { attachPoint: AttachPoint } => {
  const bounds = [
    hoveredElement.x,
    hoveredElement.y,
    hoveredElement.x + hoveredElement.width,
    hoveredElement.y + hoveredElement.height,
  ] as Bounds;
  const snappedPoint = shouldSnapToOutline
    ? bindPointToSnapToElementOutline(
        linearElement,
        hoveredElement,
        startOrEnd,
        elementsMap,
        undefined,
        isMidpointSnappingEnabled,
      )
    : LinearElementEditor.getPointAtIndexGlobalCoordinates(
        linearElement,
        startOrEnd === "start" ? 0 : -1,
        elementsMap,
      );
  const globalMidPoint = pointFrom(
    bounds[0] + (bounds[2] - bounds[0]) / 2,
    bounds[1] + (bounds[3] - bounds[1]) / 2,
  );
  const nonRotatedSnappedGlobalPoint = pointRotateRads(
    snappedPoint,
    globalMidPoint,
    -hoveredElement.angle as Radians,
  );

  // A point-like element has no interior to anchor a proportional point into,
  // and outline snapping above can fall back to an unrelated point; bind to
  // the center so the arrow stays put when the element is later resized.
  if (
    hoveredElement.width < MIN_BINDABLE_SIZE ||
    hoveredElement.height < MIN_BINDABLE_SIZE
  ) {
    return { attachPoint: normalizeAttachPoint([0.5, 0.5]) };
  }

  // Floor the divisor at the binding gap (rather than at ~0) so that
  // elements smaller than the gap don't blow up the ratio: the snapped
  // point sits at most one gap-width outside the outline, so this keeps
  // the resulting attachPoint bounded even for zero/near-zero-size elements.
  const sizeFloor = getBindingGap(hoveredElement, linearElement);

  return {
    attachPoint: normalizeAttachPoint([
      (nonRotatedSnappedGlobalPoint[0] - hoveredElement.x) /
        Math.max(hoveredElement.width, sizeFloor),
      (nonRotatedSnappedGlobalPoint[1] - hoveredElement.y) /
        Math.max(hoveredElement.height, sizeFloor),
    ]),
  };
};

export const calculateAttachPointForNonElbowArrowBinding = (
  linearElement: NonDeleted<ExcalidrawLinearElement>,
  hoveredElement: NonDeleted<ExcalidrawBindableElement>,
  startOrEnd: "start" | "end",
  elementsMap: ElementsMap,
  focusPoint?: GlobalPoint,
): { attachPoint: AttachPoint } => {
  const edgePoint: GlobalPoint = focusPoint
    ? focusPoint
    : LinearElementEditor.getPointAtIndexGlobalCoordinates(
        linearElement,
        startOrEnd === "start" ? 0 : -1,
        elementsMap,
      );

  const elementCenter = elementCenterPoint(hoveredElement, elementsMap);

  // Rotate the point to account for element rotation
  const nonRotatedPoint = pointRotateRads(
    edgePoint,
    elementCenter,
    -hoveredElement.angle as Radians,
  );

  // A point-like element has no interior to anchor a proportional point into;
  // bind to the center so the arrow stays put when the element is later
  // resized.
  if (
    hoveredElement.width < MIN_BINDABLE_SIZE ||
    hoveredElement.height < MIN_BINDABLE_SIZE
  ) {
    return { attachPoint: normalizeAttachPoint([0.5, 0.5]) };
  }

  // Floor the divisor at the binding gap (rather than at ~0) so that
  // elements smaller than the gap don't blow up the ratio: the bound
  // point sits at most one gap-width outside the outline, so this keeps
  // the resulting attachPoint bounded even for zero/near-zero-size elements.
  const sizeFloor = getBindingGap(hoveredElement, linearElement);

  // Calculate the ratio relative to the element's bounds
  const attachPointX =
    (nonRotatedPoint[0] - hoveredElement.x) /
    Math.max(hoveredElement.width, sizeFloor);
  const attachPointY =
    (nonRotatedPoint[1] - hoveredElement.y) /
    Math.max(hoveredElement.height, sizeFloor);

  return {
    attachPoint: normalizeAttachPoint([attachPointX, attachPointY]),
  };
};

export const fixDuplicatedBindingsAfterDuplication = (
  duplicatedElements: ExcalidrawElement[],
  origIdToDuplicateId: Map<ExcalidrawElement["id"], ExcalidrawElement["id"]>,
  duplicateElementsMap: NonDeletedSceneElementsMap,
) => {
  for (const duplicateElement of duplicatedElements) {
    if ("boundElements" in duplicateElement && duplicateElement.boundElements) {
      Object.assign(duplicateElement, {
        boundElements: duplicateElement.boundElements.reduce(
          (
            acc: Mutable<NonNullable<ExcalidrawElement["boundElements"]>>,
            binding,
          ) => {
            const newBindingId = origIdToDuplicateId.get(binding.id);
            if (newBindingId) {
              acc.push({ ...binding, id: newBindingId });
            }
            return acc;
          },
          [],
        ),
      });
    }

    if ("containerId" in duplicateElement && duplicateElement.containerId) {
      Object.assign(duplicateElement, {
        containerId:
          origIdToDuplicateId.get(duplicateElement.containerId) ?? null,
      });
    }

    if ("endBinding" in duplicateElement && duplicateElement.endBinding) {
      const newEndBindingId = origIdToDuplicateId.get(
        duplicateElement.endBinding.elementId,
      );
      Object.assign(duplicateElement, {
        endBinding: newEndBindingId
          ? {
              ...duplicateElement.endBinding,
              elementId: newEndBindingId,
            }
          : null,
      });
    }
    if ("startBinding" in duplicateElement && duplicateElement.startBinding) {
      const newEndBindingId = origIdToDuplicateId.get(
        duplicateElement.startBinding.elementId,
      );
      Object.assign(duplicateElement, {
        startBinding: newEndBindingId
          ? {
              ...duplicateElement.startBinding,
              elementId: newEndBindingId,
            }
          : null,
      });
    }

    if (isElbowArrow(duplicateElement)) {
      Object.assign(
        duplicateElement,
        updateElbowArrowPoints(duplicateElement, duplicateElementsMap, {
          points: [
            duplicateElement.points[0],
            duplicateElement.points[duplicateElement.points.length - 1],
          ],
        }),
      );
    }
  }
};

export const fixBindingsAfterDeletion = (
  sceneElements: readonly ExcalidrawElement[],
  deletedElements: readonly ExcalidrawElement[],
): void => {
  const elements = arrayToMap(sceneElements);

  for (const element of deletedElements) {
    BoundElement.unbindAffected(elements, element, (element, updates) =>
      mutateElement(element, elements, updates),
    );
    BindableElement.unbindAffected(elements, element, (element, updates) =>
      mutateElement(element, elements, updates),
    );
  }
};

const newBoundElements = (
  boundElements: ExcalidrawElement["boundElements"],
  idsToRemove: Set<ExcalidrawElement["id"]>,
  elementsToAdd: Array<ExcalidrawElement> = [],
) => {
  if (!boundElements) {
    return null;
  }

  const nextBoundElements = boundElements.filter(
    (boundElement) => !idsToRemove.has(boundElement.id),
  );

  nextBoundElements.push(
    ...elementsToAdd.map(
      (x) =>
        ({ id: x.id, type: x.type } as
          | ExcalidrawArrowElement
          | ExcalidrawTextElement),
    ),
  );

  return nextBoundElements;
};

export const bindingProperties: Set<BindableProp | BindingProp> = new Set([
  "boundElements",
  "containerRef",
  "containerId",
  "startBinding",
  "endBinding",
]);

export type BindableProp = "boundElements";

export type BindingProp =
  | "containerRef"
  | "containerId"
  | "startBinding"
  | "endBinding";

type BoundElementsVisitingFunc = (
  boundElement: ExcalidrawElement | undefined,
  bindingProp: BindableProp,
  bindingId: string,
) => void;

type BindableElementVisitingFunc<T> = (
  bindableElement: ExcalidrawElement | undefined,
  bindingProp: BindingProp,
  bindingId: string,
) => T;

/**
 * Tries to visit each bound element (does not have to be found).
 */
const boundElementsVisitor = (
  elements: ElementsMap,
  element: ExcalidrawElement,
  visit: BoundElementsVisitingFunc,
) => {
  if (isBindableElement(element)) {
    // create new instance so that possible mutations won't play a role in visiting order
    const boundElements = element.boundElements?.slice() ?? [];

    // last added text should be the one we keep (~previous are duplicates)
    boundElements.forEach(({ id }) => {
      visit(elements.get(id), "boundElements", id);
    });
  }
};

/**
 * Tries to visit each bindable element (does not have to be found).
 */
const bindableElementsVisitor = <T>(
  elements: ElementsMap,
  element: ExcalidrawElement,
  visit: BindableElementVisitingFunc<T>,
): T[] => {
  const result: T[] = [];

  if (element.containerRef?.elementId) {
    const id = element.containerRef?.elementId;
    result.push(visit(elements.get(id), "containerRef", id));
  }

  if (isBoundToContainer(element)) {
    const id = element.containerId;
    result.push(visit(elements.get(id), "containerId", id));
  }

  if (isLinearElement(element)) {
    if (element.startBinding) {
      const id = element.startBinding.elementId;
      result.push(visit(elements.get(id), "startBinding", id));
    }

    if (element.endBinding) {
      const id = element.endBinding.elementId;
      result.push(visit(elements.get(id), "endBinding", id));
    }
  }

  return result;
};

/**
 * Bound element containing bindings to `containerRef`, `containerId`, `startBinding` or `endBinding`.
 */
export class BoundElement {
  /**
   * Unbind the affected non deleted bindable elements (removing element from `boundElements`).
   * - iterates non deleted bindable elements (`containerId` | `startBinding.elementId` | `endBinding.elementId`) of the current element
   * - prepares updates to unbind each bindable element's `boundElements` from the current element
   */
  public static unbindAffected(
    elements: ElementsMap,
    boundElement: ExcalidrawElement | undefined,
    updateElementWith: (
      affected: ExcalidrawElement,
      updates: ElementUpdate<ExcalidrawElement>,
    ) => void,
  ) {
    if (!boundElement) {
      return;
    }

    bindableElementsVisitor(elements, boundElement, (bindableElement) => {
      // bindable element is deleted, this is fine
      if (!bindableElement || bindableElement.isDeleted) {
        return;
      }

      boundElementsVisitor(
        elements,
        bindableElement,
        (_, __, boundElementId) => {
          if (boundElementId === boundElement.id) {
            updateElementWith(bindableElement, {
              boundElements: newBoundElements(
                bindableElement.boundElements,
                new Set([boundElementId]),
              ),
            });
          }
        },
      );
    });
  }

  /**
   * Rebind the next affected non deleted bindable elements (adding element to `boundElements`).
   * - iterates non deleted bindable elements (`containerId` | `startBinding.elementId` | `endBinding.elementId`) of the current element
   * - prepares updates to rebind each bindable element's `boundElements` to the current element
   *
   * NOTE: rebind expects that affected elements were previously unbound with `BoundElement.unbindAffected`
   */
  public static rebindAffected = (
    elements: ElementsMap,
    boundElement: ExcalidrawElement | undefined,
    updateElementWith: (
      affected: ExcalidrawElement,
      updates: ElementUpdate<ExcalidrawElement>,
    ) => void,
  ) => {
    // don't try to rebind element that is deleted
    if (!boundElement || boundElement.isDeleted) {
      return;
    }

    bindableElementsVisitor(
      elements,
      boundElement,
      (bindableElement, bindingProp) => {
        // unbind from bindable elements, as bindings from non deleted elements into deleted elements are incorrect
        if (!bindableElement || bindableElement.isDeleted) {
          updateElementWith(
            boundElement,
            bindingProp === "containerRef"
              ? { containerRef: undefined }
              : { [bindingProp]: null },
          );
          return;
        }

        // frame bindings are unidirectional, there is nothing to rebind
        if (bindingProp === "containerRef") {
          return;
        }

        if (
          bindableElement.boundElements?.find((x) => x.id === boundElement.id)
        ) {
          return;
        }

        if (isLinearElement(boundElement)) {
          // rebind if not found!
          updateElementWith(bindableElement, {
            boundElements: newBoundElements(
              bindableElement.boundElements,
              new Set(),
              new Array(boundElement),
            ),
          });
        }

        if (isTextElement(boundElement)) {
          if (!bindableElement.boundElements?.find((x) => x.type === "text")) {
            // rebind only if there is no other text bound already
            updateElementWith(bindableElement, {
              boundElements: newBoundElements(
                bindableElement.boundElements,
                new Set(),
                new Array(boundElement),
              ),
            });
          } else {
            // unbind otherwise
            updateElementWith(boundElement, {
              containerId: null,
              containerRef: bindableElement.containerRef,
            } as ElementUpdate<ExcalidrawTextElement>);
          }
        }
      },
    );
  };
}

/**
 * Bindable element containing bindings to `boundElements`.
 */
export class BindableElement {
  /**
   * Unbind the affected non deleted bound elements (resetting `containerId`, `startBinding`, `endBinding` to `null`).
   * - iterates through non deleted `boundElements` of the current element
   * - prepares updates to unbind each bound element from the current element
   */
  public static unbindAffected(
    elements: ElementsMap,
    bindableElement: ExcalidrawElement | undefined,
    updateElementWith: (
      affected: ExcalidrawElement,
      updates: ElementUpdate<ExcalidrawElement>,
    ) => void,
  ) {
    if (!bindableElement) {
      return;
    }

    boundElementsVisitor(elements, bindableElement, (boundElement) => {
      // bound element is deleted, this is fine
      if (!boundElement || boundElement.isDeleted) {
        return;
      }

      bindableElementsVisitor(
        elements,
        boundElement,
        (_, bindingProp, bindableElementId) => {
          // making sure there is an element to be unbound
          if (bindableElementId === bindableElement.id) {
            const updates =
              bindingProp === "containerRef"
                ? { containerRef: undefined }
                : bindingProp === "containerId"
                ? {
                    containerId: null,
                    containerRef: bindableElement.containerRef,
                  }
                : { [bindingProp]: null };
            updateElementWith(
              boundElement,
              updates as ElementUpdate<ExcalidrawElement>,
            );
          }
        },
      );
    });
  }

  /**
   * Rebind the affected non deleted bound elements (for now setting only `containerId`, as we cannot rebind arrows atm).
   * - iterates through non deleted `boundElements` of the current element
   * - prepares updates to rebind each bound element to the current element or unbind it from `boundElements` in case of conflicts
   *
   * NOTE: rebind expects that affected elements were previously unbound with `BindaleElement.unbindAffected`
   */
  public static rebindAffected = (
    elements: ElementsMap,
    bindableElement: ExcalidrawElement | undefined,
    updateElementWith: (
      affected: ExcalidrawElement,
      updates: ElementUpdate<ExcalidrawElement>,
    ) => void,
  ) => {
    // don't try to rebind element that is deleted (i.e. updated as deleted)
    if (!bindableElement || bindableElement.isDeleted) {
      return;
    }

    boundElementsVisitor(
      elements,
      bindableElement,
      (boundElement, _, boundElementId) => {
        // unbind from bindable elements, as bindings from non deleted elements into deleted elements are incorrect
        if (!boundElement || boundElement.isDeleted) {
          updateElementWith(bindableElement, {
            boundElements: newBoundElements(
              bindableElement.boundElements,
              new Set([boundElementId]),
            ),
          });
          return;
        }

        if (isTextElement(boundElement)) {
          const boundElements = bindableElement.boundElements?.slice() ?? [];
          // check if this is the last element in the array, if not, there is an previously bound text which should be unbound
          if (
            boundElements.reverse().find((x) => x.type === "text")?.id ===
            boundElement.id
          ) {
            if (boundElement.containerId !== bindableElement.id) {
              // rebind if not bound already!
              updateElementWith(boundElement, {
                containerId: bindableElement.id,
                containerRef: undefined,
              } as ElementUpdate<ExcalidrawTextElement>);
            }
          } else {
            if (boundElement.containerId !== null) {
              // unbind if not unbound already
              updateElementWith(boundElement, {
                containerId: null,
                containerRef: elements.get(boundElement.containerId)
                  ?.containerRef,
              } as ElementUpdate<ExcalidrawTextElement>);
            }

            // unbind from boundElements as the element got bound to some other element in the meantime
            updateElementWith(bindableElement, {
              boundElements: newBoundElements(
                bindableElement.boundElements,
                new Set([boundElement.id]),
              ),
            });
          }
        }
      },
    );
  };
}

export const getGlobalAttachPointForBindableElement = (
  attachPointRatio: AttachPoint,
  element: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
): GlobalPoint => {
  const [fixedX, fixedY] = normalizeAttachPoint(attachPointRatio);

  return pointRotateRads(
    pointFrom(
      element.x + element.width * fixedX,
      element.y + element.height * fixedY,
    ),
    elementCenterPoint(element, elementsMap),
    element.angle,
  );
};

export const getGlobalAttachPoints = (
  arrow: ExcalidrawLinearElement,
  elementsMap: ElementsMap,
): [GlobalPoint, GlobalPoint] => {
  const startElement =
    arrow.startBinding &&
    (elementsMap.get(arrow.startBinding.elementId) as
      | ExcalidrawBindableElement
      | undefined);
  const endElement =
    arrow.endBinding &&
    (elementsMap.get(arrow.endBinding.elementId) as
      | ExcalidrawBindableElement
      | undefined);
  const startPoint =
    startElement && arrow.startBinding
      ? getGlobalAttachPointForBindableElement(
          arrow.startBinding.attachPoint,
          startElement as ExcalidrawBindableElement,
          elementsMap,
        )
      : pointFrom<GlobalPoint>(
          arrow.x + arrow.points[0][0],
          arrow.y + arrow.points[0][1],
        );
  const endPoint =
    endElement && arrow.endBinding
      ? getGlobalAttachPointForBindableElement(
          arrow.endBinding.attachPoint,
          endElement as ExcalidrawBindableElement,
          elementsMap,
        )
      : pointFrom<GlobalPoint>(
          arrow.x + arrow.points[arrow.points.length - 1][0],
          arrow.y + arrow.points[arrow.points.length - 1][1],
        );

  return [startPoint, endPoint];
};

export const getArrowLocalAttachPoints = (
  arrow: ExcalidrawElbowArrowElement,
  elementsMap: ElementsMap,
) => {
  const [startPoint, endPoint] = getGlobalAttachPoints(arrow, elementsMap);

  return [
    LinearElementEditor.pointFromAbsoluteCoords(arrow, startPoint, elementsMap),
    LinearElementEditor.pointFromAbsoluteCoords(arrow, endPoint, elementsMap),
  ];
};

export const isAttachPoint = (
  attachPoint: any,
): attachPoint is ElementBinding["attachPoint"] => {
  return (
    Array.isArray(attachPoint) &&
    attachPoint.length === 2 &&
    attachPoint.every((coord) => Number.isFinite(coord))
  );
};

// Fixed point ratios should stay close to the 0.0-1.0 range.
const FIXED_POINT_BOUND = 10;

export const normalizeAttachPoint = <T extends AttachPoint>(
  attachPoint: T,
): AttachPoint => {
  if (!isAttachPoint(attachPoint)) {
    return [0.5001, 0.5001];
  }

  const EPSILON = 0.0001;

  const clamped = attachPoint.map((ratio) =>
    clamp(ratio, -FIXED_POINT_BOUND, FIXED_POINT_BOUND),
  ) as AttachPoint;

  // Do not allow a precise 0.5 for fixed point ratio
  // to avoid jumping arrow heading due to floating point imprecision
  if (
    Math.abs(clamped[0] - 0.5) < EPSILON ||
    Math.abs(clamped[1] - 0.5) < EPSILON
  ) {
    return clamped.map((ratio) =>
      Math.abs(ratio - 0.5) < EPSILON ? 0.5001 : ratio,
    ) as AttachPoint;
  }

  return clamped;
};

/**
 * Binds an arrow endpoint to an explicit fixed point on a bindable element,
 * bypassing the "derive the ratio from where the endpoint currently is"
 * strategy used when dragging. Needed when the binding target is placed to fit
 * the arrow rather than the other way round.
 */
export const bindBindingElementToAttachPoint = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  bindableElement: NonDeleted<ExcalidrawBindableElement>,
  startOrEnd: "start" | "end",
  attachPoint: AttachPoint,
  scene: Scene,
): void => {
  applyBinding(
    arrow,
    bindableElement,
    {
      elementId: bindableElement.id,
      attachPoint: normalizeAttachPoint(attachPoint),
    },
    startOrEnd,
    scene,
  );
};
