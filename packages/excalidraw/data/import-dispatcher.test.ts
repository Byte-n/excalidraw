import { describe, expect, test } from "vitest";

import {
  dispatchPreparedImport,
  remapImportElementIds,
} from "./import-dispatcher";

describe("core import dispatcher", () => {
  test("dispatches clipboard and abort without host side effects", () => {
    const prepared = {
      kind: "clipboard-elements" as const,
      source: "paste" as const,
      elements: [{ id: "a", type: "rectangle" }],
      replace: false as const,
    };
    expect(dispatchPreparedImport(prepared).kind).toBe("clipboard-elements");
    const controller = new AbortController();
    controller.abort();
    expect(dispatchPreparedImport(prepared, controller.signal).kind).toBe(
      "aborted",
    );
  });

  test("preserves library merge/drag and image or embedded MIME decisions", () => {
    const library = {
      kind: "library" as const,
      source: "drop" as const,
      library: { libraryItems: [] },
      replace: false as const,
    };
    const image = {
      kind: "image" as const,
      source: "paste" as const,
      files: [new File(["png"], "image.png", { type: "image/png" })],
      replace: false as const,
    };
    const embedded = {
      kind: "scene" as const,
      source: "drop" as const,
      elements: [],
      files: {},
      replace: true as const,
    };
    expect(dispatchPreparedImport(library)).toEqual({
      kind: "library",
      source: "drop",
    });
    expect(dispatchPreparedImport(image)).toEqual({
      kind: "image",
      source: "paste",
    });
    expect(dispatchPreparedImport(embedded)).toEqual({
      kind: "scene",
      source: "drop",
    });
    const controller = new AbortController();
    controller.abort();
    expect(dispatchPreparedImport(embedded, controller.signal).kind).toBe(
      "aborted",
    );
  });

  test("remaps relationship IDs while preserving customData and shape", () => {
    const input = [
      {
        id: "a",
        type: "rectangle",
        containerId: "a",
        customData: { id: "a" },
        shape: { id: "a" },
      },
    ] as never[];
    const [output] = remapImportElementIds(input as never);
    expect(output.id).not.toBe("a");
    expect(output.containerId).toBe(output.id);
    expect(output.customData).toEqual({ id: "a" });
    expect(output.shape).toEqual({ id: "a" });
  });

  test("remaps nested table cells and mindmap graph references", () => {
    const input = [
      {
        id: "table",
        type: "rectangle",
        table: {
          rows: [{ id: "row" }],
          columns: [{ id: "column" }],
          cells: [
            { id: "cell", rowId: "row", columnId: "column" },
            { id: "merged", mergedInto: "cell" },
          ],
        },
        graphId: "graph",
        parentId: "root",
        childId: "node",
      },
      { id: "node", type: "rectangle", graphId: "graph", parentId: "root" },
    ] as never[];
    const [table, node] = remapImportElementIds(input as never);
    expect(table.table.cells[1].mergedInto).toBe(table.table.cells[0].id);
    expect(table.table.cells[0].rowId).toBe(table.table.rows[0].id);
    expect(table.graphId).toBe(node.graphId);
    expect(table.parentId).not.toBe("root");
  });
});
