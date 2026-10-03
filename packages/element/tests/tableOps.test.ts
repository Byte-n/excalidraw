import { assertValidTableData, createTableData } from "../src/tableStruct";
import {
  getMemberTranslationsForColumns,
  getMemberTranslationsForRows,
  insertColumnInTable,
  insertRowInTable,
  moveColumnInTable,
  moveRowInTable,
  removeColumnFromTable,
  removeRowFromTable,
  resizeColumnInTable,
  resizeRowInTable,
} from "../src/tableOps";

import type { TableDataV1 } from "../src/types";

/** Deterministic id source with its own namespace: `${prefix}-0`, ... */
const makeRandomizer = (prefix: string) => {
  let counter = 0;
  return () => `${prefix}-${counter++}`;
};

/** rows [100, 50, 25] and columns [80, 120, 40], with stable short ids. */
const makeThreeByThree = () => {
  const table = createTableData({
    rowCount: 3,
    columnCount: 3,
    randomizer: makeRandomizer("base"),
  });
  return {
    schemaVersion: 1 as const,
    rows: [
      { id: table.rows[0].id, height: 100 },
      { id: table.rows[1].id, height: 50 },
      { id: table.rows[2].id, height: 25 },
    ],
    columns: [
      { id: table.columns[0].id, width: 80 },
      { id: table.columns[1].id, width: 120 },
      { id: table.columns[2].id, width: 40 },
    ],
    cells: table.cells,
  };
};

const cellOf = (table: TableDataV1, rowIndex: number, columnIndex: number) =>
  table.cells.find(
    (cell) =>
      cell.rowId === table.rows[rowIndex].id &&
      cell.columnId === table.columns[columnIndex].id,
  )!;

describe("insertRowInTable", () => {
  it("inserts at the boundary index, inheriting the adjacent row above", () => {
    const table = makeThreeByThree();
    const result = insertRowInTable(table, 1, {
      randomizer: makeRandomizer("new"),
    });

    expect(result.rows.map((row) => row.id)).toEqual([
      table.rows[0].id,
      "new-0",
      table.rows[1].id,
      table.rows[2].id,
    ]);
    // the row above the preview boundary donates its height
    expect(result.rows[1]).toEqual({ id: "new-0", height: 100 });
    expect(result.columns).toBe(table.columns);
    // existing cells keep their ids, every column gets one fresh cell
    expect(result.cells).toHaveLength(12);
    expect(result.cells.filter((cell) => cell.rowId === "new-0")).toHaveLength(
      3,
    );
    expect(
      result.cells
        .filter((cell) => cell.rowId === "new-0")
        .map((cell) => cell.columnId),
    ).toEqual(table.columns.map((column) => column.id));
    // existing cells keep their identity and ids; new cells are empty-styled
    for (const cell of table.cells) {
      expect(result.cells).toContain(cell);
    }
    expect(
      result.cells
        .filter((cell) => cell.rowId === "new-0")
        .every((cell) => cell.style && Object.keys(cell.style).length === 0),
    ).toBe(true);
    expect(assertValidTableData(result)).toBe(result);
  });

  it("inherits the first row at the top boundary and the last row at the bottom", () => {
    const table = makeThreeByThree();

    const top = insertRowInTable(table, 0, {
      randomizer: makeRandomizer("new"),
    });
    expect(top.rows[0].height).toBe(100);
    expect(top.rows.slice(1).map((row) => row.id)).toEqual(
      table.rows.map((row) => row.id),
    );

    const bottom = insertRowInTable(table, 3, {
      randomizer: makeRandomizer("new"),
    });
    expect(bottom.rows[3].height).toBe(25);
    expect(bottom.rows.slice(0, 3).map((row) => row.id)).toEqual(
      table.rows.map((row) => row.id),
    );
  });

  it("generates ids that do not collide with existing ones", () => {
    const table = makeThreeByThree();
    const result = insertRowInTable(table, 1);

    const rowIds = result.rows.map((row) => row.id);
    expect(new Set(rowIds).size).toBe(rowIds.length);
    const cellIds = result.cells.map((cell) => cell.id);
    expect(new Set(cellIds).size).toBe(cellIds.length);
    // the new row's cells are fresh ids, not reuses of any existing id
    const existingIds = new Set([
      ...table.rows.map((row) => row.id),
      ...table.cells.map((cell) => cell.id),
    ]);
    expect(existingIds.has(result.rows[1].id)).toBe(false);
  });

  it("rejects out-of-range and non-integer boundaries", () => {
    const table = makeThreeByThree();

    expect(() => insertRowInTable(table, -1)).toThrow("boundary index");
    expect(() => insertRowInTable(table, 4)).toThrow("boundary index");
    expect(() => insertRowInTable(table, 1.5)).toThrow("boundary index");
  });
});

