// render 阶段：骨架 IR → Excalidraw 场景元素。
//
// 只做纯转换：查表选定原生模型（composite / flow / frame / table / mindmap /
// stickynote / freedraw / image / arrow / text），用 fork 的构造器产出元素并
// 显式补齐身份（id / seed / version / versionNonce / 分数索引）。容器归属、
// 元素间绑定与 boundElements 在第二遍补齐，避免前向引用。

import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  ROUNDNESS,
  STROKE_WIDTH,
} from "@excalidraw/common";

import {
  DEFAULT_MINDMAP_EDGE_ROUTING,
  DEFAULT_MINDMAP_LAYOUT_DIRECTION,
  getMindmapEdgeGeometry,
  newArrowElement,
  newElement,
  newFrameElement,
  newFreeDrawElement,
  newImageElement,
  newMindmapEdgeElement,
  newMindmapNodeElement,
  newStickyNoteElement,
  newTableElement,
  newTextElement,
  getTableCellBounds,
  getTableHeight,
  getTableWidth,
} from "@excalidraw/element";

import { generateNKeysBetween } from "@excalidraw/fractional-indexing";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type {
  ElementBinding,
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawTextElement,
  FileId,
  FractionalIndex,
  MindmapEdgeRouting,
  MindmapLayoutDirection,
  MindmapNodeShape,
  TableCellData,
  TableColumnData,
  TableRowData,
  TextAlign,
  VerticalAlign,
} from "@excalidraw/element/types";

import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import {
  type ConnectorRouting,
  FALLBACK_SHAPE,
  mapArrowhead,
  mapFillColor,
  mapStrokeColor,
  mapStrokeStyle,
  mapStrokeWidth,
  resolveCompositeShape,
  resolveConnectorShape,
} from "./mapping.js";
import { ensureHeadlessTextMetrics } from "./text-metrics.js";

import type {
  BoardSkeleton,
  BoardSkeletonConnectorEndpoint,
  BoardSkeletonNode,
  BoardSkeletonTablePayload,
  BoardSkeletonText,
} from "./skeleton.js";
import type { LarkTableCell } from "./source.js";

