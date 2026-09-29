import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  isValidLibrary,
  serializeAsJSON,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw/data/json";
import {
  restoreElements,
  restoreLibraryItems,
} from "@excalidraw/excalidraw/data/restore";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  createPasteEvent,
  parseClipboard,
  parseDataTransferEvent,
  serializeAsClipboardJSON,
} from "@excalidraw/excalidraw/clipboard";

import { convertToExcalidrawElements } from "../src/transform";
import {
  assertValidContainerRefs,
  isTableElement,
  isTableCellBackgroundText,
  isTextElement,
} from "../src/typeChecks";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
} from "../src/types";

/**
 * A scene exercising every persisted relationship of the table container: a
 * frame wrapping a table, background text, multiple members in one cell, a
 * bound text inside a member, and a nested table with its own subtree.
 */
const buildScene = () => {
  const frame = API.createElement({
    type: "frame",
    x: -20,
    y: -20,
    width: 900,
    height: 700,
  });
  const table = API.createElement({
    type: "table",
    x: 0,
    y: 0,
    rowCount: 2,
    columnCount: 2,
    containerRef: { kind: "frameLike", elementId: frame.id },
  });
  const tableCellRef = (target: ExcalidrawTableElement, index: number) => ({
    kind: "tableCell" as const,
    elementId: target.id,
    cellId: target.table.cells[index].id,
    role: "content" as const,
  });

  const backgroundText = API.createElement({
    type: "text",
    text: "header note",
    x: 2,
    y: 2,
    containerRef: {
      kind: "tableCell" as const,
      elementId: table.id,
      cellId: table.table.cells[0].id,
      role: "backgroundText" as const,
    },
  });
  const memberA = API.createElement({
    type: "rectangle",
    x: 10,
    y: 10,
    containerRef: tableCellRef(table, 0),
  });
  const memberB = API.createElement({
    type: "ellipse",
    x: 170,
    y: 10,
    containerRef: tableCellRef(table, 1),
  });
  const memberC = API.createElement({
    type: "diamond",
    x: 180,
    y: 20,
    containerRef: tableCellRef(table, 1),
  });
  const boundTextOwner = API.createElement({
    type: "rectangle",
    x: 10,
    y: 70,
    boundElements: [{ type: "text", id: "bound-text" } as const],
    containerRef: tableCellRef(table, 2),
  });
  const boundText = API.createElement({
    type: "text",
    text: "bound",
    x: 12,
    y: 72,
    containerId: boundTextOwner.id,
  });
  const nested = API.createElement({
    type: "table",
    x: 170,
    y: 70,
    rowCount: 1,
    columnCount: 1,
    containerRef: tableCellRef(table, 3),
  });
  const nestedBackgroundText = API.createElement({
    type: "text",
    text: "nested note",
    x: 172,
    y: 72,
    containerRef: {
      kind: "tableCell" as const,
      elementId: nested.id,
      cellId: nested.table.cells[0].id,
      role: "backgroundText" as const,
    },
  });
  const nestedMember = API.createElement({
    type: "rectangle",
    x: 175,
    y: 75,
    containerRef: tableCellRef(nested, 0),
  });
  // a frame placed in a cell of the outer table, carrying its own member:
  // the frame records the cell, the member keeps pointing at the frame
  // (phase-1.md:21, :60, :127)
  const cellFrame = API.createElement({
    type: "frame",
    x: 300,
    y: 300,
    containerRef: tableCellRef(table, 2),
  });
  const cellFrameMember = API.createElement({
    type: "rectangle",
    x: 320,
    y: 320,
    containerRef: { kind: "frameLike", elementId: cellFrame.id },
  });

  const elements = [
    frame,
    table,
    backgroundText,
    memberA,
    memberB,
    memberC,
    boundTextOwner,
    boundText,
    nested,
    nestedBackgroundText,
    nestedMember,
    cellFrame,
    cellFrameMember,
  ];
  assertValidContainerRefs(elements);
  return elements;
};

/** Structural invariants that must survive every serialization boundary. */
const expectStructureStable = (
  before: readonly ExcalidrawElement[],
  after: readonly ExcalidrawElement[],
) => {
  expect(after.map((element) => element.id)).toEqual(
    before.map((element) => element.id),
  );

  for (const element of after) {
    const original = before.find((candidate) => candidate.id === element.id)!;
    if (isTableElement(element)) {
      // row/column order, ids, sizes and the full cell grid are stable
      expect(element.table).toEqual((original as ExcalidrawTableElement).table);
    }
    expect(element.containerRef).toEqual(original.containerRef);
    if (isTextElement(element) && isTableCellBackgroundText(element)) {
      expect(element.containerId).toBe(null);
    }
  }

  // the frame wrapper and the nested-table membership survive
  const afterById = new Map(after.map((element) => [element.id, element]));
  const tables = before.filter(isTableElement);
  const outer = afterById.get(tables[0].id) as ExcalidrawTableElement;
  const nested = afterById.get(tables[1].id) as ExcalidrawTableElement;
  expect(outer.containerRef).toMatchObject({ kind: "frameLike" });
  expect(nested.containerRef).toMatchObject({
    kind: "tableCell",
    elementId: outer.id,
    role: "content",
  });

  expect(() => assertValidContainerRefs([...after])).not.toThrow();
};

