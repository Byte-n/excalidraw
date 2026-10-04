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

import { getTableCellBounds } from "./tableStruct";

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
  table?: TableDataV1,
): string | null => {
  const color =
    cell.style.backgroundColor ??
    table?.rows.find((row) => row.id === cell.rowId)?.style?.backgroundColor ??
    table?.columns.find((column) => column.id === cell.columnId)?.style
      ?.backgroundColor ??
    table?.style?.backgroundColor ??
    TABLE_STYLE.backgroundColor;
  if (isTransparent(color)) {
    return null;
  }
  return resolveTableColor(color, isDark);
};

export const resolveTableColor = (color: string, isDark: boolean): string => {
  if (color === "token:surface") {
    return isDark ? "#262626" : "#ffffff";
  }
  if (color === "token:text") {
    return isDark ? "#f5f5f5" : "#1e1e1e";
  }
  if (color === "token:grid") {
    return isDark ? "#555555" : TABLE_STYLE.gridColor;
  }
  return color;
};

export type TableGridSegment = readonly [number, number, number, number];

const tableRenderCache = new WeakMap<
  TableDataV1,
  { segments: TableGridSegment[]; hasCellFill: boolean }
>();

const getTableRenderData = (table: TableDataV1) => {
  const cached = tableRenderCache.get(table);
  if (cached) {
    return cached;
  }
  const hasFill = (color?: string) => !!color && !isTransparent(color);
  const data = {
    segments: buildTableGridSegments(table),
    hasCellFill:
      hasFill(table.style?.backgroundColor) ||
      table.rows.some((row) => hasFill(row.style?.backgroundColor)) ||
      table.columns.some((column) => hasFill(column.style?.backgroundColor)) ||
      table.cells.some((cell) => hasFill(cell.style.backgroundColor)),
  };
  tableRenderCache.set(table, data);
  return data;
};

export const getTableGridSegments = (table: TableDataV1): TableGridSegment[] =>
  getTableRenderData(table).segments;

const buildTableGridSegments = (table: TableDataV1): TableGridSegment[] => {
  if (!table.cells.some((cell) => cell.mergedInto)) {
    const width = table.columns.reduce((sum, column) => sum + column.width, 0);
    const height = table.rows.reduce((sum, row) => sum + row.height, 0);
    return [
      ...getTableVerticalGridOffsets(table).map(
        (x): TableGridSegment => [x, 0, x, height],
      ),
      ...getTableHorizontalGridOffsets(table).map(
        (y): TableGridSegment => [0, y, width, y],
      ),
    ];
  }
  const cells = new Map(
    table.cells.map((cell) => [`${cell.rowId}\u0000${cell.columnId}`, cell]),
  );
  const segments: TableGridSegment[] = [];
  let x = 0;
  for (let column = 0; column < table.columns.length - 1; column++) {
    x += table.columns[column].width;
    let y = 0;
    for (const row of table.rows) {
      const left = cells.get(`${row.id}\u0000${table.columns[column].id}`)!;
      const right = cells.get(
        `${row.id}\u0000${table.columns[column + 1].id}`,
      )!;
      if ((left.mergedInto ?? left.id) !== (right.mergedInto ?? right.id)) {
        segments.push([x, y, x, y + row.height]);
      }
      y += row.height;
    }
  }
  let y = 0;
  for (let row = 0; row < table.rows.length - 1; row++) {
    y += table.rows[row].height;
    x = 0;
    for (const column of table.columns) {
      const top = cells.get(`${table.rows[row].id}\u0000${column.id}`)!;
      const bottom = cells.get(`${table.rows[row + 1].id}\u0000${column.id}`)!;
      if ((top.mergedInto ?? top.id) !== (bottom.mergedInto ?? bottom.id)) {
        segments.push([x, y, x + column.width, y]);
      }
      x += column.width;
    }
  }
  return segments;
};

const getVisibleLocalBounds = (context: CanvasRenderingContext2D) => {
  if (!context.getTransform || !context.canvas) {
    return null;
  }
  const { a, b, c, d, e, f } = context.getTransform();
  const determinant = a * d - b * c;
  if (!determinant) {
    return null;
  }
  const corners = [
    [0, 0],
    [context.canvas.width, 0],
    [0, context.canvas.height],
    [context.canvas.width, context.canvas.height],
  ].map(([x, y]) => ({
    x: (d * (x - e) - c * (y - f)) / determinant,
    y: (a * (y - f) - b * (x - e)) / determinant,
  }));
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
};

/**
 * Paints the table grid in table-local coordinates — the caller positions the
 * context at the element beforehand. Like frames, tables bypass the roughjs
 * shape cache and draw themselves directly.
 */
export const drawTableGridOnCanvas = (
  element: ExcalidrawTableElement,
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState | InteractiveCanvasAppState,
) => {
  const { table } = element;
  const isDark = appState.theme === THEME.DARK;
  context.globalAlpha *= (table.style?.opacity ?? 100) / 100;
  const width = table.columns.reduce((sum, column) => sum + column.width, 0);
  const height = table.rows.reduce((sum, row) => sum + row.height, 0);

  // zoom compensation keeps the chrome one CSS pixel wide on screen
  const lineWidth =
    (table.style?.borderWidth ?? TABLE_STYLE.strokeWidth) / appState.zoom.value;
  const gridLineWidth =
    (table.style?.gridWidth ?? TABLE_STYLE.gridStrokeWidth) /
    appState.zoom.value;
  const visible = getVisibleLocalBounds(context);
  const renderData = getTableRenderData(table);

  // (1) cell backgrounds, so grid lines stay visible above them
  for (const cell of renderData.hasCellFill ? table.cells : []) {
    if (cell.mergedInto) {
      continue;
    }
    const fill = getTableCellFillColor(cell, isDark, table);
    if (!fill) {
      continue;
    }
    const bounds = getTableCellBounds(table, cell.id);
    if (!bounds) {
      continue;
    }
    if (
      visible &&
      (bounds.x > visible.maxX ||
        bounds.y > visible.maxY ||
        bounds.x + bounds.width < visible.minX ||
        bounds.y + bounds.height < visible.minY)
    ) {
      continue;
    }
    context.fillStyle = fill;
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  // (2) interior grid lines
  context.lineWidth = gridLineWidth;
  context.strokeStyle = table.style?.gridColor
    ? resolveTableColor(table.style.gridColor, isDark)
    : applyDarkModeFilter(TABLE_STYLE.gridColor, isDark);
  const gridDash = table.style?.gridStyle;
  context.setLineDash(
    gridDash === "dashed" ? [6, 4] : gridDash === "dotted" ? [1, 3] : [],
  );
  context.beginPath();
  for (const [x1, y1, x2, y2] of renderData.segments) {
    if (
      visible &&
      (Math.max(x1, x2) < visible.minX ||
        Math.min(x1, x2) > visible.maxX ||
        Math.max(y1, y2) < visible.minY ||
        Math.min(y1, y2) > visible.maxY)
    ) {
      continue;
    }
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
  }
  context.stroke();

  // (3) outer border
  context.lineWidth = lineWidth;
  context.strokeStyle = table.style?.borderColor
    ? resolveTableColor(table.style.borderColor, isDark)
    : applyDarkModeFilter(TABLE_STYLE.strokeColor, isDark);
  const borderDash = table.style?.borderStyle;
  context.setLineDash(
    borderDash === "dashed" ? [6, 4] : borderDash === "dotted" ? [1, 3] : [],
  );
  context.strokeRect(0, 0, width, height);
  context.setLineDash([]);
};
