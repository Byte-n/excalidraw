import { pointFrom, type GlobalPoint } from "@excalidraw/math";

import { getBindingGap, distanceToElement } from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  FixedPointBinding,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { convertElementTypes } from "../components/ConvertElementTypePopup";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

const { h } = window;

describe("convert element type keeps bound arrows attached", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  const cases = [
    ["rectangle", "diamond", [1, 0.25]],
    ["rectangle", "ellipse", [1, 0.1]],
    ["ellipse", "rectangle", [0.9, 0.2]],
    ["diamond", "rectangle", [0.75, 0.25]],
  ] as const;

  for (const elbowed of [false, true]) {
    it.each(cases)(
      `elbowed=${elbowed}: %s -> %s`,
      (fromType, toType, fixedPoint) => {
        const shape = API.createElement({
          type: fromType,
          x: 0,
          y: 0,
          width: 200,
          height: 200,
        });
        const arrow = API.createElement({
          type: "arrow",
          elbowed,
          x: 400,
          y: 50,
          width: 200,
          height: 0,
          points: [pointFrom(0, 0), pointFrom(-200, 0)],
          endBinding: {
            elementId: shape.id,
            fixedPoint,
            mode: "orbit",
          } as FixedPointBinding,
          startBinding: null,
        });
        API.setElements([
          { ...shape, boundElements: [{ id: arrow.id, type: "arrow" }] },
          arrow,
        ]);
        API.setSelectedElements([h.elements[0] as NonDeletedExcalidrawElement]);

        act(() => {
          convertElementTypes(h.app, {
            conversionType: "generic",
            nextType: toType,
          });
        });
        expect(h.elements[0]).toMatchObject({
          type: "composite_shape",
          shape: { id: toType, schemaVersion: 1 },
        });

        const converted = h.elements[0] as ExcalidrawBindableElement;
        const arrowAfter = h.elements[1] as ExcalidrawArrowElement;
        const [endX, endY] = arrowAfter.points[arrowAfter.points.length - 1];
        const globalEnd = pointFrom<GlobalPoint>(
          arrowAfter.x + endX,
          arrowAfter.y + endY,
        );

        // the arrow end must sit on the new outline (within the binding gap)
        const distance = distanceToElement(
          converted,
          h.app.scene.getNonDeletedElementsMap(),
          globalEnd,
        );
        expect(distance).toBeLessThanOrEqual(
          getBindingGap(converted, arrowAfter) + 1,
        );
      },
    );
  }

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
  ] as const)("converts to %s with its label and arrow bindings", (target) => {
    const shape = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 160,
    });
    const text = API.createElement({
      type: "text",
      x: 180,
      y: 170,
      width: 20,
      height: 20,
      text: "A",
      containerId: shape.id,
    });
    const arrow = API.createElement({
      type: "arrow",
      x: 400,
      y: 180,
      width: 100,
      height: 0,
      points: [pointFrom(0, 0), pointFrom(-100, 0)],
      endBinding: {
        elementId: shape.id,
        fixedPoint: [1, 0.5],
        mode: "orbit",
      } as FixedPointBinding,
      startBinding: null,
    });
    API.setElements([
      {
        ...shape,
        boundElements: [
          { id: text.id, type: "text" },
          { id: arrow.id, type: "arrow" },
        ],
      },
      text,
      arrow,
    ]);
    API.setSelectedElements([h.elements[0] as NonDeletedExcalidrawElement]);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: target,
      });
    });

    const converted = h.app.scene.getNonDeletedElement(shape.id);
    const boundText = h.app.scene.getNonDeletedElement(text.id);
    const boundArrow = h.app.scene.getNonDeletedElement(arrow.id);
    expect(converted).toMatchObject({
      id: shape.id,
      type: "composite_shape",
      shape: { id: target, schemaVersion: 1 },
      boundElements: expect.arrayContaining([
        { id: text.id, type: "text" },
        { id: arrow.id, type: "arrow" },
      ]),
    });
    expect(boundText).toMatchObject({ containerId: shape.id });
    expect(boundArrow).toMatchObject({ endBinding: { elementId: shape.id } });
    if (converted?.type === "composite_shape") {
      if (converted.shape.id === "triangle") {
        expect(converted.shape.triangle.apexX).toBe(0.5);
      } else if (converted.shape.id === "trapezoid") {
        expect(converted.shape.trapezoid).toEqual({
          narrowWidthRatio: 2 / 3,
          narrowEdge: "top",
        });
      } else if (converted.shape.id === "cube") {
        expect(converted.shape.cube.controlPoint).toEqual({ x: 0.82, y: 0.22 });
      }
    }
    if (converted && boundArrow?.type === "arrow") {
      const end = boundArrow.points.at(-1)!;
      const globalEnd = pointFrom<GlobalPoint>(
        boundArrow.x + end[0],
        boundArrow.y + end[1],
      );
      expect(
        distanceToElement(
          converted as ExcalidrawBindableElement,
          h.app.scene.getNonDeletedElementsMap(),
          globalEnd,
        ),
      ).toBeLessThanOrEqual(getBindingGap(converted, { elbowed: false }) + 1);
    }
  });

  it.each(["brace", "brace-reverse"] as const)(
    "reanchors a left-side arrow when converting to %s",
    (target) => {
      const shape = API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 160,
      });
      const arrow = API.createElement({
        type: "arrow",
        x: 0,
        y: 180,
        width: 100,
        height: 0,
        points: [pointFrom(0, 0), pointFrom(100, 0)],
        endBinding: {
          elementId: shape.id,
          fixedPoint: [0, 0.5],
          mode: "orbit",
        } as FixedPointBinding,
        startBinding: null,
      });
      API.setElements([
        { ...shape, boundElements: [{ id: arrow.id, type: "arrow" }] },
        arrow,
      ]);
      API.setSelectedElements([h.elements[0] as NonDeletedExcalidrawElement]);

      act(() => {
        convertElementTypes(h.app, {
          conversionType: "generic",
          nextType: target,
        });
      });

      const converted = h.app.scene.getNonDeletedElement(shape.id);
      const boundArrow = h.app.scene.getNonDeletedElement(arrow.id);
      expect(converted?.type).toBe("composite_shape");
      expect(boundArrow?.type).toBe("arrow");
      if (
        converted?.type === "composite_shape" &&
        boundArrow?.type === "arrow"
      ) {
        const end = boundArrow.points.at(-1)!;
        const globalEnd = pointFrom<GlobalPoint>(
          boundArrow.x + end[0],
          boundArrow.y + end[1],
        );
        expect(
          distanceToElement(
            converted,
            h.app.scene.getNonDeletedElementsMap(),
            globalEnd,
          ),
        ).toBeLessThanOrEqual(getBindingGap(converted, { elbowed: false }) + 1);
      }
    },
  );
});
