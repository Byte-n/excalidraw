import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";

import { newTableElement } from "../src/newElement";
import { newElementWith, type ElementUpdate } from "../src/mutateElement";
import { Scene } from "../src/Scene";
import { assertValidContainerRefs, isTableElement } from "../src/typeChecks";
import {
  assertValidTableData,
  createTableData,
  evenlySplitTableSize,
  getTableCellBounds,
  getTableColumnOffset,
  getTableHeight,
  getTableRowOffset,
  getTableWidth,
  normalizeTableDimensions,
  tableDefaultSizes,
} from "../src/tableStruct";
import { isBelowTableMinimumPreset } from "../src/tableScale";
import {
  getIndexedTableCellChildren,
  getIndexedTableChildren,
} from "../src/tableChildrenIndex";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  TableDataV1,
} from "../src/types";

const withIndex = <T extends ExcalidrawElement>(element: T, index: string): T =>
  newElementWith(element, {
    index: index as ExcalidrawElement["index"],
  } as ElementUpdate<T>);

/** 2x2 table with non-uniform row heights and column widths (200 x 150). */
const createNonUniformTable = () => {
  const element = newTableElement({
    type: "table",
    x: 0,
    y: 0,
    rowCount: 2,
    columnCount: 2,
  });
  const [row0, row1] = element.table.rows;
  const [column0, column1] = element.table.columns;
  return newElementWith(element, {
    table: {
      schemaVersion: 1,
      rows: [
        { id: row0.id, height: 100 },
        { id: row1.id, height: 50 },
      ],
      columns: [
        { id: column0.id, width: 80 },
        { id: column1.id, width: 120 },
      ],
      cells: element.table.cells,
    },
    width: 200,
    height: 150,
  });
};

const cellAt = (
  element: ExcalidrawTableElement,
  rowIndex: number,
  columnIndex: number,
) => element.table.cells[rowIndex * element.table.columns.length + columnIndex];

const tableCellRef = (
  table: ExcalidrawTableElement,
  cellId: string,
  role: "content" | "backgroundText",
) => ({ kind: "tableCell" as const, elementId: table.id, cellId, role });

/** Table + one content rectangle in its first cell. */
const setupTableCell = () => {
  const table = withIndex(API.createElement({ type: "table" }), "a0");
  const cellId = table.table.cells[0].id;
  const content = withIndex(
    API.createElement({
      type: "rectangle",
      containerRef: tableCellRef(table, cellId, "content"),
    }),
    "a1",
  );
  return { table, cellId, content };
};

