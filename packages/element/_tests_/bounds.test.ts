import { RoughGenerator } from "roughjs/bin/generator";

import { pointFrom } from "@excalidraw/math";
import { arrayToMap, type Bounds, ROUNDNESS } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";

import type { LocalPoint } from "@excalidraw/math";

import {
  buildShapeData,
  getCompositeShapeGlobalPoints,
  type ShapeId,
} from "../src/compositeShape";
import {
  elementsOverlappingBBox,
  getArrowheadPoints,
  getElementAbsoluteCoords,
  getElementBounds,
} from "../src/bounds";
import { getCurvedConnectorPath } from "../src/curveConnector";

import type { Drawable } from "roughjs/bin/core";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "../src/types";

const _ce = ({
  x,
  y,
  w,
  h,
  a,
  t,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  a?: number;
  t?: string;
}) =>
  ({
    type: t === "line" ? "line" : "composite",
    ...(t === "line"
      ? {}
      : { shape: buildShapeData((t || "rectangle") as ShapeId) }),
    strokeColor: "#000",
    backgroundColor: "#000",
    fillStyle: "solid",
    strokeWidth: 1,
    roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
    opacity: 1,
    x,
    y,
    width: w,
    height: h,
    angle: a,
  } as ExcalidrawElement);

describe("getElementAbsoluteCoords", () => {
  it("test x1 coordinate", () => {
    const element = _ce({ x: 10, y: 20, w: 10, h: 0 });
    const [x1] = getElementAbsoluteCoords(element, arrayToMap([element]));
    expect(x1).toEqual(10);
  });

  it("test x2 coordinate", () => {
    const element = _ce({ x: 10, y: 20, w: 10, h: 0 });
    const [, , x2] = getElementAbsoluteCoords(element, arrayToMap([element]));
    expect(x2).toEqual(20);
  });

  it("test y1 coordinate", () => {
    const element = _ce({ x: 0, y: 10, w: 0, h: 10 });
    const [, y1] = getElementAbsoluteCoords(element, arrayToMap([element]));
    expect(y1).toEqual(10);
  });

  it("test y2 coordinate", () => {
    const element = _ce({ x: 0, y: 10, w: 0, h: 10 });
    const [, , , y2] = getElementAbsoluteCoords(element, arrayToMap([element]));
    expect(y2).toEqual(20);
  });
});

describe("getElementBounds", () => {
  const expectBoundsToMatchOutline = (element: ExcalidrawElement) => {
    if (element.type !== "composite") {
      throw new Error("Expected composite shape");
    }
    const points = getCompositeShapeGlobalPoints(element);
    const [x1, y1, x2, y2] = getElementBounds(element, arrayToMap([element]));
    expect(x1).toBeCloseTo(Math.min(...points.map(([x]) => x)));
    expect(y1).toBeCloseTo(Math.min(...points.map(([, y]) => y)));
    expect(x2).toBeCloseTo(Math.max(...points.map(([x]) => x)));
    expect(y2).toBeCloseTo(Math.max(...points.map(([, y]) => y)));
  };

  it("rectangle", () => {
    const element = _ce({
      x: 40,
      y: 30,
      w: 20,
      h: 10,
      a: Math.PI / 4,
      t: "rectangle",
    });
    expectBoundsToMatchOutline(element);
  });

  it("diamond", () => {
    const element = _ce({
      x: 40,
      y: 30,
      w: 20,
      h: 10,
      a: Math.PI / 4,
      t: "diamond",
    });

    expectBoundsToMatchOutline(element);
  });

  it("ellipse", () => {
    const element = _ce({
      x: 40,
      y: 30,
      w: 20,
      h: 10,
      a: Math.PI / 4,
      t: "ellipse",
    });

    const [x1, y1, x2, y2] = getElementBounds(element, arrayToMap([element]));
    expect(x1).toEqual(42.09430584957905);
    expect(y1).toEqual(27.09430584957905);
    expect(x2).toEqual(57.90569415042095);
    expect(y2).toEqual(42.90569415042095);
  });

  it("curved line", () => {
    const element = {
      ..._ce({
        t: "line",
        x: 449.58203125,
        y: 186.0625,
        w: 170.12890625,
        h: 92.48828125,
        a: 0.6447741904932416,
      }),
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(67.33984375, 92.48828125),
        pointFrom<LocalPoint>(-102.7890625, 52.15625),
      ],
    } as ExcalidrawLinearElement;

    const [x1, y1, x2, y2] = getElementBounds(element, arrayToMap([element]));
    expect(x1).toEqual(360.9291017525165);
    expect(y1).toEqual(185.24770129343722);
    expect(x2).toEqual(481.4815539037601);
    expect(y2).toEqual(319.8162855827246);
  });
});

const makeElement = (x: number, y: number, width: number, height: number) =>
  API.createElement({
    type: "rectangle",
    x,
    y,
    width,
    height,
  });

const makeBBox = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Bounds => [minX, minY, maxX, maxY];