describe("insertColumnInTable", () => {
  it("inserts at the boundary index, inheriting the adjacent column's width", () => {
    const table = makeThreeByThree();
    const result = insertColumnInTable(table, 2, {
      randomizer: makeRandomizer("new"),
    });

    expect(result.columns.map((column) => column.id)).toEqual([
      table.columns[0].id,
      table.columns[1].id,
      "new-0",
      table.columns[2].id,
    ]);
    // the column left of the preview boundary donates its width
    expect(result.columns[2]).toEqual({ id: "new-0", width: 120 });
    expect(result.rows).toBe(table.rows);
    expect(result.cells).toHaveLength(12);
    expect(
      result.cells.filter((cell) => cell.columnId === "new-0"),
    ).toHaveLength(3);
    expect(assertValidTableData(result)).toBe(result);
  });

  it("rejects out-of-range and non-integer boundaries", () => {
    const table = makeThreeByThree();

    expect(() => insertColumnInTable(table, -1)).toThrow("boundary index");
    expect(() => insertColumnInTable(table, 4)).toThrow("boundary index");
  });
});

describe("removeRowFromTable", () => {
  it("removes the row and returns exactly its cell ids", () => {
    const table = makeThreeByThree();
    const rowCells = table.cells.filter(
      (cell) => cell.rowId === table.rows[1].id,
    );
    const result = removeRowFromTable(table, table.rows[1].id);

    expect(result.removedCellIds).toEqual(rowCells.map((cell) => cell.id));
    expect(result.table.rows.map((row) => row.id)).toEqual([
      table.rows[0].id,
      table.rows[2].id,
    ]);
    expect(result.table.cells).toHaveLength(6);
    expect(
      result.table.cells.some((cell) => cell.rowId === table.rows[1].id),
    ).toBe(false);
    // surviving cells keep their identity
    for (const cell of table.cells) {
      if (cell.rowId !== table.rows[1].id) {
        expect(result.table.cells).toContainEqual(cell);
      }
    }
    expect(assertValidTableData(result.table)).toBe(result.table);
  });

  it("refuses to remove the last row", () => {
    const table = createTableData({
      rowCount: 1,
      columnCount: 2,
      randomizer: makeRandomizer("new"),
    });

    expect(() => removeRowFromTable(table, table.rows[0].id)).toThrow(
      "last row",
    );
  });

  it("rejects an unknown row id", () => {
    const table = makeThreeByThree();

    expect(() => removeRowFromTable(table, "missing")).toThrow(
      "Table row not found",
    );
  });
});

describe("removeColumnFromTable", () => {
  it("removes the column and returns exactly its cell ids", () => {
    const table = makeThreeByThree();
    const columnCells = table.cells.filter(
      (cell) => cell.columnId === table.columns[0].id,
    );
    const result = removeColumnFromTable(table, table.columns[0].id);

    expect(result.removedCellIds).toEqual(columnCells.map((cell) => cell.id));
    expect(result.table.columns.map((column) => column.id)).toEqual([
      table.columns[1].id,
      table.columns[2].id,
    ]);
    expect(result.table.cells).toHaveLength(6);
    expect(assertValidTableData(result.table)).toBe(result.table);
  });

  it("refuses to remove the last column", () => {
    const table = createTableData({
      rowCount: 2,
      columnCount: 1,
      randomizer: makeRandomizer("new"),
    });

    expect(() => removeColumnFromTable(table, table.columns[0].id)).toThrow(
      "last column",
    );
  });

  it("rejects an unknown column id", () => {
    const table = makeThreeByThree();

    expect(() => removeColumnFromTable(table, "missing")).toThrow(
      "Table column not found",
    );
  });
});

