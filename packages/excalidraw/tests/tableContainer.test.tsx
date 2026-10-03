import React from "react";
import { vi } from "vitest";
import { assertValidContainerRefs } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { createUndoAction } from "../actions/actionHistory";

import {
  actionBringToFront,
  actionCopy,
  actionDuplicateSelection,
  actionSendToBack,
} from "../actions";
import { createPasteEvent, serializeAsClipboardJSON } from "../clipboard";
import * as clipboard from "../clipboard";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

unmountComponent();

const { h } = window;

const tableData = () => ({
  schemaVersion: 1 as const,
  rows: [
    { id: "row-1", height: 56 },
    { id: "row-2", height: 56 },
    { id: "row-3", height: 56 },
  ],
  columns: [
    { id: "col-1", width: 160 },
    { id: "col-2", width: 160 },
    { id: "col-3", width: 160 },
  ],
  cells: Array.from({ length: 9 }, (_, i) => ({
    id: `cell-${i}`,
    rowId: `row-${Math.floor(i / 3) + 1}`,
    columnId: `col-${(i % 3) + 1}`,
    style: {},
  })),
});

const makeTable = (id: string, x: number, y: number) =>
  API.createElement({
    id,
    type: "table",
    x,
    y,
    table: tableData(),
    width: 480,
    height: 168,
  } as never) as unknown as ExcalidrawTableElement;

const makeMember = (
  id: string,
  table: ExcalidrawTableElement,
  cellIndex: number,
  x: number,
  y: number,
): ExcalidrawElement =>
  API.createElement({
    id,
    type: "rectangle",
    x,
    y,
    width: 40,
    height: 40,
    backgroundColor: "#ff0000",
    containerRef: {
      kind: "tableCell",
      elementId: table.id,
      cellId: table.table.cells[cellIndex].id,
      role: "content",
    },
  }) as unknown as ExcalidrawElement;

const getTables = () =>
  h.elements.filter(
    (element): element is ExcalidrawTableElement =>
      element.type === "table" && !element.isDeleted,
  );

const getLiveElement = (id: string) =>
  h.elements.find((element) => element.id === id && !element.isDeleted)!;

const cellCenter = (
  table: ExcalidrawTableElement,
  row: number,
  column: number,
) => {
  const cell = table.table.cells.find(
    (candidate) =>
      candidate.rowId === table.table.rows[row].id &&
      candidate.columnId === table.table.columns[column].id,
  )!;
  const cellX = table.table.columns
    .slice(0, column)
    .reduce((acc, c) => acc + c.width, 0);
  const cellY = table.table.rows
    .slice(0, row)
    .reduce((acc, r) => acc + r.height, 0);
  return {
    cellId: cell.id,
    x: table.x + cellX + table.table.columns[column].width / 2,
    y: table.y + cellY + table.table.rows[row].height / 2,
  };
};

