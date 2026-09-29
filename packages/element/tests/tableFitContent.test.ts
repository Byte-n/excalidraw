import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { getFontString } from "@excalidraw/common";

import { newElementWith } from "../src/mutateElement";
import { computeTableUniformScale } from "../src/tableScale";
import { regenerateTableIds } from "../src/tableContainer";
import { assertValidTableData, createTableData } from "../src/tableStruct";
import { measureText } from "../src/textMeasurements";
import { wrapText } from "../src/textWrapping";
import {
  insertColumnInTable,
  insertRowInTable,
  resizeColumnInTable,
  resizeRowInTable,
  resetTableManualMinSizes,
  setTableSizingMode,
} from "../src/tableOps";
import {
  computeTableFitContentUpdates,
  measureTableCellContentRequirements,
  TABLE_BACKGROUND_TEXT_PADDING,
  TABLE_CELL_CONTENT_PADDING,
} from "../src/tableFitContent";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "../src/types";

const cellIdAt = (
  table: ExcalidrawTableElement,
  rowIndex: number,
  columnIndex: number,
) => table.table.cells[rowIndex * table.table.columns.length + columnIndex].id;

const cellRef = (table: ExcalidrawTableElement, cellId: string) => ({
  kind: "tableCell" as const,
  elementId: table.id,
  cellId,
  role: "content" as const,
});

/** 1x2 fitContent table at (0, 0): row [100], columns [80, 120]. */
const makeFitContentTable = (
  extra: { angle?: number } = {},
): ExcalidrawTableElement => {
  const element = API.createElement({
    type: "table",
    rowCount: 1,
    columnCount: 2,
    x: 0,
    y: 0,
    angle: extra.angle,
  });
  const sized = newElementWith(element, {
    table: {
      schemaVersion: 1 as const,
      sizingMode: "fitContent" as const,
      rows: element.table.rows.map((row) => ({
        ...row,
        height: 100,
        minHeight: 100,
      })),
      columns: element.table.columns.map((column, index) => ({
        ...column,
        width: index === 0 ? 80 : 120,
        minWidth: index === 0 ? 80 : 120,
      })),
      cells: element.table.cells,
    },
    width: 200,
    height: 100,
  });
  assertValidTableData(sized.table);
  return sized as ExcalidrawTableElement;
};

const rectIn = (
  table: ExcalidrawTableElement,
  cellId: string,
  x: number,
  y: number,
  width: number,
  height: number,
) =>
  API.createElement({
    type: "rectangle",
    x,
    y,
    width,
    height,
    containerRef: cellRef(table, cellId),
  });

describe("measureTableCellContentRequirements", () => {
  it("measures right/bottom overflow into the owning column and row only", () => {
    const table = makeFitContentTable();
    const cell0 = cellIdAt(table, 0, 0);
    // overflows right (x 60 + 50 = 110 > 80) and stays within the row height
    const rect = rectIn(table, cell0, 60, 10, 50, 30);

    const requirements = measureTableCellContentRequirements(
      [table, rect],
      table,
    );

    expect(requirements.columns.get(table.table.columns[0].id)).toBe(
      110 - 0 + TABLE_CELL_CONTENT_PADDING,
    );
    expect(requirements.columns.has(table.table.columns[1].id)).toBe(false);
    expect(requirements.rows.get(table.table.rows[0].id)).toBe(
      40 - 0 + TABLE_CELL_CONTENT_PADDING,
    );
  });

  it("never adds a requirement for left/top overflow", () => {
    const table = makeFitContentTable();
    const cell0 = cellIdAt(table, 0, 0);
    // hangs left of the table and above it; right/bottom stay inside
    const rect = rectIn(table, cell0, -30, -40, 20, 20);

    const requirements = measureTableCellContentRequirements(
      [table, rect],
      table,
    );

    expect(requirements.columns.size).toBe(0);
    expect(requirements.rows.size).toBe(0);
  });

  it("wraps background texts at the given column widths, rows only", () => {
    const table = makeFitContentTable();
    const cell0 = cellIdAt(table, 0, 0);
    const text = API.createElement({
      type: "text",
      x: 0,
      y: 0,
      text: "long enough text to wrap across several lines for sure",
      fontSize: 20,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: cell0,
        role: "backgroundText",
      },
    }) as ExcalidrawTextElement;

    const font = getFontString({ fontSize: 20, fontFamily: text.fontFamily });
    const wrapped = wrapText(
      text.text,
      font,
      80 - TABLE_BACKGROUND_TEXT_PADDING * 2,
    );
    const expected =
      measureText(wrapped, font, text.lineHeight).height +
      TABLE_BACKGROUND_TEXT_PADDING * 2;

    const requirements = measureTableCellContentRequirements(
      [table, text],
      table,
    );

    expect(requirements.columns.size).toBe(0);
    expect(requirements.rows.get(table.table.rows[0].id)).toBe(expected);
  });
});

