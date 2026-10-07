import { getFontString } from "@excalidraw/common";
import { generateKeyBetween } from "@excalidraw/fractional-indexing";

import {
  applyMindmapTreeCommand,
  buildMindmapGraphIndex,
  getMindmapSubtreeIds,
  getMindmapShapeId,
  getMindmapLayoutConfig,
  getMindmapEdgeGeometry,
  isMindmapLayoutFrozen,
  layoutMindmap,
  reparentMindmapNode,
  repairMindmapElements,
} from "./mindmap";
import { newMindmapNodeElement, newTextElement } from "./newElement";
import {
  isMindmapNodeElement,
  isMindmapEdgeElement,
  isTextElement,
} from "./typeChecks";
import {
  computeBoundTextPosition,
  computeContainerDimensionForBoundText,
  getBoundTextElement,
  getBoundTextMaxWidth,
  getBoundTextMaxHeight,
} from "./textElement";
import { measureText, normalizeText } from "./textMeasurements";
import { wrapText } from "./textWrapping";
import {
  CanvasSceneError,
  finishSceneOperation,
  createCalculationScene,
  deleteSceneElements,
} from "./sceneOperations";

import type {
  CanvasElementOperationReferences,
  CanvasElementOperationResult,
  ScenePoint,
} from "./sceneOperations";
import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
} from "./types";

export type MindmapNodeTarget = Readonly<{ graphId: string; nodeId: string }>;
export type MindmapOperation =
  | Readonly<{ action: "createRoot"; position: ScenePoint; text: string }>
  | Readonly<{
      action: "addChild" | "addSibling" | "rename";
      target: MindmapNodeTarget;
      text: string;
    }>
  | Readonly<{
      action: "move";
      target: MindmapNodeTarget;
      position: ScenePoint;
    }>
  | Readonly<{
      action: "reparent";
      target: MindmapNodeTarget;
      parentNodeId: string;
      beforeNodeId?: string;
    }>
  | Readonly<{ action: "deleteSubtree"; target: MindmapNodeTarget }>;
export type MindmapOperationReferences = Extract<
  CanvasElementOperationReferences,
  { domain: "mindmap" }
>;

