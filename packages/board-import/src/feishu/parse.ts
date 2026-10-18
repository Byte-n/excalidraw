// 飞书原始节点树 → skeleton IR 的解析阶段。
//
// 本阶段只做类型分派、坐标归一化与 payload 投影，不构造 Excalidraw 元素。
// 坐标按 parent_id 链累加为场景绝对坐标；退化尺寸规整；角度由度数换算为
// 弧度；富文本按段落拼合为多行纯文本。范围外或未知类型计入 droppedNodes，
// 不产出 skeleton 节点。

import {
  type BoardSkeleton,
  type BoardSkeletonConnectorCaption,
  type BoardSkeletonConnectorEndpoint,
  type BoardSkeletonConnectorPayload,
  type BoardSkeletonKind,
  type BoardSkeletonNode,
  type BoardSkeletonText,
  normalizeDimension,
} from "../skeleton.js";

import type {
  LarkBoardNode,
  LarkConnectorEndpoint,
  LarkNodeRichTextParagraph,
  LarkNodeText,
  LarkPoint,
  LarkTableCell,
} from "../source.js";

// parse 阶段产出：skeleton + parse 级统计（被 importBoard 合并到 BoardImportStats）。
export interface ParseResult {
  skeleton: BoardSkeleton;
  // 范围外 / 未知类型丢弃计数（render 之后的资产放弃丢弃走 droppedAssets）。
  droppedNodes: number;
  // rich_text 按段落拼合为多行纯文本的发生次数。
  richTextFlattened: number;
}

const DEG_TO_RAD = Math.PI / 180;

// 飞书节点 type → skeleton kind 分派。返回 undefined 表示范围外或未知，
// 由调用方统一计入 droppedNodes（时序图 / 类图 / ER 图 / svg / group 与
// 任何未知类型同等丢弃，不做区分）。
function dispatchKind(type: string): BoardSkeletonKind | undefined {
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

function toRadians(deg: unknown): number {
  return typeof deg === "number" && Number.isFinite(deg) ? deg * DEG_TO_RAD : 0;
}

function toIntegerZIndex(z: unknown): number {
  return typeof z === "number" && Number.isFinite(z) ? Math.trunc(z) : 0;
}

// 扁平 text 对象 → BoardSkeletonText；rich_text 存在时按段落拼合多行纯文本，
// 样式回落到节点级 text 字段。返回时标记 richTextFlattened 计数通过引用。
function projectText(
  text: LarkNodeText | undefined,
  onRichText: () => void,
): BoardSkeletonText | undefined {
  if (!text) {
    return undefined;
  }
  const result: BoardSkeletonText = {
    text: typeof text.text === "string" ? text.text : "",
  };
  if (typeof text.font_size === "number") {
    result.fontSize = text.font_size;
  }
  if (typeof text.font_weight === "string") {
    result.fontWeight = text.font_weight;
  }
  if (
    text.horizontal_align === "left" ||
    text.horizontal_align === "center" ||
    text.horizontal_align === "right"
  ) {
    result.horizontalAlign = text.horizontal_align;
  }
  if (
    text.vertical_align === "top" ||
    text.vertical_align === "mid" ||
    text.vertical_align === "bottom"
  ) {
    result.verticalAlign = text.vertical_align;
  }
  if (typeof text.italic === "boolean") {
    result.italic = text.italic;
  }
  if (typeof text.underline === "boolean") {
    result.underline = text.underline;
  }
  if (typeof text.line_through === "boolean") {
    result.lineThrough = text.line_through;
  }
  if (typeof text.text_color === "string") {
    result.textColor = text.text_color;
  }
  if (typeof text.text_background_color_type === "number") {
    result.textBackgroundColorType = text.text_background_color_type;
  }

  const paragraphs = text.rich_text?.paragraphs;
  if (Array.isArray(paragraphs) && paragraphs.length > 0) {
    const lines = paragraphs.map((p) => paragraphToLine(p)).filter((l) => l);
    if (lines.length > 0) {
      result.text = lines.join("\n");
      result.richTextFlattened = true;
      onRichText();
    }
  }

  return result;
}

// 单段富文本：按 elements 拼成一行纯文本（run 级样式丢弃）。
function paragraphToLine(paragraph: LarkNodeRichTextParagraph): string {
  const elements = paragraph.elements;
  if (!Array.isArray(elements)) {
    return "";
  }
  return elements
    .map((e) =>
      typeof e.text_element?.text === "string" ? e.text_element.text : "",
    )
    .join("");
}

function projectEndpoint(
  endpoint: LarkConnectorEndpoint | undefined,
): BoardSkeletonConnectorEndpoint {
  const out: BoardSkeletonConnectorEndpoint = {};
  if (!endpoint) {
    return out;
  }
  if (typeof endpoint.arrow_style === "string") {
    out.arrowStyle = endpoint.arrow_style;
  }
  if (endpoint.position && isPoint(endpoint.position)) {
    out.position = { x: endpoint.position.x, y: endpoint.position.y };
  }
  const attached = endpoint.attached_object;
  if (attached) {
    if (typeof attached.id === "string") {
      out.attachedObjectId = attached.id;
    }
    if (attached.position && isPoint(attached.position)) {
      out.attachedPosition = { x: attached.position.x, y: attached.position.y };
    }
    if (typeof attached.snap_to === "string") {
      out.attachedSnapTo = attached.snap_to;
    }
  }
  return out;
}

function isPoint(value: unknown): value is LarkPoint {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LarkPoint).x === "number" &&
    typeof (value as LarkPoint).y === "number"
  );
}

