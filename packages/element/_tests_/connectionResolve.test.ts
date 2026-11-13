import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { ROUNDNESS, arrayToMap } from "@excalidraw/common";
import { lineSegment, pointDistance, pointFrom } from "@excalidraw/math";
import { vi } from "vitest";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import { getProjectionBindingGap } from "../src/bindingGap";
import { intersectElementWithLineSegment } from "../src/collision";
import { pickConnectionTarget, resolveConnectionHit } from "../src/connection";
import { getAnchorRadius } from "../src/connection/thresholds";
import { distanceToElement } from "../src/distance";
import {
  newArrowElement,
  newElement,
  newFrameElement,
  newStickyNoteElement,
  newTextElement,
} from "../src/newElement";

import type { RayProjector } from "../src/connection";
import type {
  ExcalidrawBindableElement,
  NonDeletedExcalidrawElement,
  Ordered,
} from "../src/types";

const bindable = (element: unknown) => element as ExcalidrawBindableElement;

const mapOf = (element: ExcalidrawBindableElement) => arrayToMap([element]);

const gapOf = (
  element: ExcalidrawBindableElement,
  arrow?: { elbowed: boolean },
) => getProjectionBindingGap(element, arrow ?? { elbowed: false });

const queryFor = (
  element: ExcalidrawBindableElement,
  point: GlobalPoint,
  overrides: Partial<Parameters<typeof resolveConnectionHit>[0]> = {},
) => ({
  element,
  point,
  zoom: 1,
  anchorsEnabled: false,
  angleLocked: false,
  elementsMap: mapOf(element),
  arrow: { elbowed: false },
  ...overrides,
});

/** Ray projector mirroring production: intersect the point→center ray with Γ. */
const testRayProjector: RayProjector = ({
  element,
  point,
  arrow,
  elementsMap,
}) => {
  const gap = getProjectionBindingGap(element, arrow ?? { elbowed: false });
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const hits = intersectElementWithLineSegment(
    element,
    elementsMap,
    lineSegment(point, center),
    gap,
  );
  return hits.length ? hits[0] : null;
};

const rectangle = () =>
  bindable(
    newElement({ type: "rectangle", x: 100, y: 100, width: 120, height: 80 }),
  );

