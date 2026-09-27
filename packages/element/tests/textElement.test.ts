import { getLineHeight } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { pointRotateRads, pointFrom, type Radians } from "@excalidraw/math";

import { FONT_FAMILY, TEXT_ALIGN, VERTICAL_ALIGN } from "@excalidraw/common";

import {
  computeContainerDimensionForBoundText,
  getContainerCoords,
  getContainerCenter,
  getBoundTextMaxWidth,
  getBoundTextMaxHeight,
  computeBoundTextPosition,
  truncateTextToBounds,
} from "../src/textElement";
import { getCompositeShapeTextBounds } from "../src/compositeShape";
import { newElement } from "../src/newElement";
import { detectLineHeight, getLineHeightInPx } from "../src/textMeasurements";

import type { ExcalidrawTextElementWithContainer } from "../src/types";

describe("Test measureText", () => {
  it("truncates fixed-size labels without discarding the source text", () => {
    const font = "20px Virgil" as ReturnType<
      typeof import("@excalidraw/common").getFontString
    >;
    const rendered = truncateTextToBounds(
      "first line\nsecond line\nthird line",
      font,
      1.25 as ExcalidrawTextElementWithContainer["lineHeight"],
      200,
      50,
    );
    expect(rendered).toBe("first line\nsecond line…");
  });

  it("keeps one rendered line when the fixed text area is shorter than a line", () => {
    const font = "20px Virgil" as ReturnType<
      typeof import("@excalidraw/common").getFontString
    >;
    const rendered = truncateTextToBounds(
      "first line\nsecond line",
      font,
      1.25 as ExcalidrawTextElementWithContainer["lineHeight"],
      200,
      1,
    );

    expect(rendered).toBe("first line…");
    expect(rendered).not.toBe("");
  });

  it.each([
    "triangle",
    "trapezoid",
    "cube",
    "cylinder",
    "bubble",
    "rectangle-bubble",
    "brace",
    "brace-reverse",
  ] as const)("uses one padded text rectangle for %s", (type) => {
    for (const [width, height] of [
      [120, 80],
      [24, 18],
    ]) {
      const container = newElement({
        type,
        x: 10,
        y: 20,
        width,
        height,
      });
      if (container.type !== "composite_shape") {
        throw new Error("Expected composite shape");
      }
      const bounds = getCompositeShapeTextBounds(container);
      const coords = getContainerCoords(container);
      const text = API.createElement({
        type: "text",
        containerId: container.id,
      }) as ExcalidrawTextElementWithContainer;
      const textWidth = getBoundTextMaxWidth(container, text);
      const textHeight = getBoundTextMaxHeight(container, text);
      expect(textWidth).toBeGreaterThan(0);
      expect(textHeight).toBeGreaterThan(0);
      expect(coords.x - (container.x + bounds.x)).toBeCloseTo(
        container.x + bounds.x + bounds.width - (coords.x + textWidth),
      );
      expect(coords.y - (container.y + bounds.y)).toBeCloseTo(
        container.y + bounds.y + bounds.height - (coords.y + textHeight),
      );
    }
  });

  it("rotates a cube label around the element with its front face", () => {
    const container = newElement({
      type: "cube",
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      angle: (Math.PI / 2) as Radians,
    });
    if (container.type !== "composite_shape") {
      throw new Error("Expected composite shape");
    }
    const text = API.createElement({
      type: "text",
      containerId: container.id,
      width: 20,
      height: 10,
      textAlign: TEXT_ALIGN.CENTER,
      verticalAlign: VERTICAL_ALIGN.MIDDLE,
    }) as ExcalidrawTextElementWithContainer;
    const center = pointFrom(
      container.x + container.width / 2,
      container.y + container.height / 2,
    );
    const bounds = getCompositeShapeTextBounds(container);
    const expected = pointRotateRads(
      pointFrom(
        container.x + bounds.x + bounds.width / 2,
        container.y + bounds.y + bounds.height / 2,
      ),
      center,
      container.angle,
    );
    expect(getContainerCenter(container, new Map())).toEqual({
      x: expected[0],
      y: expected[1],
    });
    const position = computeBoundTextPosition(container, text, new Map());
    expect(position.x + text.width / 2).toBeCloseTo(expected[0]);
    expect(position.y + text.height / 2).toBeCloseTo(expected[1]);
  });

  describe("Test getContainerCoords", () => {
    const params = { width: 200, height: 100, x: 10, y: 20 };

    it("should compute coords correctly when ellipse", () => {
      const element = API.createElement({
        type: "ellipse",
        ...params,
      });
      expect(getContainerCoords(element)).toEqual({
        x: 40.70353544371835,
        y: 36.05887450304572,
      });
    });

    it("should compute coords correctly when rectangle", () => {
      const element = API.createElement({
        type: "rectangle",
        ...params,
      });
      expect(getContainerCoords(element)).toEqual({
        x: 12,
        y: 22,
      });
    });

    it("should compute coords correctly when diamond", () => {
      const element = API.createElement({
        type: "diamond",
        ...params,
      });
      expect(getContainerCoords(element)).toEqual({
        x: 62.236067977499786,
        y: 46.11803398874989,
      });
    });
  });

  describe("Test computeContainerDimensionForBoundText", () => {
    it("should compute container height correctly for rectangle", () => {
      expect(computeContainerDimensionForBoundText(150, "rectangle")).toEqual(
        160,
      );
    });

    it("should compute container height correctly for ellipse", () => {
      expect(computeContainerDimensionForBoundText(150, "ellipse")).toEqual(
        226,
      );
    });

    it("should compute container height correctly for diamond", () => {
      expect(computeContainerDimensionForBoundText(150, "diamond")).toEqual(
        320,
      );
    });
  });

  describe("Test getBoundTextMaxWidth", () => {
    const params = {
      width: 178,
      height: 194,
    };

    it("should return max width when container is rectangle", () => {
      const container = API.createElement({ type: "rectangle", ...params });
      expect(getBoundTextMaxWidth(container, null)).toBe(174);
    });

    it("should return max width when container is ellipse", () => {
      const container = API.createElement({ type: "ellipse", ...params });
      expect(getBoundTextMaxWidth(container, null)).toBe(123.03657992645924);
    });

    it("should return max width when container is diamond", () => {
      const container = API.createElement({ type: "diamond", ...params });
      expect(getBoundTextMaxWidth(container, null)).toBe(86.28570189958532);
    });
  });

  describe("Test getBoundTextMaxHeight", () => {
    const params = {
      width: 178,
      height: 194,
      id: '"container-id',
    };

    const boundTextElement = API.createElement({
      type: "text",
      id: "text-id",
      x: 560.51171875,
      y: 202.033203125,
      width: 154,
      height: 175,
      fontSize: 20,
      fontFamily: 1,
      text: "Excalidraw is a\nvirtual \nopensource \nwhiteboard for \nsketching \nhand-drawn like\ndiagrams",
      textAlign: "center",
      verticalAlign: "middle",
      containerId: params.id,
    }) as ExcalidrawTextElementWithContainer;

    it("should return max height when container is rectangle", () => {
      const container = API.createElement({ type: "rectangle", ...params });
      expect(getBoundTextMaxHeight(container, boundTextElement)).toBe(190);
    });

    it("should return max height when container is ellipse", () => {
      const container = API.createElement({ type: "ellipse", ...params });
      expect(getBoundTextMaxHeight(container, boundTextElement)).toBe(134.35028842544403);
    });

    it("should return max height when container is diamond", () => {
      const container = API.createElement({ type: "diamond", ...params });
      expect(getBoundTextMaxHeight(container, boundTextElement)).toBe(94.04172004786263);
    });

    it("should return max height when container is arrow", () => {
      const container = API.createElement({
        type: "arrow",
        ...params,
      });
      expect(getBoundTextMaxHeight(container, boundTextElement)).toBe(194);
    });

    it("should return max height when container is arrow and height is less than threshold", () => {
      const container = API.createElement({
        type: "arrow",
        ...params,
        height: 70,
        boundElements: [{ type: "text", id: "text-id" }],
      });

      expect(getBoundTextMaxHeight(container, boundTextElement)).toBe(
        boundTextElement.height,
      );
    });
  });
});

