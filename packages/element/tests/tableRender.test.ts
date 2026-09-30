import type { Radians } from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { THEME } from "@excalidraw/common";

import type { StaticCanvasAppState } from "@excalidraw/excalidraw/types";

import { newTableElement } from "../src/newElement";
import { newElementWith, type ElementUpdate } from "../src/mutateElement";
import { getContainingFrame } from "../src/frame";
import { getTableCellAtPoint } from "../src/tableStruct";
import { drawTableGridOnCanvas } from "../src/tableRender";

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
  it("draws colored cells and grid lines at non-uniform offsets", () => {
    const element = createNonUniformTable();
    const cells = element.table.cells.map((cell, index) => ({
      ...cell,
      style: index === 0 || index === 3 ? { backgroundColor: "#ff0000" } : {},
    }));
    const table = newElementWith(element, {
      table: { ...element.table, cells: cells.reverse() },
    });
    const context = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawTableGridOnCanvas(table, context, {
      theme: THEME.LIGHT,
      zoom: { value: 1 },
    } as StaticCanvasAppState);

    expect(context.fillRect).toHaveBeenCalledTimes(2);
    expect(context.fillRect).toHaveBeenNthCalledWith(1, 80, 100, 120, 50);
    expect(context.fillRect).toHaveBeenNthCalledWith(2, 0, 0, 80, 100);
    expect(context.moveTo).toHaveBeenNthCalledWith(1, 80, 0);
    expect(context.lineTo).toHaveBeenNthCalledWith(1, 80, 150);
    expect(context.moveTo).toHaveBeenNthCalledWith(2, 0, 100);
    expect(context.lineTo).toHaveBeenNthCalledWith(2, 200, 100);
    expect(context.strokeRect).toHaveBeenCalledWith(0, 0, 200, 150);
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
