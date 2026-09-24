import {
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
  MindmapLayoutDirection,
  MindmapEdgeRouting,
  StrokeStyle,
} from "./types";

export const DEFAULT_MINDMAP_LAYOUT_DIRECTION: MindmapLayoutDirection =
  "left-to-right";
const MINDMAP_LEVEL_DISTANCE = 80;
const MINDMAP_SIBLING_DISTANCE = 24;
export const DEFAULT_MINDMAP_EDGE_ROUTING: MindmapEdgeRouting = "orthogonal";
export const DEFAULT_MINDMAP_EDGE_STROKE_WIDTH = 2;
export const DEFAULT_MINDMAP_EDGE_STROKE_STYLE: StrokeStyle = "solid";

export type MindmapLayoutConfig = {
  direction?: MindmapLayoutDirection;
  /** Alias accepted by callers that use the persisted field name. */
  layoutDirection?: MindmapLayoutDirection;
};

export type MindmapGraphStyleConfig = {
  defaultNodeShape?: ExcalidrawMindmapNodeElement["shape"];
  defaultEdgeRouting?: MindmapEdgeRouting;
  defaultEdgeStrokeColor?: string;
  defaultEdgeStrokeWidth?: number;
  defaultEdgeStrokeStyle?: StrokeStyle;
};

const isMindmapLayoutDirection = (
  value: unknown,
): value is MindmapLayoutDirection =>
  value === "left-to-right" ||
  value === "right-to-left" ||
  value === "top-to-bottom" ||
  value === "bottom-to-top";

const isMindmapNodeShape = (
  value: unknown,
): value is ExcalidrawMindmapNodeElement["shape"] =>
  value === "rectangle" ||
  value === "ellipse" ||
  value === "diamond" ||
  value === "pill";

const isMindmapEdgeRouting = (value: unknown): value is MindmapEdgeRouting =>
  value === "orthogonal" || value === "curved";

const isStrokeStyle = (value: unknown): value is StrokeStyle =>
  value === "solid" || value === "dashed" || value === "dotted";

export const getMindmapLayoutConfig = (
  root?: Pick<ExcalidrawMindmapNodeElement, "layoutDirection"> | null,
  config: MindmapLayoutConfig = {},
): { direction: MindmapLayoutDirection } => {
  const requestedDirection = config.direction ?? config.layoutDirection;
  const direction = isMindmapLayoutDirection(requestedDirection)
    ? requestedDirection
    : isMindmapLayoutDirection(root?.layoutDirection)
    ? root.layoutDirection
    : DEFAULT_MINDMAP_LAYOUT_DIRECTION;
  return { direction };
};

export const normalizeMindmapGraphConfig = (
  root: ExcalidrawMindmapNodeElement,
): ExcalidrawMindmapNodeElement => {
  const config = {
    direction: isMindmapLayoutDirection(root.layoutDirection)
      ? root.layoutDirection
      : DEFAULT_MINDMAP_LAYOUT_DIRECTION,
  };
  const updates: Partial<ExcalidrawMindmapNodeElement> = {
    layoutDirection: config.direction,
    defaultNodeShape: isMindmapNodeShape(root.defaultNodeShape)
      ? root.defaultNodeShape
      : "rectangle",
    defaultEdgeRouting: isMindmapEdgeRouting(root.defaultEdgeRouting)
      ? root.defaultEdgeRouting
      : DEFAULT_MINDMAP_EDGE_ROUTING,
    defaultEdgeStrokeColor:
      typeof root.defaultEdgeStrokeColor === "string"
        ? root.defaultEdgeStrokeColor
        : root.strokeColor,
    defaultEdgeStrokeWidth:
      Number.isFinite(root.defaultEdgeStrokeWidth) &&
      root.defaultEdgeStrokeWidth! >= 0
        ? root.defaultEdgeStrokeWidth
        : DEFAULT_MINDMAP_EDGE_STROKE_WIDTH,
    defaultEdgeStrokeStyle: isStrokeStyle(root.defaultEdgeStrokeStyle)
      ? root.defaultEdgeStrokeStyle
      : DEFAULT_MINDMAP_EDGE_STROKE_STYLE,
  };
  return withUpdates(root, updates);
};

