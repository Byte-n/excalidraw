import { arrayToMap, reseed } from "@excalidraw/common";
import { pointDistance, pointFrom } from "@excalidraw/math";

import {
  buildConnectionQuery,
  buildShapeData,
  getBindingGap,
  LinearElementEditor,
  newElement,
  newTextElement,
  projectPointOntoBoundElementOutline,
  resolveConnectionHit,
} from "@excalidraw/element";

import type { GlobalPoint } from "@excalidraw/math";

import type {
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render, unmountComponent, waitFor, act } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

unmountComponent();

const rectangle = () =>
  API.createElement({
    type: "rectangle",
    x: 300,
    y: 250,
    width: 200,
    height: 120,
  }) as unknown as NonDeleted<ExcalidrawBindableElement>;

const activation = (x: number, y: number) =>
  API.createElement({
    type: "sequence",
    shape: buildShapeData("sc-activation"),
    x,
    y,
    width: 16,
    height: 100,
  }) as unknown as NonDeleted<ExcalidrawBindableElement>;

const arrowEndpoint = (
  arrow: ExcalidrawLinearElement,
  index: number,
): GlobalPoint =>
  LinearElementEditor.getPointAtIndexGlobalCoordinates(
    arrow,
    index,
    h.app.scene.getNonDeletedElementsMap(),
  );

/** The connection preview is the frame's `connection` target (PR6). */
const connectionPreview = () => {
  const frame = h.app.pointer.getFrame();
  if (frame?.target.kind !== "connection") {
    return null;
  }
  const element = h.app.scene.getNonDeletedElement(frame.target.elementId);
  return element ? { element, hit: frame.target.hit } : null;
};

const expectPointsClose = (a: GlobalPoint, b: GlobalPoint, digits = 2) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

