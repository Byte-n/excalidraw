import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { arrayToMap } from "@excalidraw/common";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { newElementWith } from "../src/mutateElement";
import { resizeMultipleElements } from "../src/resizeElements";
import { Scene } from "../src/Scene";
import { MIN_TABLE_ROW_HEIGHT } from "../src/tableScale";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
  TableDataV1,
} from "../src/types";

/**
 * P01.2: a selection containing a table goes through the generic multi-select
 * resize (`resizeMultipleElements`), whose table branch owns the subtree via
 * the table-scale command. These tests pin the selection-level behavior:
 * uniform corners, single-axis sides, the subtree floor feeding back into the
 * selection scale, no flip, and members transforming exactly once.
 */

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

type UpdateBag = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  table?: TableDataV1;
  fontSize?: number;
};

/**
 * Runs one multi-selection resize against a fresh scene. `selected` is what a
 * box-select would hand over (table included, subtree members as-is); every
 * scene element gets a pointer-down snapshot.
 */
const runResize = (
  elements: NonDeletedExcalidrawElement[],
  selectedIds: string[],
  handleDirection: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w",
  options: {
    nextWidth?: number;
    nextHeight?: number;
    flipByX?: boolean;
    flipByY?: boolean;
    shouldResizeFromCenter?: boolean;
  } = {},
) => {
  const scene = new Scene(elements, { skipValidation: true });
  const originalElementsMap = arrayToMap(
    scene.getElementsIncludingDeleted().map((element) => ({ ...element })),
  );
  resizeMultipleElements(
    elements.filter((element) => selectedIds.includes(element.id)),
    scene.getNonDeletedElementsMap(),
    handleDirection,
    scene,
    originalElementsMap,
    options,
  );
  return scene;
};

const elementOf = (scene: Scene, id: string) =>
  scene.getNonDeletedElement(id) as ExcalidrawElement;

