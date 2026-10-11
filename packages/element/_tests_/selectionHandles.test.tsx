// The helper returns a mutable element view while resizeTest requires a
// non-deleted element at runtime.
// @ts-nocheck
import { Excalidraw } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";
import { UI } from "@excalidraw/excalidraw/_tests_/helpers/ui";
import {
  render,
  unmountComponent,
} from "@excalidraw/excalidraw/_tests_/test-utils";
import { DEFAULT_TRANSFORM_HANDLE_SPACING } from "@excalidraw/common";
import { type Radians } from "@excalidraw/math";

import {
  getTransformHandles,
  getTransformHandlesFromCoords,
} from "../src/transformHandles";
import { resizeTest } from "../src/resizeTest";

unmountComponent();

const { h } = window;

beforeEach(async () => {
  await render(<Excalidraw handleKeyboardGlobally />);
});

it("shows four side handles on a selected shape and hits their full visual length", () => {
  const rectangle = UI.createElement("rectangle", {
    width: 200,
    height: 100,
  });
  const elementsMap = h.scene.getNonDeletedElementsMap();
  const handles = getTransformHandles(
    rectangle,
    h.state.zoom,
    elementsMap,
    "mouse",
    {},
  );

  for (const direction of ["n", "s", "e", "w"] as const) {
    const [x, y, width, height] = handles[direction]!;
    expect([width, height]).toEqual(
      direction === "n" || direction === "s" ? [16, 9] : [9, 16],
    );
    expect(
      resizeTest(
        rectangle,
        elementsMap,
        h.state,
        x + (direction === "n" || direction === "s" ? 0.5 : width / 2),
        y + (direction === "e" || direction === "w" ? 0.5 : height / 2),
        h.state.zoom,
        "mouse",
        h.app.editorInterface,
      ),
    ).toBe(direction);
  }

  for (const direction of ["nw", "ne", "sw", "se"] as const) {
    expect(handles[direction]?.slice(2)).toEqual([9, 9]);
  }
  expect(handles.rotation).toBeDefined();
  expect(handles.rotation![0]).toBeGreaterThan(handles.ne![0]);
  expect(handles.rotation![1]).toBeLessThan(handles.ne![1]);
});

it.each(["table", "frame"] as const)(
  "keeps side and rotation handles off a selected %s",
  (type) => {
    const element = API.createElement({ type, x: 100, y: 100 });
    API.setElements([element]);
    const handles = getTransformHandles(
      element,
      h.state.zoom,
      h.scene.getNonDeletedElementsMap(),
      "mouse",
      {},
    );

    expect(handles.nw).toBeDefined();
    expect(handles.ne).toBeDefined();
    expect(handles.sw).toBeDefined();
    expect(handles.se).toBeDefined();
    expect(handles.n).toBeUndefined();
    expect(handles.s).toBeUndefined();
    expect(handles.e).toBeUndefined();
    expect(handles.w).toBeUndefined();
    expect(handles.rotation).toBeUndefined();
  },
);

it("rotates side handle centers with the selected shape", () => {
  const rectangle = UI.createElement("rectangle", {
    width: 200,
    height: 100,
    angle: Math.PI / 2,
  });
  const handles = getTransformHandles(
    rectangle,
    h.state.zoom,
    h.scene.getNonDeletedElementsMap(),
    "mouse",
    {},
  );
  const center = [
    rectangle.x + rectangle.width / 2,
    rectangle.y + rectangle.height / 2,
  ] as const;
  const expectedHandles = getTransformHandlesFromCoords(
    [
      rectangle.x,
      rectangle.y,
      rectangle.x + rectangle.width,
      rectangle.y + rectangle.height,
      center[0],
      center[1],
    ],
    rectangle.angle as Radians,
    h.state.zoom,
    "mouse",
    {},
    DEFAULT_TRANSFORM_HANDLE_SPACING,
  ).n!;
  const north = handles.n!;
  expect(north[0] + north[2] / 2).toBeCloseTo(
    expectedHandles[0] + expectedHandles[2] / 2,
  );
  expect(north[1] + north[3] / 2).toBeCloseTo(
    expectedHandles[1] + expectedHandles[3] / 2,
  );
  expect(north[2]).toBe(16);
  expect(north[3]).toBe(9);
});
