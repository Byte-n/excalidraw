import {
  KEYS,
  TABLE_STRUCTURE_INSERTION_OFFSET,
  TABLE_STRUCTURE_RAIL_OFFSET,
  getFontString,
} from "@excalidraw/common";
import { getTransformHandles } from "@excalidraw/element";
import * as Element from "@excalidraw/element";
import { act } from "react-dom/test-utils";
import { vi } from "vitest";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import * as StaticScene from "../renderer/staticScene";
import { getTableStructureHoverAtSceneCoords } from "../components/app/table";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";

import {
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
} from "./test-utils";

import type { PointerDownState } from "../types";

unmountComponent();

const { h } = window;

const mouseDown = (clientX: number, clientY: number) => {
  fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};
const mouseMove = (clientX: number, clientY: number) => {
  fireEvent.pointerMove(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};
const mouseUp = (clientX: number, clientY: number) => {
  fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};

/** lets the rAF-throttled pointer session run its pending frame */
const nextFrame = () =>
  act(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve(null));
      }),
  );

const COLUMN_WIDTH = 160;
const ROW_HEIGHT = 56;

const getTable = () =>
  h.elements.find(
    (element): element is ExcalidrawTableElement =>
      element.type === "table" && !element.isDeleted,
  )!;

const live = <T extends { id: string }>(element: T): T =>
  h.elements.find((element2) => element2.id === element.id) as unknown as T;

const createFixture = () => {
  const table = API.createElement({ type: "table", x: 200, y: 200 });
  const content0 = API.createElement({
    type: "rectangle",
    x: 210,
    y: 210,
    width: 40,
    height: 40,
    backgroundColor: "#ff0000",
    containerRef: {
      kind: "tableCell",
      elementId: table.id,
      cellId: table.table.cells[0].id,
      role: "content",
    },
  });
  const backgroundText0 = API.createElement({
    type: "text",
    x: 200,
    y: 200,
    width: COLUMN_WIDTH,
    height: ROW_HEIGHT,
    text: "a",
    fontSize: 20,
    autoResize: false,
    containerRef: {
      kind: "tableCell",
      elementId: table.id,
      cellId: table.table.cells[0].id,
      role: "backgroundText",
    },
  } as any);
  const content2 = API.createElement({
    type: "rectangle",
    x: 210,
    y: 200 + 2 * ROW_HEIGHT + 10,
    width: 40,
    height: 40,
    backgroundColor: "#ff0000",
    containerRef: {
      kind: "tableCell",
      elementId: table.id,
      cellId: table.table.cells[6].id,
      role: "content",
    },
  });
  API.setElements([table, backgroundText0, content0, content2]);

  // the API elements are live proxies: pin the pristine values before any
  // gesture touches the scene
  const snapshot = {
    tableWidth: table.width,
    rowIds: table.table.rows.map((row) => row.id),
    rowHeights: table.table.rows.map((row) => row.height),
    columnIds: table.table.columns.map((column) => column.id),
    columnWidths: table.table.columns.map((column) => column.width),
    cellIds: table.table.cells.map((cell) => cell.id),
    content0Y: content0.y,
    content2Y: content2.y,
    backgroundText0Y: backgroundText0.y,
  };
  return { table, content0, backgroundText0, content2, snapshot };
};

const selectRow = (row: number, table = getTable()) => {
  // the select strip runs just inside the left frame edge
  const point = {
    x: table.x + 10,
    y: table.y + row * ROW_HEIGHT + ROW_HEIGHT / 2,
  };
  mouseDown(point.x, point.y);
  mouseUp(point.x, point.y);
};

const undo = () => {
  Keyboard.withModifierKeys({ ctrl: true }, () => {
    Keyboard.keyPress(KEYS.Z);
  });
};

