import { arrayToMap } from "@excalidraw/common";
import {
  bezierEquation,
  curve,
  distanceToLineSegment,
  lineSegment,
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
  type Radians,
} from "@excalidraw/math";

import { getBindingGap, snapToMid } from "../src/binding";
import {
  getHoveredElementForBinding,
  intersectElementWithLineSegment,
  isPointInElement,
} from "../src/collision";
import {
  getCompositeShapeAnchors,
  getCompositeShapeGeometry,
  getCompositeShapeGlobalPoints,
} from "../src/compositeShape";
import { distanceToElement } from "../src/distance";
import { newArrowElement, newElement } from "../src/newElement";

import type { FractionalIndex, NonDeletedSceneElementsMap } from "../src/types";

const horizontalLine = (y: number) =>
  lineSegment(pointFrom<GlobalPoint>(-100, y), pointFrom<GlobalPoint>(200, y));

const distanceToOutline = (
  point: GlobalPoint,
  outline: GlobalPoint[],
  closed: boolean,
) =>
  Math.min(
    ...outline
      .slice(0, closed ? undefined : -1)
      .map((start, index) =>
        distanceToLineSegment(
          point,
          lineSegment(start, outline[(index + 1) % outline.length]),
        ),
      ),
  );

describe("composite shape line intersections", () => {
  it.each([
    { type: "step", inside: [45, 50], empty: [8, 50], outline: [20, 50] },
    { type: "star", inside: [50, 50], empty: [75, 20], outline: [50, 0] },
    {
      type: "rectangle-bubble",
      inside: [75, 90],
      empty: [20, 95],
      outline: [76, 100],
    },
    {
      type: "bubble",
      inside: [10, 88],
      empty: [20, 98],
      outline: [5, 97.5],
    },
    { type: "cube", inside: [50, 50], empty: [5, 5], outline: [100, 50] },
    { type: "cylinder", inside: [50, 50], empty: [5, 5], outline: [50, 0] },
  ] as const)(
    "uses $type's visible contour for fill and binding",
    ({ type, inside, empty, outline }) => {
      const element = {
        ...newElement({
          type,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          backgroundColor: "#eae2fe",
        }),
        index: "a0" as FractionalIndex,
      };
      const elementsMap = arrayToMap([element]) as NonDeletedSceneElementsMap;
      const point = ([x, y]: readonly number[]) => pointFrom<GlobalPoint>(x, y);

      expect(isPointInElement(point(inside), element, elementsMap)).toBe(true);
      expect(isPointInElement(point(empty), element, elementsMap)).toBe(false);
      expect(
        getHoveredElementForBinding(point(empty), [element], elementsMap, 2),
      ).toBeNull();
      expect(
        getHoveredElementForBinding(point(outline), [element], elementsMap, 2),
      ).toBe(element);
    },
  );

  it.each([
    { type: "brace", stroke: [13.5, 30], empty: [80, 60] },
    { type: "brace-reverse", stroke: [150.5, 30], empty: [80, 60] },
  ] as const)(
    "uses the rectangular interaction area for $type without changing binding targets",
    ({ type, stroke, empty }) => {
      const element = {
        ...newElement({
          type,
          x: 0,
          y: 0,
          width: 164,
          height: 120,
          backgroundColor: "#eae2fe",
        }),
        index: "a0" as FractionalIndex,
      };
      const elementsMap = arrayToMap([element]) as NonDeletedSceneElementsMap;
      const point = ([x, y]: readonly number[]) => pointFrom<GlobalPoint>(x, y);

      expect(isPointInElement(point(stroke), element, elementsMap)).toBe(true);
      expect(isPointInElement(point(empty), element, elementsMap)).toBe(true);
      expect(
        getHoveredElementForBinding(point(empty), [element], elementsMap, 2),
      ).toBeNull();
      expect(
        getHoveredElementForBinding(point(stroke), [element], elementsMap, 2),
      ).toBe(element);
    },
  );

  it.each([
    "cross",
    "brace-reverse",
    "brace",
    "cloud",
    "double-arrow",
    "forward-arrow",
    "backward-arrow",
    "octagon",
    "pentagon",
    "hexagon",
    "star",
    "triangle",
    "round-rect",
    "rectangle-bubble",
    "pill",
    "bubble",
    "trapezoid",
    "parallelogram",
    "right-pentagon",
    "step",
    "cube",
    "cylinder",
  ] as const)("keeps %s anchors on its rotated visible outline", (type) => {
    const element = newElement({
      type,
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      angle: (Math.PI / 7) as Radians,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const elementsMap = arrayToMap([element]);
    for (const anchor of getCompositeShapeAnchors(element)) {
      expect(distanceToElement(element, elementsMap, anchor)).toBeLessThan(
        0.03,
      );
    }
  });

  it("places rotated parallelogram anchors on its slanted sides", () => {
    const element = newElement({
      type: "parallelogram",
      x: 20,
      y: 30,
      width: 100,
      height: 80,
      angle: (Math.PI / 5) as Radians,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const center = pointFrom<GlobalPoint>(70, 70);
    const [right, bottom, left, top] = getCompositeShapeAnchors(element);
    const expectedRight = pointRotateRads(
      pointFrom<GlobalPoint>(111, 70),
      center,
      element.angle,
    );
    const expectedLeft = pointRotateRads(
      pointFrom<GlobalPoint>(29, 70),
      center,
      element.angle,
    );
    const expectedBottom = pointRotateRads(
      pointFrom<GlobalPoint>(61, 110),
      center,
      element.angle,
    );
    const expectedTop = pointRotateRads(
      pointFrom<GlobalPoint>(79, 30),
      center,
      element.angle,
    );
    expect(right[0]).toBeCloseTo(expectedRight[0], 3);
    expect(right[1]).toBeCloseTo(expectedRight[1], 3);
    expect(left[0]).toBeCloseTo(expectedLeft[0], 3);
    expect(left[1]).toBeCloseTo(expectedLeft[1], 3);
    expect(bottom[0]).toBeCloseTo(expectedBottom[0], 3);
    expect(bottom[1]).toBeCloseTo(expectedBottom[1], 3);
    expect(top[0]).toBeCloseTo(expectedTop[0], 3);
    expect(top[1]).toBeCloseTo(expectedTop[1], 3);
  });

  it("keeps the binding gap from a parallelogram's slanted side", () => {
    const element = newElement({
      type: "parallelogram",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      strokeWidth: 2,
    });
    const arrow = newArrowElement({ type: "arrow", x: 140, y: 40 });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const elementsMap = arrayToMap([element, arrow]);
    const anchor = getCompositeShapeAnchors(element)[0];
    const snapped = snapToMid(
      element,
      elementsMap,
      pointFrom<GlobalPoint>(93, 40),
      0.05,
      arrow,
    );
    expect(snapped).toBeDefined();
    expect(snapped![0]).toBeGreaterThan(anchor[0]);
    expect(distanceToElement(element, elementsMap, snapped!)).toBeCloseTo(
      getBindingGap(element, arrow),
      1,
    );
  });

  it("uses the cylinder's visible cubic for hit distance and intersections", () => {
    const element = newElement({
      type: "cylinder",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const outline = getCompositeShapeGeometry(element).outline;
    const top = outline.commands[0];
    if (top.type !== "cubic") {
      throw new Error("Expected cubic top edge");
    }
    const topMidpoint = bezierEquation(
      curve(
        pointFrom<GlobalPoint>(...outline.start),
        pointFrom<GlobalPoint>(...top.control1),
        pointFrom<GlobalPoint>(...top.control2),
        pointFrom<GlobalPoint>(...top.to),
      ),
      0.5,
    );
    const elementsMap = arrayToMap([element]);
    expect(distanceToElement(element, elementsMap, topMidpoint)).toBeLessThan(
      0.01,
    );
    const hits = intersectElementWithLineSegment(
      element,
      elementsMap,
      lineSegment(
        pointFrom<GlobalPoint>(topMidpoint[0], -20),
        pointFrom<GlobalPoint>(topMidpoint[0], 120),
      ),
    );
    expect(hits.some((hit) => Math.abs(hit[1] - topMidpoint[1]) < 0.01)).toBe(
      true,
    );
  });

  it("binds to an open brace only near its visible stroke", () => {
    const brace = {
      ...newElement({
        type: "brace",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }),
      index: "a0" as FractionalIndex,
    };
    const elementsMap = arrayToMap([brace]) as NonDeletedSceneElementsMap;
    expect(
      getHoveredElementForBinding(
        pointFrom<GlobalPoint>(90, 50),
        [brace],
        elementsMap,
        5,
      ),
    ).toBeNull();
    expect(
      getHoveredElementForBinding(
        pointFrom<GlobalPoint>(14, 50),
        [brace],
        elementsMap,
        5,
      ),
    ).toBe(brace);
  });

  it("preserves zero-offset intersections for closed and open shapes", () => {
    const cross = newElement({
      type: "cross",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const brace = newElement({
      type: "brace",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    expect(
      intersectElementWithLineSegment(
        cross,
        arrayToMap([cross]),
        horizontalLine(50),
      )
        .map(([x]) => x)
        .sort((a, b) => a - b),
    ).toEqual([0, 100]);
    expect(
      intersectElementWithLineSegment(
        brace,
        arrayToMap([brace]),
        horizontalLine(9),
      ),
    ).toHaveLength(1);
  });

  it("keeps a binding gap around a concave shape", () => {
    const cross = newElement({
      type: "cross",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeWidth: 2,
    });
    const gap = getBindingGap(cross, { elbowed: false });
    const intersections = intersectElementWithLineSegment(
      cross,
      arrayToMap([cross]),
      horizontalLine(50),
      gap,
    )
      .map(([x]) => x)
      .sort((a, b) => a - b);

    expect(intersections).toHaveLength(2);
    expect(intersections[0]).toBeCloseTo(-gap, 1);
    expect(intersections[1]).toBeCloseTo(100 + gap, 1);
  });

  it.each(["triangle", "star", "pill"] as const)(
    "offsets a rotated %s by the requested distance",
    (type) => {
      const element = newElement({
        type,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        angle: (Math.PI / 4) as Radians,
      });
      if (element.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const intersections = intersectElementWithLineSegment(
        element,
        arrayToMap([element]),
        horizontalLine(50),
        10,
      );
      const outline = getCompositeShapeGlobalPoints(element);

      expect(intersections.length).toBeGreaterThanOrEqual(2);
      for (const intersection of intersections) {
        expect(distanceToOutline(intersection, outline, true)).toBeCloseTo(
          10,
          0,
        );
      }
    },
  );

  it.each(["brace", "brace-reverse"] as const)(
    "adds round caps to an open %s without closing its zero-offset path",
    (type) => {
      const brace = newElement({
        type,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
      if (brace.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const elementsMap = arrayToMap([brace]);
      const segment = horizontalLine(-5);

      expect(
        intersectElementWithLineSegment(brace, elementsMap, segment),
      ).toEqual([]);
      const intersections = intersectElementWithLineSegment(
        brace,
        elementsMap,
        segment,
        10,
      );
      expect(intersections).toHaveLength(2);
      for (const intersection of intersections) {
        expect(
          distanceToOutline(
            intersection,
            getCompositeShapeGlobalPoints(brace),
            false,
          ),
        ).toBeCloseTo(10, 0);
      }
    },
  );
});