describe("moveRowInTable", () => {
  it("reorders only the rows array; cells and their ids stay untouched", () => {
    const table = makeThreeByThree();
    const result = moveRowInTable(table, table.rows[2].id, 0);

    expect(result.rows.map((row) => row.id)).toEqual([
      table.rows[2].id,
      table.rows[0].id,
      table.rows[1].id,
    ]);
    expect(result.rows.map((row) => row.height)).toEqual([25, 100, 50]);
    expect(result.columns).toBe(table.columns);
    expect(result.cells).toBe(table.cells);
    expect(assertValidTableData(result)).toBe(result);
  });

  it("moves forward and keeps the other rows in order", () => {
    const table = makeThreeByThree();
    const result = moveRowInTable(table, table.rows[0].id, 2);

    expect(result.rows.map((row) => row.id)).toEqual([
      table.rows[1].id,
      table.rows[2].id,
      table.rows[0].id,
    ]);
  });

  it("returns the input unchanged for a no-op move", () => {
    const table = makeThreeByThree();

    expect(moveRowInTable(table, table.rows[1].id, 1)).toBe(table);
  });

  it("rejects unknown rows and invalid target indexes", () => {
    const table = makeThreeByThree();

    expect(() => moveRowInTable(table, "missing", 0)).toThrow(
      "Table row not found",
    );
    expect(() => moveRowInTable(table, table.rows[0].id, 3)).toThrow(
      "target index",
    );
    expect(() => moveRowInTable(table, table.rows[0].id, -1)).toThrow(
      "target index",
    );
    expect(() => moveRowInTable(table, table.rows[0].id, 0.5)).toThrow(
      "target index",
    );
  });
});

describe("moveColumnInTable", () => {
  it("reorders only the columns array; cells stay untouched", () => {
    const table = makeThreeByThree();
    const result = moveColumnInTable(table, table.columns[2].id, 0);

    expect(result.columns.map((column) => column.id)).toEqual([
      table.columns[2].id,
      table.columns[0].id,
      table.columns[1].id,
    ]);
    expect(result.columns.map((column) => column.width)).toEqual([40, 80, 120]);
    expect(result.rows).toBe(table.rows);
    expect(result.cells).toBe(table.cells);
    expect(assertValidTableData(result)).toBe(result);
  });

  it("rejects unknown columns and invalid target indexes", () => {
    const table = makeThreeByThree();

    expect(() => moveColumnInTable(table, "missing", 0)).toThrow(
      "Table column not found",
    );
    expect(() => moveColumnInTable(table, table.columns[0].id, 3)).toThrow(
      "target index",
    );
  });
});

describe("resizeRowInTable", () => {
  it("changes one row's height and leaves the others alone", () => {
    const table = makeThreeByThree();
    const result = resizeRowInTable(table, table.rows[1].id, 75);

    expect(result.rows.map((row) => row.height)).toEqual([100, 75, 25]);
    expect(result.columns).toBe(table.columns);
    expect(result.cells).toBe(table.cells);
    expect(assertValidTableData(result)).toBe(result);
  });

  it("clamps up to minHeight and honors larger requests", () => {
    const table = makeThreeByThree();
    const rowId = table.rows[0].id;

    expect(
      resizeRowInTable(table, rowId, 5, { minHeight: 24 }).rows[0].height,
    ).toBe(24);
    expect(
      resizeRowInTable(table, rowId, 80, { minHeight: 24 }).rows[0].height,
    ).toBe(80);
  });

  it("rejects non-positive and non-finite sizes and minima", () => {
    const table = makeThreeByThree();
    const rowId = table.rows[0].id;

    expect(() => resizeRowInTable(table, rowId, 0)).toThrow("row height");
    expect(() => resizeRowInTable(table, rowId, -10)).toThrow("row height");
    expect(() => resizeRowInTable(table, rowId, Number.NaN)).toThrow(
      "row height",
    );
    expect(() => resizeRowInTable(table, rowId, 50, { minHeight: 0 })).toThrow(
      "minimum row height",
    );
    expect(() => resizeRowInTable(table, "missing", 50)).toThrow(
      "Table row not found",
    );
  });
});

