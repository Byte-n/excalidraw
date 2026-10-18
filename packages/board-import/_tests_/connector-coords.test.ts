import { convertBoard } from "../src/index.js";

import {
  deepInnerSectionNode,
  deepNestedConnector,
  deepOuterSectionNode,
  nestedCurveConnector,
  nestedPolylineConnector,
  nestedStraightConnector,
  offsetSectionNode,
  polylineConnectorNode,
  shapeNode,
  straightConnectorNode,
} from "./fixtures/lark-nodes.js";

import type { BoardImportElement, LarkBoardNode } from "../src/index.js";

// 场景元素契约只声明公共字段，模型专属字段经索引签名以 unknown 读取后再落断言。
function prop<T>(element: BoardImportElement, key: string): T {
  return element[key] as T;
}

function render(nodes: LarkBoardNode[]) {
  return convertBoard(nodes);
}

function arrow(elements: BoardImportElement[], id: string): BoardImportElement {
  const element = elements.find((el) => el.id === id);
  if (!element) {
    throw new Error(`element ${id} not found`);
  }
  return element;
}

function pointsOf(
  element: BoardImportElement,
): ReadonlyArray<[number, number]> {
  return prop<ReadonlyArray<[number, number]>>(element, "points");
}

function expectPoint(
  actual: readonly [number, number],
  expected: readonly [number, number],
): void {
  expect(actual[0]).toBeCloseTo(expected[0], 3);
  expect(actual[1]).toBeCloseTo(expected[1], 3);
}

test("夹具自洽：无父偏移直线 / 折线的局部量等于端点原始坐标", () => {
  const { elements } = render([
    straightConnectorNode({ id: "c2" }),
    polylineConnectorNode({ id: "c3" }),
  ]);
  const straight = arrow(elements, "c2");
  expect(prop<number>(straight, "x")).toBeCloseTo(733, 3);
  expect(prop<number>(straight, "y")).toBeCloseTo(2063, 3);
  const straightPoints = pointsOf(straight);
  expect(straightPoints).toHaveLength(2);
  expectPoint(straightPoints[0], [0, 0]);
  expectPoint(straightPoints[1], [201, 0]);

  const polylinePoints = pointsOf(arrow(elements, "c3"));
  expect(polylinePoints).toHaveLength(4);
  expectPoint(polylinePoints[0], [0, 0]);
  expectPoint(polylinePoints[1], [30, 40]);
  expectPoint(polylinePoints[2], [70, 40]);
  expectPoint(polylinePoints[3], [100, 0]);
});

test("父偏移非 0 直线：元素取绝对原点，端点为父相对局部量", () => {
  const { elements } = render([offsetSectionNode(), nestedStraightConnector()]);
  const element = arrow(elements, "nestedStraight");
  expect(prop<number>(element, "x")).toBeCloseTo(1036.5166, 3);
  expect(prop<number>(element, "y")).toBeCloseTo(7201.9443, 3);
  const points = pointsOf(element);
  expect(points).toHaveLength(2);
  expectPoint(points[0], [0, 0]);
  expectPoint(points[1], [111.634, 0]);
});

test("父偏移非 0 折线：折点原样进 points，端点回父相对局部量", () => {
  const { elements } = render([offsetSectionNode(), nestedPolylineConnector()]);
  const element = arrow(elements, "nestedPolyline");
  expect(prop<number>(element, "x")).toBeCloseTo(1036.5166, 3);
  expect(prop<number>(element, "y")).toBeCloseTo(7201.9443, 3);
  const points = pointsOf(element);
  expect(points).toHaveLength(4);
  expectPoint(points[0], [0, 0]);
  expectPoint(points[1], [50, 0]);
  expectPoint(points[2], [90, 30]);
  expectPoint(points[3], [111.634, 0]);
});

test("父偏移非 0 曲线：中点由修正后的端点推导", () => {
  const { elements } = render([offsetSectionNode(), nestedCurveConnector()]);
  const element = arrow(elements, "nestedCurve");
  expect(prop<number>(element, "x")).toBeCloseTo(1036.5166, 3);
  expect(prop<number>(element, "y")).toBeCloseTo(7201.9443, 3);
  const points = pointsOf(element);
  expect(points).toHaveLength(3);
  expectPoint(points[0], [0, 0]);
  expectPoint(points[1], [50, 15]);
  expectPoint(points[2], [100, 0]);
});

