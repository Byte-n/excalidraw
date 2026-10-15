// The helper returns a mutable element view while resizeTest requires a
// non-deleted element at runtime.
// @ts-nocheck
import { Excalidraw } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";
import { UI } from "@excalidraw/excalidraw/_tests_/helpers/ui";
import {
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
} from "@excalidraw/excalidraw/_tests_/test-utils";
import { DEFAULT_TRANSFORM_HANDLE_SPACING } from "@excalidraw/common";
import { type Radians } from "@excalidraw/math";

import {
  getTransformHandles,
  getTransformHandlesFromCoords,
} from "../src/transformHandles";
import {
  getElementWithTransformHandleType,
  getRotationCursor,
  resizeTest,
} from "../src/resizeTest";

unmountComponent();

const { h } = window;

const mouseMove = (clientX: number, clientY: number) => {
  fireEvent.pointerMove(GlobalTestState.interactiveCanvas, {
    clientX,
    clientY,
    pointerType: "mouse",
  });
};

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
  expect(handles.rotation![0]).toBeGreaterThan(handles.se![0]);
  expect(handles.rotation![1]).toBeGreaterThan(handles.se![1]);
});

it("places the rotation handle diagonally outside the bottom-right corner", () => {
  const rectangle = UI.createElement("rectangle", {
    width: 200,
    height: 100,
  });
  const elementsMap = h.scene.getNonDeletedElementsMap();
  const x2 = rectangle.x + rectangle.width;
  const y2 = rectangle.y + rectangle.height;
  const handles = getTransformHandles(
    rectangle,
    h.state.zoom,
    elementsMap,
    "mouse",
    {},
  );
  const rotation = handles.rotation!;
  // mouse handles are 9px, the rotation box is 1.75x that
  expect([rotation[2], rotation[3]]).toEqual([15.75, 15.75]);
  // the ne corner is free now, and the box hugs the se corner instead
  expect(rotation[0]).toBeCloseTo(x2 + 12.125);
  expect(rotation[1]).toBeCloseTo(y2 + 12.125);
  expect(rotation[0]).toBeGreaterThan(handles.ne![0]);
  expect(rotation[1]).toBeGreaterThan(handles.se![1]);
  // the center sits ROTATION_RESIZE_HANDLE_GAP beyond the se corner handle's
  // center, along the diagonal — same offset on both axes
  const seCenter = [
    handles.se![0] + handles.se![2] / 2,
    handles.se![1] + handles.se![3] / 2,
  ];
  const rotationCenter = [
    rotation[0] + rotation[2] / 2,
    rotation[1] + rotation[3] / 2,
  ];
  expect(rotationCenter[0]).toBeCloseTo(seCenter[0] + 16 / h.state.zoom.value);
  expect(rotationCenter[1]).toBeCloseTo(seCenter[1] + 16 / h.state.zoom.value);
});

it.each([
  ["pen", 2],
  ["touch", 0.5],
] as const)(
  "keeps the rotation handle mirrored outside the bottom-right corner for %s at zoom %s",
  (pointerType, zoomValue) => {
    const rectangle = UI.createElement("rectangle", {
      width: 200,
      height: 100,
    });
    const elementsMap = h.scene.getNonDeletedElementsMap();
    const x2 = rectangle.x + rectangle.width;
    const y2 = rectangle.y + rectangle.height;
    const zoom = { value: zoomValue } as typeof h.state.zoom;
    const handles = getTransformHandles(
      rectangle,
      zoom,
      elementsMap,
      pointerType,
      {},
    );
    const rotation = handles.rotation!;
    const size = pointerType === "pen" ? 16 : 28;
    expect([rotation[2], rotation[3]]).toEqual([
      (1.75 * size) / zoomValue,
      (1.75 * size) / zoomValue,
    ]);
    // mirrored about the diagonal: the same distance right of x2 and below y2
    expect(rotation[0] - x2).toBeCloseTo(rotation[1] - y2);
    // and still GAP beyond the se corner handle, on both axes
    const seCenter = [
      handles.se![0] + handles.se![2] / 2,
      handles.se![1] + handles.se![3] / 2,
    ];
    expect(rotation[0] + rotation[2] / 2).toBeCloseTo(
      seCenter[0] + 16 / zoomValue,
    );
    expect(rotation[1] + rotation[3] / 2).toBeCloseTo(
      seCenter[1] + 16 / zoomValue,
    );
  },
);

