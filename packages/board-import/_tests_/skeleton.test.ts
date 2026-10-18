import { BoardSkeletonError, assertBoardSkeleton } from "../src/index.js";

import type { BoardSkeleton, BoardSkeletonNode } from "../src/index.js";

// 精简手写子集，每节点只携带 assertBoardSkeleton 关注的字段；不复制样例大文件。
function makeNode(overrides: Partial<BoardSkeletonNode>): BoardSkeletonNode {
  return {
    id: "n1",
    kind: "shape",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0,
    zIndex: 0,
    ...overrides,
  };
}

function skeletonOf(nodes: BoardSkeletonNode[]): BoardSkeleton {
  return { nodes };
}

test("合法 skeleton 通过断言", () => {
  const skeleton = skeletonOf([
    makeNode({ id: "a", parentId: "b" }),
    makeNode({ id: "b" }),
  ]);
  expect(() => assertBoardSkeleton(skeleton)).not.toThrow();
});

test("拒绝非有限 x（NaN）", () => {
  const skeleton = skeletonOf([makeNode({ id: "a", x: Number.NaN })]);
  expect(() => assertBoardSkeleton(skeleton)).toThrow(BoardSkeletonError);
});

test("拒绝非有限 height（Infinity）", () => {
  const skeleton = skeletonOf([makeNode({ id: "a", height: Infinity })]);
  expect(() => assertBoardSkeleton(skeleton)).toThrow(BoardSkeletonError);
});

test("拒绝负尺寸", () => {
  const skeleton = skeletonOf([makeNode({ id: "a", width: -1 })]);
  expect(() => assertBoardSkeleton(skeleton)).toThrow(BoardSkeletonError);
});

test("拒绝重复 id", () => {
  const skeleton = skeletonOf([
    makeNode({ id: "dup" }),
    makeNode({ id: "dup" }),
  ]);
  expect(() => assertBoardSkeleton(skeleton)).toThrow(BoardSkeletonError);
});

test("拒绝 parentId 指向不存在的节点", () => {
  const skeleton = skeletonOf([makeNode({ id: "a", parentId: "ghost" })]);
  expect(() => assertBoardSkeleton(skeleton)).toThrow(BoardSkeletonError);
});

test("拒绝 parentId 指向自身", () => {
  const skeleton = skeletonOf([makeNode({ id: "a", parentId: "a" })]);
  expect(() => assertBoardSkeleton(skeleton)).toThrow(BoardSkeletonError);
});

test("拒绝非整数 zIndex", () => {
  const skeleton = skeletonOf([makeNode({ id: "a", zIndex: 1.5 })]);
  expect(() => assertBoardSkeleton(skeleton)).toThrow(BoardSkeletonError);
});

test("拒绝空 id", () => {
  const skeleton = skeletonOf([makeNode({ id: "" })]);
  expect(() => assertBoardSkeleton(skeleton)).toThrow(BoardSkeletonError);
});
