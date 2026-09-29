import { randomId } from "@excalidraw/common";

import {
  assertValidTableData,
  getTableColumnOffset,
  getTableSizingMode,
  getTableRowOffset,
} from "./tableStruct";

import type { TableDataV1, TableSizingMode } from "./types";

/**
 * Pure row/column structure commands over `TableDataV1`. Every command takes
 * the table data (pass `tableElement.table`) and returns new data plus the
 * information callers need to update the rest of the scene — nothing here
 * mutates its input, touches member elements, or knows about the scene.
 *
 * Commands re-validate their result with `assertValidTableData`, so a returned
 * grid always satisfies the persisted invariants (unique ids, one cell per
 * intersection, positive sizes).
 */

export type TableStructureOptions = {
  /** ID source, injectable for deterministic tests; defaults to `randomId`. */
  randomizer?: () => string;
};

/**
 * Rebuilds the persisted payload with `sizingMode` and the sizing minima
 * carried over (phase-1.1: every structure command passes the mode and the
 * minima through), then re-validates. Row/column entries keep their
 * `minHeight`/`minWidth` through the caller's mapping spreads.
 */
const buildTableData = (
  table: TableDataV1,
  overrides: Partial<
    Pick<TableDataV1, "rows" | "columns" | "cells" | "sizingMode">
  >,
): TableDataV1 =>
  assertValidTableData({
    schemaVersion: 1,
    sizingMode: table.sizingMode,
    rows: table.rows,
    columns: table.columns,
    cells: table.cells,
    ...overrides,
  });

export type TableRowResizeOptions = {
  /**
   * Lower bound for the new height. Requests below it clamp up to `minHeight`
   * instead of throwing, so interactive drags can pass the live minimum from
   * the UI. Must be a finite positive number when given.
   */
  minHeight?: number;
};

export type TableColumnResizeOptions = {
  /** Width counterpart of `TableRowResizeOptions.minHeight`. */
  minWidth?: number;
};

/** Cells of a removed row/column; callers delete their member elements. */
export type TableRemovalResult = {
  table: TableDataV1;
  removedCellIds: string[];
};

/** Per-row/column translation of member elements after a structure change. */
export type MemberTranslation = Readonly<{ dx: number; dy: number }>;

const assertBoundaryIndex = (
  index: number,
  length: number,
  label: string,
): void => {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new Error(`Invalid table ${label} boundary index: ${index}`);
  }
};

const assertTargetIndex = (
  index: number,
  length: number,
  label: string,
): void => {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(`Invalid table ${label} target index: ${index}`);
  }
};

const assertRowExists = (rows: TableDataV1["rows"], rowId: string): void => {
  if (!rows.some((row) => row.id === rowId)) {
    throw new Error(`Table row not found: ${rowId}`);
  }
};

const assertColumnExists = (
  columns: TableDataV1["columns"],
  columnId: string,
): void => {
  if (!columns.some((column) => column.id === columnId)) {
    throw new Error(`Table column not found: ${columnId}`);
  }
};

/**
 * Inserts a row at the preview boundary `boundaryIndex` — the array index the
 * new row will occupy, so `0` pushes everything down and `rows.length`
 * appends. The new row inherits the height of the adjacent row above the
 * boundary (the first row donates at the top boundary, the last row at the
 * bottom one), matching the dragged preview line's geometry. Every column
 * gets one fresh empty cell (`style: {}`, new id); existing cells keep their
 * ids, so member elements stay attached to their cell.
 *
 * In `fitContent` mode the new row's initial size becomes its manual minimum
 * (phase-1.1); it has no content yet, so no requirement pushes it beyond that.
 */