describe("resizeColumnInTable", () => {
  it("changes one column's width and leaves the others alone", () => {
    const table = makeThreeByThree();
    const result = resizeColumnInTable(table, table.columns[2].id, 60);

    expect(result.columns.map((column) => column.width)).toEqual([80, 120, 60]);
    expect(result.rows).toBe(table.rows);
    expect(result.cells).toBe(table.cells);
    expect(assertValidTableData(result)).toBe(result);
  });

  it("clamps up to minWidth and rejects invalid input", () => {
    const table = makeThreeByThree();
    const columnId = table.columns[1].id;

    expect(
      resizeColumnInTable(table, columnId, 10, { minWidth: 24 }).columns[1]
        .width,
    ).toBe(24);
    expect(() => resizeColumnInTable(table, columnId, 0)).toThrow(
      "column width",
    );
    expect(() =>
      resizeColumnInTable(table, columnId, 50, { minWidth: -1 }),
    ).toThrow("minimum column width");
    expect(() => resizeColumnInTable(table, "missing", 50)).toThrow(
      "Table column not found",
    );
  });
});

describe("table structure commands preserve table styles", () => {
  const commands: readonly {
    name: string;
    apply: (table: TableDataV1) => TableDataV1;
  }[] = [
    {
      name: "insert row",
      apply: (table) =>
        insertRowInTable(table, 1, { randomizer: makeRandomizer("new") }),
    },
    {
      name: "insert column",
      apply: (table) =>
        insertColumnInTable(table, 1, { randomizer: makeRandomizer("new") }),
    },
    {
      name: "move row",
      apply: (table) => moveRowInTable(table, table.rows[0].id, 2),
    },
    {
      name: "move column",
      apply: (table) => moveColumnInTable(table, table.columns[0].id, 2),
    },
    {
      name: "resize row",
      apply: (table) => resizeRowInTable(table, table.rows[0].id, 150),
    },
    {
      name: "resize column",
      apply: (table) => resizeColumnInTable(table, table.columns[0].id, 130),
    },
  ];

  for (const { name, apply } of commands) {
    it(`keeps background, border, and grid styles after ${name}`, () => {
      const table: TableDataV1 = {
        ...makeThreeByThree(),
        style: {
          backgroundColor: "#ff0000",
          borderColor: "#00ff00",
          borderWidth: 4,
          borderStyle: "dashed",
          gridColor: "#0000ff",
          gridWidth: 2,
          gridStyle: "dotted",
          opacity: 75,
        },
      };

      const result = apply(table);

      expect(result.style).toBe(table.style);
      expect(assertValidTableData(result)).toBe(result);
    });
  }
});