export const copyMindmapGraphConfig = (
  source: ExcalidrawMindmapNodeElement,
  target: ExcalidrawMindmapNodeElement,
): ExcalidrawMindmapNodeElement =>
  withUpdates(target, {
    layoutDirection: source.layoutDirection,
    defaultNodeShape: source.defaultNodeShape,
    defaultEdgeRouting: source.defaultEdgeRouting,
    defaultEdgeStrokeColor: source.defaultEdgeStrokeColor,
    defaultEdgeStrokeWidth: source.defaultEdgeStrokeWidth,
    defaultEdgeStrokeStyle: source.defaultEdgeStrokeStyle,
  });

/** 仅供几何计算复用，不允许把此临时形状写入 Scene。 */
export const getMindmapNodeGeometry = (
  node: ExcalidrawMindmapNodeElement,
):
  | ExcalidrawRectangleElement
  | ExcalidrawDiamondElement
  | ExcalidrawEllipseElement => ({
  ...node,
  // Clipboard data from older Mindmap versions may not contain `shape`.
  // Keep rendering total and use the default rectangle in that case.
  type: node.shape === "pill" ? "rectangle" : node.shape ?? "rectangle",
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

/**
 * Expands a selection containing Mindmap nodes to complete subtrees while
 * keeping ordinary elements selected. Only edges whose two endpoints are in
 * the copied node set belong to a subtree; this deliberately excludes the
 * edge entering a copied subtree from its original parent.
 */
export const getMindmapElementsForSelection = (
  elements: readonly ExcalidrawElement[],
  selectedElements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] => {
  const selectedIds = new Set(selectedElements.map((element) => element.id));
  const selectedNodes = selectedElements.flatMap((element) => {
    if (isMindmapNodeElement(element)) {
      return [element];
    }
    if (element.type === "text" && element.containerId) {
      const container = elements.find(
        (candidate) => candidate.id === element.containerId,
      );
      return container && isMindmapNodeElement(container) ? [container] : [];
    }
    return [];
  });

  if (!selectedNodes.length) {
    return selectedElements;
  }

  const subtreeNodeIds = new Set<string>();
  for (const node of selectedNodes) {
    try {
      const index = buildMindmapGraphIndex(elements, node.graphId);
      getMindmapSubtreeIds(index, node.id).forEach((id) =>
        subtreeNodeIds.add(id),
      );
    } catch {
      subtreeNodeIds.add(node.id);
    }
  }

  return elements.filter((element) => {
    if (element.isDeleted) {
      return false;
    }
    if (isMindmapNodeElement(element)) {
      return subtreeNodeIds.has(element.id);
    }
    if (isMindmapEdgeElement(element)) {
      return (
        subtreeNodeIds.has(element.parentId) &&
        subtreeNodeIds.has(element.childId)
      );
    }
    if (element.type === "text" && element.containerId) {
      return subtreeNodeIds.has(element.containerId);
    }
    return selectedIds.has(element.id);
  });
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
  root?: ExcalidrawMindmapNodeElement,
): ExcalidrawMindmapEdgeElement => ({
  id,
  type: "mindmap-edge",
  graphId: child.graphId,
  parentId: parent.id,
  childId: child.id,
  routing: root?.defaultEdgeRouting ?? DEFAULT_MINDMAP_EDGE_ROUTING,
  points: [],
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  angle: 0 as Radians,
  strokeColor: root?.defaultEdgeStrokeColor ?? child.strokeColor,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth:
    root?.defaultEdgeStrokeWidth ??
    child.strokeWidth ??
    DEFAULT_MINDMAP_EDGE_STROKE_WIDTH,
  strokeStyle:
    root?.defaultEdgeStrokeStyle ?? DEFAULT_MINDMAP_EDGE_STROKE_STYLE,
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
    nodes.set(root.id, normalizeMindmapGraphConfig(nodes.get(root.id)!));
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
        addedEdges.push(
          createDerivedEdge(
            nodes.get(node.parentId)!,
            node,
            id,
            nodes.get(root.id),
          ),
        );
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

const getBoundaryPoint = (
  node: ExcalidrawMindmapNodeElement,
  target: { x: number; y: number },
  axis?: "horizontal" | "vertical",
): [number, number] => {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const dx = target.x - centerX;
  const dy = target.y - centerY;
  if (dx === 0 && dy === 0) {
    return [centerX, centerY];
  }
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  // Mindmap routes leave through the side of the node on the main axis. This
  // keeps the endpoint stable when sibling subtrees are vertically offset and
  // also matches the exact boundary for ellipse, diamond and pill shapes.
  if (
    axis === "horizontal" ||
    (axis === undefined && Math.abs(dx) >= Math.abs(dy))
  ) {
    return [centerX + Math.sign(dx) * halfWidth, centerY];
  }
  if (axis === "vertical" || Math.abs(dy) > Math.abs(dx)) {
    return [centerX, centerY + Math.sign(dy) * halfHeight];
  }
  return [centerX, centerY];
};

/** Computes a persisted edge's local geometry without changing its style. */
export const getMindmapEdgeGeometry = (
  parent: ExcalidrawMindmapNodeElement,
  child: ExcalidrawMindmapNodeElement,
  routing: MindmapEdgeRouting = DEFAULT_MINDMAP_EDGE_ROUTING,
  layoutDirection?: MindmapLayoutDirection,
) => {
  const parentCenter = {
    x: parent.x + parent.width / 2,
    y: parent.y + parent.height / 2,
  };
  const childCenter = {
    x: child.x + child.width / 2,
    y: child.y + child.height / 2,
  };
  const axis =
    layoutDirection === "top-to-bottom" || layoutDirection === "bottom-to-top"
      ? "vertical"
      : layoutDirection === "left-to-right" ||
        layoutDirection === "right-to-left"
      ? "horizontal"
      : undefined;
  const start = getBoundaryPoint(parent, childCenter, axis);
  const end = getBoundaryPoint(child, parentCenter, axis);
  // The route follows the graph's main axis. Choosing the axis from the
  // endpoint delta makes a horizontally laid out graph switch to a vertical
  // route whenever a subtree is vertically offset more than the level gap.
  const routeDirection =
    axis ??
    (Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1])
      ? "horizontal"
      : "vertical");
  const midpoint =
    routeDirection === "horizontal"
      ? (start[0] + end[0]) / 2
      : (start[1] + end[1]) / 2;
  const points: [number, number][] =
    routing === "curved"
      ? routeDirection === "horizontal"
        ? [start, [midpoint, start[1]], [midpoint, end[1]], end]
        : [start, [start[0], midpoint], [end[0], midpoint], end]
      : routeDirection === "horizontal"
      ? [start, [midpoint, start[1]], [midpoint, end[1]], end]
      : [start, [start[0], midpoint], [end[0], midpoint], end];
  const x = Math.min(...points.map((point) => point[0]));
  const y = Math.min(...points.map((point) => point[1]));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point[0])) - x,
    height: Math.max(...points.map((point) => point[1])) - y,
    points: points.map(([pointX, pointY]) =>
      pointFrom<LocalPoint>(pointX - x, pointY - y),
    ),
  };
};

