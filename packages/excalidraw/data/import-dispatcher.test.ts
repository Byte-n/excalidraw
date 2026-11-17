// The dispatcher tests use minimal canonical fixture fragments.
// @ts-nocheck
import { describe, expect, test } from "vitest";

import { dispatchPreparedImport } from "./import-dispatcher";

describe("core import dispatcher", () => {
  test("dispatches clipboard and abort without host side effects", () => {
    const prepared = {
      kind: "clipboard-elements" as const,
      source: "paste" as const,
      elements: [{ id: "a", type: "rectangle" }],
      replace: false as const,
      identity: "preserved" as const,
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
      identity: "preserved" as const,
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
});