describe("resizeMultipleElements: selection containing a table", () => {
  it("scales the whole selection uniformly from the selection's anchor", () => {
    const table = makeNonUniformTable();
    // sits up-left of the table: the selection bbox anchor for "se" is (0, 0)
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const scene = runResize(
      [rectangle, table],
      [rectangle.id, table.id],
      "se",
      {
        nextWidth: 680,
        nextHeight: 450,
      },
    );

    const scaledTable = elementOf(scene, table.id) as ExcalidrawTableElement;
    // anchored at the selection's corner (0, 0), not the table's own (100, 50)
    expect(scaledTable.x).toBe(200);
    expect(scaledTable.y).toBe(100);
    expect(scaledTable.width).toBe(480);
    expect(scaledTable.height).toBe(350);
    expect(scaledTable.table.rows.map((row) => row.height)).toEqual([
      200, 100, 50,
    ]);
    expect(scaledTable.table.columns.map((column) => column.width)).toEqual([
      160, 240, 80,
    ]);

    const scaledRectangle = elementOf(scene, rectangle.id);
    expect(scaledRectangle.x).toBe(0);
    expect(scaledRectangle.y).toBe(0);
    expect(scaledRectangle.width).toBe(20);
    expect(scaledRectangle.height).toBe(20);
  });

  it("stretches one axis only on a side handle and keeps subtree fonts", () => {
    const table = makeNonUniformTable();
    const text = API.createElement({
      type: "text",
      x: 120,
      y: 70,
      width: 50,
      height: 20,
      fontSize: 20,
      containerRef: tableCellRef(table, cellIdAt(table, 0, 1), "content"),
    });
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    // the text is a subtree member but not selected (box-select merges it
    // away); the side handle stretches x only — the caller always passes
    // both dimensions, the untouched axis keeping the bbox height
    const scene = runResize(
      [rectangle, table, text],
      [rectangle.id, table.id],
      "e",
      { nextWidth: 680, nextHeight: 225 },
    );

    const scaledTable = elementOf(scene, table.id) as ExcalidrawTableElement;
    expect(scaledTable.table.columns.map((column) => column.width)).toEqual([
      160, 240, 80,
    ]);
    // the untouched axis stays exact
    expect(scaledTable.table.rows.map((row) => row.height)).toEqual([
      100, 50, 25,
    ]);
    expect(scaledTable.width).toBe(480);
    expect(scaledTable.height).toBe(175);
    expect(scaledTable.y).toBe(50);

    const scaledText = elementOf(scene, text.id) as ExcalidrawTextElement;
    // single-axis rule: geometry distorts, fonts do not
    expect(scaledText.fontSize).toBe(20);
    expect(scaledText.width).toBe(100);
    expect(scaledText.height).toBe(20);
    expect(scaledText.y).toBe(70);

    const scaledRectangle = elementOf(scene, rectangle.id);
    expect(scaledRectangle.width).toBe(20);
    expect(scaledRectangle.height).toBe(10);
  });

  it("stops the whole selection at the table's subtree floor", () => {
    const table = makeNonUniformTable();
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    // request 0.5x: the thinnest row (25) floors the subtree at 24 / 25
    const scene = runResize(
      [rectangle, table],
      [rectangle.id, table.id],
      "se",
      {
        nextWidth: 170,
        nextHeight: 112.5,
      },
    );

    const floor = MIN_TABLE_ROW_HEIGHT / 25;
    const scaledRectangle = elementOf(scene, rectangle.id);
    // the selection clamps with the table instead of shrinking past it
    expect(scaledRectangle.width).toBeCloseTo(10 * floor, 10);
    expect(scaledRectangle.height).toBeCloseTo(10 * floor, 10);

    const scaledTable = elementOf(scene, table.id) as ExcalidrawTableElement;
    expect(scaledTable.table.rows[2].height).toBeCloseTo(
      MIN_TABLE_ROW_HEIGHT,
      10,
    );
  });

  it("clamps a side stretch at its own axis floor", () => {
    const table = makeNonUniformTable();
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    // request 0.5x on x: the thinnest column (40) floors the axis at 24 / 40
    const scene = runResize([rectangle, table], [rectangle.id, table.id], "e", {
      nextWidth: 170,
      nextHeight: 225,
    });

    const scaledRectangle = elementOf(scene, rectangle.id);
    expect(scaledRectangle.width).toBeCloseTo(10 * (24 / 40), 6);
    expect(scaledRectangle.height).toBe(10);

    const scaledTable = elementOf(scene, table.id) as ExcalidrawTableElement;
    expect(scaledTable.table.columns[2].width).toBeCloseTo(24, 6);
    expect(scaledTable.table.rows[2].height).toBe(25);
  });

  it("does not flip when the pointer crosses the anchor", () => {
    const table = makeNonUniformTable();
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const scene = runResize(
      [rectangle, table],
      [rectangle.id, table.id],
      "se",
      {
        nextWidth: 680,
        nextHeight: 450,
        flipByX: true,
        flipByY: true,
      },
    );

    const scaledRectangle = elementOf(scene, rectangle.id);
    // no mirror: the selection parks at the scaled geometry
    expect(scaledRectangle.x).toBe(0);
    expect(scaledRectangle.y).toBe(0);
    expect(scaledRectangle.width).toBe(20);

    const scaledTable = elementOf(scene, table.id) as ExcalidrawTableElement;
    expect(scaledTable.x).toBe(200);
    expect(scaledTable.y).toBe(100);
    expect(scaledTable.table.rows.map((row) => row.height)).toEqual([
      200, 100, 50,
    ]);
  });

  it("transforms nested selected tables exactly once", () => {
    const { parent, child } = makeNestedTables();

    const scene = runResize([parent, child], [parent.id, child.id], "se", {
      nextWidth: 400,
      nextHeight: 300,
    });

    const scaledChild = elementOf(scene, child.id) as ExcalidrawTableElement;
    // one application of s=2 through the parent's bag (a double application
    // would produce [120] and [160, 240])
    expect(scaledChild.table.rows.map((row) => row.height)).toEqual([60]);
    expect(scaledChild.table.columns.map((column) => column.width)).toEqual([
      80, 120,
    ]);
    expect(scaledChild.x).toBe(20);
    expect(scaledChild.y).toBe(20);

    const scaledParent = elementOf(scene, parent.id) as ExcalidrawTableElement;
    expect(scaledParent.table.rows.map((row) => row.height)).toEqual([
      200, 100,
    ]);
    expect(scaledParent.table.columns.map((column) => column.width)).toEqual([
      160, 240,
    ]);
  });

  it("scales a cell member and its bound text exactly once", () => {
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
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const scene = runResize(
      [rectangle, table, shape, boundText],
      [rectangle.id, table.id, shape.id],
      "se",
      { nextWidth: 680, nextHeight: 450 },
    );

    const scaledShape = elementOf(scene, shape.id);
    expect(scaledShape.x).toBe(210);
    expect(scaledShape.y).toBe(110);
    expect(scaledShape.width).toBe(80);
    expect(scaledShape.height).toBe(60);

    const scaledText = elementOf(scene, boundText.id) as ExcalidrawTextElement;
    expect(scaledText.fontSize).toBe(16);
    expect(scaledText.width).toBe(60);
  });

  it("leaves text-mode fields unpublished during the preview", () => {
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
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    // the note is a subtree member, not selected: the resize preview scales
    // its geometry while the mode fields wait for the pointer-up commit
    const scene = runResize(
      [rectangle, table, note, label],
      [rectangle.id, table.id],
      "se",
      {
        nextWidth: 680,
        nextHeight: 450,
      },
    );

    const scaledNote = elementOf(scene, note.id);
    expect(scaledNote.width).toBe(400);
    expect(scaledNote.height).toBe(400);
    expect((scaledNote as any).baseHeight).toBe(200);

    const scaledLabel = elementOf(scene, label.id) as ExcalidrawTextElement;
    expect(scaledLabel.fontSize).toBe(80);
    expect((scaledLabel as any).baseFontSize).toBe(40);
  });

  it("keeps the grid invariant exact through the resize", () => {
    const table = makeNonUniformTable();
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const scene = runResize(
      [rectangle, table],
      [rectangle.id, table.id],
      "se",
      {
        nextWidth: 510,
        nextHeight: 337.5,
      },
    );

    const scaledTable = elementOf(scene, table.id) as ExcalidrawTableElement;
    const columnsSum = scaledTable.table.columns.reduce(
      (acc, column) => acc + column.width,
      0,
    );
    const rowsSum = scaledTable.table.rows.reduce(
      (acc, row) => acc + row.height,
      0,
    );
    expect(scaledTable.width).toBe(columnsSum);
    expect(scaledTable.height).toBe(rowsSum);
  });

  it("rescales freedraw paths of subtree members without flipping", () => {
    const table = makeNonUniformTable();
    const freedraw = API.createElement({
      type: "freedraw",
      x: 0,
      y: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(10, 20)],
      containerRef: tableCellRef(table, cellIdAt(table, 0, 0), "content"),
    });
    const sized = newElementWith(freedraw, { width: 10, height: 20 });
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const scene = runResize(
      [rectangle, table, sized],
      [rectangle.id, table.id],
      "se",
      {
        // bbox (0,0)-(340,225): scale = max(680/340, 450/225) = 2
        nextWidth: 680,
        nextHeight: 450,
        flipByX: true,
      },
    );

    const scaled = elementOf(scene, sized.id);
    expect(scaled.width).toBe(20);
    expect(scaled.height).toBe(40);
  });
});
