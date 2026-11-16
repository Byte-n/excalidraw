import {
  DEFAULT_FONT_FAMILY,
  KEYS,
  TABLE_STRUCTURE_INSERTION_OFFSET,
  getLineHeight,
} from "@excalidraw/common";

import type {
  ExcalidrawSequenceElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getFragmentStructureHoverAtSceneCoords } from "../components/app/fragment";
import { exportToSvg } from "../scene/export";

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

const getTextElements = () =>
  h.elements.filter((element) => element.type === "text" && !element.isDeleted);

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

  it("double-clicking a body row edits its row region and grows the row", async () => {
    const fragment = createFixture();
    const x = fragment.x + fragment.width / 2;
    const y = fragment.y + HEADER_HEIGHT + BODY_HEIGHT / 2;
    doubleClickAt(x, y);

    const editor = await getTextEditor();
    expect(h.state.editingTextRegion?.target).toEqual({
      elementId: fragment.id,
      region: "row:body",
    });
    expect(getTextElements()).toHaveLength(0);

    updateTextEditor(
      editor,
      "A long condition label that wraps onto several lines inside the row and must stay visible while it is being edited. ".repeat(
        10,
      ),
    );
    await act(async () => {
      h.app.textWysiwygSubmitHandler?.();
    });

    const live = getFragment(fragment.id);
    expect(live.height).toBeGreaterThan(240);
    const bodyRow = live.shape.fragment?.rows[1];
    expect(bodyRow?.height).toBeGreaterThan(BODY_HEIGHT);
    expect(live.texts?.["row:body"]?.text).toContain("A long condition label");
    expect(getTextElements()).toHaveLength(0);
  });

  it("double-clicking the header edits the operator body region", async () => {
    const fragment = createFixture();
    doubleClickAt(
      fragment.x + fragment.width / 2,
      fragment.y + HEADER_HEIGHT / 2,
    );

    const editor = await getTextEditor();
    expect(h.state.editingTextRegion?.target).toEqual({
      elementId: fragment.id,
      region: "body",
    });
    updateTextEditor(editor, "Loop");
    await act(async () => {
      h.app.textWysiwygSubmitHandler?.();
    });

    const live = getFragment(fragment.id);
    expect(live.texts?.body?.text).toBe("Loop");
    expect(live.shape.fragment?.operatorWidth ?? 0).toBeGreaterThanOrEqual(92);
    expect(getTextElements()).toHaveLength(0);
  });

  it("selects a row from the body and edits its region with Enter", async () => {
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
    await getTextEditor();
    expect(h.state.editingTextRegion?.target).toEqual({
      elementId: fragment.id,
      region: "row:body",
    });
  });

  it("deleting a row removes its text key and keeps the others", async () => {
    const fragment = createFixture();
    const centerX = fragment.x + fragment.width / 2;
    const centerY = fragment.y + HEADER_HEIGHT + BODY_HEIGHT / 2;
    doubleClickAt(centerX, centerY);
    const editor = await getTextEditor();
    updateTextEditor(editor, "hello");
    await act(async () => {
      h.app.textWysiwygSubmitHandler?.();
    });
    expect(getFragment(fragment.id).texts?.["row:body"]?.text).toBe("hello");

    doubleClickAt(centerX, fragment.y + HEADER_HEIGHT / 2);
    const operatorEditor = await getTextEditor();
    updateTextEditor(operatorEditor, "Opt");
    await act(async () => {
      h.app.textWysiwygSubmitHandler?.();
    });

    const live = getFragment(fragment.id);
    const rowY =
      live.y + HEADER_HEIGHT + (live.shape.fragment?.rows[1].height ?? 0) / 2;
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
    const after = getFragment(fragment.id);
    expect(after.shape.fragment?.rows.map((row) => row.id)).toEqual(["header"]);
    expect(after.texts?.["row:body"]).toBeUndefined();
    expect(after.texts?.body?.text).toBe("Opt");
  });

  it("inserting a row keeps the existing text keys", async () => {
    const fragment = createFixture();
    doubleClickAt(
      fragment.x + fragment.width / 2,
      fragment.y + HEADER_HEIGHT + BODY_HEIGHT / 2,
    );
    const editor = await getTextEditor();
    updateTextEditor(editor, "hello");
    await act(async () => {
      h.app.textWysiwygSubmitHandler?.();
    });

    API.setSelectedElements([
      getFragment(fragment.id) as NonDeleted<FragmentElement>,
    ]);
    await act(async () => {
      expect(h.app.addSequenceFragmentRow()).toBe(true);
    });

    const live = getFragment(fragment.id);
    expect(live.texts?.["row:body"]?.text).toBe("hello");
    expect(getTextElements()).toHaveLength(0);
  });

  it("renders rotated fragment row text in the static SVG", async () => {
    const fragment = {
      ...createFixture(),
      angle: (Math.PI / 2) as ExcalidrawSequenceElement["angle"],
      texts: {
        body: {
          text: "Opt / Loop",
          style: {
            fontFamily: DEFAULT_FONT_FAMILY,
            fontSize: 14,
            lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
            textAlign: "left" as const,
            verticalAlign: "top" as const,
          },
        },
        "row:body": {
          text: "rotated row",
          style: {
            fontFamily: DEFAULT_FONT_FAMILY,
            fontSize: 13,
            lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
            textAlign: "left" as const,
            verticalAlign: "top" as const,
          },
        },
      },
    };
    API.setElements([fragment]);
    const svg = await exportToSvg(
      h.app.scene.getNonDeletedElements(),
      h.state,
      null,
    );
    const texts = Array.from(svg.querySelectorAll("text")).map(
      (node) => node.textContent,
    );
    expect(texts).toEqual(
      expect.arrayContaining([expect.stringContaining("Opt"), "rotated row"]),
    );
    const rowNode = Array.from(svg.querySelectorAll("text")).find(
      (node) => node.textContent === "rotated row",
    )!;
    expect(Number(rowNode.getAttribute("x"))).not.toBeNull();
    expect(Number(rowNode.getAttribute("y"))).not.toBeNull();
  });
});
