import {
  arrayToMap,
  cloneJSON,
  getLineHeight,
  randomId,
} from "@excalidraw/common";
import {
  assertValidTableData,
  assertValidContainerRefs,
  duplicateElements,
  getContainerSubtreeElements,
  getTableCellBounds,
  getTableCellRange,
  getTableColumnOffset,
  getTableRowOffset,
  isTableElement,
  newElementWith,
  newTextElement,
  syncMovedIndices,
  type TableCellRange,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  TableDataV1,
} from "@excalidraw/element/types";

import type { AppState } from "../../types";
import type App from "../App";

export type TableRangeClipboard = {
  table: ExcalidrawTableElement;
  elements: ExcalidrawElement[];
};

const assertValidSnapshot = (snapshot: TableRangeClipboard): void => {
  const elements = [snapshot.table, ...snapshot.elements];
  const ids = new Set<string>();
  for (const element of elements) {
    if (ids.has(element.id)) {
      throw new Error(`Duplicate element id: ${element.id}`);
    }
    ids.add(element.id);
  }
  assertValidTableData(snapshot.table.table);
  assertValidContainerRefs(elements);
};

const assertWritableTarget = (app: App, target: ExcalidrawTableElement) => {
  if (!app.isInteractionEnabled()) {
    throw new Error("Table paste target is read-only");
  }
  let current: ExcalidrawElement | undefined = target;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id)) {
      throw new Error("Table paste target has a parent cycle");
    }
    visited.add(current.id);
    if (current.locked) {
      throw new Error("Table paste target is locked");
    }
    current = current.containerRef?.elementId
      ? app.scene.getNonDeletedElement(current.containerRef.elementId) ??
        undefined
      : undefined;
  }
};

const commitTablePaste = (
  app: App,
  elements: ExcalidrawElement[],
  additions: ExcalidrawElement[],
) => {
  const ids = new Set<string>();
  for (const element of elements) {
    if (ids.has(element.id)) {
      throw new Error(`Duplicate element id: ${element.id}`);
    }
    ids.add(element.id);
  }
  assertValidContainerRefs(elements);
  const ordered = syncMovedIndices(elements, arrayToMap(additions));
  app.store.scheduleCapture();
  app.scene.replaceAllElements(ordered);
};

const cellAt = (table: TableDataV1, row: number, column: number) =>
  table.cells.find(
    (cell) =>
      cell.rowId === table.rows[row].id &&
      cell.columnId === table.columns[column].id,
  )!;

const includeMergedCells = (
  table: TableDataV1,
  initial: TableCellRange,
): TableCellRange => {
  let range = initial;
  let changed: boolean;
  do {
    changed = false;
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (
        let column = range.startColumn;
        column <= range.endColumn;
        column++
      ) {
        const cell = cellAt(table, row, column);
        const anchor = table.cells.find(
          (candidate) => candidate.id === (cell.mergedInto ?? cell.id),
        )!;
        const anchorRow = table.rows.findIndex(
          (entry) => entry.id === anchor.rowId,
        );
        const anchorColumn = table.columns.findIndex(
          (entry) => entry.id === anchor.columnId,
        );
        const expanded = {
          startRow: Math.min(range.startRow, anchorRow),
          endRow: Math.max(range.endRow, anchorRow + (anchor.rowSpan ?? 1) - 1),
          startColumn: Math.min(range.startColumn, anchorColumn),
          endColumn: Math.max(
            range.endColumn,
            anchorColumn + (anchor.columnSpan ?? 1) - 1,
          ),
        };
        if (
          expanded.startRow !== range.startRow ||
          expanded.endRow !== range.endRow ||
          expanded.startColumn !== range.startColumn ||
          expanded.endColumn !== range.endColumn
        ) {
          range = expanded;
          changed = true;
        }
      }
    }
  } while (changed);
  return range;
};

