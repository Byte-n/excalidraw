import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { newFreeDrawElement } from "../src/newElement";
import { getFreedrawOutlinePoints } from "../src/shape";

// 自由画笔像素笔宽不变量：`strokeWidth` 即墨迹外宽（中性压力下），两条渲染路径
// 均以像素为基准标定，不再有隐藏系数。
//
// 测量口径：
// - 长笔迹取整体 y 跨度（两端圆帽在中性压力下与中段等宽，故整体跨度即外宽）；
// - 可变档另取长笔迹中段（x 落在中间三分之一）的 y 跨度，隔离圆帽几何、单独
//   验证中性压力下的中段宽度 == strokeWidth。
//
// 说明：可变档单点 / 短笔画（< 3px）的圆帽会触发 perfect-freehand 的合成邻点与
// 短笔圆帽延展（sqrt(size² + 3²)），整体跨度会略大于 strokeWidth——这正是
// `getFreedrawMaxStrokeRadius` 对可变档保留 +3 余量的原因，与宽度标定无关，
// 故中性宽度不变量以「等宽档全程 + 可变档长笔迹中段」为准。

const measureExtent = (outline: readonly [number, number][]) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outline) {
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return { width: maxX - minX, height: maxY - minY };
};

// 长笔迹中段（x 落在中间三分之一）的 y 跨度：隔离两端圆帽后的中段宽度。
const measureBodyHeight = (outline: readonly [number, number][]) => {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [x] of outline) {
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
  }
  const mid = (minX + maxX) / 2;
  const span = (maxX - minX) / 6;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outline) {
    if (Math.abs(x - mid) <= span) {
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }
  return maxY - minY;
};

const horizontalStroke = (count: number, step: number) =>
  Array.from({ length: count }, (_, i) => pointFrom<LocalPoint>(i * step, 0));

const makeElement = ({
  strokeWidth,
  variability,
  points,
}: {
  strokeWidth: number;
  variability: "constant" | "variable";
  points: LocalPoint[];
}) =>
  newFreeDrawElement({
    type: "freedraw",
    x: 0,
    y: 0,
    strokeWidth,
    // pressures 为空 + simulatePressure=false ⇒ perfect-freehand 视为 0.5 中性压力
    simulatePressure: false,
    pressures: [],
    points,
    strokeOptions: { variability, streamline: 0.5 },
  });

const longStroke = () => horizontalStroke(21, 5);

const WIDTHS = [2, 6, 24, 48] as const;

const within1Pct = (actual: number, expected: number) =>
  Math.abs(actual - expected) / expected <= 0.01;

describe("freedraw pixel-width invariant", () => {
  describe("等宽档：渲染外宽 == strokeWidth（单点 / 短笔 / 长笔全程）", () => {
    it.each(WIDTHS)("long stroke, strokeWidth=%s", (strokeWidth) => {
      const outline = getFreedrawOutlinePoints(
        makeElement({
          strokeWidth,
          variability: "constant",
          points: longStroke(),
        }),
      );
      expect(within1Pct(measureExtent(outline).height, strokeWidth)).toBe(true);
    });

    it.each(WIDTHS)("single point, strokeWidth=%s", (strokeWidth) => {
      const outline = getFreedrawOutlinePoints(
        makeElement({
          strokeWidth,
          variability: "constant",
          points: [pointFrom<LocalPoint>(0, 0)],
        }),
      );
      expect(within1Pct(measureExtent(outline).height, strokeWidth)).toBe(true);
    });

    it.each(WIDTHS)("short stroke (2px), strokeWidth=%s", (strokeWidth) => {
      const outline = getFreedrawOutlinePoints(
        makeElement({
          strokeWidth,
          variability: "constant",
          points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(2, 0)],
        }),
      );
      expect(within1Pct(measureExtent(outline).height, strokeWidth)).toBe(true);
    });
  });

  describe("可变档：中性压力下中段宽度 == strokeWidth（长笔全程与中段）", () => {
    it.each(WIDTHS)(
      "long stroke full extent, strokeWidth=%s",
      (strokeWidth) => {
        const outline = getFreedrawOutlinePoints(
          makeElement({
            strokeWidth,
            variability: "variable",
            points: longStroke(),
          }),
        );
        expect(within1Pct(measureExtent(outline).height, strokeWidth)).toBe(
          true,
        );
      },
    );

    it.each(WIDTHS)("long stroke body width, strokeWidth=%s", (strokeWidth) => {
      const outline = getFreedrawOutlinePoints(
        makeElement({
          strokeWidth,
          variability: "variable",
          points: longStroke(),
        }),
      );
      expect(within1Pct(measureBodyHeight(outline), strokeWidth)).toBe(true);
    });
  });
});
