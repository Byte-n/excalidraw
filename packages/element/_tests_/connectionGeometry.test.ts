import { ROUNDNESS, arrayToMap } from "@excalidraw/common";
import {
  bezierEquation,
  curve,
  pointDistance,
  pointFrom,
} from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import { getProjectionBindingGap } from "../src/bindingGap";
import { getConnectionSpec } from "../src/connection";
import {
  buildConnectionOutline,
  nearestPointOnOutline,
} from "../src/connection/outline";
import {
  getAnchorRadius,
  getInsideBand,
  getOutsideBand,
} from "../src/connection/thresholds";
import { pathFromPoints } from "../src/compositeShape/outline";
import { distanceToElement } from "../src/distance";
import {
  newElement,
  newFrameElement,
  newStickyNoteElement,
  newTextElement,
} from "../src/newElement";

import type { OutlinePath } from "../src/connection";
import type { ExcalidrawBindableElement } from "../src/types";

const bindable = (element: unknown) => element as ExcalidrawBindableElement;

const elementsMapOf = (element: ExcalidrawBindableElement) =>
  arrayToMap([element]);

const specOf = (element: ExcalidrawBindableElement) =>
  getConnectionSpec(element);

const gapOf = (element: ExcalidrawBindableElement) =>
  getProjectionBindingGap(element, { elbowed: false });

/**
 * Deterministic Γ sampling: path vertices and cubic t = 1/4, 1/2, 3/4.
 * Straight segments are exact offsets of the outline, so their vertices carry
 * the same information; the interiors of the clipped arc chords in the shared
 * offset-polylines are discretization artifacts (their vertices lie on the true
 * offset), so they are not sampled.
 */
const samplePath = (path: OutlinePath): GlobalPoint[] => {
  const samples: GlobalPoint[] = [];
  let previous = pointFrom<GlobalPoint>(...path.start);
  samples.push(previous);
  for (const command of path.commands) {
    const end = pointFrom<GlobalPoint>(...command.to);
    if (command.type === "cubic") {
      const cubic = curve(
        previous,
        pointFrom<GlobalPoint>(...command.control1),
        pointFrom<GlobalPoint>(...command.control2),
        end,
      );
      for (const t of [0.25, 0.5, 0.75]) {
        samples.push(bezierEquation(cubic, t));
      }
    }
    samples.push(end);
    previous = end;
  }
  return samples;
};

describe("connection thresholds", () => {
  it("derives the outside band from zoom and gap", () => {
    expect(getOutsideBand(0.25, 5)).toBeCloseTo(30, 10);
    expect(getOutsideBand(1, 5)).toBeCloseTo(15, 10);
    expect(getOutsideBand(4, 5)).toBeCloseTo(15, 10);
    // zoom <= 0 is treated as 1
    expect(getOutsideBand(0, 5)).toBeCloseTo(15, 10);
    // the band always covers the gap
    expect(getOutsideBand(1, 20)).toBeCloseTo(20, 10);
    expect(getOutsideBand(0.25, 40)).toBeCloseTo(40, 10);
  });

  it("caps the inside band by a quarter of the shorter side", () => {
    expect(getInsideBand({ width: 100, height: 80 }, 0.25)).toBeCloseTo(20, 10);
    expect(getInsideBand({ width: 100, height: 80 }, 1)).toBeCloseTo(10, 10);
    expect(getInsideBand({ width: 100, height: 80 }, 4)).toBeCloseTo(2.5, 10);
    expect(getInsideBand({ width: 20, height: 20 }, 1)).toBeCloseTo(5, 10);
    expect(getInsideBand({ width: 20, height: 20 }, 0.25)).toBeCloseTo(5, 10);
  });

  it("caps the anchor radius by the band and the shorter side", () => {
    expect(getAnchorRadius({ width: 100, height: 80 }, 0.25, 5)).toBeCloseTo(
      20,
      10,
    );
    expect(getAnchorRadius({ width: 100, height: 80 }, 1, 5)).toBeCloseTo(
      14,
      10,
    );
    expect(getAnchorRadius({ width: 100, height: 80 }, 4, 5)).toBeCloseTo(
      3.5,
      10,
    );
    expect(getAnchorRadius({ width: 20, height: 20 }, 1, 5)).toBeCloseTo(5, 10);
    expect(getAnchorRadius({ width: 20, height: 20 }, 0, 5)).toBeCloseTo(5, 10);
  });
});

