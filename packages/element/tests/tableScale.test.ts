import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { newElementWith, type ElementUpdate } from "../src/mutateElement";
import { Scene } from "../src/Scene";
import {
  computeTableUniformScale,
  MIN_TABLE_COLUMN_WIDTH,
  MIN_TABLE_ROW_HEIGHT,
  prepareTableUniformScale,
} from "../src/tableScale";
import { getIndexedTableChildren } from "../src/tableChildrenIndex";
import { isTableElement } from "../src/typeChecks";

import type {
  ExcalidrawCompositeShapeElement,
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  ExcalidrawTableElement,
  FractionalIndex,
  NonDeletedExcalidrawElement,
  TableDataV1,
} from "../src/types";

const withIndex = <T extends ExcalidrawElement>(element: T, index: string): T =>
  newElementWith(element, {
    index: index as ExcalidrawElement["index"],
  } as ElementUpdate<T>);

/**
 * Flat view of one update. `ElementUpdate<NonDeletedExcalidrawElement>`
 * distributes into per-type partials, which is unwieldy for assertions; the
 * command's values are structurally assignable to this bag (they are built
 * as exactly this shape in `tableScale.ts`).
 */
type UpdateBag = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  table?: TableDataV1;
  fontSize?: number;
  baseFontSize?: number | null;
  autoResize?: boolean;
  baseHeight?: number;
  textFitMode?: "auto" | "fixed";
  layoutFrozen?: boolean;
  points?: readonly LocalPoint[];
  fixedSegments?: ExcalidrawElbowArrowElement["fixedSegments"];
  scale?: unknown;
  startBinding?: unknown;
  endBinding?: unknown;
  containerId?: unknown;
};

type ScaleResult = NonNullable<ReturnType<typeof computeTableUniformScale>>;

const updateOf = (result: ScaleResult, elementId: string): UpdateBag =>
  result.updates.get(elementId) as UpdateBag;

const tableCellRef = (
  table: ExcalidrawTableElement,
  cellId: string,
  role: "content" | "backgroundText",
) => ({ kind: "tableCell" as const, elementId: table.id, cellId, role });

const cellIdAt = (
  table: ExcalidrawTableElement,
  rowIndex: number,
  columnIndex: number,
) => table.table.cells[rowIndex * table.table.columns.length + columnIndex].id;

/** Non-uniform 3x3 grid at (100, 50): rows [100, 50, 25], columns [80, 120, 40]. */
const makeNonUniformTable = () => {
  const element = API.createElement({
    type: "table",
    rowCount: 3,
    columnCount: 3,
    x: 100,
    y: 50,
  });
  return newElementWith(element, {
    table: {
      schemaVersion: 1,
      rows: [
        { id: element.table.rows[0].id, height: 100 },
        { id: element.table.rows[1].id, height: 50 },
        { id: element.table.rows[2].id, height: 25 },
      ],
      columns: [
        { id: element.table.columns[0].id, width: 80 },
        { id: element.table.columns[1].id, width: 120 },
        { id: element.table.columns[2].id, width: 40 },
      ],
      cells: element.table.cells,
    },
    width: 240,
    height: 175,
  });
};

/** 2x2 parent (200x150) with a 1x2 child table (100x30) in its first cell. */
const makeNestedTables = () => {
  const parent = API.createElement({
    type: "table",
    rowCount: 2,
    columnCount: 2,
  });
  const sizedParent = newElementWith(parent, {
    table: {
      schemaVersion: 1,
      rows: [
        { id: parent.table.rows[0].id, height: 100 },
        { id: parent.table.rows[1].id, height: 50 },
      ],
      columns: [
        { id: parent.table.columns[0].id, width: 80 },
        { id: parent.table.columns[1].id, width: 120 },
      ],
      cells: parent.table.cells,
    },
    width: 200,
    height: 150,
  });

  const child = API.createElement({
    type: "table",
    rowCount: 1,
    columnCount: 2,
    x: 10,
    y: 10,
  });
  const sizedChild = newElementWith(child, {
    table: {
      schemaVersion: 1,
      rows: [{ id: child.table.rows[0].id, height: 30 }],
      columns: [
        { id: child.table.columns[0].id, width: 40 },
        { id: child.table.columns[1].id, width: 60 },
      ],
      cells: child.table.cells,
    },
    width: 100,
    height: 30,
    containerRef: tableCellRef(
      sizedParent,
      cellIdAt(sizedParent, 0, 0),
      "content",
    ),
  });

  return { parent: sizedParent, child: sizedChild };
};

