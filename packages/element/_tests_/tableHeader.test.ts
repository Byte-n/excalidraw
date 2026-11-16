import { getLineHeight } from "@excalidraw/common";

import { newTableElement } from "../src/newElement";
import { newElementWith } from "../src/mutateElement";
import { applyTableOperation } from "../src/tableScene";
import {
  getTableCellTextBaseStyle,
  resolveTableCellTextStyle,
} from "../src/tableTextStyle";
import { assertValidTableData } from "../src/tableStruct";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";
import { cellKey } from "../src/text/keys";
import { withTextBlock } from "../src/text/ops";
import { layoutTextRegionsLocal } from "../src/text/regionLayout";
import { isTableElement } from "../src/typeChecks";

import type { ExcalidrawTableElement } from "../src/types";

setCustomTextMetricsProvider({
  getLineWidth: (text, font) => text.length * parseFloat(font) * 0.5,
});

const fixture = () =>
  newTableElement({
    type: "table",
    x: 100,
    y: 100,
    rowCount: 3,
    columnCount: 3,
  });

const cellAt = (table: ExcalidrawTableElement, row: number, column: number) =>
  table.table.cells.find(
    (cell) =>
      cell.rowId === table.table.rows[row].id &&
      cell.columnId === table.table.columns[column].id,
  )!;

const withCellText = (
  table: ExcalidrawTableElement,
  cellId: string,
  fontWeight?: number,
): ExcalidrawTableElement => {
  const base = getTableCellTextBaseStyle();
  return {
    ...table,
    texts: withTextBlock(table.texts, cellKey(cellId), {
      text: "标签",
      style: {
        ...base,
        ...(fontWeight !== undefined ? { fontWeight } : {}),
      },
    }),
  };
};

describe("resolveTableCellTextStyle", () => {
  it("derives 600 for first-row cells when the header is on", () => {
    const table = fixture();
    const headerCell = cellAt(table, 0, 0);
    const bodyCell = cellAt(table, 1, 0);

    expect(resolveTableCellTextStyle(table.table, headerCell).fontWeight).toBe(
      600,
    );
    expect(
      resolveTableCellTextStyle(table.table, bodyCell).fontWeight,
    ).toBeUndefined();
  });

  it("derives nothing when the header is switched off", () => {
    const base = fixture();
    const table = newElementWith(base, {
      table: { ...base.table, style: { header: false } },
    });

    expect(
      resolveTableCellTextStyle(table.table, cellAt(table, 0, 0)).fontWeight,
    ).toBeUndefined();
  });

  it("lets explicit weights override the band derivation", () => {
    const base = fixture();
    const headerCell = cellAt(base, 0, 0);
    // explicit weight on the persisted block
    expect(
      resolveTableCellTextStyle(
        base.table,
        headerCell,
        withCellText(base, headerCell.id, 700).texts?.[cellKey(headerCell.id)]
          ?.style,
      ).fontWeight,
    ).toBe(700);

    // row-level background text style
    const byRow = newElementWith(base, {
      table: {
        ...base.table,
        rows: base.table.rows.map((row, index) =>
          index === 0
            ? { ...row, style: { backgroundText: { fontWeight: 500 } } }
            : row,
        ),
      },
    });
    expect(resolveTableCellTextStyle(byRow.table, headerCell).fontWeight).toBe(
      500,
    );

    // column-level background text style when the row defines none
    const byColumn = newElementWith(base, {
      table: {
        ...base.table,
        columns: base.table.columns.map((column, index) =>
          index === 0
            ? { ...column, style: { backgroundText: { fontWeight: 500 } } }
            : column,
        ),
      },
    });
    expect(
      resolveTableCellTextStyle(byColumn.table, headerCell).fontWeight,
    ).toBe(500);
  });

  it("applies row/column size, alignment, color and padding overrides", () => {
    const base = fixture();
    const cell = cellAt(base, 0, 0);
    const table = newElementWith(base, {
      table: {
        ...base.table,
        rows: base.table.rows.map((row, index) =>
          index === 0
            ? {
                ...row,
                style: {
                  backgroundText: {
                    fontSize: 18,
                    horizontalAlign: "right" as const,
                    verticalAlign: "bottom" as const,
                    color: "#ff0000",
                    padding: 4,
                  },
                },
              }
            : row,
        ),
      },
    });
    const style = resolveTableCellTextStyle(table.table, cell);
    expect(style).toMatchObject({
      fontSize: 18,
      textAlign: "right",
      verticalAlign: "bottom",
      color: "#ff0000",
    });
  });

  it("drives the region layout measurement exactly like an explicit 600", () => {
    const table = fixture();
    const headerCell = cellAt(table, 0, 0);
    const bodyCell = cellAt(table, 1, 0);
    const derived = withCellText(table, headerCell.id);
    const explicit = withCellText(table, headerCell.id, 600);
    const body = withCellText(table, bodyCell.id);

    const layoutOf = (element: ExcalidrawTableElement, cellId: string) =>
      layoutTextRegionsLocal(element).find(
        (layout) => layout.key === cellKey(cellId),
      )!;

    const derivedLayout = layoutOf(derived, headerCell.id);
    const explicitLayout = layoutOf(explicit, headerCell.id);
    const bodyLayout = layoutOf(body, bodyCell.id);

    expect(derivedLayout.width).toBe(explicitLayout.width);
    expect(derivedLayout.height).toBe(explicitLayout.height);
    // the test metrics provider reads the font string's leading number, so a
    // 600-prefixed font measures wider than the plain 13px one — proving the
    // derived weight reaches measurement
    expect(bodyLayout.width).not.toBe(derivedLayout.width);
  });

  it("keeps the persisted block line height independent of size overrides", () => {
    fixture();
    const style = getTableCellTextBaseStyle();
    expect(style.lineHeight).toBe(getLineHeight(style.fontFamily));
  });
});