// 资产请求：飞书 image token + 确定性 fileId + 位置/尺寸，物化阶段据此注入
// 调用方解析好的资产引用。
export interface BoardAssetRequest {
  token: string;
  fileId: string;
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderResult {
  elements: ExcalidrawSceneElement[];
  assetRequests: BoardAssetRequest[];
  /** 被替换或压平的保真度损失次数（未知图形类型、箭头回落）。 */
  downgraded: number;
}

const DEFAULT_ROW_HEIGHT = 56;
const DEFAULT_COLUMN_WIDTH = 160;

// 元素身份：id / seed / version / versionNonce / groupIds 全部显式给定，
// seed 与 versionNonce 由 id 派生，保证同一输入稳定复现且不消耗全局随机序列。
function identity(id: string, angle: number) {
  return {
    id,
    angle: angle as Radians,
    seed: hashToSeed(id),
    version: 1,
    versionNonce: hashToSeed(`${id}#nonce`),
    groupIds: [] as string[],
  };
}

// djb2 派生 32 位整数种子。
function hashToSeed(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

// 图片 fileId：同一 token 稳定复现，物化阶段作为 assets 键。
function imageFileId(token: string): string {
  return `lark-image:${token}`;
}

// 表格网格 id 的确定性来源，避免 table 构造器消耗全局随机序列。
function makeRandomizer(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}:grid${counter++}`;
}

function toFractionalIndex(value: string): FractionalIndex {
  return value as FractionalIndex;
}

// 局部点：飞书点序列 → fork 的 `LocalPoint` 品牌元组。
function localPoint(x: number, y: number): LocalPoint {
  return [x, y] as LocalPoint;
}

// 场景元素收敛：把 fork 元素的 `index`（可能为 null）归一为非空字符串，
// 产出符合场景契约的 `ExcalidrawSceneElement`。
function toSceneElement(element: ExcalidrawElement): ExcalidrawSceneElement {
  return { ...element, index: element.index ?? "" };
}

function mapTextAlign(align: BoardSkeletonText["horizontalAlign"]): TextAlign {
  return align ?? "left";
}

function mapVerticalAlign(
  align: BoardSkeletonText["verticalAlign"],
): VerticalAlign {
  return align === "mid" ? "middle" : align === "bottom" ? "bottom" : "top";
}

// 容器内文本的锚点坐标：中心 / 右 / 底由比例给定，newTextElement 再按度量回退。
function containerAnchor(
  box: { x: number; y: number; width: number; height: number },
  text: BoardSkeletonText | undefined,
): { x: number; y: number } {
  const align = mapTextAlign(text?.horizontalAlign);
  const vertical = mapVerticalAlign(text?.verticalAlign);
  return {
    x:
      box.x +
      box.width * (align === "center" ? 0.5 : align === "right" ? 1 : 0),
    y:
      box.y +
      box.height *
        (vertical === "middle" ? 0.5 : vertical === "bottom" ? 1 : 0),
  };
}

// 内部草稿：以 fork 元素形状承载，便于第二遍补齐容器归属、绑定与索引。
interface Draft {
  el: ExcalidrawElement;
  zKey: number;
}

export function renderSkeleton(skeleton: BoardSkeleton): RenderResult {
  ensureHeadlessTextMetrics();

  const drafts: Draft[] = [];
  const byNodeId = new Map<string, Draft>();
  const nodeById = new Map<string, BoardSkeletonNode>();
  // 思维导图节点单独持有具体子类型：边几何与树关系需要 ExcalidrawMindmapNodeElement，
  // 从共用的 ExcalidrawElement 联合里取会需要类型断言。
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
  let downgraded = 0;

  for (const node of skeleton.nodes) {
    nodeById.set(node.id, node);
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

  for (const node of skeleton.nodes) {
    // 第一遍只建非连线元素；连线统一留到第二遍，等被引用的目标图元全部就绪，
    // 绑定不依赖飞书返回顺序。
    if (node.kind === "connector") {
      continue;
    }
    switch (node.kind) {
      case "shape": {
        const resolved = resolveCompositeShape(node.shape?.shapeType);
        if (resolved === undefined) {
          // 未登记的图形子类型降级为矩形：保留位置与主题色，计一次保真度损失。
          downgraded += 1;
        }
        const shape = resolved?.shape ?? FALLBACK_SHAPE;
        const type = resolved?.type ?? "composite";
        const el = newElement({
          type,
          shape,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          strokeColor: mapStrokeColor(
            node.shape?.style?.border_color,
            "#1f2329",
          ),
          backgroundColor: mapFillColor(node.shape?.style?.fill_color),
          strokeWidth: mapStrokeWidth(node.shape?.style?.border_width),
          strokeStyle: mapStrokeStyle(node.shape?.style?.border_style),
          ...identity(node.id, node.angle),
        });
        byNodeId.set(node.id, push(el, node.zIndex));
        if (node.shape?.text && node.shape.text.text !== "") {
          const textDraft = push(
            buildBoundText(`${node.id}#text`, node.shape.text, node),
            node.zIndex + 0.1,
          );
          registerBound(node.id, textDraft.el.id, "text");
        }
        break;
      }
      case "text": {
        byNodeId.set(
          node.id,
          push(buildStandaloneText(node.id, node), node.zIndex),
        );
        break;
      }
      case "section": {
        const el = newFrameElement({
          name: node.section?.title,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          strokeColor: mapStrokeColor(
            node.section?.style?.border_color,
            "#1f2329",
          ),
          backgroundColor: node.section?.style?.fill_color ?? "transparent",
          ...identity(node.id, node.angle),
        });
        containerKind.set(node.id, "frame");
        byNodeId.set(node.id, push(el, node.zIndex));
        break;
      }
      case "table": {
        containerKind.set(node.id, "table");
        byNodeId.set(node.id, push(buildTable(node), node.zIndex));
        const tableTexts = buildTableTexts(node);
        downgraded += tableTexts.downgraded;
        for (const textDraft of tableTexts.drafts) {
          push(textDraft.el, textDraft.zKey);
        }
        break;
      }
      case "mindMap": {
        const graphId = `mindmap:${findMindmapRootId(node, nodeById)}`;
        const root = isMindMapRoot(node);
        const el = newMindmapNodeElement({
          graphId,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          shape: mapMindmapShape(node),
          collapsed: node.mindMap?.node?.collapsed ?? false,
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
                parentId: node.mindMap?.treeParentId ?? node.id,
                order: toFractionalIndex(`a${node.zIndex}`),
              }),
          ...identity(node.id, node.angle),
        });
        byNodeId.set(node.id, push(el, node.zIndex));
        mindmapNodes.set(node.id, el);
        if (node.mindMap?.text && node.mindMap.text.text !== "") {
          const textDraft = push(
            buildBoundText(`${node.id}#text`, node.mindMap.text, node),
            node.zIndex + 0.1,
          );
          registerBound(node.id, textDraft.el.id, "text");
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
          backgroundColor: mapFillColor(node.stickyNote?.style?.fill_color),
          ...identity(node.id, node.angle),
        });
        byNodeId.set(node.id, push(el, node.zIndex));
        if (node.stickyNote?.text && node.stickyNote.text.text !== "") {
          const textDraft = push(
            buildBoundText(`${node.id}#text`, node.stickyNote.text, node),
            node.zIndex + 0.1,
          );
          registerBound(node.id, textDraft.el.id, "text");
        }
        break;
      }
      case "paint": {
        const paint = node.paint;
        const el = newFreeDrawElement({
          type: "freedraw",
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          points: (paint?.points ?? []).map((p) => localPoint(p.x, p.y)),
          simulatePressure: false,
          strokeColor: paint?.color ?? "#1f2329",
          strokeWidth: paint?.width ?? STROKE_WIDTH.thin,
          opacity: paint?.type === "highlight" ? 50 : 100,
          ...identity(node.id, node.angle),
        });
        byNodeId.set(node.id, push(el, node.zIndex));
        break;
      }
      case "image": {
        const token = node.image?.token;
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
          scale: [node.image?.hFlip ? -1 : 1, node.image?.vFlip ? -1 : 1],
          ...identity(node.id, node.angle),
        });
        byNodeId.set(node.id, push(el, node.zIndex));
        assetRequests.push({
          token,
          fileId,
          elementId: node.id,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        });
        break;
      }
    }
  }

  // 第二遍（连线）：目标图元此时已全部进入 byNodeId，端点绑定与 boundElements 可靠建立。
  for (const node of skeleton.nodes) {
    if (node.kind !== "connector") {
      continue;
    }
    const built = buildConnector(node, byNodeId);
    downgraded += built.downgraded;
    byNodeId.set(node.id, push(built.arrow, node.zIndex));
    if (built.binding) {
      bindingAdditions.set(built.arrow.id, built.binding);
    }
    if (built.caption) {
      push(built.caption.el, node.zIndex + 0.1);
      registerBound(built.arrow.id, built.caption.el.id, "text");
    }
  }

  // 第二遍：容器归属 + 连线绑定 + 思维导图边 + boundElements + 分数索引。
  applyContainerRefs(skeleton, byNodeId, containerKind);
  applyBindings(
    skeleton,
    drafts,
    byNodeId,
    nodeById,
    mindmapNodes,
    boundAdditions,
    bindingAdditions,
  );
  applyIndexes(drafts);

  return {
    elements: drafts.map((draft) => toSceneElement(draft.el)),
    assetRequests,
    downgraded,
  };
}

