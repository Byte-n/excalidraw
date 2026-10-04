import { randomId } from "@excalidraw/common";

import type {
  ExcalidrawTableElement,
  TableCellData,
  TableDataV1,
} from "./types";

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
const TABLE_CELL_STYLE_KEYS = new Set<string>([
  "backgroundColor",
  "clipContent",
]);
const TABLE_STYLE_KEYS = new Set<string>([
  "backgroundColor",
  "opacity",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "gridColor",
  "gridWidth",
  "gridStyle",
  "clipContent",
  "title",
]);
const BACKGROUND_TEXT_STYLE_KEYS = new Set<string>([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "underline",
  "strikethrough",
  "color",
  "horizontalAlign",
  "verticalAlign",
  "padding",
]);

const assertStyle = (
  style: unknown,
  keys: ReadonlySet<string>,
  label: string,
): void => {
  if (!style || typeof style !== "object" || Array.isArray(style)) {
    throw new Error(`Invalid ${label} style`);
  }
  const values = style as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    if (!keys.has(key)) {
      throw new Error(`Unsupported ${label} style key: ${key}`);
    }
    if (key === "backgroundText") {
      assertStyle(value, BACKGROUND_TEXT_STYLE_KEYS, "background text");
    } else if (key === "title") {
      assertStyle(value, new Set(["gap", "align"]), "table title");
    } else if (
      [
        "backgroundColor",
        "borderColor",
        "gridColor",
        "color",
        "fontFamily",
      ].includes(key)
    ) {
      if (typeof value !== "string") {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (
      [
        "opacity",
        "borderWidth",
        "gridWidth",
        "fontSize",
        "fontWeight",
        "padding",
        "gap",
      ].includes(key)
    ) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        (key === "opacity" && value > 100)
      ) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (
      ["clipContent", "italic", "underline", "strikethrough"].includes(key)
    ) {
      if (typeof value !== "boolean") {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (["borderStyle", "gridStyle"].includes(key)) {
      if (!["solid", "dashed", "dotted"].includes(value as string)) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (key === "align") {
      if (!["start", "center", "end"].includes(value as string)) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (key === "horizontalAlign") {
      if (!["left", "center", "right"].includes(value as string)) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    } else if (key === "verticalAlign") {
      if (!["top", "middle", "bottom"].includes(value as string)) {
        throw new Error(`Invalid ${label} ${key}`);
      }
    }
  }
};

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

type TableLookup = {
  rows: ReadonlyMap<string, number>;
  columns: ReadonlyMap<string, number>;
  cells: ReadonlyMap<string, TableCellData>;
  intersections: ReadonlyMap<string, TableCellData>;
  rowEnds: readonly number[];
  columnEnds: readonly number[];
};

const tableLookups = new WeakMap<TableDataV1, TableLookup>();

const getTableLookup = (table: TableDataV1): TableLookup => {
  const cached = tableLookups.get(table);
  if (cached) {
    return cached;
  }
  let rowEnd = 0;
  let columnEnd = 0;
  const lookup: TableLookup = {
    rows: new Map(table.rows.map((row, index) => [row.id, index])),
    columns: new Map(table.columns.map((column, index) => [column.id, index])),
    cells: new Map(table.cells.map((cell) => [cell.id, cell])),
    intersections: new Map(
      table.cells.map((cell) => [`${cell.rowId}\u0000${cell.columnId}`, cell]),
    ),
    rowEnds: table.rows.map((row) => (rowEnd += row.height)),
    columnEnds: table.columns.map((column) => (columnEnd += column.width)),
  };
  tableLookups.set(table, lookup);
  return lookup;
};

const indexAtOffset = (ends: readonly number[], offset: number): number => {
  let low = 0;
  let high = ends.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < ends[middle]) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
};

/** Table-local offset (x grows rightwards) accumulated over preceding columns. */
export const getTableColumnOffset = (
  table: TableDataV1,
  columnId: string,
): number | null => {
  const lookup = getTableLookup(table);
  const index = lookup.columns.get(columnId);
  return index === undefined ? null : index ? lookup.columnEnds[index - 1] : 0;
};

/** Table-local offset (y grows downwards) accumulated over preceding rows. */
export const getTableRowOffset = (
  table: TableDataV1,
  rowId: string,
): number | null => {
  const lookup = getTableLookup(table);
  const index = lookup.rows.get(rowId);
  return index === undefined ? null : index ? lookup.rowEnds[index - 1] : 0;
};

/**
 * Cell rectangle in the table's unrotated local coordinates. Returns `null`
 * when the cell (or its row/column) does not exist in the table.
 */
export const getTableCellBounds = (
  table: TableDataV1,
  cellId: string,
): { x: number; y: number; width: number; height: number } | null => {
  const cell = getVisibleTableCell(table, cellId);
  if (!cell) {
    return null;
  }
  const x = getTableColumnOffset(table, cell.columnId);
  const y = getTableRowOffset(table, cell.rowId);
  if (x === null || y === null) {
    return null;
  }
  const lookup = getTableLookup(table);
  const rowIndex = lookup.rows.get(cell.rowId)!;
  const columnIndex = lookup.columns.get(cell.columnId)!;
  const rowEnd = rowIndex + (cell.rowSpan ?? 1) - 1;
  const columnEnd = columnIndex + (cell.columnSpan ?? 1) - 1;
  return {
    x,
    y,
    width: lookup.columnEnds[columnEnd] - x,
    height: lookup.rowEnds[rowEnd] - y,
  };
};

export const getVisibleTableCell = (
  table: TableDataV1,
  cellId: string,
): TableCellData | null => {
  const byId = getTableLookup(table).cells;
  const cell = byId.get(cellId);
  return cell ? byId.get(cell.mergedInto ?? cell.id) ?? null : null;
};

export type TableCellRange = Readonly<{
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}>;

export const getTableCellRange = (
  table: TableDataV1,
  firstId: string,
  lastId: string,
): TableCellRange => {
  const byId = new Map(table.cells.map((cell) => [cell.id, cell]));
  const visible = (id: string) => {
    const cell = byId.get(id);
    return cell ? byId.get(cell.mergedInto ?? cell.id) : undefined;
  };
  const first = visible(firstId);
  const last = visible(lastId);
  if (!first || !last) {
    throw new Error("Table selection references an unknown cell");
  }
  const rowIndex = new Map(table.rows.map((row, index) => [row.id, index]));
  const columnIndex = new Map(
    table.columns.map((column, index) => [column.id, index]),
  );
  let startRow = Math.min(
    rowIndex.get(first.rowId)!,
    rowIndex.get(last.rowId)!,
  );
  let endRow = Math.max(
    rowIndex.get(first.rowId)! + (first.rowSpan ?? 1) - 1,
    rowIndex.get(last.rowId)! + (last.rowSpan ?? 1) - 1,
  );
  let startColumn = Math.min(
    columnIndex.get(first.columnId)!,
    columnIndex.get(last.columnId)!,
  );
  let endColumn = Math.max(
    columnIndex.get(first.columnId)! + (first.columnSpan ?? 1) - 1,
    columnIndex.get(last.columnId)! + (last.columnSpan ?? 1) - 1,
  );
  let changed: boolean;
  do {
    changed = false;
    for (const cell of table.cells) {
      const row = rowIndex.get(cell.rowId)!;
      const column = columnIndex.get(cell.columnId)!;
      if (
        row < startRow ||
        row > endRow ||
        column < startColumn ||
        column > endColumn
      ) {
        continue;
      }
      const anchor = visible(cell.id)!;
      const anchorRow = rowIndex.get(anchor.rowId)!;
      const anchorColumn = columnIndex.get(anchor.columnId)!;
      const next = {
        startRow: Math.min(startRow, anchorRow),
        endRow: Math.max(endRow, anchorRow + (anchor.rowSpan ?? 1) - 1),
        startColumn: Math.min(startColumn, anchorColumn),
        endColumn: Math.max(
          endColumn,
          anchorColumn + (anchor.columnSpan ?? 1) - 1,
        ),
      };
      changed ||=
        next.startRow !== startRow ||
        next.endRow !== endRow ||
        next.startColumn !== startColumn ||
        next.endColumn !== endColumn;
      ({ startRow, endRow, startColumn, endColumn } = next);
    }
  } while (changed);
  return { startRow, endRow, startColumn, endColumn };
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
  assertStyle(value.style, TABLE_CELL_STYLE_KEYS, `table cell ${value.id}`);
  for (const key of ["rowSpan", "columnSpan"] as const) {
    if (
      value[key] !== undefined &&
      (!Number.isInteger(value[key]) || (value[key] as number) < 1)
    ) {
      throw new Error(`Invalid table cell ${key} on ${value.id}`);
    }
  }
  if (
    value.mergedInto !== undefined &&
    (typeof value.mergedInto !== "string" || !value.mergedInto)
  ) {
    throw new Error(`Invalid table cell mergedInto on ${value.id}`);
  }
  if (
    value.mergedInto &&
    (value.rowSpan !== undefined || value.columnSpan !== undefined)
  ) {
    throw new Error(`Covered table cell ${value.id} cannot have a span`);
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
  if (value.style !== undefined) {
    assertStyle(value.style, TABLE_STYLE_KEYS, "table");
  }
  const axisStyleKeys = new Set(["backgroundColor", "backgroundText"]);
  for (const row of rows) {
    if (row.style !== undefined) {
      assertStyle(row.style, axisStyleKeys, `table row ${row.id}`);
    }
  }
  for (const column of columns) {
    if (column.style !== undefined) {
      assertStyle(column.style, axisStyleKeys, `table column ${column.id}`);
    }
  }

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

  const lookup = getTableLookup(table as TableDataV1);
  const byIntersection = lookup.intersections;
  const ownership = new Map<string, string>();
  for (const cell of cells) {
    if (cell.mergedInto) {
      continue;
    }
    const row = lookup.rows.get(cell.rowId)!;
    const column = lookup.columns.get(cell.columnId)!;
    const rowSpan = cell.rowSpan ?? 1;
    const columnSpan = cell.columnSpan ?? 1;
    if (row + rowSpan > rows.length || column + columnSpan > columns.length) {
      throw new Error(`Table cell ${cell.id} span exceeds table bounds`);
    }
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = column; c < column + columnSpan; c++) {
        const covered = byIntersection.get(
          `${rows[r].id}\u0000${columns[c].id}`,
        )!;
        if (
          ownership.has(covered.id) ||
          (covered.id !== cell.id && covered.mergedInto !== cell.id)
        ) {
          throw new Error(
            `Overlapping or incomplete table merge at ${covered.id}`,
          );
        }
        ownership.set(covered.id, cell.id);
      }
    }
  }
  if (ownership.size !== cells.length) {
    throw new Error("Table has a covered cell without a valid merge anchor");
  }

  return table as TableDataV1;
};

const isBoundedSizeDrift = (value: number, expected: number): boolean =>
  Number.isFinite(value) &&
  Math.abs(value - expected) <=
    TABLE_SIZE_NORMALIZATION_TOLERANCE * Math.max(1, Math.abs(expected));

/**
 * Resolves the scene-space `sceneX`/`sceneY` to the id of the table cell
 * containing it, or `null` when the point lies outside the table. Points
 * exactly on the right or bottom outer edge are outside, mirroring the
 * half-open grid geometry.
 */
export const getTableCellAtPoint = (
  element: ExcalidrawTableElement,
  sceneX: number,
  sceneY: number,
): string | null => {
  const x = sceneX - element.x;
  const y = sceneY - element.y;
  if (x < 0 || y < 0 || x > element.width || y > element.height) {
    return null;
  }

  const { table } = element;
  const lookup = getTableLookup(table);
  const column = table.columns[indexAtOffset(lookup.columnEnds, x)];
  const row = table.rows[indexAtOffset(lookup.rowEnds, y)];
  if (!column || !row) {
    return null;
  }
  const cell = lookup.intersections.get(`${row.id}\u0000${column.id}`);
  return cell ? lookup.cells.get(cell.mergedInto ?? cell.id)?.id ?? null : null;
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