const textElement = API.createElement({
  type: "text",
  text: "Excalidraw is a\nvirtual \nopensource \nwhiteboard for \nsketching \nhand-drawn like\ndiagrams",
  fontSize: 20,
  fontFamily: 1,
  height: 175,
});

describe("Test detectLineHeight", () => {
  it("should return correct line height", () => {
    expect(detectLineHeight(textElement)).toBe(1.25);
  });
});

describe("Test getLineHeightInPx", () => {
  it("should return correct line height", () => {
    expect(
      getLineHeightInPx(textElement.fontSize, textElement.lineHeight),
    ).toBe(25);
  });
});

describe("Test getDefaultLineHeight", () => {
  it("should return line height using default font family when not passed", () => {
    //@ts-ignore
    expect(getLineHeight()).toBe(1.25);
  });

  it("should return line height using default font family for unknown font", () => {
    const UNKNOWN_FONT = 5;
    expect(getLineHeight(UNKNOWN_FONT)).toBe(1.25);
  });

  it("should return correct line height", () => {
    expect(getLineHeight(FONT_FAMILY.Cascadia)).toBe(1.2);
  });
});

describe("Test computeBoundTextPosition", () => {
  const createMockElementsMap = () => new Map();

  // Helper function to create rectangle test case with 90-degree rotation
  const createRotatedRectangleTestCase = (
    textAlign: string,
    verticalAlign: string,
  ) => {
    const container = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      angle: (Math.PI / 2) as any, // 90 degrees
    });

    const boundTextElement = API.createElement({
      type: "text",
      width: 80,
      height: 40,
      text: "hello darkness my old friend",
      textAlign: textAlign as any,
      verticalAlign: verticalAlign as any,
      containerId: container.id,
    }) as ExcalidrawTextElementWithContainer;

    const elementsMap = createMockElementsMap();

    return { container, boundTextElement, elementsMap };
  };

  describe("90-degree rotation with all alignment combinations", () => {
    // Test all 9 combinations of horizontal (left, center, right) and vertical (top, middle, bottom) alignment

    it("should position text with LEFT + TOP alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(TEXT_ALIGN.LEFT, VERTICAL_ALIGN.TOP);

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(188, 1);
      expect(result.y).toBeCloseTo(72, 1);
    });

    it("should position text with LEFT + MIDDLE alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(TEXT_ALIGN.LEFT, VERTICAL_ALIGN.MIDDLE);

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(160, 1);
      expect(result.y).toBeCloseTo(72, 1);
    });

    it("should position text with LEFT + BOTTOM alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(TEXT_ALIGN.LEFT, VERTICAL_ALIGN.BOTTOM);

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(132, 1);
      expect(result.y).toBeCloseTo(72, 1);
    });

    it("should position text with CENTER + TOP alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(TEXT_ALIGN.CENTER, VERTICAL_ALIGN.TOP);

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(188, 1);
      expect(result.y).toBeCloseTo(130, 1);
    });

    it("should position text with CENTER + MIDDLE alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(
          TEXT_ALIGN.CENTER,
          VERTICAL_ALIGN.MIDDLE,
        );

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(160, 1);
      expect(result.y).toBeCloseTo(130, 1);
    });

    it("should position text with CENTER + BOTTOM alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(
          TEXT_ALIGN.CENTER,
          VERTICAL_ALIGN.BOTTOM,
        );

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(132, 1);
      expect(result.y).toBeCloseTo(130, 1);
    });

    it("should position text with RIGHT + TOP alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(TEXT_ALIGN.RIGHT, VERTICAL_ALIGN.TOP);

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(188, 1);
      expect(result.y).toBeCloseTo(188, 1);
    });

    it("should position text with RIGHT + MIDDLE alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(TEXT_ALIGN.RIGHT, VERTICAL_ALIGN.MIDDLE);

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(160, 1);
      expect(result.y).toBeCloseTo(188, 1);
    });

    it("should position text with RIGHT + BOTTOM alignment at 90-degree rotation", () => {
      const { container, boundTextElement, elementsMap } =
        createRotatedRectangleTestCase(TEXT_ALIGN.RIGHT, VERTICAL_ALIGN.BOTTOM);

      const result = computeBoundTextPosition(
        container,
        boundTextElement,
        elementsMap,
      );

      expect(result.x).toBeCloseTo(132, 1);
      expect(result.y).toBeCloseTo(188, 1);
    });
  });
});
