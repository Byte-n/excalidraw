import React from "react";
import { vi } from "vitest";

import {
  assertValidContainerRefs,
  duplicateElements,
  getNonDeletedElements,
} from "@excalidraw/element";
import { MIME_TYPES } from "@excalidraw/common";

import type { ExcalidrawTableElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getDefaultAppState } from "../appState";
import { actionCopy } from "../actions/actionClipboard";
import { createUndoAction } from "../actions/actionHistory";
import {
  createPasteEvent,
  parseClipboard,
  parseDataTransferEvent,
} from "../clipboard";
import { prepareElementsForExport } from "../data";
import {
  isValidLibrary,
  serializeAsJSON,
  serializeLibraryAsJSON,
} from "../data/json";
import { restoreElements } from "../data/restore";
import { restoreLibraryItems } from "../data/restore";
import {
  createTableRangeClipboard,
  getSelectedTableRange,
  pasteTableRangeIntoCell,
  pasteTSVIntoCell,
  tableRangeToTSV,
} from "../components/app/tableClipboard";
import { insertClipboardContent } from "../components/app/clipboard";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

const { h } = window;

beforeEach(async () => {
  unmountComponent();
  await render(<Excalidraw handleKeyboardGlobally />);
});

describe("table range clipboard", () => {
  it("keeps merged style, title and descendants through file and library reuse", () => {
    const base = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 2,
    });
    const [anchor, covered] = base.table.cells;
    const table = {
      ...base,
      table: {
        ...base.table,
        style: { backgroundColor: "#fafafa" },
        rows: base.table.rows.map((row) => ({
          ...row,
          style: { backgroundText: { fontSize: 16 } },
        })),
        cells: [
          { ...anchor, columnSpan: 2, style: { backgroundColor: "#eeeeee" } },
          { ...covered, mergedInto: anchor.id },
        ],
      },
    };
    const title = API.createElement({
      type: "text",
      text: "Report",
      containerRef: { kind: "tableTitle", elementId: table.id },
    });
    const note = API.createElement({
      type: "text",
      text: "Value",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: anchor.id,
        role: "backgroundText",
      },
    });
    const member = API.createElement({
      type: "rectangle",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: anchor.id,
        role: "content",
      },
    });
    const scene = [table, title, note, member];
    const saved = JSON.parse(
      serializeAsJSON(scene, getDefaultAppState(), {}, "local"),
    );
    const reopened = restoreElements(saved.elements, null);
    expect(reopened).toHaveLength(4);
    const item = {
      id: "merged",
      status: "unpublished" as const,
      created: 1,
      elements: getNonDeletedElements(reopened),
    };
    const library = JSON.parse(serializeLibraryAsJSON([item]));
    expect(isValidLibrary(library)).toBe(true);
    const restored = restoreLibraryItems(
      library.libraryItems,
      "unpublished",
    )[0];
    const copies = duplicateElements({
      type: "everything",
      elements: restored.elements,
    }).duplicatedElements;
    const copiedTable = copies.find(
      (element) => element.type === "table",
    ) as ExcalidrawTableElement;
    expect(copiedTable.table.style).toEqual(table.table.style);
    expect(copiedTable.table.rows[0].style).toEqual(table.table.rows[0].style);
    expect(copiedTable.table.cells[0].columnSpan).toBe(2);
    expect(copiedTable.table.cells[1].mergedInto).toBe(
      copiedTable.table.cells[0].id,
    );
    expect(copiedTable.table.cells[0].id).not.toBe(anchor.id);
    expect(
      copies.find(
        (element) => element.type === "text" && element.text === "Report",
      )?.containerRef?.elementId,
    ).toBe(copiedTable.id);
    expect(
      copies.find(
        (element) => element.type === "text" && element.text === "Value",
      )?.containerRef,
    ).toMatchObject({
      elementId: copiedTable.id,
      cellId: copiedTable.table.cells[0].id,
    });
    expect(() => assertValidContainerRefs(copies)).not.toThrow();
  });

  it("writes a structured range and TSV in one copy event", async () => {
    const table = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
    });
    const text = API.createElement({
      type: "text",
      text: "A",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "backgroundText",
      },
    });
    API.setElements([table, text]);
    act(() =>
      API.setAppState({
        tableCellSelection: {
          tableId: table.id,
          anchorId: table.table.cells[0].id,
          focusId: table.table.cells[0].id,
          mobileMode: false,
        },
      }),
    );
    const formats = new Map<string, string>();
    const event = {
      clipboardData: {
        setData: (type: string, value: string) => formats.set(type, value),
        getData: (type: string) => formats.get(type) ?? "",
      },
    } as unknown as ClipboardEvent;
    await actionCopy.perform(
      h.app.scene.getElementsIncludingDeleted(),
      h.state,
      event,
      h.app,
    );
    expect(formats.get(MIME_TYPES.text)).toBe("A");
    const parsed = await parseClipboard(
      await parseDataTransferEvent(
        createPasteEvent({ types: Object.fromEntries(formats) }),
      ),
    );
    expect(parsed.tableRange).toBe(true);
    expect(parsed.elements).toHaveLength(2);
  });

  it("keeps mixed selection together and rejects a table-cell destination", async () => {
    const source = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
    });
    const target = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
      x: 500,
    });
    const outside = API.createElement({ type: "rectangle", x: 800 });
    API.setElements([source, target, outside]);
    act(() =>
      API.setAppState({
        selectedElementIds: { [outside.id]: true },
        tableCellSelection: {
          tableId: source.id,
          anchorId: source.table.cells[0].id,
          focusId: source.table.cells[0].id,
          mobileMode: false,
        },
      }),
    );
    const formats = new Map<string, string>();
    const event = {
      clipboardData: {
        setData: (type: string, value: string) => formats.set(type, value),
        getData: (type: string) => formats.get(type) ?? "",
      },
    } as unknown as ClipboardEvent;
    await actionCopy.perform(
      h.app.scene.getElementsIncludingDeleted(),
      h.state,
      event,
      h.app,
    );
    const parsed = await parseClipboard(
      await parseDataTransferEvent(
        createPasteEvent({ types: Object.fromEntries(formats) }),
      ),
    );
    expect(parsed.mixedTableSelection).toBe(true);
    expect(parsed.elements).toHaveLength(2);

    act(() =>
      API.setAppState({
        tableCellSelection: {
          tableId: target.id,
          anchorId: target.table.cells[0].id,
          focusId: target.table.cells[0].id,
          mobileMode: false,
        },
      }),
    );
    await act(async () => insertClipboardContent(h.app, parsed, [], false));
    expect(JSON.stringify(h.state.errorMessage)).toMatch(/canvas/);
    expect(h.elements).toHaveLength(3);

    act(() => API.setAppState({ tableCellSelection: null }));
    const dropTarget = vi
      .spyOn(h.app, "getTableCellDropTargetAtSceneCoords")
      .mockReturnValue(null);
    await act(async () => insertClipboardContent(h.app, parsed, [], false));
    dropTarget.mockRestore();
    expect(
      h.elements.filter(
        (element) => !element.isDeleted && element.type === "table",
      ),
    ).toHaveLength(3);
    expect(
      h.elements.filter(
        (element) => !element.isDeleted && element.type === "composite_shape",
      ),
    ).toHaveLength(2);
  });

  it("rejects duplicate ids and invalid parent chains during restore", () => {
    const table = API.createElement({ type: "table" });
    const child = API.createElement({
      type: "rectangle",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "content",
      },
    });
    expect(() =>
      restoreElements([table, { ...child, id: table.id }], null),
    ).toThrow(/Duplicate element id/);
    expect(() =>
      restoreElements(
        [
          table,
          {
            ...child,
            containerRef: {
              kind: "tableCell",
              elementId: "missing",
              cellId: table.table.cells[0].id,
              role: "content",
            },
          },
        ],
        null,
      ),
    ).toThrow(/Invalid container reference/);
    expect(() =>
      restoreElements(
        [
          {
            ...table,
            containerRef: {
              kind: "tableCell",
              elementId: table.id,
              cellId: table.table.cells[0].id,
              role: "content",
            },
          },
        ],
        null,
      ),
    ).toThrow(/cycle/);
  });

  it("rejects malformed table data atomically through the public scene API", () => {
    const table = API.createElement({ type: "table" });
    API.updateScene({ elements: [table] });
    const before = h.app.scene.getElementsIncludingDeleted();
    const invalidSize = {
      ...table,
      table: {
        ...table.table,
        rows: table.table.rows.map((row, index) =>
          index === 0 ? { ...row, height: -1 } : row,
        ),
      },
    };
    expect(() => API.updateScene({ elements: [invalidSize] })).toThrow(
      /Invalid table row/,
    );
    expect(() => API.updateScene({ elements: [table, { ...table }] })).toThrow(
      /Duplicate element id/,
    );
    const missingParent = API.createElement({
      type: "rectangle",
      containerRef: {
        kind: "tableCell",
        elementId: "missing",
        cellId: table.table.cells[0].id,
        role: "content",
      },
    });
    expect(() => API.updateScene({ elements: [table, missingParent] })).toThrow(
      /Invalid container reference/,
    );
    expect(h.app.scene.getElementsIncludingDeleted()).toEqual(before);
  });

  it("exports the complete subtree of one selected table", () => {
    const table = API.createElement({ type: "table" });
    const member = API.createElement({
      type: "rectangle",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "content",
      },
    });
    const title = API.createElement({
      type: "text",
      text: "Title",
      containerRef: { kind: "tableTitle", elementId: table.id },
    });
    const outside = API.createElement({ type: "ellipse" });
    const result = prepareElementsForExport(
      [table, member, title, outside],
      { selectedElementIds: { [table.id]: true } },
      true,
    );
    expect(result.exportedElements.map((element) => element.id)).toEqual([
      table.id,
      member.id,
      title.id,
    ]);
  });

  it("copies text and shapes into another table without changing the source", () => {
    const source = API.createElement({
      type: "table",
      rowCount: 2,
      columnCount: 2,
      x: 10,
      y: 10,
    });
    const target = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
      x: 500,
      y: 100,
    });
    const text = API.createElement({
      type: "text",
      x: 14,
      y: 14,
      text: "Alpha",
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[0].id,
        role: "backgroundText",
      },
    });
    const shape = API.createElement({
      type: "rectangle",
      x: 180,
      y: 20,
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[1].id,
        role: "content",
      },
    });
    API.setElements([source, text, shape, target]);

    const snapshot = createTableRangeClipboard(
      source,
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      h.elements,
    );
    expect(tableRangeToTSV(snapshot)).toBe("Alpha\t");
    expect(snapshot.elements.map((element) => element.id)).toContain(shape.id);
    act(() =>
      pasteTableRangeIntoCell(
        h.app,
        snapshot,
        target.id,
        target.table.cells[0].id,
      ),
    );

    const next = h.app.scene.getElement(target.id) as ExcalidrawTableElement;
    expect(next.table.columns).toHaveLength(2);
    const copiedText = h.elements.find(
      (element) =>
        element.type === "text" && element.id !== text.id && !element.isDeleted,
    )!;
    const copiedShape = h.elements.find(
      (element) =>
        element.type === "composite_shape" &&
        element.id !== shape.id &&
        !element.isDeleted,
    )!;
    expect(copiedText.containerRef).toMatchObject({
      elementId: target.id,
      cellId: next.table.cells[0].id,
    });
    expect(copiedShape.containerRef).toMatchObject({
      elementId: target.id,
      cellId: next.table.cells[1].id,
    });
    expect(h.app.scene.getElement(text.id)?.isDeleted).toBe(false);
    expect(h.app.scene.getElement(shape.id)?.isDeleted).toBe(false);
    expect(() => assertValidContainerRefs(h.elements)).not.toThrow();
  });

  it("undoes row and column expansion with pasted content in one step", () => {
    const source = API.createElement({
      type: "table",
      rowCount: 2,
      columnCount: 2,
      x: 10,
      y: 10,
    });
    const target = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
      x: 500,
      y: 100,
    });
    const text = API.createElement({
      type: "text",
      text: "Pasted",
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[3].id,
        role: "backgroundText",
      },
    });
    const shape = API.createElement({
      type: "rectangle",
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[3].id,
        role: "content",
      },
    });
    const oldTargetText = API.createElement({
      type: "text",
      text: "Original",
      containerRef: {
        kind: "tableCell",
        elementId: target.id,
        cellId: target.table.cells[0].id,
        role: "backgroundText",
      },
    });
    API.setElements([source, text, shape, target, oldTargetText]);
    act(() => {
      h.app.store.scheduleCapture();
      h.app.store.commit(
        h.app.scene.getElementsMapIncludingDeleted(),
        h.app.state,
      );
    });
    const snapshot = createTableRangeClipboard(
      source,
      { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
      h.elements,
    );
    act(() =>
      pasteTableRangeIntoCell(
        h.app,
        snapshot,
        target.id,
        target.table.cells[0].id,
      ),
    );
    const expanded = h.app.scene.getElement(
      target.id,
    ) as ExcalidrawTableElement;
    expect(expanded.table.rows).toHaveLength(2);
    expect(expanded.table.columns).toHaveLength(2);
    expect(expanded.table.rows.map((row) => row.height)).toEqual(
      source.table.rows.map((row) => row.height),
    );
    expect(expanded.table.columns.map((column) => column.width)).toEqual(
      source.table.columns.map((column) => column.width),
    );
    expect(h.app.scene.getElement(oldTargetText.id)?.isDeleted).toBe(true);
    const copiedIds = h.elements
      .filter(
        (element) =>
          !element.isDeleted &&
          ![source.id, target.id, text.id, shape.id, oldTargetText.id].includes(
            element.id,
          ),
      )
      .map((element) => element.id);
    expect(copiedIds).toHaveLength(2);

    act(() => API.executeAction(createUndoAction(h.history as never) as never));
    const restored = h.app.scene.getElement(
      target.id,
    ) as ExcalidrawTableElement;
    expect(restored.table.rows).toEqual(target.table.rows);
    expect(restored.table.columns).toEqual(target.table.columns);
    expect(restored.table.cells).toEqual(target.table.cells);
    expect(restored.width).toBe(target.width);
    expect(restored.height).toBe(target.height);
    expect(h.app.scene.getElement(oldTargetText.id)?.isDeleted).toBe(false);
    expect(
      h.elements.filter(
        (element) => copiedIds.includes(element.id) && !element.isDeleted,
      ),
    ).toHaveLength(0);
  });

  it("writes TSV background text, clears empty fields and keeps shapes", () => {
    const table = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 2,
    });
    const old = API.createElement({
      type: "text",
      text: "Old",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[1].id,
        role: "backgroundText",
      },
    });
    const shape = API.createElement({
      type: "rectangle",
      containerRef: {
        kind: "tableCell",
        elementId: table.id,
        cellId: table.table.cells[1].id,
        role: "content",
      },
    });
    API.setElements([table, old, shape]);

    act(() =>
      pasteTSVIntoCell(h.app, "New\t", table.id, table.table.cells[0].id),
    );

    expect(h.app.scene.getElement(old.id)?.isDeleted).toBe(true);
    expect(h.app.scene.getElement(shape.id)?.isDeleted).toBe(false);
    expect(
      h.elements.filter(
        (element) =>
          !element.isDeleted &&
          element.type === "text" &&
          element.text === "New",
      ),
    ).toHaveLength(1);
  });

  it("rejects locked and merged targets without partial changes", () => {
    const source = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 2,
    });
    const target = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 2,
      x: 500,
    });
    API.setElements([source, target]);
    const snapshot = createTableRangeClipboard(
      source,
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      h.elements,
    );
    const before = h.app.scene.getElementsIncludingDeleted();
    API.updateElement(target, { locked: true });
    expect(() =>
      pasteTableRangeIntoCell(
        h.app,
        snapshot,
        target.id,
        target.table.cells[0].id,
      ),
    ).toThrow(/locked/);
    API.updateElement(target, {
      locked: false,
      table: {
        ...target.table,
        cells: target.table.cells.map((cell, index) =>
          index === 0
            ? { ...cell, columnSpan: 2 }
            : { ...cell, mergedInto: target.table.cells[0].id },
        ),
      },
    });
    expect(() =>
      pasteTableRangeIntoCell(
        h.app,
        snapshot,
        target.id,
        target.table.cells[0].id,
      ),
    ).toThrow(/merged cells/);
    expect(h.elements).toHaveLength(before.length);
    expect(
      h.elements.filter((element) => element.id === source.id),
    ).toHaveLength(1);
  });

  it("copies a merged source within the same table from its snapshot", () => {
    const table = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 3,
    });
    const [first, second, third] = table.table.cells;
    const merged = {
      ...table,
      table: {
        ...table.table,
        cells: table.table.cells.map((cell, index) =>
          index === 0
            ? { ...cell, columnSpan: 2, style: { backgroundColor: "#ff0000" } }
            : index === 1
            ? { ...cell, mergedInto: first.id }
            : cell,
        ),
      },
    };
    API.setElements([merged]);
    const snapshot = createTableRangeClipboard(
      merged,
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      h.elements,
    );
    act(() =>
      expect(() =>
        pasteTableRangeIntoCell(h.app, snapshot, table.id, third.id),
      ).not.toThrow(),
    );
    const updated = h.app.scene.getElement(table.id) as ExcalidrawTableElement;
    expect(updated.table.columns).toHaveLength(4);
    expect(updated.table.cells[2].columnSpan).toBe(2);
    expect(updated.table.cells[3].mergedInto).toBe(third.id);
    expect(updated.table.cells[0].columnSpan).toBe(2);
    expect(updated.table.cells[0].style.backgroundColor).toBe("#ff0000");
    expect(updated.table.cells[1].mergedInto).toBe(first.id);
    expect(second.id).not.toBe(updated.table.cells[3].id);
  });

  it("expands a selected row to include a merged cell crossing its edge", () => {
    const base = API.createElement({
      type: "table",
      rowCount: 2,
      columnCount: 2,
    });
    const anchor = base.table.cells[0];
    const covered = base.table.cells[2];
    const table = {
      ...base,
      table: {
        ...base.table,
        cells: base.table.cells.map((cell) =>
          cell.id === anchor.id
            ? { ...cell, rowSpan: 2 }
            : cell.id === covered.id
            ? { ...cell, mergedInto: anchor.id }
            : cell,
        ),
      },
    };
    const range = getSelectedTableRange(
      {
        tableCellSelection: null,
        tableRowColSelection: {
          tableId: table.id,
          kind: "row",
          id: table.table.rows[1].id,
        },
      },
      table,
    );
    expect(range).toEqual({
      startRow: 0,
      endRow: 1,
      startColumn: 0,
      endColumn: 1,
    });
    expect(() =>
      createTableRangeClipboard(table, range!, [table]),
    ).not.toThrow();
  });

  it("copies nested tables for canvas reuse but rejects cell-range paste", () => {
    const source = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
    });
    const nested = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[0].id,
        role: "content",
      },
    });
    const target = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
      x: 500,
    });
    API.setElements([source, nested, target]);
    const snapshot = createTableRangeClipboard(
      source,
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      h.elements,
    );
    expect(snapshot.elements.some((element) => element.type === "table")).toBe(
      true,
    );
    expect(tableRangeToTSV(snapshot)).toBe("");
    expect(() =>
      pasteTableRangeIntoCell(
        h.app,
        snapshot,
        target.id,
        target.table.cells[0].id,
      ),
    ).toThrow(/Nested tables/);
    expect(
      (h.app.scene.getElement(target.id) as ExcalidrawTableElement).table.cells,
    ).toEqual(target.table.cells);
  });

  it("remaps internal arrow bindings and disconnects outside endpoints", () => {
    const source = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 2,
    });
    const target = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 2,
      x: 500,
    });
    const left = API.createElement({
      type: "rectangle",
      x: 10,
      y: 10,
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[0].id,
        role: "content",
      },
    });
    const right = API.createElement({
      type: "ellipse",
      x: 170,
      y: 10,
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[1].id,
        role: "content",
      },
    });
    const outside = API.createElement({ type: "diamond", x: 700 });
    const binding = (elementId: string) => ({
      elementId,
      fixedPoint: [0.5, 0.5] as [number, number],
      mode: "orbit" as const,
    });
    const internal = API.createElement({
      type: "arrow",
      x: 40,
      y: 20,
      startBinding: binding(left.id),
      endBinding: binding(right.id),
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[0].id,
        role: "content",
      },
    });
    const crossing = API.createElement({
      type: "arrow",
      x: 40,
      y: 30,
      startBinding: binding(left.id),
      endBinding: binding(outside.id),
      containerRef: {
        kind: "tableCell",
        elementId: source.id,
        cellId: source.table.cells[0].id,
        role: "content",
      },
    });
    API.setElements([source, left, right, internal, crossing, target, outside]);
    const snapshot = createTableRangeClipboard(
      source,
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      h.elements,
    );
    act(() =>
      pasteTableRangeIntoCell(
        h.app,
        snapshot,
        target.id,
        target.table.cells[0].id,
      ),
    );
    const copies = h.elements.filter(
      (element) =>
        !element.isDeleted &&
        element.containerRef?.kind === "tableCell" &&
        element.containerRef.elementId === target.id,
    );
    const copiedLeft = copies.find(
      (element) =>
        element.type === "composite_shape" &&
        element.containerRef?.kind === "tableCell" &&
        element.containerRef.cellId === target.table.cells[0].id,
    )!;
    const copiedRight = copies.find(
      (element) =>
        element.type === "composite_shape" &&
        element.containerRef?.kind === "tableCell" &&
        element.containerRef.cellId === target.table.cells[1].id,
    )!;
    const arrows = copies.filter((element) => element.type === "arrow");
    expect(arrows).toHaveLength(2);
    expect(
      arrows.some(
        (arrow) =>
          arrow.type === "arrow" &&
          arrow.startBinding?.elementId === copiedLeft.id &&
          arrow.endBinding?.elementId === copiedRight.id,
      ),
    ).toBe(true);
    expect(
      arrows.some(
        (arrow) =>
          arrow.type === "arrow" &&
          arrow.startBinding?.elementId === copiedLeft.id &&
          arrow.endBinding === null,
      ),
    ).toBe(true);
    expect(h.app.scene.getElement(internal.id)).toBeDefined();
    expect(h.app.scene.getElement(crossing.id)).toBeDefined();
  });
});
