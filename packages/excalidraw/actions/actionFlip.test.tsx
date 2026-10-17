import { pointFrom } from "@excalidraw/math";

import {
  LinearElementEditor,
  distanceToElement,
  getBindingGap,
} from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "../_tests_/helpers/api";
import { render } from "../_tests_/test-utils";

import { actionFlipHorizontal, actionFlipVertical } from "./actionFlip";

const { h } = window;

describe("flipping mirrors the binding of a non-elbow arrow", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  /**
   * 一个非折线箭头绑在矩形右边缘外一个 binding gap 处（端点就是画出来的那个点）：
   * 比例 `1.06 = 1 + gap/width`（gap 6、宽 100），纵向在四分之一处。
   */
  const setup = () => {
    const rect = API.createElement({
      type: "rectangle",
      id: "rec1",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      boundElements: [{ id: "arr", type: "arrow" }],
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arr",
      x: 206,
      y: 125,
      width: 106,
      height: 0,
      points: [pointFrom(0, 0), pointFrom(106, 0)],
      startBinding: { elementId: "rec1", attachPoint: [1.06, 0.25] },
      endBinding: null,
      elbowed: false,
    }) as NonDeleted<ExcalidrawArrowElement>;

    API.setElements([rect, arrow]);
    // 组选才会走到 resizeMultipleElements 的镜像分支：只选箭头时 flip 仅换箭头头部
    API.setSelectedElements([rect, arrow]);

    return { rect, arrow };
  };

  const startEndpoint = (arrow: NonDeleted<ExcalidrawLinearElement>) =>
    LinearElementEditor.getPointAtIndexGlobalCoordinates(
      arrow,
      0,
      h.app.scene.getNonDeletedElementsMap(),
    );

  it("mirrors `attachPoint` to `-f + 1` and keeps the endpoint on the mirrored side's outline", () => {
    const { rect, arrow } = setup();
    const elementsMap = h.app.scene.getNonDeletedElementsMap();

    // 前提：非折线（这个分支原先只对 isElbowArrow 生效）
    expect(arrow.elbowed).toBe(false);
    // 翻转前：端点在矩形**右**边缘外一个 gap 处
    expect(arrow.startBinding?.attachPoint).toEqual([1.06, 0.25]);
    expect(
      distanceToElement(rect, elementsMap, startEndpoint(arrow)),
    ).toBeCloseTo(getBindingGap(rect, arrow), 1);
    expect(startEndpoint(arrow)[0]).toBeGreaterThan(rect.x + rect.width);

    API.executeAction(actionFlipHorizontal);

    const flippedRect = h.elements.find((el) => el.id === "rec1")!;
    const flippedArrow = h.elements.find(
      (el) => el.id === "arr",
    )! as NonDeleted<ExcalidrawArrowElement>;
    const flippedMap = h.app.scene.getNonDeletedElementsMap();
    const endpoint = startEndpoint(flippedArrow);

    // 比例按 `-f + 1` 镜像（纵向那一轴不动）
    expect(flippedArrow.startBinding?.attachPoint?.[0]).toBeCloseTo(
      -1.06 + 1,
      3,
    );
    expect(flippedArrow.startBinding?.attachPoint?.[1]).toBeCloseTo(0.25, 3);

    // ... 而且端点真的落在**镜像后那侧**（矩形左边缘）的外扩轮廓上
    expect(endpoint[0]).toBeLessThan(flippedRect.x);
    expect(distanceToElement(flippedRect, flippedMap, endpoint)).toBeCloseTo(
      getBindingGap(flippedRect, flippedArrow),
      1,
    );

    // 再翻一次镜像回到原处（镜像是对合）：比例、方位都复原
    API.executeAction(actionFlipHorizontal);
    const backArrow = h.elements.find(
      (el) => el.id === "arr",
    )! as NonDeleted<ExcalidrawArrowElement>;
    const backRect = h.elements.find((el) => el.id === "rec1")!;
    expect(backArrow.startBinding?.attachPoint?.[0]).toBeCloseTo(1.06, 3);
    expect(backArrow.startBinding?.attachPoint?.[1]).toBeCloseTo(0.25, 3);
    expect(startEndpoint(backArrow)[0]).toBeGreaterThan(
      backRect.x + backRect.width,
    );

    // 纵向翻转镜像的是另一轴
    API.executeAction(actionFlipVertical);
    const verticallyFlipped = h.elements.find(
      (el) => el.id === "arr",
    )! as NonDeleted<ExcalidrawArrowElement>;
    expect(verticallyFlipped.startBinding?.attachPoint?.[0]).toBeCloseTo(
      1.06,
      3,
    );
    expect(verticallyFlipped.startBinding?.attachPoint?.[1]).toBeCloseTo(
      -0.25 + 1,
      3,
    );
  });
});

