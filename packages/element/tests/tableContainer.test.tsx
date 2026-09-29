import { arrayToMap } from "@excalidraw/common";

import type { PointerDownState } from "@excalidraw/excalidraw/types";

import {
  addElementsToTableCell,
  filterElementsEligibleAsTableCellChildren,
  getTableCellInsertionIndex,
  getTableCellSnapPoints,
  getTableCellSnapScope,
  getCommonTableCellId,
  getTableSubtreeElements,
  regenerateTableIds,
  updateTableCellMembershipOfSelectedElements,
} from "../src/tableContainer";

import {
  newElement,
  newFrameElement,
  newMindmapNodeElement,
  newTableElement,
  newTextElement,
} from "../src/newElement";

import { dragSelectedElements } from "../src/dragElements";

import { Scene } from "../src/Scene";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawTableElement,
  NonDeletedSceneElementsMap,
  SceneElementsMap,
} from "../src/types";

const makeTable = (
  id: string,
  x = 0,
  y = 0,
  overrides: Partial<Parameters<typeof newTableElement>[0]> = {},
): ExcalidrawTableElement =>
  newTableElement({
    ...overrides,
    x,
    y,
    id,
  } as never);

const makeRect = (id: string, x: number, y: number) =>
  newElement({
    type: "rectangle",
    x,
    y,
    width: 40,
    height: 40,
    id,
  } as never);

const asMap = (elements: ExcalidrawElement[]) =>
  arrayToMap(elements) as SceneElementsMap;

const withCellRef = <T extends ExcalidrawElement>(
  element: T,
  table: ExcalidrawTableElement,
  cellIndex: number,
): T => ({
  ...element,
  containerRef: {
    kind: "tableCell",
    elementId: table.id,
    cellId: table.table.cells[cellIndex].id,
    role: "content",
  },
});

/** 场景元素必须带有效分数索引（Scene 构造期校验），按数组顺序赋值。 */
const withIndex = <T extends ExcalidrawElement>(element: T, index: string): T =>
  ({ ...element, index } as T);

describe("table cell membership", () => {
  it("records a content ref and appends to the cell's z-order tail", () => {
    const table = makeTable("table-1");
    const member = withCellRef(makeRect("member-1", 20, 20), table, 0);
    const newcomer = makeRect("newcomer-1", -300, 100);
    const elements = [table, member, newcomer];
    const elementsMap = asMap(elements);

    const next = addElementsToTableCell(
      elementsMap,
      [newcomer],
      table,
      table.table.cells[0].id,
    );

    const inserted = next.get("newcomer-1")!;
    expect(inserted.containerRef).toEqual({
      kind: "tableCell",
      elementId: table.id,
      cellId: table.table.cells[0].id,
      role: "content",
    });
    // z-order: appended above the cell's previous top member, table lowest
    // (fractional indexes order lexicographically)
    expect(next.get("table-1")!.index! < next.get("member-1")!.index!).toBe(
      true,
    );
    expect(next.get("member-1")!.index! < inserted.index!).toBe(true);
  });

  it("keeps the whole mindmap subtree on the root's ref", () => {
    const table = makeTable("table-1");
    const root = {
      ...newMindmapNodeElement({
        x: -300,
        y: 0,
        graphId: "graph",
        role: "root" as const,
        parentId: null,
        order: null,
      }),
      id: "root-1",
    };
    const child = {
      ...newMindmapNodeElement({
        x: -100,
        y: 0,
        graphId: "graph",
        role: "node" as const,
        parentId: "root-1",
        order: "a0" as never,
      }),
      id: "child-1",
    };
    const elements = [table, root, child];

    const next = addElementsToTableCell(
      asMap(elements),
      [root],
      table,
      table.table.cells[4].id,
    );

    // only the root records the cell; the node inherits through the graph
    expect(next.get("root-1")!.containerRef?.kind).toBe("tableCell");
    expect(next.get("child-1")!.containerRef).toBeUndefined();
  });

  it("does not rewrite refs or reorder when membership is unchanged", () => {
    const table = makeTable("table-1");
    const member = withCellRef(makeRect("member-1", 20, 20), table, 0);
    const elements = [table, member];
    const elementsMap = asMap(elements);
    const versionBefore = elementsMap.get("member-1")!.version;

    const next = addElementsToTableCell(
      elementsMap,
      [member],
      table,
      table.table.cells[0].id,
    );

    // no-op: same objects, no version bump, no reorder
    expect(next).toBe(elementsMap);
    expect(next.get("member-1")!.version).toBe(versionBefore);
  });

  it("clears the ref when the drop lands outside the direct table", () => {
    const table = makeTable("table-1", 100, 100);
    const member = withCellRef(makeRect("member-1", 120, 120), table, 0);
    const otherMember = withCellRef(makeRect("other-1", 20, 20), table, 0);
    const elementsMap = asMap([table, member, otherMember]) as Map<
      string,
      ExcalidrawElement
    > as NonDeletedSceneElementsMap;

    updateTableCellMembershipOfSelectedElements(
      elementsMap,
      [elementsMap.get("member-1")!, elementsMap.get("other-1")!],
      // drop point outside the table clears; inside keeps
      { x: 20, y: 400 },
      null,
    );

    // the whole selection shares the drop point, so both members clear
    expect(elementsMap.get("member-1")!.containerRef).toBeUndefined();
    expect(elementsMap.get("other-1")!.containerRef).toBeUndefined();

    // a drop back inside the table keeps the membership
    const kept = withCellRef(makeRect("kept-1", 120, 120), table, 2);
    const keptMap = asMap([table, kept]) as Map<
      string,
      ExcalidrawElement
    > as NonDeletedSceneElementsMap;
    updateTableCellMembershipOfSelectedElements(
      keptMap,
      [keptMap.get("kept-1")!],
      { x: 130, y: 130 },
      null,
    );
    expect(keptMap.get("kept-1")!.containerRef?.kind).toBe("tableCell");
  });
});