describe("computeTableUniformScale: grid geometry", () => {
  it("scales every row, column and the element size by the factor", () => {
    const table = makeNonUniformTable();
    const result = computeTableUniformScale([table], table.id, 2);

    expect(result).not.toBeNull();
    expect(result!.clampedScale).toBe(2);

    const update = updateOf(result!, table.id);
    expect(update.x).toBe(100);
    expect(update.y).toBe(50);
    expect(update.width).toBe(480);
    expect(update.height).toBe(350);
    expect(update.table!.rows.map((row) => row.height)).toEqual([200, 100, 50]);
    expect(update.table!.columns.map((column) => column.width)).toEqual([
      160, 240, 80,
    ]);
    // cell identities are untouched by scaling
    expect(update.table!.cells).toBe(table.table.cells);
  });

  it("keeps the caller's anchor point fixed, defaulting to the table corner", () => {
    const table = makeNonUniformTable();

    const anchored = computeTableUniformScale([table], table.id, 2, {
      anchor: { x: 0, y: 0 },
    });
    expect(updateOf(anchored!, table.id).x).toBe(200);
    expect(updateOf(anchored!, table.id).y).toBe(100);
  });
});

describe("computeTableUniformScale: subtree members", () => {
  it("moves and scales cell content around the anchor", () => {
    const table = makeNonUniformTable();
    const content = API.createElement({
      type: "rectangle",
      x: 110,
      y: 60,
      width: 20,
      height: 10,
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });

    const result = computeTableUniformScale([table, content], table.id, 2)!;
    const update = updateOf(result, content.id);
    // anchor is the table's top-left (100, 50)
    expect(update.x).toBe(120);
    expect(update.y).toBe(70);
    expect(update.width).toBe(40);
    expect(update.height).toBe(20);
    expect(result.updates.size).toBe(2);
  });

  it("scales background text fonts and freezes the box only on persist", () => {
    const table = makeNonUniformTable();
    const backgroundText = API.createElement({
      type: "text",
      x: 180,
      y: 150,
      width: 30,
      height: 12,
      fontSize: 10,
      containerRef: tableCellRef(
        table,
        cellIdAt(table, 1, 1),
        "backgroundText",
      ),
    });

    const preview = computeTableUniformScale(
      [table, backgroundText],
      table.id,
      2,
    )!;
    const previewUpdate = updateOf(preview, backgroundText.id);
    expect(previewUpdate.fontSize).toBe(20);
    expect(previewUpdate.autoResize).toBeUndefined();

    const commit = computeTableUniformScale(
      [table, backgroundText],
      table.id,
      2,
      { persistTextModes: true },
    )!;
    const commitUpdate = updateOf(commit, backgroundText.id);
    expect(commitUpdate.fontSize).toBe(20);
    expect(commitUpdate.autoResize).toBe(false);
    expect(commitUpdate.x).toBe(260);
    expect(commitUpdate.y).toBe(250);
  });
});

