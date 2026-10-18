// 转换层入口：飞书原始节点数组 → 场景元素 + 资产请求 + 统计增量。
//
// 编排：解析派生结构 → 第一遍（非连线元素）→ 第二遍（连线）→ 容器归属 /
// 绑定 / 思维导图边 / boundElements / 分数索引。连线统一留到第二遍，等被引用
// 的目标图元全部就绪，绑定不依赖飞书返回顺序。整板闸门由导入管线在入口调用。

import { STROKE_WIDTH } from "@excalidraw/common";

import {
  newElement,
  newFrameElement,
  newFreeDrawElement,
  newImageElement,
  newStickyNoteElement,
} from "@excalidraw/element";

import { generateNKeysBetween } from "@excalidraw/fractional-indexing";

import type {
  ElementBinding,
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FileId,
} from "@excalidraw/element/types";

import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import { ensureHeadlessTextMetrics } from "../text-metrics.js";

import {
  FALLBACK_SHAPE,
  mapFillColor,
  mapStrokeColor,
  mapStrokeStyle,
  mapStrokeWidth,
  resolveCompositeShape,
} from "../mapping.js";

import { buildConnector } from "./connector.js";
import { identity, localPoint, toFractionalIndex } from "./identity.js";
import {
  buildMindmapEdge,
  buildMindmapNode,
  isMindMapRoot,
  mindmapTreeParentId,
} from "./mindmap.js";
import { isLarkPoint, resolveNodes } from "./resolve.js";
import { buildTable, buildTableTexts } from "./table.js";
import { buildBoundText, buildStandaloneText, projectText } from "./text.js";

import type { Draft } from "./identity.js";
import type { ResolvedNode } from "./resolve.js";
import type {
  BoardAssetRequest,
  BoardConversion,
  BoardImportElement,
} from "../types.js";
import type { LarkBoardNode, LarkPoint } from "../source.js";

// 图片 fileId：同一 token 稳定复现，物化阶段作为 assets 键。
function imageFileId(token: string): string {
  return `lark-image:${token}`;
}

// 场景元素收敛：把 fork 元素的 `index`（可能为 null）归一为非空字符串，
// 产出符合场景契约的 `ExcalidrawSceneElement`。
function toSceneElement(element: ExcalidrawElement): ExcalidrawSceneElement {
  return { ...element, index: element.index ?? "" };
}

