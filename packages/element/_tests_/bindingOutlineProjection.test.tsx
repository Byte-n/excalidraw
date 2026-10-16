import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { Excalidraw } from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";
import { Pointer, UI } from "@excalidraw/excalidraw/_tests_/helpers/ui";
import { act, render } from "@excalidraw/excalidraw/_tests_/test-utils";

import { defaultLang, setLanguage } from "@excalidraw/excalidraw/i18n";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import {
  getBindingGap,
  getGlobalAttachPointForBindableElement,
  resolveAttachPointForNonElbowBinding,
} from "../src/binding";
import { LinearElementEditor } from "../src/linearElementEditor";

import type {
  AttachPoint,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "../src/types";

/**
 * 建连那一刻的端点落点必须落在被绑元素**外扩一个 binding gap 的轮廓**上 ——
 * 这是 `binding.ts` 的核心不变式。这一支专门覆盖「另一端与落点重合」的退化情形
 * （新建箭头在 pointerdown 那一刻两端还叠在一起），那时没有可用的方向，投影只能
 * 靠「就近吸附到最近的那条边」。端点在这里被永久冻结，所以退化分支**必须**给出
 * 轮廓上的点：原样返回落点会把端点留在图形内部。
 *
 * 断言一律只依赖图形自身的几何（旋转回未旋转坐标系后算到外扩轮廓的距离），不依赖
 * 实现里的任何中间量。
 */

const { h } = window;

const mouse = new Pointer("mouse");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const elementsMap = () => h.app.scene.getNonDeletedElementsMap();

type RectProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeWidth?: number;
  angle?: number;
};

type AnyRectProps = Pick<RectProps, "x" | "y" | "width" | "height" | "angle">;

const createRect = (props: RectProps) =>
  API.createElement({
    type: "rectangle",
    ...props,
  }) as unknown as NonDeleted<ExcalidrawBindableElement>;

const createEllipse = (props: RectProps) =>
  API.createElement({
    type: "ellipse",
    ...props,
  }) as unknown as NonDeleted<ExcalidrawBindableElement>;

const createArrow = (
  props: Pick<ExcalidrawArrowElement, "x" | "y" | "points"> &
    Partial<ExcalidrawArrowElement>,
) =>
  API.createElement({
    type: "arrow",
    ...props,
  }) as unknown as NonDeleted<ExcalidrawArrowElement>;

/** an object good enough to derive a binding gap from */
const createArrowStub = () =>
  ({ elbowed: false, strokeWidth: 1 } as unknown as ExcalidrawLinearElement);

const centerOf = (element: AnyRectProps) =>
  pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );

/** the scene point a `attachPoint` ratio of `element` resolves to */
const globalAttachPoint = (
  element: NonDeleted<ExcalidrawBindableElement>,
  attachPoint: AttachPoint,
) =>
  getGlobalAttachPointForBindableElement(attachPoint, element, elementsMap());

/**
 * Signed distance from `point` to `rect`'s outline **inflated by `gap`** — that
 * is, to the Minkowski sum of the rectangle with a disc of radius `gap` (which
 * is what a gap-inflated outline is: the sides pushed out by `gap`, joined by
 * arcs of radius `gap` centred on the rectangle's corners).
 *
 * - `=== 0` → the point lies on the inflated outline
 * - `< 0` → the point is inside the inflated outline (the deeper, the more
 *   negative; a point inside the rectangle itself is at most `-gap`)
 * - `> 0` → the point is further out than one gap
 *
 * Deliberately implementation-independent: it only knows the rect's geometry.
 */
