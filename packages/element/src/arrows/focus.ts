import { pointDistance, pointFrom, type GlobalPoint } from "@excalidraw/math";
import { invariant } from "@excalidraw/common";

import type { AppState, NullableGridSize } from "@excalidraw/excalidraw/types";

import {
  bindBindingElement,
  FOCUS_POINT_SIZE,
  getGlobalAttachPointForBindableElement,
  isBindingEnabled,
  maxBindingDistance_simple,
  unbindBindingElement,
  updateBoundPoint,
} from "../binding";
import {
  isBindableElement,
  isBindingElement,
  isElbowArrow,
} from "../typeChecks";
import { LinearElementEditor } from "../linearElementEditor";
import { getHoveredElementForFocusPoint } from "../collision";
import { moveArrowAboveBindable } from "../zindex";

import type {
  ExcalidrawLinearElement,
  ExcalidrawBindableElement,
  NonDeleted,
  NonDeletedSceneElementsMap,
  PointsPositionUpdates,
} from "../types";

import type { Scene } from "../Scene";

/**
 * 这一端的连接点手柄是否显示。
 *
 * 组合 A 下 `binding.attachPoint` 存的就是**端点本身**，于是 `focusPoint`
 * （`getGlobalAttachPointForBindableElement` 的解）与箭头端点恒等，手柄语义就是
 * "拖这一端的连接点"。所以原来那条隐藏判据（代码里出现两遍：开头 `ignoreOverlap`
 * 块里与「所属端」的箭头点比距离，返回处又与「这一端」的箭头点比距离）必须在组合 A
 * 下丢掉 —— 端点与手柄重合是**正常状态**，留着就变成手柄永远不显示。
 *
 * 另一条"手柄须落在轮廓外扩 strokeWidth+gap 范围内"（`hitElementItself`）也不能留：
 * 端点建连时被投在「外扩一个 binding gap 的轮廓」上，此后只随图形刚性变换，于是
 * 图形放大 N 倍、端点离轮廓的像素距离也放大 N 倍（比例不变），固定像素阈值时对时错；
 * 复合图形尖角处外扩轮廓还会沿斜接方向多出 gap/sin(半顶角)，更卡不住。
 *
 * 因此判据回到绑定本身：这一端确实绑在这个元素上 → 显示手柄（目标元素是否
 * 可绑定、是否已删除由调用方先行判定）。
 */
export const isFocusPointVisible = (
  arrow: ExcalidrawLinearElement,
  bindableElement: ExcalidrawBindableElement,
  appState: {
    isBindingEnabled: AppState["isBindingEnabled"];
  },
  startOrEnd: "start" | "end",
): boolean => {
  // No focus point management for elbow arrows, because elbow arrows
  // always have their focus point at the arrow point itself
  if (
    isElbowArrow(arrow) ||
    !isBindingEnabled(appState) ||
    arrow.points.length !== 2
  ) {
    return false;
  }

  // 手柄只画「这一端自己的绑定」所指的元素上，避免错画到另一端的连接点
  const binding = startOrEnd === "end" ? arrow.endBinding : arrow.startBinding;

  return !!binding && binding.elementId === bindableElement.id;
};

// 按当前绑定把被拖的这一端解出来（拖 focus 手柄 = 直接改这一端的连接点）
const focusPointUpdate = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  bindableElement: ExcalidrawBindableElement | null,
  isStartBinding: boolean,
  elementsMap: NonDeletedSceneElementsMap,
  scene: Scene,
): void => {
  const pointUpdates: PointsPositionUpdates = new Map();
  const bindingField = isStartBinding ? "startBinding" : "endBinding";
  const currentBinding = arrow[bindingField];

  // 只动被拖的这一端。原先这里还会连带重算另一端（按旧锚点语义在「落点在图形
  // 内部 / 轮廓上」之间来回切换、同图双端则都留在内部），那是为旧锚点语义服务的；
  // 端点各自在建连时定死，拖这一端不改写另一端。
  if (currentBinding && bindableElement) {
    const pointIndex = isStartBinding ? 0 : arrow.points.length - 1;
    const newPoint = updateBoundPoint(
      arrow,
      currentBinding,
      bindableElement,
      elementsMap,
    );

    if (newPoint) {
      pointUpdates.set(pointIndex, { point: newPoint });
    }
  }

  if (pointUpdates.size > 0) {
    LinearElementEditor.movePoints(arrow, scene, pointUpdates, {
      [bindingField]: currentBinding,
    });
  }
};

