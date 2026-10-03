import {
  assertValidTableData,
  createTableData,
  getTableCellBounds,
  getTableCellRange,
  getVisibleTableCell,
} from "../src/tableStruct";
import {
  insertColumnInTable,
  insertRowInTable,
  mergeTableCells,
  moveTableAxisBlock,
  removeColumnFromTable,
  removeRowFromTable,
  splitTableCells,
} from "../src/tableOps";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "../src/mutateElement";

const fixture = () => {
  let id = 0;
  return createTableData({
    rowCount: 3,
    columnCount: 3,
    randomizer: () => `cell-${id++}`,
  });
};

const at = (table: ReturnType<typeof fixture>, row: number, column: number) =>
  table.cells.find(
    (cell) =>
      cell.rowId === table.rows[row].id &&
      cell.columnId === table.columns[column].id,
  )!;

describe("merged table cells", () => {
  it.each([
    [0, 1],
    [1, 0],
    [1, 1],
  ])("merges and splits a %i by %i extension", (row, column) => {
    const original = fixture();
    const merged = mergeTableCells(
      original,
      at(original, 0, 0).id,
      at(original, row, column).id,
    );
    expect(assertValidTableData(merged)).toBe(merged);
    expect(getTableCellBounds(merged, at(original, row, column).id)).toEqual({
      x: 0,
      y: 0,
      width: (column + 1) * 160,
      height: (row + 1) * 56,
    });
    expect(getVisibleTableCell(merged, at(original, row, column).id)?.id).toBe(
      at(original, 0, 0).id,
    );
    const split = splitTableCells(merged, [at(original, row, column).id]);
    expect(split.cells).toEqual(original.cells);
  });

  it("expands selection repeatedly across intersecting merged cells", () => {
    const original = fixture();
    const first = mergeTableCells(
      original,
      at(original, 0, 1).id,
      at(original, 1, 1).id,
    );
    const second = mergeTableCells(
      first,
      at(original, 1, 0).id,
      at(original, 1, 1).id,
    );
    expect(
      getTableCellRange(second, at(original, 0, 0).id, at(original, 2, 0).id),
    ).toEqual({
      startRow: 0,
      endRow: 2,
      startColumn: 0,
      endColumn: 1,
    });
  });

  it("extends spans only when inserting inside a merge", () => {
    const original = fixture();
    const merged = mergeTableCells(
      original,
      at(original, 0, 0).id,
      at(original, 1, 1).id,
    );
    const insideRow = insertRowInTable(merged, 1);
    expect(at(insideRow, 0, 0).rowSpan).toBe(3);
    expect(at(insideRow, 1, 0).mergedInto).toBe(at(original, 0, 0).id);
    const outsideColumn = insertColumnInTable(merged, 2);
    expect(at(outsideColumn, 0, 0).columnSpan).toBe(2);
    expect(at(outsideColumn, 0, 2).mergedInto).toBeUndefined();
  });

  it("remaps a deleted anchor and preserves surviving coverage", () => {
    const original = fixture();
    const merged = mergeTableCells(
      original,
      at(original, 0, 0).id,
      at(original, 1, 1).id,
    );
    const removed = removeRowFromTable(merged, original.rows[0].id);
    expect(removed.remappedCellIds?.get(at(original, 0, 0).id)).toBe(
      at(original, 1, 0).id,
    );
    expect(getVisibleTableCell(removed.table, at(original, 1, 1).id)?.id).toBe(
      at(original, 1, 0).id,
    );
    const removedColumn = removeColumnFromTable(merged, original.columns[0].id);
    expect(removedColumn.remappedCellIds?.get(at(original, 0, 0).id)).toBe(
      at(original, 0, 1).id,
    );
  });

  it("moves all rows of a merged block together", () => {
    const original = fixture();
    const merged = mergeTableCells(
      original,
      at(original, 0, 0).id,
      at(original, 1, 0).id,
    );
    const moved = moveTableAxisBlock(merged, "row", original.rows[1].id, 1);
    expect(moved.rows.map((row) => row.id)).toEqual([
      original.rows[2].id,
      original.rows[0].id,
      original.rows[1].id,
    ]);
    expect(assertValidTableData(moved)).toBe(moved);
  });

  it("rejects overlap, broken cover refs, and out-of-bounds spans", () => {
    const original = fixture();
    const anchor = at(original, 0, 0);
    expect(() =>
      assertValidTableData({
        ...original,
        cells: original.cells.map((cell) =>
          cell.id === anchor.id ? { ...cell, rowSpan: 2, columnSpan: 2 } : cell,
        ),
      }),
    ).toThrow("incomplete");
    expect(() =>
      assertValidTableData({
        ...original,
        cells: original.cells.map((cell) =>
          cell.id === anchor.id ? { ...cell, rowSpan: 4 } : cell,
        ),
      }),
    ).toThrow("bounds");
    expect(() =>
      assertValidTableData({
        ...original,
        cells: original.cells.map((cell) =>
          cell.id === at(original, 0, 1).id
            ? { ...cell, mergedInto: "missing" }
            : cell,
        ),
      }),
    ).toThrow("without a valid merge anchor");
  });

  it("preserves merge fields and stable IDs across file round-trip", () => {
    const element = API.createElement({
      type: "table",
      rowCount: 2,
      columnCount: 2,
    });
    const first = element.table.cells[0].id;
    const second = element.table.cells[3].id;
    const merged = newElementWith(element, {
      table: mergeTableCells(element.table, first, second),
    });
    const serialized = JSON.parse(
      serializeAsJSON([merged], getDefaultAppState(), {}, "local"),
    );
    const restored = restoreElements(serialized.elements, null)[0];
    expect(restored.type).toBe("table");
    if (restored.type === "table") {
      expect(restored.table).toEqual(merged.table);
      expect(restored.table.cells.map((cell) => cell.id)).toEqual(
        element.table.cells.map((cell) => cell.id),
      );
    }
  });
});