export const getSelectedTableRange = (
  state: Pick<AppState, "tableCellSelection" | "tableRowColSelection">,
  table: ExcalidrawTableElement,
): TableCellRange | null => {
  const cells = state.tableCellSelection;
  if (cells?.tableId === table.id) {
    return includeMergedCells(
      table.table,
      getTableCellRange(table.table, cells.anchorId, cells.focusId),
    );
  }
  const axis = state.tableRowColSelection;
  if (axis?.tableId === table.id) {
    const row = table.table.rows.findIndex((item) => item.id === axis.id);
    const column = table.table.columns.findIndex((item) => item.id === axis.id);
    if (axis.kind === "row" && row >= 0) {
      return includeMergedCells(table.table, {
        startRow: row,
        endRow: row,
        startColumn: 0,
        endColumn: table.table.columns.length - 1,
      });
    }
    if (axis.kind === "column" && column >= 0) {
      return includeMergedCells(table.table, {
        startRow: 0,
        endRow: table.table.rows.length - 1,
        startColumn: column,
        endColumn: column,
      });
    }
  }
  return null;
};

export const createTableRangeClipboard = (
  source: ExcalidrawTableElement,
  range: TableCellRange,
  scene: readonly ExcalidrawElement[],
): TableRangeClipboard => {
  assertValidTableData(source.table);
  const rows = source.table.rows.slice(range.startRow, range.endRow + 1);
  const columns = source.table.columns.slice(
    range.startColumn,
    range.endColumn + 1,
  );
  if (!rows.length || !columns.length) {
    throw new Error("Empty table selection");
  }
  const cells = rows.flatMap((_, row) =>
    columns.map((__, column) =>
      cellAt(source.table, range.startRow + row, range.startColumn + column),
    ),
  );
  const cellIds = new Set(cells.map((cell) => cell.id));
  for (const cell of cells) {
    if (cell.mergedInto && !cellIds.has(cell.mergedInto)) {
      throw new Error("Selection cuts through a merged cell");
    }
    const row = rows.findIndex((entry) => entry.id === cell.rowId);
    const column = columns.findIndex((entry) => entry.id === cell.columnId);
    if (
      row + (cell.rowSpan ?? 1) > rows.length ||
      column + (cell.columnSpan ?? 1) > columns.length
    ) {
      throw new Error("Selection cuts through a merged cell");
    }
  }
  const selectedTableData = cloneJSON({
    schemaVersion: 1,
    style: source.table.style,
    rows,
    columns,
    cells,
  }) as TableDataV1;
  const table: ExcalidrawTableElement = {
    ...cloneJSON(source),
    table: selectedTableData,
    x: source.x + getTableColumnOffset(source.table, columns[0].id)!,
    y: source.y + getTableRowOffset(source.table, rows[0].id)!,
    width: columns.reduce((sum, column) => sum + column.width, 0),
    height: rows.reduce((sum, row) => sum + row.height, 0),
    id: randomId(),
    containerRef: undefined,
  };

  const byId = new Map(scene.map((element) => [element.id, element]));
  const descendants = getContainerSubtreeElements(scene, source.id, byId);
  const included = new Set<string>();
  for (const element of descendants) {
    let parent: ExcalidrawElement | undefined = element;
    const visited = new Set<string>();
    while (parent && parent.id !== source.id && !visited.has(parent.id)) {
      visited.add(parent.id);
      const ref: ExcalidrawElement["containerRef"] = parent.containerRef;
      if (ref?.elementId === source.id) {
        if (ref.kind === "tableCell" && cellIds.has(ref.cellId)) {
          included.add(element.id);
        }
        break;
      }
      parent = ref?.elementId
        ? byId.get(ref.elementId)
        : "containerId" in parent && parent.containerId
        ? byId.get(parent.containerId)
        : undefined;
    }
  }
  const elements = descendants
    .filter((element) => included.has(element.id))
    .map((element) => {
      const copy = cloneJSON(element);
      return copy.containerRef?.elementId === source.id
        ? {
            ...copy,
            containerRef: { ...copy.containerRef, elementId: table.id },
          }
        : copy;
    });
  assertValidTableData(table.table);
  assertValidSnapshot({ table, elements });
  return { table, elements };
};