describe("computeTableUniformScale: text modes and dedup", () => {
  const makeShapeWithBoundText = () => {
    const table = makeNonUniformTable();
    const shape = API.createElement({
      type: "rectangle",
      x: 105,
      y: 55,
      width: 40,
      height: 30,
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });
    const boundText = API.createElement({
      type: "text",
      x: 110,
      y: 60,
      width: 30,
      height: 16,
      fontSize: 8,
      containerId: shape.id,
    });
    return { table, shape, boundText };
  };

  it("switches composite shapes to fixed text fit only on persist", () => {
    const { table, shape, boundText } = makeShapeWithBoundText();

    const preview = computeTableUniformScale(
      [table, shape, boundText],
      table.id,
      2,
    )!;
    expect(updateOf(preview, shape.id).textFitMode).toBeUndefined();
    expect(updateOf(preview, shape.id).width).toBe(80);

    const commit = computeTableUniformScale(
      [table, shape, boundText],
      table.id,
      2,
      { persistTextModes: true },
    )!;
    expect(updateOf(commit, shape.id).textFitMode).toBe("fixed");

    const alreadyFixed = newElementWith(
      shape as ExcalidrawCompositeShapeElement,
      { textFitMode: "fixed" },
    );
    const rerun = computeTableUniformScale(
      [table, alreadyFixed, boundText],
      table.id,
      2,
      { persistTextModes: true },
    )!;
    expect(updateOf(rerun, alreadyFixed.id).textFitMode).toBeUndefined();
  });

  it("transforms a bound text exactly once despite host and scan paths", () => {
    const { table, shape, boundText } = makeShapeWithBoundText();

    const commit = computeTableUniformScale(
      [table, shape, boundText],
      table.id,
      2,
      { persistTextModes: true },
    )!;

    // every subtree element exactly once: table + shape + bound text
    expect(commit.updates.size).toBe(3);
    const update = updateOf(commit, boundText.id);
    // single application, not host-applied and scan-applied (which would be 32)
    expect(update.fontSize).toBe(16);
    expect(update.width).toBe(60);
    // bound texts keep their autoResize and their container: no mode change
    expect(update.autoResize).toBeUndefined();
    expect(update.containerId).toBeUndefined();
  });

  it("keeps standalone text scaling without growing cells back", () => {
    const table = makeNonUniformTable();
    const text = API.createElement({
      type: "text",
      x: 130,
      y: 80,
      width: 50,
      height: 20,
      fontSize: 10,
      containerRef: tableCellRef(table, cellIdAt(table, 0, 1), "content"),
    });

    const commit = computeTableUniformScale([table, text], table.id, 2, {
      persistTextModes: true,
    })!;
    const update = updateOf(commit, text.id);
    expect(update.fontSize).toBe(20);
    expect(update.width).toBe(100);
    expect(update.autoResize).toBe(false);
  });
});

describe("computeTableUniformScale: nested tables", () => {
  it("scales a nested table and its descendants exactly once", () => {
    const { parent, child } = makeNestedTables();
    const grandchild = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 30,
      height: 30,
      containerRef: tableCellRef(child, cellIdAt(child, 0, 0), "content"),
    });

    const result = computeTableUniformScale(
      [parent, child, grandchild],
      parent.id,
      2,
    )!;

    expect(result.updates.size).toBe(3);
    const childUpdate = updateOf(result, child.id);
    // one application of s=2 to the child grid (a double application would
    // produce [120] and [160, 240])
    expect(childUpdate.table!.rows.map((row) => row.height)).toEqual([60]);
    expect(childUpdate.table!.columns.map((column) => column.width)).toEqual([
      80, 120,
    ]);
    expect(childUpdate.width).toBe(200);
    expect(childUpdate.height).toBe(60);
    expect(childUpdate.x).toBe(20);
    expect(childUpdate.y).toBe(20);

    const parentUpdate = updateOf(result, parent.id);
    expect(parentUpdate.table!.rows.map((row) => row.height)).toEqual([
      200, 100,
    ]);
    expect(parentUpdate.table!.columns.map((column) => column.width)).toEqual([
      160, 240,
    ]);

    const grandchildUpdate = updateOf(result, grandchild.id);
    expect(grandchildUpdate.x).toBe(40);
    expect(grandchildUpdate.width).toBe(60);
  });
});

describe("computeTableUniformScale: graphic element kinds", () => {
  it("rescales freedraw path points by the factor", () => {
    const table = makeNonUniformTable();
    const freedraw = API.createElement({
      type: "freedraw",
      x: 0,
      y: 0,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(10, 20),
        pointFrom<LocalPoint>(30, 10),
      ],
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });
    const sized = newElementWith(freedraw, { width: 30, height: 20 });

    const result = computeTableUniformScale([table, sized], table.id, 2)!;
    const update = updateOf(result, sized.id);
    expect(update.points).toEqual([
      [0, 0],
      [20, 40],
      [60, 20],
    ]);
    expect(update.width).toBe(60);
    expect(update.height).toBe(40);
  });

  it("rescales elbow arrow segments and keeps binding fields as-is", () => {
    const table = makeNonUniformTable();
    const arrow = API.createElement({
      type: "arrow",
      x: 0,
      y: 0,
      elbowed: true,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 0),
        pointFrom<LocalPoint>(100, 100),
      ],
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });
    const segmented = newElementWith(arrow as ExcalidrawElbowArrowElement, {
      fixedSegments: [
        {
          index: 1,
          start: pointFrom<LocalPoint>(0, 0),
          end: pointFrom<LocalPoint>(100, 0),
        },
      ],
    });

    const result = computeTableUniformScale([table, segmented], table.id, 2)!;
    const update = updateOf(result, segmented.id);
    expect(update.points).toEqual([
      [0, 0],
      [200, 0],
      [200, 200],
    ]);
    expect(update.fixedSegments).toEqual([
      { index: 1, start: [0, 0], end: [200, 0] },
    ]);
    // binding relations are preserved untouched, never rewritten here
    expect(update.startBinding).toBeUndefined();
    expect(update.endBinding).toBeUndefined();
  });

  it("scales images by width/height only, without flipping", () => {
    const table = makeNonUniformTable();
    const image = API.createElement({
      type: "image",
      x: 100,
      y: 50,
      width: 50,
      height: 25,
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });

    const result = computeTableUniformScale([table, image], table.id, 2)!;
    const update = updateOf(result, image.id);
    expect(update.width).toBe(100);
    expect(update.height).toBe(50);
    expect(update.scale).toBeUndefined();
  });
});