const signedDistanceToInflatedOutline = (
  point: GlobalPoint,
  rect: AnyRectProps,
  gap: number,
) => {
  const local = pointRotateRads(
    point,
    centerOf(rect),
    -(rect.angle ?? 0) as Radians,
  );
  const outsideX = Math.max(
    Math.abs(local[0] - (rect.x + rect.width / 2)) - rect.width / 2,
    0,
  );
  const outsideY = Math.max(
    Math.abs(local[1] - (rect.y + rect.height / 2)) - rect.height / 2,
    0,
  );

  if (outsideX > 0 || outsideY > 0) {
    // outside the rectangle: the inflated outline is `gap` away along the
    // outward normal of the nearest point of the rectangle
    return Math.hypot(outsideX, outsideY) - gap;
  }

  // inside the rectangle: the nearest point of the inflated outline is the
  // perpendicular foot onto the nearest side, one `gap` plus one side-distance
  // away
  return -(
    gap +
    Math.min(
      rect.width / 2 - Math.abs(local[0] - (rect.x + rect.width / 2)),
      rect.height / 2 - Math.abs(local[1] - (rect.y + rect.height / 2)),
    )
  );
};

/** how far `point` is from the gap-inflated ellipse's outline (0 = on it) */
const distanceToInflatedEllipseOutline = (
  point: GlobalPoint,
  ellipse: AnyRectProps,
  gap: number,
) => {
  const local = pointRotateRads(
    point,
    centerOf(ellipse),
    -(ellipse.angle ?? 0) as Radians,
  );
  const dx =
    (local[0] - (ellipse.x + ellipse.width / 2)) / (ellipse.width / 2 + gap);
  const dy =
    (local[1] - (ellipse.y + ellipse.height / 2)) / (ellipse.height / 2 + gap);
  return Math.abs(Math.hypot(dx, dy) - 1);
};

/**
 * The invariant under test: a bound endpoint sits on the bindable element's
 * outline inflated by exactly one binding gap — never inside the element.
 */
const expectEndpointOnInflatedOutline = (
  endpoint: GlobalPoint,
  rect: NonDeleted<ExcalidrawBindableElement>,
  arrow: ExcalidrawLinearElement,
) => {
  const gap = getBindingGap(rect, arrow);
  const distance = signedDistanceToInflatedOutline(endpoint, rect, gap);

  // never inside the bindable element (this is what the bug broke) ...
  expect(distance).toBeGreaterThan(-0.5);
  // ... and never further out than one gap, i.e. on the inflated outline
  expect(distance).toBeLessThan(0.5);
};

const getEndpointGlobal = (
  arrow: ExcalidrawLinearElement,
  which: "start" | "end",
): GlobalPoint =>
  LinearElementEditor.getPointAtIndexGlobalCoordinates(
    arrow,
    which === "start" ? 0 : -1,
    elementsMap(),
  );

/**
 * `resolveAttachPointForNonElbowBinding` for the degenerate case the bug report
 * exercised: the arrow is brand new, so both of its points still sit on the
 * pointer-down position (a zero-length arrow). Returns the resulting
 * `attachPoint` along with the global point it resolves to.
 */
const resolveDegenerateProjection = (
  element: NonDeleted<ExcalidrawBindableElement>,
  focusPoint: GlobalPoint,
  which: "start" | "end" = "start",
): { attachPoint: AttachPoint; global: GlobalPoint } => {
  const arrow = createArrow({
    x: focusPoint[0],
    y: focusPoint[1],
    width: 0,
    height: 0,
    points: [pointFrom(0, 0), pointFrom(0, 0)],
  });
  API.setElements([element, arrow]);

  const { attachPoint } = resolveAttachPointForNonElbowBinding(
    arrow,
    element,
    which,
    elementsMap(),
    focusPoint,
  );

  return { attachPoint, global: globalAttachPoint(element, attachPoint) };
};

// ---------------------------------------------------------------------------

