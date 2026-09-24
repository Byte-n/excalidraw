import {
  generateKeyBetween,
  generateNKeysBetween,
  validateOrderKey,
} from "@excalidraw/fractional-indexing";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";

import { isMindmapEdgeElement, isMindmapNodeElement } from "./typeChecks";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapEdgeElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
  ExcalidrawRectangleElement,
  ExcalidrawDiamondElement,
  ExcalidrawEllipseElement,
  ElementsMap,
} from "./types";

/** 仅供几何计算复用，不允许把此临时形状写入 Scene。 */
export const getMindmapNodeGeometry = (
  node: ExcalidrawMindmapNodeElement,
):
  | ExcalidrawRectangleElement
  | ExcalidrawDiamondElement
  | ExcalidrawEllipseElement => ({
  ...node,
  type: node.shape === "pill" ? "rectangle" : node.shape,
});

export const getMindmapEdgePath = (
  edge: ExcalidrawMindmapEdgeElement,
): string => {
  const [start, ...rest] = edge.points;
  if (!start) {
    return "";
  }
  if (edge.routing === "curved" && edge.points.length === 4) {
    return `M ${start[0]} ${start[1]} C ${rest
      .map((p) => `${p[0]} ${p[1]}`)
      .join(", ")}`;
  }
  return `M ${start[0]} ${start[1]} ${rest
    .map((p) => `L ${p[0]} ${p[1]}`)
    .join(" ")}`;
};

export type MindmapGraphIndex = {
  graphId: string;
  rootId: string;
  nodes: Map<string, ExcalidrawMindmapNodeElement>;
  parentById: Map<string, string | null>;
  childrenById: Map<string, readonly string[]>;
  edgeByChildId: Map<string, ExcalidrawMindmapEdgeElement>;
  depthById: Map<string, number>;
};

export type MindmapLayoutResult = {
  elements: readonly ExcalidrawMindmapNodeElement[];
  edges: readonly ExcalidrawMindmapEdgeElement[];
  bounds: Bounds;
};

export const isValidMindmapOrder = (
  order: unknown,
): order is FractionalIndex => {
  if (typeof order !== "string") {
    return false;
  }
  try {
    validateOrderKey(order);
    return true;
  } catch {
    return false;
  }
};

// 使用字符序而非 localeCompare，保证不同客户端的排序一致。
const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const compareMindmapNodes = (
  a: ExcalidrawMindmapNodeElement,
  b: ExcalidrawMindmapNodeElement,
) => compareStrings(a.order ?? "", b.order ?? "") || compareStrings(a.id, b.id);

const withUpdates = <T extends ExcalidrawElement>(
  element: T,
  updates: Partial<T>,
): T =>
  Object.entries(updates).every(
    ([key, value]) => element[key as keyof T] === value,
  )
    ? element
    : { ...element, ...updates };

const getChildren = (nodes: Iterable<ExcalidrawMindmapNodeElement>) => {
  const children = new Map<string, ExcalidrawMindmapNodeElement[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  }
  for (const siblings of children.values()) {
    siblings.sort(compareMindmapNodes);
  }
  return children;
};