describe("resolveConnectionHit tiers", () => {
  it("snaps to the nearest anchor inside the anchor radius", () => {
    const element = rectangle();
    const gap = gapOf(element);
    const anchor = pointFrom<GlobalPoint>(220, 140);
    const point = pointFrom<GlobalPoint>(220 + gap + 3, 140);
    const hit = resolveConnectionHit(
      queryFor(element, point, { anchorsEnabled: true }),
      testRayProjector,
    );
    expect(hit?.tier).toBe("anchor");
    expect(hit?.anchorIndex).toBe(1);
    expect(hit?.point[0]).toBeCloseTo(220 + gap, 6);
    expect(hit?.point[1]).toBeCloseTo(140, 6);
    expect(pointDistance(hit!.point, anchor)).toBeCloseTo(gap, 6);
    expect(
      Math.abs(distanceToElement(element, mapOf(element), hit!.point) - gap),
    ).toBeLessThanOrEqual(0.01);
    // The pointer is outside Γ, so tier ② would have been closer to it.
    expect(hit?.anchors).toHaveLength(4);
  });

  it("skips anchors when anchorsEnabled is false", () => {
    const element = rectangle();
    const gap = gapOf(element);
    const point = pointFrom<GlobalPoint>(220 + gap + 3, 140);
    const hit = resolveConnectionHit(
      queryFor(element, point, { anchorsEnabled: false }),
      testRayProjector,
    );
    expect(hit?.tier).toBe("outline");
    expect(hit?.point[0]).toBeCloseTo(220 + gap, 6);
  });

  it("resolves points in the outside band as outline hits", () => {
    const element = rectangle();
    const gap = gapOf(element);
    const hit = resolveConnectionHit(
      queryFor(element, pointFrom<GlobalPoint>(160, 95)),
      testRayProjector,
    );
    expect(hit?.tier).toBe("outline");
    expect(hit?.point[0]).toBeCloseTo(160, 6);
    expect(hit?.point[1]).toBeCloseTo(100 - gap, 6);
    expect(
      Math.abs(distanceToElement(element, mapOf(element), hit!.point) - gap),
    ).toBeLessThanOrEqual(0.01);
  });

  it("resolves shallow inside points as outline hits", () => {
    const element = rectangle();
    const gap = gapOf(element);
    const hit = resolveConnectionHit(
      queryFor(element, pointFrom<GlobalPoint>(160, 103)),
      testRayProjector,
    );
    expect(hit?.tier).toBe("outline");
    expect(hit?.point[1]).toBeCloseTo(100 - gap, 6);
  });

  it("delegates deep interior points to the injected ray projector", () => {
    const element = rectangle();
    const projected = pointFrom<GlobalPoint>(42, 43);
    const rayProject = vi.fn((_args: Parameters<RayProjector>[0]) => projected);
    const query = queryFor(element, pointFrom<GlobalPoint>(160, 140), {
      startOrEnd: "end",
    });
    const hit = resolveConnectionHit(query, rayProject);
    expect(hit?.tier).toBe("interior");
    expect(hit?.point).toEqual(projected);
    expect(rayProject).toHaveBeenCalledTimes(1);
    expect(rayProject.mock.calls[0][0]).toMatchObject({
      point: query.point,
      startOrEnd: "end",
    });
  });

  it("falls back to the nearest Γ point when the ray projector returns null", () => {
    const element = rectangle();
    const gap = gapOf(element);
    const hit = resolveConnectionHit(
      queryFor(element, pointFrom<GlobalPoint>(160, 140)),
      () => null,
    );
    expect(hit?.tier).toBe("interior");
    expect(
      Math.abs(distanceToElement(element, mapOf(element), hit!.point) - gap),
    ).toBeLessThanOrEqual(0.01);
  });

  it("returns null for frame interior but resolves near its border", () => {
    const element = bindable(
      newFrameElement({ x: 100, y: 100, width: 200, height: 150, name: "f" }),
    );
    expect(
      resolveConnectionHit(
        queryFor(element, pointFrom<GlobalPoint>(200, 175)),
        testRayProjector,
      ),
    ).toBeNull();
    const near = resolveConnectionHit(
      queryFor(element, pointFrom<GlobalPoint>(200, 95)),
      testRayProjector,
    );
    expect(near?.tier).toBe("outline");
  });

  it("bypasses anchors and the outline when angleLocked", () => {
    const element = rectangle();
    const gap = gapOf(element);
    const point = pointFrom<GlobalPoint>(220 + gap + 3, 140);
    const rayProject = vi.fn(() => null);
    expect(
      resolveConnectionHit(
        queryFor(element, point, { anchorsEnabled: true, angleLocked: true }),
        rayProject,
      ),
    ).toBeNull();
    expect(rayProject).toHaveBeenCalledTimes(1);

    const projected = pointFrom<GlobalPoint>(1, 2);
    const hit = resolveConnectionHit(
      queryFor(element, point, { anchorsEnabled: true, angleLocked: true }),
      () => projected,
    );
    expect(hit).toEqual({
      tier: "interior",
      point: projected,
      anchors: hit?.anchors,
    });
  });

  it("uses gap 0 for text targets", () => {
    const element = bindable(
      newTextElement({ text: "Hello", x: 100, y: 100, fontSize: 20 }),
    );
    expect(gapOf(element)).toBe(0);
    const hit = resolveConnectionHit(
      queryFor(element, pointFrom<GlobalPoint>(element.x + 10, element.y - 4)),
      testRayProjector,
    );
    expect(hit?.tier).toBe("outline");
    expect(
      distanceToElement(element, mapOf(element), hit!.point),
    ).toBeLessThanOrEqual(0.01);
  });

  it("resolves activation points near the non-connectable edge via nearest", () => {
    const element = bindable(
      newElement({
        type: "sc-activation",
        x: 100,
        y: 100,
        width: 16,
        height: 100,
      }),
    );
    const gap = gapOf(element);
    const hit = resolveConnectionHit(
      queryFor(element, pointFrom<GlobalPoint>(100.1, 150), {
        reference: pointFrom<GlobalPoint>(400, 150),
      }),
      testRayProjector,
    );
    expect(hit?.tier).toBe("interior");
    expect(hit?.point[0]).toBeCloseTo(100 + 16 + gap, 6);
    expect(hit?.point[1]).toBeCloseTo(150, 6);
    expect(hit?.anchors).toEqual([]);
  });

  it("scales the anchor radius with zoom", () => {
    const element = rectangle();
    const gap = gapOf(element);
    const point = pointFrom<GlobalPoint>(220 + gap + 4, 140);
    const hitAt = (zoom: number) =>
      resolveConnectionHit(
        queryFor(element, point, { anchorsEnabled: true, zoom }),
        testRayProjector,
      )?.tier;

    expect(getAnchorRadius(element, 0.25, gap)).toBeCloseTo(20, 10);
    expect(getAnchorRadius(element, 1, gap)).toBeCloseTo(14, 10);
    expect(getAnchorRadius(element, 4, gap)).toBeCloseTo(3.5, 10);

    expect(hitAt(0.25)).toBe("anchor");
    expect(hitAt(1)).toBe("anchor");
    expect(hitAt(4)).toBe("outline");
  });
});