describe("binding: projecting an endpoint onto the gap-inflated outline", () => {
  beforeEach(async () => {
    mouse.reset();
    await act(() => {
      return setLanguage(defaultLang);
    });
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  // -------------------------------------------------------------------------
  // the reported bug: drawing an arrow out of a shape's interior
  // -------------------------------------------------------------------------

  describe("arrow drawn from inside a shape outwards", () => {
    it("seeds the start endpoint on the inflated outline, not inside the shape", () => {
      const rect = createRect({
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        strokeWidth: 2,
      });
      API.setElements([rect]);

      UI.clickTool("arrow");
      // pointer down deep inside the rectangle (10px in from its top-left
      // corner), then drag out of it
      mouse.downAt(110, 110);
      mouse.moveTo(400, 400);
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawArrowElement;
      const endpoint = getEndpointGlobal(arrow, "start");
      const gap = getBindingGap(rect, arrow);

      expect(arrow.startBinding?.elementId).toBe(rect.id);
      // the regression: the endpoint used to stay exactly where the pointer
      // went down, i.e. 10px *inside* the rectangle
      expect(
        signedDistanceToInflatedOutline(endpoint, rect, gap),
      ).toBeGreaterThan(-0.5);
      expectEndpointOnInflatedOutline(endpoint, rect, arrow);
      // ... and the endpoint is what the binding itself resolves to
      expect(globalAttachPoint(rect, arrow.startBinding!.attachPoint)).toEqual(
        endpoint,
      );
    });

    it("seeds the start endpoint on the inflated outline (another entry point)", () => {
      const rect = createRect({
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        strokeWidth: 2,
      });
      API.setElements([rect]);

      UI.clickTool("arrow");
      mouse.downAt(120, 260);
      mouse.moveTo(500, 260);
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawArrowElement;

      expect(arrow.startBinding?.elementId).toBe(rect.id);
      expectEndpointOnInflatedOutline(
        getEndpointGlobal(arrow, "start"),
        rect,
        arrow,
      );
    });
  });

  // -------------------------------------------------------------------------
  // degenerate projection, driven directly
  // -------------------------------------------------------------------------

  describe("degenerate projection (both endpoints still on the pointer)", () => {
    const rect = () =>
      createRect({ x: 100, y: 100, width: 200, height: 200, strokeWidth: 2 });

    it("lands on the outline for a point deep inside the shape", () => {
      const element = rect();
      const { attachPoint, global } = resolveDegenerateProjection(
        element,
        pointFrom<GlobalPoint>(110, 110),
      );

      // the bug: the ratio was returned as-is, i.e. 10px inside the rectangle
      expect(attachPoint).not.toEqual([0.05, 0.05]);
      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline for the exact center (all four edges tie)", () => {
      const element = rect();
      const { global } = resolveDegenerateProjection(
        element,
        pointFrom<GlobalPoint>(200, 200),
      );

      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline for a point on an edge", () => {
      const element = rect();
      const { global } = resolveDegenerateProjection(
        element,
        pointFrom<GlobalPoint>(100, 200),
      );

      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline for a corner point", () => {
      const element = rect();
      const { global } = resolveDegenerateProjection(
        element,
        pointFrom<GlobalPoint>(100, 100),
      );

      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline for a point on the center-corner diagonal", () => {
      const element = createRect({
        x: 100,
        y: 100,
        width: 300,
        height: 300,
        strokeWidth: 2,
      });
      const { global } = resolveDegenerateProjection(
        element,
        pointFrom<GlobalPoint>(150, 150),
      );

      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline for a point just outside the shape", () => {
      const element = rect();
      const focusPoint = pointFrom<GlobalPoint>(310, 200);
      // the pointer really is outside the shape here
      expect(
        signedDistanceToInflatedOutline(
          focusPoint,
          element,
          getBindingGap(element, createArrowStub()),
        ),
      ).toBeGreaterThan(0);

      const { global } = resolveDegenerateProjection(element, focusPoint);

      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline for a point beyond the shape's corner", () => {
      const element = rect();
      const focusPoint = pointFrom<GlobalPoint>(310, 310);

      const { global } = resolveDegenerateProjection(element, focusPoint);

      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline when the shape is rotated", () => {
      const angle = (30 * Math.PI) / 180;
      const element = createRect({
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        strokeWidth: 2,
        angle,
      });
      // a point that is inside the *rotated* rectangle
      const focusPoint = pointRotateRads(
        pointFrom<GlobalPoint>(110, 110),
        centerOf(element),
        angle as Radians,
      );
      expect(
        signedDistanceToInflatedOutline(
          focusPoint,
          element,
          getBindingGap(element, createArrowStub()),
        ),
      ).toBeLessThan(0);

      const { global } = resolveDegenerateProjection(element, focusPoint);

      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline when the shape is rotated and the point is its center", () => {
      const angle = (30 * Math.PI) / 180;
      const element = createRect({
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        strokeWidth: 2,
        angle,
      });

      const { global } = resolveDegenerateProjection(
        element,
        centerOf(element),
      );

      expectEndpointOnInflatedOutline(global, element, createArrowStub());
    });

    it("lands on the outline for an ellipse", () => {
      const element = createEllipse({
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        strokeWidth: 2,
      });
      const gap = getBindingGap(element, createArrowStub());
      const focusPoint = pointFrom<GlobalPoint>(200, 140);

      const { global } = resolveDegenerateProjection(element, focusPoint);

      // the point must actually have moved, and onto the inflated ellipse
      expect(global).not.toEqual(focusPoint);
      expect(
        distanceToInflatedEllipseOutline(global, element, gap),
      ).toBeLessThan(0.5);
    });

    it("lands on the outline for an ellipse when the point is its center", () => {
      const element = createEllipse({
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        strokeWidth: 2,
      });
      const gap = getBindingGap(element, createArrowStub());

      const { global } = resolveDegenerateProjection(
        element,
        centerOf(element),
      );

      expect(
        distanceToInflatedEllipseOutline(global, element, gap),
      ).toBeLessThan(0.5);
    });

    it("keeps the endpoint on the outline for a multi-point arrow whose first segment is degenerate", () => {
      const element = rect();
      const focusPoint = pointFrom<GlobalPoint>(110, 110);
      // a three-point arrow whose end-coincident neighbour sits on it
      const arrow = createArrow({
        x: focusPoint[0],
        y: focusPoint[1],
        width: 300,
        height: 300,
        points: [pointFrom(0, 0), pointFrom(0, 0), pointFrom(300, 300)],
      });
      API.setElements([element, arrow]);

      const { attachPoint } = resolveAttachPointForNonElbowBinding(
        arrow,
        element,
        "start",
        elementsMap(),
        focusPoint,
      );

      expectEndpointOnInflatedOutline(
        globalAttachPoint(element, attachPoint),
        element,
        arrow,
      );
    });

    /**
     * 射线**整条**错过轮廓：`intersectElementWithLineSegment` 吃的是有界线段
     * （`lineSegment(focusPoint, otherPoint)`），焦点与参考点都在图形内部时，这一段
     * 整条都在图形里，求交一无所获。这一档与「端点正好落在轮廓上」那种退回都不是
     * 一回事 —— 必须落到 `projectPointOntoBoundElementOutline` 最后一处兜底
     * （`projectFocusPointOntoInflatedOutline`）：有方向可用（射线只是够不着轮廓），
     * 所以**不许**把落点原样留在图形内部。
     */
    it("projects an endpoint onto the outline when the whole ray misses it", () => {
      const element = rect();
      const focusPoint = pointFrom<GlobalPoint>(150, 150);
      // 箭头两端都落在矩形内部（另一端没有绑定，就是它自己的点）：两端之间那一段
      // 整条都在图形里
      const arrow = createArrow({
        x: 150,
        y: 150,
        width: 100,
        height: 100,
        points: [pointFrom(0, 0), pointFrom(100, 100)],
        // 非曲线档：曲线档会先走「沿所依附边外法线外移一个 gap」那一支
        roundness: null,
      });
      API.setElements([element, arrow]);

      const { attachPoint } = resolveAttachPointForNonElbowBinding(
        arrow,
        element,
        "start",
        elementsMap(),
        focusPoint,
      );
      const global = globalAttachPoint(element, attachPoint);

      // 落点必须被投到外扩轮廓上，而不是原样留在图形内部（那会让端点永久冻住）
      expect(global).not.toEqual(focusPoint);
      expectEndpointOnInflatedOutline(global, element, arrow);
    });
  });
});
