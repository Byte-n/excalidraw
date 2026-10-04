import { CURSOR_TYPE, KEYS } from "@excalidraw/common";

import {
  getCommonBounds,
  getTransformHandlesFromCoords,
} from "@excalidraw/element";

import type { Radians } from "@excalidraw/math";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";

import { getTextEditor, updateTextEditor } from "./queries/dom";

import {
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
} from "./test-utils";

unmountComponent();

const { h } = window;

const mouseDown = (clientX: number, clientY: number) => {
  fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
  });
};
const mouseMove = (clientX: number, clientY: number) => {
  fireEvent.pointerMove(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
  });
};
const mouseUp = (clientX: number, clientY: number) => {
  fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
  });
};
const clickAt = (clientX: number, clientY: number, shiftKey = false) => {
  const event = { clientX, clientY, pointerType: "mouse", shiftKey };
  fireEvent.pointerDown(GlobalTestState.interactiveCanvas, event);
  fireEvent.pointerUp(GlobalTestState.interactiveCanvas, event);
};
const doubleClickAt = (clientX: number, clientY: number) => {
  fireEvent.doubleClick(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
  });
};

const getTable = () =>
  h.elements.find(
    (element): element is ExcalidrawTableElement =>
      element.type === "table" && !element.isDeleted,
  )!;

const mouse = new Pointer("mouse");

const getBackgroundTexts = () =>
  h.elements.filter(
    (element): element is ExcalidrawTextElement =>
      element.type === "text" &&
      !element.isDeleted &&
      element.containerRef?.kind === "tableCell" &&
      element.containerRef.role === "backgroundText",
  );

/** cell center in scene coords for an unrotated table at (tableX, tableY) */
const cellCenter = (
  table: ExcalidrawTableElement,
  row: number,
  column: number,
) => ({
  x:
    table.x +
    table.table.columns.slice(0, column).reduce((acc, c) => acc + c.width, 0) +
    table.table.columns[column].width / 2,
  y:
    table.y +
    table.table.rows.slice(0, row).reduce((acc, r) => acc + r.height, 0) +
    table.table.rows[row].height / 2,
});

