import { arrayToMap } from "@excalidraw/common";
import { lineSegment, pointFrom, type GlobalPoint } from "@excalidraw/math";

import { getElementLineSegments } from "../src/bounds";
import {
  isPointInElement,
  intersectElementWithLineSegment,
} from "../src/collision";
import {
  assertBaseShapeData,
  getElementShapeType,
} from "../src/compositeShape";
import { distanceToElement } from "../src/distance";
import { deepCopyElement } from "../src/duplicate";
import { newElement } from "../src/newElement";
import { getElementShape, ShapeCache } from "../src/shape";
import { isExcalidrawElement } from "../src/typeChecks";
import { convertToExcalidrawElements } from "../src/transform";

import type { BaseShapeData } from "../src/types";

describe("composite shape data", () => {
  it.each(["rectangle", "diamond", "ellipse"] as const)(
    "creates a %s with the canonical element type",
    (type) => {
      const element = newElement({ type, x: 12, y: 34 });
      expect(element.type).toBe("composite_shape");
      expect(getElementShapeType(element)).toBe(type);
      expect(element).toMatchObject({
        shape: { id: type, schemaVersion: 1 },
      });
    },
  );

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
          shape: { id: "unknown", schemaVersion: 1 } as unknown as BaseShapeData,
        },
        null,
      ),
    ).toThrow("Unimplemented shape unknown");
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

  it("preserves shape data when copying an element", () => {
    const element = newElement({ type: "diamond", x: 12, y: 34 });
    const copy = deepCopyElement(element);

    if (element.type !== "composite_shape" || copy.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }

    expect(copy.shape).toEqual(element.shape);
    expect(copy.shape).not.toBe(element.shape);
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
});
