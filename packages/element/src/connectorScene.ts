import { ROUNDNESS } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint, Radians } from "@excalidraw/math";

import { normalizeArrowhead } from "./arrowheads";
import {
  bindBindingElement,
  unbindBindingElement,
  updateBoundPoint,
} from "./binding";
import { LinearElementEditor } from "./linearElementEditor";
import { newArrowElement, newLinearElement } from "./newElement";
import {
  CanvasSceneError,
  applySceneElementStyle,
  createCalculationScene,
  deleteSceneElements,
  finishSceneOperation,
  updateSceneLabel,
} from "./sceneOperations";
import { isBindableElement, isLinearElement } from "./typeChecks";

import type { Scene } from "./Scene";
import type {
  AnyArrowhead,
  ExcalidrawBindableElement,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "./types";
import type {
  CanvasElementOperationResult,
  ConnectorStyle,
  SceneElementTarget,
  ScenePoint,
  SceneTextStyle,
} from "./sceneOperations";

export type ConnectorEndpoint =
  | Readonly<{ elementId: string }>
  | Readonly<{ point: ScenePoint }>;
export type ConnectorRouting = "straight" | "curved" | "orthogonal";
export type ConnectorOperation =
  | Readonly<{
      action: "create";
      kind: "line" | "arrow";
      start: ConnectorEndpoint;
      end: ConnectorEndpoint;
      routing?: ConnectorRouting;
      label?: string;
      startArrowhead?: AnyArrowhead | null;
      endArrowhead?: AnyArrowhead | null;
      style?: ConnectorStyle;
      textStyle?: SceneTextStyle;
    }>
  | Readonly<{
      action: "update";
      target: SceneElementTarget;
      routing?: ConnectorRouting;
      label?: string;
      startArrowhead?: AnyArrowhead | null;
      endArrowhead?: AnyArrowhead | null;
      style?: ConnectorStyle;
      textStyle?: SceneTextStyle;
    }>
  | Readonly<{
      action: "reconnect";
      target: SceneElementTarget;
      start?: ConnectorEndpoint;
      end?: ConnectorEndpoint;
    }>
  | Readonly<{ action: "delete"; target: SceneElementTarget }>;

const endpointTarget = (
  endpoint: ConnectorEndpoint,
  scene: Scene,
  connector?: ExcalidrawLinearElement,
): NonDeleted<ExcalidrawBindableElement> | null => {
  if ("point" in endpoint) {
    return null;
  }
  const target = scene.getNonDeletedElementsMap().get(endpoint.elementId);
  if (!target) {
    throw new CanvasSceneError("target_not_found", "连线端点不存在");
  }
  if (
    !isBindableElement(target) ||
    target.type === "mindmap-node" ||
    target.id === connector?.id ||
    (target.type === "text" && target.containerId === connector?.id)
  ) {
    throw new CanvasSceneError("invalid_operation", "对象不能作为连线端点");
  }
  return target;
};

const endpointPoint = (
  endpoint: ConnectorEndpoint,
  scene: Scene,
  connector?: ExcalidrawLinearElement,
): ScenePoint => {
  const target = endpointTarget(endpoint, scene, connector);
  if (target) {
    return { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  }
  if ("point" in endpoint) {
    return endpoint.point;
  }
  throw new Error("连线端点解析失败");
};

export const getConnectorRouting = (
  connector: ExcalidrawLinearElement,
): ConnectorRouting =>
  "elbowed" in connector && connector.elbowed
    ? "orthogonal"
    : connector.roundness
    ? "curved"
    : "straight";

const setRouting = (
  connector: NonDeleted<ExcalidrawLinearElement>,
  routing: ConnectorRouting,
  start: ScenePoint,
  end: ScenePoint,
  scene: Scene,
) => {
  if (routing === "orthogonal" && connector.type !== "arrow") {
    throw new CanvasSceneError("invalid_input", "折线布线仅支持箭头");
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const points =
    routing === "curved"
      ? [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(dx / 2 - dy * 0.15, dy / 2 + dx * 0.15),
          pointFrom<LocalPoint>(dx, dy),
        ]
      : [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(dx, dy)];
  scene.mutateElement(connector, {
    roundness:
      routing === "curved" ? { type: ROUNDNESS.PROPORTIONAL_RADIUS } : null,
    ...(connector.type === "arrow" && {
      elbowed: routing === "orthogonal",
      fixedSegments: null,
      startIsSpecial: false,
      endIsSpecial: false,
    }),
  });
  scene.mutateElement(connector, {
    x: start.x,
    y: start.y,
    angle: 0 as Radians,
    points,
  });
};

const bindEndpoint = (
  connector: NonDeleted<ExcalidrawLinearElement>,
  end: "start" | "end",
  endpoint: ConnectorEndpoint,
  scene: Scene,
) => {
  const target = endpointTarget(endpoint, scene, connector);
  unbindBindingElement(connector, end, scene);
  if (target) {
    bindBindingElement(connector, target, "orbit", end, scene);
  }
};

const reflowEndpoints = (
  connector: NonDeleted<ExcalidrawLinearElement>,
  scene: Scene,
) => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const updates = new Map<number, { point: LocalPoint }>();
  for (const field of ["startBinding", "endBinding"] as const) {
    const binding = connector[field];
    const target = binding && elementsMap.get(binding.elementId);
    if (target && isBindableElement(target)) {
      const point = updateBoundPoint(
        connector,
        field,
        binding,
        target,
        elementsMap,
      );
      if (point) {
        updates.set(
          field === "startBinding" ? 0 : connector.points.length - 1,
          { point },
        );
      }
    }
  }
  if (updates.size) {
    LinearElementEditor.movePoints(connector, scene, updates);
  }
};

export const applyConnectorOperation = (
  elements: readonly ExcalidrawElement[],
  operation: ConnectorOperation,
): CanvasElementOperationResult => {
  const scene = createCalculationScene(elements);
  try {
    let connector: NonDeleted<ExcalidrawLinearElement>;
    if (operation.action === "create") {
      const start = endpointPoint(operation.start, scene);
      const end = endpointPoint(operation.end, scene);
      connector =
        operation.kind === "arrow"
          ? newArrowElement({ type: "arrow", x: start.x, y: start.y })
          : newLinearElement({ type: "line", x: start.x, y: start.y });
      scene.replaceAllElements(
        [...scene.getElementsIncludingDeleted(), connector],
        {
          skipValidation: true,
        },
      );
      setRouting(connector, operation.routing ?? "straight", start, end, scene);
      bindEndpoint(connector, "start", operation.start, scene);
      bindEndpoint(connector, "end", operation.end, scene);
    } else {
      const target = scene
        .getNonDeletedElementsMap()
        .get(operation.target.elementId);
      if (!target || !isLinearElement(target)) {
        throw new CanvasSceneError("target_not_found", "连线不存在");
      }
      connector = target;
    }
    if (operation.action === "delete") {
      deleteSceneElements(new Set([connector.id]), scene);
    } else {
      if (operation.action === "reconnect") {
        const elementsMap = scene.getNonDeletedElementsMap();
        const previousStart =
          LinearElementEditor.getPointAtIndexGlobalCoordinates(
            connector,
            0,
            elementsMap,
          );
        const previousEnd =
          LinearElementEditor.getPointAtIndexGlobalCoordinates(
            connector,
            -1,
            elementsMap,
          );
        const start = operation.start
          ? endpointPoint(operation.start, scene, connector)
          : { x: previousStart[0], y: previousStart[1] };
        const end = operation.end
          ? endpointPoint(operation.end, scene, connector)
          : { x: previousEnd[0], y: previousEnd[1] };
        setRouting(
          connector,
          getConnectorRouting(connector),
          start,
          end,
          scene,
        );
        if (operation.start) {
          bindEndpoint(connector, "start", operation.start, scene);
        }
        if (operation.end) {
          bindEndpoint(connector, "end", operation.end, scene);
        }
      } else {
        if (operation.action === "update" && operation.routing) {
          const elementsMap = scene.getNonDeletedElementsMap();
          const start = LinearElementEditor.getPointAtIndexGlobalCoordinates(
            connector,
            0,
            elementsMap,
          );
          const end = LinearElementEditor.getPointAtIndexGlobalCoordinates(
            connector,
            -1,
            elementsMap,
          );
          setRouting(
            connector,
            operation.routing,
            { x: start[0], y: start[1] },
            { x: end[0], y: end[1] },
            scene,
          );
        }
        scene.mutateElement(connector, {
          ...(operation.startArrowhead !== undefined && {
            startArrowhead: normalizeArrowhead(operation.startArrowhead),
          }),
          ...(operation.endArrowhead !== undefined && {
            endArrowhead: normalizeArrowhead(operation.endArrowhead),
          }),
        });
        applySceneElementStyle(connector, operation.style, scene);
      }
      reflowEndpoints(connector, scene);
      updateSceneLabel(
        connector,
        operation.action === "reconnect" ? undefined : operation.label,
        operation.action === "reconnect" ? undefined : operation.textStyle,
        scene,
      );
    }
    return finishSceneOperation(elements, scene.getElementsIncludingDeleted(), {
      domain: "connector",
      action: operation.action,
      elementId: connector.id,
    });
  } finally {
    scene.destroy();
  }
};
