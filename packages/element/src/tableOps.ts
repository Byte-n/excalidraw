import { randomId } from "@excalidraw/common";

import {
  assertValidTableData,
  getTableColumnOffset,
  getTableCellRange,
  getTableRowOffset,
} from "./tableStruct";

import type { TableCellRange } from "./tableStruct";
import type { TableCellData, TableDataV1 } from "./types";

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
  /** Old anchor ID to surviving top-left cell ID. */
  remappedCellIds?: ReadonlyMap<string, string>;
};

export const getCellsInTableRange = (
  table: TableDataV1,
  range: TableCellRange,
) => {
  const rows = new Set(
    table.rows.slice(range.startRow, range.endRow + 1).map((row) => row.id),
  );
  const columns = new Set(
    table.columns
      .slice(range.startColumn, range.endColumn + 1)
      .map((column) => column.id),
  );
  return table.cells.filter(
    (cell) => rows.has(cell.rowId) && columns.has(cell.columnId),
  );
};

export const mergeTableCells = (
  table: TableDataV1,
  firstId: string,
  lastId: string,
): TableDataV1 => {
  const range = getTableCellRange(table, firstId, lastId);
  const selected = getCellsInTableRange(table, range);
  const visible = selected.filter((cell) => !cell.mergedInto);
  if (visible.length < 2) {
    throw new Error("Select at least two visible cells to merge");
  }
  const anchor = selected.find(
    (cell) =>
      cell.rowId === table.rows[range.startRow].id &&
      cell.columnId === table.columns[range.startColumn].id,
  )!;
  const ids = new Set(selected.map((cell) => cell.id));
  return assertValidTableData({
    ...table,
    cells: table.cells.map((cell) => {
      if (!ids.has(cell.id)) {
        return cell;
      }
      const {
        rowSpan: _rowSpan,
        columnSpan: _columnSpan,
        mergedInto: _mergedInto,
        ...base
      } = cell;
      return cell.id === anchor.id
        ? {
            ...base,
            rowSpan: range.endRow - range.startRow + 1,
            columnSpan: range.endColumn - range.startColumn + 1,
          }
        : { ...base, mergedInto: anchor.id };
    }),
  });
};