const mouseDown = (clientX: number, clientY: number) => {
  fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
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

const dragElementTo = (
  element: ExcalidrawElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const pointer = new Pointer("mouse");
  pointer.restorePosition(from.x, from.y);
  pointer.down();
  // cross the drag threshold in a single step, then travel to the target
  pointer.move(
    Math.min(30, Math.max(24, to.x - from.x)),
    Math.min(30, Math.max(24, to.y - from.y)),
  );
  pointer.move(to.x - pointer.clientX, to.y - pointer.clientY);
  pointer.up();
};

describe("table container drag-in", () => {
  let table: ExcalidrawTableElement;

  beforeEach(async () => {
    await render(<Excalidraw />);
    table = makeTable("table-1", 100, 100);
    API.setElements([table]);
  });

  it("records a content ref above the table when an element is dropped into an empty cell", async () => {
    const rectangle = API.createElement({
      id: "rect-1",
      type: "rectangle",
      x: -300,
      y: 100,
      width: 40,
      height: 40,
      backgroundColor: "#ff0000",
    });
    API.setElements([table, rectangle]);

    const target = cellCenter(table, 1, 1);
    dragElementTo(rectangle, { x: -280, y: 120 }, target);

    const nextRectangle = getLiveElement(rectangle.id)!;
    expect(nextRectangle.containerRef).toEqual({
      kind: "tableCell",
      elementId: table.id,
      cellId: target.cellId,
      role: "content",
    });
    // z-order: above the table
    const ids = h.elements.map((element) => element.id);
    expect(ids.indexOf(rectangle.id)).toBeGreaterThan(ids.indexOf(table.id));
  });

  it("keeps existing members when dropping into an occupied cell and appends at the tail", async () => {
    const first = cellCenter(table, 0, 0);
    const member = makeMember("member-1", table, 0, first.x - 20, first.y - 20);
    const backgroundText = API.createElement({
      id: "bg-1",
      type: "text",
      x: first.x,
      y: first.y,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "backgroundText",
      },
    });
    API.setElements([table, backgroundText, member]);

    const newcomer = UI.createElement("rectangle", {
      x: -300,
      y: 0,
      size: 40,
    });
    dragElementTo(newcomer, { x: -280, y: 20 }, { x: first.x, y: first.y });

    // the existing member and background text keep their membership
    expect(getLiveElement(member.id)!.containerRef).toEqual({
      kind: "tableCell",
      elementId: table.id,
      cellId: table.table.cells[0].id,
      role: "content",
    });
    expect(getLiveElement(backgroundText.id)!.containerRef).toEqual({
      kind: "tableCell",
      elementId: table.id,
      cellId: table.table.cells[0].id,
      role: "backgroundText",
    });
    // the newcomer lands above the cell's previous top member
    const ids = h.elements.map((element) => element.id);
    expect(ids.indexOf(newcomer.id)).toBeGreaterThan(ids.indexOf(member.id));
    expect(ids.indexOf(newcomer.id)).toBeGreaterThan(
      ids.indexOf(backgroundText.id),
    );
  });

  it("rewrites the cell when a member is dropped into another cell", async () => {
    const first = cellCenter(table, 0, 0);
    const member = makeMember("member-1", table, 0, first.x - 20, first.y - 20);
    API.setElements([table, member]);

    const last = cellCenter(table, 2, 2);
    dragElementTo(member, { x: first.x, y: first.y }, { x: last.x, y: last.y });

    expect(getLiveElement(member.id)!.containerRef).toEqual({
      kind: "tableCell",
      elementId: table.id,
      cellId: last.cellId,
      role: "content",
    });
  });

  it("clears the ref when a member is dragged out of its table", async () => {
    const first = cellCenter(table, 0, 0);
    const member = makeMember("member-1", table, 0, first.x - 20, first.y - 20);
    API.setElements([table, member]);

    dragElementTo(member, { x: first.x, y: first.y }, { x: 20, y: 400 });

    expect(getLiveElement(member.id)!.containerRef).toBeUndefined();
  });

  it("writes the new table's cell ref when a member is dropped into another table", async () => {
    const other = makeTable("table-2", 700, 100);
    const first = cellCenter(table, 0, 0);
    const member = makeMember("member-1", table, 0, first.x - 20, first.y - 20);
    API.setElements([table, other, member]);

    // the member itself is excluded from the hit, so the drop point hits the
    // other table's grid and resolves to its first cell
    const otherFirst = cellCenter(other, 0, 0);
    dragElementTo(
      member,
      { x: first.x, y: first.y },
      { x: otherFirst.x, y: otherFirst.y },
    );

    expect(getLiveElement(member.id)!.containerRef).toEqual({
      kind: "tableCell",
      elementId: other.id,
      cellId: otherFirst.cellId,
      role: "content",
    });
  });

  it("prefers the deepest nested table at the drop point", async () => {
    const nestedCell = cellCenter(table, 1, 1);
    const nested = API.createElement({
      id: "nested-1",
      type: "table",
      x: nestedCell.x - 50,
      y: nestedCell.y - 28,
      table: tableData(),
      width: 480,
      height: 168,
    } as never) as unknown as ExcalidrawTableElement;
    const member = API.createElement({
      id: "member-1",
      type: "rectangle",
      x: -300,
      y: 100,
      width: 40,
      height: 40,
      backgroundColor: "#ff0000",
    });
    API.setElements([table, nested, member]);

    dragElementTo(
      member,
      { x: -280, y: 120 },
      { x: nestedCell.x, y: nestedCell.y },
    );

    expect(getLiveElement(member.id)!.containerRef).toEqual({
      kind: "tableCell",
      elementId: nested.id,
      cellId: cellCenter(nested, 0, 0).cellId,
      role: "content",
    });
  });

  it("resolves the preview through the same rule as the commit", async () => {
    const rectangle = API.createElement({
      id: "rect-1",
      type: "rectangle",
      x: -300,
      y: 100,
      width: 40,
      height: 40,
      backgroundColor: "#ff0000",
    });
    API.setElements([table, rectangle]);

    const target = cellCenter(table, 1, 1);
    const pointer = new Pointer("mouse");
    pointer.restorePosition(-280, 120);
    pointer.down();
    pointer.move(100, 60);
    pointer.move(target.x - pointer.clientX, target.y - pointer.clientY);

    // live preview while dragging
    expect(h.state.highlightedTableCell).toEqual({
      tableId: table.id,
      cellId: target.cellId,
    });

    pointer.up();

    expect(getLiveElement(rectangle.id)!.containerRef).toEqual({
      kind: "tableCell",
      elementId: table.id,
      cellId: target.cellId,
      role: "content",
    });
    // the channel resets once the drop has committed
    expect(h.state.highlightedTableCell).toBeNull();
  });
});

