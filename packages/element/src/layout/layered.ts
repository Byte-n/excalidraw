import { isLinearElement } from "../typeChecks";

import { compareLayoutElements } from "./boxes";

import type { ExcalidrawElement } from "../types";

import type { LayoutOptions, LayoutPosition, LayoutWarning } from "./types";

type LayeredEdge = Readonly<{ from: string; to: string; id: string }>;

const getLayeredEdges = (
  elements: readonly ExcalidrawElement[],
  nodeIds: ReadonlySet<string>,
): readonly LayeredEdge[] => {
  const edges: LayeredEdge[] = [];
  for (const element of elements) {
    if (element.isDeleted || !isLinearElement(element)) {
      continue;
    }
    const from = element.startBinding?.elementId;
    const to = element.endBinding?.elementId;
    if (from && to && nodeIds.has(from) && nodeIds.has(to)) {
      edges.push({ from, to, id: element.id });
    }
  }
  return edges;
};

const getRankMap = (
  nodes: readonly ExcalidrawElement[],
  edges: readonly LayeredEdge[],
  warnings: LayoutWarning[],
): ReadonlyMap<string, number> => {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map<string, LayeredEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from);
    if (list) {
      list.push(edge);
    } else {
      outgoing.set(edge.from, [edge]);
    }
  }
  for (const list of outgoing.values()) {
    list.sort(
      (left, right) =>
        (order.get(left.to) ?? 0) - (order.get(right.to) ?? 0) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  }

  const colors = new Map<string, 0 | 1 | 2>();
  const forwardEdges: LayeredEdge[] = [];
  const reported = new Set<string>();
  const visit = (id: string) => {
    colors.set(id, 1);
    for (const edge of outgoing.get(id) ?? []) {
      const color = colors.get(edge.to) ?? 0;
      if (color === 1) {
        if (!reported.has(edge.id)) {
          reported.add(edge.id);
          warnings.push({
            code: "layout_cycle_ignored",
            message: "分层布局遇到环，已忽略该回边",
            path: `${edge.from}->${edge.to}`,
          });
        }
        continue;
      }
      forwardEdges.push(edge);
      if (color === 0) {
        visit(edge.to);
      }
    }
    colors.set(id, 2);
  };
  for (const node of nodes) {
    if ((colors.get(node.id) ?? 0) === 0) {
      visit(node.id);
    }
  }

  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const forward = new Map<string, LayeredEdge[]>();
  for (const edge of forwardEdges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const list = forward.get(edge.from);
    if (list) {
      list.push(edge);
    } else {
      forward.set(edge.from, [edge]);
    }
  }

  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  const ready = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id)
    .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  while (ready.length) {
    const id = ready.shift()!;
    for (const edge of forward.get(id) ?? []) {
      ranks.set(
        edge.to,
        Math.max(ranks.get(edge.to) ?? 0, (ranks.get(id) ?? 0) + 1),
      );
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) - 1);
      if ((indegree.get(edge.to) ?? 0) === 0) {
        ready.push(edge.to);
        ready.sort(
          (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
        );
      }
    }
  }
  return ranks;
};

export const layoutLayered = (
  elements: readonly ExcalidrawElement[],
  nodes: readonly ExcalidrawElement[],
  origin: LayoutPosition,
  options: LayoutOptions,
  warnings: LayoutWarning[],
): Map<string, LayoutPosition> => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = getLayeredEdges(elements, nodeIds);
  if (!edges.length) {
    warnings.push({
      code: "layout_no_edges",
      message: "分层布局没有可用的连线，按单行/单列排列",
    });
  }

  const sortedNodes = [...nodes].sort(compareLayoutElements);
  const ranks = getRankMap(sortedNodes, edges, warnings);
  const layerCount =
    Math.max(...sortedNodes.map((node) => ranks.get(node.id) ?? 0)) + 1;
  const layers: ExcalidrawElement[][] = Array.from(
    { length: layerCount },
    () => [],
  );
  for (const node of sortedNodes) {
    layers[ranks.get(node.id) ?? 0].push(node);
  }

  const direction = options.direction ?? "TB";
  const rankGap = options.rankGap ?? 80;
  const nodeGap = options.nodeGap ?? 40;
  const positions = new Map<string, LayoutPosition>();

  if (direction === "LR") {
    const columnWidths = layers.map((layer) =>
      layer.reduce((width, node) => Math.max(width, node.width), 0),
    );
    const columnHeights = layers.map((layer) =>
      layer.reduce(
        (height, node) =>
          height +
          node.height +
          (node === layer[layer.length - 1] ? 0 : nodeGap),
        0,
      ),
    );
    const totalHeight = Math.max(...columnHeights, 0);
    let x = origin.x;
    layers.forEach((layer, index) => {
      const height = columnHeights[index];
      let y = origin.y + (totalHeight - height) / 2;
      for (const node of layer) {
        positions.set(node.id, { x, y });
        y += node.height + nodeGap;
      }
      x += columnWidths[index] + rankGap;
    });
    return positions;
  }

  const rowHeights = layers.map((layer) =>
    layer.reduce((height, node) => Math.max(height, node.height), 0),
  );
  const rowWidths = layers.map((layer) =>
    layer.reduce(
      (width, node) =>
        width + node.width + (node === layer[layer.length - 1] ? 0 : nodeGap),
      0,
    ),
  );
  const totalWidth = Math.max(...rowWidths, 0);
  let y = origin.y;
  layers.forEach((layer, index) => {
    let x = origin.x + (totalWidth - rowWidths[index]) / 2;
    for (const node of layer) {
      positions.set(node.id, { x, y });
      x += node.width + nodeGap;
    }
    y += rowHeights[index] + rankGap;
  });
  return positions;
};
