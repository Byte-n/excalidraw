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
import { isTableElement } from "./typeChecks";

import type {
  ElementsMap,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
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
 * Whether the cell renders as part of the first-row header band: the table
 * has the band enabled (absent `style.header` means on) and the cell — always
 * a merge anchor, covered cells are skipped by callers — sits in the first
 * row. A merge anchored in the first row keeps the band fill across its whole
 * span.
 */
export const isTableHeaderRowCell = (
  table: Pick<TableDataV1, "rows" | "style">,
  cell: Pick<TableCellData, "rowId">,
): boolean => table.style?.header !== false && cell.rowId === table.rows[0]?.id;

/** Header-band text weight — applied only when nothing explicit overrides. */
const TABLE_HEADER_ROW_FONT_WEIGHT = 600;

/**
 * Effective font weight of a cell's background text: an explicit row or
 * column `backgroundText.fontWeight`, else the text element's own
 * `fontWeight`, else 600 inside the header band. Pure derivation — nothing is
 * written back to the element, so toggling `TableStyle.header` is
 * side-effect free. Falls back to the element's own weight for non-cell texts
 * (e.g. arrow labels), so callers can use it unconditionally.
 */
export const resolveTableBackgroundTextFontWeight = (
  element: ExcalidrawTextElement,
  elementsMap: ElementsMap,
): number | undefined => {
  const ref = element.containerRef;
  if (!ref || ref.kind !== "tableCell" || ref.role !== "backgroundText") {
    return element.fontWeight;
  }
  const tableElement = elementsMap.get(ref.elementId);
  if (!tableElement || !isTableElement(tableElement)) {
    return element.fontWeight;
  }
  const { table } = tableElement;
  const raw = table.cells.find((candidate) => candidate.id === ref.cellId);
  // a stale ref may point at a covered cell; the anchor owns the merged block
  const cell = raw?.mergedInto
    ? table.cells.find((candidate) => candidate.id === raw.mergedInto) ?? raw
    : raw;
  if (!cell) {
    return element.fontWeight;
  }
  return (
    table.rows.find((row) => row.id === cell.rowId)?.style?.backgroundText
      ?.fontWeight ??
    table.columns.find((column) => column.id === cell.columnId)?.style
      ?.backgroundText?.fontWeight ??
    element.fontWeight ??
    (isTableHeaderRowCell(table, cell)
      ? TABLE_HEADER_ROW_FONT_WEIGHT
      : undefined)
  );
};

/**
 * Resolved cell fill: the cell's `style.backgroundColor` override, else the
 * row/column/table background, else the header band fill for first-row cells.
 * Returns `null` when the cell paints no rect of its own — either because the
 * override is transparent or because it resolves to the body base color,
 * which `drawTableGridOnCanvas` already paints as one rounded rect. Colors
 * are light-theme values transformed for the dark theme the same way element
 * and `FRAME_STYLE` colors are.
 */
export const getTableCellFillColor = (
  cell: TableCellData,
  isDark: boolean,
  table?: TableDataV1,
): string | null => {
  const override =
    cell.style.backgroundColor ??
    table?.rows.find((row) => row.id === cell.rowId)?.style?.backgroundColor ??
    table?.columns.find((column) => column.id === cell.columnId)?.style
      ?.backgroundColor ??
    table?.style?.backgroundColor ??
    // lowest-priority non-default: the header band fill
    (table && isTableHeaderRowCell(table, cell)
      ? TABLE_STYLE.headerFill
      : undefined);
  if (!override || isTransparent(override)) {
    return null;
  }
  const color = resolveTableColor(override, isDark);
  return color === resolveTableColor(TABLE_STYLE.backgroundColor, isDark)
    ? null
    : color;
};

export const resolveTableColor = (color: string, isDark: boolean): string => {
  if (color === "token:surface") {
    return isDark ? "#262626" : "#ffffff";
  }
  if (color === "token:header") {
    return isDark ? "#2A2B30" : "#F5F6F7";
  }
  if (color === "token:text") {
    return isDark ? "#f5f5f5" : "#1e1e1e";
  }
  if (color === "token:grid") {
    return isDark ? "#555555" : TABLE_STYLE.gridColor;
  }
  return color;
};

/**
 * Whether the cell's resolved background is transparent: the first explicit
 * background along the cell → row → column → table chain is transparent. The
 * header band and the body base only apply when the chain is silent, so they
 * never turn a cell into a hole. A transparent cell punches through the body
 * base (`drawTableGridOnCanvas` cuts it out of the base fill), revealing the
 * canvas beneath.
 */
export const isTableCellTransparent = (
  table: TableDataV1,
  cell: TableCellData,
): boolean => {
  const override =
    cell.style.backgroundColor ??
    table.rows.find((row) => row.id === cell.rowId)?.style?.backgroundColor ??
    table.columns.find((column) => column.id === cell.columnId)?.style
      ?.backgroundColor ??
    table.style?.backgroundColor;
  return override !== undefined && isTransparent(override);
};

export type TableGridSegment = readonly [number, number, number, number];

export type TableCellBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const tableRenderCache = new WeakMap<
  TableDataV1,
  {
    segments: TableGridSegment[];
    hasCellFill: boolean;
    transparentHoles: TableCellBounds[];
  }
>();

const getTableRenderData = (table: TableDataV1) => {
  const cached = tableRenderCache.get(table);
  if (cached) {
    return cached;
  }
  const hasFill = (color?: string) => !!color && !isTransparent(color);
  // cells whose resolved background is transparent punch holes in the body
  // base, so the canvas (or whatever sits under the table) shows through
  const transparentHoles: TableCellBounds[] = [];
  for (const cell of table.cells) {
    if (cell.mergedInto || !isTableCellTransparent(table, cell)) {
      continue;
    }
    const bounds = getTableCellBounds(table, cell.id);
    if (bounds) {
      transparentHoles.push(bounds);
    }
  }
  const data = {
    segments: buildTableGridSegments(table),
    // the header band always fills the first row, so an enabled header turns
    // the cell-fill pass on even without any explicit background
    hasCellFill:
      table.style?.header !== false ||
      hasFill(table.style?.backgroundColor) ||
      table.rows.some((row) => hasFill(row.style?.backgroundColor)) ||
      table.columns.some((column) => hasFill(column.style?.backgroundColor)) ||
      table.cells.some((cell) => hasFill(cell.style.backgroundColor)),
    transparentHoles,
  };
  tableRenderCache.set(table, data);
  return data;
};

export const getTableGridSegments = (table: TableDataV1): TableGridSegment[] =>
  getTableRenderData(table).segments;

/** Bounds of the cells punched out of the body base (transparent fills). */
export const getTableTransparentHoles = (
  table: TableDataV1,
): readonly TableCellBounds[] => getTableRenderData(table).transparentHoles;

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
 * Traces the table body outline (rounded when the context supports it) into
 * the current path. `CanvasRenderingContext2D.roundRect` is optional in our
 * TS lib target, so it degrades to a plain rect rather than throwing.
 */
const traceTableBodyPath = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) => {
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(0, 0, width, height, TABLE_STYLE.radius);
  } else {
    context.rect(0, 0, width, height);
  }
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

  // (0) body base: the rounded surface every cell shows through. Cells whose
  // resolved background is transparent are punched out with the even-odd
  // rule, so whatever sits under the table shows through them. The body
  // outline also becomes the clip for cell fills (nonzero winding keeps the
  // holes inside the clip), so corner cells follow the body radius.
  context.save();
  traceTableBodyPath(context, width, height);
  for (const hole of renderData.transparentHoles) {
    context.rect(hole.x, hole.y, hole.width, hole.height);
  }
  context.fillStyle = resolveTableColor(TABLE_STYLE.backgroundColor, isDark);
  context.fill(renderData.transparentHoles.length ? "evenodd" : "nonzero");
  context.clip();

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

  context.restore();

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

  // (3) outer border, rounded like the body base
  context.lineWidth = lineWidth;
  context.strokeStyle = table.style?.borderColor
    ? resolveTableColor(table.style.borderColor, isDark)
    : applyDarkModeFilter(TABLE_STYLE.strokeColor, isDark);
  const borderDash = table.style?.borderStyle;
  context.setLineDash(
    borderDash === "dashed" ? [6, 4] : borderDash === "dotted" ? [1, 3] : [],
  );
  traceTableBodyPath(context, width, height);
  context.stroke();
  context.setLineDash([]);
};
