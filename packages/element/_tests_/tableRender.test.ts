import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";
import { THEME } from "@excalidraw/common";

import type { Radians } from "@excalidraw/math";

import type { StaticCanvasAppState } from "@excalidraw/excalidraw/types";

import { newTableElement } from "../src/newElement";
import { newElementWith, type ElementUpdate } from "../src/mutateElement";
import { getContainingFrame } from "../src/frame";
import { getTableCellAtPoint } from "../src/tableStruct";
import {
  drawTableGridOnCanvas,
  getTableCellFillColor,
  getTableTransparentHoles,
  isTableCellTransparent,
  isTableHeaderRowCell,
  resolveTableColor,
} from "../src/tableRender";
import { getTextVerticalOffset } from "../src/renderElement";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  FractionalIndex,
} from "../src/types";

const withIndex = <T extends ExcalidrawElement>(element: T, index: string): T =>
  newElementWith(element, {
    index: index as FractionalIndex,
  } as ElementUpdate<T>);

const toMap = (elements: ExcalidrawElement[]) =>
  new Map(elements.map((element) => [element.id, element]));

const tableCellRef = (
  table: ExcalidrawTableElement,
  cellId: string,
  role: "content" | "backgroundText" = "content",
) => ({ kind: "tableCell" as const, elementId: table.id, cellId, role });

/** 2x2 table (200 x 150): row heights [100, 50], column widths [80, 120]. */
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

describe("getTableCellAtPoint", () => {
  it("locates cells of a non-uniform grid", () => {
    const table = createNonUniformTable();
    const cellAt = (row: number, column: number) =>
      table.table.cells[row * 2 + column].id;

    expect(getTableCellAtPoint(table, 40, 50)).toBe(cellAt(0, 0));
    expect(getTableCellAtPoint(table, 100, 50)).toBe(cellAt(0, 1));
    expect(getTableCellAtPoint(table, 40, 120)).toBe(cellAt(1, 0));
    expect(getTableCellAtPoint(table, 100, 120)).toBe(cellAt(1, 1));
  });

  it("returns null for points outside the table", () => {
    const table = createNonUniformTable();

    expect(getTableCellAtPoint(table, -1, 50)).toBe(null);
    expect(getTableCellAtPoint(table, 50, -1)).toBe(null);
    // right and bottom outer edges are outside (half-open geometry)
    expect(getTableCellAtPoint(table, 200, 50)).toBe(null);
    expect(getTableCellAtPoint(table, 40, 150)).toBe(null);
    expect(getTableCellAtPoint(table, 300, 300)).toBe(null);
  });

  it("ignores the angle: tables never rotate", () => {
    const table = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      angle: (Math.PI / 4) as Radians,
    });

    expect(table.angle).toBe(0);
    // hit-testing maps scene points straight onto the grid, whatever an
    // incoming angle claimed
    expect(getTableCellAtPoint(table, 0, 0)).not.toBe(null);
    expect(getTableCellAtPoint(table, table.width, table.height)).toBe(null);
  });
});