describe("createTableData", () => {
  it("creates a default 3x3 grid with unique ids", () => {
    const table = createTableData();

    expect(table.schemaVersion).toBe(1);
    expect(table.rows).toHaveLength(3);
    expect(table.columns).toHaveLength(3);
    expect(table.cells).toHaveLength(9);

    const ids = [
      ...table.rows.map((row) => row.id),
      ...table.columns.map((column) => column.id),
      ...table.cells.map((cell) => cell.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);

    // every intersection has exactly one cell, with no style override
    for (const row of table.rows) {
      for (const column of table.columns) {
        expect(
          table.cells.filter(
            (cell) => cell.rowId === row.id && cell.columnId === column.id,
          ),
        ).toHaveLength(1);
      }
    }
    for (const cell of table.cells) {
      expect(cell.style).toEqual({});
    }
  });

  it("honors requested counts and sizes", () => {
    const table = createTableData({
      rowCount: 2,
      columnCount: 4,
      rowHeight: 30,
      columnWidth: 70,
    });

    expect(table.rows).toHaveLength(2);
    expect(table.columns).toHaveLength(4);
    expect(table.cells).toHaveLength(8);
    expect(table.rows.every((row) => row.height === 30)).toBe(true);
    expect(table.columns.every((column) => column.width === 70)).toBe(true);
  });

  it("rejects invalid counts and sizes", () => {
    expect(() => createTableData({ rowCount: 0 })).toThrow("row count");
    expect(() => createTableData({ columnCount: -1 })).toThrow("column count");
    expect(() => createTableData({ rowHeight: 0 })).toThrow("row height");
    expect(() => createTableData({ columnWidth: Number.NaN })).toThrow(
      "column width",
    );
  });
});

describe("table geometry", () => {
  it("derives width and height from the row and column sums", () => {
    const element = createNonUniformTable();

    expect(getTableWidth(element.table)).toBe(200);
    expect(getTableHeight(element.table)).toBe(150);
    expect(element.width).toBe(200);
    expect(element.height).toBe(150);
  });

  it("accumulates offsets over preceding rows and columns", () => {
    const element = createNonUniformTable();
    const table = element.table;
    const [row0, row1] = table.rows;
    const [column0, column1] = table.columns;

    expect(getTableRowOffset(table, row0.id)).toBe(0);
    expect(getTableRowOffset(table, row1.id)).toBe(100);
    expect(getTableColumnOffset(table, column0.id)).toBe(0);
    expect(getTableColumnOffset(table, column1.id)).toBe(80);
    expect(getTableRowOffset(table, "missing")).toBe(null);
    expect(getTableColumnOffset(table, "missing")).toBe(null);
  });

  it("computes cell bounds in table-local coordinates", () => {
    const element = createNonUniformTable();
    const table = element.table;

    expect(getTableCellBounds(table, cellAt(element, 0, 0).id)).toEqual({
      x: 0,
      y: 0,
      width: 80,
      height: 100,
    });
    expect(getTableCellBounds(table, cellAt(element, 0, 1).id)).toEqual({
      x: 80,
      y: 0,
      width: 120,
      height: 100,
    });
    expect(getTableCellBounds(table, cellAt(element, 1, 1).id)).toEqual({
      x: 80,
      y: 100,
      width: 120,
      height: 50,
    });
    expect(getTableCellBounds(table, "missing")).toBe(null);
  });
});

describe("assertValidTableData", () => {
  it("accepts a valid table", () => {
    const table = createTableData();
    expect(assertValidTableData(table)).toBe(table);
  });

  it("rejects malformed table payloads", () => {
    expect(() => assertValidTableData(null)).toThrow("Unsupported table data");
    expect(() => assertValidTableData({})).toThrow("Unsupported table data");
    expect(() =>
      assertValidTableData({ ...createTableData(), schemaVersion: 2 }),
    ).toThrow("Unsupported table data");
    expect(() =>
      assertValidTableData({ ...createTableData(), rows: [] }),
    ).toThrow("at least one row and one column");
  });

  it("rejects duplicate ids and non-positive dimensions", () => {
    const base = createTableData({ rowCount: 2, columnCount: 2 });

    expect(() =>
      assertValidTableData({
        ...base,
        rows: [base.rows[0], { ...base.rows[1], id: base.rows[0].id }],
      }),
    ).toThrow("Duplicate table row id");

    expect(() =>
      assertValidTableData({
        ...base,
        columns: [base.columns[0], { ...base.columns[1], width: -5 }],
      }),
    ).toThrow("Invalid table column width");

    expect(() =>
      assertValidTableData({
        ...base,
        rows: [base.rows[0], { ...base.rows[1], height: Number.NaN }],
      }),
    ).toThrow("Invalid table row height");
  });

  it("rejects duplicate cells and missing intersections", () => {
    const base = createTableData({ rowCount: 2, columnCount: 2 });
    const [row0, row1] = base.rows;
    const [column0, column1] = base.columns;
    const extraCell = {
      ...base.cells[0],
      id: "extra-cell",
      rowId: row1.id,
      columnId: column1.id,
    };

    // extra cell: its intersection is already taken
    expect(() =>
      assertValidTableData({ ...base, cells: [...base.cells, extraCell] }),
    ).toThrow("Duplicate table cell");

    // missing cell: the intersection count no longer matches
    expect(() =>
      assertValidTableData({ ...base, cells: base.cells.slice(1) }),
    ).toThrow("exactly one cell per intersection");

    // same intersection twice even with an exact cell count
    const swapped = base.cells.map((cell, index) =>
      index === 3 ? { ...cell, rowId: row0.id, columnId: column0.id } : cell,
    );
    expect(() => assertValidTableData({ ...base, cells: swapped })).toThrow(
      "Duplicate table cell",
    );
  });

  it("rejects cells referencing unknown rows or columns", () => {
    const base = createTableData();
    const cell = base.cells[0];

    expect(() =>
      assertValidTableData({
        ...base,
        cells: [
          ...base.cells.slice(1),
          { ...cell, id: cell.id, rowId: "missing-row" },
        ],
      }),
    ).toThrow("unknown row or column");

    expect(() =>
      assertValidTableData({
        ...base,
        cells: [
          ...base.cells.slice(1),
          { ...cell, id: cell.id, columnId: "missing-column" },
        ],
      }),
    ).toThrow("unknown row or column");
  });

  it("rejects unknown cell style keys and invalid values", () => {
    const base = createTableData();
    const cell = base.cells[0];

    expect(() =>
      assertValidTableData({
        ...base,
        cells: [
          { ...cell, style: { fontSize: "12px" } as Record<string, unknown> },
          ...base.cells.slice(1),
        ],
      }),
    ).toThrow(/Unsupported table cell .* style key: fontSize/);

    expect(() =>
      assertValidTableData({
        ...base,
        cells: [
          { ...cell, style: { backgroundColor: 3 } },
          ...base.cells.slice(1),
        ],
      }),
    ).toThrow(/Invalid table cell .* backgroundColor/);
  });
});

describe("table size normalization", () => {
  it("snaps bounded float drift back to the exact sums", () => {
    const element = API.createElement({ type: "table" });
    const drifted = newElementWith(element, {
      width: element.width + 1e-9,
      height: element.height - 1e-9,
    });

    const normalized = normalizeTableDimensions(drifted);
    expect(normalized.width).toBe(getTableWidth(element.table));
    expect(normalized.height).toBe(getTableHeight(element.table));
    expect(normalized).not.toBe(drifted);
  });

  it("keeps consistent elements untouched", () => {
    const element = API.createElement({ type: "table" });
    expect(normalizeTableDimensions(element)).toBe(element);
  });

  it("rejects grossly inconsistent sizes", () => {
    const element = API.createElement({ type: "table" });

    expect(() =>
      normalizeTableDimensions(newElementWith(element, { width: 100 })),
    ).toThrow("does not match its column sum");
    expect(() =>
      normalizeTableDimensions(newElementWith(element, { height: 999 })),
    ).toThrow("does not match its row sum");
  });
});

describe("drag-creation geometry", () => {
  it("splits a dragged extent evenly and keeps every id", () => {
    const table = createTableData();
    const { rows, columns } = evenlySplitTableSize(table, 300, 150);

    expect(columns.map((column) => column.width)).toEqual([100, 100, 100]);
    expect(rows.map((row) => row.height)).toEqual([50, 50, 50]);
    expect(columns.map((column) => column.id)).toEqual(
      table.columns.map((column) => column.id),
    );
    expect(rows.map((row) => row.id)).toEqual(table.rows.map((row) => row.id));
    expect(getTableWidth({ ...table, columns })).toBe(300);
    expect(getTableHeight({ ...table, rows })).toBe(150);
  });

  it("detects a drag below the interactive minimum", () => {
    const table = createTableData();
    const tiny = evenlySplitTableSize(table, 10, 8);
    const fine = evenlySplitTableSize(table, 300, 150);

    expect(isBelowTableMinimumPreset({ ...table, ...tiny })).toBe(true);
    expect(isBelowTableMinimumPreset({ ...table, ...fine })).toBe(false);
  });

  it("falls back to the default creation presets, keeping ids", () => {
    const table = createTableData({ rowHeight: 80, columnWidth: 200 });
    const { rows, columns } = tableDefaultSizes(table);

    expect(columns.map((column) => column.width)).toEqual([160, 160, 160]);
    expect(rows.map((row) => row.height)).toEqual([56, 56, 56]);
    expect(columns.map((column) => column.id)).toEqual(
      table.columns.map((column) => column.id),
    );
  });
});

describe("tableCell containerRef", () => {
  it("accepts valid content and background text refs", () => {
    const { table, content } = setupTableCell();
    const backgroundText = API.createElement({
      type: "text",
      containerRef: tableCellRef(
        table,
        table.table.cells[1].id,
        "backgroundText",
      ),
    });

    expect(() =>
      assertValidContainerRefs([table, content, backgroundText]),
    ).not.toThrow();
  });

  it("accepts a nested table and a table wrapped by a frame", () => {
    const { table, cellId } = setupTableCell();
    const nested = API.createElement({
      type: "table",
      containerRef: tableCellRef(table, cellId, "content"),
    });
    const frame = API.createElement({ type: "frame" });
    const framed = newElementWith(table, {
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    expect(() =>
      assertValidContainerRefs([frame, framed, nested]),
    ).not.toThrow();
  });

  it("rejects refs to a missing cell", () => {
    const { table, content } = setupTableCell();

    expect(() =>
      assertValidContainerRefs([
        table,
        newElementWith(content, {
          containerRef: tableCellRef(table, "missing-cell", "content"),
        }),
      ]),
    ).toThrow("Invalid table cell container reference");
  });

  it("rejects refs whose parent is not a table", () => {
    const { content } = setupTableCell();
    const frame = API.createElement({ type: "frame" });

    expect(() =>
      assertValidContainerRefs([
        frame,
        newElementWith(content, {
          containerRef: tableCellRef(
            frame as unknown as ExcalidrawTableElement,
            "whatever",
            "content",
          ),
        }),
      ]),
    ).toThrow("Invalid table cell container reference");
  });

  it("rejects background text on non-text elements", () => {
    const { table, cellId, content } = setupTableCell();

    expect(() =>
      assertValidContainerRefs([
        table,
        newElementWith(content, {
          containerRef: tableCellRef(table, cellId, "backgroundText"),
        }),
      ]),
    ).toThrow("must be a text element");
  });

  it("rejects bound text carrying a containerRef", () => {
    const { table, cellId } = setupTableCell();
    const owner = API.createElement({ type: "rectangle" });
    const boundText = API.createElement({
      type: "text",
      containerId: owner.id,
      containerRef: tableCellRef(table, cellId, "content"),
    });

    expect(() => assertValidContainerRefs([table, owner, boundText])).toThrow(
      "cannot have a containerRef",
    );
  });

  it("rejects background text that binds to a container", () => {
    const { table, cellId } = setupTableCell();
    const owner = API.createElement({ type: "rectangle" });
    const backgroundText = API.createElement({
      type: "text",
      containerId: owner.id,
      containerRef: tableCellRef(table, cellId, "backgroundText"),
    });

    expect(() =>
      assertValidContainerRefs([table, owner, backgroundText]),
    ).toThrow("cannot have a containerRef");
  });

  it("rejects a second background text in one cell", () => {
    const { table, cellId } = setupTableCell();
    const first = API.createElement({
      type: "text",
      containerRef: tableCellRef(table, cellId, "backgroundText"),
    });
    const second = API.createElement({
      type: "text",
      containerRef: tableCellRef(table, cellId, "backgroundText"),
    });

    expect(() => assertValidContainerRefs([table, first, second])).toThrow(
      "already has background text",
    );
  });

  it("rejects container cycles through table cells", () => {
    const tableA = API.createElement({ type: "table" });
    const tableB = API.createElement({ type: "table" });

    const aInB = newElementWith(tableA, {
      containerRef: tableCellRef(tableB, tableB.table.cells[0].id, "content"),
    });
    const bInA = newElementWith(tableB, {
      containerRef: tableCellRef(tableA, tableA.table.cells[0].id, "content"),
    });

    expect(() => assertValidContainerRefs([aInB, bInA])).toThrow(
      "cycle detected",
    );
  });

  it("enforces tableCell refs at scene boundaries", () => {
    const { table, content } = setupTableCell();
    const scene = new Scene([table, content]);

    expect(() =>
      scene.mutateElement(content, {
        containerRef: tableCellRef(table, "missing-cell", "content"),
      }),
    ).toThrow("Invalid table cell container reference");

    const cellId = table.table.cells[0].id;
    const first = withIndex(
      API.createElement({
        type: "text",
        containerRef: tableCellRef(table, cellId, "backgroundText"),
      }),
      "a2",
    );
    const second = withIndex(
      API.createElement({
        type: "text",
        containerRef: tableCellRef(table, cellId, "backgroundText"),
      }),
      "a3",
    );

    expect(() =>
      scene.replaceAllElements([table, content, first, second]),
    ).toThrow("already has background text");
  });
});

describe("table children index", () => {
  it("indexes cell members by table and cell, separable by role", () => {
    const { table, cellId, content } = setupTableCell();
    const otherCellId = table.table.cells[1].id;
    const backgroundText = withIndex(
      API.createElement({
        type: "text",
        containerRef: tableCellRef(table, cellId, "backgroundText"),
      }),
      "a2",
    );
    const scene = new Scene([table, content, backgroundText]);
    const elements = scene.getElementsIncludingDeleted();

    expect(getIndexedTableCellChildren(elements, table.id, cellId)).toEqual([
      content,
      backgroundText,
    ]);
    expect(
      getIndexedTableCellChildren(elements, table.id, cellId, "backgroundText"),
    ).toEqual([backgroundText]);
    expect(
      getIndexedTableCellChildren(elements, table.id, otherCellId),
    ).toEqual([]);
    expect(getIndexedTableChildren(elements, table.id)).toEqual([
      content,
      backgroundText,
    ]);
  });

  it("updates incrementally when an element changes cells", () => {
    const { table, cellId, content } = setupTableCell();
    const otherCellId = table.table.cells[1].id;
    const scene = new Scene([table, content]);

    scene.mutateElement(content, {
      containerRef: tableCellRef(table, otherCellId, "content"),
    });

    const elements = scene.getElementsIncludingDeleted();
    expect(getIndexedTableCellChildren(elements, table.id, cellId)).toEqual([]);
    expect(
      getIndexedTableCellChildren(elements, table.id, otherCellId),
    ).toEqual([content]);

    scene.mutateElement(content, { containerRef: undefined });
    expect(
      getIndexedTableCellChildren(
        scene.getElementsIncludingDeleted(),
        table.id,
        otherCellId,
      ),
    ).toEqual([]);
  });
});

describe("restore", () => {
  it("round-trips a valid table without losing structure", () => {
    const element = API.createElement({ type: "table" });
    const restored = restoreElements([element], null);

    expect(restored).toHaveLength(1);
    const table = restored[0];
    expect(isTableElement(table)).toBe(true);
    expect((table as ExcalidrawTableElement).table).toEqual(element.table);
    expect((table as ExcalidrawTableElement).width).toBe(element.width);
    expect((table as ExcalidrawTableElement).height).toBe(element.height);
  });

  it("normalizes bounded float drift on restore", () => {
    const element = API.createElement({ type: "table" });
    const drifted = newElementWith(element, {
      width: element.width + 1e-9,
    });

    const restored = restoreElements([drifted], null);
    expect((restored[0] as ExcalidrawTableElement).width).toBe(element.width);
  });

  it("rejects invalid table structure", () => {
    const element = API.createElement({ type: "table" });
    const invalidTable: TableDataV1 = {
      ...element.table,
      cells: element.table.cells.slice(1),
    };

    expect(() =>
      restoreElements(
        [{ ...element, table: invalidTable } as unknown as ExcalidrawElement],
        null,
      ),
    ).toThrow("exactly one cell per intersection");
  });

  it("rejects grossly inconsistent sizes", () => {
    const element = API.createElement({ type: "table" });

    expect(() =>
      restoreElements([newElementWith(element, { width: 100 })], null),
    ).toThrow("does not match its column sum");
  });
});