describe("computeTableFitContentUpdates", () => {
  it("grows rows/columns to the requirements and translates later members", () => {
    const table = makeFitContentTable();
    const cell0 = cellIdAt(table, 0, 0);
    const cell1 = cellIdAt(table, 0, 1);
    // pushes column 0 to 118; the row stays (40 + padding < 100)
    const rect0 = rectIn(table, cell0, 60, 10, 50, 30);
    // a member of column 1 rides the grown offset
    const rect1 = rectIn(table, cell1, 150, 10, 20, 20);

    const fit = computeTableFitContentUpdates([table, rect0, rect1], table.id)!;
    expect(fit.changed).toBe(true);

    const tableUpdate = fit.updates.get(table.id) as {
      table?: typeof table.table;
      width?: number;
      height?: number;
    };
    expect(tableUpdate.table!.columns[0].width).toBe(118);
    expect(tableUpdate.table!.columns[1].width).toBe(120);
    expect(tableUpdate.width).toBe(238);
    expect(tableUpdate.height).toBe(100);

    // column 1's members shift right by the grown width of column 0
    const rect1Update = fit.updates.get(rect1.id) as { x?: number };
    expect(rect1Update.x).toBe(rect1.x + 38);
    // column 0's members stay (their cell origin did not move)
    expect(fit.updates.has(rect0.id)).toBe(false);
  });

  it("never shrinks: smaller content keeps the grid as-is", () => {
    const table = makeFitContentTable();
    const cell0 = cellIdAt(table, 0, 0);
    const rect = rectIn(table, cell0, 5, 5, 10, 10);

    const fit = computeTableFitContentUpdates([table, rect], table.id)!;
    expect(fit.changed).toBe(false);
    expect(fit.updates.size).toBe(0);
  });

  it("computes nested fitContent tables inside-out and includes post-fit bounds", () => {
    // parent 1x2 (rows [100], columns [80, 120]), fitContent
    const parent = makeFitContentTable();
    // child fitContent 1x1 in the parent's first cell
    const childElement = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
      x: 10,
      y: 40,
      containerRef: cellRef(parent, cellIdAt(parent, 0, 0)),
    });
    const child = newElementWith(childElement, {
      table: {
        schemaVersion: 1 as const,
        sizingMode: "fitContent" as const,
        rows: childElement.table.rows.map((row) => ({
          ...row,
          height: 30,
          minHeight: 30,
        })),
        columns: childElement.table.columns.map((column) => ({
          ...column,
          width: 40,
          minWidth: 40,
        })),
        cells: childElement.table.cells,
      },
      width: 40,
      height: 30,
    }) as ExcalidrawTableElement;
    // forces the child to 78 x 68 — the rect sits at child-local (30, 20)
    // (scene (40, 60), the child is at (10, 40)) and overflows right/bottom
    const childRect = rectIn(child, child.table.cells[0].id, 40, 60, 40, 40);
    // a parent member in column 1 rides the parent's growth
    const parentRect = rectIn(parent, cellIdAt(parent, 0, 1), 140, 10, 20, 20);

    const fit = computeTableFitContentUpdates(
      [parent, child, childRect, parentRect],
      parent.id,
    )!;
    expect(fit.changed).toBe(true);
    expect(fit.changedTableIds.has(child.id)).toBe(true);
    expect(fit.changedTableIds.has(parent.id)).toBe(true);

    // child grew to the rect's requirements
    const childUpdate = fit.updates.get(child.id) as {
      width?: number;
      height?: number;
    };
    expect(childUpdate.width).toBe(78);
    expect(childUpdate.height).toBe(68);

    // parent grew from the child's POST-fit bounds: (10 + 78 + padding) = 96
    const parentUpdate = fit.updates.get(parent.id) as {
      table?: typeof parent.table;
    };
    expect(parentUpdate.table!.columns[0].width).toBe(96);
    // parent row: (40 + 68 + padding) = 116
    expect(parentUpdate.table!.rows[0].height).toBe(116);
    // each element translated once: the parent's column-1 member shifts by 16
    const parentRectUpdate = fit.updates.get(parentRect.id) as {
      x?: number;
    };
    expect(parentRectUpdate.x).toBe(parentRect.x + 16);
  });

  it("anchors a rotated table at its unrotated top-left with rotated member deltas", () => {
    const angle = Math.PI / 2;
    const table = makeFitContentTable({ angle });
    const cell1 = cellIdAt(table, 0, 1);
    const rect0 = rectIn(table, cellIdAt(table, 0, 0), 60, 10, 50, 30);
    const rect1 = rectIn(table, cell1, 150, 10, 20, 20);

    const fit = computeTableFitContentUpdates([table, rect0, rect1], table.id)!;
    const tableUpdate = fit.updates.get(table.id) as {
      x?: number;
      y?: number;
    };
    // the rotated rect resolves to table-local (60..90, 40..90): column 0
    // grows by 18 (80 → 98); dw = 18, dh = 0, angle = π/2
    expect(tableUpdate.x).toBeCloseTo(table.x + 9 * (Math.cos(angle) - 1), 6);
    expect(tableUpdate.y).toBeCloseTo(table.y + 9 * Math.sin(angle), 6);

    // local delta (18, 0) rotates to (0, 18) in scene space
    const rect1Update = fit.updates.get(rect1.id) as {
      x?: number;
      y?: number;
    };
    expect(rect1Update.x).toBeCloseTo(rect1.x, 6);
    expect(rect1Update.y).toBeCloseTo(rect1.y + 18, 6);
  });

  it("returns null for unknown or non-table ids", () => {
    expect(computeTableFitContentUpdates([], "missing")).toBe(null);
    const table = makeFitContentTable();
    const rect = rectIn(table, cellIdAt(table, 0, 0), 0, 0, 10, 10);
    expect(computeTableFitContentUpdates([table, rect], rect.id)).toBe(null);
  });
});