export const tableRangeToTSV = (snapshot: TableRangeClipboard): string => {
  const { table, elements } = snapshot;
  return table.table.rows
    .map((_, row) =>
      table.table.columns
        .map((__, column) => {
          const cell = cellAt(table.table, row, column);
          if (cell.mergedInto) {
            return "";
          }
          const text = elements.find(
            (element) =>
              element.type === "text" &&
              element.containerRef?.kind === "tableCell" &&
              element.containerRef.cellId === cell.id &&
              element.containerRef.role === "backgroundText",
          );
          return text?.type === "text"
            ? text.text.replace(/\t|\r?\n/g, " ")
            : "";
        })
        .join("\t"),
    )
    .join("\n");
};

export const pasteTableRangeIntoCell = (
  app: App,
  snapshot: TableRangeClipboard,
  targetId: string,
  targetCellId: string,
): void => {
  const target = app.scene.getNonDeletedElement(targetId);
  if (!target || !isTableElement(target)) {
    throw new Error("Table paste target is unavailable");
  }
  assertWritableTarget(app, target);
  assertValidSnapshot(snapshot);
  if (snapshot.elements.some(isTableElement)) {
    throw new Error("Nested tables cannot be pasted as a cell range");
  }
  const source = snapshot.table.table;
  const targetCell = target.table.cells.find(
    (cell) => cell.id === targetCellId,
  );
  if (!targetCell) {
    throw new Error("Table paste target cell is missing");
  }
  const startRow = target.table.rows.findIndex(
    (row) => row.id === targetCell.rowId,
  );
  const startColumn = target.table.columns.findIndex(
    (column) => column.id === targetCell.columnId,
  );
  const rows = [...target.table.rows];
  const columns = [...target.table.columns];
  while (rows.length < startRow + source.rows.length) {
    const index = rows.length - startRow;
    rows.push({ id: randomId(), height: source.rows[index].height });
  }
  while (columns.length < startColumn + source.columns.length) {
    const index = columns.length - startColumn;
    columns.push({ id: randomId(), width: source.columns[index].width });
  }
  const oldCells = [...target.table.cells];
  for (const row of rows) {
    for (const column of columns) {
      if (
        !oldCells.some(
          (cell) => cell.rowId === row.id && cell.columnId === column.id,
        )
      ) {
        oldCells.push({
          id: randomId(),
          rowId: row.id,
          columnId: column.id,
          style: {},
        });
      }
    }
  }
  const targetCells = source.rows.flatMap((_, row) =>
    source.columns.map((__, column) =>
      cellAt(
        { ...target.table, rows, columns, cells: oldCells },
        startRow + row,
        startColumn + column,
      ),
    ),
  );
  if (
    targetCells.some(
      (cell) =>
        cell.mergedInto ||
        (cell.rowSpan ?? 1) > 1 ||
        (cell.columnSpan ?? 1) > 1,
    )
  ) {
    throw new Error("Table paste conflicts with merged cells");
  }
  const sourceCellIds = source.cells.map((cell) => cell.id);
  const cellIdMap = new Map(
    sourceCellIds.map((id, index) => [id, targetCells[index].id]),
  );
  const nextRows = rows.map((row, index) =>
    index >= startRow && index < startRow + source.rows.length
      ? {
          ...row,
          height: source.rows[index - startRow].height,
          style: source.rows[index - startRow].style
            ? cloneJSON(source.rows[index - startRow].style)
            : undefined,
        }
      : row,
  );
  const nextColumns = columns.map((column, index) =>
    index >= startColumn && index < startColumn + source.columns.length
      ? {
          ...column,
          width: source.columns[index - startColumn].width,
          style: source.columns[index - startColumn].style
            ? cloneJSON(source.columns[index - startColumn].style)
            : undefined,
        }
      : column,
  );
  const replacement = new Map(
    targetCells.map((cell, index) => {
      const copied = source.cells[index];
      return [
        cell.id,
        {
          ...cell,
          style: cloneJSON(copied.style),
          ...(copied.rowSpan ? { rowSpan: copied.rowSpan } : {}),
          ...(copied.columnSpan ? { columnSpan: copied.columnSpan } : {}),
          ...(copied.mergedInto
            ? { mergedInto: cellIdMap.get(copied.mergedInto)! }
            : {}),
        },
      ];
    }),
  );
  const nextTable: TableDataV1 = {
    ...target.table,
    rows: nextRows,
    columns: nextColumns,
    cells: oldCells.map((cell) => replacement.get(cell.id) ?? cell),
  };
  assertValidTableData(nextTable);

  const sourceElements = [snapshot.table, ...snapshot.elements];
  const duplicated = duplicateElements({
    type: "everything",
    elements: sourceElements,
  });
  const copiedTable = duplicated.duplicatedElements.find(isTableElement);
  if (!copiedTable) {
    throw new Error("Table copy is incomplete");
  }
  const sourceById = arrayToMap(sourceElements);
  const copiedCells = copiedTable.table.cells;
  const copiedToTarget = new Map(
    copiedCells.map((cell, index) => [cell.id, targetCells[index].id]),
  );
  const additions = duplicated.duplicatedElements
    .filter((element) => element.id !== copiedTable.id)
    .map((element) => {
      const originalId = duplicated.duplicateIdToOrigId.get(element.id)!;
      let original = sourceById.get(originalId);
      const seen = new Set<string>();
      while (
        original &&
        !seen.has(original.id) &&
        original.containerRef?.elementId !== snapshot.table.id
      ) {
        seen.add(original.id);
        original = original.containerRef?.elementId
          ? sourceById.get(original.containerRef.elementId)
          : "containerId" in original && original.containerId
          ? sourceById.get(original.containerId)
          : undefined;
      }
      const originalCellId =
        original?.containerRef?.kind === "tableCell"
          ? original.containerRef.cellId
          : undefined;
      const sourceBounds =
        originalCellId && getTableCellBounds(source, originalCellId);
      const targetBounds =
        originalCellId &&
        getTableCellBounds(nextTable, cellIdMap.get(originalCellId)!);
      const dx =
        sourceBounds && targetBounds
          ? target.x + targetBounds.x - snapshot.table.x - sourceBounds.x
          : 0;
      const dy =
        sourceBounds && targetBounds
          ? target.y + targetBounds.y - snapshot.table.y - sourceBounds.y
          : 0;
      const ref =
        element.containerRef?.kind === "tableCell" &&
        element.containerRef.elementId === copiedTable.id
          ? {
              ...element.containerRef,
              elementId: target.id,
              cellId: copiedToTarget.get(element.containerRef.cellId)!,
            }
          : element.containerRef;
      return {
        ...element,
        x: element.x + dx,
        y: element.y + dy,
        containerRef: ref,
      } as ExcalidrawElement;
    });
  const replacedBackgroundIds = new Set(
    app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          element.containerRef?.kind === "tableCell" &&
          element.containerRef.elementId === target.id &&
          element.containerRef.role === "backgroundText" &&
          targetCells.some(
            (cell) =>
              cell.id ===
              (element.containerRef?.kind === "tableCell"
                ? element.containerRef.cellId
                : undefined),
          ),
      )
      .map((element) => element.id),
  );
  const previous = app.scene.getElementsIncludingDeleted();
  const next = [
    ...previous.map((element) =>
      replacedBackgroundIds.has(element.id)
        ? newElementWith(element, { isDeleted: true })
        : element.id === target.id
        ? newElementWith(target, {
            table: nextTable,
            width: nextColumns.reduce((sum, column) => sum + column.width, 0),
            height: nextRows.reduce((sum, row) => sum + row.height, 0),
          })
        : element,
    ),
    ...additions,
  ];
  commitTablePaste(app, next, additions);
};