describe("table structure ids", () => {
  it("regenerates every row, column and cell id, keeping the grid", () => {
    const table = makeTable("table-1");
    const { table: next, cellIdMap } = regenerateTableIds(table.table);

    expect(next.rows.map((row) => row.id)).not.toEqual(
      table.table.rows.map((row) => row.id),
    );
    expect(next.columns.map((column) => column.id)).not.toEqual(
      table.table.columns.map((column) => column.id),
    );
    expect(next.cells.map((cell) => cell.id)).not.toEqual(
      table.table.cells.map((cell) => cell.id),
    );
    expect(next.rows.map((row) => row.height)).toEqual(
      table.table.rows.map((row) => row.height),
    );
    expect(next.columns.map((column) => column.width)).toEqual(
      table.table.columns.map((column) => column.width),
    );
    // every original cell maps to a fresh id, one to one
    expect(cellIdMap.size).toBe(table.table.cells.length);
    for (const original of table.table.cells) {
      expect(cellIdMap.get(original.id)).not.toBe(original.id);
      expect(cellIdMap.get(original.id)).toBeDefined();
    }
  });

  it("collects the complete subtree through nested tables", () => {
    const table = makeTable("table-1");
    const member = withCellRef(makeRect("member-1", 20, 20), table, 0);
    const backgroundText = {
      ...newTextElement({
        x: 200,
        y: 20,
        text: "bg",
      }),
      id: "bg-1",
      containerRef: {
        kind: "tableCell" as const,
        elementId: table.id,
        cellId: table.table.cells[4].id,
        role: "backgroundText" as const,
      },
    };
    const nested = withCellRef(makeTable("nested-1", 400, 20), table, 8);
    const nestedMember = withCellRef(
      makeRect("nested-member-1", 420, 40),
      nested,
      0,
    );
    const boundText = {
      ...newTextElement({ x: 20, y: 20, text: "label" }),
      id: "bound-1",
      containerId: "member-1",
    };
    const memberWithBoundText = {
      ...member,
      boundElements: [{ id: "bound-1", type: "text" as const }],
    };
    const elementsMap = asMap([
      table,
      memberWithBoundText,
      boundText,
      backgroundText,
      nested,
      nestedMember,
    ]);

    const subtree = getTableSubtreeElements(
      Array.from(elementsMap.values()),
      table.id,
      elementsMap,
    ).map((element) => element.id);

    expect(subtree).toEqual(
      expect.arrayContaining([
        "member-1",
        "bound-1",
        "bg-1",
        "nested-1",
        "nested-member-1",
      ]),
    );
    expect(subtree).not.toContain("table-1");
  });
});