// 表格单元格索引归一：飞书 cells 的 row_index / col_index 是 1 基（1..N），
// 统一在此减去 1 转为 0 基，render 阶段按 0 基消费。merge_info 的 span 是跨度
// 而非索引，不随基变化；索引缺失按首格（→ 0）处理。归一仅此一处。
function normalizeTableCell(cell: LarkTableCell): LarkTableCell {
  return {
    ...cell,
    row_index: (cell.row_index ?? 1) - 1,
    col_index: (cell.col_index ?? 1) - 1,
  };
}

// 解析飞书节点树为 skeleton IR。允许子先于父出现，先建 id→node 映射再
// 沿 parent_id 链递归累加坐标；父缺失或成环按根处理。
export function parseBoard(nodes: LarkBoardNode[]): ParseResult {
  const byId = new Map<string, LarkBoardNode>();
  for (const node of nodes) {
    if (typeof node.id === "string") {
      byId.set(node.id, node);
    }
  }

  const absCache = new Map<string, LarkPoint>();
  let richTextFlattened = 0;
  const onRichText = () => {
    richTextFlattened += 1;
  };

  const rel = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  // 沿 parent_id 链累加得到节点原点（相对父）的绝对坐标。带 visited 集合
  // 防御成环，环或缺失父节点时按根处理；结果记忆化供兄弟节点复用。
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
      const parentId =
        typeof current.parent_id === "string" ? current.parent_id : undefined;
      const parent = parentId ? byId.get(parentId) : undefined;
      if (!parent || parentId === current.id) {
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

  const irNodes: BoardSkeletonNode[] = [];
  let droppedNodes = 0;

  for (const node of nodes) {
    if (typeof node.id !== "string" || node.id.length === 0) {
      droppedNodes += 1;
      continue;
    }
    const kind = dispatchKind(node.type);
    if (kind === undefined) {
      // 范围外类型（时序图 / 类图 / ER 图 / svg / group 等）与未知类型
      // 同等丢弃并计入 droppedNodes，不产出 skeleton 节点。
      droppedNodes += 1;
      continue;
    }

    const origin = absoluteOrigin(node);
    const width = normalizeDimension(node.width);
    const height = normalizeDimension(node.height);
    const angle = toRadians(node.angle);
    const zIndex = toIntegerZIndex(node.z_index);
    const parentId =
      typeof node.parent_id === "string" && node.parent_id.length > 0
        ? node.parent_id
        : undefined;
    const childIds = Array.isArray(node.children)
      ? node.children.filter((c): c is string => typeof c === "string")
      : undefined;

    const irNode: BoardSkeletonNode = {
      id: node.id,
      kind,
      x: origin.x,
      y: origin.y,
      width,
      height,
      angle,
      zIndex,
    };
    if (parentId) {
      irNode.parentId = parentId;
    }
    if (childIds) {
      irNode.childIds = childIds;
    }

    switch (kind) {
      case "shape":
        irNode.shape = {
          shapeType:
            typeof node.composite_shape?.type === "string"
              ? node.composite_shape.type
              : undefined,
          style: node.style,
          text: projectText(node.text, onRichText),
        };
        if (irNode.shape?.text) {
          irNode.text = irNode.shape.text;
        }
        break;
      case "text":
        irNode.text = projectText(node.text, onRichText);
        break;
      case "connector": {
        const conn = node.connector ?? {};
        const captions: BoardSkeletonConnectorCaption[] = [];
        const captionData = conn.captions?.data;
        if (Array.isArray(captionData)) {
          for (const cap of captionData) {
            captions.push({
              textProps: projectText(cap, onRichText) ?? { text: "" },
              position:
                typeof conn.caption_position === "number"
                  ? conn.caption_position
                  : undefined,
              positionType:
                typeof conn.caption_position_type === "number"
                  ? conn.caption_position_type
                  : undefined,
              autoDirection:
                typeof conn.caption_auto_direction === "boolean"
                  ? conn.caption_auto_direction
                  : undefined,
            });
          }
        }
        const turningPoints: LarkPoint[] = [];
        if (Array.isArray(conn.turning_points)) {
          for (const tp of conn.turning_points) {
            if (isPoint(tp)) {
              turningPoints.push({ x: tp.x, y: tp.y });
            }
          }
        }
        const payload: BoardSkeletonConnectorPayload = {
          shape: conn.shape ?? "straight",
          start: projectEndpoint(conn.start),
          end: projectEndpoint(conn.end),
          turningPoints,
          captions,
        };
        if (typeof conn.specified_coordinate === "boolean") {
          payload.specifiedCoordinate = conn.specified_coordinate;
        }
        irNode.connector = payload;
        break;
      }
      case "section":
        irNode.section = {
          title:
            typeof node.section?.title === "string"
              ? node.section.title
              : undefined,
          style: node.style,
        };
        break;
      case "table": {
        const table = node.table ?? {};
        irNode.table = {
          title: typeof table.title === "string" ? table.title : undefined,
          meta: table.meta,
          cells: Array.isArray(table.cells)
            ? table.cells.map(normalizeTableCell)
            : [],
        };
        break;
      }
      case "mindMap": {
        const treeParentId =
          typeof node.mind_map?.parent_id === "string"
            ? node.mind_map.parent_id
            : undefined;
        const root = node.mind_map_root;
        const nodePayload = node.mind_map_node;
        irNode.mindMap = {
          treeParentId,
          root: root
            ? {
                layout:
                  typeof root.layout === "string" ? root.layout : undefined,
                lineStyle:
                  typeof root.line_style === "string"
                    ? root.line_style
                    : undefined,
                type: typeof root.type === "string" ? root.type : undefined,
                leftChildren: Array.isArray(root.left_children)
                  ? root.left_children.filter(
                      (c): c is string => typeof c === "string",
                    )
                  : undefined,
                rightChildren: Array.isArray(root.right_children)
                  ? root.right_children.filter(
                      (c): c is string => typeof c === "string",
                    )
                  : undefined,
              }
            : undefined,
          node: nodePayload
            ? {
                type:
                  typeof nodePayload.type === "string"
                    ? nodePayload.type
                    : undefined,
                collapsed:
                  typeof nodePayload.collapsed === "boolean"
                    ? nodePayload.collapsed
                    : undefined,
                layoutPosition: nodePayload.layout_position,
                zIndex:
                  typeof nodePayload.z_index === "number"
                    ? nodePayload.z_index
                    : undefined,
              }
            : undefined,
          text: projectText(node.text, onRichText),
        };
        if (irNode.mindMap?.text) {
          irNode.text = irNode.mindMap.text;
        }
        break;
      }
      case "stickyNote":
        irNode.stickyNote = {
          style: node.style,
          text: projectText(node.text, onRichText),
        };
        if (irNode.stickyNote?.text) {
          irNode.text = irNode.stickyNote.text;
        }
        break;
      case "paint": {
        const paint = node.paint ?? {};
        const points: LarkPoint[] = [];
        if (Array.isArray(paint.lines)) {
          for (const ln of paint.lines) {
            if (isPoint(ln)) {
              points.push({ x: ln.x, y: ln.y });
            }
          }
        }
        irNode.paint = {
          color: typeof paint.color === "string" ? paint.color : undefined,
          type: typeof paint.type === "string" ? paint.type : undefined,
          width: typeof paint.width === "number" ? paint.width : undefined,
          points,
        };
        break;
      }
      case "image":
        irNode.image = {
          token:
            typeof node.image?.token === "string"
              ? node.image.token
              : undefined,
          hFlip:
            typeof node.style?.h_flip === "boolean"
              ? node.style.h_flip
              : undefined,
          vFlip:
            typeof node.style?.v_flip === "boolean"
              ? node.style.v_flip
              : undefined,
        };
        break;
    }

    irNodes.push(irNode);
  }

  return {
    skeleton: { nodes: irNodes },
    droppedNodes,
    richTextFlattened,
  };
}