describe("flipping re-centers selection", () => {
  it("elbow arrow touches group selection side yet it remains in place after multiple moves", async () => {
    const elements = [
      API.createElement({
        type: "rectangle",
        id: "rec1",
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        boundElements: [{ id: "arr", type: "arrow" }],
      }),
      API.createElement({
        type: "rectangle",
        id: "rec2",
        x: 220,
        y: 250,
        width: 100,
        height: 100,
        boundElements: [{ id: "arr", type: "arrow" }],
      }),
      API.createElement({
        type: "arrow",
        id: "arr",
        x: 149.9,
        y: 95,
        width: 156,
        height: 239.9,
        startBinding: {
          elementId: "rec1",
          attachPoint: [0.49, -0.05],
        },
        endBinding: {
          elementId: "rec2",
          attachPoint: [-0.05, 0.49],
        },
        startArrowhead: null,
        endArrowhead: "arrow",
        fixedSegments: null,
        points: [
          pointFrom(0, 0),
          pointFrom(0, -35),
          pointFrom(-90, -35),
          pointFrom(-90, 204),
          pointFrom(66, 204),
        ],
        elbowed: true,
      }),
    ];
    await render(<Excalidraw initialData={{ elements }} />);

    API.setSelectedElements(elements);

    expect(Object.keys(h.state.selectedElementIds).length).toBe(3);

    API.executeAction(actionFlipHorizontal);
    API.executeAction(actionFlipHorizontal);
    API.executeAction(actionFlipHorizontal);
    API.executeAction(actionFlipHorizontal);

    const rec1 = h.elements.find((el) => el.id === "rec1")!;
    expect(rec1.x).toBeCloseTo(100, 0);
    expect(rec1.y).toBeCloseTo(101, 0);

    const rec2 = h.elements.find((el) => el.id === "rec2")!;
    expect(rec2.x).toBeCloseTo(220, 0);
    expect(rec2.y).toBeCloseTo(251, 0);
  });
});

describe("flipping arrowheads", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("flipping bound arrow should flip arrowheads only", () => {
    const rect = API.createElement({
      type: "rectangle",
      boundElements: [{ type: "arrow", id: "arrow1" }],
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow1",
      startArrowhead: "arrow",
      endArrowhead: null,
      endBinding: {
        elementId: rect.id,
        attachPoint: [0.5, 0.5],
      },
    });

    API.setElements([rect, arrow]);
    API.setSelectedElements([arrow]);

    expect(API.getElement(arrow).startArrowhead).toBe("arrow");
    expect(API.getElement(arrow).endArrowhead).toBe(null);

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(arrow).startArrowhead).toBe(null);
    expect(API.getElement(arrow).endArrowhead).toBe("arrow");

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(arrow).startArrowhead).toBe("arrow");
    expect(API.getElement(arrow).endArrowhead).toBe(null);

    API.executeAction(actionFlipVertical);
    expect(API.getElement(arrow).startArrowhead).toBe(null);
    expect(API.getElement(arrow).endArrowhead).toBe("arrow");
  });

  it("flipping bound arrow should flip arrowheads only 2", () => {
    const rect = API.createElement({
      type: "rectangle",
      boundElements: [{ type: "arrow", id: "arrow1" }],
    });
    const rect2 = API.createElement({
      type: "rectangle",
      boundElements: [{ type: "arrow", id: "arrow1" }],
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow1",
      startArrowhead: "arrow",
      endArrowhead: "circle",
      startBinding: {
        elementId: rect.id,
        attachPoint: [0.5, 0.5],
      },
      endBinding: {
        elementId: rect2.id,
        attachPoint: [0.5, 0.5],
      },
    });

    API.setElements([rect, rect2, arrow]);
    API.setSelectedElements([arrow]);

    expect(API.getElement(arrow).startArrowhead).toBe("arrow");
    expect(API.getElement(arrow).endArrowhead).toBe("circle");

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(arrow).startArrowhead).toBe("circle");
    expect(API.getElement(arrow).endArrowhead).toBe("arrow");

    API.executeAction(actionFlipVertical);
    expect(API.getElement(arrow).startArrowhead).toBe("arrow");
    expect(API.getElement(arrow).endArrowhead).toBe("circle");
  });

  it("flipping unbound arrow shouldn't flip arrowheads", () => {
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow1",
      startArrowhead: "arrow",
      endArrowhead: "circle",
    });

    API.setElements([arrow]);
    API.setSelectedElements([arrow]);

    expect(API.getElement(arrow).startArrowhead).toBe("arrow");
    expect(API.getElement(arrow).endArrowhead).toBe("circle");

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(arrow).startArrowhead).toBe("arrow");
    expect(API.getElement(arrow).endArrowhead).toBe("circle");
  });

  it("flipping bound arrow shouldn't flip arrowheads if selected alongside non-arrow eleemnt", () => {
    const rect = API.createElement({
      type: "rectangle",
      boundElements: [{ type: "arrow", id: "arrow1" }],
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow1",
      startArrowhead: "arrow",
      endArrowhead: null,
      endBinding: {
        elementId: rect.id,
        attachPoint: [0.5, 0.5],
      },
    });

    API.setElements([rect, arrow]);
    API.setSelectedElements([rect, arrow]);

    expect(API.getElement(arrow).startArrowhead).toBe("arrow");
    expect(API.getElement(arrow).endArrowhead).toBe(null);

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(arrow).startArrowhead).toBe("arrow");
    expect(API.getElement(arrow).endArrowhead).toBe(null);
  });
});