/** 只接受有效的树；不把非法结构静默交给布局或结构操作。 */
export const buildMindmapGraphIndex = (
  elements: readonly ExcalidrawElement[],
  graphId: string,
): MindmapGraphIndex => {
  const nodes = new Map<string, ExcalidrawMindmapNodeElement>();
  for (const element of elements) {
    if (
      !element.isDeleted &&
      isMindmapNodeElement(element) &&
      element.graphId === graphId
    ) {
      if (nodes.has(element.id)) {
        throw new Error(`Mindmap 节点 ID 重复: ${element.id}`);
      }
      nodes.set(element.id, element);
    }
  }
  const roots = [...nodes.values()].filter((node) => node.role === "root");
  if (!graphId || roots.length !== 1) {
    throw new Error(`Mindmap 必须有且仅有一个根节点: ${graphId}`);
  }
  const root = roots[0];
  if (root.parentId !== null || root.order !== null) {
    throw new Error(`Mindmap 根节点关系无效: ${root.id}`);
  }
  const parentById = new Map<string, string | null>();
  for (const node of nodes.values()) {
    parentById.set(node.id, node.parentId);
    if (
      node.id !== root.id &&
      (node.role !== "node" ||
        !nodes.has(node.parentId!) ||
        !isValidMindmapOrder(node.order))
    ) {
      throw new Error(`Mindmap 父节点或顺序无效: ${node.id}`);
    }
  }
  const childrenById = new Map<string, readonly string[]>();
  for (const [parentId, children] of getChildren(nodes.values())) {
    if (new Set(children.map((node) => node.order)).size !== children.length) {
      throw new Error(`Mindmap 同级顺序重复: ${parentId}`);
    }
    childrenById.set(
      parentId,
      children.map((node) => node.id),
    );
  }
  const depthById = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const childId of childrenById.get(id) ?? []) {
      if (depthById.has(childId)) {
        throw new Error(`Mindmap 存在环: ${childId}`);
      }
      depthById.set(childId, depthById.get(id)! + 1);
      queue.push(childId);
    }
  }
  if (depthById.size !== nodes.size) {
    throw new Error(`Mindmap 存在环或孤儿节点: ${graphId}`);
  }
  const edgeByChildId = new Map<string, ExcalidrawMindmapEdgeElement>();
  for (const edge of elements) {
    if (
      edge.isDeleted ||
      !isMindmapEdgeElement(edge) ||
      edge.graphId !== graphId
    ) {
      continue;
    }
    const child = nodes.get(edge.childId);
    if (
      !child ||
      child.role === "root" ||
      child.parentId !== edge.parentId ||
      edgeByChildId.has(child.id)
    ) {
      throw new Error(`Mindmap 连接线与节点关系不一致: ${edge.id}`);
    }
    edgeByChildId.set(child.id, edge);
  }
  return {
    graphId,
    rootId: root.id,
    nodes,
    parentById,
    childrenById,
    edgeByChildId,
    depthById,
  };
};

export const getMindmapSubtreeIds = (
  index: MindmapGraphIndex,
  nodeId: string,
): readonly string[] => {
  if (!index.nodes.has(nodeId)) {
    return [];
  }
  const ids = [nodeId];
  for (let i = 0; i < ids.length; i++) {
    ids.push(...(index.childrenById.get(ids[i]) ?? []));
  }
  return ids;
};

/** 折叠是派生的可见性，不修改 isDeleted、透明度或文本绑定。 */
export const getMindmapHiddenElementIds = (
  elements: readonly ExcalidrawElement[],
): ReadonlySet<string> => {
  const nodes = elements.filter(
    (element): element is ExcalidrawMindmapNodeElement =>
      !element.isDeleted && isMindmapNodeElement(element),
  );
  const hidden = new Set<string>();
  const queue = nodes.filter((node) => node.collapsed).map((node) => node.id);
  if (!queue.length) {
    return hidden;
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const children = getChildren(nodes);
  for (let i = 0; i < queue.length; i++) {
    const parent = nodeMap.get(queue[i])!;
    for (const child of children.get(parent.id) ?? []) {
      if (child.graphId === parent.graphId && !hidden.has(child.id)) {
        hidden.add(child.id);
        queue.push(child.id);
      }
    }
  }
  for (const element of elements) {
    if (
      (isMindmapEdgeElement(element) && hidden.has(element.childId)) ||
      (element.type === "text" &&
        element.containerId &&
        hidden.has(element.containerId))
    ) {
      hidden.add(element.id);
    }
  }
  return hidden;
};

export const isMindmapElementHidden = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): boolean => {
  let node = isMindmapNodeElement(element)
    ? element
    : isMindmapEdgeElement(element)
    ? elementsMap.get(element.childId)
    : element.type === "text" && element.containerId
    ? elementsMap.get(element.containerId)
    : undefined;
  if (!isMindmapNodeElement(node) || node.parentId === null) {
    return false;
  }
  const visited = new Set<string>();
  while (isMindmapNodeElement(node) && node.parentId && !visited.has(node.id)) {
    visited.add(node.id);
    const parent = elementsMap.get(node.parentId);
    if (
      !isMindmapNodeElement(parent) ||
      parent.isDeleted ||
      parent.graphId !== node.graphId
    ) {
      break;
    }
    if (parent.collapsed) {
      return true;
    }
    node = parent;
  }
  return false;
};