describe("pickConnectionTarget", () => {
  it("prefers the smaller candidate and skips interior-none frames", () => {
    const big = bindable(
      newElement({ type: "rectangle", x: 0, y: 0, width: 400, height: 300 }),
    );
    const small = bindable(
      newElement({ type: "rectangle", x: 150, y: 120, width: 40, height: 40 }),
    );
    const elements = [big, small].map((element) => ({
      ...element,
      index: "a0" as never,
    })) as unknown as Ordered<NonDeletedExcalidrawElement>[];
    const elementsMap = arrayToMap(elements);
    const picked = pickConnectionTarget(
      pointFrom<GlobalPoint>(155, 140),
      elements,
      {
        zoom: 1,
        anchorsEnabled: false,
        angleLocked: false,
        elementsMap,
      },
      testRayProjector,
    );
    expect(picked?.element.id).toBe(small.id);
    expect(picked?.hit.tier).toBe("outline");
  });
});

describe("resolve properties", () => {
  const activationReference = pointFrom<GlobalPoint>(400, 150);

  const familyElements = (): ExcalidrawBindableElement[] => {
    const elements: ExcalidrawBindableElement[] = [
      bindable(
        newElement({
          type: "rectangle",
          x: 100,
          y: 100,
          width: 120,
          height: 80,
        }),
      ),
      bindable(
        newElement({
          type: "diamond",
          x: 100,
          y: 100,
          width: 120,
          height: 80,
        }),
      ),
      bindable(
        newElement({
          type: "ellipse",
          x: 100,
          y: 100,
          width: 50,
          height: 50,
        }),
      ),
      bindable(
        newElement({
          type: "fc-hexagon",
          x: 100,
          y: 100,
          width: 120,
          height: 80,
        }),
      ),
      bindable(newTextElement({ text: "Hello", x: 100, y: 100, fontSize: 20 })),
      bindable(
        newStickyNoteElement({
          type: "stickynote",
          x: 100,
          y: 100,
          width: 120,
          height: 100,
          roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
        }),
      ),
      bindable(
        newFrameElement({ x: 100, y: 100, width: 200, height: 150, name: "f" }),
      ),
      bindable(
        newElement({
          type: "sc-activation",
          x: 100,
          y: 100,
          width: 16,
          height: 100,
        }),
      ),
    ];
    return elements;
  };

  const arrows = () => [
    { elbowed: false },
    { elbowed: true },
    newArrowElement({
      type: "arrow",
      x: 0,
      y: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(10, 0)],
    }),
  ];

  const grid = (element: ExcalidrawBindableElement): GlobalPoint[] => {
    const points: GlobalPoint[] = [];
    const startX = element.x - 30;
    const startY = element.y - 30;
    const endX = element.x + element.width + 30;
    const endY = element.y + element.height + 30;
    for (let x = startX; x <= endX; x += 10) {
      for (let y = startY; y <= endY; y += 10) {
        points.push(pointFrom<GlobalPoint>(x, y));
      }
    }
    return points;
  };

  it("is idempotent and keeps every landing on Γ", () => {
    // Wide scan matrix (8 families × 3 arrows × 3 zooms × a grid per element);
    // each point rebuilds the outline twice.
    for (const element of familyElements()) {
      const elementsMap = arrayToMap([element]);
      for (const arrow of arrows()) {
        const gap = getProjectionBindingGap(element, arrow);
        for (const zoom of [0.25, 1, 4]) {
          for (const point of grid(element)) {
            const query = {
              element,
              point,
              reference:
                element.type === "sequence" ? activationReference : undefined,
              arrow,
              zoom,
              anchorsEnabled: true,
              angleLocked: false,
              elementsMap,
            };
            const hit = resolveConnectionHit(query, testRayProjector);
            if (!hit) {
              continue;
            }
            const distance = distanceToElement(element, elementsMap, hit.point);
            expect(Math.abs(distance - gap)).toBeLessThanOrEqual(0.01);

            const again = resolveConnectionHit(
              { ...query, point: hit.point },
              testRayProjector,
            );
            expect(again).not.toBeNull();
            expect(pointDistance(again!.point, hit.point)).toBeLessThanOrEqual(
              1e-6,
            );
          }
        }
      }
    }
  }, 180_000);
});

describe("resolve static constraints", () => {
  it("does not branch on element types", () => {
    // Works both from the repo root and from packages/element (workspace test).
    const cwd = process.cwd();
    const packageRoot = /packages[/\\]element$/.test(cwd)
      ? cwd
      : resolvePath(cwd, "packages/element");
    const source = readFileSync(
      resolvePath(packageRoot, "src/connection/resolve.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bis[A-Z]\w*Element\b/);
  });
});