export const insertRowInTable = (
  table: TableDataV1,
  boundaryIndex: number,
  { randomizer = randomId }: TableStructureOptions = {},
): TableDataV1 => {
  assertBoundaryIndex(boundaryIndex, table.rows.length, "row");
  const neighbour = table.rows[boundaryIndex - 1] ?? table.rows[boundaryIndex];
  const fitContent = getTableSizingMode(table) === "fitContent";
  const newRow = {
    id: randomizer(),
    height: neighbour.height,
    ...(fitContent ? { minHeight: neighbour.height } : {}),
  };
  const rows = [
    ...table.rows.slice(0, boundaryIndex),
    newRow,
    ...table.rows.slice(boundaryIndex),
  ];
  const newCells = table.columns.map((column) => ({
    id: randomizer(),
    rowId: newRow.id,
    columnId: column.id,
    style: {},
  }));

  return buildTableData(table, {
    rows,
    cells: [...table.cells, ...newCells],
  });
};

/**
 * Column counterpart of `insertRowInTable` (see it for the semantics,
 * including the `fitContent` minimum from the initial size).
 */
export const insertColumnInTable = (
  table: TableDataV1,
  boundaryIndex: number,
  { randomizer = randomId }: TableStructureOptions = {},
): TableDataV1 => {
  assertBoundaryIndex(boundaryIndex, table.columns.length, "column");
  const neighbour =
    table.columns[boundaryIndex - 1] ?? table.columns[boundaryIndex];
  const fitContent = getTableSizingMode(table) === "fitContent";
  const newColumn = {
    id: randomizer(),
    width: neighbour.width,
    ...(fitContent ? { minWidth: neighbour.width } : {}),
  };
  const columns = [
    ...table.columns.slice(0, boundaryIndex),
    newColumn,
    ...table.columns.slice(boundaryIndex),
  ];
  const newCells = table.rows.map((row) => ({
    id: randomizer(),
    rowId: row.id,
    columnId: newColumn.id,
    style: {},
  }));

  return buildTableData(table, {
    columns,
    cells: [...table.cells, ...newCells],
  });
};

/**
 * Removes a row and its cells. Returns the removed cell ids so callers can
 * delete the member elements (and nested-table subtrees) themselves — this
 * command only reshapes the grid. Deleting the last row is rejected: it must
 * go through the explicit delete-the-whole-table command instead.
 */
export const removeRowFromTable = (
  table: TableDataV1,
  rowId: string,
): TableRemovalResult => {
  assertRowExists(table.rows, rowId);
  if (table.rows.length === 1) {
    throw new Error(
      "Cannot remove the last row of a table; delete the table instead",
    );
  }

  const removedCellIds: string[] = [];
  const cells = table.cells.filter((cell) => {
    if (cell.rowId !== rowId) {
      return true;
    }
    removedCellIds.push(cell.id);
    return false;
  });

  return {
    table: buildTableData(table, {
      rows: table.rows.filter((row) => row.id !== rowId),
      cells,
    }),
    removedCellIds,
  };
};

/** Column counterpart of `removeRowFromTable` (see it for the semantics). */
export const removeColumnFromTable = (
  table: TableDataV1,
  columnId: string,
): TableRemovalResult => {
  assertColumnExists(table.columns, columnId);
  if (table.columns.length === 1) {
    throw new Error(
      "Cannot remove the last column of a table; delete the table instead",
    );
  }

  const removedCellIds: string[] = [];
  const cells = table.cells.filter((cell) => {
    if (cell.columnId !== columnId) {
      return true;
    }
    removedCellIds.push(cell.id);
    return false;
  });

  return {
    table: buildTableData(table, {
      columns: table.columns.filter((column) => column.id !== columnId),
      cells,
    }),
    removedCellIds,
  };
};

/**
 * Moves a row to `toIndex`, its final index in the resulting `rows` array
 * counted over the array without the moved row (`0` puts it first). Only the
 * array order changes: cells and their ids stay put, so member elements and
 * background texts follow their cell automatically. No-op moves return the
 * input unchanged.
 */
