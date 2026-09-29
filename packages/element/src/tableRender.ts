import {
  applyDarkModeFilter,
  isTransparent,
  TABLE_STYLE,
  THEME,
} from "@excalidraw/common";

import type {
  InteractiveCanvasAppState,
  StaticCanvasAppState,
} from "@excalidraw/excalidraw/types";

import type {
  ExcalidrawTableElement,
  TableDataV1,
  TableCellData,
} from "./types";

/**
 * Interior grid line offsets in table-local coordinates, accumulated over all
 * but the last column/row (the outer edges are the border, not grid lines).
 */
export const getTableVerticalGridOffsets = (
  table: Pick<TableDataV1, "columns">,
): number[] => {
  const offsets: number[] = [];
  let offset = 0;
  for (const column of table.columns.slice(0, -1)) {
    offset += column.width;
    offsets.push(offset);
  }
  return offsets;
};

export const getTableHorizontalGridOffsets = (
  table: Pick<TableDataV1, "rows">,
): number[] => {
  const offsets: number[] = [];
  let offset = 0;
  for (const row of table.rows.slice(0, -1)) {
    offset += row.height;
    offsets.push(offset);
  }
  return offsets;
};

/**
 * Resolved cell fill: the cell's `style.backgroundColor` override, else the
 * table default. Returns `null` when the cell paints no background — the
 * default, so the canvas shows through and the default state stays
 * low-contrast. Colors are light-theme values transformed for the dark theme
 * the same way element and `FRAME_STYLE` colors are.
 */
export const getTableCellFillColor = (
  cell: TableCellData,
  isDark: boolean,
): string | null => {
  const color = cell.style.backgroundColor ?? TABLE_STYLE.backgroundColor;
  if (isTransparent(color)) {
    return null;
  }
  return applyDarkModeFilter(color, isDark);
};

/**
 * Paints the table grid in table-local coordinates — the caller positions the
 * context at the element (translate + rotate) beforehand. Like frames, tables
 * bypass the roughjs shape cache and draw themselves directly.
 */
export const drawTableGridOnCanvas = (
  element: ExcalidrawTableElement,
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState | InteractiveCanvasAppState,
) => {
  const { table } = element;
  const isDark = appState.theme === THEME.DARK;
  const columnBounds = new Map<string, { x: number; width: number }>();
  const rowBounds = new Map<string, { y: number; height: number }>();
  const verticalGridOffsets: number[] = [];
  const horizontalGridOffsets: number[] = [];
  let width = 0;
  let height = 0;
  for (const [index, column] of table.columns.entries()) {
    columnBounds.set(column.id, { x: width, width: column.width });
    width += column.width;
    if (index < table.columns.length - 1) {
      verticalGridOffsets.push(width);
    }
  }
  for (const [index, row] of table.rows.entries()) {
    rowBounds.set(row.id, { y: height, height: row.height });
    height += row.height;
    if (index < table.rows.length - 1) {
      horizontalGridOffsets.push(height);
    }
  }

  // zoom compensation keeps the chrome one CSS pixel wide on screen
  const lineWidth = TABLE_STYLE.strokeWidth / appState.zoom.value;
  const gridLineWidth = TABLE_STYLE.gridStrokeWidth / appState.zoom.value;

  // (1) cell backgrounds, so grid lines stay visible above them
  for (const cell of table.cells) {
    const fill = getTableCellFillColor(cell, isDark);
    if (!fill) {
      continue;
    }
    const column = columnBounds.get(cell.columnId);
    const row = rowBounds.get(cell.rowId);
    if (!column || !row) {
      continue;
    }
    context.fillStyle = fill;
    context.fillRect(column.x, row.y, column.width, row.height);
  }

  // (2) interior grid lines
  context.lineWidth = gridLineWidth;
  context.strokeStyle = applyDarkModeFilter(TABLE_STYLE.gridColor, isDark);
  context.beginPath();
  for (const x of verticalGridOffsets) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (const y of horizontalGridOffsets) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();

  // (3) outer border
  context.lineWidth = lineWidth;
  context.strokeStyle = applyDarkModeFilter(TABLE_STYLE.strokeColor, isDark);
  context.strokeRect(0, 0, width, height);
};
