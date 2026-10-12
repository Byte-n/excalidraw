import { newTableElement, newTextElement } from "../src/newElement";
import { newElementWith } from "../src/mutateElement";
import { applyTableOperation } from "../src/tableScene";
import { getCellBackgroundTextLayout } from "../src/tableSceneGeometry";
import { resolveTableBackgroundTextFontWeight } from "../src/tableRender";
import { assertValidTableData, getTableCellBounds } from "../src/tableStruct";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";
import { isTableElement } from "../src/typeChecks";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "../src/types";

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

const backgroundText = (
  table: ExcalidrawTableElement,
  cellId: string,
  fontWeight?: number,
) => {
  const text = newTextElement({
    x: table.x,
    y: table.y,
    text: "标签",
    textAlign: "left",
    verticalAlign: "middle",
    fontSize: 13,
    autoResize: false,
    containerRef: {
      kind: "tableCell",
      elementId: table.id,
      cellId,
      role: "backgroundText",
    },
  });
  return fontWeight === undefined ? text : newElementWith(text, { fontWeight });
};

const toMap = (
  table: ExcalidrawTableElement,
  ...elements: ExcalidrawTextElement[]
): ElementsMap =>
  new Map<string, ExcalidrawElement>([
    [table.id, table],
    ...elements.map((element) => [element.id, element] as const),
  ]);

describe("resolveTableBackgroundTextFontWeight", () => {
  it("derives 600 for first-row background texts when the header is on", () => {
    const table = fixture();
    const headerText = backgroundText(table, cellAt(table, 0, 0).id);
    const bodyText = backgroundText(table, cellAt(table, 1, 0).id);
    const map = toMap(table, headerText, bodyText);

    expect(resolveTableBackgroundTextFontWeight(headerText, map)).toBe(600);
    expect(resolveTableBackgroundTextFontWeight(bodyText, map)).toBe(undefined);
  });

  it("derives nothing when the header is switched off", () => {
    const base = fixture();
    const table = newElementWith(base, {
      table: { ...base.table, style: { header: false } },
    });
    const headerText = backgroundText(table, cellAt(table, 0, 0).id);

    expect(
      resolveTableBackgroundTextFontWeight(
        headerText,
        toMap(table, headerText),
      ),
    ).toBe(undefined);
  });

  it("lets explicit weights override the band derivation", () => {
    const base = fixture();
    // explicit weight on the text element
    const ownWeight = backgroundText(base, cellAt(base, 0, 0).id, 700);
    expect(
      resolveTableBackgroundTextFontWeight(ownWeight, toMap(base, ownWeight)),
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
    const rowText = backgroundText(byRow, cellAt(byRow, 0, 0).id, 700);
    expect(
      resolveTableBackgroundTextFontWeight(rowText, toMap(byRow, rowText)),
    ).toBe(500);

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
    const columnText = backgroundText(byColumn, cellAt(byColumn, 0, 0).id);
    expect(
      resolveTableBackgroundTextFontWeight(
        columnText,
        toMap(byColumn, columnText),
      ),
    ).toBe(500);
  });

  it("leaves non-cell texts at their own weight", () => {
    const table = fixture();
    const freeText = newTextElement({ x: 0, y: 0, text: "自由" });

    expect(
      resolveTableBackgroundTextFontWeight(freeText, toMap(table, freeText)),
    ).toBe(undefined);
  });

  it("drives the layout measurement exactly like an explicit 600", () => {
    const table = fixture();
    const headerCell = cellAt(table, 0, 0);
    const derived = backgroundText(table, headerCell.id);
    const explicit = backgroundText(table, headerCell.id, 600);
    const body = backgroundText(table, cellAt(table, 1, 0).id);
    const map = toMap(table, derived, explicit, body);
    const bounds = getTableCellBounds(table.table, headerCell.id)!;
    const bodyBounds = getTableCellBounds(table.table, cellAt(table, 1, 0).id)!;

    const derivedLayout = getCellBackgroundTextLayout(
      derived,
      table,
      bounds,
      map,
    );
    const explicitLayout = getCellBackgroundTextLayout(
      explicit,
      table,
      bounds,
      map,
    );
    const bodyLayout = getCellBackgroundTextLayout(
      body,
      table,
      bodyBounds,
      map,
    );

    expect(derivedLayout.width).toBe(explicitLayout.width);
    expect(derivedLayout.height).toBe(explicitLayout.height);
    // the test metrics provider reads the font string's leading number, so a
    // 600-prefixed font measures wider than the plain 13px one — proving the
    // derived weight reaches measurement
    expect(bodyLayout.width).not.toBe(derivedLayout.width);
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
    const textBefore = withText.elements.find(
      (element) => element.type === "text",
    )!;

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

    // zero side effects: the cell text is byte-identical across both toggles
    const textAfter = toggledBack.elements.find(
      (element) => element.id === textBefore.id,
    )!;
    expect(textAfter).toEqual(textBefore);
  });
});