export const handleFocusPointDrag = (
  linearElementEditor: LinearElementEditor,
  elementsMap: NonDeletedSceneElementsMap,
  pointerCoords: { x: number; y: number },
  scene: Scene,
  appState: AppState,
  gridSize: NullableGridSize,
) => {
  const arrow = LinearElementEditor.getElement(
    linearElementEditor.elementId,
    elementsMap,
  );

  // Sanity checks
  if (
    !arrow ||
    !isBindingElement(arrow) ||
    isElbowArrow(arrow) ||
    !linearElementEditor.hoveredFocusPointBinding ||
    !linearElementEditor.draggedFocusPointBinding
  ) {
    return;
  }

  const isStartBinding =
    linearElementEditor.draggedFocusPointBinding === "start";
  const binding = isStartBinding ? arrow.startBinding : arrow.endBinding;
  const { x: offsetX, y: offsetY } = linearElementEditor.pointerOffset;
  const point = pointFrom<GlobalPoint>(
    pointerCoords.x - offsetX,
    pointerCoords.y - offsetY,
  );
  const bindingField = isStartBinding ? "startBinding" : "endBinding";
  const hit = getHoveredElementForFocusPoint(
    point,
    arrow,
    scene.getNonDeletedElements(),
    elementsMap,
    maxBindingDistance_simple(appState.zoom),
  );

  // Hovering a bindable element
  if (hit && isBindingEnabled(appState)) {
    // Break existing binding if bound to another shape or if binding is disabled
    if (arrow[bindingField] && hit.id !== binding?.elementId) {
      unbindBindingElement(
        arrow,
        linearElementEditor.draggedFocusPointBinding,
        scene,
      );
    }

    // (Re)bind to the hovered element. `bindBindingElement` resolves the attach
    // point through `resolveAttachPointForNonElbowBinding`, i.e. it projects the
    // pointer onto the element's outline **inflated by one binding gap** before
    // taking the ratio — the same rule as at binding creation. Writing the ratio
    // of the raw pointer instead (as this used to do, on top of the brand new
    // binding) drops the endpoint inside the element it is bound to.
    bindBindingElement(
      arrow,
      hit,
      linearElementEditor.draggedFocusPointBinding,
      scene,
      point,
    );
  } else {
    // Not hovering any bindable element, move the arrow endpoint
    const pointUpdates: PointsPositionUpdates = new Map();
    const pointIndex = isStartBinding ? 0 : arrow.points.length - 1;
    pointUpdates.set(pointIndex, {
      point: LinearElementEditor.createPointAt(
        arrow,
        elementsMap,
        point[0],
        point[1],
        gridSize,
      ),
    });
    LinearElementEditor.movePoints(arrow, scene, pointUpdates);
    if (arrow[bindingField]) {
      unbindBindingElement(arrow, isStartBinding ? "start" : "end", scene);
    }
  }

  // Update the arrow endpoints
  focusPointUpdate(arrow, hit, isStartBinding, elementsMap, scene);

  if (hit && isBindingEnabled(appState)) {
    moveArrowAboveBindable(
      point,
      arrow,
      scene.getElementsIncludingDeleted(),
      elementsMap,
      scene,
      hit,
    );
  }
};

export const handleFocusPointPointerDown = (
  arrow: ExcalidrawLinearElement,
  pointerDownState: { origin: { x: number; y: number } },
  elementsMap: NonDeletedSceneElementsMap,
  appState: AppState,
): {
  hitFocusPoint: "start" | "end" | null;
  pointerOffset: { x: number; y: number };
} => {
  const pointerPos = pointFrom(
    pointerDownState.origin.x,
    pointerDownState.origin.y,
  );
  const hitThreshold = (FOCUS_POINT_SIZE * 1.5) / appState.zoom.value;

  // Check start binding focus point
  if (arrow.startBinding?.elementId) {
    const bindableElement = elementsMap.get(arrow.startBinding.elementId);
    if (
      bindableElement &&
      isBindableElement(bindableElement) &&
      !bindableElement.isDeleted
    ) {
      const focusPoint = getGlobalAttachPointForBindableElement(
        arrow.startBinding.attachPoint,
        bindableElement,
        elementsMap,
      );
      if (
        isFocusPointVisible(arrow, bindableElement, appState, "start") &&
        pointDistance(pointerPos, focusPoint) <= hitThreshold
      ) {
        return {
          hitFocusPoint: "start",
          pointerOffset: {
            x: pointerPos[0] - focusPoint[0],
            y: pointerPos[1] - focusPoint[1],
          },
        };
      }
    }
  }

  // Check end binding focus point (only if start not already hit)
  if (arrow.endBinding?.elementId) {
    const bindableElement = elementsMap.get(arrow.endBinding.elementId);
    if (
      bindableElement &&
      isBindableElement(bindableElement) &&
      !bindableElement.isDeleted
    ) {
      const focusPoint = getGlobalAttachPointForBindableElement(
        arrow.endBinding.attachPoint,
        bindableElement,
        elementsMap,
      );
      if (
        isFocusPointVisible(arrow, bindableElement, appState, "end") &&
        pointDistance(pointerPos, focusPoint) <= hitThreshold
      ) {
        return {
          hitFocusPoint: "end",
          pointerOffset: {
            x: pointerPos[0] - focusPoint[0],
            y: pointerPos[1] - focusPoint[1],
          },
        };
      }
    }
  }

  return {
    hitFocusPoint: null,
    pointerOffset: { x: 0, y: 0 },
  };
};

