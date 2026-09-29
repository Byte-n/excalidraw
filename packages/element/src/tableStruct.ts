import { pointFrom, pointRotateRads, type Radians } from "@excalidraw/math";
import { randomId } from "@excalidraw/common";

import type { ExcalidrawTableElement, TableDataV1 } from "./types";

/**
 * Creation presets, not format constraints — row/column counts and sizes are
 * a starting point the product may tune, never a contract the data layer
 * enforces on persisted tables.
 */
export const DEFAULT_TABLE_ROW_COUNT = 3;
export const DEFAULT_TABLE_COLUMN_COUNT = 3;
// magnitude of the frame / sticky note / mindmap node family
export const DEFAULT_TABLE_ROW_HEIGHT = 56;
export const DEFAULT_TABLE_COLUMN_WIDTH = 160;

/** Cell styles are a closed set; unknown keys make the persisted data invalid. */
const TABLE_CELL_STYLE_KEYS = new Set<string>(["backgroundColor"]);

/**
 * Relative tolerance for the float drift between an element's `width`/
 * `height` and its row/column sums. Only bounded drift within this tolerance
 * is normalized on restore; anything larger is rejected instead of being
 * silently stretched.
 */
export const TABLE_SIZE_NORMALIZATION_TOLERANCE = 1e-10;

export type CreateTableDataOptions = {
  rowCount?: number;
  columnCount?: number;
  rowHeight?: number;
  columnWidth?: number;
  /** ID source, injectable for deterministic tests; defaults to `randomId`. */
  randomizer?: () => string;
};

const assertPositiveCount = (value: number, label: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid table ${label} count: ${value}`);
  }
};

const assertPositiveSize = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid table ${label} size: ${value}`);
  }
};

/** Builds a fresh grid: every (row, column) intersection gets exactly one cell. */
export const createTableData = ({
  rowCount = DEFAULT_TABLE_ROW_COUNT,
  columnCount = DEFAULT_TABLE_COLUMN_COUNT,
  rowHeight = DEFAULT_TABLE_ROW_HEIGHT,
  columnWidth = DEFAULT_TABLE_COLUMN_WIDTH,
  randomizer = randomId,
}: CreateTableDataOptions = {}): TableDataV1 => {
  assertPositiveCount(rowCount, "row");
  assertPositiveCount(columnCount, "column");
  assertPositiveSize(rowHeight, "row height");
  assertPositiveSize(columnWidth, "column width");

  const rows = Array.from({ length: rowCount }, () => ({
    id: randomizer(),
    height: rowHeight,
  }));
  const columns = Array.from({ length: columnCount }, () => ({
    id: randomizer(),
    width: columnWidth,
  }));
  const cells = rows.flatMap((row) =>
    columns.map((column) => ({
      id: randomizer(),
      rowId: row.id,
      columnId: column.id,
      style: {},
    })),
  );

  return { schemaVersion: 1, rows, columns, cells };
};

export const getTableWidth = (table: Pick<TableDataV1, "columns">): number =>
  table.columns.reduce((acc, column) => acc + column.width, 0);

export const getTableHeight = (table: Pick<TableDataV1, "rows">): number =>
  table.rows.reduce((acc, row) => acc + row.height, 0);

/** Table-local offset (x grows rightwards) accumulated over preceding columns. */
export const getTableColumnOffset = (
  table: TableDataV1,
  columnId: string,
): number | null => {
  let offset = 0;
  for (const column of table.columns) {
    if (column.id === columnId) {
      return offset;
    }
    offset += column.width;
  }
  return null;
};

/** Table-local offset (y grows downwards) accumulated over preceding rows. */
export const getTableRowOffset = (
  table: TableDataV1,
  rowId: string,
): number | null => {
  let offset = 0;
  for (const row of table.rows) {
    if (row.id === rowId) {
      return offset;
    }
    offset += row.height;
  }
  return null;
};

/**
 * Cell rectangle in the table's unrotated local coordinates. Returns `null`
 * when the cell (or its row/column) does not exist in the table.
 */