describe("table cell insertion index", () => {
  it("places content above the table when the cell is empty", () => {
    const table = makeTable("table-1");
    const unrelated = makeRect("unrelated-1", 1000, 0);
    const elements = [unrelated, table];

    expect(
      getTableCellInsertionIndex(elements, table.id, table.table.cells[0].id),
    ).toBe(2);
  });

  it("places content above the topmost element of the cell's subtree", () => {
    const table = makeTable("table-1");
    const member = withCellRef(makeRect("member-1", 20, 20), table, 0);
    const nested = withCellRef(makeTable("nested-1", 400, 0), table, 0);
    const nestedChild = withCellRef(makeRect("nc-1", 420, 20), nested, 1);
    const unrelated = makeRect("unrelated-1", 1000, 0);
    const elements = [table, member, nested, nestedChild, unrelated];

    // the subtree tail is above `nestedChild`, before the unrelated element
    expect(
      getTableCellInsertionIndex(elements, table.id, table.table.cells[0].id),
    ).toBe(4);
  });
});

describe("table cell snap scope", () => {
  it("scopes to one cell's members and exposes the cell geometry", () => {
    const table = makeTable("table-1", 100, 100);
    const dragged = withCellRef(makeRect("dragged-1", 120, 120), table, 0);
    const sibling = withCellRef(makeRect("sibling-1", 200, 120), table, 0);
    const outsider = makeRect("outsider-1", 1000, 0);
    const elements = [table, dragged, sibling, outsider];
    const elementsMap = asMap(elements);

    const scope = getTableCellSnapScope(
      elements,
      [dragged],
      elementsMap,
    );
    expect(scope?.table.id).toBe(table.id);
    expect(scope?.cellId).toBe(table.table.cells[0].id);

    const points = getTableCellSnapPoints(table, table.table.cells[0].id);
    // corners, edge midpoints and the center — all in scene coords
    expect(points).toHaveLength(9);
    const firstCorner = points[0];
    expect(firstCorner[0]).toBeCloseTo(table.x);
    expect(firstCorner[1]).toBeCloseTo(table.y);
  });

  it("returns null when the selection spans several cells or non-members", () => {
    const table = makeTable("table-1");
    const cellA = withCellRef(makeRect("a-1", 20, 20), table, 0);
    const cellB = withCellRef(makeRect("b-1", 200, 20), table, 1);
    const free = makeRect("free-1", 1000, 0);
    const elementsMap = asMap([table, cellA, cellB, free]);

    expect(
      getTableCellSnapScope([table, cellA, cellB, free], [cellA, cellB], elementsMap),
    ).toBeNull();
    expect(
      getTableCellSnapScope([table, cellA, cellB, free], [free], elementsMap),
    ).toBeNull();
  });
});

