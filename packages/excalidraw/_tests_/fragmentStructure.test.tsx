import {
  KEYS,
  TABLE_CELL_TEXT_PADDING_X,
  TABLE_CELL_TEXT_PADDING_Y,
  TABLE_STRUCTURE_INSERTION_OFFSET,
} from "@excalidraw/common";

import type {
  ExcalidrawSequenceElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getFragmentStructureHoverAtSceneCoords } from "../components/app/fragment";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";

import {
  act,
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
} from "./test-utils";

unmountComponent();

const { h } = window;

const mouseDown = (clientX: number, clientY: number) => {
  fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};
const mouseMove = (clientX: number, clientY: number) => {
  fireEvent.pointerMove(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};
const mouseUp = (clientX: number, clientY: number) => {
  fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};
const clickAt = (clientX: number, clientY: number) => {
  mouseDown(clientX, clientY);
  mouseUp(clientX, clientY);
};
const doubleClickAt = (clientX: number, clientY: number) => {
  fireEvent.doubleClick(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
  });
};
const getRowTexts = () =>
  h.elements.filter(
    (element): element is ExcalidrawTextElement =>
      element.type === "text" &&
      !element.isDeleted &&
      element.containerRef?.kind === "fragmentRow",
  );

const HEADER_HEIGHT = 36.272;
const BODY_HEIGHT = 203.728;

type FragmentElement = ExcalidrawSequenceElement & {
  shape: Extract<ExcalidrawSequenceElement["shape"], { id: "sc-fragment" }>;
};

const getFragment = (id: string) =>
  h.elements.find(
    (element): element is FragmentElement =>
      element.id === id && element.type === "sequence",
  )!;

const createFixture = () => {
  const fragment = API.createElement({
    type: "sequence",
    x: 100,
    y: 100,
    width: 400,
    height: 240,
    shape: {
      id: "sc-fragment",
      schemaVersion: 1,
      fragment: {
        rows: [
          { id: "header", height: HEADER_HEIGHT },
          { id: "body", height: BODY_HEIGHT },
        ],
      },
    },
  });
  API.setElements([fragment]);
  return getFragment(fragment.id);
};