export const handleFocusPointPointerUp = (
  linearElementEditor: LinearElementEditor,
  scene: Scene,
) => {
  invariant(
    linearElementEditor.draggedFocusPointBinding,
    "Must have a dragged focus point at pointer release",
  );

  const arrow = LinearElementEditor.getElement<ExcalidrawLinearElement>(
    linearElementEditor.elementId,
    scene.getNonDeletedElementsMap(),
  );
  invariant(arrow, "Arrow must be in the scene");

  // Clean up
  const bindingKey =
    linearElementEditor.draggedFocusPointBinding === "start"
      ? "startBinding"
      : "endBinding";
  const otherBindingKey =
    linearElementEditor.draggedFocusPointBinding === "start"
      ? "endBinding"
      : "startBinding";
  const boundElementId = arrow[bindingKey]?.elementId;
  const otherBoundElementId = arrow[otherBindingKey]?.elementId;
  const oldBoundElement =
    boundElementId &&
    scene
      .getNonDeletedElements()
      .find(
        (element) =>
          element.id !== boundElementId &&
          element.id !== otherBoundElementId &&
          isBindableElement(element) &&
          element.boundElements?.find(({ id }) => id === arrow.id),
      );
  if (oldBoundElement) {
    scene.mutateElement(oldBoundElement, {
      boundElements: oldBoundElement.boundElements?.filter(
        ({ id }) => id !== arrow.id,
      ),
    });
  }

  // Record the new bound element
  const boundElement =
    boundElementId && scene.getNonDeletedElementsMap().get(boundElementId);
  if (boundElement) {
    scene.mutateElement(boundElement, {
      boundElements: [
        ...(boundElement.boundElements || [])?.filter(
          ({ id }) => id !== arrow.id,
        ),
        {
          id: arrow.id,
          type: "arrow",
        },
      ],
    });
  }
};

export const handleFocusPointHover = (
  arrow: ExcalidrawLinearElement,
  scenePointerX: number,
  scenePointerY: number,
  scene: Scene,
  appState: AppState,
): "start" | "end" | null => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const pointerPos = pointFrom(scenePointerX, scenePointerY);
  const hitThreshold = (FOCUS_POINT_SIZE * 1.5) / appState.zoom.value;

  // Check start binding focus point
  if (arrow.startBinding?.elementId) {
    const bindableElement = elementsMap.get(arrow.startBinding.elementId);
    if (
      bindableElement &&
      isBindableElement(bindableElement) &&
      !bindableElement.isDeleted
    ) {
      const focusPoint = getGlobalAttachPointForBindableElement(
        arrow.startBinding.attachPoint,
        bindableElement,
        elementsMap,
      );
      if (
        isFocusPointVisible(arrow, bindableElement, appState, "start") &&
        pointDistance(pointerPos, focusPoint) <= hitThreshold
      ) {
        return "start";
      }
    }
  }

  // Check end binding focus point (only if start not already hovered)
  if (arrow.endBinding?.elementId) {
    const bindableElement = elementsMap.get(arrow.endBinding.elementId);
    if (
      bindableElement &&
      isBindableElement(bindableElement) &&
      !bindableElement.isDeleted
    ) {
      const focusPoint = getGlobalAttachPointForBindableElement(
        arrow.endBinding.attachPoint,
        bindableElement,
        elementsMap,
      );
      if (
        isFocusPointVisible(arrow, bindableElement, appState, "end") &&
        pointDistance(pointerPos, focusPoint) <= hitThreshold
      ) {
        return "end";
      }
    }
  }

  return null;
};