describe("connection spec anchors", () => {
  const expectAnchorsOnOutline = (
    element: ExcalidrawBindableElement,
    tolerance: number,
  ) => {
    const spec = specOf(element);
    const anchors = spec.anchors(element, {
      elementsMap: elementsMapOf(element),
    });
    expect(anchors).toHaveLength(4);
    const elementsMap = elementsMapOf(element);
    for (const anchor of anchors) {
      expect(
        distanceToElement(element, elementsMap, anchor),
      ).toBeLessThanOrEqual(tolerance);
    }
    return anchors;
  };

  it("places rectangle anchors on the outline", () => {
    const element = bindable(
      newElement({ type: "rectangle", x: 40, y: 30, width: 120, height: 80 }),
    );
    expectAnchorsOnOutline(element, 1e-6);
  });

  it("places diamond and ellipse anchors on the outline", () => {
    const diamond = bindable(
      newElement({ type: "diamond", x: 40, y: 30, width: 120, height: 80 }),
    );
    expectAnchorsOnOutline(diamond, 0.03);
    const ellipse = bindable(
      newElement({ type: "ellipse", x: 40, y: 30, width: 120, height: 80 }),
    );
    expectAnchorsOnOutline(ellipse, 1e-6);
  });

  it("places composite shape anchors on the outline", () => {
    const element = bindable(
      newElement({ type: "fc-hexagon", x: 40, y: 30, width: 120, height: 80 }),
    );
    expectAnchorsOnOutline(element, 0.03);
  });

  it("places text anchors on the bounding box", () => {
    const element = bindable(
      newTextElement({ text: "Hello", x: 40, y: 30, fontSize: 20 }),
    );
    expectAnchorsOnOutline(element, 1e-6);
  });

  it("gives an activation bar no anchors and a nearest interior", () => {
    const element = bindable(
      newElement({
        type: "sc-activation",
        x: 20,
        y: 20,
        width: 16,
        height: 100,
      }),
    );
    const spec = specOf(element);
    expect(
      spec.anchors(element, { elementsMap: elementsMapOf(element) }),
    ).toEqual([]);
    expect(spec.interior).toBe("nearest");
  });

  it("keeps frame anchors but disables its interior", () => {
    const element = bindable(
      newFrameElement({ x: 20, y: 20, width: 200, height: 150, name: "f" }),
    );
    const spec = specOf(element);
    expect(
      spec.anchors(element, { elementsMap: elementsMapOf(element) }),
    ).toHaveLength(4);
    expect(spec.interior).toBe("none");
  });
});

describe("Γ consistency", () => {
  const expectInflatedAtGap = (element: ExcalidrawBindableElement) => {
    const elementsMap = elementsMapOf(element);
    const gap = gapOf(element);
    const spec = specOf(element);
    const outline = buildConnectionOutline(element, gap, spec, {
      elementsMap,
    });
    expect(outline.inflated.length).toBeGreaterThan(0);
    for (const path of outline.inflated) {
      for (const point of samplePath(path)) {
        const distance = distanceToElement(element, elementsMap, point);
        expect(distance).toBeLessThan(gap + 0.01);
        expect(distance).toBeGreaterThan(gap - 0.01);
      }
    }
  };

  it("keeps axis-aligned rectangle Γ one gap away", () => {
    expectInflatedAtGap(
      bindable(
        newElement({ type: "rectangle", x: 40, y: 30, width: 120, height: 80 }),
      ),
    );
  });

  it("keeps rotated rectangle Γ one gap away", () => {
    expectInflatedAtGap(
      bindable(
        newElement({
          type: "rectangle",
          x: 40,
          y: 30,
          width: 120,
          height: 80,
          angle: (Math.PI / 6) as Radians,
        }),
      ),
    );
  });

  it("keeps ellipse Γ one gap away", () => {
    expectInflatedAtGap(
      bindable(
        newElement({ type: "ellipse", x: 40, y: 30, width: 50, height: 50 }),
      ),
    );
  });

  it("keeps diamond Γ one gap away", () => {
    expectInflatedAtGap(
      bindable(
        newElement({ type: "diamond", x: 40, y: 30, width: 120, height: 80 }),
      ),
    );
  });

  it("keeps composite flow shape Γ one gap away", () => {
    expectInflatedAtGap(
      bindable(
        newElement({
          type: "fc-hexagon",
          x: 40,
          y: 30,
          width: 120,
          height: 80,
        }),
      ),
    );
  });

  it("keeps rounded sticky note Γ one gap away", () => {
    expectInflatedAtGap(
      bindable(
        newStickyNoteElement({
          type: "stickynote",
          x: 40,
          y: 30,
          width: 120,
          height: 100,
          roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
        }),
      ),
    );
  });

  it("keeps frame Γ one gap away", () => {
    expectInflatedAtGap(
      bindable(
        newFrameElement({ x: 20, y: 20, width: 200, height: 150, name: "f" }),
      ),
    );
  });

  it("keeps text Γ on its bounding box (gap 0)", () => {
    const element = bindable(
      newTextElement({ text: "Hello", x: 40, y: 30, fontSize: 20 }),
    );
    expect(gapOf(element)).toBe(0);
    const outline = buildConnectionOutline(element, 5, specOf(element), {
      elementsMap: elementsMapOf(element),
    });
    for (const path of outline.inflated) {
      for (const point of samplePath(path)) {
        expect(
          distanceToElement(element, elementsMapOf(element), point),
        ).toBeLessThan(0.01);
      }
    }
  });
});