export const pasteTSVIntoCell = (
  app: App,
  text: string,
  tableId: string,
  cellId: string,
): void => {
  const target = app.scene.getNonDeletedElement(tableId);
  if (!target || !isTableElement(target)) {
    throw new Error("Table paste target is unavailable");
  }
  assertWritableTarget(app, target);
  const matrix = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.split("\t"));
  const height = matrix.length;
  const width = Math.max(...matrix.map((row) => row.length));
  const anchor = target.table.cells.find((cell) => cell.id === cellId);
  if (!anchor) {
    throw new Error("Table paste target cell is missing");
  }
  const startRow = target.table.rows.findIndex(
    (row) => row.id === anchor.rowId,
  );
  const startColumn = target.table.columns.findIndex(
    (column) => column.id === anchor.columnId,
  );
  const rows = [...target.table.rows];
  const columns = [...target.table.columns];
  while (rows.length < startRow + height) {
    rows.push({ id: randomId(), height: rows[rows.length - 1].height });
  }
  while (columns.length < startColumn + width) {
    columns.push({ id: randomId(), width: columns[columns.length - 1].width });
  }
  const cells = [...target.table.cells];
  for (const row of rows) {
    for (const column of columns) {
      if (
        !cells.some(
          (cell) => cell.rowId === row.id && cell.columnId === column.id,
        )
      ) {
        cells.push({
          id: randomId(),
          rowId: row.id,
          columnId: column.id,
          style: {},
        });
      }
    }
  }
  const nextTable = { ...target.table, rows, columns, cells };
  const selected = matrix.flatMap((row, rowIndex) =>
    row.map((value, columnIndex) => ({
      value,
      cell: cellAt(nextTable, startRow + rowIndex, startColumn + columnIndex),
    })),
  );
  if (
    selected.some(
      ({ cell }) =>
        cell.mergedInto ||
        (cell.rowSpan ?? 1) > 1 ||
        (cell.columnSpan ?? 1) > 1,
    )
  ) {
    throw new Error("Table paste conflicts with merged cells");
  }
  assertValidTableData(nextTable);
  const selectedIds = new Set(selected.map(({ cell }) => cell.id));
  const previous = app.scene.getElementsIncludingDeleted();
  const existing = previous.filter(
    (element) =>
      !element.isDeleted &&
      element.containerRef?.kind === "tableCell" &&
      element.containerRef.elementId === tableId &&
      element.containerRef.role === "backgroundText" &&
      selectedIds.has(element.containerRef.cellId),
  );
  const additions = selected
    .filter(({ value }) => value !== "")
    .map(({ cell, value }) => {
      const bounds = getTableCellBounds(nextTable, cell.id)!;
      const fontFamily = app.state.currentItemFontFamily;
      return newTextElement({
        x: target.x + bounds.x + 4,
        y: target.y + bounds.y + 4,
        width: Math.max(1, bounds.width - 8),
        height: Math.max(1, bounds.height - 8),
        text: value,
        originalText: value,
        fontFamily,
        fontSize: app.state.currentItemFontSize,
        lineHeight: getLineHeight(fontFamily),
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: app.state.currentItemStrokeColor,
        backgroundColor: "transparent",
        fillStyle: app.state.currentItemFillStyle,
        strokeWidth: app.getCurrentItemStrokeWidth("text"),
        strokeStyle: app.state.currentItemStrokeStyle,
        roughness: app.state.currentItemRoughness,
        opacity: app.state.currentItemOpacity,
        containerId: null,
        autoResize: false,
        locked: false,
        containerRef: {
          kind: "tableCell",
          elementId: tableId,
          cellId: cell.id,
          role: "backgroundText",
        },
      });
    });
  const removed = new Set(existing.map((element) => element.id));
  const next = [
    ...previous.map((element) =>
      removed.has(element.id)
        ? newElementWith(element, { isDeleted: true })
        : element.id === target.id
        ? newElementWith(target, {
            table: nextTable,
            width: columns.reduce((sum, column) => sum + column.width, 0),
            height: rows.reduce((sum, row) => sum + row.height, 0),
          })
        : element,
    ),
    ...additions,
  ];
  commitTablePaste(app, next, additions);
};