const createDerivedEdge = (
  parent: ExcalidrawMindmapNodeElement,
  child: ExcalidrawMindmapNodeElement,
  id: string,
): ExcalidrawMindmapEdgeElement => ({
  id,
  type: "mindmap-edge",
  graphId: child.graphId,
  parentId: parent.id,
  childId: child.id,
  routing: "orthogonal",
  points: [],
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  angle: 0 as Radians,
  strokeColor: child.strokeColor,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: child.strokeWidth,
  strokeStyle: "solid",
  roughness: 0,
  opacity: child.opacity,
  roundness: null,
  seed: child.seed,
  version: 1,
  versionNonce: 0,
  index: null,
  isDeleted: false,
  groupIds: [],
  frameId: child.frameId,
  boundElements: [],
  updated: child.updated,
  created: child.created,
  link: null,
  locked: true,
});

/**
 * 恢复边界的确定性修复。保留所有节点；多根、失效父节点和环挂到
 * ID 最小的既有根（没有根则取 ID 最小节点）。无效 edge 保留为墓碑。
 * 此函数不提交 Scene、History，也不递增版本；交互提交由调用方负责。
 */
export const repairMindmapElements = (
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] => {
  const graphs = new Map<string, ExcalidrawMindmapNodeElement[]>();
  for (const element of elements) {
    if (element.isDeleted || !isMindmapNodeElement(element)) {
      continue;
    }
    const graphId =
      typeof element.graphId === "string" && element.graphId
        ? element.graphId
        : `mindmap:${element.id}`;
    const nodes = graphs.get(graphId) ?? [];
    nodes.push(withUpdates(element, { graphId }));
    graphs.set(graphId, nodes);
  }
  const replacements = new Map<string, ExcalidrawElement>();
  const addedEdges: ExcalidrawMindmapEdgeElement[] = [];
  const usedIds = new Set(elements.map((element) => element.id));
  const retainedEdges = new Set<string>();
  const edgesByGraph = new Map<string, ExcalidrawMindmapEdgeElement[]>();
  for (const element of elements) {
    if (!element.isDeleted && isMindmapEdgeElement(element)) {
      const edges = edgesByGraph.get(element.graphId) ?? [];
      edges.push(element);
      edgesByGraph.set(element.graphId, edges);
    }
  }
  for (const [graphId, graphNodes] of [...graphs].sort(([a], [b]) =>
    compareStrings(a, b),
  )) {
    graphNodes.sort((a, b) => compareStrings(a.id, b.id));
    const root =
      graphNodes.find((node) => node.role === "root") ?? graphNodes[0];
    const nodes = new Map(graphNodes.map((node) => [node.id, node]));
    for (const node of nodes.values()) {
      nodes.set(
        node.id,
        withUpdates(
          node,
          node.id === root.id
            ? { role: "root", parentId: null, order: null }
            : {
                role: "node",
                parentId:
                  node.parentId &&
                  node.parentId !== node.id &&
                  nodes.has(node.parentId)
                    ? node.parentId
                    : root.id,
              },
        ),
      );
    }
    // 每个节点最多遍历一次，深树不依赖递归栈。
    const complete = new Set([root.id]);
    for (const node of nodes.values()) {
      const path = new Set<string>();
      let current = node.id;
      while (!complete.has(current)) {
        if (path.has(current)) {
          nodes.set(
            current,
            withUpdates(nodes.get(current)!, {
              role: "node",
              parentId: root.id,
            }),
          );
          break;
        }
        path.add(current);
        current = nodes.get(current)!.parentId!;
      }
      for (const id of path) {
        complete.add(id);
      }
    }
    for (const siblings of getChildren(nodes.values()).values()) {
      if (
        siblings.some((node) => !isValidMindmapOrder(node.order)) ||
        new Set(siblings.map((node) => node.order)).size !== siblings.length
      ) {
        const orders = generateNKeysBetween(null, null, siblings.length);
        siblings.forEach((node, i) =>
          nodes.set(
            node.id,
            withUpdates(node, { order: orders[i] as FractionalIndex }),
          ),
        );
      }
    }
    for (const node of nodes.values()) {
      replacements.set(node.id, node);
    }
    const edgesByChild = new Map<string, ExcalidrawMindmapEdgeElement>();
    for (const edge of (edgesByGraph.get(graphId) ?? []).sort((a, b) =>
      compareStrings(a.id, b.id),
    )) {
      if (!edgesByChild.has(edge.childId)) {
        edgesByChild.set(edge.childId, edge);
      }
    }
    for (const node of nodes.values()) {
      if (node.role === "root") {
        continue;
      }
      const existing = edgesByChild.get(node.id);
      if (existing) {
        retainedEdges.add(existing.id);
        replacements.set(
          existing.id,
          withUpdates(existing, { parentId: node.parentId }),
        );
      } else {
        const baseId = `mindmap-edge:${JSON.stringify([graphId, node.id])}`;
        let id = baseId;
        let suffix = 0;
        while (usedIds.has(id)) {
          id = `${baseId}:${++suffix}`;
        }
        usedIds.add(id);
        addedEdges.push(createDerivedEdge(nodes.get(node.parentId)!, node, id));
      }
    }
  }
  let changed = addedEdges.length > 0;
  const result = elements.map((element) => {
    const next =
      !element.isDeleted &&
      isMindmapEdgeElement(element) &&
      !retainedEdges.has(element.id)
        ? withUpdates(element, { isDeleted: true })
        : replacements.get(element.id) ?? element;
    changed ||= next !== element;
    return next;
  });
  return changed ? [...result, ...addedEdges] : elements;
};

