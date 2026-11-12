import { TABLE_STRUCTURE_INSERTION_OFFSET } from "@excalidraw/common";

import type { ExcalidrawSequenceElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getFragmentStructureHoverAtSceneCoords } from "../components/app/fragment";

import { API } from "./helpers/api";

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
});