describe("computeTableUniformScale: sticky notes", () => {
  const makeNoteWithLabel = () => {
    const table = makeNonUniformTable();
    const note = newElementWith(
      API.createElement({
        type: "stickynote",
        x: 10,
        y: 10,
        width: 200,
        height: 200,
        containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
      }),
      { baseHeight: 200 },
    );
    const label = newElementWith(
      API.createElement({
        type: "text",
        x: 20,
        y: 20,
        width: 100,
        height: 50,
        fontSize: 40,
        containerId: note.id,
      }),
      { baseFontSize: 40 },
    );
    return { table, note, label };
  };

  it("freezes the sticky layout on persist: baseHeight and font ceiling scale", () => {
    const { table, note, label } = makeNoteWithLabel();

    const commit = computeTableUniformScale([table, note, label], table.id, 2, {
      persistTextModes: true,
    })!;
    const noteUpdate = updateOf(commit, note.id);
    expect(noteUpdate.width).toBe(400);
    expect(noteUpdate.height).toBe(400);
    expect(noteUpdate.baseHeight).toBe(400);
    const labelUpdate = updateOf(commit, label.id);
    expect(labelUpdate.fontSize).toBe(80);
    expect(labelUpdate.baseFontSize).toBe(80);
    // no layout pass here — the frozen numbers are the whole update
    expect(commit.updates.size).toBe(3);
  });

  it("leaves the frozen layout fields untouched for previews", () => {
    const { table, note, label } = makeNoteWithLabel();

    const preview = computeTableUniformScale(
      [table, note, label],
      table.id,
      2,
    )!;
    const noteUpdate = updateOf(preview, note.id);
    expect(noteUpdate.width).toBe(400);
    expect(noteUpdate.baseHeight).toBeUndefined();
    const labelUpdate = updateOf(preview, label.id);
    expect(labelUpdate.fontSize).toBe(80);
    expect(labelUpdate.baseFontSize).toBeUndefined();
  });
});