describe("table content clipping", () => {
  it("excludes the part of a cell member outside its clipped cell from hit testing", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const table = makeTable("clip-table", 100, 100);
    const cellId = table.table.cells[0].id;
    const member = API.createElement({
      type: "rectangle",
      x: 120,
      y: 120,
      width: 250,
      height: 30,
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId,
        role: "content",
      },
    });
    API.setElements([table, member]);
    expect(
      h.app
        .getElementsAtPosition(300, 130)
        .some((element) => element.id === member.id),
    ).toBe(true);
    API.updateElement(table, {
      table: { ...table.table, style: { clipContent: true } },
    });
    expect(
      h.app
        .getElementsAtPosition(300, 130)
        .some((element) => element.id === member.id),
    ).toBe(false);
    expect(
      h.app
        .getElementsAtPosition(130, 130)
        .some((element) => element.id === member.id),
    ).toBe(true);
  });
});

describe("table copy", () => {
  it("copies a title with a remapped table binding", async () => {
    await render(<Excalidraw autoFocus={true} handleKeyboardGlobally={true} />);
    const ownerDocument = h.app.ownerDocument;
    const originalElementFromPoint = ownerDocument.elementFromPoint;
    Object.assign(ownerDocument, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
    const table = makeTable("title-table", 0, 80);
    const title = API.createElement({
      type: "text",
      x: 0,
      y: 40,
      text: "Budget",
      containerRef: { kind: "tableTitle", elementId: table.id },
    });
    API.setElements([table, title]);
    expect(() => assertValidContainerRefs(h.elements)).not.toThrow();
    API.setSelectedElements([table as never]);
    const selected = h.app.scene.getSelectedElements({
      selectedElementIds: h.state.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });
    const json = serializeAsClipboardJSON({ elements: selected, files: null });
    await h.app.pasteFromClipboard(
      createPasteEvent({ types: { "text/plain": json } }),
    );
    await waitFor(() =>
      expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(
        4,
      ),
    );
    const tableCopy = h.elements.find(
      (element) => element.type === "table" && element.id !== table.id,
    )!;
    const titleCopy = h.elements.find(
      (element) => element.type === "text" && element.id !== title.id,
    )!;
    expect(titleCopy.containerRef).toEqual({
      kind: "tableTitle",
      elementId: tableCopy.id,
    });
    expect(getLiveElement(title.id).containerRef?.elementId).toBe(table.id);
    expect(() => assertValidContainerRefs(h.elements)).not.toThrow();
    expect(() =>
      assertValidContainerRefs([
        ...h.elements,
        { ...title, id: "second-title" },
      ]),
    ).toThrow();
    if (originalElementFromPoint) {
      Object.assign(ownerDocument, {
        elementFromPoint: originalElementFromPoint,
      });
    }
  });

  it("pastes a table with nested containers and remapped refs", async () => {
    await render(<Excalidraw autoFocus={true} handleKeyboardGlobally={true} />);
    const ownerDocument = h.app.ownerDocument;
    const originalElementFromPoint = ownerDocument.elementFromPoint;
    Object.assign(ownerDocument, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
    const table = makeTable("table-1", 0, 0);
    const frame = API.createElement({
      type: "frame",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "content",
      },
    });
    const nestedTable = {
      ...makeTable("table-2", 20, 20),
      containerRef: { kind: "frameLike" as const, elementId: frame.id },
    };
    const member = makeMember("member-1", nestedTable, 0, 30, 30);
    API.setElements([table, frame, nestedTable, member]);
    API.setSelectedElements([table as never]);
    const selected = h.app.scene.getSelectedElements({
      selectedElementIds: h.state.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });
    const json = serializeAsClipboardJSON({ elements: selected, files: null });

    await h.app.pasteFromClipboard(
      createPasteEvent({ types: { "text/plain": json } }),
    );

    await waitFor(() =>
      expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(
        8,
      ),
    );
    const copied = h.elements.filter(
      (element) =>
        !element.isDeleted &&
        ![table.id, frame.id, nestedTable.id, member.id].includes(element.id),
    );
    const frameCopy = copied.find((element) => element.type === "frame")!;
    const nestedCopy = copied.find(
      (element) =>
        element.type === "table" &&
        element.containerRef?.elementId === frameCopy.id,
    )!;
    const tableCopy = copied.find(
      (element) => element.type === "table" && element.id !== nestedCopy.id,
    )!;
    const memberCopy = copied.find(
      (element) => element.type === "composite_shape",
    )!;
    expect(frameCopy.containerRef?.elementId).toBe(tableCopy.id);
    expect(nestedCopy.containerRef?.elementId).toBe(frameCopy.id);
    expect(memberCopy.containerRef?.elementId).toBe(nestedCopy.id);
    expect(memberCopy.containerRef?.kind).toBe("tableCell");
    if (memberCopy.containerRef?.kind === "tableCell") {
      expect(nestedCopy.type).toBe("table");
      if (nestedCopy.type === "table") {
        expect(nestedCopy.table.cells.map((cell) => cell.id)).toContain(
          memberCopy.containerRef.cellId,
        );
      }
    }
    if (originalElementFromPoint) {
      Object.assign(ownerDocument, {
        elementFromPoint: originalElementFromPoint,
      });
    } else {
      delete (ownerDocument as Partial<Document>).elementFromPoint;
    }
  });

  it("copies the full subtree through nested table and frame containers", async () => {
    await render(<Excalidraw />);
    const table = makeTable("table-1", 0, 0);
    const frame = API.createElement({
      type: "frame",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "content",
      },
    });
    const nestedTable = {
      ...makeTable("table-2", 20, 20),
      containerRef: { kind: "frameLike" as const, elementId: frame.id },
    };
    const member = makeMember("member-1", nestedTable, 0, 30, 30);
    API.setElements([table, frame, nestedTable, member]);
    API.setSelectedElements([table as never]);
    const copySpy = vi
      .spyOn(clipboard, "copyToClipboard")
      .mockResolvedValue(undefined);

    await actionCopy.perform(
      h.app.scene.getElementsIncludingDeleted(),
      h.state,
      null,
      h.app,
    );

    expect(copySpy).toHaveBeenCalledWith(
      expect.arrayContaining([table, frame, nestedTable, member]),
      h.app.files,
      null,
    );
    expect(copySpy.mock.calls[0][0]).toHaveLength(4);

    API.setSelectedElements([frame]);
    await actionCopy.perform(
      h.app.scene.getElementsIncludingDeleted(),
      h.state,
      null,
      h.app,
    );
    expect(copySpy.mock.calls[1][0].map((element) => element.id)).toEqual([
      nestedTable.id,
      member.id,
      frame.id,
    ]);
    copySpy.mockRestore();

    API.setSelectedElements([table as never]);
    API.executeAction(actionDuplicateSelection);
    const duplicates = h.elements.filter(
      (element) =>
        !element.isDeleted &&
        ![table.id, frame.id, nestedTable.id, member.id].includes(element.id),
    );
    expect(duplicates).toHaveLength(4);
    const tableCopy = duplicates.find(
      (element) => element.type === "table" && !element.containerRef,
    )!;
    const frameCopy = duplicates.find((element) => element.type === "frame")!;
    const nestedCopy = duplicates.find(
      (element) => element.type === "table" && element.containerRef,
    )!;
    const memberCopy = duplicates.find(
      (element) => element.type === "composite_shape",
    )!;
    expect(frameCopy.containerRef?.elementId).toBe(tableCopy.id);
    expect(nestedCopy.containerRef?.elementId).toBe(frameCopy.id);
    expect(memberCopy.containerRef?.elementId).toBe(nestedCopy.id);
  });

  it("regenerates the full structure and remaps member refs", async () => {
    await render(<Excalidraw />);
    const table = makeTable("table-1", 0, 0);
    const member = makeMember("member-1", table, 0, 20, 20);
    API.setElements([table, member]);
    API.setSelectedElements([table as never]);

    API.executeAction(actionDuplicateSelection);

    const copies = h.elements.filter(
      (element): element is ExcalidrawTableElement =>
        element.type === "table" && !element.isDeleted,
    );
    expect(copies).toHaveLength(2);
    const copy = copies.find((element) => element.id !== table.id)!;
    // every structure id is regenerated
    expect(table.table.rows.map((row) => row.id)).not.toEqual(
      copy.table.rows.map((row) => row.id),
    );
    expect(table.table.columns.map((column) => column.id)).not.toEqual(
      copy.table.columns.map((column) => column.id),
    );
    expect(table.table.cells.map((cell) => cell.id)).not.toEqual(
      copy.table.cells.map((cell) => cell.id),
    );
    // sizes and intersections are kept
    expect(copy.table.columns.map((column) => column.width)).toEqual(
      table.table.columns.map((column) => column.width),
    );

    // the copied member points at the copied table's cell, same intersection
    const memberCopy = h.elements.find(
      (element): element is ExcalidrawElement =>
        element.id !== member.id &&
        element.type === "composite_shape" &&
        !element.isDeleted,
    )!;
    expect(memberCopy.containerRef?.elementId).toBe(copy.id);
    const copiedCell = copy.table.cells.find(
      (cell) =>
        cell.rowId === copy.table.rows[0].id &&
        cell.columnId === copy.table.columns[0].id,
    )!;
    const copiedRef = memberCopy.containerRef as {
      kind: "tableCell";
      elementId: string;
      cellId: string;
      role: string;
    };
    expect(copiedRef.kind).toBe("tableCell");
    expect(copiedRef.cellId).toBe(copiedCell.id);
    expect(copiedRef.cellId).not.toBe(table.table.cells[0].id);
  });

  it("does not copy the table when duplicating a single cell graphic", async () => {
    await render(<Excalidraw />);
    const table = makeTable("table-1", 0, 0);
    const member = makeMember("member-1", table, 0, 20, 20);
    API.setElements([table, member]);
    API.setSelectedElements([member as never]);

    API.executeAction(actionDuplicateSelection);

    expect(
      h.elements.filter(
        (element) => element.type === "table" && !element.isDeleted,
      ),
    ).toHaveLength(1);
    // the copy's membership is re-judged at its new position, so it does not
    // dangle toward the source table (phase-1.md:69)
    const memberCopy = h.elements.find(
      (element) =>
        element.id !== member.id && element.type === "composite_shape",
    )!;
    expect(memberCopy.containerRef).toBeUndefined();
  });
});