describe("drawTableGridOnCanvas", () => {
  const createMockContext = () => {
    const context = {
      fillRect: vi.fn(),
      fill: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      fillStyle: undefined as unknown,
    } as unknown as CanvasRenderingContext2D;
    return context;
  };

  it("draws colored cells and grid lines at non-uniform offsets", () => {
    const element = createNonUniformTable();
    const cells = element.table.cells.map((cell, index) => ({
      ...cell,
      style: index === 0 || index === 3 ? { backgroundColor: "#ff0000" } : {},
    }));
    const table = newElementWith(element, {
      table: { ...element.table, cells: cells.reverse() },
    });
    const context = createMockContext();
    const fillRects: Array<[unknown, number, number, number, number]> = [];
    vi.mocked(context.fillRect).mockImplementation((x, y, width, height) => {
      fillRects.push([context.fillStyle, x, y, width, height]);
    });

    drawTableGridOnCanvas(table, context, {
      theme: THEME.LIGHT,
      zoom: { value: 1 },
    } as StaticCanvasAppState);

    // two explicit red cells plus the header band fill on the first row's
    // remaining cell; the second row's unfilled cell lets the body show
    // through
    expect(fillRects).toEqual([
      ["#ff0000", 80, 100, 120, 50],
      ["#F5F6F7", 80, 0, 120, 100],
      ["#ff0000", 0, 0, 80, 100],
    ]);
    expect(context.moveTo).toHaveBeenNthCalledWith(1, 80, 0);
    expect(context.lineTo).toHaveBeenNthCalledWith(1, 80, 150);
    expect(context.moveTo).toHaveBeenNthCalledWith(2, 0, 100);
    expect(context.lineTo).toHaveBeenNthCalledWith(2, 200, 100);
  });

  it("paints a white rounded body, clips cell fills to it, and strokes a rounded border", () => {
    const table = createNonUniformTable();
    const context = createMockContext();
    let bodyFill: unknown;
    vi.mocked(context.fill).mockImplementation(() => {
      bodyFill = context.fillStyle;
    });

    drawTableGridOnCanvas(table, context, {
      theme: THEME.LIGHT,
      zoom: { value: 1 },
    } as StaticCanvasAppState);

    expect(bodyFill).toBe("#ffffff");
    // body fill path + border stroke path
    expect(context.roundRect).toHaveBeenCalledTimes(2);
    expect(context.roundRect).toHaveBeenNthCalledWith(1, 0, 0, 200, 150, 6);
    expect(context.roundRect).toHaveBeenNthCalledWith(2, 0, 0, 200, 150, 6);
    expect(context.clip).toHaveBeenCalledTimes(1);
    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.restore).toHaveBeenCalledTimes(1);
    // the border follows the rounded path, never a plain rect
    expect(context.strokeRect).not.toHaveBeenCalled();
    // header band fills the whole first row by default
    expect(context.fillRect).toHaveBeenCalledTimes(2);
  });

  it("falls back to plain rect paths when roundRect is unavailable", () => {
    const table = createNonUniformTable();
    const context = createMockContext();
    (context as { roundRect?: unknown }).roundRect = undefined;

    drawTableGridOnCanvas(table, context, {
      theme: THEME.LIGHT,
      zoom: { value: 1 },
    } as StaticCanvasAppState);

    expect(context.rect).toHaveBeenCalledTimes(2);
    expect(context.rect).toHaveBeenNthCalledWith(1, 0, 0, 200, 150);
    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it("resolves body and header fills per theme", () => {
    const table = createNonUniformTable();
    const context = createMockContext();
    let bodyFill: unknown;
    vi.mocked(context.fill).mockImplementation(() => {
      bodyFill = context.fillStyle;
    });
    const fillRects: Array<[unknown, number, number, number, number]> = [];
    vi.mocked(context.fillRect).mockImplementation((x, y, width, height) => {
      fillRects.push([context.fillStyle, x, y, width, height]);
    });

    drawTableGridOnCanvas(table, context, {
      theme: THEME.DARK,
      zoom: { value: 1 },
    } as StaticCanvasAppState);

    expect(bodyFill).toBe("#262626");
    expect(fillRects).toEqual([
      ["#2A2B30", 0, 0, 80, 100],
      ["#2A2B30", 80, 0, 120, 100],
    ]);
  });

  it("punches transparent cells out of the body base with an even-odd fill", () => {
    const element = createNonUniformTable();
    const cells = element.table.cells.map((cell, index) =>
      index === 3
        ? { ...cell, style: { backgroundColor: "transparent" } }
        : cell,
    );
    const table = newElementWith(element, {
      table: { ...element.table, cells },
    });
    const context = createMockContext();
    let bodyFill: unknown;
    let fillRule: unknown;
    vi.mocked(context.fill).mockImplementation((...args: unknown[]) => {
      bodyFill = context.fillStyle;
      fillRule = args[0];
    });
    const fillRects: Array<[unknown, number, number, number, number]> = [];
    vi.mocked(context.fillRect).mockImplementation((x, y, width, height) => {
      fillRects.push([context.fillStyle, x, y, width, height]);
    });

    drawTableGridOnCanvas(table, context, {
      theme: THEME.LIGHT,
      zoom: { value: 1 },
    } as StaticCanvasAppState);

    expect(bodyFill).toBe("#ffffff");
    expect(fillRule).toBe("evenodd");
    // the transparent cell (second row, second column) is cut out of the
    // body path
    expect(context.rect).toHaveBeenCalledTimes(1);
    expect(context.rect).toHaveBeenCalledWith(80, 100, 120, 50);
    // and paints no fill of its own — only the header band cells fill
    expect(fillRects).toEqual([
      ["#F5F6F7", 0, 0, 80, 100],
      ["#F5F6F7", 80, 0, 120, 100],
    ]);
  });

  it("keeps the body path plain when nothing is transparent", () => {
    const table = createNonUniformTable();
    const context = createMockContext();
    let fillRule: unknown;
    vi.mocked(context.fill).mockImplementation((...args: unknown[]) => {
      fillRule = args[0];
    });

    drawTableGridOnCanvas(table, context, {
      theme: THEME.LIGHT,
      zoom: { value: 1 },
    } as StaticCanvasAppState);

    expect(fillRule).toBe("nonzero");
    expect(context.rect).not.toHaveBeenCalled();
  });

  it("strokes the border and the grid with their own colors, transparent included", () => {
    const element = createNonUniformTable();
    const table = newElementWith(element, {
      table: {
        ...element.table,
        style: { borderColor: "transparent", gridColor: "#123456" },
      },
    });
    const context = createMockContext();
    const strokes: unknown[] = [];
    vi.mocked(context.stroke).mockImplementation(() => {
      strokes.push(context.strokeStyle);
    });

    drawTableGridOnCanvas(table, context, {
      theme: THEME.LIGHT,
      zoom: { value: 1 },
    } as StaticCanvasAppState);

    // grid first, then the border
    expect(strokes).toEqual(["#123456", "transparent"]);
  });
});

describe("resolveTableColor", () => {
  it("resolves the header token per theme", () => {
    expect(resolveTableColor("token:header", false)).toBe("#F5F6F7");
    expect(resolveTableColor("token:header", true)).toBe("#2A2B30");
    expect(resolveTableColor("token:surface", false)).toBe("#ffffff");
    expect(resolveTableColor("token:surface", true)).toBe("#262626");
  });
});

describe("getTableCellFillColor", () => {
  const withTable = (
    element: ExcalidrawTableElement,
    overrides?: {
      cells?: ExcalidrawTableElement["table"]["cells"];
      rows?: ExcalidrawTableElement["table"]["rows"];
      columns?: ExcalidrawTableElement["table"]["columns"];
      style?: ExcalidrawTableElement["table"]["style"];
    },
  ) =>
    newElementWith(element, {
      table: {
        ...element.table,
        ...(overrides?.cells && { cells: overrides.cells }),
        ...(overrides?.rows && { rows: overrides.rows }),
        ...(overrides?.columns && { columns: overrides.columns }),
        ...(overrides?.style && { style: overrides.style }),
      },
    });

  const firstRowCellOf = (table: ExcalidrawTableElement) =>
    table.table.cells.find(
      (cell) =>
        cell.rowId === table.table.rows[0].id &&
        cell.columnId === table.table.columns[0].id,
    )!;

  it("fills the first row with the header band by default", () => {
    const table = createNonUniformTable();
    const [firstRow, secondRow] = table.table.rows;
    const firstRowCell = table.table.cells.find(
      (cell) => cell.rowId === firstRow.id,
    )!;
    const secondRowCell = table.table.cells.find(
      (cell) => cell.rowId === secondRow.id,
    )!;

    expect(getTableCellFillColor(firstRowCell, false, table.table)).toBe(
      "#F5F6F7",
    );
    expect(getTableCellFillColor(firstRowCell, true, table.table)).toBe(
      "#2A2B30",
    );
    // outside the band the body base paints the cell instead
    expect(getTableCellFillColor(secondRowCell, false, table.table)).toBe(null);
  });

  it("paints no band when the header is switched off", () => {
    const table = withTable(createNonUniformTable(), {
      style: { header: false },
    });
    const firstRowCell = firstRowCellOf(table);

    expect(isTableHeaderRowCell(table.table, firstRowCell)).toBe(false);
    expect(getTableCellFillColor(firstRowCell, false, table.table)).toBe(null);
  });

  it("lets explicit cell, row, column, and table backgrounds override the band", () => {
    const base = createNonUniformTable();
    const target = firstRowCellOf(base);

    const byCell = withTable(base, {
      cells: base.table.cells.map((cell) =>
        cell.id === target.id
          ? { ...cell, style: { backgroundColor: "#111111" } }
          : cell,
      ),
    });
    expect(
      getTableCellFillColor(firstRowCellOf(byCell), false, byCell.table),
    ).toBe("#111111");

    const byRow = withTable(base, {
      rows: base.table.rows.map((row, index) =>
        index === 0 ? { ...row, style: { backgroundColor: "#222222" } } : row,
      ),
    });
    expect(
      getTableCellFillColor(firstRowCellOf(byRow), false, byRow.table),
    ).toBe("#222222");

    const byColumn = withTable(base, {
      columns: base.table.columns.map((column, index) =>
        index === 0
          ? { ...column, style: { backgroundColor: "#333333" } }
          : column,
      ),
    });
    expect(
      getTableCellFillColor(firstRowCellOf(byColumn), false, byColumn.table),
    ).toBe("#333333");

    const byTable = withTable(base, { style: { backgroundColor: "#444444" } });
    expect(
      getTableCellFillColor(firstRowCellOf(byTable), false, byTable.table),
    ).toBe("#444444");
  });

  it("emits no rect for cells resolving to the body base color", () => {
    const base = createNonUniformTable();
    const cells = base.table.cells.map((cell, index) =>
      index === 3
        ? { ...cell, style: { backgroundColor: "token:surface" } }
        : cell,
    );
    const table = withTable(base, { cells });

    expect(getTableCellFillColor(cells[3], false, table.table)).toBe(null);
    expect(getTableCellFillColor(cells[3], true, table.table)).toBe(null);
  });

  it("keeps the band fill on a merge anchored in the first row", () => {
    const base = createNonUniformTable();
    const anchor = base.table.cells[0];
    const covered = base.table.cells.find(
      (cell) =>
        cell.rowId === base.table.rows[1].id &&
        cell.columnId === anchor.columnId,
    )!;
    const cells = base.table.cells.map((cell) => {
      if (cell.id === anchor.id) {
        return { ...cell, rowSpan: 2 };
      }
      if (cell.id === covered.id) {
        return { ...cell, mergedInto: anchor.id };
      }
      return cell;
    });
    const table = withTable(base, { cells });
    const mergedAnchor = table.table.cells.find(
      (cell) => cell.id === anchor.id,
    )!;

    expect(isTableHeaderRowCell(table.table, mergedAnchor)).toBe(true);
    expect(getTableCellFillColor(mergedAnchor, false, table.table)).toBe(
      "#F5F6F7",
    );
  });
});

describe("isTableCellTransparent", () => {
  const withTable = (
    element: ExcalidrawTableElement,
    overrides: {
      cells?: ExcalidrawTableElement["table"]["cells"];
      rows?: ExcalidrawTableElement["table"]["rows"];
      columns?: ExcalidrawTableElement["table"]["columns"];
      style?: ExcalidrawTableElement["table"]["style"];
    },
  ) =>
    newElementWith(element, {
      table: { ...element.table, ...overrides },
    });

  it("resolves transparency along the cell → row → column → table chain", () => {
    const base = createNonUniformTable();

    // a silent chain is not transparent — the body base paints the cell
    for (const cell of base.table.cells) {
      expect(isTableCellTransparent(base.table, cell)).toBe(false);
    }

    const byCell = withTable(base, {
      cells: base.table.cells.map((cell, index) =>
        index === 3
          ? { ...cell, style: { backgroundColor: "transparent" } }
          : cell,
      ),
    });
    expect(isTableCellTransparent(byCell.table, byCell.table.cells[3])).toBe(
      true,
    );
    expect(isTableCellTransparent(byCell.table, byCell.table.cells[0])).toBe(
      false,
    );

    const byRow = withTable(base, {
      rows: base.table.rows.map((row, index) =>
        index === 1
          ? { ...row, style: { backgroundColor: "transparent" } }
          : row,
      ),
    });
    expect(isTableCellTransparent(byRow.table, byRow.table.cells[2])).toBe(
      true,
    );
    expect(isTableCellTransparent(byRow.table, byRow.table.cells[0])).toBe(
      false,
    );

    const byColumn = withTable(base, {
      columns: base.table.columns.map((column, index) =>
        index === 0
          ? { ...column, style: { backgroundColor: "transparent" } }
          : column,
      ),
    });
    expect(
      isTableCellTransparent(byColumn.table, byColumn.table.cells[0]),
    ).toBe(true);
    expect(
      isTableCellTransparent(byColumn.table, byColumn.table.cells[1]),
    ).toBe(false);

    const byTable = withTable(base, {
      style: { backgroundColor: "transparent" },
    });
    for (const cell of byTable.table.cells) {
      expect(isTableCellTransparent(byTable.table, cell)).toBe(true);
    }

    // an explicit cell color wins over a transparent row
    const cellOverRow = withTable(byRow, {
      cells: byRow.table.cells.map((cell, index) =>
        index === 2 ? { ...cell, style: { backgroundColor: "#123456" } } : cell,
      ),
    });
    expect(
      isTableCellTransparent(cellOverRow.table, cellOverRow.table.cells[2]),
    ).toBe(false);
  });

  it("turns an explicitly transparent header cell into a hole, band or not", () => {
    const base = createNonUniformTable();
    const cells = base.table.cells.map((cell, index) =>
      index === 0
        ? { ...cell, style: { backgroundColor: "transparent" } }
        : cell,
    );
    const table = withTable(base, { cells });

    expect(isTableCellTransparent(table.table, table.table.cells[0])).toBe(
      true,
    );
    expect(
      getTableCellFillColor(table.table.cells[0], false, table.table),
    ).toBe(null);
  });
});

describe("getTableTransparentHoles", () => {
  it("is empty when nothing resolves transparent", () => {
    const table = createNonUniformTable();
    expect(getTableTransparentHoles(table.table)).toEqual([]);
  });

  it("spans the whole merge when the anchor is transparent", () => {
    const base = createNonUniformTable();
    const anchor = base.table.cells[0];
    const covered = base.table.cells.find(
      (cell) =>
        cell.rowId === base.table.rows[1].id &&
        cell.columnId === anchor.columnId,
    )!;
    const cells = base.table.cells.map((cell) => {
      if (cell.id === anchor.id) {
        return {
          ...cell,
          rowSpan: 2,
          style: { backgroundColor: "transparent" },
        };
      }
      if (cell.id === covered.id) {
        return { ...cell, mergedInto: anchor.id };
      }
      return cell;
    });
    const table = newElementWith(base, {
      table: { ...base.table, cells },
    });

    expect(getTableTransparentHoles(table.table)).toEqual([
      { x: 0, y: 0, width: 80, height: 150 },
    ]);
  });
});

describe("table background text alignment", () => {
  it("computes top, middle, and bottom offsets inside a cell", () => {
    expect(getTextVerticalOffset("top", 100, 1, 20)).toBe(0);
    expect(getTextVerticalOffset("middle", 100, 1, 20)).toBe(40);
    expect(getTextVerticalOffset("bottom", 100, 1, 20)).toBe(80);
    // Content taller than the cell must stay anchored instead of going above
    // the cell's top edge.
    expect(getTextVerticalOffset("middle", 20, 2, 20)).toBe(0);
  });
});

describe("getContainingFrame with tableCell ancestors", () => {
  it("resolves a table directly inside a frame", () => {
    const frame = API.createElement({ type: "frame" });
    const table = API.createElement({
      type: "table",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    expect(getContainingFrame(table, toMap([frame, table]))?.id).toBe(frame.id);
  });

  it("resolves cell members to the ancestor frame", () => {
    const frame = API.createElement({ type: "frame" });
    const table = API.createElement({
      type: "table",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const content = API.createElement({
      type: "rectangle",
      containerRef: tableCellRef(table, table.table.cells[0].id),
    });

    const elementsMap = toMap([frame, table, content]);
    expect(getContainingFrame(content, elementsMap)?.id).toBe(frame.id);
  });

  it("resolves through nested tables to the outermost frame", () => {
    const frame = API.createElement({ type: "frame" });
    const outerTable = withIndex(
      API.createElement({
        type: "table",
        containerRef: { kind: "frameLike", elementId: frame.id },
      }),
      "a0",
    );
    const innerTable = withIndex(
      API.createElement({
        type: "table",
        containerRef: tableCellRef(outerTable, outerTable.table.cells[0].id),
      }),
      "a1",
    );
    const content = withIndex(
      API.createElement({
        type: "rectangle",
        containerRef: tableCellRef(innerTable, innerTable.table.cells[0].id),
      }),
      "a2",
    );

    const elementsMap = toMap([frame, outerTable, innerTable, content]);
    expect(getContainingFrame(innerTable, elementsMap)?.id).toBe(frame.id);
    expect(getContainingFrame(content, elementsMap)?.id).toBe(frame.id);
  });

  it("returns null for tables and cell members outside any frame", () => {
    const table = API.createElement({ type: "table" });
    const content = API.createElement({
      type: "rectangle",
      containerRef: tableCellRef(table, table.table.cells[0].id),
    });

    const elementsMap = toMap([table, content]);
    expect(getContainingFrame(table, elementsMap)).toBe(null);
    expect(getContainingFrame(content, elementsMap)).toBe(null);
  });

  it("keeps resolving regular frame children unchanged", () => {
    const frame = API.createElement({ type: "frame" });
    const child = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    expect(getContainingFrame(child, toMap([frame, child]))?.id).toBe(frame.id);
    expect(getContainingFrame(frame, toMap([frame]))).toBe(null);
  });
});