// --- 文本 ---

function buildStandaloneText(
  id: string,
  node: BoardSkeletonNode,
): ExcalidrawTextElement {
  const text = node.text ?? { text: "" };
  const element = newTextElement({
    text: text.text,
    fontSize: text.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: mapTextAlign(text.horizontalAlign),
    verticalAlign: mapVerticalAlign(text.verticalAlign),
    containerId: null,
    autoResize: false,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...identity(id, node.angle),
  });
  // 文本盒尺寸取骨架宽高（客户端会重算），故覆盖构造器的度量结果。
  return {
    ...element,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
}

// 形状 / 便签 / 思维导图节点内嵌文本：containerId 指向容器，容器侧登记 boundElements。
function buildBoundText(
  id: string,
  text: BoardSkeletonText,
  containerNode: BoardSkeletonNode,
): ExcalidrawTextElement {
  const anchor = containerAnchor(containerNode, text);
  return newTextElement({
    text: text.text,
    fontSize: text.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: mapTextAlign(text.horizontalAlign),
    verticalAlign: mapVerticalAlign(text.verticalAlign),
    containerId: containerNode.id,
    x: anchor.x,
    y: anchor.y,
    ...identity(id, 0),
  });
}

// --- 表格 ---

function buildTable(node: BoardSkeletonNode): ExcalidrawElement {
  const table = buildTableData(node);
  const base = newTableElement({
    type: "table",
    x: node.x,
    y: node.y,
    rowCount: table.rows.length,
    columnCount: table.columns.length,
    randomizer: makeRandomizer(node.id),
    ...identity(node.id, 0),
  });
  return {
    ...base,
    table,
    width: getTableWidth(table),
    height: getTableHeight(table),
  };
}

interface BuiltTableData {
  schemaVersion: 1;
  style: {
    borderColor: string;
    borderWidth: number;
    borderStyle: "solid" | "dashed" | "dotted";
    header: boolean;
  };
  rows: TableRowData[];
  columns: TableColumnData[];
  cells: TableCellData[];
}

function buildTableData(node: BoardSkeletonNode): BuiltTableData {
  const payload: BoardSkeletonTablePayload = node.table ?? { cells: [] };
  const meta = payload.meta;
  const rowCount = Math.max(
    1,
    meta?.row_num ?? payload.meta?.row_sizes?.length ?? 1,
  );
  const columnCount = Math.max(
    1,
    meta?.col_num ?? payload.meta?.col_sizes?.length ?? 1,
  );
  const rowSizes = meta?.row_sizes ?? [];
  const columnSizes = meta?.col_sizes ?? [];

  const rows: TableRowData[] = [];
  for (let r = 0; r < rowCount; r++) {
    rows.push({
      id: `${node.id}:row${r}`,
      height: positive(rowSizes[r], DEFAULT_ROW_HEIGHT),
    });
  }
  const columns: TableColumnData[] = [];
  for (let c = 0; c < columnCount; c++) {
    columns.push({
      id: `${node.id}:col${c}`,
      width: positive(columnSizes[c], DEFAULT_COLUMN_WIDTH),
    });
  }

  // 先求 merge 结构：锚点写 span，被覆盖格写 mergedInto。
  const cellIdAt = (r: number, c: number) => `${node.id}:cell:r${r}c${c}`;
  const mergedInto = new Map<string, string>();
  const spans = new Map<string, { columnSpan: number; rowSpan: number }>();
  for (const cell of payload.cells) {
    const r = cell.row_index ?? 0;
    const c = cell.col_index ?? 0;
    // 飞书样例的 span 可能越界（如两列表格里第 1 列起跨 2 列），按网格收敛，
    // 保证锚点 span 落在表格边界内、被覆盖格都存在。
    const colSpan = Math.min(
      cell.merge_info?.col_span ?? 1,
      Math.max(1, columnCount - c),
    );
    const rowSpan = Math.min(
      cell.merge_info?.row_span ?? 1,
      Math.max(1, rowCount - r),
    );
    if (colSpan > 1 || rowSpan > 1) {
      const anchorId = cellIdAt(r, c);
      spans.set(anchorId, { columnSpan: colSpan, rowSpan });
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) {
            continue;
          }
          mergedInto.set(cellIdAt(r + dr, c + dc), anchorId);
        }
      }
    }
  }

  const cells: TableCellData[] = [];
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < columnCount; c++) {
      const id = cellIdAt(r, c);
      const source = payload.cells.find(
        (cell) => (cell.row_index ?? 0) === r && (cell.col_index ?? 0) === c,
      );
      const span = spans.get(id);
      const covered = mergedInto.get(id);
      cells.push({
        id,
        rowId: rows[r].id,
        columnId: columns[c].id,
        style: source?.style?.fill_color
          ? { backgroundColor: source.style.fill_color }
          : {},
        ...(span ? { columnSpan: span.columnSpan, rowSpan: span.rowSpan } : {}),
        ...(covered ? { mergedInto: covered } : {}),
      });
    }
  }

  return {
    schemaVersion: 1,
    style: {
      borderColor: mapStrokeColor(meta?.style?.border_color, "#1f2329"),
      borderWidth: mapStrokeWidth(meta?.style?.border_width),
      borderStyle: mapStrokeStyle(meta?.style?.border_style),
      header: true,
    },
    rows,
    columns,
    cells,
  };
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

