import { arrayToMap, ROUNDNESS } from "@excalidraw/common";
import {
  bezierEquation,
  curve,
  lineSegment,
  pointFrom,
  type GlobalPoint,
  type Radians,
} from "@excalidraw/math";

import { getElementBounds, getElementLineSegments } from "../src/bounds";
import {
  isPointInElement,
  intersectElementWithLineSegment,
  isBindableElementInsideOtherBindable,
} from "../src/collision";
import {
  assertBaseShapeData,
  baseShapeData,
  compositeShapePathToSvg,
  getCompositeShapeControlPoints,
  getCompositeShapeAnchors,
  getCompositeShapeGeometry,
  getCompositeShapeGlobalPath,
  getCompositeShapeGlobalPoints,
  getCompositeShapeDimensionsForText,
  getCompositeShapePaddedTextBounds,
  getCompositeShapePoints,
  getCompositeShapeTextBounds,
  isCompositeShapeElement,
  isCompositeShapeId,
  isCompositeShapeIdIn,
  isCompositeShapeOpen,
  updateCompositeShapeControlPoint,
} from "../src/compositeShape";
import { distanceToElement } from "../src/distance";
import { hasBackground, hasFillStyle } from "../src/comparisons";
import { deepCopyElement } from "../src/duplicate";
import { mutateElement } from "../src/mutateElement";
import { newElement } from "../src/newElement";
import {
  generateRoughOptions,
  getElementShape,
  ShapeCache,
} from "../src/shape";
import { isExcalidrawElement } from "../src/typeChecks";
import { convertToExcalidrawElements } from "../src/transform";

import type { BaseShapeData, BaseShapeId } from "../src/types";

