import rough from "roughjs/bin/rough";

import {
  applyDarkModeFilter,
  arrayToMap,
  toBrandedType,
  TABLE_STYLE,
} from "@excalidraw/common";
import {
  assertValidTableData,
  getTableCellFillColor,
  getTableGridSegments,
  getTableContentClipRects,
  mutateElement,
  Scene,
} from "@excalidraw/element";

import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";

import { API } from "./helpers/api";

import type { RenderableElementsMap } from "../scene/types";
import type { NormalizedZoomValue } from "../types";

import type { StaticCanvasAppState } from "../types";

type RecordedCall = { type: string; args: unknown[] };

/**
 * jsdom's canvas mock draws but doesn't reflect state back, so the tests
 * record the context calls and property assignments through a proxy.
 */
const recordContextCalls = (canvas: HTMLCanvasElement) => {
  const calls: RecordedCall[] = [];
  const context = canvas.getContext("2d")!;
  const proxy: CanvasRenderingContext2D = new Proxy(context, {
    get(target, prop: string) {
      const value = (target as any)[prop];
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          calls.push({ type: prop, args });
          return value.apply(target, args);
        };
      }
      return value;
    },
    set(target, prop: string, value) {
      calls.push({ type: `set:${prop}`, args: [value] });
      (target as any)[prop] = value;
      return true;
    },
  });
  (canvas as any).getContext = () => proxy;
  return calls;
};

const callsOf = (calls: RecordedCall[], type: string) =>
  calls.filter((call) => call.type === type).map((call) => call.args);

/** Renders the given elements into a recording canvas, like the editor does. */
const setup = (elements: NonDeletedExcalidrawElement[]) => {
  const scene = new Scene(elements, { skipValidation: true });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 500;
  const calls = recordContextCalls(canvas);
  const appState = {
    ...getDefaultAppState(),
    width: 500,
    height: 500,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX: 0,
    scrollY: 0,
  } as StaticCanvasAppState;
  const elementsMap = toBrandedType<RenderableElementsMap>(
    arrayToMap(elements),
  );

  const draw = (theme: "light" | "dark" = "light", zoom = 1) => {
    renderStaticScene({
      canvas,
      rc: rough.canvas(canvas),
      scale: 1,
      elementsMap,
      allElementsMap: scene.getNonDeletedElementsMap(),
      visibleElements: elements,
      appState: {
        ...appState,
        theme,
        zoom: { value: zoom as NormalizedZoomValue },
      },
      renderConfig: {
        imageCache: new Map(),
        renderGrid: false,
        isExporting: false,
        canvasBackgroundColor: "#fff",
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme,
      },
    });
    return calls;
  };

  return { scene, draw, calls };
};