describe("table tool", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  describe("creation", () => {
    it("splits a drag evenly across the default 3x3 grid and selects the table", async () => {
      UI.clickExtraTool("table");

      mouseDown(30, 20);
      mouseMove(330, 170);
      mouseUp(330, 170);

      const table = getTable();
      expect(table).toBeDefined();
      expect(table.x).toBe(30);
      expect(table.y).toBe(20);
      expect(table.width).toBe(300);
      expect(table.height).toBe(150);
      expect(table.table.rows).toHaveLength(3);
      expect(table.table.columns).toHaveLength(3);
      expect(
        table.table.columns.map((column) => Math.round(column.width)),
      ).toEqual([100, 100, 100]);
      expect(table.table.rows.map((row) => Math.round(row.height))).toEqual([
        50, 50, 50,
      ]);
      expect(table.containerRef).toBeUndefined();

      // the new table is selected and the tool reverts
      expect(h.state.selectedElementIds[table.id]).toBe(true);
      expect(h.state.activeTool.type).toBe("selection");
    });

    it("creates the default preset on a click without dragging", async () => {
      UI.clickExtraTool("table");

      mouseDown(100, 100);
      mouseUp(100, 100);

      const table = getTable();
      expect(table.x).toBe(100);
      expect(table.y).toBe(100);
      expect(table.width).toBe(480);
      expect(table.height).toBe(168);
      expect(table.table.columns[0].width).toBe(160);
      expect(table.table.rows[0].height).toBe(56);
    });

    it("falls back to the default preset when the drag is below the minimum", async () => {
      UI.clickExtraTool("table");

      mouseDown(300, 300);
      mouseMove(310, 308);
      mouseUp(310, 308);

      const table = getTable();
      expect(table.x).toBe(300);
      expect(table.y).toBe(300);
      expect(table.width).toBe(480);
      expect(table.height).toBe(168);
      expect(table.table.columns[0].width).toBe(160);
      expect(table.table.rows[0].height).toBe(56);
    });

    it("records a frame-like container ref when created inside a frame", async () => {
      const frame = API.createElement({
        type: "frame",
        x: 0,
        y: 0,
        width: 600,
        height: 400,
      });
      API.setElements([frame]);

      UI.clickExtraTool("table");
      mouseDown(50, 50);
      mouseUp(50, 50);

      const table = getTable();
      expect(table.containerRef).toEqual({
        kind: "frameLike",
        elementId: frame.id,
      });
    });
  });

  describe("selection and hit priority", () => {
    let table: ExcalidrawTableElement;
    let content: any;

    beforeEach(async () => {
      table = API.createElement({ type: "table", x: 100, y: 100 });
      // a child graphic in the first cell
      content = API.createElement({
        type: "rectangle",
        x: 110,
        y: 110,
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
      API.setElements([table, content]);
    });

    it.each([false, true])(
      "selects an unselected table from a blank cell with shift=%s",
      (shiftKey) => {
        const center = cellCenter(table, 1, 1);
        clickAt(center.x, center.y, shiftKey);

        expect(h.state.selectedElementIds).toEqual({ [table.id]: true });
        expect(h.state.tableCellSelection).toBeNull();
      },
    );

    it.each([false, true])(
      "selects a child in an unselected table with shift=%s",
      (shiftKey) => {
        clickAt(130, 130, shiftKey);

        expect(h.state.selectedElementIds[content.id]).toBe(true);
        expect(h.state.tableCellSelection).toBeNull();
      },
    );

    it.each([false, true])(
      "selects a child in a selected table with shift=%s",
      (shiftKey) => {
        const blank = cellCenter(table, 1, 1);
        clickAt(blank.x, blank.y);
        clickAt(130, 130, shiftKey);

        expect(h.state.selectedElementIds[content.id]).toBe(true);
        expect(h.state.tableCellSelection).toBeNull();
      },
    );

    it.each([false, true])(
      "enters a blank cell in a selected table with shift=%s",
      (shiftKey) => {
        const blank = cellCenter(table, 1, 1);
        clickAt(blank.x, blank.y);
        clickAt(blank.x, blank.y, shiftKey);

        expect(h.state.tableCellSelection).toMatchObject({
          tableId: table.id,
          anchorId: table.table.cells[4].id,
          focusId: table.table.cells[4].id,
        });
        expect(h.state.selectedElementIds).toEqual({});
      },
    );

    it("selects the table first, then drills into cell content or the cell", () => {
      const blank = cellCenter(table, 1, 1);
      mouseDown(blank.x, blank.y);
      mouseUp(blank.x, blank.y);
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });

      mouseDown(130, 130);
      mouseUp(130, 130);
      expect(h.state.selectedElementIds).toEqual({ [content.id]: true });

      mouseDown(blank.x, blank.y);
      mouseUp(blank.x, blank.y);
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });

      mouseDown(blank.x, blank.y);
      mouseUp(blank.x, blank.y);
      expect(h.state.tableCellSelection).toMatchObject({
        tableId: table.id,
        focusId: table.table.cells[4].id,
      });
      expect(h.state.selectedElementIds).toEqual({});

      const nextCell = cellCenter(table, 0, 0);
      mouseDown(nextCell.x, nextCell.y);
      mouseUp(nextCell.x, nextCell.y);
      expect(h.state.tableCellSelection).toMatchObject({
        tableId: table.id,
        focusId: table.table.cells[0].id,
      });
      expect(h.state.selectedElementIds).toEqual({});
    });

    it("drags the selected table from a blank cell", () => {
      const blank = cellCenter(table, 1, 1);
      clickAt(blank.x, blank.y);
      const startX = table.x;
      const startY = table.y;
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });

      mouseDown(blank.x, blank.y);
      mouseMove(blank.x + 40, blank.y + 25);
      mouseUp(blank.x + 40, blank.y + 25);

      expect(getTable().x).toBe(startX + 40);
      expect(getTable().y).toBe(startY + 25);
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });
      expect(h.state.tableCellSelection).toBeNull();
    });

    it("drags the selected table from a cell graphic", () => {
      const blank = cellCenter(table, 1, 1);
      clickAt(blank.x, blank.y);
      const startX = table.x;
      const startY = table.y;
      const contentStartX = content.x;
      const contentStartY = content.y;

      mouseDown(130, 130);
      mouseMove(170, 155);
      mouseUp(170, 155);

      expect(getTable().x).toBe(startX + 40);
      expect(getTable().y).toBe(startY + 25);
      expect(h.scene.getElement(content.id)?.x).toBe(contentStartX + 40);
      expect(h.scene.getElement(content.id)?.y).toBe(contentStartY + 25);
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });
      expect(h.state.tableCellSelection).toBeNull();
    });

    it("deselects the table with escape", () => {
      const center = cellCenter(table, 1, 1);
      mouseDown(center.x, center.y);
      mouseUp(center.x, center.y);
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });

      Keyboard.keyPress(KEYS.ESCAPE);
      expect(h.state.selectedElementIds).toEqual({});
    });

    it("opens selected cell text with Enter and exits cell focus with Escape", async () => {
      const center = cellCenter(table, 1, 1);
      clickAt(center.x, center.y);
      clickAt(center.x, center.y);

      Keyboard.keyPress(KEYS.ENTER);
      const editor = await getTextEditor();
      expect(editor).toBeTruthy();
      expect(getBackgroundTexts()).toHaveLength(1);

      Keyboard.exitTextEditor(editor);
      Keyboard.keyPress(KEYS.ESCAPE);
      expect(h.state.tableCellSelection).toBeNull();
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });
    });

    it("exposes one accessible proxy for the focused cell", () => {
      const center = cellCenter(table, 1, 1);
      clickAt(center.x, center.y);
      clickAt(center.x, center.y);

      const grid = document.querySelector(".table-accessibility-grid");
      expect(grid?.getAttribute("role")).toBe("grid");
      expect(grid?.getAttribute("aria-rowcount")).toBe("3");
      expect(grid?.querySelectorAll('[role="gridcell"]')).toHaveLength(1);
      expect(grid?.getAttribute("aria-label")).toContain("row 2, column 2");

      Keyboard.keyPress(KEYS.ARROW_RIGHT);
      expect(
        document
          .querySelector(".table-accessibility-grid")
          ?.getAttribute("aria-label"),
      ).toContain("row 2, column 3");
    });

    it("leaves table keyboard commands alone during IME composition", () => {
      const center = cellCenter(table, 1, 1);
      clickAt(center.x, center.y);
      clickAt(center.x, center.y);
      const focusId = h.state.tableCellSelection?.focusId;

      fireEvent.keyDown(GlobalTestState.interactiveCanvas, {
        key: KEYS.ARROW_RIGHT,
        isComposing: true,
      });
      fireEvent.keyDown(GlobalTestState.interactiveCanvas, {
        key: KEYS.ENTER,
        isComposing: true,
      });

      expect(h.state.tableCellSelection?.focusId).toBe(focusId);
      expect(h.state.editingTextElement).toBeNull();
    });

    it("highlights the hovered cell and resets off the table", () => {
      const first = cellCenter(table, 0, 0);
      mouseMove(first.x, first.y);
      expect(h.state.highlightedTableCell).toEqual({
        tableId: table.id,
        cellId: table.table.cells[0].id,
      });

      const second = cellCenter(table, 1, 1);
      mouseMove(second.x, second.y);
      expect(h.state.highlightedTableCell).toEqual({
        tableId: table.id,
        cellId: table.table.cells[4].id,
      });

      // a child above the table takes the pointer — no cell highlight
      mouseMove(130, 130);
      expect(h.state.highlightedTableCell).toBeNull();

      mouseMove(20, 20);
      expect(h.state.highlightedTableCell).toBeNull();
    });

    it("keeps following the pointer after a click and clears on escape", () => {
      const center = cellCenter(table, 0, 2);
      mouseMove(center.x, center.y);
      expect(h.state.highlightedTableCell).not.toBeNull();

      // clicking selects the table; the highlight keeps tracking the hover
      mouseDown(center.x, center.y);
      mouseUp(center.x, center.y);
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });
      mouseMove(center.x, center.y);
      expect(h.state.highlightedTableCell).toEqual({
        tableId: table.id,
        cellId: table.table.cells[2].id,
      });

      Keyboard.keyPress(KEYS.ESCAPE);
      expect(h.state.highlightedTableCell).toBeNull();
      expect(h.state.selectedElementIds).toEqual({});
    });
  });

  describe("cell background text", () => {
    let table: ExcalidrawTableElement;

    beforeEach(async () => {
      table = API.createElement({ type: "table", x: 0, y: 0 });
      API.setElements([table]);
    });

    it("keeps the displayed text and editor at the measured size", async () => {
      const center = cellCenter(table, 0, 0);
      doubleClickAt(center.x, center.y);

      const editor = await getTextEditor();
      expect(editor.style.whiteSpace).toBe("pre-wrap");
      const texts = getBackgroundTexts();
      expect(texts).toHaveLength(1);
      const text = texts[0];
      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(text.containerRef).toEqual({
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "backgroundText",
      });
      expect(text.containerId).toBeNull();
      expect(text.autoResize).toBe(false);
      expect(text.width).toBeLessThan(160);
      expect(text.x + text.width / 2).toBe(80);
      expect(text.y + text.height / 2).toBe(28);
      expect(editor.style.width).toBe(`${text.width}px`);
      expect(editor.style.height).toBe(`${text.height}px`);
      // directly above the table
      expect(h.elements.map((element) => element.id).indexOf(text.id)).toBe(
        h.elements.map((element) => element.id).indexOf(table.id) + 1,
      );

      updateTextEditor(editor, "hello");
      Keyboard.exitTextEditor(editor);

      const committed = getBackgroundTexts()[0];
      expect(committed.id).toBe(text.id);
      expect(committed.text).toBe("hello");
      expect(committed.autoResize).toBe(false);
      expect(committed.width).toBeLessThan(160);
      expect(committed.x + committed.width / 2).toBe(80);
      expect(committed.y + committed.height / 2).toBe(28);
    });

    it("keeps the measured editor width near the viewport edge", async () => {
      const edgeTable = API.createElement({
        type: "table",
        x: h.state.width - 130,
        y: 0,
      });
      API.setElements([edgeTable]);

      const center = cellCenter(edgeTable, 0, 0);
      doubleClickAt(center.x, center.y);

      const editor = await getTextEditor();
      const text = getBackgroundTexts()[0];
      expect(text.width).toBeLessThan(edgeTable.table.columns[0].width);
      expect(editor.style.width).toBe(`${text.width}px`);
    });

    it("grows the table row while typing and keeps the text box inside it", async () => {
      const initialHeight = table.table.rows[0].height;
      const center = cellCenter(table, 0, 0);
      doubleClickAt(center.x, center.y);
      const editor = await getTextEditor();
      updateTextEditor(
        editor,
        "A long cell label that wraps onto several lines and must stay visible while it is being edited.",
      );

      const duringEdit = getTable();
      expect(duringEdit.table.rows[0].height).toBeGreaterThan(initialHeight);
      const text = getBackgroundTexts()[0];
      expect(text.height).toBeLessThanOrEqual(duringEdit.table.rows[0].height);
      expect(text.width).toBeLessThanOrEqual(duringEdit.table.columns[0].width);
      expect(editor.style.width).toBe(`${text.width}px`);
      expect(editor.style.height).toBe(`${text.height}px`);

      Keyboard.exitTextEditor(editor);
      expect(getTable().table.rows[0].height).toBe(
        duringEdit.table.rows[0].height,
      );
    });

    it("uses the cell background text alignment during display and editing", async () => {
      API.updateElement(table, {
        table: {
          ...table.table,
          rows: table.table.rows.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  style: {
                    backgroundText: {
                      horizontalAlign: "right" as const,
                      verticalAlign: "bottom" as const,
                      padding: 4,
                    },
                  },
                }
              : row,
          ),
        },
      });
      const center = cellCenter(table, 0, 0);
      doubleClickAt(center.x, center.y);
      const editor = await getTextEditor();
      updateTextEditor(editor, "hello");

      const text = getBackgroundTexts()[0];
      expect(text.textAlign).toBe("right");
      expect(text.verticalAlign).toBe("bottom");
      expect(text.x + text.width).toBe(160 - 4);
      expect(text.y + text.height).toBe(table.table.rows[0].height - 4);
      expect(editor.style.width).toBe(`${text.width}px`);
      expect(editor.style.height).toBe(`${text.height}px`);

      Keyboard.exitTextEditor(editor);
      doubleClickAt(center.x, center.y);
      const reopened = await getTextEditor();
      expect(reopened.style.width).toBe(`${text.width}px`);
      expect(reopened.style.height).toBe(`${text.height}px`);
      Keyboard.exitTextEditor(reopened);
    });

    it("re-opens the same element instead of creating a second background text", async () => {
      const center = cellCenter(table, 0, 0);
      doubleClickAt(center.x, center.y);
      const editor = await getTextEditor();
      updateTextEditor(editor, "hello");
      Keyboard.exitTextEditor(editor);

      const before = getBackgroundTexts();
      expect(before).toHaveLength(1);

      doubleClickAt(center.x, center.y);
      await getTextEditor();
      expect(h.state.editingTextElement?.id).toBe(before[0].id);
      expect(getBackgroundTexts()).toHaveLength(1);
      Keyboard.exitTextEditor(await getTextEditor());
    });

    it("deletes the element when committed empty", async () => {
      const center = cellCenter(table, 2, 2);
      doubleClickAt(center.x, center.y);
      const editor = await getTextEditor();
      Keyboard.exitTextEditor(editor);

      expect(getBackgroundTexts()).toHaveLength(0);
    });

    it("inserts below the cell's content and after the table for empty cells", async () => {
      const content = API.createElement({
        type: "rectangle",
        x: 10,
        y: 10,
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
      API.setElements([table, content]);

      const first = cellCenter(table, 0, 0);
      doubleClickAt(first.x, first.y);
      const editor = await getTextEditor();
      updateTextEditor(editor, "a");
      Keyboard.exitTextEditor(editor);

      // the background text sits between the table and the cell's content
      const types = () => h.elements.map((element) => element.type);
      expect(types()).toEqual(["table", "text", "composite_shape"]);

      // an empty cell inserts right after the table
      const second = cellCenter(table, 2, 1);
      doubleClickAt(second.x, second.y);
      const editor2 = await getTextEditor();
      updateTextEditor(editor2, "b");
      Keyboard.exitTextEditor(editor2);

      const elements = h.elements;
      expect(elements.map((element) => element.type)).toEqual([
        "table",
        "text",
        "text",
        "composite_shape",
      ]);
      const [firstText, secondText] = elements.filter(
        (element) => element.type === "text",
      );
      expect((firstText as any).text).toBe("b");
      expect((secondText as any).text).toBe("a");
    });

    it("does not block selecting content above it", async () => {
      const content = API.createElement({
        type: "rectangle",
        x: 20,
        y: 20,
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
      API.setElements([table, content]);

      doubleClickAt(cellCenter(table, 0, 0).x, cellCenter(table, 0, 0).y);
      const editor = await getTextEditor();
      updateTextEditor(editor, "background");
      Keyboard.exitTextEditor(editor);

      // the background text covers the whole cell, the click still reaches
      // the content rectangle above it
      mouseDown(40, 40);
      mouseUp(40, 40);
      expect(h.state.selectedElementIds).toEqual({ [content.id]: true });

      // and a click on the background text alone selects the table, not the
      // text
      const blank = cellCenter(table, 1, 1);
      mouseDown(blank.x, blank.y);
      mouseUp(blank.x, blank.y);
      expect(h.state.selectedElementIds).toEqual({ [table.id]: true });
    });
  });

  describe("selection rotation", () => {
    it("shows no rotation cursor when the selection contains a table", () => {
      const table = API.createElement({ type: "table", x: 100, y: 100 });
      const rect = API.createElement({
        type: "rectangle",
        x: table.x,
        y: table.y + table.height + 60,
        width: 80,
        height: 50,
      });
      API.setElements([table, rect]);

      // box-select both elements
      mouse.downAt(table.x - 30, table.y - 30);
      mouse.moveTo(-1000, -1000);
      mouse.moveTo(table.x + table.width + 30, rect.y + rect.height + 30);
      mouse.up();
      expect(h.state.selectedElementIds).toEqual({
        [table.id]: true,
        [rect.id]: true,
      });

      // the selection's rotation handle sits above the common bounds; hovering
      // it must not offer rotation (00-overview.md invariant #10)
      const [x1, y1, x2, y2] = getCommonBounds([table, rect]);
      const handles = getTransformHandlesFromCoords(
        [x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2],
        0 as Radians,
        h.state.zoom,
        "mouse",
      );
      const rotation = handles.rotation!;
      mouseMove(rotation[0] + rotation[2] / 2, rotation[1] + rotation[3] / 2);
      expect(GlobalTestState.interactiveCanvas.style.cursor).not.toBe(
        CURSOR_TYPE.GRAB,
      );
    });
  });
});