describe("frame entering a cell (phase-1.md:60, :127)", () => {
  const makeFrame = (id: string, x: number, y: number) =>
    newFrameElement({ x, y, id } as never);

  const cellRefOf = (table: ExcalidrawTableElement, cellIndex: number) => ({
    kind: "tableCell" as const,
    elementId: table.id,
    cellId: table.table.cells[cellIndex].id,
    role: "content" as const,
  });

  it("records the cell on the frame and keeps its members' frameLike refs", () => {
    const table = makeTable("table-1");
    const frame = makeFrame("frame-1", -400, 0);
    const frameMember = {
      ...makeRect("frame-member-1", -380, 20),
      containerRef: { kind: "frameLike" as const, elementId: "frame-1" },
    };
    const elements = [table, frame, frameMember];
    const elementsMap = asMap(elements);

    const next = addElementsToTableCell(
      elementsMap,
      [frame],
      table,
      table.table.cells[0].id,
    );

    // the frame itself records the direct cell parent
    expect(next.get("frame-1")!.containerRef).toEqual(cellRefOf(table, 0));
    // the frame's member keeps pointing at the frame — never rewritten
    expect(next.get("frame-member-1")!.containerRef).toEqual({
      kind: "frameLike",
      elementId: "frame-1",
    });
    // the frame rides the cell's z-order tail, above the table
    expect(next.get("table-1")!.index! < next.get("frame-1")!.index!).toBe(
      true,
    );
  });

  it("does not rewrite members passed together with their frame", () => {
    const table = makeTable("table-1");
    const frame = makeFrame("frame-1", -400, 0);
    const frameMember = {
      ...makeRect("frame-member-1", -380, 20),
      containerRef: { kind: "frameLike" as const, elementId: "frame-1" },
    };
    const elementsMap = asMap([table, frame, frameMember]);

    const next = addElementsToTableCell(
      elementsMap,
      [frame, frameMember],
      table,
      table.table.cells[0].id,
    );

    expect(next.get("frame-1")!.containerRef).toEqual(cellRefOf(table, 0));
    expect(next.get("frame-member-1")!.containerRef).toEqual({
      kind: "frameLike",
      elementId: "frame-1",
    });
  });

  it("skips a frame dropped into a cell of its own descendant table", () => {
    // table wrapped by the frame (phase-1.md:60 — the wrapped table holds the
    // frameLike ref); dropping that frame back into a cell of the wrapped
    // table would close a parent-chain cycle
    const table = {
      ...makeTable("table-1"),
      containerRef: { kind: "frameLike" as const, elementId: "frame-1" },
    };
    const frame = makeFrame("frame-1", -400, 0);
    const elementsMap = asMap([table, frame]);
    const versionBefore = elementsMap.get("frame-1")!.version;

    const next = addElementsToTableCell(
      elementsMap,
      [frame],
      table,
      table.table.cells[0].id,
    );

    expect(next.get("frame-1")!.containerRef).toBeUndefined();
    expect(next.get("frame-1")!.version).toBe(versionBefore);
  });

  it("keeps frames in a pasted batch while their members ride along", () => {
    const table = makeTable("table-1");
    const frame = makeFrame("frame-1", -400, 0);
    const frameMember = {
      ...makeRect("frame-member-1", -380, 20),
      containerRef: { kind: "frameLike" as const, elementId: "frame-1" },
    };
    const plain = makeRect("plain-1", -600, 0);

    const eligible = filterElementsEligibleAsTableCellChildren(
      [frame, frameMember, plain],
      table,
    );

    // the frame is eligible (it records the cell), its member rides the
    // frame's copy, the plain element is re-parented
    expect(eligible.map((element) => element.id)).toEqual([
      "frame-1",
      "plain-1",
    ]);
  });

  it("treats an in-cell frame as a member of its table for the common id", () => {
    const table = makeTable("table-1");
    const frame = {
      ...makeFrame("frame-1", 0, 0),
      containerRef: cellRefOf(table, 0),
    };

    expect(getCommonTableCellId([frame])).toBe(table.id);
    // a frame outside any table still vetoes
    expect(getCommonTableCellId([makeFrame("frame-2", 0, 0)])).toBeNull();
  });
});

