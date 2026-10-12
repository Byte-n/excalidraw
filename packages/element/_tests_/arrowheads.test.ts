import { pointFrom } from "@excalidraw/math";

import { getArrowheadPoints } from "../src/bounds";

import type { Arrowhead, ExcalidrawLinearElement } from "../src/types";
import type { Drawable } from "roughjs/bin/core";

// Hand-built bezier ops for a straight horizontal connector from (0, 0) to
// (endX, 0); collinear control points keep the direction math exact.
const makeShape = (endX = 200): Drawable[] =>
  [
    {
      sets: [
        {
          type: "path",
          ops: [
            { op: "move", data: [0, 0] },
            {
              op: "bcurveTo",
              data: [endX / 3, 0, (2 * endX) / 3, 0, endX, 0],
            },
          ],
        },
      ],
    },
  ] as unknown as Drawable[];

const makeElement = (
  strokeWidth: number,
  endX = 200,
): ExcalidrawLinearElement =>
  ({
    type: "arrow",
    strokeWidth,
    points: [pointFrom(0, 0), pointFrom(endX, 0)],
  } as unknown as ExcalidrawLinearElement);

const getPoints = (
  arrowhead: Arrowhead,
  strokeWidth: number,
  position: "start" | "end" = "end",
  endX = 200,
) =>
  getArrowheadPoints(
    makeElement(strokeWidth, endX),
    makeShape(endX),
    position,
    arrowhead,
  );

// Design values are calibrated to the 1.5px reference stroke; at 3px the
// strokeScale is (3 + 1.5) / 3 = 1.5, so every offset scales by 1.5.
describe("getArrowheadPoints", () => {
  const expectPoints = (actual: number[] | null, expected: number[]) => {
    expect(actual).not.toBeNull();
    expect(actual).toHaveLength(expected.length);
    actual!.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index], 10);
    });
  };

  describe("1.5px stroke (scale ×1)", () => {
    it("diamond: tip at line end, side corners ±4.5 at -6.5, back at -13", () => {
      expectPoints(
        getPoints("diamond", 1.5),
        [200, 0, 193.5, 4.5, 187, 0, 193.5, -4.5],
      );
      expectPoints(
        getPoints("diamond_outline", 1.5),
        [200, 0, 193.5, 4.5, 187, 0, 193.5, -4.5],
      );
    });

    it("circle: center -4.5 behind the tip, diameter 9", () => {
      expectPoints(getPoints("circle", 1.5), [195.5, 0, 9]);
      expectPoints(getPoints("circle_outline", 1.5), [195.5, 0, 8]);
    });

    it("cardinality_many: base at -11, arms ending exactly at (0, ±6)", () => {
      expectPoints(
        getPoints("cardinality_many", 1.5),
        [189, 0, 200, 6, 200, -6],
      );
    });

    it("cardinality_one_or_many: crowfoot plus bar at -15", () => {
      expectPoints(
        getPoints("cardinality_one_or_many", 1.5),
        [189, 0, 200, 6, 200, -6, 185, 6, 185, -6],
      );
    });

    it("cardinality_zero_or_many: crowfoot plus circle centered at -18.5 r3.5", () => {
      expectPoints(
        getPoints("cardinality_zero_or_many", 1.5),
        [189, 0, 200, 6, 200, -6, 181.5, 0, 7],
      );
    });

    it("cardinality_exactly_one: bars at 0 and -5", () => {
      expectPoints(
        getPoints("cardinality_exactly_one", 1.5),
        [200, 6, 200, -6, 195, 6, 195, -6],
      );
    });

    it("cardinality_zero_or_one: bar at 0, circle centered at -7.5 r3.5", () => {
      expectPoints(
        getPoints("cardinality_zero_or_one", 1.5),
        [192.5, 0, 7, 200, 6, 200, -6],
      );
    });

    it("x_arrow: 9×9 cross centered at -9.9", () => {
      expectPoints(
        getPoints("x_arrow", 1.5),
        [185.6, -4.5, 194.6, 4.5, 185.6, 4.5, 194.6, -4.5],
      );
    });

    it("start position mirrors the geometry along the line axis", () => {
      expectPoints(
        getPoints("diamond", 1.5, "start"),
        [0, 0, 6.5, -4.5, 13, 0, 6.5, 4.5],
      );
    });
  });

  describe("3px stroke (scale ×1.5)", () => {
    it("diamond scales all four corners", () => {
      expectPoints(
        getPoints("diamond", 3),
        [200, 0, 190.25, 6.75, 180.5, 0, 190.25, -6.75],
      );
    });

    it("cardinality_many scales base and arms", () => {
      expectPoints(
        getPoints("cardinality_many", 3),
        [183.5, 0, 200, 9, 200, -9],
      );
    });

    it("cardinality_one_or_many scales the bar position", () => {
      expectPoints(
        getPoints("cardinality_one_or_many", 3),
        [183.5, 0, 200, 9, 200, -9, 177.5, 9, 177.5, -9],
      );
    });

    it("cardinality_zero_or_many scales circle center and radius", () => {
      expectPoints(
        getPoints("cardinality_zero_or_many", 3),
        [183.5, 0, 200, 9, 200, -9, 172.25, 0, 10.5],
      );
    });

    it("cardinality_exactly_one scales both bars", () => {
      expectPoints(
        getPoints("cardinality_exactly_one", 3),
        [200, 9, 200, -9, 192.5, 9, 192.5, -9],
      );
    });

    it("cardinality_zero_or_one scales circle and bar", () => {
      expectPoints(
        getPoints("cardinality_zero_or_one", 3),
        [188.75, 0, 10.5, 200, 9, 200, -9],
      );
    });

    it("x_arrow scales the cross", () => {
      expectPoints(
        getPoints("x_arrow", 3),
        [178.4, -6.75, 191.9, 6.75, 178.4, 6.75, 191.9, -6.75],
      );
    });

    it("circle scales center and diameter", () => {
      expectPoints(getPoints("circle", 3), [193.25, 0, 13.5]);
      expectPoints(getPoints("circle_outline", 3), [193.25, 0, 12]);
    });
  });

  describe("short segments", () => {
    it("shrinks heads proportionally to minSize / size", () => {
      // length 10 → minSize = 10 × 0.5 = 5 for the crowfoot (size 12)
      expectPoints(getPoints("cardinality_many", 1.5, "end", 10), [
        10 - (11 * 5) / 12,
        0,
        10,
        (6 * 5) / 12,
        10,
        (-6 * 5) / 12,
      ]);
    });
  });
});