describe("getMemberTranslationsForRows", () => {
  it("shifts later rows up when the first row is removed", () => {
    const table = makeThreeByThree();
    const { table: next } = removeRowFromTable(table, table.rows[0].id);
    const translations = getMemberTranslationsForRows(table, next);

    expect(translations.size).toBe(2);
    expect(translations.get(table.rows[1].id)).toEqual({ dx: 0, dy: -100 });
    expect(translations.get(table.rows[2].id)).toEqual({ dx: 0, dy: -100 });
  });

  it("shifts only following rows when a middle row is removed", () => {
    const table = makeThreeByThree();
    const { table: next } = removeRowFromTable(table, table.rows[1].id);
    const translations = getMemberTranslationsForRows(table, next);

    expect(translations.get(table.rows[0].id)).toEqual({ dx: 0, dy: 0 });
    expect(translations.get(table.rows[2].id)).toEqual({ dx: 0, dy: -50 });
  });

  it("shifts following rows down after an insertion above them", () => {
    const table = makeThreeByThree();
    const next = insertRowInTable(table, 1, {
      randomizer: makeRandomizer("new"),
    });
    const translations = getMemberTranslationsForRows(table, next);

    // the new row has no members and gets no entry
    expect(translations.size).toBe(3);
    expect(translations.get(table.rows[0].id)).toEqual({ dx: 0, dy: 0 });
    expect(translations.get(table.rows[1].id)).toEqual({ dx: 0, dy: 100 });
    expect(translations.get(table.rows[2].id)).toEqual({ dx: 0, dy: 100 });
  });

  it("follows a moved row and pushes the rows it passes", () => {
    const table = makeThreeByThree();
    const next = moveRowInTable(table, table.rows[2].id, 0);
    const translations = getMemberTranslationsForRows(table, next);

    expect(translations.get(table.rows[0].id)).toEqual({ dx: 0, dy: 25 });
    expect(translations.get(table.rows[1].id)).toEqual({ dx: 0, dy: 25 });
    expect(translations.get(table.rows[2].id)).toEqual({ dx: 0, dy: -150 });
  });

  it("keeps the resized row in place and shifts the rows after it", () => {
    const table = makeThreeByThree();
    const next = resizeRowInTable(table, table.rows[0].id, 150);
    const translations = getMemberTranslationsForRows(table, next);

    expect(translations.get(table.rows[0].id)).toEqual({ dx: 0, dy: 0 });
    expect(translations.get(table.rows[1].id)).toEqual({ dx: 0, dy: 50 });
    expect(translations.get(table.rows[2].id)).toEqual({ dx: 0, dy: 50 });
  });
});

describe("getMemberTranslationsForColumns", () => {
  it("follows a moved column and pushes the columns it passes", () => {
    const table = makeThreeByThree();
    const next = moveColumnInTable(table, table.columns[2].id, 0);
    const translations = getMemberTranslationsForColumns(table, next);

    expect(translations.get(table.columns[0].id)).toEqual({ dx: 40, dy: 0 });
    expect(translations.get(table.columns[1].id)).toEqual({ dx: 40, dy: 0 });
    expect(translations.get(table.columns[2].id)).toEqual({ dx: -200, dy: 0 });
  });

  it("shifts later columns left when the first column is removed", () => {
    const table = makeThreeByThree();
    const { table: next } = removeColumnFromTable(table, table.columns[0].id);
    const translations = getMemberTranslationsForColumns(table, next);

    expect(translations.size).toBe(2);
    expect(translations.get(table.columns[1].id)).toEqual({ dx: -80, dy: 0 });
    expect(translations.get(table.columns[2].id)).toEqual({ dx: -80, dy: 0 });
  });

  it("keeps the resized column in place and shifts the columns after it", () => {
    const table = makeThreeByThree();
    const next = resizeColumnInTable(table, table.columns[0].id, 130);
    const translations = getMemberTranslationsForColumns(table, next);

    expect(translations.get(table.columns[0].id)).toEqual({ dx: 0, dy: 0 });
    expect(translations.get(table.columns[1].id)).toEqual({ dx: 50, dy: 0 });
    expect(translations.get(table.columns[2].id)).toEqual({ dx: 50, dy: 0 });
  });
});

describe("table structure commands preserve cell geometry", () => {
  it("keeps every intersection addressable after a full command sequence", () => {
    const table = makeThreeByThree();
    // one id source for the whole sequence, so ids stay unique across commands
    const randomizer = makeRandomizer("seq");
    const inserted = insertRowInTable(
      insertColumnInTable(table, 0, { randomizer }),
      0,
      { randomizer },
    );
    const { table: removed } = removeRowFromTable(
      inserted,
      inserted.rows[3].id,
    );
    const moved = moveColumnInTable(removed, removed.columns[2].id, 1);
    const resized = resizeColumnInTable(moved, moved.columns[0].id, 90, {
      minWidth: 24,
    });

    // every (row, column) intersection has exactly one cell throughout
    for (const row of resized.rows) {
      for (const column of resized.columns) {
        expect(
          resized.cells.filter(
            (cell) => cell.rowId === row.id && cell.columnId === column.id,
          ),
        ).toHaveLength(1);
      }
    }
    expect(cellOf(resized, 0, 0)).toBeDefined();
    expect(assertValidTableData(resized)).toBe(resized);
  });
});
