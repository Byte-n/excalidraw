import { randomId } from "@excalidraw/common";

import { isMindmapEdgeElement, isMindmapNodeElement } from "./typeChecks";

import type {
  ExcalidrawElement,
  MindmapEdgeRouting,
  MindmapLayoutDirection,
  MindmapNodeShape,
  StrokeStyle,
} from "./types";

/** 根节点承载的图级默认配置。 */
export type MindmapRootDefaults = {
  layoutDirection?: MindmapLayoutDirection;
  defaultNodeShape?: MindmapNodeShape;
  defaultEdgeRouting?: MindmapEdgeRouting;
  defaultEdgeStrokeColor?: string;
  defaultEdgeStrokeWidth?: number;
  defaultEdgeStrokeStyle?: StrokeStyle;
};

export type RemapMindmapIdentityOptions = {
  /** 批次外仍可引用的父节点旧 id（例如导入目标场景中已有节点）。 */
  retainedParentIds?: ReadonlySet<string>;
  /** 被提升为根时继承的默认配置来源。 */
  resolveRootDefaults?(graphId: string): MindmapRootDefaults | undefined;
};

/**
 * 脑图身份重映射：`copies` 与 `originals` 按下标一一对应，只处理节点与边。
 * 同一旧图 id 映射到同一新图 id，同一旧节点 id 映射到同一新 id；父节点既不在
 * 批次内也不在 `retainedParentIds` 时把节点提升为根；边在三个引用都可映射时
 * 一起改写。直接写回 copy，不改动 originals。
 */
export const remapMindmapIdentity = (
  copies: readonly ExcalidrawElement[],
  originals: readonly ExcalidrawElement[],
  options?: RemapMindmapIdentityOptions,
): void => {
  const retainedParentIds = options?.retainedParentIds;
  const resolveRootDefaults = options?.resolveRootDefaults;
  const batchNodeIds = new Set(
    originals.filter(isMindmapNodeElement).map((node) => node.id),
  );
  const graphIdMap = new Map<string, string>();
  const nodeIdMap = new Map<string, string>();

  for (let index = 0; index < copies.length; index++) {
    const original = originals[index];
    const copy = copies[index];
    if (!isMindmapNodeElement(original) || !isMindmapNodeElement(copy)) {
      continue;
    }
    const graphId = graphIdMap.get(original.graphId) ?? randomId();
    graphIdMap.set(original.graphId, graphId);
    nodeIdMap.set(original.id, copy.id);

    const parentId = original.parentId;
    const isRoot =
      original.role === "root" ||
      !parentId ||
      !(batchNodeIds.has(parentId) || retainedParentIds?.has(parentId));
    Object.assign(copy, {
      graphId,
      role: isRoot ? "root" : "node",
      parentId: isRoot ? null : parentId,
      order: isRoot ? null : original.order,
    });
    if (isRoot && original.role !== "root") {
      const defaults = resolveRootDefaults?.(original.graphId);
      if (defaults) {
        // 只取图级默认配置，避免把来源节点的身份字段带进副本
        Object.assign(copy, {
          layoutDirection: defaults.layoutDirection,
          defaultNodeShape: defaults.defaultNodeShape,
          defaultEdgeRouting: defaults.defaultEdgeRouting,
          defaultEdgeStrokeColor: defaults.defaultEdgeStrokeColor,
          defaultEdgeStrokeWidth: defaults.defaultEdgeStrokeWidth,
          defaultEdgeStrokeStyle: defaults.defaultEdgeStrokeStyle,
        });
      }
    }
  }

  for (let index = 0; index < copies.length; index++) {
    const original = originals[index];
    const copy = copies[index];
    if (!isMindmapNodeElement(original) || !isMindmapNodeElement(copy)) {
      continue;
    }
    if (copy.role !== "node" || !original.parentId) {
      continue;
    }
    // 批次内的父节点改写为新 id；仅在保留集合中的父节点保持原 id
    const nextParentId = nodeIdMap.get(original.parentId);
    if (nextParentId) {
      Object.assign(copy, { parentId: nextParentId });
    }
  }

  for (let index = 0; index < copies.length; index++) {
    const original = originals[index];
    const copy = copies[index];
    if (!isMindmapEdgeElement(original) || !isMindmapEdgeElement(copy)) {
      continue;
    }
    const graphId = graphIdMap.get(original.graphId);
    const parentId = nodeIdMap.get(original.parentId);
    const childId = nodeIdMap.get(original.childId);
    if (graphId && parentId && childId) {
      Object.assign(copy, { graphId, parentId, childId });
    }
  }
};