export const moveRowInTable = (
  table: TableDataV1,
  fromRowId: string,
  toIndex: number,
): TableDataV1 => {
  const fromIndex = table.rows.findIndex((row) => row.id === fromRowId);
  if (fromIndex === -1) {
    throw new Error(`Table row not found: ${fromRowId}`);
  }
  assertTargetIndex(toIndex, table.rows.length, "row");
  if (toIndex === fromIndex) {
    return table;
  }

  const rows = table.rows.filter((row) => row.id !== fromRowId);
  rows.splice(toIndex, 0, table.rows[fromIndex]);

  return buildTableData(table, { rows });
};

/** Column counterpart of `moveRowInTable` (see it for the semantics). */
export const moveColumnInTable = (
  table: TableDataV1,
  fromColumnId: string,
  toIndex: number,
): TableDataV1 => {
  const fromIndex = table.columns.findIndex(
    (column) => column.id === fromColumnId,
  );
  if (fromIndex === -1) {
    throw new Error(`Table column not found: ${fromColumnId}`);
  }
  assertTargetIndex(toIndex, table.columns.length, "column");
  if (toIndex === fromIndex) {
    return table;
  }

  const columns = table.columns.filter((column) => column.id !== fromColumnId);
  columns.splice(toIndex, 0, table.columns[fromIndex]);

  return buildTableData(table, { columns });
};

const assertValidNewSize = (size: number, label: string): void => {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`Invalid table ${label}: ${size}`);
  }
};

const assertValidMinSize = (size: number | undefined, label: string): void => {
  if (size !== undefined && (!Number.isFinite(size) || size <= 0)) {
    throw new Error(`Invalid table minimum ${label}: ${size}`);
  }
};

/**
 * Sets one row's height. Non-positive or non-finite sizes throw; with
 * `minHeight` given, smaller requests clamp up to it (phase-1:95 — the
 * boundary is constrained by a positive minimum cell size). Callers keep the
 * members of the resized row at their offsets from the cell's top-left corner
 * (no shift, no scale, overflow allowed) and translate later rows with
 * `getMemberTranslationsForRows`.
 *
 * In `fitContent` mode the drag also rewrites the row's manual minimum to the
 * clamped size (phase-1.1: dragging a separator edits the lower bound in the
 * same operation). The content-driven expansion on top of the minima is the
 * caller's fit-content computation, not this command.
 */
export const resizeRowInTable = (
  table: TableDataV1,
  rowId: string,
  newHeight: number,
  { minHeight }: TableRowResizeOptions = {},
): TableDataV1 => {
  assertValidNewSize(newHeight, "row height");
  assertValidMinSize(minHeight, "row height");
  assertRowExists(table.rows, rowId);

  const fitContent = getTableSizingMode(table) === "fitContent";
  const height =
    minHeight !== undefined ? Math.max(newHeight, minHeight) : newHeight;
  const rows = table.rows.map((row) =>
    row.id === rowId
      ? {
          ...row,
          height,
          ...(fitContent ? { minHeight: height } : {}),
        }
      : row,
  );

  return buildTableData(table, { rows });
};

/**
 * Column counterpart of `resizeRowInTable` (see it for the semantics,
 * including the `fitContent` minimum rewrite).
 */
export const resizeColumnInTable = (
  table: TableDataV1,
  columnId: string,
  newWidth: number,
  { minWidth }: TableColumnResizeOptions = {},
): TableDataV1 => {
  assertValidNewSize(newWidth, "column width");
  assertValidMinSize(minWidth, "column width");
  assertColumnExists(table.columns, columnId);

  const fitContent = getTableSizingMode(table) === "fitContent";
  const width =
    minWidth !== undefined ? Math.max(newWidth, minWidth) : newWidth;
  const columns = table.columns.map((column) =>
    column.id === columnId
      ? {
          ...column,
          width,
          ...(fitContent ? { minWidth: width } : {}),
        }
      : column,
  );

  return buildTableData(table, { columns });
};

/**
 * Switches the whole table's sizing mode (phase-1.1 data contract):
 * to `fitContent`, every row/column's current size initializes its manual
 * minimum; back to `fixed`, the minima fields are dropped and the sizes are
 * kept. Content is never re-measured here — switching in runs one expansion
 * through the fit-content computation on top, switching out preserves the
 * geometry verbatim. No-op returns the input unchanged.
 */