describe("table subtree with an in-cell frame", () => {
  const makeFrame = (id: string, x: number, y: number) =>
    newFrameElement({ x, y, id } as never);

  const buildSceneWithFrame = () => {
    const table = makeTable("table-1");
    const member = withCellRef(makeRect("member-1", 20, 20), table, 0);
    const frame = {
      ...makeFrame("frame-1", 400, 0),
      containerRef: {
        kind: "tableCell" as const,
        elementId: table.id,
        cellId: table.table.cells[1].id,
        role: "content" as const,
      },
    };
    const frameMember = {
      ...makeRect("frame-member-1", 420, 20),
      containerRef: { kind: "frameLike" as const, elementId: "frame-1" },
    };
    // a table wrapped by the in-cell frame descends even deeper
    const framedTable = {
      ...makeTable("table-2", 440, 40),
      containerRef: { kind: "frameLike" as const, elementId: "frame-1" },
    };
    const elementsMap = asMap([
      withIndex(table, "a0"),
      withIndex(member, "a1"),
      withIndex(frame, "a2"),
      withIndex(frameMember, "a3"),
      withIndex(framedTable, "a4"),
    ]);
    return {
      table,
      member,
      frame,
      frameMember,
      framedTable,
      elementsMap,
      elements: Array.from(elementsMap.values()),
    };
  };

  it("collects the frame, its members and the table it wraps", () => {
    const { table, elementsMap, elements } = buildSceneWithFrame();

    const subtree = getTableSubtreeElements(
      elements,
      table.id,
      elementsMap,
    ).map((element) => element.id);

    expect(subtree).toEqual(
      expect.arrayContaining([
        "member-1",
        "frame-1",
        "frame-member-1",
        "table-2",
      ]),
    );
    expect(subtree).not.toContain("table-1");
  });

  it("deletes the frame subtree with the table and restores it in one step", () => {
    const { elementsMap, elements } = buildSceneWithFrame();
    const subtreeIds = new Set(
      getTableSubtreeElements(
        elements,
        "table-1",
        elementsMap,
      ).map((element) => element.id),
    );
    expect(subtreeIds.has("frame-1")).toBe(true);
    expect(subtreeIds.has("frame-member-1")).toBe(true);
    expect(subtreeIds.has("table-2")).toBe(true);
    expect(subtreeIds.has("table-1")).toBe(false);

    // delete: the table's caller marks the whole collected subtree deleted
    // and clears the refs along with it (one history entry)
    const deleted = elements.map((element) =>
      subtreeIds.has(element.id)
        ? { ...element, isDeleted: true, containerRef: undefined }
        : element,
    );
    expect(deleted.find((el) => el.id === "frame-1")!.isDeleted).toBe(true);
    expect(deleted.find((el) => el.id === "frame-member-1")!.isDeleted).toBe(
      true,
    );
    expect(deleted.find((el) => el.id === "table-2")!.isDeleted).toBe(true);
    expect(deleted.find((el) => el.id === "table-1")!.isDeleted).toBe(false);

    // the deleted state must load as a scene (no dangling refs) …
    expect(() => new Scene(deleted)).not.toThrow();
    // … and the undo restore of the pre-delete array is a valid scene again
    expect(() => new Scene(elements)).not.toThrow();
  });
});

describe("drag closure with an in-cell frame (phase-1.md:60)", () => {
  it("drags the table's cell frame and the frame's members, each exactly once", () => {
    const table = makeTable("table-1", 0, 0);
    const cellMember = {
      ...makeRect("cell-member-1", 20, 20),
      containerRef: {
        kind: "tableCell" as const,
        elementId: table.id,
        cellId: table.table.cells[0].id,
        role: "content" as const,
      },
    };
    const frame = {
      ...newFrameElement({ x: 300, y: 0, id: "frame-1" } as never),
      containerRef: {
        kind: "tableCell" as const,
        elementId: table.id,
        cellId: table.table.cells[1].id,
        role: "content" as const,
      },
    };
    const frameMember = {
      ...makeRect("frame-member-1", 320, 20),
      containerRef: { kind: "frameLike" as const, elementId: "frame-1" },
    };
    const unrelated = makeRect("unrelated-1", 2000, 0);

    const elements = [
      withIndex(table, "a0"),
      withIndex(cellMember, "a1"),
      withIndex(frame, "a2"),
      withIndex(frameMember, "a3"),
      withIndex(unrelated, "a4"),
    ];
    const scene = new Scene(elements);
    const elementsMap = scene.getNonDeletedElementsMap();

    const originals = elements.map((element) => ({ ...element }));
    const pointerDownState = {
      originalElements: arrayToMap(
        elements.map((element) => ({ ...element })),
      ) as PointerDownState["originalElements"],
    } as PointerDownState;

    dragSelectedElements(
      pointerDownState,
      [elementsMap.get(table.id)!],
      { x: 10, y: 5 },
      scene,
      { x: 0, y: 0 },
      null,
    );

    const moved = (id: string) => elementsMap.get(id)!;
    // the table, its direct member, the in-cell frame and the frame's own
    // member each move by exactly one offset
    expect(moved("table-1").x).toBe(originals[0].x + 10);
    expect(moved("table-1").y).toBe(originals[0].y + 5);
    expect(moved("cell-member-1").x).toBe(originals[1].x + 10);
    expect(moved("frame-1").x).toBe(originals[2].x + 10);
    expect(moved("frame-member-1").x).toBe(originals[3].x + 10);
    expect(moved("frame-member-1").y).toBe(originals[3].y + 5);
    // the unrelated element stays
    expect(moved("unrelated-1").x).toBe(originals[4].x);
    expect(moved("unrelated-1").y).toBe(originals[4].y);
  });
});