describe("table canvas rendering", () => {
  it("resolves cell, row, column and table fills in order", () => {
    const table = API.createElement({ type: "table" }).table;
    const cell = table.cells[0];
    const styled = {
      ...table,
      style: { backgroundColor: "#111111" },
      rows: table.rows.map((row, index) =>
        index === 0 ? { ...row, style: { backgroundColor: "#222222" } } : row,
      ),
      columns: table.columns.map((column, index) =>
        index === 0
          ? { ...column, style: { backgroundColor: "#333333" } }
          : column,
      ),
    };
    expect(getTableCellFillColor(cell, false, styled)).toBe("#222222");
    expect(
      getTableCellFillColor(
        { ...cell, style: { backgroundColor: "#444444" } },
        false,
        styled,
      ),
    ).toBe("#444444");
    expect(
      getTableCellFillColor(cell, false, { ...styled, rows: table.rows }),
    ).toBe("#333333");
    expect(
      getTableCellFillColor(cell, false, {
        ...styled,
        rows: table.rows,
        columns: table.columns,
      }),
    ).toBe("#111111");
    expect(() => assertValidTableData(styled)).not.toThrow();
    expect(() =>
      assertValidTableData({ ...styled, style: { gridWidth: -1 } }),
    ).toThrow();
  });

  it("omits internal edges of a merged cell from shared grid geometry", () => {
    const table = API.createElement({ type: "table" }).table;
    const [first, second] = table.cells;
    const merged = {
      ...table,
      cells: table.cells.map((cell) =>
        cell.id === first.id
          ? { ...cell, columnSpan: 2 }
          : cell.id === second.id
          ? { ...cell, mergedInto: first.id }
          : cell,
      ),
    };
    expect(getTableGridSegments(merged)).not.toContainEqual([160, 0, 160, 56]);
    expect(getTableGridSegments(merged)).toContainEqual([160, 56, 160, 112]);
  });

  it("clips a cell member only when the visible cell or table requests it", () => {
    const table = API.createElement({ type: "table", x: 100, y: 100 });
    const cell = table.table.cells[0];
    const member = API.createElement({
      type: "rectangle",
      x: 120,
      y: 120,
      width: 250,
      height: 30,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: cell.id,
        role: "content",
      },
    });
    const elementsMap = arrayToMap([table, member]) as ElementsMap;
    expect(getTableContentClipRects(member, elementsMap)).toEqual([]);
    mutateElement(table, elementsMap, {
      table: {
        ...table.table,
        cells: table.table.cells.map((candidate) =>
          candidate.id === cell.id
            ? { ...candidate, style: { clipContent: true } }
            : candidate,
        ),
      },
    });
    expect(getTableContentClipRects(member, elementsMap)).toEqual([
      { x: 100, y: 100, width: 160, height: 56 },
    ]);
    const { draw } = setup([table, member]);
    expect(callsOf(draw(), "clip").length).toBeGreaterThan(0);
  });

  it("renders the grid without throwing and paints no default cell fills", () => {
    const table = API.createElement({ type: "table" });
    const { draw } = setup([table]);

    let calls: RecordedCall[] = [];
    expect(() => {
      calls = draw() as any;
    }).not.toThrow();

    // interior grid lines and the outer border; the only fillRect is the
    // canvas background (transparent cell default keeps the grid
    // low-contrast)
    expect(callsOf(calls, "lineTo").length).toBeGreaterThan(0);
    expect(callsOf(calls, "strokeRect").length).toBe(1);
    expect(callsOf(calls, "fillRect").length).toBe(1);
  });

  it("draws the 3x3 grid lines at the row/column boundaries", () => {
    const table = API.createElement({ type: "table" });
    const { draw } = setup([table]);
    const calls = draw();

    // line endpoints: 2 vertical (x=160, 320) + 2 horizontal (y=56, 112)
    expect(callsOf(calls, "lineTo")).toEqual(
      expect.arrayContaining([
        [160, 168],
        [320, 168],
        [480, 56],
        [480, 112],
      ]),
    );
    expect(callsOf(calls, "lineTo").length).toBe(4);
  });

  it("paints overridden cell backgrounds under the grid", () => {
    const table = API.createElement({ type: "table" });
    mutateElement(table, arrayToMap([table]) as ElementsMap, {
      table: {
        ...table.table,
        cells: table.table.cells.map((cell, index) =>
          index === 0
            ? { ...cell, style: { backgroundColor: "#ffc9c9" } }
            : cell,
        ),
      },
    });
    const { draw } = setup([table]);
    const calls = draw();

    const fills = callsOf(calls, "fillRect").filter((args) => args[2] === 160);
    expect(fills).toEqual([[0, 0, 160, 56]]);
    expect(callsOf(calls, "set:fillStyle")).toContainEqual(["#ffc9c9"]);
    // the grid strokes after the fills, so lines stay visible above them
    const firstFill = calls.findIndex(
      (call) => call.type === "fillRect" && call.args[2] === 160,
    );
    const firstGridStroke = calls.findIndex(
      (call, index) =>
        index > firstFill && call.type === "stroke" && call.args.length === 0,
    );
    expect(firstGridStroke).toBeGreaterThan(firstFill);
  });

  it("themes the grid for dark mode and compensates zoom", () => {
    const table = API.createElement({ type: "table" });
    const { draw } = setup([table]);
    const calls = draw("dark", 2);

    const strokeColors = callsOf(calls, "set:strokeStyle").map(
      (args) => args[0],
    );
    expect(strokeColors).toContain(
      applyDarkModeFilter(TABLE_STYLE.strokeColor, true),
    );
    expect(strokeColors).toContain(
      applyDarkModeFilter(TABLE_STYLE.gridColor, true),
    );
    // zoom compensation: chrome stays 1 CSS px wide at 200% zoom
    expect(callsOf(calls, "set:lineWidth")).toContainEqual([0.5]);
  });

  it("re-renders the grid from live data after a row height change", () => {
    const table = API.createElement({ type: "table" });
    const { scene, draw } = setup([table]);

    draw();
    const before = JSON.stringify(draw());

    const [row0, ...restRows] = table.table.rows;
    mutateElement(table, scene.getNonDeletedElementsMap() as ElementsMap, {
      table: {
        ...table.table,
        rows: [{ ...row0, height: row0.height + 40 }, ...restRows],
      },
      height: table.height + 40,
    });

    const after = draw();

    // tables paint directly from the element, so the grid follows the new
    // structure without any cache invalidation on the render path
    // (the recorder accumulates, so look at this draw's four line endpoints)
    expect(callsOf(after, "lineTo").slice(-4)).toEqual([
      [160, 208],
      [320, 208],
      [480, 96],
      [480, 152],
    ]);
    expect(JSON.stringify(after)).not.toBe(before);
  });

  it("draws the grid without any rotation", () => {
    const table = API.createElement({ type: "table" });
    const { draw } = setup([table]);
    const calls = draw();

    // tables never rotate (00-overview.md invariant #10): no context.rotate
    // call may appear on the static render path
    expect(callsOf(calls, "rotate")).toEqual([]);
  });

  it("clips the table and its cell members to the containing frame", () => {
    const frame = API.createElement({
      type: "frame",
      width: 100,
      height: 100,
    });
    const table = API.createElement({
      type: "table",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    // pokes out of the frame, so it needs the clip
    const content = API.createElement({
      type: "rectangle",
      x: 90,
      y: 90,
      width: 20,
      height: 20,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "content",
      },
    });
    const { draw } = setup([frame, table, content]);
    const calls = draw();

    // both the table (oversized) and the cell member (overlapping the frame
    // edge) clip against the frame's 100x100 rect — resolving the cell member
    // to the table instead would clip to the table's 480x168 bounds
    const clipShapes = callsOf(calls, "rect").concat(
      callsOf(calls, "roundRect"),
    );
    expect(clipShapes).toEqual(
      expect.arrayContaining([expect.arrayContaining([0, 0, 100, 100])]),
    );
    expect(clipShapes.every((args) => args[2] === 100 && args[3] === 100)).toBe(
      true,
    );
    expect(callsOf(calls, "clip").length).toBe(2);
  });
});