/** Deterministic tree layout in all four visual directions. */
export const layoutMindmap = (
  index: MindmapGraphIndex,
  config: MindmapLayoutConfig = {},
): MindmapLayoutResult => {
  const root = index.nodes.get(index.rootId)!;
  const { direction } = getMindmapLayoutConfig(root, config);
  const isVertical =
    direction === "top-to-bottom" || direction === "bottom-to-top";
  const mainSign =
    direction === "right-to-left" || direction === "bottom-to-top" ? -1 : 1;
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
  const crossSizes = new Map<string, number>();
  const mainSizes = new Map<string, number>();
  const subtreeCrossSizes = new Map<string, number>();
  for (const id of visible) {
    const node = index.nodes.get(id)!;
    crossSizes.set(id, isVertical ? node.width : node.height);
    mainSizes.set(id, isVertical ? node.height : node.width);
  }
  for (let i = visible.length - 1; i >= 0; i--) {
    const id = visible[i];
    const children = childrenById.get(id)!;
    const total =
      children.reduce(
        (size, child) => size + subtreeCrossSizes.get(child)!,
        0,
      ) +
      Math.max(0, children.length - 1) * MINDMAP_SIBLING_DISTANCE;
    subtreeCrossSizes.set(id, Math.max(crossSizes.get(id)!, total));
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
      children.reduce(
        (size, child) => size + subtreeCrossSizes.get(child)!,
        0,
      ) +
      Math.max(0, children.length - 1) * MINDMAP_SIBLING_DISTANCE;
    let crossStart =
      (isVertical
        ? parent.x + parent.width / 2
        : parent.y + parent.height / 2) -
      total / 2;
    for (const childId of children) {
      const child = index.nodes.get(childId)!;
      const subtreeCross = subtreeCrossSizes.get(childId)!;
      const childCross =
        crossStart + (subtreeCross - crossSizes.get(childId)!) / 2;
      const parentMain = isVertical ? parent.y : parent.x;
      const parentMainSize = mainSizes.get(id)!;
      const childMain =
        parentMain +
        (mainSign > 0
          ? parentMainSize + MINDMAP_LEVEL_DISTANCE
          : -MINDMAP_LEVEL_DISTANCE - mainSizes.get(childId)!);
      const next = withUpdates(child, {
        x: isVertical ? childCross : childMain,
        y: isVertical ? childMain : childCross,
        angle: 0 as Radians,
      });
      positions.set(childId, next);
      bounds[0] = Math.min(bounds[0], next.x);
      bounds[1] = Math.min(bounds[1], next.y);
      bounds[2] = Math.max(bounds[2], next.x + next.width);
      bounds[3] = Math.max(bounds[3], next.y + next.height);
      crossStart += subtreeCross + MINDMAP_SIBLING_DISTANCE;
    }
  }
  const edges: ExcalidrawMindmapEdgeElement[] = [];
  for (const child of positions.values()) {
    if (child.role === "root") {
      continue;
    }
    const parent = positions.get(child.parentId)!;
    const edge =
      index.edgeByChildId.get(child.id) ??
      createDerivedEdge(
        parent,
        child,
        `mindmap-edge:${JSON.stringify([index.graphId, child.id])}`,
        index.nodes.get(index.rootId),
      );
    const geometry = getMindmapEdgeGeometry(
      parent,
      child,
      edge.routing,
      direction,
    );
    const samePoints =
      edge.x === geometry.x &&
      edge.y === geometry.y &&
      edge.points.length === geometry.points.length &&
      edge.points.every(
        (point, i) =>
          point[0] === geometry.points[i][0] &&
          point[1] === geometry.points[i][1],
      );
    edges.push(
      withUpdates(edge, {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        angle: 0 as Radians,
        points: samePoints ? edge.points : geometry.points,
      }),
    );
  }
  return { elements: [...positions.values()], edges, bounds };
};