describe("table delete", () => {
  it("deletes the complete subtree and restores it with one undo", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);

    // the table through the real tool so the store tracks the subtree
    UI.clickExtraTool("table");
    mouseDown(100, 100);
    mouseUp(100, 100);
    const table = getTables()[0];

    // a member dragged into the first cell through the real drop commit
    const member = UI.createElement("rectangle", { x: 20, y: 400, size: 40 });
    API.updateElement(member, { backgroundColor: "#ff0000" });
    const first = cellCenter(table, 0, 0);
    dragElementTo(
      h.elements.find((element) => element.id === member.id)!,
      { x: 40, y: 420 },
      { x: first.x, y: first.y },
    );
    expect(
      h.elements.find((element) => element.id === member.id)!.containerRef
        ?.kind,
    ).toBe("tableCell");

    // a nested table drawn inside another cell
    const nestedCell = cellCenter(table, 1, 1);
    UI.clickExtraTool("table");
    mouseDown(nestedCell.x, nestedCell.y);
    mouseUp(nestedCell.x, nestedCell.y);
    const nested = getTables().find((element) => element.id !== table.id)!;
    expect(nested.containerRef?.kind).toBe("tableCell");

    // click a blank area of the first cell (outside the nested table's
    // bounds) selects the whole table
    mouseDown(table.x + 140, table.y + 40);
    mouseUp(table.x + 140, table.y + 40);
    expect(h.state.selectedElementIds[table.id]).toBe(true);

    Keyboard.keyPress("Delete");

    const deletedIds = h.elements
      .filter((element) => element.isDeleted)
      .map((element) => element.id);
    expect(deletedIds).toEqual(
      expect.arrayContaining([table.id, member.id, nested.id]),
    );

    // one undo entry restores the complete subtree
    API.executeAction(createUndoAction(h.history as never) as never);

    for (const id of [table.id, member.id, nested.id]) {
      expect(getLiveElement(id)).toBeDefined();
    }
  });
});

