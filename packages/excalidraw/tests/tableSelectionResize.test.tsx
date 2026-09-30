import { KEYS } from "@excalidraw/common";
import type { Radians } from "@excalidraw/math";
import {
  getCommonBounds,
  getTransformHandlesFromCoords,
  newElementWith,
} from "@excalidraw/element";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";

import { render, act, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

const selectElements = (elements: { id: string }[]) => {
  act(() => {
    h.setState({
      selectedElementIds: elements.reduce(
        (acc, element) => ({ ...acc, [element.id]: true }),
        {},
      ),
    });
  });
};

/** selection-handle center in client coords for the given bounds */
const handleCenter = (bounds: readonly number[], handle: "se") => {
  const [x1, y1, x2, y2] = bounds;
  const handles = getTransformHandlesFromCoords(
    [x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2],
    0 as Radians,
    h.state.zoom,
    "mouse",
  );
  const coords = handles[handle]!;
  return [coords[0] + coords[2] / 2, coords[1] + coords[3] / 2] as const;
};

const cellRef = (table: ExcalidrawTableElement, index: number) => ({
  kind: "tableCell" as const,
  elementId: table.id,
  cellId: table.table.cells[index].id,
  role: "content" as const,
});

describe("multi-selection resize containing a table", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("scales the box-selected table subtree with the selection", async () => {
    const table = API.createElement({ type: "table", x: 100, y: 100 });
    const member = API.createElement({
      type: "rectangle",
      x: 110,
      y: 110,
      width: 40,
      height: 40,
      containerRef: cellRef(table, 0),
    });
    const outside = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    API.setElements([table, member, outside]);
    selectElements([table, member, outside]);

    // bbox (0,0)-(580,268): +116/+53.6 is a uniform 1.2x from the "se" handle
    const [cx, cy] = handleCenter(
      getCommonBounds([table, member, outside]),
      "se",
    );
    mouse.downAt(cx, cy);
    mouse.moveTo(cx + 116, cy + 53.6);
    mouse.up();

    const scaledTable = h.app.scene.getElement(
      table.id,
    ) as ExcalidrawTableElement;
    // anchored at the selection's corner (0, 0)
    expect(scaledTable.x).toBeCloseTo(120, 6);
    expect(scaledTable.y).toBeCloseTo(120, 6);
    expect(scaledTable.table.columns[0].width).toBeCloseTo(192, 6);
    expect(scaledTable.table.rows[0].height).toBeCloseTo(67.2, 6);
    // the outer frame still equals the row/column sums
    expect(scaledTable.width).toBeCloseTo(
      scaledTable.table.columns.reduce((acc, column) => acc + column.width, 0),
      6,
    );
    expect(scaledTable.height).toBeCloseTo(
      scaledTable.table.rows.reduce((acc, row) => acc + row.height, 0),
      6,
    );

    // the cell member follows the table exactly once
    const scaledMember = h.app.scene.getElement(member.id)!;
    expect(scaledMember.x).toBeCloseTo(132, 6);
    expect(scaledMember.y).toBeCloseTo(132, 6);
    expect(scaledMember.width).toBeCloseTo(48, 6);

    const scaledOutside = h.app.scene.getElement(outside.id)!;
    expect(scaledOutside.width).toBeCloseTo(12, 6);
    expect(scaledOutside.height).toBeCloseTo(12, 6);
  });

  it("box-select merges the table's subtree into the table", async () => {
    const table = API.createElement({ type: "table", x: 100, y: 100 });
    const member = API.createElement({
      type: "rectangle",
      x: 110,
      y: 110,
      width: 40,
      height: 40,
      containerRef: cellRef(table, 0),
    });
    const independent = API.createElement({
      type: "rectangle",
      x: 620,
      y: 120,
      width: 30,
      height: 30,
    });
    API.setElements([table, member, independent]);

    // drag a selection box over the table (with its member) and the rectangle
    mouse.downAt(10, 10);
    // the first move arms the box-select; the second drags the marquee
    mouse.moveTo(20, 20);
    mouse.moveTo(700, 320);
    mouse.up();

    // selecting the table stands for its subtree: the member merges away
    expect(h.state.selectedElementIds).toEqual({
      [table.id]: true,
      [independent.id]: true,
    });
  });

  it("persists text modes once on release", async () => {
    const table = API.createElement({ type: "table", x: 100, y: 100 });
    const text = API.createElement({
      type: "text",
      x: 110,
      y: 110,
      width: 50,
      height: 20,
      fontSize: 20,
      containerRef: cellRef(table, 0),
    });
    let note = API.createElement({
      type: "stickynote",
      x: 300,
      y: 110,
      width: 100,
      height: 100,
      containerRef: cellRef(table, 1),
    });
    note = newElementWith(note, { baseHeight: 100 });
    let label = API.createElement({
      type: "text",
      x: 310,
      y: 120,
      width: 50,
      height: 50,
      fontSize: 40,
      containerId: note.id,
    });
    label = newElementWith(label, { baseFontSize: 40 });
    const outside = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    API.setElements([table, text, note, label, outside]);
    selectElements([table, text, note, label, outside]);

    const [cx, cy] = handleCenter(
      getCommonBounds([table, text, note, label, outside]),
      "se",
    );
    mouse.downAt(cx, cy);
    mouse.moveTo(cx + 116, cy + 53.6);
    mouse.up();

    // the release commit switched the modes with the geometry
    const committedText = h.app.scene.getElement(
      text.id,
    ) as ExcalidrawTextElement;
    expect(committedText.fontSize).toBeCloseTo(24, 6);
    expect(committedText.autoResize).toBe(false);

    const committedNote = h.app.scene.getElement(note.id)! as any;
    expect(committedNote.width).toBeCloseTo(120, 6);
    expect(committedNote.baseHeight).toBeCloseTo(120, 6);

    const committedLabel = h.app.scene.getElement(
      label.id,
    ) as ExcalidrawTextElement;
    expect(committedLabel.fontSize).toBeCloseTo(48, 6);
    expect((committedLabel as any).baseFontSize).toBeCloseTo(48, 6);
  });

  it("esc restores the scene and disarms the resize", async () => {
    const table = API.createElement({ type: "table", x: 100, y: 100 });
    const outside = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    API.setElements([table, outside]);
    selectElements([table, outside]);

    const [cx, cy] = handleCenter(getCommonBounds([table, outside]), "se");
    mouse.downAt(cx, cy);
    mouse.moveTo(cx + 116, cy + 53.6);
    expect(
      (h.app.scene.getElement(table.id) as ExcalidrawTableElement).width,
    ).toBeCloseTo(576, 6);

    Keyboard.keyDown(KEYS.ESCAPE);
    expect(h.state.isResizing).toBe(false);

    // the arm-time scene is back verbatim
    const restoredTable = h.app.scene.getElement(
      table.id,
    ) as ExcalidrawTableElement;
    expect(restoredTable.width).toBe(480);
    expect(restoredTable.x).toBe(100);
    expect(h.app.scene.getElement(outside.id)!.width).toBe(10);

    // the resize stays disarmed: later moves and the release change nothing
    mouse.moveTo(cx + 200, cy + 100);
    mouse.up();
    expect(
      (h.app.scene.getElement(table.id) as ExcalidrawTableElement).width,
    ).toBe(480);
    expect(h.app.scene.getElement(outside.id)!.width).toBe(10);
  });

  it("keeps the single-table gesture path for a lone selected table", async () => {
    const table = API.createElement({ type: "table", x: 100, y: 100 });
    API.setElements([table]);
    // the "se" handle center sits at (584, 272) — moving the pointer to
    // (628, 284.8) is a uniform 1.1x from the opposite corner (100, 100)
    UI.resize(table, "se", [44, 12.8]);

    // the dedicated gesture scales the table without a generic multi-select
    // session, keeping the grid sums exact
    const scaled = h.app.scene.getElement(table.id) as ExcalidrawTableElement;
    expect(scaled.width).toBeCloseTo(528, 6);
    expect(scaled.table.columns[0].width).toBeCloseTo(176, 6);
    expect(scaled.table.rows[0].height).toBeCloseTo(61.6, 6);
  });
});