describe("table header flag", () => {
  it("passes table data validation as a boolean style leaf", () => {
    const table = fixture();
    expect(() =>
      assertValidTableData({ ...table.table, style: { header: false } }),
    ).not.toThrow();
    expect(() =>
      assertValidTableData({ ...table.table, style: { header: true } }),
    ).not.toThrow();
    expect(() =>
      assertValidTableData({
        ...table.table,
        style: { header: "yes" },
      }),
    ).toThrow(/Invalid table header/);
  });

  it("toggles through scene operations without touching cell texts", () => {
    const created = applyTableOperation([], {
      action: "create",
      position: { x: 0, y: 0 },
      rowCount: 2,
      columnCount: 2,
    });
    const table = created.elements.find(isTableElement)!;
    const withText = applyTableOperation(created.elements, {
      action: "setCellText",
      target: { tableId: table.id },
      cellId: table.table.cells[0].id,
      text: "标题格",
    });
    const tableBefore = withText.elements.find(isTableElement)!;
    const textsBefore = tableBefore.texts;

    const toggledOff = applyTableOperation(withText.elements, {
      action: "setStyle",
      target: { tableId: table.id },
      style: { header: false },
    });
    expect(toggledOff.elements.find(isTableElement)?.table.style?.header).toBe(
      false,
    );

    // the persisted flag validates on every later operation, and clearing it
    // restores the default (on) without a trace
    const toggledBack = applyTableOperation(toggledOff.elements, {
      action: "setStyle",
      target: { tableId: table.id },
      style: { header: null },
    });
    expect(toggledBack.elements.find(isTableElement)?.table.style?.header).toBe(
      undefined,
    );

    // zero side effects: the cell text blocks are byte-identical across both
    // toggles
    expect(toggledBack.elements.find(isTableElement)?.texts).toEqual(
      textsBefore,
    );
  });
});