test("父偏移非 0 连线标签：落点等于绝对原点加沿路径比例取点", () => {
  const { elements } = render([offsetSectionNode(), nestedCurveConnector()]);
  const caption = elements.find(
    (el) => el.type === "text" && el.text === "曲线标签",
  );
  if (!caption) {
    throw new Error("caption not found");
  }
  expect(prop<string | null>(caption, "containerId")).toBe("nestedCurve");
  expect(prop<number>(caption, "x")).toBeCloseTo(1086.5166, 3);
  expect(prop<number>(caption, "y")).toBeCloseTo(7201.9443, 3);
});

test("≥2 层父容器：绝对原点逐层累加", () => {
  const { elements } = render([
    deepOuterSectionNode(),
    deepInnerSectionNode(),
    deepNestedConnector(),
  ]);
  const element = arrow(elements, "deepNested");
  expect(prop<number>(element, "x")).toBeCloseTo(1136.5166, 3);
  expect(prop<number>(element, "y")).toBeCloseTo(7401.9443, 3);
  const points = pointsOf(element);
  expect(points).toHaveLength(2);
  expectPoint(points[0], [0, 0]);
  expectPoint(points[1], [111.634, 0]);
});

// 绑定态端点：目标绝对 box 与连线绝对原点同系相减，不受父偏移影响。
test("绑定分支不回归：attachPoint / boundElements 不变，局部量为目标绝对点减连线绝对原点", () => {
  const CONN_ABS = { x: 1036.5166, y: 7201.9443 };
  // 两端目标图形同处 offsetSec 内：targetA 绝对 (1050, 7100)，targetB 绝对 (1300, 7100)，
  // 尺寸均为 120 × 80。
  const targets: LarkBoardNode[] = [
    shapeNode({ id: "targetA", parent_id: "offsetSec", x: 50, y: 100 }),
    shapeNode({ id: "targetB", parent_id: "offsetSec", x: 300, y: 100 }),
  ];
  const connector: LarkBoardNode = {
    id: "bound1",
    type: "connector",
    parent_id: "offsetSec",
    x: 36.5166,
    y: 201.9443,
    width: 111.634,
    height: 0,
    angle: 0,
    z_index: 1,
    connector: {
      shape: "straight",
      start: {
        arrow_style: "none",
        attached_object: {
          id: "targetA",
          position: { x: 1, y: 0.5 },
          snap_to: "right",
        },
      },
      end: {
        arrow_style: "line_arrow",
        attached_object: {
          id: "targetB",
          position: { x: 0, y: 0.5 },
          snap_to: "left",
        },
      },
      turning_points: [],
      captions: { data: [] },
    },
  };

  const { elements } = render([offsetSectionNode(), ...targets, connector]);
  const element = arrow(elements, "bound1");

  expect(element.x).toBeCloseTo(CONN_ABS.x, 3);
  expect(element.y).toBeCloseTo(CONN_ABS.y, 3);
  expect(element.startBinding).toEqual({
    elementId: "targetA",
    attachPoint: [1, 0.5],
  });
  expect(element.endBinding).toEqual({
    elementId: "targetB",
    attachPoint: [0, 0.5],
  });

  // 目标绝对点：targetA 右边界中点 (1050 + 120, 7100 + 80 × 0.5)。
  const startAbs = { x: 1050 + 120, y: 7100 + 80 * 0.5 };
  const endAbs = { x: 1300, y: 7100 + 80 * 0.5 };
  const points = pointsOf(element);
  expect(points).toHaveLength(2);
  expectPoint(points[0], [startAbs.x - CONN_ABS.x, startAbs.y - CONN_ABS.y]);
  expectPoint(points[1], [endAbs.x - CONN_ABS.x, endAbs.y - CONN_ABS.y]);

  const targetA = arrow(elements, "targetA");
  expect(
    (targetA.boundElements ?? []).some(
      (entry) => entry.id === "bound1" && entry.type === "arrow",
    ),
  ).toBe(true);
});