describe("activation bar connection outline", () => {
  const activation = () =>
    bindable(
      newElement({
        type: "sc-activation",
        x: 100,
        y: 100,
        width: 16,
        height: 100,
      }),
    );

  it("only exposes the vertical edge facing the reference", () => {
    const element = activation();
    const elementsMap = elementsMapOf(element);
    const gap = gapOf(element);
    const spec = specOf(element);

    const right = buildConnectionOutline(element, gap, spec, {
      reference: pointFrom<GlobalPoint>(400, 150),
      elementsMap,
    });
    expect(right.outline).toHaveLength(1);
    expect(right.inflated).toHaveLength(1);
    for (const point of samplePath(right.inflated[0])) {
      expect(point[0]).toBeCloseTo(element.x + element.width + gap, 6);
      // local y clamped to [1, height - 1], matching getActivationBindingPoint
      expect(point[1]).toBeGreaterThanOrEqual(element.y + 1 - 1e-9);
      expect(point[1]).toBeLessThanOrEqual(
        element.y + element.height - 1 + 1e-9,
      );
    }

    const left = buildConnectionOutline(element, gap, spec, {
      reference: pointFrom<GlobalPoint>(0, 150),
      elementsMap,
    });
    expect(left.inflated).toHaveLength(1);
    for (const point of samplePath(left.inflated[0])) {
      expect(point[0]).toBeCloseTo(element.x - gap, 6);
    }
  });

  it("exposes both vertical edges without a reference", () => {
    const element = activation();
    const outline = buildConnectionOutline(
      element,
      gapOf(element),
      specOf(element),
      { elementsMap: elementsMapOf(element) },
    );
    expect(outline.outline).toHaveLength(2);
    expect(outline.inflated).toHaveLength(2);
  });
});

describe("nearestPointOnOutline", () => {
  it("projects exactly onto a line segment", () => {
    const path = pathFromPoints(
      [
        [0, 0],
        [100, 0],
      ],
      false,
    );
    const result = nearestPointOnOutline(
      [path],
      pointFrom<GlobalPoint>(30, 20),
      { zoom: 1 },
    );
    expect(result.distance).toBeCloseTo(20, 9);
    expect(result.point[0]).toBeCloseTo(30, 9);
    expect(result.point[1]).toBeCloseTo(0, 9);
    expect(result.pathIndex).toBe(0);
  });

  it("clamps the projection to the segment endpoints", () => {
    const path = pathFromPoints(
      [
        [0, 0],
        [100, 0],
      ],
      false,
    );
    const result = nearestPointOnOutline(
      [path],
      pointFrom<GlobalPoint>(150, 10),
      { zoom: 1 },
    );
    expect(result.distance).toBeCloseTo(Math.sqrt(50 ** 2 + 10 ** 2), 9);
    expect(result.point[0]).toBeCloseTo(100, 9);
    expect(result.point[1]).toBeCloseTo(0, 9);
  });

  it("matches dense brute-force sampling on a cubic at zoom 4", () => {
    const path: OutlinePath = {
      start: [0, 0],
      commands: [
        {
          type: "cubic",
          control1: [0, 100],
          control2: [100, 100],
          to: [100, 0],
        },
      ],
      closed: false,
    };
    const cubic = curve(
      pointFrom<GlobalPoint>(0, 0),
      pointFrom<GlobalPoint>(0, 100),
      pointFrom<GlobalPoint>(100, 100),
      pointFrom<GlobalPoint>(100, 0),
    );
    const target = pointFrom<GlobalPoint>(72, 110);
    const result = nearestPointOnOutline([path], target, { zoom: 4 });

    let bruteDistance = Infinity;
    let brutePoint = cubic[0];
    const steps = 200000;
    for (let index = 0; index <= steps; index++) {
      const candidate = bezierEquation(cubic, index / steps);
      const distance = pointDistance(target, candidate);
      if (distance < bruteDistance) {
        bruteDistance = distance;
        brutePoint = candidate;
      }
    }
    expect(result.distance).toBeLessThanOrEqual(bruteDistance + 1e-6);
    expect(Math.abs(result.distance - bruteDistance)).toBeLessThan(1e-3);
    expect(pointDistance(result.point, brutePoint)).toBeLessThan(0.01);
  });

  it("returns the path index of the closest path", () => {
    const paths = [
      pathFromPoints(
        [
          [0, 0],
          [0, 100],
        ],
        false,
      ),
      pathFromPoints(
        [
          [200, 0],
          [200, 100],
        ],
        false,
      ),
    ];
    const result = nearestPointOnOutline(
      paths,
      pointFrom<GlobalPoint>(190, 50),
      { zoom: 1 },
    );
    expect(result.pathIndex).toBe(1);
    expect(result.point[0]).toBeCloseTo(200, 9);
  });
});