export const setTableSizingMode = (
  table: TableDataV1,
  mode: TableSizingMode,
): TableDataV1 => {
  if (getTableSizingMode(table) === mode) {
    return table;
  }

  if (mode === "fitContent") {
    return buildTableData(table, {
      sizingMode: "fitContent",
      rows: table.rows.map((row) => ({ ...row, minHeight: row.height })),
      columns: table.columns.map((column) => ({
        ...column,
        minWidth: column.width,
      })),
    });
  }

  return buildTableData(table, {
    sizingMode: undefined,
    rows: table.rows.map(({ minHeight: _, ...row }) => row),
    columns: table.columns.map(({ minWidth: _, ...column }) => column),
  });
};

/**
 * Resets every manual minimum to the product's minimum row/column size
 * (phase-1.1: the reset command sets the floors, it never writes computed
 * content requirements back into the minima). Fixed-mode tables reject the
 * command. Re-expanding from the new floors is the caller's fit-content
 * computation.
 */
export const resetTableManualMinSizes = (
  table: TableDataV1,
  { minHeight, minWidth }: { minHeight: number; minWidth: number },
): TableDataV1 => {
  if (getTableSizingMode(table) !== "fitContent") {
    throw new Error("Table manual minima can only be reset in fitContent mode");
  }
  assertValidMinSize(minHeight, "row height");
  assertValidMinSize(minWidth, "column width");

  return buildTableData(table, {
    rows: table.rows.map((row) => ({ ...row, minHeight })),
    columns: table.columns.map((column) => ({ ...column, minWidth })),
  });
};

/**
 * Member translations for a row-structure change: for every row that exists
 * in both grids, the delta of its table-local y offset, so callers move the
 * row's members (content, background text, nested subtrees) with the row.
 * Row operations never move members horizontally, so `dx` is always 0;
 * column-structure changes are out of scope here. Newly inserted rows have no
 * members yet and get no entry; deleted rows are the caller's removal job and
 * get no entry either.
 *
 * Members of a resized row deliberately translate by 0: resizing keeps them
 * relative to the cell's top-left corner without scaling (phase-1:95), while
 * later rows shift by the height delta — both fall out of the offset math.
 * Re-laying out the background text box for its new cell geometry is a later
 * phase's job, not part of these translations.
 */
export const getMemberTranslationsForRows = (
  oldTable: TableDataV1,
  newTable: TableDataV1,
): Map<string, MemberTranslation> => {
  const translations = new Map<string, MemberTranslation>();
  const oldRowIds = new Set(oldTable.rows.map((row) => row.id));

  for (const row of newTable.rows) {
    if (!oldRowIds.has(row.id)) {
      continue;
    }
    const oldOffset = getTableRowOffset(oldTable, row.id);
    const newOffset = getTableRowOffset(newTable, row.id);
    if (oldOffset === null || newOffset === null) {
      continue;
    }
    translations.set(row.id, { dx: 0, dy: newOffset - oldOffset });
  }

  return translations;
};

/** Column counterpart of `getMemberTranslationsForRows` (`dy` is always 0). */
export const getMemberTranslationsForColumns = (
  oldTable: TableDataV1,
  newTable: TableDataV1,
): Map<string, MemberTranslation> => {
  const translations = new Map<string, MemberTranslation>();
  const oldColumnIds = new Set(oldTable.columns.map((column) => column.id));

  for (const column of newTable.columns) {
    if (!oldColumnIds.has(column.id)) {
      continue;
    }
    const oldOffset = getTableColumnOffset(oldTable, column.id);
    const newOffset = getTableColumnOffset(newTable, column.id);
    if (oldOffset === null || newOffset === null) {
      continue;
    }
    translations.set(column.id, { dx: newOffset - oldOffset, dy: 0 });
  }

  return translations;
};