describe("flipping reflects the triangle family", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  const place = <T extends ReturnType<typeof API.createElement>>(
    element: T,
  ) => {
    API.setElements([element]);
    API.setSelectedElements([element]);
    return element;
  };

  it("swaps right-triangle ⇄ left-triangle on horizontal flip", () => {
    // right-triangle 与 left-triangle 是无参的独立 id：斜边朝向由 id 本身决定，
    // 横向翻转就是互换 id（而不是镜像某个 apexX 参数）
    const triangle = place(
      API.createElement({
        type: "right-triangle",
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      }),
    );

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(triangle)).toMatchObject({
      id: triangle.id,
      shape: { id: "left-triangle", schemaVersion: 1 },
    });

    // 翻回去（镜像是对合）
    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(triangle)).toMatchObject({
      id: triangle.id,
      shape: { id: "right-triangle", schemaVersion: 1 },
    });
  });

  it("swaps left-triangle → right-triangle on horizontal flip", () => {
    const triangle = place(
      API.createElement({
        type: "left-triangle",
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      }),
    );

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(triangle)).toMatchObject({
      id: triangle.id,
      shape: { id: "right-triangle", schemaVersion: 1 },
    });
  });

  it("mirrors the apexX of the parametric triangle on horizontal flip", () => {
    // 带参数的 `triangle` 仍走几何镜像：apexX → 1 - apexX
    const triangle = place(
      API.createElement({
        type: "triangle",
        x: 150,
        y: 150,
        width: 100,
        height: 80,
        shape: { id: "triangle", schemaVersion: 1, triangle: { apexX: 0.25 } },
      }),
    );

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(triangle)).toMatchObject({
      id: triangle.id,
      shape: { id: "triangle", triangle: { apexX: 0.75 } },
    });

    API.executeAction(actionFlipHorizontal);
    expect(API.getElement(triangle)).toMatchObject({
      id: triangle.id,
      shape: { id: "triangle", triangle: { apexX: 0.25 } },
    });
  });

  it("leaves every triangle id unchanged on vertical flip", () => {
    // 垂直翻转不改斜边朝向：三个 id 及其参数都原样保留
    const rightTriangle = place(
      API.createElement({
        type: "right-triangle",
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      }),
    );
    API.executeAction(actionFlipVertical);
    expect(API.getElement(rightTriangle)).toMatchObject({
      id: rightTriangle.id,
      shape: { id: "right-triangle", schemaVersion: 1 },
    });

    const leftTriangle = place(
      API.createElement({
        type: "left-triangle",
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      }),
    );
    API.executeAction(actionFlipVertical);
    expect(API.getElement(leftTriangle)).toMatchObject({
      id: leftTriangle.id,
      shape: { id: "left-triangle", schemaVersion: 1 },
    });

    const triangle = place(
      API.createElement({
        type: "triangle",
        x: 150,
        y: 150,
        width: 100,
        height: 80,
        shape: { id: "triangle", schemaVersion: 1, triangle: { apexX: 0.25 } },
      }),
    );
    API.executeAction(actionFlipVertical);
    expect(API.getElement(triangle)).toMatchObject({
      id: triangle.id,
      shape: { id: "triangle", triangle: { apexX: 0.25 } },
    });
  });
});