describe("sizing mode and minima commands", () => {
  it("inserts rows/columns with the initial size as the fitContent minimum", () => {
    const fixed = createTableData({ rowCount: 1, columnCount: 1 });
    const fit = setTableSizingMode(
      { ...fixed, rows: fixed.rows.map((r) => ({ ...r, height: 50 })) },
      "fitContent",
    );

    const row = insertRowInTable(fit, 1);
    expect(row.rows[1].minHeight).toBe(50);
    expect(row.rows[1].height).toBe(50);

    const column = insertColumnInTable(fit, 0);
    expect(column.columns[0].minWidth).toBe(createTableData().columns[0].width);
  });

  it("rewrites the minimum on resize in fitContent mode only", () => {
    const base = createTableData({ rowCount: 1, columnCount: 1 });
    const fit = setTableSizingMode(base, "fitContent");
    const rowId = fit.rows[0].id;
    const columnId = fit.columns[0].id;

    const resized = resizeRowInTable(fit, rowId, 30);
    expect(resized.rows[0]).toEqual({ id: rowId, height: 30, minHeight: 30 });
    const resizedColumn = resizeColumnInTable(fit, columnId, 40);
    expect(resizedColumn.columns[0]).toEqual({
      id: columnId,
      width: 40,
      minWidth: 40,
    });

    // fixed mode keeps minima absent
    const fixedResize = resizeRowInTable(base, base.rows[0].id, 30);
    expect(fixedResize.rows[0]).toEqual({
      id: base.rows[0].id,
      height: 30,
    });
  });

  it("switches modes: minima initialize from sizes, then drop verbatim", () => {
    const base = createTableData({ rowCount: 2, columnCount: 2 });
    const sized = {
      ...base,
      rows: base.rows.map((row, index) => ({ ...row, height: 40 + index })),
      columns: base.columns.map((column, index) => ({
        ...column,
        width: 60 + index,
      })),
    };

    const fit = setTableSizingMode(sized, "fitContent");
    expect(fit.sizingMode).toBe("fitContent");
    expect(fit.rows.map((row) => row.minHeight)).toEqual([40, 41]);
    expect(fit.columns.map((column) => column.minWidth)).toEqual([60, 61]);
    expect(fit.rows.map((row) => row.height)).toEqual([40, 41]);

    // switching back keeps sizes and drops every minimum (and the persisted
    // mode field — `undefined` serializes away, matching fresh tables)
    const back = setTableSizingMode(fit, "fixed");
    expect(back.sizingMode).toBeUndefined();
    expect(JSON.parse(JSON.stringify(back)).sizingMode).toBeUndefined();
    expect(back.rows.map((row) => row.height)).toEqual([40, 41]);
    expect(back.rows.some((row) => "minHeight" in row)).toBe(false);
    expect(back.columns.some((column) => "minWidth" in column)).toBe(false);

    // no-op switch returns the input
    expect(setTableSizingMode(back, "fixed")).toBe(back);
  });

  it("resets manual minima to the product floors in fitContent mode", () => {
    const base = createTableData({ rowCount: 2, columnCount: 2 });
    const fit = setTableSizingMode(base, "fitContent");

    const reset = resetTableManualMinSizes(fit, {
      minHeight: 24,
      minWidth: 24,
    });
    expect(reset.rows.every((row) => row.minHeight === 24)).toBe(true);
    expect(reset.columns.every((column) => column.minWidth === 24)).toBe(true);
    expect(() =>
      resetTableManualMinSizes(base, { minHeight: 24, minWidth: 24 }),
    ).toThrow("fitContent");
  });

  it("validates the persisted sizing contract", () => {
    const base = createTableData({ rowCount: 1, columnCount: 1 });

    expect(() =>
      assertValidTableData({ ...base, sizingMode: "bogus" }),
    ).toThrow("sizing mode");
    // fitContent requires complete minima
    expect(() =>
      assertValidTableData({ ...base, sizingMode: "fitContent" }),
    ).toThrow("minHeight");
    // fixed mode rejects minima
    expect(() =>
      assertValidTableData({
        ...base,
        rows: base.rows.map((row) => ({ ...row, minHeight: 10 })),
      }),
    ).toThrow("fitContent");
    // sizes below the minima are rejected
    const fit = setTableSizingMode(base, "fitContent");
    expect(() =>
      assertValidTableData({
        ...fit,
        rows: fit.rows.map((row) => ({ ...row, height: 1 })),
      }),
    ).toThrow("below its minHeight");
  });

  it("scales the minima with the uniform scale command", () => {
    const base = createTableData({ rowCount: 1, columnCount: 1 });
    const fit = setTableSizingMode(base, "fitContent");
    const element = newElementWith(
      API.createElement({ type: "table", rowCount: 1, columnCount: 1 }),
      {
        table: fit,
        width: fit.columns[0].width,
        height: fit.rows[0].height,
      },
    ) as ExcalidrawTableElement;

    const result = computeTableUniformScale([element], element.id, 2, {
      persistTextModes: true,
    })!;
    const update = result.updates.get(element.id) as {
      table?: typeof fit;
    };
    expect(update.table!.rows[0].minHeight).toBe(fit.rows[0].minHeight! * 2);
    expect(update.table!.columns[0].minWidth).toBe(
      fit.columns[0].minWidth! * 2,
    );
  });

  it("keeps the mode and minima through id regeneration (copies)", () => {
    const base = createTableData({ rowCount: 1, columnCount: 1 });
    const fit = setTableSizingMode(base, "fitContent");

    const { table: copy } = regenerateTableIds(fit, () => "new-id");
    expect(copy.sizingMode).toBe("fitContent");
    expect(copy.rows[0].minHeight).toBe(fit.rows[0].minHeight);
    expect(copy.columns[0].minWidth).toBe(fit.columns[0].minWidth);
  });
});
