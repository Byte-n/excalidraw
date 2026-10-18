import {
  BoardValidationError,
  assertLarkBoard,
  convertBoard,
} from "../src/index.js";

import { groupNode, shapeNode } from "./fixtures/lark-nodes.js";

import type { LarkBoardNode } from "../src/index.js";

// 精简手写子集，每节点只携带闸门关注的字段；不复制样例大文件。
function node(overrides: Partial<LarkBoardNode> = {}): LarkBoardNode {
  return {
    id: "n1",
    type: "composite_shape",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    z_index: 0,
    ...overrides,
  };
}

test("合法节点通过闸门", () => {
  expect(() =>
    assertLarkBoard([node({ id: "a", parent_id: "b" }), node({ id: "b" })]),
  ).not.toThrow();
});

test("拒绝重复 id", () => {
  expect(() =>
    assertLarkBoard([node({ id: "dup" }), node({ id: "dup" })]),
  ).toThrow(BoardValidationError);
});

test("拒绝 parent_id 指向不存在的节点", () => {
  expect(() =>
    assertLarkBoard([node({ id: "a", parent_id: "ghost" })]),
  ).toThrow(BoardValidationError);
});

test("拒绝 parent_id 指向自身", () => {
  expect(() => assertLarkBoard([node({ id: "a", parent_id: "a" })])).toThrow(
    BoardValidationError,
  );
});

test("拒绝 children 含自身", () => {
  expect(() => assertLarkBoard([node({ id: "a", children: ["a"] })])).toThrow(
    BoardValidationError,
  );
});

test("parent_id 指向被丢弃类型（group）的父节点不再失败", () => {
  expect(() =>
    assertLarkBoard([
      groupNode({ id: "g" }),
      node({ id: "c", parent_id: "g" }),
    ]),
  ).not.toThrow();
});

test("group 祖先不参与坐标累加：子元素落点等于其原始坐标", () => {
  const { elements } = convertBoard([
    groupNode({ id: "g", x: 1000, y: 7000 }),
    shapeNode({ id: "child", parent_id: "g", x: 50, y: 60 }),
  ]);
  const child = elements.find((el) => el.id === "child");
  if (!child) {
    throw new Error("child not found");
  }
  expect(child.x).toBe(50);
  expect(child.y).toBe(60);
});

test("闸门放宽的退化输入不整板失败，归一结果由归一化层吸收", () => {
  // 闸门不再把 NaN/Infinity/负尺寸、非整数 z_index、空 id、成环、父为被丢弃
  // 类型判为整板失败：这些由归一化层吸收，闸门只保留 id 唯一、parent_id 存在
  // 且非自身、children 不含自身等结构性不变量。
  expect(() =>
    assertLarkBoard([
      node({
        id: "deg",
        width: Number.NaN,
        height: Number.NEGATIVE_INFINITY,
        z_index: 2.7,
      }),
    ]),
  ).not.toThrow();
  expect(() => assertLarkBoard([{ ...node(), id: "" }])).not.toThrow();
  expect(() =>
    assertLarkBoard([
      node({ id: "a", parent_id: "b" }),
      node({ id: "b", parent_id: "a" }),
    ]),
  ).not.toThrow();
  expect(() =>
    assertLarkBoard([
      groupNode({ id: "g" }),
      node({ id: "c", parent_id: "g" }),
    ]),
  ).not.toThrow();

  // 归一结果：非有限/负宽高 → 元素 width/height 为 0；空 id 节点计入
  // droppedNodes；非整数 z_index 被截断（2.7 与显式 2 同序，先入者在前）。
  const { elements, droppedNodes } = convertBoard([
    shapeNode({ id: "frac", width: Number.NaN, height: -5, z_index: 2.7 }),
    { ...shapeNode(), id: "" },
    shapeNode({ id: "intZ", z_index: 2 }),
  ]);
  const frac = elements.find((el) => el.id === "frac");
  if (!frac) {
    throw new Error("frac not found");
  }
  expect(frac.width).toBe(0);
  expect(frac.height).toBe(0);
  expect(droppedNodes).toBe(1);
  const intZ = elements.find((el) => el.id === "intZ");
  if (!intZ) {
    throw new Error("intZ not found");
  }
  expect(String(frac.index) < String(intZ.index)).toBe(true);
});
