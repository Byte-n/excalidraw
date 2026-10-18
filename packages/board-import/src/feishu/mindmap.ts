// 思维导图的类型映射、根查找与元素构造。
//
// 画布归属走顶层 parent_id，思维导图树关系走 mind_map.parent_id / root 子树，
// 两套层级互不混淆。非根节点补一条 parent → child 的 edge 元素，几何由 fork
// 的边路由计算。

import {
  DEFAULT_MINDMAP_EDGE_ROUTING,
  DEFAULT_MINDMAP_LAYOUT_DIRECTION,
  getMindmapEdgeGeometry,
  newMindmapEdgeElement,
  newMindmapNodeElement,
} from "@excalidraw/element";

import type {
  ExcalidrawMindmapNodeElement,
  MindmapEdgeRouting,
  MindmapLayoutDirection,
  MindmapNodeShape,
} from "@excalidraw/element/types";

import { identity, localPoint, toFractionalIndex } from "./identity.js";

import type { Draft } from "./identity.js";
import type { ResolvedNode } from "./resolve.js";

const MINDMAP_SHAPE_BY_TYPE: Record<string, MindmapNodeShape> = {
  mind_map_round_rect: "pill",
  mind_map_rect: "rectangle",
  mind_map_circle: "ellipse",
  mind_map_ellipse: "ellipse",
  mind_map_diamond: "diamond",
  mind_map_text: "text",
};

const MINDMAP_LAYOUT: Record<string, MindmapLayoutDirection> = {
  left_right: "left-to-right",
  right_left: "right-to-left",
  top_bottom: "top-to-bottom",
  bottom_top: "bottom-to-top",
};

// 思维导图树父节点（mind_map.parent_id），区别于画布 parent_id。
export function mindmapTreeParentId(node: ResolvedNode): string | undefined {
  const parentId = node.raw.mind_map?.parent_id;
  return typeof parentId === "string" ? parentId : undefined;
}

export function isMindMapRoot(node: ResolvedNode): boolean {
  return node.raw.mind_map_root !== undefined;
}

function mapMindmapShape(node: ResolvedNode): MindmapNodeShape {
  const type = node.raw.mind_map_root?.type ?? node.raw.mind_map_node?.type;
  if (type && type in MINDMAP_SHAPE_BY_TYPE) {
    return MINDMAP_SHAPE_BY_TYPE[type];
  }
  return "rectangle";
}

function mapMindmapLayout(node: ResolvedNode): MindmapLayoutDirection {
  const layout = node.raw.mind_map_root?.layout;
  return layout
    ? MINDMAP_LAYOUT[layout] ?? DEFAULT_MINDMAP_LAYOUT_DIRECTION
    : DEFAULT_MINDMAP_LAYOUT_DIRECTION;
}

function mapMindmapRouting(node: ResolvedNode): MindmapEdgeRouting {
  const lineStyle = node.raw.mind_map_root?.line_style;
  if (lineStyle === "round_angle" || lineStyle === "right_angle") {
    return "orthogonal";
  }
  return DEFAULT_MINDMAP_EDGE_ROUTING;
}

// 沿 mind_map.parent_id 链找到根节点 id，用于派生稳定的 graphId。
export function findMindmapRootId(
  node: ResolvedNode,
  nodeById: Map<string, ResolvedNode>,
): string {
  const visited = new Set<string>();
  let current: ResolvedNode | undefined = node;
  while (current) {
    if (visited.has(current.raw.id)) {
      return current.raw.id;
    }
    visited.add(current.raw.id);
    const parentId = mindmapTreeParentId(current);
    const parent = parentId ? nodeById.get(parentId) : undefined;
    if (!parent) {
      return current.raw.id;
    }
    current = parent;
  }
  return node.raw.id;
}

// 思维导图节点元素：根节点带布局与默认边路由，非根节点带树父与排序。
export function buildMindmapNode(
  node: ResolvedNode,
  nodeById: Map<string, ResolvedNode>,
): ExcalidrawMindmapNodeElement {
  const graphId = `mindmap:${findMindmapRootId(node, nodeById)}`;
  const root = isMindMapRoot(node);
  return newMindmapNodeElement({
    graphId,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    shape: mapMindmapShape(node),
    collapsed: node.raw.mind_map_node?.collapsed ?? false,
    ...(root
      ? {
          role: "root" as const,
          parentId: null,
          order: null,
          layoutDirection: mapMindmapLayout(node),
          defaultEdgeRouting: mapMindmapRouting(node),
          defaultEdgeStrokeStyle: "solid" as const,
        }
      : {
          role: "node" as const,
          parentId: mindmapTreeParentId(node) ?? node.raw.id,
          order: toFractionalIndex(`a${node.zIndex}`),
        }),
    ...identity(node.raw.id, node.angle),
  });
}

// 非根节点的边元素：几何与路由取自其所在思维导图的根。
export function buildMindmapEdge(
  node: ResolvedNode,
  parent: ExcalidrawMindmapNodeElement,
  child: ExcalidrawMindmapNodeElement,
  nodeById: Map<string, ResolvedNode>,
): Draft {
  const rootId = findMindmapRootId(node, nodeById);
  const rootNode = nodeById.get(rootId) ?? node;
  const routing = mapMindmapRouting(rootNode);
  const geometry = getMindmapEdgeGeometry(
    parent,
    child,
    routing,
    mapMindmapLayout(rootNode),
  );
  const edge = newMindmapEdgeElement({
    graphId: `mindmap:${rootId}`,
    parentId: mindmapTreeParentId(node) ?? node.raw.id,
    childId: node.raw.id,
    points: geometry.points.map(([x, y]) => localPoint(x, y)),
    routing,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    ...identity(`${node.raw.id}#edge`, 0),
  });
  return { el: edge, zKey: node.zIndex - 0.1 };
}