describe("composite shape data", () => {
  it("exposes fill controls only for closed composite shapes", () => {
    for (const type of [
      "brace",
      "brace-reverse",
      "rectangle",
      "cloud",
    ] as const) {
      const element = newElement({
        type,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        backgroundColor: "#ff0000",
      });
      const canFill = type !== "brace" && type !== "brace-reverse";
      expect(element.backgroundColor).toBe(canFill ? "#ff0000" : "transparent");
      expect(hasBackground(element)).toBe(canFill);
      expect(hasFillStyle(element)).toBe(canFill);
      expect(hasBackground(type)).toBe(canFill);
      expect(generateRoughOptions(element).fill).toBe(
        canFill ? "#ff0000" : undefined,
      );
    }
  });

  it.each([
    "rectangle",
    "diamond",
    "ellipse",
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
  ] as const)("reverses the padded text area for %s", (type) => {
    const element = newElement({
      type,
      x: 0,
      y: 0,
      width: 48,
      height: 36,
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const dimensions = getCompositeShapeDimensionsForText(
      {
        ...element,
        textFitMinWidth: 48,
        textFitMinHeight: 36,
      },
      140,
      96,
    );
    const bounds = getCompositeShapePaddedTextBounds({
      ...element,
      ...dimensions,
    });
    expect(bounds.width).toBeGreaterThanOrEqual(140 - 1e-5);
    expect(bounds.height).toBeGreaterThanOrEqual(96 - 1e-5);
  });

  it("keeps a fixed 2px cube text gap around its front face", () => {
    const bounds = getCompositeShapePaddedTextBounds({
      width: 200,
      height: 100,
      shape: {
        id: "cube",
        schemaVersion: 1,
        cube: { controlPoint: { x: 0.8, y: 0.2 } },
      },
    });
    expect(bounds.x).toBeCloseTo(2);
    expect(160 - bounds.x - bounds.width).toBeCloseTo(2);
    expect(bounds.y - 20).toBeCloseTo(2);
    expect(100 - bounds.y - bounds.height).toBeCloseTo(2);
  });

  it.each([
    [120, 80],
    [200, 50],
    [50, 200],
  ])("uses the full safe height of a %sx%s step", (width, height) => {
    const bounds = getCompositeShapeTextBounds({
      width,
      height,
      shape: baseShapeData("step"),
    });
    const slope = (0.76 * width) / height;
    const rightEdgeAtTop = width * 0.62 + slope * bounds.y;

    expect(bounds.x - width * 0.2).toBeCloseTo(2);
    expect(bounds.y).toBe(2);
    expect(height - bounds.y - bounds.height).toBeCloseTo(2);
    expect(
      (rightEdgeAtTop - bounds.x - bounds.width) / Math.hypot(1, slope),
    ).toBeCloseTo(2);
  });

  it.each([
    [120, 80],
    [200, 50],
    [50, 200],
  ])("extends arrow text into the heads at %sx%s", (width, height) => {
    for (const type of [
      "forward-arrow",
      "backward-arrow",
      "double-arrow",
    ] as const) {
      const bounds = getCompositeShapeTextBounds({
        width,
        height,
        shape: baseShapeData(type),
      });
      const double = type === "double-arrow";
      const slope = ((double ? 0.44 : 0.76) * width) / height;
      const leftAtTop = (double ? 0.22 : 0.38) * width - slope * bounds.y;
      const rightAtTop = (double ? 0.78 : 0.62) * width + slope * bounds.y;

      expect(bounds.y - height * 0.28).toBeCloseTo(2);
      expect(height * 0.72 - bounds.y - bounds.height).toBeCloseTo(2);
      if (type !== "forward-arrow") {
        expect(bounds.x).toBeLessThan((double ? 0.22 : 0.38) * width);
        expect((bounds.x - leftAtTop) / Math.hypot(1, slope)).toBeCloseTo(2);
      }
      if (type !== "backward-arrow") {
        expect(bounds.x + bounds.width).toBeGreaterThan(
          (double ? 0.78 : 0.62) * width,
        );
        expect(
          (rightAtTop - bounds.x - bounds.width) / Math.hypot(1, slope),
        ).toBeCloseTo(2);
      }
    }
  });

  it.each([
    [120, 80],
    [200, 50],
    [50, 200],
  ])("uses the rectangular body of a %sx%s right pentagon", (width, height) => {
    const bounds = getCompositeShapeTextBounds({
      width,
      height,
      shape: baseShapeData("right-pentagon"),
    });

    expect(bounds.x).toBe(2);
    expect(bounds.y).toBe(2);
    expect(width * 0.65 - bounds.x - bounds.width).toBeCloseTo(2);
    expect(height - bounds.y - bounds.height).toBeCloseTo(2);
  });

  it.each([
    [120, 80],
    [200, 50],
    [50, 200],
  ])("extends bubble text toward its lower curve at %sx%s", (width, height) => {
    const element = newElement({
      type: "bubble",
      x: 0,
      y: 0,
      width,
      height,
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const bounds = getCompositeShapeTextBounds(element);
    const bottom = bounds.y + bounds.height;
    const elementsMap = arrayToMap([element]);

    expect(bottom).toBeCloseTo(height * 0.87 - 2);
    for (const x of [bounds.x, bounds.x + bounds.width]) {
      expect(
        isPointInElement(
          pointFrom<GlobalPoint>(x, bottom),
          element,
          elementsMap,
        ),
      ).toBe(true);
      expect(
        distanceToElement(
          element,
          elementsMap,
          pointFrom<GlobalPoint>(x, bottom),
        ),
      ).toBeGreaterThanOrEqual(2 - 0.01);
    }
  });

  it.each([
    [120, 80],
    [200, 50],
    [50, 200],
    [24, 18],
  ])("fits star text into its central body at %sx%s", (width, height) => {
    const element = newElement({
      type: "star",
      x: 0,
      y: 0,
      width,
      height,
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const bounds = getCompositeShapeTextBounds(element);
    const elementsMap = arrayToMap([element]);

    expect(bounds.y + bounds.height).toBeGreaterThan(height * 0.68);
    expect(bounds.width * bounds.height).toBeGreaterThan(
      (width * 0.38 - 4) * (height * 0.34 - 4),
    );
    for (let i = 0; i <= 10; i++) {
      const x = bounds.x + (bounds.width * i) / 10;
      const y = bounds.y + (bounds.height * i) / 10;
      for (const [sampleX, sampleY] of [
        [x, bounds.y],
        [x, bounds.y + bounds.height],
        [bounds.x, y],
        [bounds.x + bounds.width, y],
      ]) {
        const point = pointFrom<GlobalPoint>(sampleX, sampleY);
        expect(isPointInElement(point, element, elementsMap)).toBe(true);
        expect(
          distanceToElement(element, elementsMap, point),
        ).toBeGreaterThanOrEqual(1.99);
      }
    }
  });

  it.each([
    [120, 80],
    [200, 50],
    [50, 200],
  ])("maximizes trapezoid text area at %sx%s", (width, height) => {
    for (const ratio of [2 / 3, 0.05, 1]) {
      for (const narrowEdge of ["top", "bottom"] as const) {
        const element = newElement({
          type: "composite_shape",
          shape: {
            id: "trapezoid",
            schemaVersion: 1,
            trapezoid: { narrowWidthRatio: ratio, narrowEdge },
          },
          x: 0,
          y: 0,
          width,
          height,
          roughness: 0,
        });
        if (element.type !== "composite_shape") {
          throw new Error("Expected composite shape");
        }
        const bounds = getCompositeShapeTextBounds(element);
        const elementsMap = arrayToMap([element]);
        const halfInset = (width * (1 - ratio)) / 2;
        const sideGap = 2 * Math.hypot(1, halfInset / height);

        if (ratio >= 2 / 3) {
          expect(bounds.height).toBeCloseTo(height - 4);
        }
        for (const x of [bounds.x, bounds.x + bounds.width]) {
          for (const y of [bounds.y, bounds.y + bounds.height]) {
            const point = pointFrom<GlobalPoint>(x, y);
            expect(isPointInElement(point, element, elementsMap)).toBe(true);
            expect(
              distanceToElement(element, elementsMap, point),
            ).toBeGreaterThanOrEqual(1.99);
          }
        }
        for (let i = 0; i <= 10; i++) {
          const inset = 2 + ((height - 4) * i) / 10;
          const candidateWidth =
            width - 2 * (halfInset * (1 - inset / height) + sideGap);
          const candidateArea =
            Math.max(0, candidateWidth) * (height - inset - 2);
          expect(bounds.width * bounds.height).toBeGreaterThanOrEqual(
            candidateArea - 0.01,
          );
        }
      }
    }
  });

  it.each(["triangle", "trapezoid", "cube"] as const)(
    "redraws %s after a control point changes",
    (type) => {
      const element = newElement({
        type,
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        roughness: 0,
      });
      if (element.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const before = ShapeCache.generateElementShape(element, null);
      const control = getCompositeShapeControlPoints(element)[0];
      const updatedShape = updateCompositeShapeControlPoint(
        element.shape,
        control.kind,
        control.x + 20,
        control.y + 12,
        element.width,
        element.height,
      );

      mutateElement(element, arrayToMap([element]), { shape: updatedShape });

      expect(ShapeCache.get(element, null)).toBeUndefined();
      expect(ShapeCache.generateElementShape(element, null)).not.toEqual(
        before,
      );
    },
  );

  it.each(["round-rect", "pill", "rectangle-bubble"] as const)(
    "uses a closed cubic outline for %s drawing and hit testing",
    (type) => {
      const element = newElement({
        type,
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        roughness: 0,
      });
      if (element.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const outline = getCompositeShapeGeometry(element).outline;
      expect(outline.closed).toBe(true);
      expect(
        outline.commands.filter((command) => command.type === "cubic"),
      ).toHaveLength(4);
      expect(compositeShapePathToSvg(outline)).toContain(" C ");
      const drawable = ShapeCache.generateElementShape(element, null);
      if (!drawable || Array.isArray(drawable)) {
        throw new Error("Expected one drawable");
      }
      expect(drawable.shape).toBe("path");
      const elementsMap = arrayToMap([element]);
      expect(
        isPointInElement(pointFrom<GlobalPoint>(60, 40), element, elementsMap),
      ).toBe(true);
      expect(
        isPointInElement(pointFrom<GlobalPoint>(1, 1), element, elementsMap),
      ).toBe(false);
      if (type === "rectangle-bubble") {
        expect(outline.commands.some((command) => command.to[1] === 80)).toBe(
          true,
        );
      }
    },
  );

  it.each([
    "rectangle",
    "diamond",
    "ellipse",
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
  ] as const)("keeps %s text inside its body at varied sizes", (type) => {
    for (const [width, height] of [
      [120, 80],
      [200, 50],
      [50, 200],
      [24, 18],
    ]) {
      const element = newElement({
        type,
        x: 0,
        y: 0,
        width,
        height,
        backgroundColor: "#eeeeee",
      });
      if (element.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const bounds = getCompositeShapeTextBounds(element);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 0.5);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 0.5);
      if (type !== "brace" && type !== "brace-reverse") {
        const elementsMap = arrayToMap([element]);
        const paddingX = Math.min(5, bounds.width / 4);
        const paddingY = Math.min(5, bounds.height / 4);
        const left = bounds.x + paddingX;
        const top = bounds.y + paddingY;
        const right = bounds.x + bounds.width - paddingX;
        const bottom = bounds.y + bounds.height - paddingY;
        for (const [x, y] of [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ]) {
          expect(
            isPointInElement(
              pointFrom<GlobalPoint>(x, y),
              element,
              elementsMap,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it.each(["diamond", "ellipse"] as const)(
    "keeps a one-pixel %s text rectangle within its dimensions",
    (type) => {
      const bounds = getCompositeShapeTextBounds({
        width: 1,
        height: 1,
        shape: baseShapeData(type),
      });
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(1);
    },
  );

  it.each([
    { id: "triangle", schemaVersion: 1, triangle: { apexX: 0 } },
    { id: "triangle", schemaVersion: 1, triangle: { apexX: 1 } },
    {
      id: "trapezoid",
      schemaVersion: 1,
      trapezoid: { narrowWidthRatio: 0.05, narrowEdge: "top" },
    },
    {
      id: "trapezoid",
      schemaVersion: 1,
      trapezoid: { narrowWidthRatio: 0.05, narrowEdge: "bottom" },
    },
    {
      id: "cube",
      schemaVersion: 1,
      cube: { controlPoint: { x: 0.05, y: 0.95 } },
    },
  ] as const)("keeps edited $id text inside its body: %j", (shape) => {
    const element = newElement({
      type: "composite_shape",
      shape: shape as BaseShapeData,
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      backgroundColor: "#eeeeee",
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const bounds = getCompositeShapeTextBounds(element);
    const paddingX = Math.min(5, bounds.width / 4);
    const paddingY = Math.min(5, bounds.height / 4);
    const elementsMap = arrayToMap([element]);
    for (const [x, y] of [
      [bounds.x + paddingX, bounds.y + paddingY],
      [bounds.x + bounds.width - paddingX, bounds.y + paddingY],
      [bounds.x + bounds.width - paddingX, bounds.y + bounds.height - paddingY],
      [bounds.x + paddingX, bounds.y + bounds.height - paddingY],
    ]) {
      expect(
        isPointInElement(pointFrom<GlobalPoint>(x, y), element, elementsMap),
      ).toBe(true);
    }
  });
  it("clamps editable control points without creating empty mutations", () => {
    const triangle = baseShapeData("triangle");
    const trapezoid = baseShapeData("trapezoid");
    const cube = baseShapeData("cube");
    expect(
      getCompositeShapeControlPoints({
        width: 120,
        height: 80,
        shape: triangle,
      }),
    ).toEqual([{ kind: "triangle-apex", x: 60, y: 0 }]);
    expect(
      getCompositeShapeControlPoints({
        width: 120,
        height: 80,
        shape: trapezoid,
      })[0],
    ).toMatchObject({ kind: "trapezoid-width", x: 100, y: 0 });
    expect(
      getCompositeShapeControlPoints({ width: 100, height: 80, shape: cube }),
    ).toEqual([{ kind: "cube-depth", x: 82, y: 17.6 }]);

    expect(
      updateCompositeShapeControlPoint(
        triangle,
        "triangle-apex",
        60,
        0,
        120,
        80,
      ),
    ).toBe(triangle);
    expect(
      updateCompositeShapeControlPoint(
        trapezoid,
        "trapezoid-width",
        100,
        0,
        120,
        80,
      ),
    ).toBe(trapezoid);
    expect(
      updateCompositeShapeControlPoint(cube, "cube-depth", 82, 17.6, 100, 80),
    ).toBe(cube);
    expect(
      updateCompositeShapeControlPoint(
        triangle,
        "triangle-apex",
        -10,
        0,
        120,
        80,
      ),
    ).toMatchObject({ triangle: { apexX: 0 } });
    expect(
      updateCompositeShapeControlPoint(
        trapezoid,
        "trapezoid-width",
        0,
        0,
        120,
        80,
      ),
    ).toMatchObject({
      trapezoid: { narrowWidthRatio: 0.05, narrowEdge: "top" },
    });
    expect(
      updateCompositeShapeControlPoint(cube, "cube-depth", 100, -20, 100, 80),
    ).toMatchObject({ cube: { controlPoint: { x: 0.95, y: 0.05 } } });
    expect(() =>
      updateCompositeShapeControlPoint(cube, "triangle-apex", 50, 0, 100, 80),
    ).toThrow("does not belong");
    expect(() =>
      updateCompositeShapeControlPoint(cube, "cube-depth", NaN, 0, 100, 80),
    ).toThrow("Invalid composite shape control coordinates");
  });

  it.each([0, 1, -0.1, 1.1, NaN, Infinity])(
    "rejects a degenerate cube control coordinate %s",
    (value) => {
      expect(() =>
        assertBaseShapeData({
          id: "cube",
          schemaVersion: 1,
          cube: { controlPoint: { x: value, y: 0.22 } },
        }),
      ).toThrow("Unsupported composite shape data");
      expect(() =>
        assertBaseShapeData({
          id: "cube",
          schemaVersion: 1,
          cube: { controlPoint: { x: 0.82, y: value } },
        }),
      ).toThrow("Unsupported composite shape data");
    },
  );

  it.each(["rectangle", "diamond", "ellipse"] as const)(
    "creates a %s with the canonical element type",
    (type) => {
      const element = newElement({ type, x: 12, y: 34 });
      expect(element.type).toBe("composite_shape");
      expect(isCompositeShapeId(element, type)).toBe(true);
      expect(element).toMatchObject({
        shape: { id: type, schemaVersion: 1 },
      });
    },
  );

  it.each([
    "rectangle",
    "diamond",
    "ellipse",
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
  ] as const)("accepts canonical persisted data for %s", (id) => {
    expect(assertBaseShapeData(baseShapeData(id))).toEqual(baseShapeData(id));
  });

  it.each([
    "rectangle",
    "diamond",
    "ellipse",
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
  ] as const)("rejects invalid schema data for %s", (id) => {
    expect(() => assertBaseShapeData({ id, schemaVersion: 2 })).toThrow(
      "Unsupported composite shape data",
    );
    expect(() =>
      assertBaseShapeData({ ...baseShapeData(id), unexpected: true }),
    ).toThrow("Unsupported composite shape data");
    if (id === "triangle" || id === "trapezoid" || id === "cube") {
      expect(() => assertBaseShapeData({ id, schemaVersion: 1 })).toThrow(
        "Unsupported composite shape data",
      );
    }
  });

  it.each([
    { id: "triangle", value: -0.01 },
    { id: "triangle", value: 1.01 },
    { id: "trapezoid", value: 0.049 },
    { id: "trapezoid", value: 1.01 },
    { id: "cube", value: 0.049 },
    { id: "cube", value: 0.951 },
  ] as const)("rejects out-of-range %s parameter %s", ({ id, value }) => {
    const shape =
      id === "triangle"
        ? { id, schemaVersion: 1, triangle: { apexX: value } }
        : id === "trapezoid"
        ? {
            id,
            schemaVersion: 1,
            trapezoid: { narrowWidthRatio: value, narrowEdge: "top" },
          }
        : {
            id,
            schemaVersion: 1,
            cube: { controlPoint: { x: value, y: 0.5 } },
          };
    expect(() => assertBaseShapeData(shape)).toThrow(
      "Unsupported composite shape data",
    );
  });

  it("rejects invalid trapezoid direction and non-finite triangle data", () => {
    expect(() =>
      assertBaseShapeData({
        id: "trapezoid",
        schemaVersion: 1,
        trapezoid: { narrowWidthRatio: 0.5, narrowEdge: "sideways" },
      }),
    ).toThrow("Unsupported composite shape data");
    for (const apexX of [NaN, Infinity, -Infinity]) {
      expect(() =>
        assertBaseShapeData({
          id: "triangle",
          schemaVersion: 1,
          triangle: { apexX },
        }),
      ).toThrow("Unsupported composite shape data");
    }
  });

  it("identifies composite shapes and supports matching multiple ids", () => {
    const rectangle = newElement({ type: "rectangle", x: 0, y: 0 });
    const selection = newElement({ type: "selection", x: 0, y: 0 });

    expect(isCompositeShapeElement(rectangle)).toBe(true);
    expect(isCompositeShapeIdIn(rectangle, ["rectangle", "diamond"])).toBe(
      true,
    );
    expect(isCompositeShapeIdIn(rectangle, ["diamond", "ellipse"])).toBe(false);
    expect(isCompositeShapeElement(selection)).toBe(false);
    expect(isCompositeShapeIdIn(selection, ["rectangle", "diamond"])).toBe(
      false,
    );
  });

  it.each([
    { id: "unknown", schemaVersion: 1 },
    { id: "rectangle" },
    { id: "diamond", schemaVersion: 2 },
    { id: "ellipse", schemaVersion: 1, ellipse: {} },
  ])("rejects unsupported shape data: %j", (shape) => {
    expect(() => assertBaseShapeData(shape)).toThrow(
      "Unsupported composite shape data",
    );
  });

  it("does not render an unsupported shape as a rectangle", () => {
    const element = newElement({ type: "rectangle", x: 0, y: 0 });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }

    expect(() =>
      ShapeCache.generateElementShape(
        {
          ...element,
          shape: {
            id: "unknown",
            schemaVersion: 1,
          } as unknown as BaseShapeData,
        },
        null,
      ),
    ).toThrow("Unimplemented shape unknown");
  });

  it("rejects unsupported shapes in geometry and distance calculations", () => {
    const element = newElement({ type: "rectangle", x: 0, y: 0 });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const invalid = {
      ...element,
      shape: { id: "unknown", schemaVersion: 1 } as unknown as BaseShapeData,
    };

    expect(() => baseShapeData("unknown" as BaseShapeId)).toThrow(
      "Unsupported composite shape",
    );
    expect(() => isCompositeShapeOpen("unknown" as BaseShapeId)).toThrow(
      "Unsupported composite shape",
    );
    expect(() => getCompositeShapePoints(invalid)).toThrow(
      "Unsupported composite shape",
    );
    expect(() =>
      distanceToElement(invalid, arrayToMap([invalid]), pointFrom(0, 0)),
    ).toThrow("Unsupported composite shape");
  });

  it("recognizes text without requiring shape data", () => {
    expect(isExcalidrawElement({ type: "text" })).toBe(true);
  });

  it("rejects invalid shape versions during skeleton conversion", () => {
    expect(() =>
      convertToExcalidrawElements([
        {
          type: "composite_shape",
          shape: {
            id: "diamond",
            schemaVersion: 2,
          } as unknown as BaseShapeData,
          x: 0,
          y: 0,
        },
      ]),
    ).toThrow("Unsupported composite shape data");
  });

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
  ] as const)("binds labels for the %s shape shorthand", (type) => {
    const elements = convertToExcalidrawElements([
      {
        type,
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        label: { text: "label" },
      },
    ]);
    const container = elements.find(
      (element) =>
        element.type === "composite_shape" && element.shape.id === type,
    );
    const textId = container?.boundElements?.find(
      (boundElement) => boundElement.type === "text",
    )?.id;
    const text = elements.find((element) => element.id === textId);

    expect(container).toBeDefined();
    expect(text).toBeDefined();
    expect(text).toMatchObject({
      type: "text",
      containerId: container?.id,
      originalText: "label",
    });
    expect(container?.boundElements).toEqual(
      expect.arrayContaining([{ type: "text", id: text?.id }]),
    );
  });

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
  ] as const)("binds arrow endpoints for the %s shape shorthand", (type) => {
    const elements = convertToExcalidrawElements([
      {
        type: "arrow",
        x: 100,
        y: 100,
        width: 160,
        height: 0,
        start: { type, width: 40, height: 40 },
        end: { type, width: 40, height: 40 },
      },
    ]);
    const arrow = elements.find((element) => element.type === "arrow");
    const endpoints = elements.filter(
      (element) =>
        element.type === "composite_shape" && element.shape.id === type,
    );

    if (!arrow || arrow.type !== "arrow") {
      throw new Error("Expected arrow");
    }
    expect(endpoints).toHaveLength(2);
    expect(arrow.startBinding).not.toBeNull();
    expect(arrow.endBinding).not.toBeNull();
    expect(
      new Set([arrow.startBinding?.elementId, arrow.endBinding?.elementId]),
    ).toEqual(new Set(endpoints.map((endpoint) => endpoint.id)));
  });

  it("preserves shape data when copying an element", () => {
    const element = newElement({ type: "diamond", x: 12, y: 34 });
    const copy = deepCopyElement(element);

    if (element.type !== "composite_shape" || copy.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }

    expect(copy.shape).toEqual(element.shape);
    expect(copy.shape).not.toBe(element.shape);
  });

  it("draws the hexagon with flat top and bottom edges", () => {
    const element = newElement({
      type: "hexagon",
      x: 0,
      y: 0,
      width: 120,
      height: 80,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }

    const points = getCompositeShapePoints(element);
    expect(points[1][1]).toBeCloseTo(points[2][1]);
    expect(points[4][1]).toBeCloseTo(points[5][1]);
    expect(points[1][1]).toBeGreaterThan(points[4][1]);
    expect(points[0][0]).toBeCloseTo(element.width);
    expect(points[3][0]).toBeCloseTo(0);
  });

  it("draws the rectangle bubble with rounded corners and a right-side tail", () => {
    const element = newElement({
      type: "rectangle-bubble",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }

    const outline = getCompositeShapeGeometry(element).outline;
    const bodyHeight = element.height * 0.84;
    expect(outline.commands.slice(4, 7).map((command) => command.to)).toEqual([
      [84, bodyHeight],
      [76, 80],
      [66, bodyHeight],
    ]);
    const elementsMap = arrayToMap([element]);
    for (const corner of [
      [0, 0],
      [100, 0],
      [100, bodyHeight],
      [0, bodyHeight],
    ] as const) {
      expect(
        distanceToElement(
          element,
          elementsMap,
          pointFrom<GlobalPoint>(corner[0], corner[1]),
        ),
      ).toBeGreaterThan(0);
    }
    expect(
      isPointInElement(pointFrom<GlobalPoint>(76, 75), element, elementsMap),
    ).toBe(true);
    expect(
      isPointInElement(pointFrom<GlobalPoint>(50, 75), element, elementsMap),
    ).toBe(false);
  });

  it("draws the bubble from the PDF vector with a left-side tail", () => {
    const element = newElement({
      type: "bubble",
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }

    const outline = getCompositeShapeGeometry(element).outline;
    expect(outline.start).toEqual([6, 78]);
    expect(outline.commands[0]).toEqual({
      type: "line",
      to: [11.7986107, 63.819939],
    });
    expect(outline.commands.at(-1)).toEqual({
      type: "line",
      to: [6, 78],
    });
    expect(outline.closed).toBe(true);

    const points = getCompositeShapePoints(element);
    expect(points[0]).toEqual([6, 78]);
    expect(points.some(([x, y]) => x < 10 && y > 70)).toBe(true);
    expect(points.some(([x]) => x > 115)).toBe(true);
  });

  it("draws three independent cube faces before its visible edges", () => {
    const element = newElement({
      type: "composite_shape",
      shape: {
        id: "cube",
        schemaVersion: 1,
        cube: { controlPoint: { x: 0.8, y: 0.2 } },
      },
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      backgroundColor: "#eae2fe",
      fillStyle: "solid",
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const geometry = getCompositeShapeGeometry(element);
    expect(getCompositeShapePoints(element)).toEqual([
      [0, 16],
      [20, 0],
      [100, 0],
      [100, 64],
      [80, 80],
      [0, 80],
    ]);
    expect(
      geometry.details.map((path) => [
        path.start,
        ...path.commands.map((command) => command.to),
      ]),
    ).toEqual([
      [
        [0, 16],
        [80, 16],
        [100, 0],
      ],
      [
        [80, 16],
        [80, 80],
      ],
    ]);
    expect(geometry.fillFaces?.map(({ tone }) => tone)).toEqual([
      "dark",
      "light",
      "base",
    ]);
    const drawables = ShapeCache.generateElementShape(element, null);
    if (!Array.isArray(drawables)) {
      throw new Error("Expected layered drawables");
    }
    expect(drawables).toHaveLength(4);
    expect(
      drawables.slice(0, 3).map((drawable) => drawable.options.fill),
    ).toHaveLength(3);
    expect(
      new Set(drawables.slice(0, 3).map((drawable) => drawable.options.fill))
        .size,
    ).toBe(3);
    expect(
      drawables
        .slice(0, 3)
        .every((drawable) =>
          drawable.sets.some((set) => set.type === "fillPath"),
        ),
    ).toBe(true);
    expect(
      drawables[3].sets.filter((set) => set.type === "fillPath"),
    ).toHaveLength(0);
    expect(drawables[3].sets.filter((set) => set.type === "path")).toHaveLength(
      3,
    );
  });

  it("matches the cylinder's PDF outline and separate front edge", () => {
    const element = newElement({
      type: "cylinder",
      x: 0,
      y: 0,
      width: 80,
      height: 67.22422,
      backgroundColor: "#dff5e5",
      fillStyle: "solid",
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }

    const { outline, details, fillFaces } = getCompositeShapeGeometry(element);
    expect(outline.start).toEqual([0, 16]);
    expect(outline.closed).toBe(true);
    expect(outline.commands.map((command) => command.to)).toEqual([
      [40, 0],
      [80, 16],
      [80, 51.22422],
      [40, 67.22422],
      [0, 51.22422],
    ]);
    expect(outline.commands[0]).toMatchObject({
      type: "cubic",
      control2: [17.908608, 0],
    });
    expect(details).toHaveLength(1);
    expect(details[0].start).toEqual([79, 15.5]);
    expect(details[0].closed).toBe(false);
    expect(details[0].commands.map((command) => command.to)).toEqual([
      [40, 31],
      [1, 15.5],
    ]);
    expect(compositeShapePathToSvg(details[0])).not.toContain(" Z");
    expect(fillFaces?.map(({ tone }) => tone)).toEqual(["base", "light"]);
    expect(fillFaces?.every(({ path }) => path.closed)).toBe(true);

    const drawables = ShapeCache.generateElementShape(element, null);
    if (!Array.isArray(drawables)) {
      throw new Error("Expected layered drawables");
    }
    expect(drawables).toHaveLength(3);
    expect(drawables[0].options.fill).toBe("#dff5e5");
    expect(drawables[1].options.fill).not.toBe(drawables[0].options.fill);
    expect(
      drawables[2].sets.filter((set) => set.type === "fillPath"),
    ).toHaveLength(0);
    expect(drawables[2].sets.filter((set) => set.type === "path")).toHaveLength(
      2,
    );
  });

  it("keeps transparent multi-face shapes unfilled", () => {
    for (const type of ["cube", "cylinder"] as const) {
      const element = newElement({
        type,
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        backgroundColor: "transparent",
      });
      if (element.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const drawables = ShapeCache.generateElementShape(element, null);
      expect(Array.isArray(drawables) && drawables).toHaveLength(1);
      if (Array.isArray(drawables)) {
        expect(drawables[0].sets.some((set) => set.type === "fillPath")).toBe(
          false,
        );
      }
    }
  });

  it("preserves the alpha channel across independently shaded faces", () => {
    const element = newElement({
      type: "cube",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      backgroundColor: "#eae2fe80",
      fillStyle: "solid",
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const drawables = ShapeCache.generateElementShape(element, null);
    if (!Array.isArray(drawables)) {
      throw new Error("Expected layered drawables");
    }
    expect(drawables.slice(0, 3).map(({ options }) => options.fill)).toEqual([
      "#c0b9d080",
      "#eee8fe80",
      "#eae2fe80",
    ]);
  });

  it("draws the cloud with curved lobes matching its hit outline", () => {
    const element = newElement({
      type: "cloud",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const outline = getCompositeShapeGeometry(element).outline;
    expect(outline.closed).toBe(true);
    expect(outline.commands.every((command) => command.type === "cubic")).toBe(
      true,
    );
    expect(compositeShapePathToSvg(outline)).toContain(" C ");

    const drawable = ShapeCache.generateElementShape(element, null);
    if (!drawable || Array.isArray(drawable)) {
      throw new Error("Expected one drawable");
    }
    expect(drawable.shape).toBe("path");

    const firstCurve = outline.commands[0];
    if (firstCurve.type !== "cubic") {
      throw new Error("Expected curved cloud edge");
    }
    const midpoint = bezierEquation(
      curve(
        pointFrom<GlobalPoint>(...outline.start),
        pointFrom<GlobalPoint>(...firstCurve.control1),
        pointFrom<GlobalPoint>(...firstCurve.control2),
        pointFrom<GlobalPoint>(...firstCurve.to),
      ),
      0.5,
    );
    expect(
      distanceToElement(element, arrayToMap([element]), midpoint),
    ).toBeLessThan(0.1);
  });

  it("draws braces as smooth mirrored open curves", () => {
    const brace = newElement({
      type: "brace",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const reverseBrace = newElement({
      type: "brace-reverse",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    if (
      brace.type !== "composite_shape" ||
      reverseBrace.type !== "composite_shape"
    ) {
      throw new Error("Expected composite shape");
    }

    const braceOutline = getCompositeShapeGeometry(brace).outline;
    const reverseOutline = getCompositeShapeGeometry(reverseBrace).outline;
    expect(braceOutline.closed).toBe(false);
    expect(reverseOutline.closed).toBe(false);
    expect(braceOutline.commands).toHaveLength(8);
    expect(reverseOutline.commands).toHaveLength(8);
    expect(
      braceOutline.commands.filter(({ type }) => type === "cubic"),
    ).toHaveLength(4);
    expect(
      reverseOutline.commands.filter(({ type }) => type === "cubic"),
    ).toHaveLength(4);
    expect(braceOutline.start[0]).toBeCloseTo(0);
    expect(braceOutline.commands[3].to[0]).toBeCloseTo(13.81);
    expect(reverseOutline.start[0]).toBeCloseTo(100);
    expect(reverseOutline.commands[3].to[0]).toBeCloseTo(86.19);

    const wideBrace = newElement({
      type: "brace",
      x: 0,
      y: 0,
      width: 300,
      height: 100,
    });
    const wideReverseBrace = newElement({
      type: "brace-reverse",
      x: 0,
      y: 0,
      width: 300,
      height: 100,
    });
    if (
      wideBrace.type !== "composite_shape" ||
      wideReverseBrace.type !== "composite_shape"
    ) {
      throw new Error("Expected composite shape");
    }
    expect(getCompositeShapeGeometry(wideBrace).outline.start[0]).toBeCloseTo(
      0,
    );
    expect(
      getCompositeShapeGeometry(wideReverseBrace).outline.start[0],
    ).toBeCloseTo(300);
    expect(
      getCompositeShapeGeometry(wideReverseBrace).outline.commands[3].to[0],
    ).toBeCloseTo(281.127);
  });

  it.each([
    ["rectangle", "rectangle", "polygon", [0, 100], 0],
    ["diamond", "polygon", "polygon", [31, 70.22], 30],
    ["ellipse", "ellipse", "ellipse", [10, 90], 15],
  ] as const)(
    "uses %s geometry for drawing and hit testing",
    (id, roughType, geometricType, expectedXs, minimumCornerDistance) => {
      const element = newElement({
        type: id,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        roundness: null,
      });
      if (element.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const elementsMap = arrayToMap([element]);
      const corner = pointFrom<GlobalPoint>(0, 0);
      const crossing = lineSegment(
        pointFrom<GlobalPoint>(-50, 20),
        pointFrom<GlobalPoint>(150, 20),
      );

      const drawable = ShapeCache.generateElementShape(element, null);
      if (!drawable || Array.isArray(drawable)) {
        throw new Error("Expected one drawable");
      }
      expect(drawable.shape).toBe(roughType);
      expect(getElementShape(element, elementsMap).type).toBe(geometricType);
      const cornerDistance = distanceToElement(element, elementsMap, corner);
      if (id === "rectangle") {
        expect(cornerDistance).toBeCloseTo(0, 2);
      } else {
        expect(cornerDistance).toBeGreaterThan(minimumCornerDistance);
      }
      expect(
        isPointInElement(pointFrom<GlobalPoint>(5, 5), element, elementsMap),
      ).toBe(id === "rectangle");
      expect(
        getElementLineSegments(element, elementsMap).length,
      ).toBeGreaterThan(0);
      const intersections = intersectElementWithLineSegment(
        element,
        elementsMap,
        crossing,
      )
        .map(([x]) => x)
        .sort((a, b) => a - b);
      expect(intersections).toHaveLength(expectedXs.length);
      intersections.forEach((x, index) =>
        expect(x).toBeCloseTo(expectedXs[index], 2),
      );
    },
  );

  it.each(["rectangle", "diamond", "ellipse"] as const)(
    "shares the rotated %s outline across drawing, bounds, and binding anchors",
    (type) => {
      const element = newElement({
        type,
        x: 20,
        y: 30,
        width: 120,
        height: 80,
        angle: (Math.PI / 6) as Radians,
        roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
      });
      if (element.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const geometry = getCompositeShapeGeometry(element);
      const drawable = ShapeCache.generateElementShape(element, null);
      if (!drawable || Array.isArray(drawable)) {
        throw new Error("Expected one drawable");
      }
      expect(drawable.shape).toBe(type === "ellipse" ? "ellipse" : "path");
      expect(geometry.outline.closed).toBe(true);

      const points = getCompositeShapeGlobalPoints(element);
      const [x1, y1, x2, y2] = getElementBounds(element, arrayToMap([element]));
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(x1 - 0.001);
        expect(x).toBeLessThanOrEqual(x2 + 0.001);
        expect(y).toBeGreaterThanOrEqual(y1 - 0.001);
        expect(y).toBeLessThanOrEqual(y2 + 0.001);
      }
      const anchors = getCompositeShapeAnchors(element);
      expect(anchors).toHaveLength(4);
      for (const anchor of anchors) {
        expect(
          distanceToElement(element, arrayToMap([element]), anchor),
        ).toBeLessThan(0.1);
      }
    },
  );

  it("uses the Cross geometry outline for its global interaction path", () => {
    const element = newElement({
      type: "cross",
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      angle: 0 as Radians,
      roughness: 0,
    });
    if (element.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }

    expect(getCompositeShapeGlobalPath(element)).toEqual(
      getCompositeShapeGeometry(element).outline,
    );
  });

  it("does not treat an open brace as a contained filled shape", () => {
    const outer = newElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    const brace = newElement({
      type: "brace",
      x: 20,
      y: 20,
      width: 100,
      height: 100,
    });
    if (outer.type !== "composite_shape" || brace.type !== "composite_shape") {
      throw new Error("Expected composite shape elements");
    }

    expect(
      isBindableElementInsideOtherBindable(
        brace,
        outer,
        arrayToMap([outer, brace]),
      ),
    ).toBe(false);
  });
});
