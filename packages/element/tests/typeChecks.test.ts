import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { newElementWith } from "../src/mutateElement";
import { Scene } from "../src/Scene";
import { getFrameChildren, getFrameChildrenInsertionIndex } from "../src/frame";
import {
  assertValidContainerRefs,
  frameLikeContainerRef,
  hasBoundTextElement,
  isLinearElement,
  isTextElement,
} from "../src/typeChecks";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "../src/types";

describe("Test TypeChecks", () => {
  it("only treats nullish frame IDs as no parent", () => {
    expect(frameLikeContainerRef(null)).toBeUndefined();
    expect(frameLikeContainerRef(undefined)).toBeUndefined();
    expect(() => frameLikeContainerRef("")).toThrow(
      "Invalid frame-like container ID",
    );
  });

  it("validates frame-like container references", () => {
    const frame = API.createElement({ type: "frame" });
    const child = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    expect(() =>
      assertValidContainerRefs([frame, child]),
    ).not.toThrow();
    expect(() =>
      assertValidContainerRefs([
        frame,
        { ...child, containerRef: { kind: "frameLike", elementId: "missing" } },
      ]),
    ).toThrow("Invalid frame-like container reference");
    expect(() =>
      assertValidContainerRefs([
        frame,
        { ...child, containerRef: null } as unknown as ExcalidrawElement,
      ]),
    ).toThrow("Invalid container reference");
    expect(() =>
      assertValidContainerRefs([
        frame,
        { ...child, containerRef: "" } as unknown as ExcalidrawElement,
      ]),
    ).toThrow("Invalid container reference");
    for (const elementId of [0, null, undefined, "", false]) {
      expect(() =>
        assertValidContainerRefs([
          frame,
          {
            ...child,
            containerRef: { kind: "frameLike", elementId },
          } as unknown as ExcalidrawElement,
        ]),
      ).toThrow("Invalid container reference");
    }
  });

  it("enforces frame-like container references at scene boundaries", () => {
    const frame = API.createElement({
      type: "frame",
      index: "a0" as ExcalidrawElement["index"],
    });
    const child = API.createElement({
      type: "rectangle",
      index: "a1" as ExcalidrawElement["index"],
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const scene = new Scene([frame, child]);

    expect(() =>
      scene.replaceAllElements([
        frame,
        newElementWith(child, {
          containerRef: { kind: "frameLike", elementId: "missing" },
        }),
      ]),
    ).toThrow("Invalid frame-like container reference");

    expect(() =>
      scene.mutateElement(child, {
        containerRef: { kind: "frameLike", elementId: "missing" },
      }),
    ).toThrow("Invalid frame-like container reference");

    expect(() =>
      scene.replaceAllElements([
        frame,
        { ...child, containerRef: null } as unknown as ExcalidrawElement,
      ]),
    ).toThrow("Invalid container reference");
    expect(() =>
      scene.mutateElement(child, {
        containerRef: null,
      } as unknown as Parameters<typeof scene.mutateElement>[1]),
    ).toThrow("Invalid container reference");
    expect(() =>
      scene.mutateElement(child, {
        containerRef: { kind: "frameLike", elementId: 0 },
      } as unknown as Parameters<typeof scene.mutateElement>[1]),
    ).toThrow("Invalid container reference");

    expect(() =>
      scene.mutateElement(frame as ExcalidrawElement, { isDeleted: true }),
    ).toThrow("with children");
    expect(frame.isDeleted).toBe(false);
  });

  it("rejects a deleted parent and a second parent on bound text", () => {
    const deletedFrame = API.createElement({ type: "frame", isDeleted: true });
    const child = API.createElement({ type: "rectangle" });
    const scene = new Scene([deletedFrame, child]);

    expect(() =>
      scene.mutateElement(child, {
        containerRef: { kind: "frameLike", elementId: deletedFrame.id },
      }),
    ).toThrow("Invalid frame-like container reference");

    const frame = API.createElement({ type: "frame" });
    const owner = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const label = API.createElement({
      type: "text",
      containerId: owner.id,
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    expect(() =>
      assertValidContainerRefs([frame, owner, label]),
    ).toThrow("cannot have a containerRef");
  });

  describe("tableCell container refs", () => {
    const setupTableCell = () => {
      const table = API.createElement({ type: "table" });
      const cellId = table.table.cells[0].id;
      const content = API.createElement({
        type: "rectangle",
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId,
          role: "content",
        },
      });
      return { table, cellId, content };
    };

    it("accepts content and background text members", () => {
      const { table, content } = setupTableCell();
      const backgroundText = API.createElement({
        type: "text",
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId: table.table.cells[1].id,
          role: "backgroundText",
        },
      });

      expect(() =>
        assertValidContainerRefs([table, content, backgroundText]),
      ).not.toThrow();
    });

    it("rejects background text on non-text elements and dangling cells", () => {
      const { table, content } = setupTableCell();

      expect(() =>
        assertValidContainerRefs([
          table,
          {
            ...content,
            containerRef: {
              kind: "tableCell",
              elementId: table.id,
              cellId: "missing-cell",
              role: "content",
            },
          },
        ]),
      ).toThrow("Invalid table cell container reference");

      expect(() =>
        assertValidContainerRefs([
          table,
          {
            ...content,
            containerRef: {
              kind: "tableCell",
              elementId: table.id,
              cellId: table.table.cells[0].id,
              role: "backgroundText",
            },
          },
        ]),
      ).toThrow("must be a text element");
    });

    it("rejects a parent that is not a table", () => {
      const { content } = setupTableCell();
      const frame = API.createElement({ type: "frame" });

      expect(() =>
        assertValidContainerRefs([
          frame,
          {
            ...content,
            containerRef: {
              kind: "tableCell",
              elementId: frame.id,
              cellId: "any",
              role: "content",
            },
          },
        ]),
      ).toThrow("Invalid table cell container reference");
    });

    it("rejects a second background text in one cell", () => {
      const { table, cellId } = setupTableCell();
      const first = API.createElement({
        type: "text",
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId,
          role: "backgroundText",
        },
      });
      const second = API.createElement({
        type: "text",
        containerRef: {
          kind: "tableCell",
          elementId: table.id,
          cellId,
          role: "backgroundText",
        },
      });

      expect(() => assertValidContainerRefs([table, first, second])).toThrow(
        "already has background text",
      );
    });

    it("rejects cycles through nested tables", () => {
      const tableA = API.createElement({ type: "table" });
      const tableB = API.createElement({ type: "table" });

      expect(() =>
        assertValidContainerRefs([
          {
            ...tableA,
            containerRef: {
              kind: "tableCell",
              elementId: tableB.id,
              cellId: tableB.table.cells[0].id,
              role: "content",
            },
          },
          {
            ...tableB,
            containerRef: {
              kind: "tableCell",
              elementId: tableA.id,
              cellId: tableA.table.cells[0].id,
              role: "content",
            },
          },
        ]),
      ).toThrow("cycle detected");
    });

    it("enforces tableCell refs when mutating through the scene", () => {
      const { table, content } = setupTableCell();
      const scene = new Scene([table, content]);

      expect(() =>
        scene.mutateElement(content, {
          containerRef: {
            kind: "tableCell",
            elementId: table.id,
            cellId: "missing-cell",
            role: "content",
          },
        }),
      ).toThrow("Invalid table cell container reference");

      expect(() =>
        scene.replaceAllElements([
          table,
          {
            ...content,
            containerRef: {
              kind: "tableCell",
              elementId: "gone",
              cellId: table.table.cells[0].id,
              role: "content",
            },
          },
        ]),
      ).toThrow("Invalid container reference");
    });
  });

  describe("frame-like in table cells (phase-1.md:60)", () => {
    const tableCellRef = (
      table: ExcalidrawTableElement,
      cellIndex = 0,
      role: "content" | "backgroundText" = "content",
    ) => ({
      kind: "tableCell" as const,
      elementId: table.id,
      cellId: table.table.cells[cellIndex].id,
      role,
    });

    it("accepts a frame holding a tableCell ref at both entrances", () => {
      const table = API.createElement({ type: "table" });
      const frame = API.createElement({
        type: "frame",
        containerRef: tableCellRef(table),
      });

      expect(() =>
        assertValidContainerRefs([table, frame]),
      ).not.toThrow();

      const scene = new Scene([table, frame]);
      const newcomer = API.createElement({ type: "frame" });
      expect(() =>
        scene.mutateElement(newcomer, { containerRef: tableCellRef(table, 1) }),
      ).not.toThrow();
    });

    it("still rejects a frame-like parent on a frame-like element", () => {
      const outer = API.createElement({ type: "frame" });
      const inner = API.createElement({
        type: "frame",
        containerRef: { kind: "frameLike", elementId: outer.id },
      });

      expect(() => assertValidContainerRefs([outer, inner])).toThrow(
        "cannot have a frame-like parent",
      );

      const scene = new Scene([outer]);
      expect(() =>
        scene.mutateElement(inner, {
          containerRef: { kind: "frameLike", elementId: outer.id },
        }),
      ).toThrow("cannot have a frame-like parent");
    });

    it("accepts the legal nesting shapes without a cycle", () => {
      // a frame wrapping a table
      const wrapper = API.createElement({ type: "frame" });
      const framedTable = API.createElement({
        type: "table",
        containerRef: { kind: "frameLike", elementId: wrapper.id },
      });
      // the wrapped table holding a frame in one of its cells, and that
      // inner frame carrying its own member
      const cellFrame = API.createElement({
        type: "frame",
        containerRef: tableCellRef(framedTable),
      });
      const cellFrameMember = API.createElement({
        type: "rectangle",
        containerRef: { kind: "frameLike", elementId: cellFrame.id },
      });

      expect(() =>
        assertValidContainerRefs([
          wrapper,
          framedTable,
          cellFrame,
          cellFrameMember,
        ]),
      ).not.toThrow();
    });

    it("detects a true cycle: frame in a cell of the table it wraps", () => {
      const table = API.createElement({ type: "table" });
      const frame = API.createElement({
        type: "magicframe",
        containerRef: tableCellRef(table),
      });
      const cyclicTable = newElementWith(table, {
        containerRef: { kind: "frameLike", elementId: frame.id },
      });

      expect(() =>
        assertValidContainerRefs([cyclicTable, frame]),
      ).toThrow("cycle detected");
    });

    it("keeps the frame-delete guard for an in-cell frame with members", () => {
      const table = API.createElement({ type: "table" });
      const frame = API.createElement({
        type: "frame",
        containerRef: tableCellRef(table),
      });
      const member = API.createElement({
        type: "rectangle",
        containerRef: { kind: "frameLike", elementId: frame.id },
      });
      const scene = new Scene([table, frame, member]);

      expect(() =>
        scene.mutateElement(frame as ExcalidrawElement, { isDeleted: true }),
      ).toThrow("with children");
      expect(frame.isDeleted).toBe(false);
    });
  });

  it("keeps frame children in scene order after changing a parent", () => {
    const frame = API.createElement({ type: "frame" });
    const first = API.createElement({ type: "rectangle" });
    const second = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const scene = new Scene([frame, first, second]);

    scene.mutateElement(first, {
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    expect(
      getFrameChildren(scene.getElementsIncludingDeleted(), frame.id),
    ).toEqual([first, second]);
  });

  it("inserts a frame child after its owner's bound text", () => {
    const frame = API.createElement({ type: "frame" });
    const owner = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const label = API.createElement({ type: "text", containerId: owner.id });

    expect(
      getFrameChildrenInsertionIndex([frame, owner, label], frame.id),
    ).toBe(3);
  });

  describe("Test hasBoundTextElement", () => {
    it("should return true for text bindable containers with bound text", () => {
      expect(
        hasBoundTextElement(
          API.createElement({
            type: "rectangle",
            boundElements: [{ type: "text", id: "text-id" }],
          }),
        ),
      ).toBeTruthy();

      expect(
        hasBoundTextElement(
          API.createElement({
            type: "ellipse",
            boundElements: [{ type: "text", id: "text-id" }],
          }),
        ),
      ).toBeTruthy();

      expect(
        hasBoundTextElement(
          API.createElement({
            type: "arrow",
            boundElements: [{ type: "text", id: "text-id" }],
          }),
        ),
      ).toBeTruthy();
    });

    it("should return false for text bindable containers without bound text", () => {
      expect(
        hasBoundTextElement(
          API.createElement({
            type: "freedraw",
            boundElements: [{ type: "arrow", id: "arrow-id" }],
          }),
        ),
      ).toBeFalsy();
    });

    it("should return false for non text bindable containers", () => {
      expect(
        hasBoundTextElement(
          API.createElement({
            type: "freedraw",
            boundElements: [{ type: "text", id: "text-id" }],
          }),
        ),
      ).toBeFalsy();
    });

    expect(
      hasBoundTextElement(
        API.createElement({
          type: "image",
          boundElements: [{ type: "text", id: "text-id" }],
        }),
      ),
    ).toBeFalsy();
  });
});

describe("Test NonDeleted type", () => {
  it("should only allow `isDeleted: false` elements", () => {
    const element = API.createElement({ type: "rectangle" });
    const deletedElement = newElementWith(element as ExcalidrawElement, {
      isDeleted: true,
    });

    // @ts-expect-error deleted elements are not assignable to NonDeleted
    const nonDeleted: NonDeletedExcalidrawElement = deletedElement;

    // runtime narrowing is still required to treat an element as non-deleted
    // @ts-expect-error generic elements are not assignable to NonDeleted
    const nonDeletedGeneric: NonDeletedExcalidrawElement =
      deletedElement as ExcalidrawElement;

    expect(nonDeleted.isDeleted).toBe(true);
    expect(nonDeletedGeneric.isDeleted).toBe(true);
  });

  it("should be preserved by type guards", () => {
    const elements: NonDeletedExcalidrawElement[] = [
      API.createElement({ type: "text", text: "text" }),
      API.createElement({ type: "arrow" }),
    ];

    const textElements: NonDeleted<ExcalidrawTextElement>[] =
      elements.filter(isTextElement);
    const linearElements: NonDeleted<ExcalidrawLinearElement>[] =
      elements.filter(isLinearElement);

    expect(textElements.length).toBe(1);
    expect(linearElements.length).toBe(1);
  });
});