export type MindmapTreeCommand =
  | { type: "toggleCollapse" }
  | { type: "delete" }
  | { type: "deletePreservingChildren"; replacementId?: string }
  | { type: "promote"; newGraphId: string };

/** 导航只返回本图可见节点，不改变结构或历史。 */
export const navigateMindmap = (
  index: MindmapGraphIndex,
  nodeId: string,
  direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
): string | null => {
  const node = index.nodes.get(nodeId);
  if (!node) {
    return null;
  }
  let ancestor = node.parentId;
  while (ancestor) {
    const parent = index.nodes.get(ancestor)!;
    if (parent.collapsed) {
      return null;
    }
    ancestor = parent.parentId;
  }
  if (direction === "ArrowLeft") {
    return node.parentId;
  }
  if (direction === "ArrowRight") {
    return node.collapsed ? null : index.childrenById.get(node.id)?.[0] ?? null;
  }
  const siblings = index.childrenById.get(node.parentId ?? "") ?? [];
  const position = siblings.indexOf(node.id);
  return siblings[position + (direction === "ArrowUp" ? -1 : 1)] ?? null;
};

/** 纯结构命令：先校验，再维护节点、绑定文字及连接线；不写场景或版本。 */
export const applyMindmapTreeCommand = (
  elements: readonly ExcalidrawElement[],
  nodeId: string,
  command: MindmapTreeCommand,
): {
  elements: readonly ExcalidrawElement[];
  graphIds: readonly string[];
  selectedNodeId: string | null;
} | null => {
  const node = elements.find(
    (element): element is ExcalidrawMindmapNodeElement =>
      element.id === nodeId &&
      !element.isDeleted &&
      isMindmapNodeElement(element),
  );
  if (!node) {
    return null;
  }
  const index = buildMindmapGraphIndex(elements, node.graphId);
  const children = index.childrenById.get(node.id) ?? [];
  const replacements = new Map<string, ExcalidrawElement>();
  const deletedIds = new Set<string>();
  const graphIds = [node.graphId];
  let selectedNodeId: string | null = node.id;
  const update = (
    id: string,
    updates: Partial<ExcalidrawMindmapNodeElement>,
  ) => {
    replacements.set(id, withUpdates(index.nodes.get(id)!, updates));
  };
  const insertChildren = (
    ids: readonly string[],
    parentId: string,
    previous: FractionalIndex | null,
    next: FractionalIndex | null,
  ) => {
    const orders = generateNKeysBetween(previous, next, ids.length);
    ids.forEach((id, i) =>
      update(id, { parentId, order: orders[i] as FractionalIndex }),
    );
  };

  if (command.type === "toggleCollapse") {
    if (!children.length) {
      return null;
    }
    update(node.id, { collapsed: !node.collapsed });
  } else if (command.type === "promote") {
    if (node.role === "root") {
      return null;
    }
    const parent = index.nodes.get(node.parentId)!;
    if (parent.role === "root") {
      if (
        !command.newGraphId ||
        elements.some(
          (element) =>
            isMindmapNodeElement(element) &&
            element.graphId === command.newGraphId,
        )
      ) {
        throw new Error("Mindmap 拆图 ID 必须唯一");
      }
      const subtree = new Set(getMindmapSubtreeIds(index, node.id));
      for (const id of subtree) {
        update(id, { graphId: command.newGraphId });
      }
      const promotedRoot = copyMindmapGraphConfig(
        index.nodes.get(index.rootId)!,
        {
          ...node,
          graphId: command.newGraphId,
          role: "root",
          parentId: null,
          order: null,
          x: parent.x,
          y: layoutMindmap(index).bounds[3] + 80,
        },
      );
      replacements.set(node.id, promotedRoot);
      for (const edge of index.edgeByChildId.values()) {
        if (edge.childId === node.id) {
          replacements.set(edge.id, withUpdates(edge, { isDeleted: true }));
        } else if (subtree.has(edge.childId)) {
          replacements.set(
            edge.id,
            withUpdates(edge, { graphId: command.newGraphId }),
          );
        }
      }
      graphIds.push(command.newGraphId);
    } else {
      const siblings = index.childrenById.get(parent.parentId)!;
      const next = siblings[siblings.indexOf(parent.id) + 1];
      insertChildren(
        [node.id],
        parent.parentId,
        parent.order,
        next ? index.nodes.get(next)!.order : null,
      );
    }
  } else {
    const siblings = index.childrenById.get(node.parentId ?? "") ?? [];
    const position = siblings.indexOf(node.id);
    const previous = siblings[position - 1];
    const next = siblings[position + 1];
    selectedNodeId = next ?? previous ?? node.parentId;
    if (command.type === "delete") {
      getMindmapSubtreeIds(index, node.id).forEach((id) => deletedIds.add(id));
    } else {
      if (
        command.replacementId !== undefined &&
        !children.includes(command.replacementId)
      ) {
        throw new Error("Mindmap 接替节点必须是直属子节点");
      }
      const replacementId =
        command.replacementId ??
        (children.length === 1 ? children[0] : undefined);
      if (replacementId) {
        const replacement = index.nodes.get(replacementId)!;
        const existingChildren = index.childrenById.get(replacement.id) ?? [];
        insertChildren(
          children.filter((id) => id !== replacement.id),
          replacement.id,
          existingChildren.length
            ? index.nodes.get(existingChildren[existingChildren.length - 1])!
                .order
            : null,
          null,
        );
        // 只接替被删节点的树位置，普通节点仍属于原父节点和原图。
        const replacementUpdates = {
          ...(node.role === "root"
            ? { role: "root", parentId: null, order: null }
            : { role: "node", parentId: node.parentId, order: node.order }),
          x: node.x,
          y: node.y,
        } as Partial<ExcalidrawMindmapNodeElement>;
        if (node.role === "root") {
          replacements.set(
            replacement.id,
            copyMindmapGraphConfig(
              node,
              withUpdates(replacement, replacementUpdates),
            ),
          );
        } else {
          update(replacement.id, replacementUpdates);
        }
        selectedNodeId = replacement.id;
      } else if (node.role === "root") {
        if (children.length) {
          throw new Error("Mindmap 保留子树删除根节点需要指定新根");
        }
      } else {
        insertChildren(
          children,
          node.parentId,
          previous ? index.nodes.get(previous)!.order : null,
          next ? index.nodes.get(next)!.order : null,
        );
        selectedNodeId = children[0] ?? selectedNodeId;
      }
      deletedIds.add(node.id);
    }
  }
  const nextElements = elements.map((element) => {
    if (element.isDeleted) {
      return element;
    }
    if (
      deletedIds.has(element.id) ||
      (element.type === "text" &&
        element.containerId &&
        deletedIds.has(element.containerId))
    ) {
      return withUpdates(element, { isDeleted: true });
    }
    return replacements.get(element.id) ?? element;
  });
  // 关系在命令内已确定，修复仅负责派生 edge，不允许静默换根。
  for (const graphId of graphIds) {
    const nodes = nextElements.filter(
      (element) =>
        !element.isDeleted &&
        isMindmapNodeElement(element) &&
        element.graphId === graphId,
    );
    if (nodes.length) {
      buildMindmapGraphIndex(nodes, graphId);
    }
  }
  return {
    elements: repairMindmapElements(nextElements),
    graphIds,
    selectedNodeId,
  };
};