/** 左到右纯布局：保持根节点位置，兄弟子树互不重叠，隐藏节点不参与计算。 */
export const layoutMindmap = (
  index: MindmapGraphIndex,
  config: { levelGap?: number; siblingGap?: number } = {},
): MindmapLayoutResult => {
  const levelGap = config.levelGap ?? 80;
  const siblingGap = config.siblingGap ?? 24;
  if (
    !Number.isFinite(levelGap) ||
    !Number.isFinite(siblingGap) ||
    levelGap < 0 ||
    siblingGap < 0
  ) {
    throw new Error("Mindmap 布局间距必须是非负有限数");
  }
  const root = index.nodes.get(index.rootId)!;
  const visible = [root.id];
  const childrenById = new Map<string, readonly string[]>();
  for (let i = 0; i < visible.length; i++) {
    const node = index.nodes.get(visible[i])!;
    if (
      ![node.x, node.y, node.width, node.height].every(Number.isFinite) ||
      node.width <= 0 ||
      node.height <= 0
    ) {
      throw new Error(`Mindmap 节点尺寸无效: ${node.id}`);
    }
    const children = node.collapsed
      ? []
      : index.childrenById.get(node.id) ?? [];
    childrenById.set(node.id, children);
    visible.push(...children);
  }
  const heights = new Map<string, number>();
  for (let i = visible.length - 1; i >= 0; i--) {
    const id = visible[i];
    const children = childrenById.get(id)!;
    const total =
      children.reduce((height, child) => height + heights.get(child)!, 0) +
      Math.max(0, children.length - 1) * siblingGap;
    heights.set(id, Math.max(index.nodes.get(id)!.height, total));
  }
  const positions = new Map<string, ExcalidrawMindmapNodeElement>([
    [root.id, root],
  ]);
  const bounds: [number, number, number, number] = [
    root.x,
    root.y,
    root.x + root.width,
    root.y + root.height,
  ];
  for (const id of visible) {
    const parent = positions.get(id)!;
    const children = childrenById.get(id)!;
    const total =
      children.reduce((height, child) => height + heights.get(child)!, 0) +
      Math.max(0, children.length - 1) * siblingGap;
    let top = parent.y + parent.height / 2 - total / 2;
    for (const childId of children) {
      const child = index.nodes.get(childId)!;
      const height = heights.get(childId)!;
      const next = withUpdates(child, {
        x: parent.x + parent.width + levelGap,
        y: top + (height - child.height) / 2,
        angle: 0 as Radians,
      });
      positions.set(childId, next);
      bounds[0] = Math.min(bounds[0], next.x);
      bounds[1] = Math.min(bounds[1], next.y);
      bounds[2] = Math.max(bounds[2], next.x + next.width);
      bounds[3] = Math.max(bounds[3], next.y + next.height);
      top += height + siblingGap;
    }
  }
  const edges: ExcalidrawMindmapEdgeElement[] = [];
  for (const child of positions.values()) {
    if (child.role === "root") {
      continue;
    }
    const parent = positions.get(child.parentId)!;
    const x = parent.x + parent.width;
    const startY = parent.y + parent.height / 2;
    const endY = child.y + child.height / 2;
    const y = Math.min(startY, endY);
    const width = child.x - x;
    const points = [
      pointFrom<LocalPoint>(0, startY - y),
      pointFrom<LocalPoint>(width / 2, startY - y),
      pointFrom<LocalPoint>(width / 2, endY - y),
      pointFrom<LocalPoint>(width, endY - y),
    ];
    const edge =
      index.edgeByChildId.get(child.id) ??
      createDerivedEdge(
        parent,
        child,
        `mindmap-edge:${JSON.stringify([index.graphId, child.id])}`,
      );
    const samePoints =
      edge.points.length === points.length &&
      edge.points.every(
        (point, i) => point[0] === points[i][0] && point[1] === points[i][1],
      );
    edges.push(
      withUpdates(edge, {
        x,
        y,
        width,
        height: Math.abs(endY - startY),
        angle: 0 as Radians,
        points: samePoints ? edge.points : points,
      }),
    );
  }
  return { elements: [...positions.values()], edges, bounds };
};

