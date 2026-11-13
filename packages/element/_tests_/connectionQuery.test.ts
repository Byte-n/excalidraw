import { arrayToMap } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import { getBindingGap } from "../src/bindingGap";
import { buildConnectionQuery } from "../src/connection/query";
import { newArrowElement, newElement } from "../src/newElement";

import type { ExcalidrawBindableElement } from "../src/types";

const bindable = (element: unknown) => element as ExcalidrawBindableElement;

const rectangle = () =>
  bindable(
    newElement({ type: "rectangle", x: 100, y: 100, width: 120, height: 80 }),
  );

const ellipse = () =>
  bindable(
    newElement({ type: "ellipse", x: 100, y: 100, width: 120, height: 80 }),
  );

const baseArgs = (element: ExcalidrawBindableElement) => ({
  element,
  point: pointFrom<GlobalPoint>(222, 140),
  zoom: 1,
  isMidpointSnappingEnabled: true,
  elementsMap: arrayToMap([element]),
});

describe("buildConnectionQuery", () => {
  it("enables anchors in the default mode", () => {
    const element = rectangle();
    const query = buildConnectionQuery(baseArgs(element));
    expect(query.anchorsEnabled).toBe(true);
    expect(query.angleLocked).toBe(false);
    expect(query.point).toEqual(pointFrom<GlobalPoint>(222, 140));
    // no arrow passed: the default (sharp) arrow is used
    expect(query.arrow).toEqual({ elbowed: false });
    expect(query.startOrEnd).toBe("start");
    expect(query.zoom).toBe(1);
  });

  it("disables anchors when midpoint snapping is off", () => {
    const element = rectangle();
    const query = buildConnectionQuery({
      ...baseArgs(element),
      isMidpointSnappingEnabled: false,
    });
    expect(query.anchorsEnabled).toBe(false);
    expect(query.angleLocked).toBe(false);
  });

  it("disables anchors and forces the ray when angle locked", () => {
    const element = rectangle();
    const query = buildConnectionQuery({
      ...baseArgs(element),
      angleLocked: true,
    });
    expect(query.anchorsEnabled).toBe(false);
    expect(query.angleLocked).toBe(true);
    // angle lock keeps the raw point (the caller supplies the scene pointer)
    expect(query.point).toEqual(pointFrom<GlobalPoint>(222, 140));
  });

  it("grid mode snaps the point and disables anchors", () => {
    const element = rectangle();
    const gap = getBindingGap(element, { elbowed: false });
    const query = buildConnectionQuery({
      ...baseArgs(element),
      gridSize: 20 as never,
    });
    expect(query.anchorsEnabled).toBe(false);
    // right edge at x = 220, y snapped to the 20px grid
    expect(query.point[0]).toBeCloseTo(220 + gap, 6);
    expect(query.point[1]).toBeCloseTo(140, 6);
  });

  it("defaults the grid adjacent point to the arrow's fixed end", () => {
    const element = ellipse();
    const arrow = newArrowElement({
      type: "arrow",
      x: 100,
      y: 140,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 0)],
    });
    const explicit = buildConnectionQuery({
      ...baseArgs(element),
      arrow,
      gridSize: 20 as never,
      adjacentPoint: pointFrom<GlobalPoint>(200, 140),
    });
    const implicit = buildConnectionQuery({
      ...baseArgs(element),
      arrow,
      gridSize: 20 as never,
    });
    expect(implicit.point[0]).toBeCloseTo(explicit.point[0], 6);
    expect(implicit.point[1]).toBeCloseTo(explicit.point[1], 6);
  });
});