// 转换入口：产出元素、资产请求与统计增量（mapped / droppedNodes /
// richTextFlattened / downgraded）。
export function convertBoard(nodes: LarkBoardNode[]): BoardConversion {
  ensureHeadlessTextMetrics();

  const { nodes: resolvedNodes, droppedNodes } = resolveNodes(nodes);

  const drafts: Draft[] = [];
  const byNodeId = new Map<string, Draft>();
  const nodeById = new Map<string, ResolvedNode>();
  // 思维导图节点单独持有具体子类型：边几何与树关系需要
  // ExcalidrawMindmapNodeElement，从共用的 ExcalidrawElement 联合里取会需要断言。
  const mindmapNodes = new Map<string, ExcalidrawMindmapNodeElement>();
  const containerKind = new Map<string, "frame" | "table">();
  const boundAdditions = new Map<
    string,
    { id: string; type: "arrow" | "text" }[]
  >();
  const bindingAdditions = new Map<
    string,
    { start?: ElementBinding; end?: ElementBinding }
  >();
  const assetRequests: BoardAssetRequest[] = [];
  // 产出过至少一个元素的节点 id 集合（mapped 统计）。
  const mappedIds = new Set<string>();
  let downgraded = 0;
  let richTextFlattened = 0;
  const onRichText = () => {
    richTextFlattened += 1;
  };

  for (const node of resolvedNodes) {
    nodeById.set(node.raw.id, node);
  }

  const push = (el: ExcalidrawElement, zKey: number): Draft => {
    const draft: Draft = { el, zKey };
    drafts.push(draft);
    return draft;
  };

  const registerBound = (
    targetId: string,
    id: string,
    type: "arrow" | "text",
  ) => {
    const list = boundAdditions.get(targetId) ?? [];
    list.push({ id, type });
    boundAdditions.set(targetId, list);
  };

  // 第一遍：非连线元素。
  for (const node of resolvedNodes) {
    const style = node.raw.style;
    switch (node.kind) {
      case "shape": {
        const resolved = resolveCompositeShape(node.raw.composite_shape?.type);
        if (resolved === undefined) {
          // 未登记的图形子类型降级为矩形：保留位置与主题色，计一次保真度损失。
          downgraded += 1;
        }
        const el = newElement({
          type: resolved?.type ?? "composite",
          shape: resolved?.shape ?? FALLBACK_SHAPE,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          strokeColor: mapStrokeColor(style?.border_color, "#1f2329"),
          backgroundColor: mapFillColor(style?.fill_color),
          strokeWidth: mapStrokeWidth(style?.border_width),
          strokeStyle: mapStrokeStyle(style?.border_style),
          ...identity(node.raw.id, node.angle),
        });
        byNodeId.set(node.raw.id, push(el, node.zIndex));
        mappedIds.add(node.raw.id);
        const text = projectText(node.raw.text, onRichText);
        if (text && text.text !== "") {
          const textDraft = push(
            buildBoundText(`${node.raw.id}#text`, text, node),
            node.zIndex + 0.1,
          );
          registerBound(node.raw.id, textDraft.el.id, "text");
        }
        break;
      }
      case "text": {
        const text = projectText(node.raw.text, onRichText) ?? { text: "" };
        byNodeId.set(
          node.raw.id,
          push(buildStandaloneText(node.raw.id, node, text), node.zIndex),
        );
        mappedIds.add(node.raw.id);
        break;
      }
      case "section": {
        const el = newFrameElement({
          name: node.raw.section?.title,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          strokeColor: mapStrokeColor(style?.border_color, "#1f2329"),
          backgroundColor: style?.fill_color ?? "transparent",
          ...identity(node.raw.id, node.angle),
        });
        containerKind.set(node.raw.id, "frame");
        byNodeId.set(node.raw.id, push(el, node.zIndex));
        mappedIds.add(node.raw.id);
        break;
      }
      case "table": {
        containerKind.set(node.raw.id, "table");
        byNodeId.set(node.raw.id, push(buildTable(node), node.zIndex));
        mappedIds.add(node.raw.id);
        const tableTexts = buildTableTexts(node);
        downgraded += tableTexts.downgraded;
        for (const textDraft of tableTexts.drafts) {
          push(textDraft.el, textDraft.zKey);
        }
        break;
      }
      case "mindMap": {
        const el = buildMindmapNode(node, nodeById);
        byNodeId.set(node.raw.id, push(el, node.zIndex));
        mindmapNodes.set(node.raw.id, el);
        mappedIds.add(node.raw.id);
        const text = projectText(node.raw.text, onRichText);
        if (text && text.text !== "") {
          const textDraft = push(
            buildBoundText(`${node.raw.id}#text`, text, node),
            node.zIndex + 0.1,
          );
          registerBound(node.raw.id, textDraft.el.id, "text");
        }
        break;
      }
      case "stickyNote": {
        const el = newStickyNoteElement({
          type: "stickynote",
          baseHeight: node.height,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          backgroundColor: mapFillColor(style?.fill_color),
          ...identity(node.raw.id, node.angle),
        });
        byNodeId.set(node.raw.id, push(el, node.zIndex));
        mappedIds.add(node.raw.id);
        const text = projectText(node.raw.text, onRichText);
        if (text && text.text !== "") {
          const textDraft = push(
            buildBoundText(`${node.raw.id}#text`, text, node),
            node.zIndex + 0.1,
          );
          registerBound(node.raw.id, textDraft.el.id, "text");
        }
        break;
      }
      case "paint": {
        const paint = node.raw.paint;
        const points: LarkPoint[] = [];
        if (Array.isArray(paint?.lines)) {
          for (const line of paint.lines) {
            if (isLarkPoint(line)) {
              points.push({ x: line.x, y: line.y });
            }
          }
        }
        const el = newFreeDrawElement({
          type: "freedraw",
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          points: points.map((p) => localPoint(p.x, p.y)),
          simulatePressure: false,
          strokeColor: paint?.color ?? "#1f2329",
          strokeWidth: paint?.width ?? STROKE_WIDTH.thin,
          opacity: paint?.type === "highlight" ? 50 : 100,
          ...identity(node.raw.id, node.angle),
        });
        byNodeId.set(node.raw.id, push(el, node.zIndex));
        mappedIds.add(node.raw.id);
        break;
      }
      case "image": {
        const token = node.raw.image?.token;
        if (token === undefined) {
          break;
        }
        const fileId = imageFileId(token);
        const el = newImageElement({
          type: "image",
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          fileId: fileId as FileId,
          status: "saved",
          scale: [style?.h_flip ? -1 : 1, style?.v_flip ? -1 : 1],
          ...identity(node.raw.id, node.angle),
        });
        byNodeId.set(node.raw.id, push(el, node.zIndex));
        mappedIds.add(node.raw.id);
        assetRequests.push({
          token,
          fileId,
          elementId: node.raw.id,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        });
        break;
      }
      case "connector":
        // 连线统一留到第二遍。
        break;
    }
  }

  // 第二遍（连线）：目标图元此时已全部进入 byNodeId，端点绑定与 boundElements
  // 可靠建立。
  for (const node of resolvedNodes) {
    if (node.kind !== "connector") {
      continue;
    }
    const built = buildConnector(node, byNodeId, onRichText);
    downgraded += built.downgraded;
    byNodeId.set(node.raw.id, push(built.arrow, node.zIndex));
    mappedIds.add(node.raw.id);
    if (built.binding) {
      bindingAdditions.set(built.arrow.id, built.binding);
    }
    if (built.caption) {
      push(built.caption.el, built.caption.zKey);
      registerBound(built.arrow.id, built.caption.el.id, "text");
    }
  }

  // 第三遍：容器归属 + 连线绑定 + 思维导图边 + boundElements + 分数索引。
  applyContainerRefs(resolvedNodes, byNodeId, containerKind);
  applyBindings(
    resolvedNodes,
    drafts,
    byNodeId,
    nodeById,
    mindmapNodes,
    boundAdditions,
    bindingAdditions,
  );
  applyIndexes(drafts);

  const elements: BoardImportElement[] = drafts.map((draft) =>
    toSceneElement(draft.el),
  );
  return {
    elements,
    assetRequests,
    downgraded,
    mapped: mappedIds.size,
    droppedNodes,
    richTextFlattened,
  };
}