/** 影子树操作：拒绝根节点、跨图和环；调用方可先布局预览再原子提交。 */
export const reparentMindmapNode = (
  index: MindmapGraphIndex,
  nodeId: string,
  parentId: string,
  beforeId: string | null = null,
): readonly ExcalidrawMindmapNodeElement[] => {
  const node = index.nodes.get(nodeId);
  const parent = index.nodes.get(parentId);
  if (
    !node ||
    node.role === "root" ||
    !parent ||
    getMindmapSubtreeIds(index, nodeId).includes(parentId)
  ) {
    throw new Error("Mindmap 挂接目标无效");
  }
  const siblings = (index.childrenById.get(parentId) ?? []).filter(
    (id) => id !== nodeId,
  );
  const position =
    beforeId === null ? siblings.length : siblings.indexOf(beforeId);
  if (position < 0) {
    throw new Error("Mindmap 插入位置无效");
  }
  const previous =
    position > 0 ? index.nodes.get(siblings[position - 1])!.order : null;
  const next =
    position < siblings.length
      ? index.nodes.get(siblings[position])!.order
      : null;
  const order = generateKeyBetween(previous, next) as FractionalIndex;
  return [...index.nodes.values()].map((element) =>
    element.id === nodeId
      ? withUpdates(element, { role: "node", parentId, order })
      : element,
  );
};