describe("table z-order", () => {
  it("moves the complete subtree without disturbing outside elements", async () => {
    await render(<Excalidraw />);
    const table = makeTable("table-1", 0, 0);
    const member = makeMember("member-1", table, 0, 20, 20);
    const unrelated1 = API.createElement({
      id: "outside-1",
      type: "rectangle",
      x: 1000,
      y: 0,
      width: 40,
      height: 40,
    });
    const unrelated2 = API.createElement({
      id: "outside-2",
      type: "rectangle",
      x: 1100,
      y: 0,
      width: 40,
      height: 40,
    });
    API.setElements([unrelated1, table, member, unrelated2]);
    API.setSelectedElements([table as never]);

    API.executeAction(actionSendToBack);

    const ids = h.elements.map((element) => element.id);
    const memberIndex = ids.indexOf(member.id);
    const tableIndex = ids.indexOf(table.id);
    // the whole subtree is one unit: the internal order is kept and the
    // outside elements keep their relative order
    expect(memberIndex).toBeLessThan(ids.indexOf(unrelated1.id));
    expect(tableIndex).toBeLessThan(memberIndex);
    expect(ids.indexOf(unrelated1.id)).toBeLessThan(ids.indexOf(unrelated2.id));

    API.setSelectedElements([table as never]);
    API.executeAction(actionBringToFront);

    const nextIds = h.elements.map((element) => element.id);
    expect(nextIds.indexOf(unrelated1.id)).toBeLessThan(
      nextIds.indexOf(table.id),
    );
  });
});