// --- 容器归属 ---

function applyContainerRefs(
  nodes: ResolvedNode[],
  byNodeId: Map<string, Draft>,
  containerKind: Map<string, "frame" | "table">,
): void {
  for (const node of nodes) {
    const draft = byNodeId.get(node.raw.id);
    if (!draft || node.parentId === undefined) {
      continue;
    }
    if (containerKind.get(node.parentId) === "frame") {
      draft.el = {
        ...draft.el,
        containerRef: { kind: "frameLike", elementId: node.parentId },
      };
    }
  }
}

// --- 绑定、思维导图边与 boundElements ---

function applyBindings(
  nodes: ResolvedNode[],
  drafts: Draft[],
  byNodeId: Map<string, Draft>,
  nodeById: Map<string, ResolvedNode>,
  mindmapNodes: Map<string, ExcalidrawMindmapNodeElement>,
  boundAdditions: Map<string, { id: string; type: "arrow" | "text" }[]>,
  bindingAdditions: Map<
    string,
    { start?: ElementBinding; end?: ElementBinding }
  >,
): void {
  // 连线绑定落到箭头字段，并在目标元素登记 boundElements。
  for (const [arrowId, binding] of bindingAdditions) {
    const arrow = byNodeId.get(arrowId);
    if (arrow) {
      arrow.el = {
        ...arrow.el,
        ...(binding.start ? { startBinding: binding.start } : {}),
        ...(binding.end ? { endBinding: binding.end } : {}),
      };
    }
    if (binding.start) {
      registerArrowBinding(boundAdditions, binding.start.elementId, arrowId);
    }
    if (binding.end) {
      registerArrowBinding(boundAdditions, binding.end.elementId, arrowId);
    }
  }

  // 思维导图边：每个非根节点补一条 parent → child 的 edge 元素。
  for (const node of nodes) {
    if (node.kind !== "mindMap" || isMindMapRoot(node)) {
      continue;
    }
    const parentId = mindmapTreeParentId(node);
    const parent = parentId ? mindmapNodes.get(parentId) : undefined;
    const child = mindmapNodes.get(node.raw.id);
    if (!parentId || !parent || !child) {
      continue;
    }
    drafts.push(buildMindmapEdge(node, parent, child, nodeById));
  }

  // boundElements 统一写回（去重后合并到既有列表）。
  for (const draft of drafts) {
    const additions = boundAdditions.get(draft.el.id);
    if (!additions || additions.length === 0) {
      continue;
    }
    const existing = draft.el.boundElements ?? [];
    const seen = new Set(existing.map((entry) => entry.id));
    const merged = [...existing];
    for (const entry of additions) {
      if (!seen.has(entry.id)) {
        merged.push(entry);
        seen.add(entry.id);
      }
    }
    draft.el = { ...draft.el, boundElements: merged };
  }
}

function registerArrowBinding(
  boundAdditions: Map<string, { id: string; type: "arrow" | "text" }[]>,
  targetId: string,
  arrowId: string,
): void {
  const list = boundAdditions.get(targetId) ?? [];
  list.push({ id: arrowId, type: "arrow" });
  boundAdditions.set(targetId, list);
}

// --- 分数索引 ---

function applyIndexes(drafts: Draft[]): void {
  const ordered = [...drafts].sort((a, b) => a.zKey - b.zKey);
  const keys = generateNKeysBetween(null, null, ordered.length);
  ordered.forEach((draft, i) => {
    draft.el = {
      ...draft.el,
      index: toFractionalIndex(keys[i]),
    };
  });
}
