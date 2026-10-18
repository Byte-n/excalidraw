// 飞书原始节点 → 可供元素构造消费的派生结构。
//
// 本模块只做类型分派与几何归一：id 索引、沿 parent_id 求绝对原点（记忆化 +
// 成环防御 + group 祖先穿透）、保留原始父相对原点（连线端点求局部量用）、
// 退化尺寸规整、角度换算、z_index 取整。不做任何 payload 投影，文本 / 端点 /
// 表格单元格一律由各构造器直接读 raw。

import { normalizeDimension, toIntegerZIndex, toRadians } from "./geometry.js";

import type { LarkBoardNode, LarkPoint } from "../source.js";

// 已建模的节点种类。范围外或未知类型不产出节点，由调用方计入 droppedNodes。
export type BoardNodeKind =
  | "shape"
  | "text"
  | "connector"
  | "section"
  | "table"
  | "mindMap"
  | "stickyNote"
  | "paint"
  | "image";

// 派生节点：只承载跨遍历共享的量。存在的硬理由：连线元素 x/y 要绝对原点，
// 而端点局部量要原始父相对原点，两者必须同时在手边。
export interface ResolvedNode {
  raw: LarkBoardNode;
  kind: BoardNodeKind;
  // 场景绝对坐标，已沿 parent_id 链累加。
  x: number;
  y: number;
  // 原始父相对坐标（未累加），始终是节点自身的原始值，不随祖先跳过规则变化。
  relX: number;
  relY: number;
  width: number;
  height: number;
  // 弧度。
  angle: number;
  zIndex: number;
  parentId?: string;
}

// 飞书节点 type → 已建模种类。返回 undefined 表示范围外或未知（时序图 / 类图 /
// ER 图 / svg / group 与任何未知类型同等丢弃，不做区分）。
export function dispatchKind(type: string): BoardNodeKind | undefined {
  switch (type) {
    case "composite_shape":
      return "shape";
    case "text_shape":
      return "text";
    case "connector":
      return "connector";
    case "section":
      return "section";
    case "table":
      return "table";
    case "mind_map":
      return "mindMap";
    case "sticky_note":
      return "stickyNote";
    case "paint":
      return "paint";
    case "image":
      return "image";
    default:
      return undefined;
  }
}

// 点结构判定：飞书点序列里可能混入非点元素，按点收窄。
export function isLarkPoint(value: unknown): value is LarkPoint {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LarkPoint).x === "number" &&
    typeof (value as LarkPoint).y === "number"
  );
}

function rel(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parentIdOf(node: LarkBoardNode): string | undefined {
  return typeof node.parent_id === "string" && node.parent_id.length > 0
    ? node.parent_id
    : undefined;
}

export interface ResolvedNodes {
  nodes: ResolvedNode[];
  // 非法 id 与范围外 / 未知类型节点数。
  droppedNodes: number;
}

// 解析飞书节点数组为派生结构。允许子先于父出现，先建 id 索引再沿 parent_id
// 链递归累加坐标；父缺失或成环按根处理。
export function resolveNodes(nodes: LarkBoardNode[]): ResolvedNodes {
  const byId = new Map<string, LarkBoardNode>();
  for (const node of nodes) {
    if (typeof node.id === "string" && node.id.length > 0) {
      byId.set(node.id, node);
    }
  }

  const absCache = new Map<string, LarkPoint>();

  // 指向自身的 parent_id 视为无父。
  const parentOf = (node: LarkBoardNode): LarkBoardNode | undefined => {
    const parentId = parentIdOf(node);
    if (!parentId || parentId === node.id) {
      return undefined;
    }
    return byId.get(parentId);
  };

  // 沿 parent_id 链累加得到节点原点的绝对坐标。带 visited 集合防御成环，
  // 环或缺失父节点时按根处理；结果记忆化供兄弟节点复用。
  const absoluteOrigin = (node: LarkBoardNode): LarkPoint => {
    const visited = new Set<string>();
    const resolve = (current: LarkBoardNode): LarkPoint => {
      const cached = absCache.get(current.id);
      if (cached) {
        return cached;
      }
      if (visited.has(current.id)) {
        // 成环：按根处理，避免无限递归。
        const origin = { x: rel(current.x), y: rel(current.y) };
        absCache.set(current.id, origin);
        return origin;
      }
      visited.add(current.id);
      // group 祖先的坐标是「穿透」的：子节点坐标不相对 group（飞书官方对 group
      // 坐标穿透的说明），故不累加 group 自身的偏移，继续沿它的父容器上溯。
      // 该跳过只作用于绝对坐标累加，节点自身的原始父相对坐标不受影响。
      let parent = parentOf(current);
      while (parent && parent.type === "group" && !visited.has(parent.id)) {
        visited.add(parent.id);
        parent = parentOf(parent);
      }
      if (!parent || visited.has(parent.id)) {
        const origin = { x: rel(current.x), y: rel(current.y) };
        absCache.set(current.id, origin);
        return origin;
      }
      const parentOrigin = resolve(parent);
      const origin = {
        x: parentOrigin.x + rel(current.x),
        y: parentOrigin.y + rel(current.y),
      };
      absCache.set(current.id, origin);
      return origin;
    };
    return resolve(node);
  };

  const resolved: ResolvedNode[] = [];
  let droppedNodes = 0;

  for (const node of nodes) {
    if (typeof node.id !== "string" || node.id.length === 0) {
      droppedNodes += 1;
      continue;
    }
    const kind = dispatchKind(node.type);
    if (kind === undefined) {
      droppedNodes += 1;
      continue;
    }

    const origin = absoluteOrigin(node);
    const parentId = parentIdOf(node);
    const resolvedNode: ResolvedNode = {
      raw: node,
      kind,
      x: origin.x,
      y: origin.y,
      relX: rel(node.x),
      relY: rel(node.y),
      width: normalizeDimension(node.width),
      height: normalizeDimension(node.height),
      angle: toRadians(node.angle),
      zIndex: toIntegerZIndex(node.z_index),
    };
    if (parentId) {
      resolvedNode.parentId = parentId;
    }
    resolved.push(resolvedNode);
  }

  return { nodes: resolved, droppedNodes };
}