describe("computeTableUniformScale: mindmap subtrees", () => {
  /** Root + child node + edge + the root's bound label, spread over cells. */
  const makeMindmapSubtree = () => {
    const table = makeNonUniformTable();
    const root = API.createElement({
      type: "mindmap-node",
      x: 110,
      y: 60,
      width: 160,
      height: 56,
      mindmap: {
        graphId: "mm",
        shape: { id: "rectangle", schemaVersion: 1 },
        collapsed: false,
        parentId: null,
        order: null,
      },
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });
    const child = API.createElement({
      type: "mindmap-node",
      x: 350,
      y: 80,
      width: 120,
      height: 40,
      mindmap: {
        graphId: "mm",
        parentId: root.id,
        order: "a0" as FractionalIndex,
        shape: { id: "rectangle", schemaVersion: 1 },
        collapsed: false,
      },
      containerRef: tableCellRef(table, cellIdAt(table, 0, 1), "content"),
    });
    const edge = API.createElement({
      type: "mindmap-edge",
      x: 270,
      y: 80,
      width: 160,
      height: 20,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(80, 0),
        pointFrom<LocalPoint>(80, 20),
        pointFrom<LocalPoint>(160, 20),
      ],
      mindmap: {
        graphId: "mm",
        parentId: root.id,
        childId: child.id,
        routing: "orthogonal" as const,
      },
    });
    const label = API.createElement({
      type: "text",
      x: 120,
      y: 70,
      width: 80,
      height: 20,
      fontSize: 20,
      containerId: root.id,
    });
    return { table, root, child, edge, label };
  };

  it("scales nodes, edges and bound text, freezing the layout on persist", () => {
    const { table, root, child, edge, label } = makeMindmapSubtree();
    const elements = [table, root, child, edge, label];

    const preview = computeTableUniformScale(elements, table.id, 2)!;
    expect(preview.updates.size).toBe(5);
    const previewRoot = updateOf(preview, root.id);
    expect(previewRoot.x).toBe(120);
    expect(previewRoot.width).toBe(320);
    // the freeze is a mode switch: previews never write it
    expect(previewRoot.layoutFrozen).toBeUndefined();

    const commit = computeTableUniformScale(elements, table.id, 2, {
      persistTextModes: true,
    })!;
    const rootUpdate = updateOf(commit, root.id);
    expect(rootUpdate.layoutFrozen).toBe(true);
    expect(rootUpdate.x).toBe(120);
    expect(rootUpdate.width).toBe(320);
    expect(rootUpdate.height).toBe(112);
    expect(updateOf(commit, child.id).layoutFrozen).toBe(true);

    // the edge keeps the same factor on its absolute frame and local path
    const edgeUpdate = updateOf(commit, edge.id);
    expect(edgeUpdate.x).toBe(440);
    expect(edgeUpdate.y).toBe(110);
    expect(edgeUpdate.points).toEqual([
      [0, 0],
      [160, 0],
      [160, 40],
      [320, 40],
    ]);
    expect(updateOf(commit, label.id).fontSize).toBe(40);
  });

  it("does not re-write the freeze marker on already frozen nodes", () => {
    const { table, root, child, edge, label } = makeMindmapSubtree();
    const frozenRoot = newElementWith(root, { layoutFrozen: true });

    const commit = computeTableUniformScale(
      [table, frozenRoot, child, edge, label],
      table.id,
      2,
      { persistTextModes: true },
    )!;
    expect(updateOf(commit, frozenRoot.id).layoutFrozen).toBeUndefined();
    expect(updateOf(commit, child.id).layoutFrozen).toBe(true);
  });
});

describe("computeTableUniformScale: minimum size clamp", () => {
  it("clamps the whole subtree to the largest descendant floor", () => {
    // parent 1x1 (100x100); child 1x1 with a 10-high row and a 40-wide
    // column; a 2px text inside the child
    const parent = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
    });
    const sizedParent = newElementWith(parent, {
      table: {
        schemaVersion: 1,
        rows: [{ id: parent.table.rows[0].id, height: 100 }],
        columns: [{ id: parent.table.columns[0].id, width: 100 }],
        cells: parent.table.cells,
      },
      width: 100,
      height: 100,
    });
    const child = API.createElement({
      type: "table",
      rowCount: 1,
      columnCount: 1,
      containerRef: tableCellRef(
        sizedParent,
        cellIdAt(sizedParent, 0, 0),
        "content",
      ),
    });
    const sizedChild = newElementWith(child, {
      table: {
        schemaVersion: 1,
        rows: [{ id: child.table.rows[0].id, height: 10 }],
        columns: [{ id: child.table.columns[0].id, width: 40 }],
        cells: child.table.cells,
      },
      width: 40,
      height: 10,
    });
    const text = API.createElement({
      type: "text",
      x: 5,
      y: 5,
      width: 10,
      height: 4,
      fontSize: 2,
      containerRef: tableCellRef(
        sizedChild,
        cellIdAt(sizedChild, 0, 0),
        "content",
      ),
    });

    // the child row hits MIN_TABLE_ROW_HEIGHT first: floor = 24 / 10
    const floor = MIN_TABLE_ROW_HEIGHT / 10;
    expect(floor).toBeGreaterThan(0.5);
    expect(MIN_TABLE_COLUMN_WIDTH / 40).toBeLessThan(floor);

    const result = computeTableUniformScale(
      [sizedParent, sizedChild, text],
      sizedParent.id,
      0.5,
    )!;

    // nothing shrinks: the request is clamped up to the descendant's floor
    expect(result.clampedScale).toBe(floor);
    const parentUpdate = updateOf(result, sizedParent.id);
    expect(parentUpdate.table!.rows[0].height).toBeCloseTo(100 * floor, 10);
    const childUpdate = updateOf(result, sizedChild.id);
    expect(childUpdate.table!.rows[0].height).toBeCloseTo(10 * floor, 10);
    expect(childUpdate.table!.rows[0].height).toBeCloseTo(
      MIN_TABLE_ROW_HEIGHT,
      10,
    );
    // the text does not stop earlier than the table: same factor everywhere
    expect(updateOf(result, text.id).fontSize).toBeCloseTo(2 * floor, 10);
  });

  it("does not clamp an upscale above every floor", () => {
    const table = makeNonUniformTable();
    const result = computeTableUniformScale([table], table.id, 3)!;
    expect(result.clampedScale).toBe(3);
  });
});