describe("table container serialization round-trips", () => {
  it("survives serializeAsJSON -> restoreElements", () => {
    const elements = buildScene();
    const serialized = JSON.parse(
      serializeAsJSON(elements, getDefaultAppState(), {}, "local"),
    );
    const restored = restoreElements(serialized.elements, null);

    expectStructureStable(elements, restored);
  });

  it("survives a direct restoreElements pass", () => {
    const elements = buildScene();
    const restored = restoreElements(elements, null);
    expectStructureStable(elements, restored);
  });

  it("survives convertToExcalidrawElements -> serialize -> restore", () => {
    // build the same relationships through the public skeleton API, then
    // push the result through the file boundary
    const converted = convertToExcalidrawElements(
      [
        {
          type: "table",
          id: "table-1",
          x: 0,
          y: 0,
          rowCount: 2,
          columnCount: 2,
          children: [
            {
              element: { type: "text", text: "header note", x: 2, y: 2 },
              cell: { row: 0, column: 0 },
              role: "backgroundText",
            },
            {
              element: { type: "rectangle", x: 10, y: 10 },
              cell: { row: 0, column: 0 },
            },
            {
              element: { type: "ellipse", x: 170, y: 10 },
              cell: { row: 0, column: 1 },
            },
            {
              element: {
                type: "table",
                id: "nested",
                x: 170,
                y: 70,
                rowCount: 1,
                columnCount: 1,
                children: [
                  {
                    element: { type: "rectangle", x: 175, y: 75 },
                    cell: { row: 0, column: 0 },
                  },
                ],
              },
              cell: { row: 1, column: 1 },
            },
          ],
        },
      ] as unknown as Parameters<typeof convertToExcalidrawElements>[0],
      { regenerateIds: false },
    );

    const serialized = JSON.parse(
      serializeAsJSON(converted, getDefaultAppState(), {}, "local"),
    );
    const restored = restoreElements(serialized.elements, null);

    expect(restored.map((element) => element.id)).toEqual(
      converted.map((element) => element.id),
    );
    const table = restored.find(isTableElement)! as ExcalidrawTableElement;
    expect(table.table.rows).toHaveLength(2);
    expect(table.table.columns).toHaveLength(2);
    const nested = restored.find(
      (element) => element.id === "nested",
    ) as ExcalidrawTableElement;
    expect(nested.containerRef).toMatchObject({
      kind: "tableCell",
      elementId: "table-1",
      role: "content",
    });
    expect(() => assertValidContainerRefs([...restored])).not.toThrow();
  });

  it("survives the library boundary", () => {
    const elements = buildScene();
    const item = {
      id: "item-1",
      status: "unpublished" as const,
      created: 1,
      elements: elements.filter((element) => !element.isDeleted),
    };
    const restored = restoreLibraryItems([item], "unpublished");
    expect(restored).toHaveLength(1);

    const serialized = JSON.parse(serializeLibraryAsJSON(restored));
    expect(isValidLibrary(serialized)).toBe(true);
    const restoredAgain = restoreLibraryItems(
      serialized.libraryItems,
      "unpublished",
    );

    expect(restoredAgain).toHaveLength(1);
    expectStructureStable(elements, restoredAgain[0].elements);
  });

  describe("clipboard", () => {
    it("keeps cell membership when copying a table subtree", async () => {
      const elements = buildScene();
      // the whole subtree: frame, table and all cell members
      const json = serializeAsClipboardJSON({ elements, files: null });
      const clipboardData = await parseClipboard(
        await parseDataTransferEvent(
          createPasteEvent({ types: { "text/plain": json } }),
        ),
      );

      expect(clipboardData.elements).toEqual(elements);
    });

    it("keeps nested-table membership through serialize + restore", async () => {
      const elements = buildScene();
      const json = serializeAsClipboardJSON({ elements, files: null });
      const clipboardData = await parseClipboard(
        await parseDataTransferEvent(
          createPasteEvent({ types: { "text/plain": json } }),
        ),
      );
      const restored = restoreElements(clipboardData.elements, null);

      expectStructureStable(elements, restored);
    });

    it("strips the containerRef of a member copied without its table", async () => {
      const elements = buildScene();
      const table = elements.find(isTableElement)!;
      const member = elements.find(
        (element) =>
          element.containerRef?.kind === "tableCell" &&
          element.containerRef.elementId === table.id &&
          element.containerRef.role === "content",
      )!;

      const json = serializeAsClipboardJSON({ elements: [member], files: null });
      const clipboardData = await parseClipboard(
        await parseDataTransferEvent(
          createPasteEvent({ types: { "text/plain": json } }),
        ),
      );

      expect(clipboardData.elements).toHaveLength(1);
      expect(clipboardData.elements![0].containerRef).toBeUndefined();
    });
  });
});