// 单元格文本：以「可见单元格（锚点）」为单位产出独立文本元素，containerRef 指向
// 该锚点的 tableCell 角色。被合并覆盖的格子不单独产出——它与锚点共用同一格，若
// 也产出会与锚点元素 id 撞车导致整板失败。覆盖格的非空文本按规则并入锚点：
// 锚点有文本则覆盖格文本丢弃；锚点无文本则取一个覆盖格文本落到锚点；两者皆空
// 不产出。每个被覆盖的非空文本都计一次保真度损失。
function buildTableTexts(node: BoardSkeletonNode): {
  drafts: Draft[];
  downgraded: number;
} {
  const payload: BoardSkeletonTablePayload = node.table ?? { cells: [] };
  const data = buildTableData(node);
  const sourceById = new Map<string, LarkTableCell>();
  for (const cell of payload.cells) {
    sourceById.set(
      `${node.id}:cell:r${cell.row_index ?? 0}c${cell.col_index ?? 0}`,
      cell,
    );
  }

  const drafts: Draft[] = [];
  let downgraded = 0;
  for (const cellData of data.cells) {
    if (cellData.mergedInto !== undefined) {
      // 覆盖格：内容随锚点处理，不单独产出。
      continue;
    }
    const anchorId = cellData.id;
    const anchorCell = sourceById.get(anchorId);
    const anchorText = cellText(anchorCell);
    const coveredCells: LarkTableCell[] = [];
    for (const other of data.cells) {
      if (other.mergedInto !== anchorId) {
        continue;
      }
      const coveredCell = sourceById.get(other.id);
      if (coveredCell !== undefined && cellText(coveredCell) !== "") {
        coveredCells.push(coveredCell);
      }
    }
    downgraded += coveredCells.length;

    const chosen =
      anchorText !== ""
        ? anchorCell
        : coveredCells.length > 0
        ? coveredCells[0]
        : undefined;
    if (chosen?.text === undefined) {
      continue;
    }
    const bounds = getTableCellBounds(data, anchorId);
    if (!bounds) {
      continue;
    }
    const box = {
      x: node.x + bounds.x,
      y: node.y + bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    const element = newTextElement({
      text: chosen.text.text ?? "",
      fontSize: chosen.text.font_size ?? DEFAULT_FONT_SIZE,
      fontFamily: DEFAULT_FONT_FAMILY,
      textAlign: mapTextAlign(chosen.text.horizontal_align),
      verticalAlign: mapVerticalAlign(chosen.text.vertical_align),
      containerRef: {
        kind: "tableCell",
        elementId: node.id,
        cellId: anchorId,
        role: "backgroundText",
      },
      x: box.x,
      y: box.y,
      ...identity(`${node.id}#cell:${anchorId}`, 0),
    });
    drafts.push({
      el: {
        ...element,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      zKey: node.zIndex + 0.1,
    });
  }
  return { drafts, downgraded };
}

// 单元格扁平文本的纯字符串取值（缺失或非字符串按空）。
function cellText(cell: LarkTableCell | undefined): string {
  const text = cell?.text?.text;
  return typeof text === "string" ? text : "";
}

// --- 连线 ---

interface BuiltConnector {
  arrow: ExcalidrawElement;
  binding?: { start?: ElementBinding; end?: ElementBinding };
  caption?: Draft;
  /** 端点箭头发生回落的次数（`single_arrow` 等）。 */
  downgraded: number;
}

function buildConnector(
  node: BoardSkeletonNode,
  byNodeId: Map<string, Draft>,
): BuiltConnector {
  const payload = node.connector;
  const origin = { x: node.x, y: node.y };
  const start = resolveEndpoint(payload?.start, origin, byNodeId);
  const end = resolveEndpoint(payload?.end, origin, byNodeId);

  const turning = payload?.turningPoints ?? [];
  const shapeRes = resolveConnectorShape(payload?.shape, turning.length > 0);
  const points = buildConnectorPoints(
    shapeRes.routing,
    turning,
    start.local,
    end.local,
  );
  const roundness =
    shapeRes.routing === "curve"
      ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
      : null;

  const startHead = mapArrowhead(payload?.start.arrowStyle);
  const endHead = mapArrowhead(payload?.end.arrowStyle);

  const arrow = newArrowElement({
    type: "arrow",
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    points,
    roundness,
    startArrowhead: startHead.arrowhead,
    endArrowhead: endHead.arrowhead,
    ...identity(node.id, node.angle),
  });

  const binding: { start?: ElementBinding; end?: ElementBinding } = {};
  if (start.binding) {
    binding.start = start.binding;
  }
  if (end.binding) {
    binding.end = end.binding;
  }

  const built: BuiltConnector = {
    arrow,
    downgraded:
      (startHead.downgraded ? 1 : 0) +
      (endHead.downgraded ? 1 : 0) +
      (shapeRes.downgraded ? 1 : 0),
  };
  if (binding.start || binding.end) {
    built.binding = binding;
  }
  const caption = buildConnectorCaption(node, origin, points);
  if (caption) {
    built.caption = caption;
  }
  return built;
}

interface ResolvedEndpoint {
  local: LocalPoint;
  binding?: ElementBinding;
}

// 端点两态：绑定态按 snap_to + 归一化 position 求目标边界上的 attachPoint；
// 坐标态直接用飞书绝对坐标。两种都换算为相对连线原点的局部坐标。
function resolveEndpoint(
  endpoint: BoardSkeletonConnectorEndpoint | undefined,
  origin: { x: number; y: number },
  byNodeId: Map<string, Draft>,
): ResolvedEndpoint {
  const targetId = endpoint?.attachedObjectId;
  const target = targetId ? byNodeId.get(targetId) : undefined;
  if (targetId && target) {
    const box = {
      x: Number(target.el.x),
      y: Number(target.el.y),
      width: Number(target.el.width ?? 0),
      height: Number(target.el.height ?? 0),
    };
    const attachPoint = attachPointFor(
      endpoint?.attachedSnapTo,
      endpoint?.attachedPosition,
    );
    return {
      local: localPoint(
        box.x + box.width * attachPoint[0] - origin.x,
        box.y + box.height * attachPoint[1] - origin.y,
      ),
      binding: { elementId: targetId, attachPoint },
    };
  }
  const position = endpoint?.position;
  if (position) {
    return { local: localPoint(position.x - origin.x, position.y - origin.y) };
  }
  return { local: localPoint(0, 0) };
}

// attachPoint 为归一化边界比例；snap_to 矫正沿边轴，position 提供另一轴。
function attachPointFor(
  snapTo: string | undefined,
  position: { x: number; y: number } | undefined,
): [number, number] {
  const ratioX = clamp01(position?.x ?? 0.5);
  const ratioY = clamp01(position?.y ?? 0.5);
  switch (snapTo) {
    case "right":
      return [1, ratioY];
    case "left":
      return [0, ratioY];
    case "top":
      return [ratioX, 0];
    case "bottom":
      return [ratioX, 1];
    default:
      return [ratioX, ratioY];
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

// 连线路径：直线两点；折线 = 起点 + 折点 + 终点；曲线按中点偏移生成三点走向。
function buildConnectorPoints(
  routing: ConnectorRouting,
  turning: readonly { x: number; y: number }[],
  start: LocalPoint,
  end: LocalPoint,
): LocalPoint[] {
  if (routing === "polyline" && turning.length > 0) {
    return [start, ...turning.map((p) => localPoint(p.x, p.y)), end];
  }
  if (routing === "curve") {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    return [
      start,
      localPoint(
        (start[0] + end[0]) / 2 - dy * 0.15,
        (start[1] + end[1]) / 2 + dx * 0.15,
      ),
      end,
    ];
  }
  return [start, end];
}

// 连线标签：沿路径比例取点，映射为绑定到连线的文本元素。
function buildConnectorCaption(
  node: BoardSkeletonNode,
  origin: { x: number; y: number },
  points: LocalPoint[],
): Draft | undefined {
  const caption = node.connector?.captions[0];
  if (!caption || caption.textProps.text === "") {
    return undefined;
  }
  const ratio = clamp01(caption.position ?? 0.5);
  const first = points[0] ?? localPoint(0, 0);
  const last = points[points.length - 1] ?? localPoint(0, 0);
  const element = newTextElement({
    text: caption.textProps.text,
    fontSize: caption.textProps.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: mapTextAlign(caption.textProps.horizontalAlign),
    verticalAlign: mapVerticalAlign(caption.textProps.verticalAlign),
    containerId: node.id,
    labelPosition: ratio,
    x: origin.x + first[0] + (last[0] - first[0]) * ratio,
    y: origin.y + first[1] + (last[1] - first[1]) * ratio,
    ...identity(`${node.id}#caption`, 0),
  });
  return { el: element, zKey: node.zIndex + 0.1 };
}

// --- 思维导图映射 ---

function isMindMapRoot(node: BoardSkeletonNode): boolean {
  return node.mindMap?.root !== undefined;
}

const MINDMAP_SHAPE_BY_TYPE: Record<string, MindmapNodeShape> = {
  mind_map_round_rect: "pill",
  mind_map_rect: "rectangle",
  mind_map_circle: "ellipse",
  mind_map_ellipse: "ellipse",
  mind_map_diamond: "diamond",
  mind_map_text: "text",
};

function mapMindmapShape(node: BoardSkeletonNode): MindmapNodeShape {
  const type = node.mindMap?.root?.type ?? node.mindMap?.node?.type;
  if (type && type in MINDMAP_SHAPE_BY_TYPE) {
    return MINDMAP_SHAPE_BY_TYPE[type];
  }
  return "rectangle";
}

const MINDMAP_LAYOUT: Record<string, MindmapLayoutDirection> = {
  left_right: "left-to-right",
  right_left: "right-to-left",
  top_bottom: "top-to-bottom",
  bottom_top: "bottom-to-top",
};

function mapMindmapLayout(node: BoardSkeletonNode): MindmapLayoutDirection {
  const layout = node.mindMap?.root?.layout;
  return layout
    ? MINDMAP_LAYOUT[layout] ?? DEFAULT_MINDMAP_LAYOUT_DIRECTION
    : DEFAULT_MINDMAP_LAYOUT_DIRECTION;
}

function mapMindmapRouting(node: BoardSkeletonNode): MindmapEdgeRouting {
  const lineStyle = node.mindMap?.root?.lineStyle;
  if (lineStyle === "round_angle" || lineStyle === "right_angle") {
    return "orthogonal";
  }
  return DEFAULT_MINDMAP_EDGE_ROUTING;
}

// 沿 mind_map.parent_id 链找到根节点 id，用于派生稳定的 graphId。
function findMindmapRootId(
  node: BoardSkeletonNode,
  nodeById: Map<string, BoardSkeletonNode>,
): string {
  const visited = new Set<string>();
  let current: BoardSkeletonNode | undefined = node;
  while (current) {
    if (visited.has(current.id)) {
      return current.id;
    }
    visited.add(current.id);
    const parentId: string | undefined = current.mindMap?.treeParentId;
    const parent: BoardSkeletonNode | undefined = parentId
      ? nodeById.get(parentId)
      : undefined;
    if (!parent) {
      return current.id;
    }
    current = parent;
  }
  return node.id;
}

// --- 第二遍：容器归属 ---

function applyContainerRefs(
  skeleton: BoardSkeleton,
  byNodeId: Map<string, Draft>,
  containerKind: Map<string, "frame" | "table">,
): void {
  for (const node of skeleton.nodes) {
    const draft = byNodeId.get(node.id);
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

// --- 第二遍：绑定、思维导图边与 boundElements ---

function applyBindings(
  skeleton: BoardSkeleton,
  drafts: Draft[],
  byNodeId: Map<string, Draft>,
  nodeById: Map<string, BoardSkeletonNode>,
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
  for (const node of skeleton.nodes) {
    if (node.kind !== "mindMap" || isMindMapRoot(node)) {
      continue;
    }
    const parentId = node.mindMap?.treeParentId;
    const parent = parentId ? mindmapNodes.get(parentId) : undefined;
    const child = mindmapNodes.get(node.id);
    if (!parentId || !parent || !child) {
      continue;
    }
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
      parentId,
      childId: node.id,
      points: geometry.points.map(([x, y]) => localPoint(x, y)),
      routing,
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      ...identity(`${node.id}#edge`, 0),
    });
    drafts.push({ el: edge, zKey: node.zIndex - 0.1 });
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

// --- 第二遍：分数索引 ---

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