describe("computeTableUniformScale: inputs", () => {
  it("reuses a prepared subtree across preview and commit scales", () => {
    const table = makeNonUniformTable();
    const content = API.createElement({
      type: "rectangle",
      x: 110,
      y: 60,
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });
    const elements = [table, content];
    const anchor = { x: 20, y: 30 };
    const prepared = prepareTableUniformScale(elements, table.id, anchor)!;

    for (const scale of [0.5, 1.5]) {
      for (const persistTextModes of [false, true]) {
        const options = { anchor, persistTextModes };
        expect(
          computeTableUniformScale(
            elements,
            table.id,
            scale,
            options,
            prepared,
          ),
        ).toEqual(computeTableUniformScale(elements, table.id, scale, options));
      }
    }
  });

  it("returns null for unknown ids, non-tables and deleted tables", () => {
    const table = makeNonUniformTable();
    const rectangle = API.createElement({ type: "rectangle" });

    expect(computeTableUniformScale([table], "missing", 2)).toBeNull();
    expect(computeTableUniformScale([rectangle], rectangle.id, 2)).toBeNull();

    const deleted = { ...table, isDeleted: true } as ExcalidrawTableElement;
    expect(computeTableUniformScale([deleted], table.id, 2)).toBeNull();
  });

  it("rejects non-positive and non-finite scale requests", () => {
    const table = makeNonUniformTable();

    expect(() => computeTableUniformScale([table], table.id, 0)).toThrow(
      "Invalid table scale",
    );
    expect(() => computeTableUniformScale([table], table.id, -2)).toThrow(
      "Invalid table scale",
    );
    expect(() =>
      computeTableUniformScale([table], table.id, Number.NaN),
    ).toThrow("Invalid table scale");
  });

  it("skips deleted members of the subtree", () => {
    const table = makeNonUniformTable();
    const content = API.createElement({
      type: "rectangle",
      x: 110,
      y: 60,
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });
    const deleted = { ...content, isDeleted: true } as ExcalidrawElement;

    const result = computeTableUniformScale([table, deleted], table.id, 2)!;
    expect(result.updates.size).toBe(1);
    expect(result.updates.has(deleted.id)).toBe(false);
  });

  it("agrees between the registered children index and a plain array scan", () => {
    const { parent, child } = makeNestedTables();
    const grandchild = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      containerRef: tableCellRef(child, cellIdAt(child, 0, 0), "content"),
    });
    const boundText = API.createElement({
      type: "text",
      x: 25,
      y: 25,
      fontSize: 8,
      containerId: grandchild.id,
    });
    const elements = [
      withIndex(parent, "a0"),
      withIndex(child, "a1"),
      withIndex(grandchild, "a2"),
      withIndex(boundText, "a3"),
    ];

    const scene = new Scene(elements as NonDeletedExcalidrawElement[]);
    const sceneElements = scene.getElementsIncludingDeleted();
    // the indexed path is really engaged for the parent table
    expect(
      getIndexedTableChildren(sceneElements, parent.id)!.map((e) => e.id),
    ).toEqual([child.id]);

    const indexed = computeTableUniformScale(sceneElements, parent.id, 2)!;
    const scanned = computeTableUniformScale(elements, parent.id, 2)!;

    expect(indexed).not.toBeNull();
    expect(scanned).not.toBeNull();
    expect(indexed.updates).toEqual(scanned.updates);
    expect(indexed.clampedScale).toBe(scanned.clampedScale);
  });

  it("recomputes the element size from the scaled grid, not separately", () => {
    const table = makeNonUniformTable();
    const result = computeTableUniformScale([table], table.id, 3)!;
    const update = updateOf(result, table.id);
    expect(update.width).toBe(720);
    expect(update.height).toBe(525);
    expect(isTableElement(table)).toBe(true);
  });
});