describe("sequence fragment row structure", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("resolves the left rail and the insertion dot on the row axis", () => {
    const fragment = createFixture();
    expect(
      getFragmentStructureHoverAtSceneCoords(h.app, {
        x: fragment.x - 12,
        y: fragment.y + HEADER_HEIGHT + 20,
      }),
    ).toEqual({
      elementId: fragment.id,
      kind: "rowGrip",
      rowId: "body",
    });
    expect(
      getFragmentStructureHoverAtSceneCoords(h.app, {
        x: fragment.x - TABLE_STRUCTURE_INSERTION_OFFSET,
        y: fragment.y + HEADER_HEIGHT,
      }),
    ).toEqual({
      elementId: fragment.id,
      kind: "rowInsert",
      boundaryIndex: 1,
    });
  });

  it("inserts a condition row when the dot is clicked", () => {
    const fragment = createFixture();
    const x = fragment.x - TABLE_STRUCTURE_INSERTION_OFFSET;
    const y = fragment.y + HEADER_HEIGHT;
    mouseMove(x, y);
    mouseDown(x, y);
    mouseUp(x, y);

    const live = getFragment(fragment.id);
    expect(live.shape.fragment?.rows.map((row) => row.id)).toEqual([
      "header",
      expect.any(String),
      "body",
    ]);
    expect(live.height).toBeCloseTo(240 + 56, 6);
    expect(live.shape.fragment?.rows[1].height).toBeCloseTo(56, 6);
  });

  it("selects a row from the grip and deletes it with the Delete command", async () => {
    const fragment = createFixture();
    const x = fragment.x - 12;
    const y = fragment.y + HEADER_HEIGHT + BODY_HEIGHT / 2;
    mouseMove(x, y);
    mouseDown(x, y);
    mouseUp(x, y);

    expect(h.state.fragmentRowSelection).toEqual({
      elementId: fragment.id,
      rowId: "body",
    });
    await act(async () => {
      expect(h.app.deleteSelectedFragmentRow()).toBe(true);
    });
    const live = getFragment(fragment.id);
    expect(live.shape.fragment?.rows.map((row) => row.id)).toEqual(["header"]);
    expect(live.height).toBeCloseTo(HEADER_HEIGHT, 6);
    expect(h.state.fragmentRowSelection).toBeNull();
  });

  it("creates a body row background text on double click and grows the row while typing", async () => {
    const fragment = createFixture();
    const x = fragment.x + fragment.width / 2;
    const y = fragment.y + HEADER_HEIGHT + BODY_HEIGHT / 2;
    doubleClickAt(x, y);

    const editor = await getTextEditor();
    const texts = getRowTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0].containerRef).toEqual({
      kind: "fragmentRow",
      elementId: fragment.id,
      rowId: "body",
      role: "backgroundText",
    });
    expect(texts[0].containerId).toBeNull();
    expect(texts[0].autoResize).toBe(false);
    // fragment row text is fixed top-left inside the table cell padding
    expect(texts[0].textAlign).toBe("left");
    expect(texts[0].verticalAlign).toBe("top");
    expect(texts[0].x).toBeCloseTo(
      fragment.x + TABLE_CELL_TEXT_PADDING_X,
      6,
    );
    expect(texts[0].y).toBeCloseTo(
      fragment.y + HEADER_HEIGHT + TABLE_CELL_TEXT_PADDING_Y,
      6,
    );
    expect(h.state.editingTextElement?.id).toBe(texts[0].id);

    updateTextEditor(
      editor,
      "A long condition label that wraps onto several lines inside the row and must stay visible while it is being edited. ".repeat(
        10,
      ),
    );

    const live = getFragment(fragment.id);
    expect(live.height).toBeGreaterThan(240);
    const bodyRow = live.shape.fragment?.rows[1];
    expect(bodyRow?.height).toBeGreaterThan(BODY_HEIGHT);
    const text = getRowTexts()[0];
    expect(text.height).toBeLessThanOrEqual(bodyRow!.height);
    // table cell padding: 12px on each side
    expect(text.width).toBeLessThanOrEqual(live.width - 24);

    Keyboard.exitTextEditor(editor);
  });

  it("double-clicking the header keeps editing the operator label", async () => {
    const fragment = createFixture();
    doubleClickAt(
      fragment.x + fragment.width / 2,
      fragment.y + HEADER_HEIGHT / 2,
    );

    const editor = await getTextEditor();
    expect(getRowTexts()).toHaveLength(0);
    // the generic path binds a text to the fragment (the operator tab label)
    expect(h.state.editingTextElement?.containerId).toBe(fragment.id);
    Keyboard.exitTextEditor(editor);
  });

  it("selects a row from the body and edits its background text with Enter", async () => {
    const fragment = createFixture();
    const x = fragment.x + fragment.width / 2;
    const y = fragment.y + HEADER_HEIGHT + BODY_HEIGHT / 2;
    clickAt(x, y);
    expect(h.state.selectedElementIds[fragment.id]).toBe(true);

    clickAt(x, y);
    expect(h.state.fragmentRowSelection).toEqual({
      elementId: fragment.id,
      rowId: "body",
    });
    expect(h.state.selectedElementIds[fragment.id]).toBeUndefined();

    Keyboard.keyPress(KEYS.ENTER);
    const editor = await getTextEditor();
    expect(getRowTexts()).toHaveLength(1);
    expect(h.state.editingTextElement?.containerRef).toEqual({
      kind: "fragmentRow",
      elementId: fragment.id,
      rowId: "body",
      role: "backgroundText",
    });
    Keyboard.exitTextEditor(editor);
  });

  it("deletes the row's background text together with the row", async () => {
    const fragment = createFixture();
    const centerX = fragment.x + fragment.width / 2;
    const centerY = fragment.y + HEADER_HEIGHT + BODY_HEIGHT / 2;
    doubleClickAt(centerX, centerY);
    const editor = await getTextEditor();
    updateTextEditor(editor, "hello");
    Keyboard.exitTextEditor(editor);
    expect(getRowTexts()).toHaveLength(1);

    const live = getFragment(fragment.id);
    const rowY = live.y + HEADER_HEIGHT + (live.shape.fragment?.rows[1].height ?? 0) / 2;
    mouseMove(live.x - 12, rowY);
    mouseDown(live.x - 12, rowY);
    mouseUp(live.x - 12, rowY);
    expect(h.state.fragmentRowSelection).toEqual({
      elementId: fragment.id,
      rowId: "body",
    });

    await act(async () => {
      expect(h.app.deleteSelectedFragmentRow()).toBe(true);
    });
    expect(getRowTexts()).toHaveLength(0);
    const after = getFragment(fragment.id);
    expect(after.shape.fragment?.rows.map((row) => row.id)).toEqual([
      "header",
    ]);
  });
});
