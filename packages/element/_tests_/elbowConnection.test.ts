import { arrayToMap } from "@excalidraw/common";
import { pointDistance, pointFrom } from "@excalidraw/math";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import {
  bindPointToSnapToElementOutline,
  projectElbowAxisRay,
  resolveConnectionHitForElbowArrowEndpoint,
} from "../src/binding";
import { getProjectionBindingGap } from "../src/bindingGap";
import { distanceToElement } from "../src/distance";
import {
  newArrowElement,
  newElement,
  newFrameElement,
} from "../src/newElement";

import type {
  ExcalidrawBindableElement,
  ExcalidrawElbowArrowElement,
  NonDeleted,
} from "../src/types";

const bindable = (element: unknown) => element as ExcalidrawBindableElement;

const rectangle = () =>
  bindable(
    newElement({ type: "rectangle", x: 100, y: 100, width: 120, height: 80 }),
  );

const elbowAt = (end: GlobalPoint) =>
  newArrowElement({
    type: "arrow",
    elbowed: true,
    x: 0,
    y: 0,
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(end[0], end[1]),
    ],
  }) as unknown as NonDeleted<ExcalidrawElbowArrowElement>;

const gapOf = (element: ExcalidrawBindableElement) =>
  getProjectionBindingGap(element, { elbowed: true });

const mapOf = (element: ExcalidrawBindableElement) => arrayToMap([element]);