describe("elementsOverlappingBBox()", () => {
  it("should return elements that overlap bbox", () => {
    const bbox = makeBBox(0, 0, 100, 100);

    const rectOutside = makeElement(110, 110, 100, 100);
    const rectInside = makeElement(10, 10, 85, 85);
    const rectContainingBBox = makeElement(-10, -10, 110, 110);
    const rectOverlappingTopLeft = makeElement(-10, -10, 50, 50);

    expect(
      elementsOverlappingBBox({
        bounds: bbox,
        type: "overlap",
        elements: [
          rectOutside,
          rectInside,
          rectContainingBBox,
          rectOverlappingTopLeft,
        ],
      }),
    ).toEqual([rectInside, rectOverlappingTopLeft]);
  });

  it("should return elements inside/containing bbox", () => {
    const bbox = makeBBox(0, 0, 100, 100);

    const rectOutside = makeElement(110, 110, 100, 100);
    const rectInside = makeElement(10, 10, 85, 85);
    const rectContainingBBox = makeElement(-10, -10, 110, 110);
    const rectOverlappingTopLeft = makeElement(-10, -10, 50, 50);

    expect(
      elementsOverlappingBBox({
        bounds: bbox,
        type: "contain",
        elements: [
          rectOutside,
          rectInside,
          rectContainingBBox,
          rectOverlappingTopLeft,
        ],
      }),
    ).toEqual([rectInside]);
  });
});

const binding = (elementId: string, attachPoint: [number, number]) => ({
  elementId,
  attachPoint,
});

type Binding = ReturnType<typeof binding>;

/**
 * 2 点曲线箭头：两端各自挂在一条边上（默认起点右边缘、终点左边缘）。
 * 判据只看「圆角 + 非折线」，没有额外字段——`API.createElement` 造出来就是它。
 */
const createCurvedConnector = ({
  points = [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 40)],
  startBinding = binding("source", [1, 0.5]),
  endBinding = binding("target", [0, 0.5]),
}: {
  points?: readonly LocalPoint[];
  startBinding?: Binding;
  endBinding?: Binding;
} = {}): NonDeleted<ExcalidrawArrowElement> => {
  const element = API.createElement({
    type: "arrow",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    points,
    roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
    startBinding,
    endBinding,
  });
  return {
    ...element,
    type: "arrow",
    elbowed: false,
    roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
  };
};

/** `getArrowheadPoints` 对曲线连接线不读 shape，只为满足签名造一个同源形状 */
const roughPathShape = (element: ExcalidrawElement): Drawable[] => [
  new RoughGenerator().path(getCurvedConnectorPath(element)!, {
    roughness: 0,
    disableMultiStroke: true,
  }),
];

const normalize = (x: number, y: number) => {
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
};

/**
 * 从箭头返回的两点（倒刺）反推方向：两个倒刺的中点落在 tip→尾部 的轴上，
 * tip 指向它的单位向量就是箭头的前进方向；两个倒刺的连线（对角线）垂直于它。
 */
const arrowheadVectors = (
  element: ExcalidrawLinearElement,
  position: "start" | "end",
) => {
  const [tipX, tipY, armAX, armAY, armBX, armBY] = getArrowheadPoints(
    element,
    roughPathShape(element),
    position,
    "arrow",
  )!;

  return {
    axis: normalize(tipX - (armAX + armBX) / 2, tipY - (armAY + armBY) / 2),
    diagonal: normalize(armBX - armAX, armBY - armAY),
  };
};

describe("getArrowheadPoints for curved connectors", () => {
  it("points the end arrowhead horizontally along the attached edge normal", () => {
    // 终点挂左边缘：到达方向取该端切线，垂直于竖边 ⇒ 水平（+x）
    const element = createCurvedConnector();
    const { axis, diagonal } = arrowheadVectors(element, "end");

    expect(axis.x).toBeCloseTo(1, 6);
    expect(axis.y).toBeCloseTo(0, 6);
    // 对角线（两倒刺连线）与箭头方向垂直
    expect(diagonal.x * axis.x + diagonal.y * axis.y).toBeCloseTo(0, 6);
  });

  it("points the reversed start arrowhead along the attached edge normal", () => {
    // 起点挂右边缘：反向箭头方向垂直于竖边 ⇒ 水平（−x）
    const element = createCurvedConnector();
    const { axis } = arrowheadVectors(element, "start");

    expect(axis.x).toBeCloseTo(-1, 6);
    expect(axis.y).toBeCloseTo(0, 6);
  });

  it("turns the end arrowhead vertical when the end binds to the top edge", () => {
    // 终点改挂上边缘：该端切线垂直于上边 ⇒ 箭头方向竖直
    const element = createCurvedConnector({
      endBinding: binding("target", [0.5, 0]),
    });
    const { axis, diagonal } = arrowheadVectors(element, "end");

    expect(axis.x).toBeCloseTo(0, 6);
    expect(axis.y).toBeCloseTo(1, 6);
    expect(diagonal.x * axis.x + diagonal.y * axis.y).toBeCloseTo(0, 6);
  });

  it("points a free two-point arrow's head along its chord main axis", () => {
    // 没绑任何图形：端切线取弦的主轴。斜拖时箭头因此正水平/正竖直，
    // 而不是沿弦 —— 用形状 ops 的 B(0.3) 近似会给出沿弦的方向
    const element = API.createElement({
      type: "arrow",
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 100)],
      roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
    });
    const { axis } = arrowheadVectors(element, "end");
    expect(axis.x).toBeCloseTo(1, 6);
    expect(axis.y).toBeCloseTo(0, 6);

    const steep = API.createElement({
      type: "arrow",
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 300)],
      roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
    });
    const steepAxis = arrowheadVectors(steep, "end").axis;
    expect(steepAxis.x).toBeCloseTo(0, 6);
    expect(steepAxis.y).toBeCloseTo(1, 6);
  });
});