export const getTableCellBounds = (
  table: TableDataV1,
  cellId: string,
): { x: number; y: number; width: number; height: number } | null => {
  const cell = table.cells.find((candidate) => candidate.id === cellId);
  if (!cell) {
    return null;
  }
  const x = getTableColumnOffset(table, cell.columnId);
  const y = getTableRowOffset(table, cell.rowId);
  const column = table.columns.find(
    (candidate) => candidate.id === cell.columnId,
  );
  const row = table.rows.find((candidate) => candidate.id === cell.rowId);
  if (x === null || y === null || !column || !row) {
    return null;
  }
  return { x, y, width: column.width, height: row.height };
};

const assertUniqueIds = (
  entries: readonly { id: string }[],
  label: string,
): void => {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || entry.id.length === 0) {
      throw new Error(
        `Invalid table ${label} id: ${JSON.stringify(entry?.id)}`,
      );
    }
    if (seen.has(entry.id)) {
      throw new Error(`Duplicate table ${label} id: ${entry.id}`);
    }
    seen.add(entry.id);
  }
};

const assertDimensions = (
  entries: readonly { height?: unknown; width?: unknown }[],
  key: "height" | "width",
  label: string,
): void => {
  for (const entry of entries) {
    const value = entry[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid table ${label} ${key}: ${value}`);
    }
  }
};

const assertValidCell = (
  cell: unknown,
  rowIds: ReadonlySet<string>,
  columnIds: ReadonlySet<string>,
): void => {
  if (!cell || typeof cell !== "object") {
    throw new Error(`Invalid table cell: ${JSON.stringify(cell)}`);
  }
  const value = cell as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`Invalid table cell id: ${JSON.stringify(value.id)}`);
  }
  if (
    typeof value.rowId !== "string" ||
    !rowIds.has(value.rowId) ||
    typeof value.columnId !== "string" ||
    !columnIds.has(value.columnId)
  ) {
    throw new Error(
      `Table cell ${value.id} references an unknown row or column`,
    );
  }
  const style = value.style;
  if (!style || typeof style !== "object" || Array.isArray(style)) {
    throw new Error(`Invalid table cell style on ${value.id}`);
  }
  for (const key of Object.keys(style)) {
    if (!TABLE_CELL_STYLE_KEYS.has(key)) {
      throw new Error(`Unsupported table cell style key: ${key}`);
    }
  }
  const backgroundColor = (style as Record<string, unknown>).backgroundColor;
  if (backgroundColor !== undefined && typeof backgroundColor !== "string") {
    throw new Error(`Invalid table cell backgroundColor on ${value.id}`);
  }
};

/**
 * Validates persisted table structure at file, library and clipboard
 * boundaries. Throws on the first violation, mirroring `assertBaseShapeData`.
 */
export const assertValidTableData = (table: unknown): TableDataV1 => {
  if (!table || typeof table !== "object") {
    throw new Error(`Unsupported table data: ${JSON.stringify(table)}`);
  }
  const value = table as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.rows) ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.cells)
  ) {
    throw new Error(`Unsupported table data: ${JSON.stringify(table)}`);
  }

  const rows = value.rows as TableDataV1["rows"];
  const columns = value.columns as TableDataV1["columns"];
  const cells = value.cells as TableDataV1["cells"];

  // at least 1 row and 1 column
  if (rows.length < 1 || columns.length < 1) {
    throw new Error("Table must have at least one row and one column");
  }

  assertUniqueIds(rows, "row");
  assertUniqueIds(columns, "column");
  assertDimensions(rows, "height", "row");
  assertDimensions(columns, "width", "column");

  const rowIds = new Set(rows.map((row) => row.id));
  const columnIds = new Set(columns.map((column) => column.id));

  const cellIds = new Set<string>();
  const intersections = new Set<string>();
  for (const cell of cells) {
    assertValidCell(cell, rowIds, columnIds);
    if (cellIds.has(cell.id)) {
      throw new Error(`Duplicate table cell id: ${cell.id}`);
    }
    cellIds.add(cell.id);
    const intersection = `${cell.rowId}\u0000${cell.columnId}`;
    if (intersections.has(intersection)) {
      throw new Error(
        `Duplicate table cell for row ${cell.rowId} and column ${cell.columnId}`,
      );
    }
    intersections.add(intersection);
  }

  // exactly one cell per (row, column) intersection — injective pairs with
  // the full cardinality leave no missing and no extra cells
  if (cells.length !== rows.length * columns.length) {
    throw new Error(
      `Table must have exactly one cell per intersection: expected ${
        rows.length * columns.length
      }, got ${cells.length}`,
    );
  }

  return table as TableDataV1;
};

const isBoundedSizeDrift = (value: number, expected: number): boolean =>
  Number.isFinite(value) &&
  Math.abs(value - expected) <=
    TABLE_SIZE_NORMALIZATION_TOLERANCE * Math.max(1, Math.abs(expected));

/**
 * Resolves the scene-space `sceneX`/`sceneY` to the id of the table cell
 * containing it, or `null` when the point lies outside the table. The point
 * is rotated into the table's unrotated local frame (around the element
 * center, matching how the grid renders) before the row/column offsets
 * locate the cell. Points exactly on the right or bottom outer edge are
 * outside, mirroring the half-open grid geometry.
 */
export const getTableCellAtPoint = (
  element: ExcalidrawTableElement,
  sceneX: number,
  sceneY: number,
): string | null => {
  const center = pointFrom(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const local = pointRotateRads(
    pointFrom(sceneX, sceneY),
    center,
    -element.angle as Radians,
  );
  const x = local[0] - element.x;
  const y = local[1] - element.y;
  if (x < 0 || y < 0 || x > element.width || y > element.height) {
    return null;
  }

  const { table } = element;
  let columnId: string | null = null;
  let offset = 0;
  for (const column of table.columns) {
    if (x < offset + column.width) {
      columnId = column.id;
      break;
    }
    offset += column.width;
  }
  if (!columnId) {
    return null;
  }

  let rowId: string | null = null;
  offset = 0;
  for (const row of table.rows) {
    if (y < offset + row.height) {
      rowId = row.id;
      break;
    }
    offset += row.height;
  }
  if (!rowId) {
    return null;
  }

  const cell = table.cells.find(
    (candidate) => candidate.rowId === rowId && candidate.columnId === columnId,
  );
  return cell?.id ?? null;
};

/**
 * Evenly divides a dragged extent across the current rows/columns, keeping
 * every id. The element's `width`/`height` must be set to the new sums (see
 * `getTableWidth`/`getTableHeight`) in the same update.
 */
export const evenlySplitTableSize = (
  table: TableDataV1,
  width: number,
  height: number,
): { rows: TableDataV1["rows"]; columns: TableDataV1["columns"] } => ({
  columns: table.columns.map((column) => ({
    ...column,
    width: width / table.columns.length,
  })),
  rows: table.rows.map((row) => ({
    ...row,
    height: height / table.rows.length,
  })),
});

/** The default creation preset sizes, keeping the row/column ids. */
export const tableDefaultSizes = (
  table: TableDataV1,
): { rows: TableDataV1["rows"]; columns: TableDataV1["columns"] } => ({
  columns: table.columns.map((column) => ({
    ...column,
    width: DEFAULT_TABLE_COLUMN_WIDTH,
  })),
  rows: table.rows.map((row) => ({
    ...row,
    height: DEFAULT_TABLE_ROW_HEIGHT,
  })),
});

/**
 * Element size invariant: `width`/`height` equal the row/column sums. Snap
 * bounded float drift (relative tolerance) back to the exact sums; reject
 * grossly inconsistent sizes instead of silently stretching the content.
 */
export const normalizeTableDimensions = <
  T extends Pick<ExcalidrawTableElement, "id" | "width" | "height" | "table">,
>(
  element: T,
): T => {
  const width = getTableWidth(element.table);
  const height = getTableHeight(element.table);
  if (!isBoundedSizeDrift(element.width, width)) {
    throw new Error(
      `Table ${element.id} width ${element.width} does not match its column sum ${width}`,
    );
  }
  if (!isBoundedSizeDrift(element.height, height)) {
    throw new Error(
      `Table ${element.id} height ${element.height} does not match its row sum ${height}`,
    );
  }
  if (element.width === width && element.height === height) {
    return element;
  }
  return { ...element, width, height };
};