describe("elbow connection landing", () => {
  it("tier ① — anchor: endpoints inside the anchor radius snap to the anchor", () => {
    const element = rectangle();
    const elementsMap = mapOf(element);
    const arrow = elbowAt(pointFrom<GlobalPoint>(220 + gapOf(element), 140));
    const hit = resolveConnectionHitForElbowArrowEndpoint(
      arrow,
      element,
      "end",
      pointFrom<GlobalPoint>(220 + gapOf(element), 140),
      elementsMap,
    );
    expect(hit?.tier).toBe("anchor");
    expect(hit?.point[0]).toBeCloseTo(220 + gapOf(element), 6);
    expect(hit?.point[1]).toBeCloseTo(140, 6);
    // landing uses the same hit
    const landing = bindPointToSnapToElementOutline(
      arrow,
      element,
      "end",
      elementsMap,
    );
    expect(pointDistance(landing, hit!.point)).toBeLessThanOrEqual(1e-6);
  });

  it("tier ② — outline: outside the anchor radius lands on the nearest Γ point", () => {
    const element = rectangle();
    const elementsMap = mapOf(element);
    const endpoint = pointFrom<GlobalPoint>(217, 165);
    const arrow = elbowAt(endpoint);
    const hit = resolveConnectionHitForElbowArrowEndpoint(
      arrow,
      element,
      "end",
      endpoint,
      elementsMap,
    );
    expect(hit?.tier).toBe("outline");
    expect(hit?.point[0]).toBeCloseTo(220 + gapOf(element), 6);
    expect(hit?.point[1]).toBeCloseTo(165, 6);
    expect(
      Math.abs(
        distanceToElement(element, elementsMap, hit!.point) - gapOf(element),
      ),
    ).toBeLessThanOrEqual(0.01);
    const landing = bindPointToSnapToElementOutline(
      arrow,
      element,
      "end",
      elementsMap,
    );
    expect(pointDistance(landing, hit!.point)).toBeLessThanOrEqual(1e-6);
  });

  it("tier ③ — deep interior falls back to the elbow axis ray (Γ)", () => {
    const element = rectangle();
    const elementsMap = mapOf(element);
    const endpoint = pointFrom<GlobalPoint>(300, 300);
    const arrow = elbowAt(endpoint);
    const hit = resolveConnectionHitForElbowArrowEndpoint(
      arrow,
      element,
      "end",
      endpoint,
      elementsMap,
    );
    expect(hit?.tier).toBe("interior");
    expect(
      Math.abs(
        distanceToElement(element, elementsMap, hit!.point) - gapOf(element),
      ),
    ).toBeLessThanOrEqual(0.01);
    const landing = bindPointToSnapToElementOutline(
      arrow,
      element,
      "end",
      elementsMap,
    );
    expect(pointDistance(landing, hit!.point)).toBeLessThanOrEqual(1e-6);
  });

  it("falls back to the axis ray when the target is interior-none (frame)", () => {
    const frame = bindable(
      newFrameElement({ x: 100, y: 100, width: 200, height: 150, name: "f" }),
    );
    const elementsMap = mapOf(frame);
    const endpoint = pointFrom<GlobalPoint>(200, 175);
    const arrow = elbowAt(endpoint);
    expect(
      resolveConnectionHitForElbowArrowEndpoint(
        arrow,
        frame,
        "end",
        endpoint,
        elementsMap,
      ),
    ).toBeNull();
    const ray = projectElbowAxisRay({
      element: frame,
      point: endpoint,
      arrow,
      elementsMap,
      startOrEnd: "end",
    });
    expect(ray).not.toBeNull();
    expect(
      pointDistance(
        bindPointToSnapToElementOutline(arrow, frame, "end", elementsMap),
        ray!,
      ),
    ).toBeLessThanOrEqual(1e-6);
  });

  it("grid mode disables anchors and grid-snaps the point", () => {
    const element = rectangle();
    const elementsMap = mapOf(element);
    const endpoint = pointFrom<GlobalPoint>(226, 147);
    const arrow = elbowAt(endpoint);
    const hit = resolveConnectionHitForElbowArrowEndpoint(
      arrow,
      element,
      "end",
      endpoint,
      elementsMap,
      { gridSize: 20 as never },
    );
    expect(hit).not.toBeNull();
    expect(hit?.tier).not.toBe("anchor");
    expect(hit?.point[1]).toBeCloseTo(140, 6);
    const landing = bindPointToSnapToElementOutline(
      arrow,
      element,
      "end",
      elementsMap,
      undefined,
      { gridSize: 20 as never },
    );
    expect(pointDistance(landing, hit!.point)).toBeLessThanOrEqual(1e-6);
  });

  it("angle lock forces the ray tier and bypasses anchors", () => {
    const element = rectangle();
    const elementsMap = mapOf(element);
    const endpoint = pointFrom<GlobalPoint>(226, 147);
    const arrow = elbowAt(endpoint);
    const opts = { angleLocked: true };
    const hit = resolveConnectionHitForElbowArrowEndpoint(
      arrow,
      element,
      "end",
      endpoint,
      elementsMap,
      opts,
    );
    expect(hit?.tier).toBe("interior");
    const ray = projectElbowAxisRay({
      element,
      point: endpoint,
      arrow,
      elementsMap,
      startOrEnd: "end",
    });
    expect(pointDistance(hit!.point, ray!)).toBeLessThanOrEqual(0.5);
    const landing = bindPointToSnapToElementOutline(
      arrow,
      element,
      "end",
      elementsMap,
      undefined,
      opts,
    );
    expect(pointDistance(landing, hit!.point)).toBeLessThanOrEqual(1e-6);
  });

  it("preview and landing share the same hit for every tier", () => {
    const element = rectangle();
    const elementsMap = mapOf(element);
    const startArrowAt = (start: GlobalPoint) =>
      newArrowElement({
        type: "arrow",
        elbowed: true,
        x: 0,
        y: 0,
        points: [
          pointFrom<LocalPoint>(start[0], start[1]),
          pointFrom<LocalPoint>(start[0] + 60, start[1] + 40),
        ],
      }) as unknown as NonDeleted<ExcalidrawElbowArrowElement>;

    for (const endpoint of [
      pointFrom<GlobalPoint>(226, 140),
      pointFrom<GlobalPoint>(217, 165),
      pointFrom<GlobalPoint>(300, 300),
    ]) {
      for (const startOrEnd of ["end", "start"] as const) {
        const arrow =
          startOrEnd === "end" ? elbowAt(endpoint) : startArrowAt(endpoint);
        const hit = resolveConnectionHitForElbowArrowEndpoint(
          arrow,
          element,
          startOrEnd,
          endpoint,
          elementsMap,
        );
        const landing = bindPointToSnapToElementOutline(
          arrow,
          element,
          startOrEnd,
          elementsMap,
        );
        expect(hit).not.toBeNull();
        expect(pointDistance(landing, hit!.point)).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});