describe("connection preview = landing (PR3a)", () => {
  beforeEach(async () => {
    reseed(7);
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    unmountComponent();
  });

  it("hovering a new arrow previews the start endpoint it will land on", async () => {
    const rect = rectangle();
    API.setElements([rect]);
    UI.clickTool("arrow");

    // right edge is x = 500; hover just outside at a non-anchor y
    const hover = pointFrom<GlobalPoint>(503, 270);
    mouse.moveTo(hover[0], hover[1]);

    let preview: GlobalPoint | null = null;
    await waitFor(() => {
      const suggested = connectionPreview();
      expect(suggested?.element.id).toBe(rect.id);
      preview = suggested!.hit.point;
    });

    mouse.downAt(hover[0], hover[1]);
    mouse.moveTo(750, 430);
    mouse.up();

    const arrow = h.elements.find(
      (element): element is ExcalidrawArrowElement =>
        element.type === "arrow" && !element.isDeleted,
    )!;
    expect(arrow.startBinding?.elementId).toBe(rect.id);
    expectPointsClose(arrowEndpoint(arrow, 0), preview!, 2);
  });

  it("dragging an endpoint previews the released landing", async () => {
    const rect = rectangle();
    API.setElements([rect]);
    UI.clickTool("arrow");

    // draw a plain arrow left of the rectangle (stays selected & editable)
    mouse.downAt(200, 180);
    mouse.moveTo(220, 200);
    mouse.up();

    mouse.reset();
    mouse.downAt(200, 180);
    const target = pointFrom<GlobalPoint>(503, 270);
    mouse.moveTo(target[0], target[1]);

    let preview: GlobalPoint | null = null;
    await waitFor(() => {
      const suggested = connectionPreview();
      expect(suggested?.element.id).toBe(rect.id);
      preview = suggested!.hit.point;
    });

    mouse.upAt(target[0], target[1]);

    const arrow = h.elements.find(
      (element): element is ExcalidrawArrowElement =>
        element.type === "arrow" && !element.isDeleted,
    )!;
    expect(arrow.startBinding?.elementId).toBe(rect.id);
    expectPointsClose(arrowEndpoint(arrow, 0), preview!, 2);
  });

  it("prefers the anchor inside its radius and skips it when snapping is off", async () => {
    const rect = rectangle();
    API.setElements([rect]);
    UI.clickTool("arrow");

    // inside the top edge, 2px below it, near the top-mid anchor (400, 250)
    const nearAnchor = pointFrom<GlobalPoint>(402, 248);
    mouse.moveTo(nearAnchor[0], nearAnchor[1]);

    await waitFor(() => {
      const suggested = connectionPreview();
      expect(suggested?.element.id).toBe(rect.id);
      expect(suggested?.hit.tier).toBe("anchor");
      // midpointAnchors order: top, right, bottom, left
      expect(suggested?.hit.anchorIndex).toBe(0);
      expect(suggested?.hit.point[0]).toBeCloseTo(400, 6);
      expect(suggested?.hit.point[1]).toBeCloseTo(
        250 - getBindingGap(rect, { elbowed: false }),
        6,
      );
    });

    await act(() => {
      h.app.setState({ isMidpointSnappingEnabled: false });
    });
    mouse.moveTo(nearAnchor[0] + 1, nearAnchor[1]);
    await waitFor(() => {
      const suggested = connectionPreview();
      expect(suggested?.hit.tier).not.toBe("anchor");
    });
  });

  it("still lands on arbitrary edge points of a small shape", async () => {
    const small = API.createElement({
      type: "rectangle",
      x: 600,
      y: 300,
      width: 40,
      height: 40,
    }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    API.setElements([small]);
    UI.clickTool("arrow");

    const point = pointFrom<GlobalPoint>(643, 334);
    mouse.moveTo(point[0], point[1]);
    await waitFor(() => {
      const suggested = connectionPreview();
      expect(suggested?.element.id).toBe(small.id);
      expect(suggested?.hit.tier).toBe("outline");
      expect(suggested?.hit.point[1]).toBeCloseTo(334, 0);
    });
  });

  it("grid mode previews and lands on the same grid-snapped point", async () => {
    const rect = rectangle();
    API.setElements([rect]);
    await act(() => {
      h.app.setState({ gridModeEnabled: true, gridSize: 20 });
    });
    UI.clickTool("arrow");

    const hover = pointFrom<GlobalPoint>(503, 277);
    await act(() => {
      mouse.moveTo(hover[0], hover[1]);
    });

    let preview: GlobalPoint | null = null;
    await waitFor(() => {
      const suggested = connectionPreview();
      expect(suggested?.element.id).toBe(rect.id);
      expect(suggested?.hit.tier).not.toBe("anchor");
      preview = suggested!.hit.point;
    });
    expect(preview![1]).toBeCloseTo(280, 6);

    await act(() => {
      mouse.downAt(hover[0], hover[1]);
      mouse.moveTo(750, 430);
      mouse.up();
    });

    const arrow = h.elements.find(
      (element): element is ExcalidrawArrowElement =>
        element.type === "arrow" && !element.isDeleted,
    )!;
    expectPointsClose(arrowEndpoint(arrow, 0), preview!, 2);
  });

  it("a shift-locked hover has no incoming direction and shows no preview", async () => {
    const rect = rectangle();
    API.setElements([rect]);
    UI.clickTool("arrow");

    Keyboard.withModifierKeys({ shift: true }, () => {
      mouse.moveTo(503, 270);
    });
    await waitFor(() => {
      expect(connectionPreview()).toBeNull();
    });
  });

  it("multi-point arrow endpoint drag uses the adjacent point as direction", async () => {
    // midpoint snapping off: no anchor tier, so the ray direction decides
    await act(() => {
      h.app.setState({ isMidpointSnappingEnabled: false });
    });
    const diamond = API.createElement({
      type: "diamond",
      x: 300,
      y: 250,
      width: 200,
      height: 120,
    }) as unknown as NonDeleted<ExcalidrawBindableElement>;
    const arrow = API.createElement({
      type: "arrow",
      x: 100,
      y: 300,
      points: [pointFrom(0, 0), pointFrom(150, 0), pointFrom(300, -100)],
    }) as unknown as ExcalidrawArrowElement;
    API.setElements([diamond, arrow]);

    const elementsMap = h.app.scene.getNonDeletedElementsMap();
    const base = new LinearElementEditor(
      arrow as unknown as NonDeleted<ExcalidrawLinearElement>,
      elementsMap,
    );
    const editor = {
      ...base,
      selectedPointsIndices: [2],
      initialState: {
        ...base.initialState,
        lastClickedPoint: 2,
        pointerOffset: { x: 0, y: 0 },
      },
    } as LinearElementEditor;

    const pointer = pointFrom<GlobalPoint>(400, 310);
    await act(() => {
      LinearElementEditor.handlePointDragging(
        new PointerEvent("pointermove"),
        h.app,
        pointer[0],
        pointer[1],
        editor,
      );
    });

    const hit = connectionPreview()!.hit.point;
    const arrowAfter = h.app.scene.getNonDeletedElement(
      arrow.id,
    ) as NonDeleted<ExcalidrawLinearElement>;
    const adjacent = LinearElementEditor.getPointAtIndexGlobalCoordinates(
      arrowAfter,
      1,
      h.app.scene.getNonDeletedElementsMap(),
    );
    const far = LinearElementEditor.getPointAtIndexGlobalCoordinates(
      arrowAfter,
      0,
      h.app.scene.getNonDeletedElementsMap(),
    );
    const projectedFor = (reference: GlobalPoint) =>
      projectPointOntoBoundElementOutline(
        arrowAfter,
        "endBinding",
        diamond,
        pointer,
        h.app.scene.getNonDeletedElementsMap(),
        reference,
      );

    const adjacentExpected = projectedFor(adjacent);
    const farExpected = projectedFor(far);
    expectPointsClose(hit, adjacentExpected, 2);
    expect(pointDistance(hit, farExpected)).toBeGreaterThan(1);
  });
});

describe("sequence message preview = landing", () => {
  beforeEach(async () => {
    reseed(7);
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    unmountComponent();
  });

  it("hovering another bar previews the exact released endpoint without flipping sides", async () => {
    const source = activation(200, 200);
    const target = activation(600, 200);
    API.setElements([source, target]);

    // message starts on the source's right edge, ends free on the right
    UI.clickTool("arrow");
    mouse.downAt(221, 250);
    mouse.moveTo(400, 250);
    mouse.up();

    const arrow = h.elements.find(
      (element): element is ExcalidrawArrowElement =>
        element.type === "arrow" && !element.isDeleted,
    )!;
    expect(arrow.startBinding?.elementId).toBe(source.id);

    // drag the free end onto the target's centre (must not flip to its right edge)
    mouse.reset();
    mouse.downAt(400, 250);
    mouse.moveTo(611, 250);

    let preview: GlobalPoint | null = null;
    await waitFor(() => {
      const suggested = connectionPreview();
      expect(suggested?.element.id).toBe(target.id);
      preview = suggested!.hit.point;
    });

    mouse.upAt(611, 250);

    const updated = h.elements.find(
      (element): element is ExcalidrawArrowElement =>
        element.type === "arrow" && !element.isDeleted,
    )!;
    expect(updated.endBinding?.elementId).toBe(target.id);
    const endpoint = arrowEndpoint(updated, updated.points.length - 1);
    expectPointsClose(endpoint, preview!, 2);
    // reference side wins over the pointer x: inside the bar, landed on its left
    expect(endpoint[0]).toBeLessThan(target.x);
  });
});

describe("arbitrary edge players", () => {
  const families = (): NonDeleted<ExcalidrawBindableElement>[] => [
    newElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 160,
      height: 100,
    }) as unknown as NonDeleted<ExcalidrawBindableElement>,
    newElement({
      type: "diamond",
      x: 100,
      y: 100,
      width: 160,
      height: 100,
    }) as unknown as NonDeleted<ExcalidrawBindableElement>,
    newElement({
      type: "ellipse",
      x: 100,
      y: 100,
      width: 160,
      height: 100,
    }) as unknown as NonDeleted<ExcalidrawBindableElement>,
    newElement({
      type: "fc-hexagon",
      x: 100,
      y: 100,
      width: 160,
      height: 100,
    }) as unknown as NonDeleted<ExcalidrawBindableElement>,
    newTextElement({
      text: "probe",
      x: 100,
      y: 100,
      fontSize: 20,
    }) as unknown as NonDeleted<ExcalidrawBindableElement>,
  ];

  it("binds deterministic samples along each family's right edge and lands on Γ", () => {
    for (const element of families()) {
      const elementsMap = arrayToMap([element]);
      const samples = 20;
      for (let index = 0; index < samples; index++) {
        // 10%..90% down the element's height, just outside the right edge
        const y =
          element.y + element.height * (0.1 + (0.8 * index) / (samples - 1));
        const point = pointFrom<GlobalPoint>(element.x + element.width + 2, y);
        const query = buildConnectionQuery({
          element,
          point,
          zoom: 1,
          isMidpointSnappingEnabled: true,
          elementsMap,
        });
        const hit = resolveConnectionHit(query, () => null);
        expect(hit).not.toBeNull();
        // Γ invariant: resolving the landing again returns the same point
        const again = resolveConnectionHit(
          { ...query, point: hit!.point },
          () => null,
        );
        expect(again).not.toBeNull();
        expect(pointDistance(again!.point, hit!.point)).toBeLessThanOrEqual(
          0.01,
        );
      }
    }
  });
});