// 浏览器交互与无 DOM 场景命令共用文字、派生边和布局计算。
export const layoutMindmapScene = (
  elements: readonly ExcalidrawElement[],
  graphIds: readonly string[],
): readonly ExcalidrawElement[] => {
  const selected = new Set(graphIds);
  const affected = elements.filter(
    (element) =>
      (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
      selected.has(element.graphId),
  );
  const repairedGraph = repairMindmapElements(affected);
  const replacements = new Map(
    repairedGraph.map((element) => [element.id, element]),
  );
  const existingIds = new Set(elements.map((element) => element.id));
  const repaired = [
    ...elements.map((element) => replacements.get(element.id) ?? element),
    ...repairedGraph.filter((element) => !existingIds.has(element.id)),
  ];
  const updated = new Map(repaired.map((element) => [element.id, element]));
  for (const graphId of graphIds) {
    const graph = repaired.filter(
      (element) =>
        !element.isDeleted &&
        (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
        element.graphId === graphId,
    );
    if (!graph.some(isMindmapNodeElement)) {
      continue;
    }
    // 文字尺寸变化后再次布局，保证兄弟间距与边端点采用最终几何。
    for (let pass = 0; pass < 2; pass++) {
      const currentGraph = [...updated.values()].filter(
        (element) =>
          !element.isDeleted &&
          (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
          element.graphId === graphId,
      );
      const layout = layoutMindmap(
        buildMindmapGraphIndex(currentGraph, graphId),
      );
      for (const element of [...layout.elements, ...layout.edges]) {
        updated.set(element.id, element);
      }
      let resized = false;
      for (const node of layout.elements) {
        const text = getBoundTextElement(node, updated);
        if (!text) {
          continue;
        }
        const maxWidth = getBoundTextMaxWidth(node, text);
        const wrappedText = wrapText(
          text.originalText,
          getFontString(text),
          maxWidth,
        );
        const metrics = measureText(
          wrappedText,
          getFontString(text),
          text.lineHeight,
        );
        const shape =
          getMindmapShapeId(node) === "pill" ? "ellipse" : node.shape.id;
        const maxHeight = getBoundTextMaxHeight(node, text);
        // 表格缩放后冻结的节点保持现有几何，文字仅在边界内折行。
        const nextNode = isMindmapLayoutFrozen(node)
          ? node
          : {
              ...node,
              ...(metrics.width > maxWidth && {
                width: computeContainerDimensionForBoundText(
                  metrics.width,
                  shape,
                ),
              }),
              ...(metrics.height > maxHeight && {
                height: computeContainerDimensionForBoundText(
                  metrics.height,
                  shape,
                ),
              }),
            };
        resized ||=
          nextNode.width !== node.width || nextNode.height !== node.height;
        updated.set(node.id, nextNode);
        const nextText = {
          ...text,
          text: wrappedText,
          width: metrics.width,
          height: metrics.height,
        };
        updated.set(text.id, {
          ...nextText,
          ...computeBoundTextPosition(nextNode, nextText, updated),
        });
      }
      if (!resized) {
        break;
      }
    }
  }
  return repaired.map((element) => updated.get(element.id) ?? element);
};

const validatePoint = (point: ScenePoint) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new CanvasSceneError("invalid_input", "脑图位置必须是有限坐标");
  }
};

const appendNode = (
  elements: readonly ExcalidrawElement[],
  node: ExcalidrawMindmapNodeElement,
  value: string,
) => {
  const text = newTextElement({
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
    text: value,
    containerId: node.id,
    textAlign: "center",
    verticalAlign: "middle",
  });
  return [
    ...elements,
    { ...node, boundElements: [{ type: "text" as const, id: text.id }] },
    text,
  ];
};

export const applyMindmapOperation = (
  input: readonly ExcalidrawElement[],
  operation: MindmapOperation,
): CanvasElementOperationResult => {
  if ("text" in operation && typeof operation.text !== "string") {
    throw new CanvasSceneError("invalid_input", "脑图文字必须是字符串");
  }
  if ("position" in operation) {
    validatePoint(operation.position);
  }
  if (operation.action === "createRoot") {
    const root = newMindmapNodeElement({
      ...operation.position,
      graphId: "",
      role: "root",
      parentId: null,
      order: null,
    });
    const graphId = `mindmap:${root.id}`;
    const elements = layoutMindmapScene(
      appendNode(input, { ...root, graphId }, operation.text),
      [graphId],
    );
    return finishSceneOperation(input, elements, {
      domain: "mindmap",
      action: operation.action,
      graphId,
      nodeId: root.id,
      rootNodeId: root.id,
    });
  }
  const node = input.find(
    (element): element is ExcalidrawMindmapNodeElement =>
      element.id === operation.target.nodeId &&
      !element.isDeleted &&
      isMindmapNodeElement(element) &&
      element.graphId === operation.target.graphId,
  );
  if (!node) {
    throw new CanvasSceneError("target_not_found", "脑图节点不存在");
  }
  const index = buildMindmapGraphIndex(input, node.graphId);
  let elements = input;
  let nodeId = node.id;
  let rootNodeId: string | null = index.rootId;
  let needsLayout = true;
  switch (operation.action) {
    case "addChild":
    case "addSibling": {
      const parentId =
        operation.action === "addChild" ? node.id : node.parentId;
      if (!parentId) {
        throw new CanvasSceneError("invalid_operation", "根节点没有兄弟节点");
      }
      const siblings = index.childrenById.get(parentId) ?? [];
      const position =
        operation.action === "addChild"
          ? siblings.length
          : siblings.indexOf(node.id) + 1;
      const order = generateKeyBetween(
        position > 0 ? index.nodes.get(siblings[position - 1])!.order : null,
        position < siblings.length
          ? index.nodes.get(siblings[position])!.order
          : null,
      );
      const created = newMindmapNodeElement({
        x: node.x + node.width + 80,
        y: node.y,
        graphId: node.graphId,
        role: "node",
        parentId,
        order: order as FractionalIndex,
        shape: index.nodes.get(index.rootId)?.defaultNodeShape ?? "rectangle",
      });
      elements = appendNode(input, created, operation.text);
      nodeId = created.id;
      break;
    }
    case "rename": {
      const text = getBoundTextElement(
        node,
        new Map(input.map((element) => [element.id, element])),
      );
      if (text) {
        const value = normalizeText(operation.text);
        elements = input.map((element) =>
          element.id === text.id
            ? { ...text, originalText: value, text: value }
            : element,
        );
      } else {
        const appended = appendNode([], node, operation.text);
        elements = [
          ...input.map((element) =>
            element.id === node.id ? appended[0] : element,
          ),
          appended[1],
        ];
      }
      break;
    }
    case "reparent": {
      const parent = index.nodes.get(operation.parentNodeId);
      const subtree = new Set(getMindmapSubtreeIds(index, node.id));
      if (
        node.role === "root" ||
        !parent ||
        subtree.has(parent.id) ||
        (operation.beforeNodeId !== undefined &&
          (index.nodes.get(operation.beforeNodeId)?.parentId !== parent.id ||
            subtree.has(operation.beforeNodeId)))
      ) {
        throw new CanvasSceneError(
          "invalid_operation",
          "脑图换父关系或插入位置无效",
        );
      }
      const updates = new Map(
        reparentMindmapNode(
          index,
          node.id,
          parent.id,
          operation.beforeNodeId ?? null,
        ).map((item) => [item.id, item]),
      );
      if (parent.collapsed) {
        updates.set(parent.id, { ...parent, collapsed: false });
      }
      elements = input.map((element) => updates.get(element.id) ?? element);
      break;
    }
    case "move": {
      const subtree = new Set(getMindmapSubtreeIds(index, node.id));
      const dx = operation.position.x - node.x;
      const dy = operation.position.y - node.y;
      elements = input.map((element) =>
        !element.isDeleted &&
        (subtree.has(element.id) ||
          (isTextElement(element) &&
            element.containerId &&
            subtree.has(element.containerId)))
          ? { ...element, x: element.x + dx, y: element.y + dy }
          : element,
      );
      const moved = buildMindmapGraphIndex(elements, node.graphId);
      const direction = getMindmapLayoutConfig(
        moved.nodes.get(moved.rootId),
      ).direction;
      elements = elements.map((element) => {
        if (
          !element.isDeleted &&
          isMindmapEdgeElement(element) &&
          element.graphId === node.graphId &&
          (subtree.has(element.childId) || subtree.has(element.parentId))
        ) {
          return {
            ...element,
            ...getMindmapEdgeGeometry(
              moved.nodes.get(element.parentId)!,
              moved.nodes.get(element.childId)!,
              element.routing,
              direction,
            ),
          };
        }
        return element;
      });
      needsLayout = false;
      break;
    }
    case "deleteSubtree": {
      const graph = input.filter(
        (element) =>
          ((isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
            element.graphId === node.graphId) ||
          (isTextElement(element) &&
            element.containerId &&
            index.nodes.has(element.containerId)),
      );
      const result = applyMindmapTreeCommand(graph, node.id, {
        type: "delete",
      });
      if (!result) {
        throw new CanvasSceneError("invalid_operation", "脑图删除失败");
      }
      const deletedIds = new Set(
        result.elements
          .filter(
            (element) =>
              element.isDeleted &&
              !graph.find((old) => old.id === element.id)?.isDeleted,
          )
          .map((element) => element.id),
      );
      const scene = createCalculationScene(input);
      try {
        // 共享删除边界清理反向关系，墓碑保留全部历史元素。
        deleteSceneElements(deletedIds, scene);
        elements = scene.getElementsIncludingDeleted();
      } finally {
        scene.destroy();
      }
      if (node.role === "root") {
        rootNodeId = null;
        needsLayout = false;
      }
      break;
    }
  }
  if (needsLayout) {
    elements = layoutMindmapScene(elements, [node.graphId]);
  }
  return finishSceneOperation(input, elements, {
    domain: "mindmap",
    action: operation.action,
    graphId: node.graphId,
    nodeId,
    rootNodeId,
  });
};
