// 飞书画板导入的画笔笔宽像素不变量：转换层把飞书 `paint.width` 原值直传为
// 像素笔宽，并以等宽变体渲染——墨迹外宽（中性压力下）必须 == 飞书 `paint.width`。
//
// 测量口径：长横笔迹的长度方向沿 x 轴，宽度方向沿 y 轴，故 y 跨度即墨迹外宽。
// 等宽档半径恒为 `strokeWidth / 2`，与压力无关，整体跨度即外宽。

import { DEFAULT_FREEDRAW_STROKE_WIDTH } from "@excalidraw/common";
import { getFreedrawOutlinePoints } from "@excalidraw/element";

import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { convertBoard } from "../src/index.js";

import { paintNode } from "./fixtures/lark-nodes.js";

import type { BoardImportElement, LarkBoardNode } from "../src/index.js";

// 场景元素契约只声明公共字段，模型专属字段经索引签名以 unknown 读取后再落断言。
function prop<T>(element: BoardImportElement, key: string): T {
  return element[key] as T;
}

function findFreedraw(elements: BoardImportElement[]): BoardImportElement {
  const el = elements.find((e) => e.type === "freedraw");
  if (!el) {
    throw new Error("freedraw element not found");
  }
  return el;
}

// 长横笔迹：21 点 × 5px 步长，长度方向沿 x 轴，宽度方向沿 y 轴。
function horizontalStroke(): { x: number; y: number }[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: i * 5, y: 0 }));
}

// 构造指定笔宽的飞书 paint 节点：复用 paintNode 的几何与样式骨架，仅替换
// paint.width 与点序列。type=highlight 仍走等宽路径（opacity 不影响几何）。
function paintWithWidth(width: number | undefined): LarkBoardNode {
  return {
    ...paintNode({ id: "p" }),
    paint: {
      color: "#32a645",
      type: "highlight",
      width,
      lines: horizontalStroke(),
    },
  };
}

// 转换层产出的 freedraw 元素运行时即 ExcalidrawFreeDrawElement；场景元素契约的
// 索引签名使编译期需经 unknown 收窄到具体元素类型，方可用渲染轮廓函数实测。
function asFreedraw(element: BoardImportElement): ExcalidrawFreeDrawElement {
  return element as unknown as ExcalidrawFreeDrawElement;
}

function measureHeight(outline: readonly [number, number][]): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of outline) {
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return maxY - minY;
}

const within1Pct = (actual: number, expected: number) =>
  Math.abs(actual - expected) / expected <= 0.01;

describe("paint 像素笔宽不变量：墨迹外宽 == 飞书 paint.width", () => {
  for (const width of [24, 120]) {
    test(`paint.width=${width}（${
      width > 48 ? "超出滑块范围" : "常见宽度"
    }）原值直传`, () => {
      const { elements } = convertBoard([paintWithWidth(width)]);
      const draw = findFreedraw(elements);
      expect(draw.strokeWidth).toBe(width);
      expect(
        prop<{ variability: string }>(draw, "strokeOptions").variability,
      ).toBe("constant");
      const outline = getFreedrawOutlinePoints(asFreedraw(draw));
      expect(within1Pct(measureHeight(outline), width)).toBe(true);
    });
  }

  test("paint.width 缺失 / 非有限 / ≤0 回落 DEFAULT_FREEDRAW_STROKE_WIDTH", () => {
    for (const width of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -3,
    ]) {
      const { elements } = convertBoard([paintWithWidth(width)]);
      const draw = findFreedraw(elements);
      expect(draw.strokeWidth).toBe(DEFAULT_FREEDRAW_STROKE_WIDTH);
      expect(
        prop<{ variability: string }>(draw, "strokeOptions").variability,
      ).toBe("constant");
      const outline = getFreedrawOutlinePoints(asFreedraw(draw));
      expect(
        within1Pct(measureHeight(outline), DEFAULT_FREEDRAW_STROKE_WIDTH),
      ).toBe(true);
    }
  });
});