/** 影子树操作：拒绝根节点、跨图和环；调用方可先布局预览再原子提交。 */
export const reparentMindmapNode = (
  index: MindmapGraphIndex,
  nodeId: string,
  parentId: string,
  beforeId: string | null = null,
): readonly ExcalidrawMindmapNodeElement[] =>
  reparentMindmapNodes(index, [nodeId], parentId, beforeId);

/**
 * Creates a shadow tree for a multi-branch drag without mutating the input.
 * Selected descendants of a selected parent are ignored and the remaining
 * branches retain their existing depth-first order.
 */
export const reparentMindmapNodes = (
  index: MindmapGraphIndex,
  nodeIds: readonly string[],
  parentId: string,
  beforeId: string | null = null,
): readonly ExcalidrawMindmapNodeElement[] => {
  const parent = index.nodes.get(parentId);
  const requested = [...new Set(nodeIds)];
  if (!parent || requested.length === 0) {
    throw new Error("Mindmap 挂接目标无效");
  }
  if (
    requested.some((id) => {
      const node = index.nodes.get(id);
      return (
        !node ||
        node.role === "root" ||
        node.graphId !== index.graphId ||
        getMindmapSubtreeIds(index, id).includes(parentId)
      );
    })
  ) {
    throw new Error("Mindmap 挂接目标无效");
  }

  const selected = new Set(requested);
  const branchRoots = requested.filter(
    (id) =>
      !requested.some(
        (candidate) =>
          candidate !== id &&
          getMindmapSubtreeIds(index, candidate).includes(id),
      ),
  );
  if (!branchRoots.length) {
    throw new Error("Mindmap 挂接目标无效");
  }
  const traversal: string[] = [];
  const visit = (id: string) => {
    traversal.push(id);
    (index.childrenById.get(id) ?? []).forEach(visit);
  };
  visit(index.rootId);
  const orderOf = new Map(traversal.map((id, position) => [id, position]));
  branchRoots.sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));

  const siblings = (index.childrenById.get(parentId) ?? []).filter(
    (id) => !selected.has(id),
  );
  const position =
    beforeId === null ? siblings.length : siblings.indexOf(beforeId);
  if (position < 0) {
    throw new Error("Mindmap 插入位置无效");
  }
  const currentSiblings = index.childrenById.get(parentId) ?? [];
  if (branchRoots.every((id) => index.nodes.get(id)?.parentId === parentId)) {
    const reordered = [...siblings];
    reordered.splice(position, 0, ...branchRoots);
    if (reordered.every((id, i) => id === currentSiblings[i])) {
      return [...index.nodes.values()];
    }
  }
  const previous =
    position > 0 ? index.nodes.get(siblings[position - 1])!.order : null;
  const next =
    position < siblings.length
      ? index.nodes.get(siblings[position])!.order
      : null;
  const orders = generateNKeysBetween(previous, next, branchRoots.length);
  const updates = new Map(
    branchRoots.map((id, i) => [
      id,
      {
        role: "node" as const,
        parentId,
        order: orders[i] as FractionalIndex,
      },
    ]),
  );
  return [...index.nodes.values()].map((element) => {
    const update = updates.get(element.id);
    return update ? withUpdates(element, update) : element;
  });
};