it("hits the relocated rotation handle and offers the rotation cursor there", () => {
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
  const rotation = handles.rotation!;
  const centerX = rotation[0] + rotation[2] / 2;
  const centerY = rotation[1] + rotation[3] / 2;

  expect(
    getElementWithTransformHandleType(
      [rectangle],
      h.state,
      centerX,
      centerY,
      h.state.zoom,
      "mouse",
      elementsMap,
      h.app.editorInterface,
    )?.transformHandleType,
  ).toBe("rotation");

  mouseMove(0, 0);
  mouseMove(centerX, centerY);
  // the rotation cursor is an inline SVG data URI (see getRotationCursor)
  expect(GlobalTestState.interactiveCanvas.style.cursor).toContain(
    "data:image/svg+xml",
  );

  // the spot the handle used to occupy — diagonally outside the ne corner,
  // ROTATION_RESIZE_HANDLE_GAP beyond that corner handle's center — is no
  // longer a rotation target now that the handle lives at the se corner
  const ne = handles.ne!;
  const oldRotationX = ne[0] + ne[2] / 2 + 16;
  const oldRotationY = ne[1] + ne[3] / 2 - 16;
  expect(
    resizeTest(
      rectangle,
      elementsMap,
      h.state,
      oldRotationX,
      oldRotationY,
      h.state.zoom,
      "mouse",
      h.app.editorInterface,
    ),
  ).not.toBe("rotation");
  mouseMove(oldRotationX, oldRotationY);
  expect(GlobalTestState.interactiveCanvas.style.cursor).not.toContain(
    "data:image/svg+xml",
  );
});

it("turns the rotation glyph 90° clockwise about its own box centre", () => {
  const rectangle = UI.createElement("rectangle", {
    width: 200,
    height: 100,
  });
  const handles = getTransformHandles(
    rectangle,
    h.state.zoom,
    h.scene.getNonDeletedElementsMap(),
    "mouse",
    {},
  );
  const rotation = handles.rotation!;
  const centerX = rotation[0] + rotation[2] / 2;
  const centerY = rotation[1] + rotation[3] / 2;

  // the interactive canvas renders through a mocked 2D context, so the
  // transforms the glyph was drawn under can be read back
  const context = GlobalTestState.interactiveCanvas.getContext("2d") as any;
  const events = context.__getEvents() as {
    type: string;
    props: Record<string, number>;
  }[];
  const translateIndex = events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.type === "translate" &&
        event.props.x === centerX &&
        event.props.y === centerY,
    )
    .map(({ index }) => index)
    .pop();

  expect(translateIndex).toBeDefined();
  // element angle first, then the extra quarter turn that keeps the glyph's
  // opening pointed at the corner it is drawn next to (se)
  expect(events[translateIndex! + 1]).toMatchObject({
    type: "rotate",
    props: { angle: 0 },
  });
  expect(events[translateIndex! + 2]).toMatchObject({
    type: "rotate",
    props: { angle: Math.PI / 2 },
  });
  // the arc is still drawn off the box's bottom-left in the glyph's own
  // (unrotated) frame; the quarter turn above is what carries it to the se
  // corner, so the local geometry stays identical to the ne version
  const arc = events.slice(translateIndex! + 3).find((event) => {
    return event.type === "arc";
  })!;
  const radius = rotation[2] * 0.75;
  expect(arc.props.x).toBeCloseTo(-radius * Math.SQRT1_2);
  expect(arc.props.y).toBeCloseTo(radius * Math.SQRT1_2);
  expect(arc.props.radius).toBeCloseTo(radius);
  expect(arc.props.startAngle).toBeCloseTo(-Math.PI / 2);
  expect(arc.props.endAngle).toBeCloseTo(0);
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

it("turns the rotation cursor with the glyph's quarter turn", () => {
  const rotateOf = (angle: number) => {
    const svg = decodeURIComponent(getRotationCursor(angle));
    return svg.match(/transform="rotate\(([-\d.]+) 12 12\)"/)?.[1];
  };

  // the cursor stands in for the handle — it is the hover feedback and the only
  // indicator while rotating — so it takes the same extra quarter turn as the
  // drawn glyph; without it the arc opens the wrong way
  expect(rotateOf(0)).toBe("90");
  // and it still follows the element angle on top of that turn
  expect(rotateOf(Math.PI / 2)).toBe("180");
  expect(rotateOf((3 * Math.PI) / 2)).toBe("0");
});

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