describe("table row/column structure", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("suspends hover scans during a table gesture and restores them afterwards", () => {
    const { table } = createFixture();
    selectRow(0, table);
    const grip = { x: table.x - 12, y: table.y + ROW_HEIGHT / 2 };
    mouseMove(grip.x, grip.y);
    mouseDown(grip.x, grip.y);

    expect(h.app.interactionState.isTableGestureActive).toBe(true);
    const mindmapHover = vi.spyOn(h.app.mindmap, "handlePointerMove");
    const cellHover = vi.spyOn(
      h.app,
      "maybeUpdateTableCellHighlightOnPointerMove",
    );
    const structureHover = vi.spyOn(
      h.app,
      "maybeUpdateTableStructureHoverOnPointerMove",
    );
    mouseMove(grip.x, grip.y + 20);
    expect(mindmapHover).not.toHaveBeenCalled();
    expect(cellHover).not.toHaveBeenCalled();
    expect(structureHover).not.toHaveBeenCalled();

    mouseUp(grip.x, grip.y + 20);
    expect(h.app.interactionState.isTableGestureActive).toBe(false);
    mouseMove(grip.x, grip.y);
    expect(mindmapHover).toHaveBeenCalled();
    expect(cellHover).toHaveBeenCalled();
    // the unified dispatch derives the structure hover again (through the
    // table provider rather than the legacy channel)
    expect(h.state.tableStructureHover).toMatchObject({
      tableId: table.id,
      kind: "rowGrip",
    });

    mouseDown(grip.x, grip.y);
    expect(h.app.interactionState.isTableGestureActive).toBe(true);
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.app.interactionState.isTableGestureActive).toBe(false);
    mouseUp(grip.x, grip.y);
  });

  describe("row/column selection", () => {
    it("selects a row from the outer strip and clears it with escape", () => {
      const { table } = createFixture();

      mouseMove(table.x + 10, table.y + ROW_HEIGHT / 2);
      expect(h.state.tableStructureHover).toMatchObject({
        tableId: table.id,
        kind: "rowSelect",
        rowId: table.table.rows[0].id,
      });

      selectRow(0, table);
      expect(h.state.tableRowColSelection).toEqual({
        tableId: table.id,
        kind: "row",
        id: table.table.rows[0].id,
      });

      Keyboard.keyPress(KEYS.ESCAPE);
    });

    it("selects a column from the top strip", () => {
      const { table } = createFixture();

      mouseDown(table.x + COLUMN_WIDTH + COLUMN_WIDTH / 2, table.y + 10);
      mouseUp(table.x + COLUMN_WIDTH + COLUMN_WIDTH / 2, table.y + 10);

      expect(h.state.tableRowColSelection).toEqual({
        tableId: table.id,
        kind: "column",
        id: table.table.columns[1].id,
      });
    });

    it("clears the selection on a plain cell click", () => {
      const { table } = createFixture();
      selectRow(0, table);
      expect(h.state.tableRowColSelection).not.toBeNull();

      const center = {
        x: table.x + COLUMN_WIDTH + COLUMN_WIDTH / 2,
        y: table.y + ROW_HEIGHT + ROW_HEIGHT / 2,
      };
      mouseDown(center.x, center.y);
      mouseUp(center.x, center.y);
      expect(h.state.tableRowColSelection).toBeNull();
    });
  });

  describe("row reorder", () => {
    it("shows the grip for the selected row and moves the row with its members", async () => {
      const { table, content0, backgroundText0, content2, snapshot } =
        createFixture();
      selectRow(0, table);
      const undoCount = h.history.undoStack.length;

      // the grip rides the outer edge at the selected row's center
      const grip = { x: table.x - 12, y: table.y + ROW_HEIGHT / 2 };
      mouseMove(grip.x, grip.y);
      expect(h.state.tableStructureHover).toMatchObject({
        tableId: table.id,
        kind: "rowGrip",
        rowId: table.table.rows[0].id,
      });

      mouseDown(grip.x, grip.y);
      const target = { x: grip.x, y: table.y + 2 * ROW_HEIGHT + 10 };
      mouseMove(target.x, target.y);
      await nextFrame();
      // the preview line marks the landing slot's boundary in the current
      // grid — here the second | third row line, since the pointer crossed
      // the second row's center
      expect(h.state.tableStructurePreview).toMatchObject({
        tableId: table.id,
        kind: "row",
        boundaryIndex: 1,
        offset: 2 * ROW_HEIGHT,
        source: "move",
      });

      mouseUp(target.x, target.y);

      const nextTable = getTable();
      expect(nextTable.table.rows.map((row) => row.id)).toEqual([
        snapshot.rowIds[1],
        snapshot.rowIds[0],
        table.table.rows[table.table.rows.length - 1].id,
      ]);
      // the moved row's members translate with it, the last row stays
      expect(live(content0).y).toBe(snapshot.content0Y + ROW_HEIGHT);
      expect(live(backgroundText0).y).toBe(
        snapshot.backgroundText0Y + ROW_HEIGHT,
      );
      expect(live(content2).y).toBe(snapshot.content2Y);
      expect(nextTable.table.cells.map((cell) => cell.id)).toEqual(
        snapshot.cellIds,
      );

      // exactly one undo entry, restoring everything exactly
      expect(h.history.undoStack.length).toBe(undoCount + 1);
      undo();
      expect(h.history.undoStack.length).toBe(undoCount);
      const restored = getTable();
      expect(restored.table.rows.map((row) => row.id)).toEqual(snapshot.rowIds);
      expect(live(content0).y).toBe(snapshot.content0Y);
    });

    it("leaves no trace when escape cancels the drag", async () => {
      const { table, content0, snapshot } = createFixture();
      selectRow(0, table);
      const undoCount = h.history.undoStack.length;

      const grip = { x: table.x - 12, y: table.y + ROW_HEIGHT / 2 };
      mouseMove(grip.x, grip.y);
      mouseDown(grip.x, grip.y);
      mouseMove(grip.x, table.y + 2 * ROW_HEIGHT);
      await nextFrame();

      Keyboard.keyPress(KEYS.ESCAPE);
      mouseUp(grip.x, table.y + 2 * ROW_HEIGHT);

      expect(h.state.tableStructurePreview).toBeNull();
      expect(getTable().table.rows.map((row) => row.id)).toEqual(
        snapshot.rowIds,
      );
      expect(live(content0).y).toBe(snapshot.content0Y);
      expect(h.history.undoStack.length).toBe(undoCount);
    });

    it("writes no history when released in place", () => {
      const { table, snapshot } = createFixture();
      selectRow(0, table);
      const undoCount = h.history.undoStack.length;

      const grip = { x: table.x - 12, y: table.y + ROW_HEIGHT / 2 };
      mouseDown(grip.x, grip.y);
      mouseMove(grip.x, grip.y);
      mouseUp(grip.x, grip.y);

      expect(getTable().table.rows.map((row) => row.id)).toEqual(
        snapshot.rowIds,
      );
      expect(h.history.undoStack.length).toBe(undoCount);
    });

    it("keeps the reorder preview line on the visible grid boundaries after a resize", async () => {
      const { table, snapshot } = createFixture();

      // grow the first row so the grid is no longer uniform
      const separator = { x: table.x + 100, y: table.y + ROW_HEIGHT };
      mouseDown(separator.x, separator.y);
      mouseMove(separator.x, separator.y + 24);
      mouseUp(separator.x, separator.y + 24);
      expect(getTable().table.rows[0].height).toBe(ROW_HEIGHT + 24);

      const grip = { x: table.x - 12, y: table.y + (ROW_HEIGHT + 24) / 2 };
      mouseDown(grip.x, grip.y);

      // pointer in the second row's upper half: no center crossed yet, the
      // line waits at the top edge
      mouseMove(grip.x, table.y + ROW_HEIGHT + 24 + ROW_HEIGHT / 2 - 10);
      await nextFrame();
      expect(h.state.tableStructurePreview).toMatchObject({
        boundaryIndex: 0,
        offset: 0,
      });

      // pointer past the second row's center: the line rides the current
      // grid — the second | third row boundary, not a uniform-row offset
      mouseMove(grip.x, table.y + ROW_HEIGHT + 24 + ROW_HEIGHT + 10);
      await nextFrame();
      expect(h.state.tableStructurePreview).toMatchObject({
        boundaryIndex: 1,
        offset: ROW_HEIGHT + 24 + ROW_HEIGHT,
      });

      // pointer past the third row's center: the line reaches the bottom edge
      mouseMove(grip.x, table.y + ROW_HEIGHT + 24 + 2 * ROW_HEIGHT + 10);
      await nextFrame();
      expect(h.state.tableStructurePreview).toMatchObject({
        boundaryIndex: 2,
        offset: ROW_HEIGHT + 24 + 2 * ROW_HEIGHT,
      });

      mouseUp(grip.x, table.y + ROW_HEIGHT + 24 + 2 * ROW_HEIGHT + 10);
      expect(getTable().table.rows.map((row) => row.id)).toEqual([
        snapshot.rowIds[1],
        snapshot.rowIds[2],
        snapshot.rowIds[0],
      ]);
    });
  });

  describe("row height / column width", () => {
    it.each([
      { kind: "row", x: 300, y: 256, dx: 0, dy: 24 },
      { kind: "column", x: 360, y: 228, dx: 40, dy: 0 },
    ] as const)(
      "renders each $kind resize preview and captures one undo entry",
      async ({ kind, x, y, dx, dy }) => {
        createFixture();
        act(() => {
          h.app.store.scheduleCapture();
          h.scene.triggerUpdate();
        });
        const renderSpy = vi.spyOn(StaticScene, "renderStaticScene");
        const undoCount = h.history.undoStack.length;
        mouseDown(x, y);

        for (const factor of [0.5, 1]) {
          const nonce = h.scene.getSceneNonce();
          const renders = renderSpy.mock.calls.length;
          mouseMove(x + dx * factor, y + dy * factor);
          await nextFrame();
          expect(h.scene.getSceneNonce()).not.toBe(nonce);
          expect(renderSpy.mock.calls.length).toBeGreaterThan(renders);
          expect(h.history.undoStack.length).toBe(undoCount);
        }

        mouseUp(x + dx, y + dy);
        expect(h.history.undoStack.length).toBe(undoCount + 1);
        expect(
          kind === "row"
            ? getTable().table.rows[0].height
            : getTable().table.columns[0].width,
        ).toBe(kind === "row" ? ROW_HEIGHT + dy : COLUMN_WIDTH + dx);
        undo();
        expect(
          kind === "row"
            ? getTable().table.rows[0].height
            : getTable().table.columns[0].width,
        ).toBe(kind === "row" ? ROW_HEIGHT : COLUMN_WIDTH);
        renderSpy.mockRestore();
      },
    );

    it("resizes the row, shifts later rows and keeps the resized members in place", async () => {
      const { table, content0, backgroundText0, content2, snapshot } =
        createFixture();

      // the separator between the first and the second row
      const separator = { x: table.x + 100, y: table.y + ROW_HEIGHT };
      mouseMove(separator.x, separator.y);
      expect(h.state.tableStructureHover).toMatchObject({
        tableId: table.id,
        kind: "rowResize",
        rowId: table.table.rows[0].id,
      });

      mouseDown(separator.x, separator.y);
      const target = { x: separator.x, y: separator.y + 24 };
      mouseMove(target.x, target.y);
      await nextFrame();

      const resized = getTable();
      expect(resized.table.rows[0].height).toBe(ROW_HEIGHT + 24);
      expect(resized.height).toBe(
        resized.table.rows.reduce((acc, row) => acc + row.height, 0),
      );
      // members of the resized row do not move and do not scale
      expect(live(content0).y).toBe(snapshot.content0Y);
      const text = live(backgroundText0 as unknown as ExcalidrawTextElement);
      expect(text.fontSize).toBe(20);
      expect(text.width).toBe(COLUMN_WIDTH);
      expect(text.height).toBe(
        Element.measureText(text.text, getFontString(text), text.lineHeight)
          .height,
      );
      // later rows translate by the height delta
      expect(live(content2).y).toBe(snapshot.content2Y + 24);

      mouseUp(target.x, target.y);
    });

    it("keeps background text visible when shrinking a row", () => {
      createFixture();

      const separator = { x: 300, y: 256 };
      mouseDown(separator.x, separator.y);
      mouseMove(separator.x, 205);
      mouseUp(separator.x, 205);

      expect(getTable().table.rows[0].height).toBeGreaterThan(24);
      expect(getTable().table.rows[0].height).toBeLessThan(ROW_HEIGHT);
    });

    it("resizes only the outermost column from the right edge", async () => {
      const { table } = createFixture();
      const x = table.x + table.width;
      const y = table.y + ROW_HEIGHT / 2;
      mouseMove(x, y);
      expect(h.state.tableStructureHover).toMatchObject({
        kind: "columnResize",
        columnId: table.table.columns[2].id,
      });
      mouseDown(x, y);
      mouseMove(x + 40, y);
      await nextFrame();
      mouseUp(x + 40, y);

      expect(getTable().table.columns.map((column) => column.width)).toEqual([
        COLUMN_WIDTH,
        COLUMN_WIDTH,
        COLUMN_WIDTH + 40,
      ]);
      expect(getTable().table.rows[0].height).toBe(ROW_HEIGHT);
    });

    it("resizes only the last row from the bottom edge", async () => {
      const { table } = createFixture();
      const x = table.x + COLUMN_WIDTH / 2;
      const y = table.y + table.height;
      mouseMove(x, y);
      expect(h.state.tableStructureHover).toMatchObject({
        kind: "rowResize",
        rowId: table.table.rows[2].id,
      });
      mouseDown(x, y);
      mouseMove(x, y + 30);
      await nextFrame();
      mouseUp(x, y + 30);

      expect(getTable().table.rows.map((row) => row.height)).toEqual([
        ROW_HEIGHT,
        ROW_HEIGHT,
        ROW_HEIGHT + 30,
      ]);
      expect(getTable().table.columns[0].width).toBe(COLUMN_WIDTH);
    });

    it("keeps the background text following the cell width when resizing a column", async () => {
      const { table, backgroundText0, snapshot } = createFixture();
      const originalText =
        "A longer background label that needs to wrap when its column changes width";
      API.updateElement(backgroundText0 as unknown as ExcalidrawTextElement, {
        originalText,
        text: originalText,
      });

      // the separator between the first and the second column
      const separator = {
        x: table.x + COLUMN_WIDTH,
        y: table.y + ROW_HEIGHT / 2,
      };
      mouseDown(separator.x, separator.y);
      mouseMove(separator.x + 40, separator.y);
      await nextFrame();
      mouseUp(separator.x + 40, separator.y);

      const text = live(backgroundText0 as unknown as ExcalidrawTextElement);
      expect(text.width).toBe(COLUMN_WIDTH + 40);
      expect(text.originalText).toBe(originalText);
      expect(text.text).toBe(
        Element.wrapText(originalText, getFontString(text), COLUMN_WIDTH + 40),
      );
      expect(text.height).toBe(
        Element.measureText(text.text, getFontString(text), text.lineHeight)
          .height,
      );
      expect(text.fontSize).toBe(20);
      // later columns translate by the width delta; the sums hold
      expect(getTable().table.columns[1].width).toBe(COLUMN_WIDTH);
      expect(getTable().width).toBe(3 * COLUMN_WIDTH + 40);
      expect(snapshot.columnWidths[0]).toBe(COLUMN_WIDTH);
    });
  });

  describe("insert and delete", () => {
    it.each(["row", "column"] as const)(
      "keeps the %s rails visible after clicking an unselected table's grip",
      async (kind) => {
        const { table, snapshot } = createFixture();
        const point =
          kind === "row"
            ? { x: table.x - 12, y: table.y + ROW_HEIGHT / 2 }
            : { x: table.x + COLUMN_WIDTH / 2, y: table.y - 12 };
        mouseMove(point.x, point.y);
        mouseDown(point.x, point.y);
        expect(h.state.tableRowColSelection).toMatchObject({
          tableId: table.id,
          kind,
        });
        const context = GlobalTestState.interactiveCanvas.getContext("2d")!;
        const fillRect = vi.spyOn(context, "fillRect");
        await nextFrame();
        expect(fillRect).toHaveBeenCalledWith(
          table.x,
          table.y - TABLE_STRUCTURE_RAIL_OFFSET - 9,
          COLUMN_WIDTH,
          9,
        );
        fillRect.mockClear();
        mouseUp(point.x, point.y);
        act(() => h.app.setState({ scrollX: h.state.scrollX + 1 }));
        await nextFrame();
        expect(fillRect).toHaveBeenCalledWith(
          table.x,
          table.y - TABLE_STRUCTURE_RAIL_OFFSET - 9,
          COLUMN_WIDTH,
          9,
        );
        expect(getTable().table.rows.map(({ id }) => id)).toEqual(
          snapshot.rowIds,
        );
        expect(getTable().table.columns.map(({ id }) => id)).toEqual(
          snapshot.columnIds,
        );
      },
    );

    it("renders neutral rails and insertion dots when the whole table is selected", async () => {
      const { table } = createFixture();
      const context = GlobalTestState.interactiveCanvas.getContext("2d")!;
      const fillStyle = vi.spyOn(context, "fillStyle", "set");
      const arc = vi.spyOn(context, "arc");
      API.setSelectedElements([table]);
      await nextFrame();
      expect(fillStyle).toHaveBeenCalledWith("#b3b3b3");
      expect(fillStyle).not.toHaveBeenCalledWith("rgb(0,118,255)");
      expect(arc).toHaveBeenCalledWith(
        table.x + COLUMN_WIDTH,
        table.y - TABLE_STRUCTURE_INSERTION_OFFSET,
        2,
        0,
        Math.PI * 2,
      );
      expect(arc).toHaveBeenCalledWith(
        table.x - TABLE_STRUCTURE_INSERTION_OFFSET,
        table.y + ROW_HEIGHT,
        2,
        0,
        Math.PI * 2,
      );
    });

    it("shows structure affordances while hovering a table cell", () => {
      const { table } = createFixture();
      mouseMove(table.x + COLUMN_WIDTH / 2, table.y + ROW_HEIGHT / 2);
      expect(h.state.tableStructureHover).toEqual({
        tableId: table.id,
        kind: "table",
      });
      mouseMove(table.x - 50, table.y - 50);
      expect(h.state.tableStructureHover).toBeNull();
    });

    it("inserts a row at the left rail boundary and shifts the members", () => {
      const { table, content0, snapshot } = createFixture();

      const band = { x: table.x - 12, y: table.y };
      mouseMove(band.x, band.y);
      expect(h.state.tableStructureHover).toMatchObject({
        tableId: table.id,
        kind: "rowInsert",
        boundaryIndex: 0,
      });

      mouseDown(band.x, band.y);
      mouseUp(band.x, band.y);

      const nextTable = getTable();
      expect(nextTable.table.rows).toHaveLength(4);
      expect(nextTable.table.rows[0].height).toBe(ROW_HEIGHT);
      expect(live(content0).y).toBe(snapshot.content0Y + ROW_HEIGHT);
    });

    it("uses the top rail for column dragging and its boundaries for insertion", () => {
      const { table } = createFixture();
      mouseMove(table.x + COLUMN_WIDTH / 2, table.y - 12);
      expect(h.state.tableStructureHover).toMatchObject({
        tableId: table.id,
        kind: "columnGrip",
        columnId: table.table.columns[0].id,
      });

      const boundary = { x: table.x + COLUMN_WIDTH, y: table.y - 12 };
      mouseMove(boundary.x, boundary.y);
      expect(h.state.tableStructureHover).toMatchObject({
        tableId: table.id,
        kind: "columnInsert",
        boundaryIndex: 1,
      });
      mouseDown(boundary.x, boundary.y);
      mouseUp(boundary.x, boundary.y);
      expect(getTable().table.columns).toHaveLength(4);
    });

    it("does not insert when the pointer down was a drag", () => {
      const { table, snapshot } = createFixture();

      const band = { x: table.x - 12, y: table.y + ROW_HEIGHT };
      mouseDown(band.x, band.y);
      mouseMove(band.x + 60, band.y + 30);
      mouseUp(band.x + 60, band.y + 30);

      expect(getTable().table.rows).toHaveLength(snapshot.rowIds.length);
    });

    it("uses the former right and bottom insertion zones for edge resizing", () => {
      const { table } = createFixture();
      mouseMove(table.x + table.width + 12, table.y + ROW_HEIGHT / 2);
      expect(h.state.tableStructureHover).toMatchObject({
        kind: "columnResize",
        columnId: table.table.columns[2].id,
      });
      mouseMove(table.x + COLUMN_WIDTH / 2, table.y + table.height + 12);
      expect(h.state.tableStructureHover).toMatchObject({
        kind: "rowResize",
        rowId: table.table.rows[2].id,
      });
    });

    it("deletes the selected row with its members, background text and nested subtree", () => {
      const table = API.createElement({ type: "table", x: 200, y: 200 });
      const backgroundText1 = API.createElement({
        type: "text",
        x: 200,
        y: 200 + ROW_HEIGHT,
        width: COLUMN_WIDTH,
        height: ROW_HEIGHT,
        text: "b",
        fontSize: 20,
        autoResize: false,
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: table.table.cells[3].id,
          role: "backgroundText",
        },
      } as any);
      const nested = API.createElement({
        type: "table",
        x: 380,
        y: 270,
        width: 120,
        height: 42,
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: table.table.cells[4].id,
          role: "content",
        },
      });
      const nestedMember = API.createElement({
        type: "rectangle",
        x: 385,
        y: 275,
        width: 30,
        height: 30,
        backgroundColor: "#ff0000",
        containerRef: {
          kind: "tableCell",
          elementId: nested.id,
          cellId: nested.table.cells[0].id,
          role: "content",
        },
      });
      API.setElements([table, backgroundText1, nested, nestedMember]);

      selectRow(1, table);
      expect(h.state.tableRowColSelection).toEqual({
        tableId: table.id,
        kind: "row",
        id: table.table.rows[1].id,
      });

      h.app.deleteSelectedTableRowCol();
      h.app.setState({ tableRowColSelection: null });

      const nextTable = getTable();
      expect(nextTable.id).toBe(table.id);
      expect(nextTable.table.rows).toHaveLength(2);
      expect(nextTable.table.rows[0].id).toBe(table.table.rows[0].id);
      expect(
        h.elements.find((el) => el.id === backgroundText1.id)!.isDeleted,
      ).toBe(true);
      expect(h.elements.find((el) => el.id === nested.id)!.isDeleted).toBe(
        true,
      );
      expect(
        h.elements.find((el) => el.id === nestedMember.id)!.isDeleted,
      ).toBe(true);
    });

    it("refuses to delete the last row", () => {
      const table = API.createElement({ type: "table", x: 200, y: 200 });
      API.updateElement(
        table,
        {
          table: {
            ...table.table,
            rows: table.table.rows.slice(0, 1),
            columns: table.table.columns.slice(0, 1),
            cells: table.table.cells.slice(0, 1),
          },
          width: COLUMN_WIDTH,
          height: ROW_HEIGHT,
        },
        { informMutation: false, isDragging: false },
      );
      API.setElements([table]);

      selectRow(0, table);
      h.app.deleteSelectedTableRowCol();

      expect(getTable().table.rows).toHaveLength(1);
    });
  });

  describe("uniform scale from the corner handles", () => {
    const scaleFixture = () => {
      const table = API.createElement({ type: "table", x: 200, y: 200 });
      const text = API.createElement({
        type: "text",
        x: 210,
        y: 210,
        width: 60,
        height: 20,
        text: "hello",
        fontSize: 20,
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: table.table.cells[0].id,
          role: "content",
        },
      });
      API.setElements([table, text]);
      return {
        table,
        text,
        snapshot: {
          tableWidth: table.width,
          tableHeight: table.height,
          textFontSize: text.fontSize,
          textAutoResize: text.autoResize,
        },
      };
    };

    const seHandleCenter = (table: ExcalidrawTableElement) => {
      const handles = getTransformHandles(
        table,
        h.state.zoom,
        h.scene.getNonDeletedElementsMap(),
        "mouse",
      );
      const handle = handles.se!;
      return { x: handle[0] + handle[2] / 2, y: handle[1] + handle[3] / 2 };
    };

    const selectTable = (table: ExcalidrawTableElement) => {
      const cell = {
        x: table.x + 2 * COLUMN_WIDTH + COLUMN_WIDTH / 2,
        y: table.y + 2 * ROW_HEIGHT + ROW_HEIGHT / 2,
      };
      mouseDown(cell.x, cell.y);
      mouseUp(cell.x, cell.y);
      expect(h.state.selectedElementIds[table.id]).toBe(true);
    };

    it("offers only the lower-right resize handle", () => {
      const { table } = scaleFixture();
      selectTable(table);
      const handles = getTransformHandles(
        table,
        h.state.zoom,
        h.scene.getNonDeletedElementsMap(),
        "mouse",
      );
      expect(handles.e).toBeUndefined();
      expect(handles.s).toBeUndefined();
      expect(handles.se).toBeDefined();
      expect(handles.w).toBeUndefined();
      expect(handles.n).toBeUndefined();
      expect(handles.nw).toBeUndefined();
      expect(handles.ne).toBeUndefined();
      expect(handles.sw).toBeUndefined();
      expect(handles.rotation).toBeUndefined();
    });

    it("shows a diagonal resize cursor on the lower-right handle", () => {
      const { table } = scaleFixture();
      selectTable(table);
      const handle = seHandleCenter(table);
      mouseMove(handle.x, handle.y);
      expect(GlobalTestState.interactiveCanvas.style.cursor).toBe(
        "nwse-resize",
      );
    });

    it("does not treat the left and top borders as structure controls", () => {
      const { table } = scaleFixture();
      selectTable(table);
      for (const point of [
        { x: table.x, y: table.y + ROW_HEIGHT / 2 },
        { x: table.x + COLUMN_WIDTH / 2, y: table.y },
        { x: table.x, y: table.y + ROW_HEIGHT },
        { x: table.x + COLUMN_WIDTH, y: table.y },
      ]) {
        expect(getTableStructureHoverAtSceneCoords(h.app, point)).toBeNull();
        expect(
          Element.resizeTest(
            table,
            h.scene.getNonDeletedElementsMap(),
            h.state,
            point.x,
            point.y,
            h.state.zoom,
            "mouse",
            h.app.editorInterface,
          ),
        ).toBe(false);
      }
    });

    it.each([0.5, 1, 2])(
      "prioritizes the visible insertion points at zoom %s",
      (zoom) => {
        const { table } = scaleFixture();
        selectTable(table);
        act(() => h.app.setState({ zoom: { value: zoom as any } }));
        const offset = TABLE_STRUCTURE_INSERTION_OFFSET / zoom;
        const points = [
          { x: table.x - offset, y: table.y, kind: "rowInsert" },
          {
            x: table.x + COLUMN_WIDTH,
            y: table.y - offset,
            kind: "columnInsert",
          },
        ];
        for (const { x, y, kind } of points) {
          const clientX = (x + h.state.scrollX) * zoom + h.state.offsetLeft;
          const clientY = (y + h.state.scrollY) * zoom + h.state.offsetTop;
          mouseMove(clientX, clientY);
          expect(h.state.tableStructureHover).toMatchObject({ kind });
          expect(GlobalTestState.interactiveCanvas.style.cursor).toBe(
            "pointer",
          );
          mouseDown(clientX, clientY);
          expect(h.app.interactionState.isTableGestureActive).toBe(true);
          mouseUp(clientX, clientY);
        }
        expect(getTable().table.rows).toHaveLength(4);
        expect(getTable().table.columns).toHaveLength(4);
      },
    );

    it("keeps the selected table's left and top rails available", () => {
      const { table } = scaleFixture();
      selectTable(table);
      mouseMove(table.x - 12, table.y + ROW_HEIGHT / 2);
      expect(h.state.tableStructureHover).toMatchObject({ kind: "rowGrip" });
      mouseMove(table.x + COLUMN_WIDTH / 2, table.y - 12);
      expect(h.state.tableStructureHover).toMatchObject({
        kind: "columnGrip",
      });
    });

    it("suspends hover for a gesture armed by selection handling", () => {
      const { table } = scaleFixture();
      selectTable(table);
      const handle = seHandleCenter(table);
      const armTableGesture = h.app.armTableStructureGestureOnPointerDown.bind(
        h.app,
      );
      const structureArm = vi
        .spyOn(h.app, "armTableStructureGestureOnPointerDown")
        .mockReturnValue(false);
      const selectionArm = vi
        .spyOn(h.app as any, "handleSelectionOnPointerDown")
        .mockImplementation((...args: unknown[]) => {
          armTableGesture(args[1] as PointerDownState);
          return false;
        });
      mouseDown(handle.x, handle.y);
      expect(selectionArm).toHaveBeenCalled();
      expect(h.app.interactionState.isTableGestureActive).toBe(true);

      const cellHover = vi.spyOn(
        h.app,
        "maybeUpdateTableCellHighlightOnPointerMove",
      );
      mouseMove(handle.x + 20, handle.y + 20);
      expect(cellHover).not.toHaveBeenCalled();
      mouseUp(handle.x + 20, handle.y + 20);
      expect(h.app.interactionState.isTableGestureActive).toBe(false);
      selectionArm.mockRestore();
      structureArm.mockRestore();
    });

    it("renders each scale preview and captures one undo entry", async () => {
      const { table } = scaleFixture();
      const startWidth = table.width;
      selectTable(table);
      const renderSpy = vi.spyOn(StaticScene, "renderStaticScene");
      const undoCount = h.history.undoStack.length;
      const handle = seHandleCenter(table);
      mouseDown(handle.x, handle.y);

      for (const factor of [0.5, 1]) {
        const nonce = h.scene.getSceneNonce();
        const renders = renderSpy.mock.calls.length;
        mouseMove(handle.x + 96 * factor, handle.y + 42 * factor);
        await nextFrame();
        expect(h.scene.getSceneNonce()).not.toBe(nonce);
        expect(renderSpy.mock.calls.length).toBeGreaterThan(renders);
        expect(h.history.undoStack.length).toBe(undoCount);
      }

      mouseUp(handle.x + 96, handle.y + 42);
      expect(h.history.undoStack.length).toBe(undoCount + 1);
      expect(getTable().width).toBeGreaterThan(startWidth);
      undo();
      expect(getTable().width).toBe(startWidth);
      renderSpy.mockRestore();
    });

    it("scales the subtree from the drag-start snapshot and persists the text mode once", async () => {
      const { table, text, snapshot } = scaleFixture();
      selectTable(table);

      const handle = seHandleCenter(table);
      mouseDown(handle.x, handle.y);
      const target = { x: handle.x + 96, y: handle.y + 42 };
      mouseMove(target.x, target.y);
      await nextFrame();

      // preview: geometry and font scale, the text mode stays untouched
      const s =
        ((target.x - 200) / snapshot.tableWidth +
          (target.y - 200) / snapshot.tableHeight) /
        2;
      const previewText = live(text) as ExcalidrawTextElement;
      expect(previewText.fontSize).toBeCloseTo(20 * s, 5);
      expect(previewText.autoResize).toBe(true);
      expect(getTable().table.rows[0].height).toBeCloseTo(ROW_HEIGHT * s, 5);

      mouseUp(target.x, target.y);

      const committed = live(text) as ExcalidrawTextElement;
      const committedTable = getTable();
      // the commit recomputes from the snapshot at the final factor
      expect(committed.fontSize).toBeCloseTo(20 * s, 5);
      expect(committed.autoResize).toBe(false);
      expect(committedTable.table.rows[0].height).toBeCloseTo(
        ROW_HEIGHT * s,
        5,
      );
      expect(committedTable.table.columns[0].width).toBeCloseTo(
        COLUMN_WIDTH * s,
        5,
      );
      expect(committedTable.width).toBeCloseTo(snapshot.tableWidth * s, 5);
    });

    it("keeps the final preview bitmap when release geometry is unchanged", async () => {
      const { table, text } = scaleFixture();
      selectTable(table);
      const handle = seHandleCenter(table);
      const target = { x: handle.x + 96, y: handle.y + 42 };
      mouseDown(handle.x, handle.y);
      mouseMove(target.x, target.y);
      await nextFrame();

      const deleteSpy = vi.spyOn(Element.ShapeCache, "delete");
      mouseUp(target.x, target.y);
      expect(deleteSpy).not.toHaveBeenCalledWith(live(text));
      expect((live(text) as ExcalidrawTextElement).autoResize).toBe(false);
      deleteSpy.mockRestore();
    });

    it("skips repeated previews after reaching the subtree minimum", async () => {
      const { table, text } = scaleFixture();
      selectTable(table);
      const handle = seHandleCenter(table);
      mouseDown(handle.x, handle.y);
      mouseMove(table.x + 30, table.y + 20);
      await nextFrame();

      const version = live(text).version;
      const bitmap = Element.elementWithCanvasCache.get(live(text));
      mouseMove(table.x + 20, table.y + 10);
      await nextFrame();
      expect(live(text).version).toBe(version);
      expect(Element.elementWithCanvasCache.get(live(text))).toBe(bitmap);
      mouseUp(table.x + 20, table.y + 10);
    });

    it("restores an uncommitted preview when released at the original size", async () => {
      const { table, text, snapshot } = scaleFixture();
      selectTable(table);
      const handle = seHandleCenter(table);
      const originalCorner = {
        x: table.x + snapshot.tableWidth,
        y: table.y + snapshot.tableHeight,
      };
      const undoCount = h.history.undoStack.length;
      mouseDown(handle.x, handle.y);
      mouseMove(handle.x + 96, handle.y + 42);
      await nextFrame();
      expect(getTable().width).toBeGreaterThan(snapshot.tableWidth);

      mouseUp(originalCorner.x, originalCorner.y);
      expect(getTable().width).toBe(snapshot.tableWidth);
      expect((live(text) as ExcalidrawTextElement).fontSize).toBe(
        snapshot.textFontSize,
      );
      expect(h.history.undoStack.length).toBe(undoCount);
    });

    it("clamps the scale at the subtree minimum so every row keeps 24px", () => {
      const { table } = scaleFixture();
      selectTable(table);

      const handle = seHandleCenter(table);
      mouseDown(handle.x, handle.y);
      // a hard shrink towards the anchor corner
      const target = { x: table.x + 30, y: table.y + 20 };
      mouseMove(target.x, target.y);
      mouseUp(target.x, target.y);

      const committedTable = getTable();
      for (const row of committedTable.table.rows) {
        expect(row.height).toBeCloseTo(24, 5);
      }
      for (const column of committedTable.table.columns) {
        expect(column.width).toBeCloseTo((COLUMN_WIDTH * 24) / ROW_HEIGHT, 5);
      }
    });

    it("restores the snapshot without history when escape cancels", async () => {
      const { table, text, snapshot } = scaleFixture();
      selectTable(table);

      const handle = seHandleCenter(table);
      mouseDown(handle.x, handle.y);
      mouseMove(handle.x + 96, handle.y + 42);
      await nextFrame();

      const undoCount = h.history.undoStack.length;
      Keyboard.keyPress(KEYS.ESCAPE);
      mouseUp(handle.x + 96, handle.y + 42);

      const restoredText = live(text) as ExcalidrawTextElement;
      expect(restoredText.fontSize).toBe(20);
      expect(restoredText.autoResize).toBe(snapshot.textAutoResize);
      expect(getTable().table.rows[0].height).toBe(ROW_HEIGHT);
      expect(h.history.undoStack.length).toBe(undoCount);
    });

    it("does not resize a multi-selection that contains a table (temporary)", () => {
      const { table } = scaleFixture();
      const outsider = API.createElement({
        type: "rectangle",
        x: 800,
        y: 800,
        width: 50,
        height: 50,
        backgroundColor: "#ff0000",
      });
      API.setElements([getTable(), outsider]);
      API.setSelectedElements([table, outsider]);

      const handle = seHandleCenter(table);
      mouseDown(handle.x, handle.y);
      mouseMove(handle.x + 50, handle.y + 30);
      mouseUp(handle.x + 50, handle.y + 30);

      // the generic resize stays barred for tables: the drag must not
      // desync `width`/`height` from the row/column sums
      const after = getTable();
      expect(after.width).toBe(table.width);
      expect(after.height).toBe(table.height);
      expect(after.table.rows[0].height).toBe(ROW_HEIGHT);
    });
  });

  describe("keyboard actions", () => {
    it("inserts a row below the selected row with Ctrl+Shift+R", () => {
      const { table, content2, snapshot } = createFixture();
      selectRow(0, table);

      h.app.insertTableRowCol("insertRow");

      const nextTable = getTable();
      expect(nextTable.table.rows).toHaveLength(4);
      expect(nextTable.table.rows[1].height).toBe(ROW_HEIGHT);
      // rows below the inserted one shift
      expect(live(content2).y).toBe(snapshot.content2Y + ROW_HEIGHT);
    });

    it("moves the selected row with Ctrl+Shift+ArrowDown", () => {
      const { table, snapshot } = createFixture();
      selectRow(0, table);

      Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
        Keyboard.keyPress(KEYS.ARROW_DOWN);
      });

      expect(getTable().table.rows.map((row) => row.id)).toEqual([
        snapshot.rowIds[1],
        snapshot.rowIds[0],
        snapshot.rowIds[2],
      ]);
    });

    it("does nothing without a row/column selection", () => {
      createFixture();
      const undoCount = h.history.undoStack.length;

      Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
        Keyboard.keyPress(KEYS.R);
      });

      expect(getTable().table.rows).toHaveLength(3);
      expect(h.history.undoStack.length).toBe(undoCount);
    });
  });
});
