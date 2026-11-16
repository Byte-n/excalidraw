// 表格数据、元素与单元格文本构造。
//
// 飞书 cells 的 row_index / col_index 是 1 基（1..N），统一在此减 1 转为 0 基；
// merge_info 的 span 是跨度而非索引，不随基变化。单元格文本以「可见单元格
// （锚点）」为单位写进表格自身的 `texts[cell:<id>]` 区域；
// 被合并覆盖的格子并入锚点处理，不单独产出。

import {
  cellKey,
  getTableHeight,
  getTableWidth,
  newTableElement,
  withTextBlock,
} from "@excalidraw/element";

import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  getLineHeight,
} from "@excalidraw/common";

import type {
  ExcalidrawTableElement,
  TableCellData,
  TableColumnData,
  TableRowData,
} from "@excalidraw/element/types";
import type { TextBlockMap } from "@excalidraw/element";

import { mapStrokeColor, mapStrokeStyle, mapStrokeWidth } from "../mapping.js";

import { identity } from "./identity.js";
import { mapTextAlign, mapVerticalAlign } from "./text.js";

import type { ResolvedNode } from "./resolve.js";
import type { LarkTableCell } from "../source.js";

const DEFAULT_ROW_HEIGHT = 56;
const DEFAULT_COLUMN_WIDTH = 160;

// 飞书单元格索引 1 基 → 0 基；缺失按首格处理。
function cellRow(cell: LarkTableCell): number {
  return (cell.row_index ?? 1) - 1;
}

function cellCol(cell: LarkTableCell): number {
  return (cell.col_index ?? 1) - 1;
}

// 表格网格 id 的确定性来源，避免 table 构造器消耗全局随机序列。
function makeRandomizer(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}:grid${counter++}`;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

// 单元格扁平文本的纯字符串取值（缺失或非字符串按空）。
function cellText(cell: LarkTableCell | undefined): string {
  const text = cell?.text?.text;
  return typeof text === "string" ? text : "";
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

export function buildTable(node: ResolvedNode): ExcalidrawTableElement {
  const table = buildTableData(node);
  const base = newTableElement({
    type: "table",
    x: node.x,
    y: node.y,
    rowCount: table.rows.length,
    columnCount: table.columns.length,
    randomizer: makeRandomizer(node.raw.id),
    ...identity(node.raw.id, 0),
  });
  return {
    ...base,
    table,
    width: getTableWidth(table),
    height: getTableHeight(table),
  };
}

function buildTableData(node: ResolvedNode): BuiltTableData {
  const payload = node.raw.table ?? {};
  const meta = payload.meta;
  const cells = Array.isArray(payload.cells) ? payload.cells : [];
  const rowCount = Math.max(1, meta?.row_num ?? meta?.row_sizes?.length ?? 1);
  const columnCount = Math.max(
    1,
    meta?.col_num ?? meta?.col_sizes?.length ?? 1,
  );
  const rowSizes = meta?.row_sizes ?? [];
  const columnSizes = meta?.col_sizes ?? [];

  const rows: TableRowData[] = [];
  for (let r = 0; r < rowCount; r++) {
    rows.push({
      id: `${node.raw.id}:row${r}`,
      height: positive(rowSizes[r], DEFAULT_ROW_HEIGHT),
    });
  }
  const columns: TableColumnData[] = [];
  for (let c = 0; c < columnCount; c++) {
    columns.push({
      id: `${node.raw.id}:col${c}`,
      width: positive(columnSizes[c], DEFAULT_COLUMN_WIDTH),
    });
  }

  // 先求 merge 结构：锚点写 span，被覆盖格写 mergedInto。
  const cellIdAt = (r: number, c: number) => `${node.raw.id}:cell:r${r}c${c}`;
  const mergedInto = new Map<string, string>();
  const spans = new Map<string, { columnSpan: number; rowSpan: number }>();
  for (const cell of cells) {
    const r = cellRow(cell);
    const c = cellCol(cell);
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

  const builtCells: TableCellData[] = [];
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < columnCount; c++) {
      const id = cellIdAt(r, c);
      const source = cells.find(
        (cell) => cellRow(cell) === r && cellCol(cell) === c,
      );
      const span = spans.get(id);
      const covered = mergedInto.get(id);
      builtCells.push({
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
    cells: builtCells,
  };
}

// 单元格文本：以可见单元格（锚点）为单位写进 `texts[cell:<id>]`。被合并覆盖
// 的格子不单独产出——它与锚点共用同一格。覆盖格的非空文本按规则并入锚点：
// 锚点有文本则覆盖格文本丢弃；锚点无文本则取一个覆盖格文本落到锚点；两者皆空
// 不产出。每个被覆盖的非空文本都计一次保真度损失。
export function buildTableTexts(node: ResolvedNode): {
  texts: TextBlockMap | undefined;
  downgraded: number;
} {
  const payload = node.raw.table ?? {};
  const cells = Array.isArray(payload.cells) ? payload.cells : [];
  const data = buildTableData(node);
  const sourceById = new Map<string, LarkTableCell>();
  for (const cell of cells) {
    sourceById.set(
      `${node.raw.id}:cell:r${cellRow(cell)}c${cellCol(cell)}`,
      cell,
    );
  }

  let texts: TextBlockMap | undefined;
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
    texts = withTextBlock(texts, cellKey(anchorId), {
      text: chosen.text.text ?? "",
      style: {
        fontFamily: DEFAULT_FONT_FAMILY,
        fontSize: chosen.text.font_size ?? DEFAULT_FONT_SIZE,
        lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
        textAlign: mapTextAlign(chosen.text.horizontal_align),
        verticalAlign: mapVerticalAlign(chosen.text.vertical_align),
      },
    });
  }
  return { texts, downgraded };
}