export const splitTableCells = (
  table: TableDataV1,
  cellIds: readonly string[],
): TableDataV1 => {
  const anchors = new Set(
    cellIds.map((id) => {
      const cell = table.cells.find((candidate) => candidate.id === id);
      if (!cell) {
        throw new Error(`Table cell not found: ${id}`);
      }
      return cell.mergedInto ?? cell.id;
    }),
  );
  if (
    ![...anchors].some((id) => {
      const cell = table.cells.find((candidate) => candidate.id === id)!;
      return (cell.rowSpan ?? 1) > 1 || (cell.columnSpan ?? 1) > 1;
    })
  ) {
    throw new Error("Select a merged cell to split");
  }
  return assertValidTableData({
    ...table,
    cells: table.cells.map((cell) => {
      if (
        (!anchors.has(cell.id) && !cell.mergedInto) ||
        (cell.mergedInto && !anchors.has(cell.mergedInto))
      ) {
        return cell;
      }
      const {
        rowSpan: _rowSpan,
        columnSpan: _columnSpan,
        mergedInto: _mergedInto,
        ...base
      } = cell;
      return base;
    }),
  });
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
 */
export const insertRowInTable = (
  table: TableDataV1,
  boundaryIndex: number,
  { randomizer = randomId }: TableStructureOptions = {},
): TableDataV1 => {
  assertBoundaryIndex(boundaryIndex, table.rows.length, "row");
  const neighbour = table.rows[boundaryIndex - 1] ?? table.rows[boundaryIndex];
  const newRow = { id: randomizer(), height: neighbour.height };
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

  const newCellByColumn = new Map<string, TableCellData>(
    newCells.map((cell) => [cell.columnId, cell]),
  );
  const rowIndex = new Map(table.rows.map((row, index) => [row.id, index]));
  const columnIndex = new Map(
    table.columns.map((column, index) => [column.id, index]),
  );
  const cells = table.cells.map((cell) => {
    if (cell.mergedInto || !cell.rowSpan || cell.rowSpan < 2) {
      return cell;
    }
    const start = rowIndex.get(cell.rowId)!;
    if (boundaryIndex <= start || boundaryIndex >= start + cell.rowSpan) {
      return cell;
    }
    for (
      let column = columnIndex.get(cell.columnId)!;
      column < columnIndex.get(cell.columnId)! + (cell.columnSpan ?? 1);
      column++
    ) {
      const fresh = newCellByColumn.get(table.columns[column].id)!;
      newCellByColumn.set(fresh.columnId, { ...fresh, mergedInto: cell.id });
    }
    return { ...cell, rowSpan: cell.rowSpan + 1 };
  });

  return assertValidTableData({
    ...table,
    rows,
    columns: table.columns,
    cells: [...cells, ...newCellByColumn.values()],
  });
};

/** Column counterpart of `insertRowInTable` (see it for the semantics). */
export const insertColumnInTable = (
  table: TableDataV1,
  boundaryIndex: number,
  { randomizer = randomId }: TableStructureOptions = {},
): TableDataV1 => {
  assertBoundaryIndex(boundaryIndex, table.columns.length, "column");
  const neighbour =
    table.columns[boundaryIndex - 1] ?? table.columns[boundaryIndex];
  const newColumn = { id: randomizer(), width: neighbour.width };
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

  const newCellByRow = new Map<string, TableCellData>(
    newCells.map((cell) => [cell.rowId, cell]),
  );
  const rowIndex = new Map(table.rows.map((row, index) => [row.id, index]));
  const columnIndex = new Map(
    table.columns.map((column, index) => [column.id, index]),
  );
  const cells = table.cells.map((cell) => {
    if (cell.mergedInto || !cell.columnSpan || cell.columnSpan < 2) {
      return cell;
    }
    const start = columnIndex.get(cell.columnId)!;
    if (boundaryIndex <= start || boundaryIndex >= start + cell.columnSpan) {
      return cell;
    }
    for (
      let row = rowIndex.get(cell.rowId)!;
      row < rowIndex.get(cell.rowId)! + (cell.rowSpan ?? 1);
      row++
    ) {
      const fresh = newCellByRow.get(table.rows[row].id)!;
      newCellByRow.set(fresh.rowId, { ...fresh, mergedInto: cell.id });
    }
    return { ...cell, columnSpan: cell.columnSpan + 1 };
  });

  return assertValidTableData({
    ...table,
    rows: table.rows,
    columns,
    cells: [...cells, ...newCellByRow.values()],
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

  return removeTableAxis(table, "row", rowId);
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

  return removeTableAxis(table, "column", columnId);
};

const removeTableAxis = (
  table: TableDataV1,
  axis: "row" | "column",
  id: string,
): TableRemovalResult => {
  const rows =
    axis === "row" ? table.rows.filter((row) => row.id !== id) : table.rows;
  const columns =
    axis === "column"
      ? table.columns.filter((column) => column.id !== id)
      : table.columns;
  const removed = table.cells.filter((cell) =>
    axis === "row" ? cell.rowId === id : cell.columnId === id,
  );
  const survivors = table.cells.filter((cell) =>
    axis === "row" ? cell.rowId !== id : cell.columnId !== id,
  );
  const next = new Map(
    survivors.map((cell) => {
      const {
        rowSpan: _rowSpan,
        columnSpan: _columnSpan,
        mergedInto: _mergedInto,
        ...base
      } = cell;
      return [cell.id, base as TableCellData];
    }),
  );
  const remappedCellIds = new Map<string, string>();
  for (const anchor of table.cells) {
    if (
      anchor.mergedInto ||
      ((anchor.rowSpan ?? 1) === 1 && (anchor.columnSpan ?? 1) === 1)
    ) {
      continue;
    }
    const range = getTableCellRange(table, anchor.id, anchor.id);
    const cells = getCellsInTableRange(table, range)
      .filter((cell) => next.has(cell.id))
      .sort(
        (left, right) =>
          rows.findIndex((row) => row.id === left.rowId) -
            rows.findIndex((row) => row.id === right.rowId) ||
          columns.findIndex((column) => column.id === left.columnId) -
            columns.findIndex((column) => column.id === right.columnId),
      );
    if (!cells.length) {
      continue;
    }
    const newAnchor = cells.find((cell) => cell.id === anchor.id) ?? cells[0];
    if (newAnchor.id !== anchor.id) {
      remappedCellIds.set(anchor.id, newAnchor.id);
    }
    const rowSpan = new Set(cells.map((cell) => cell.rowId)).size;
    const columnSpan = new Set(cells.map((cell) => cell.columnId)).size;
    for (const cell of cells) {
      next.set(
        cell.id,
        cell.id === newAnchor.id
          ? {
              ...next.get(cell.id)!,
              ...(rowSpan > 1 || columnSpan > 1 ? { rowSpan, columnSpan } : {}),
            }
          : { ...next.get(cell.id)!, mergedInto: newAnchor.id },
      );
    }
  }
  return {
    table: assertValidTableData({
      ...table,
      rows,
      columns,
      cells: survivors.map((cell) => next.get(cell.id)!),
    }),
    removedCellIds: removed.map((cell) => cell.id),
    remappedCellIds,
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

  return assertValidTableData({
    ...table,
    rows,
    columns: table.columns,
    cells: table.cells,
  });
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

  return assertValidTableData({
    ...table,
    rows: table.rows,
    columns,
    cells: table.cells,
  });
};

export const getTableAxisBlockRange = (
  table: TableDataV1,
  axis: "row" | "column",
  id: string,
): { start: number; end: number } => {
  const entries = axis === "row" ? table.rows : table.columns;
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) {
    throw new Error(`Table ${axis} not found: ${id}`);
  }
  let start = index;
  let end = index;
  let changed: boolean;
  do {
    changed = false;
    for (const cell of table.cells) {
      if (cell.mergedInto) {
        continue;
      }
      const span = axis === "row" ? cell.rowSpan ?? 1 : cell.columnSpan ?? 1;
      if (span === 1) {
        continue;
      }
      const first = entries.findIndex(
        (entry) => entry.id === (axis === "row" ? cell.rowId : cell.columnId),
      );
      const last = first + span - 1;
      if (first <= end && last >= start) {
        const nextStart = Math.min(start, first);
        const nextEnd = Math.max(end, last);
        changed ||= nextStart !== start || nextEnd !== end;
        start = nextStart;
        end = nextEnd;
      }
    }
  } while (changed);
  return { start, end };
};

export const moveTableAxisBlock = (
  table: TableDataV1,
  axis: "row" | "column",
  id: string,
  toIndex: number,
): TableDataV1 => {
  const entries = axis === "row" ? table.rows : table.columns;
  const { start, end } = getTableAxisBlockRange(table, axis, id);
  const size = end - start + 1;
  if (
    !Number.isInteger(toIndex) ||
    toIndex < 0 ||
    toIndex > entries.length - size
  ) {
    throw new Error(`Invalid table ${axis} move target`);
  }
  if (toIndex === start) {
    return table;
  }
  const block = entries.slice(start, end + 1);
  const rest = [...entries.slice(0, start), ...entries.slice(end + 1)];
  rest.splice(toIndex, 0, ...block);
  try {
    return assertValidTableData({
      ...table,
      ...(axis === "row"
        ? { rows: rest as TableDataV1["rows"] }
        : { columns: rest as TableDataV1["columns"] }),
    });
  } catch {
    throw new Error(`Cannot move ${axis} block through another merged cell`);
  }
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

  const height =
    minHeight !== undefined ? Math.max(newHeight, minHeight) : newHeight;
  const rows = table.rows.map((row) =>
    row.id === rowId ? { ...row, height } : row,
  );

  return assertValidTableData({
    ...table,
    rows,
    columns: table.columns,
    cells: table.cells,
  });
};

/** Column counterpart of `resizeRowInTable` (see it for the semantics). */
export const resizeColumnInTable = (
  table: TableDataV1,
  columnId: string,
  newWidth: number,
  { minWidth }: TableColumnResizeOptions = {},
): TableDataV1 => {
  assertValidNewSize(newWidth, "column width");
  assertValidMinSize(minWidth, "column width");
  assertColumnExists(table.columns, columnId);

  const width =
    minWidth !== undefined ? Math.max(newWidth, minWidth) : newWidth;
  const columns = table.columns.map((column) =>
    column.id === columnId ? { ...column, width } : column,
  );

  return assertValidTableData({
    ...table,
    rows: table.rows,
    columns,
    cells: table.cells,
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
