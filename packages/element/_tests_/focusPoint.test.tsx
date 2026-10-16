import { pointFrom } from "@excalidraw/math";

import { Excalidraw } from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";
import { Pointer, UI } from "@excalidraw/excalidraw/_tests_/helpers/ui";
import { act, render } from "@excalidraw/excalidraw/_tests_/test-utils";

import { defaultLang, setLanguage } from "@excalidraw/excalidraw/i18n";

import type { GlobalPoint } from "@excalidraw/math";

import {
  bindBindingElement,
  getBindingGap,
  getGlobalAttachPointForBindableElement,
} from "../src/binding";
import {
  handleFocusPointHover,
  handleFocusPointPointerDown,
  isFocusPointVisible,
} from "../src/arrows/focus";
import { LinearElementEditor } from "../src/linearElementEditor";

import type {
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "../src/types";

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
};

const createRect = (props: RectProps) =>
  API.createElement({
    type: "rectangle",
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

/** Run a scene/state mutating call (or a direct handler call) inside `act`. */
const inAct = <T,>(fn: () => T): T => {
  let result!: T;
  act(() => {
    result = fn();
  });
  return result;
};

/**
 * Chebyshev distance from `point` to `rect`'s outline **inflated by `offset`**.
 * For a non-rotated rectangle, inflating the outline by `offset` is the same as
 * growing the rect by `offset` on all four sides, so:
 *
 * - `=== offset` → the point lies on the inflated outline
 * - `< 0` → strictly inside the rect
 * - `> offset` → outside of the inflated outline
 *
 * Deliberately implementation-independent: it only knows the rect's geometry.
 */
const distanceToInflatedOutline = (
  [px, py]: GlobalPoint,
  rect: Pick<ExcalidrawBindableElement, "x" | "y" | "width" | "height">,
) =>
  Math.max(
    Math.abs(px - (rect.x + rect.width / 2)) - rect.width / 2,
    Math.abs(py - (rect.y + rect.height / 2)) - rect.height / 2,
  );

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
  const offset = distanceToInflatedOutline(endpoint, rect);
  // never strictly inside the bindable element (this is what the bug broke)
  expect(offset).toBeGreaterThan(0);
  // ... and no further out than the gap, i.e. on the inflated outline itself
  expect(Math.abs(offset - gap)).toBeLessThan(0.5);
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

const getFocusPointGlobal = (
  arrow: ExcalidrawLinearElement,
  which: "start" | "end",
): GlobalPoint => {
  const binding = which === "start" ? arrow.startBinding : arrow.endBinding;
  const element =
    binding && h.app.scene.getNonDeletedElement(binding.elementId);
  return getGlobalAttachPointForBindableElement(
    binding!.attachPoint,
    element as ExcalidrawBindableElement,
    elementsMap(),
  );
};

describe("focus point", () => {
  beforeEach(async () => {
    mouse.reset();
    await act(() => {
      return setLanguage(defaultLang);
    });
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  // -------------------------------------------------------------------------
  // isFocusPointVisible
  // -------------------------------------------------------------------------

  describe("isFocusPointVisible", () => {
    const rect = createRect({ x: 100, y: 100, width: 200, height: 200 });

    const otherRect = createRect({ x: 500, y: 100, width: 200, height: 200 });

    const makeArrow = (props: Partial<ExcalidrawArrowElement> = {}) =>
      createArrow({
        x: 300,
        y: 200,
        width: 200,
        height: 0,
        points: [pointFrom(0, 0), pointFrom(200, 0)],
        startBinding: { elementId: rect.id, attachPoint: [1, 0.5] },
        endBinding: { elementId: otherRect.id, attachPoint: [0, 0.5] },
        ...props,
      });

    it("is visible for both ends of a two-point arrow bound on both ends", () => {
      const arrow = makeArrow();

      expect(isFocusPointVisible(arrow, rect, h.state, "start")).toBe(true);
      expect(isFocusPointVisible(arrow, otherRect, h.state, "end")).toBe(true);
    });

    it("is not visible on an end that is not bound", () => {
      const arrow = makeArrow({ endBinding: null });

      expect(isFocusPointVisible(arrow, otherRect, h.state, "end")).toBe(false);
      // the other end is unaffected
      expect(isFocusPointVisible(arrow, rect, h.state, "start")).toBe(true);
    });

    it("is not visible when binding is disabled", () => {
      const arrow = makeArrow();
      API.setAppState({
        isBindingEnabled: false,
        bindingPreference: "disabled",
      });

      try {
        expect(isFocusPointVisible(arrow, rect, h.state, "start")).toBe(false);
        expect(isFocusPointVisible(arrow, otherRect, h.state, "end")).toBe(
          false,
        );
      } finally {
        API.setAppState({
          isBindingEnabled: true,
          bindingPreference: "enabled",
        });
      }
    });

    it("is not visible for elbow arrows", () => {
      const arrow = makeArrow({ elbowed: true });

      expect(isFocusPointVisible(arrow, rect, h.state, "start")).toBe(false);
      expect(isFocusPointVisible(arrow, otherRect, h.state, "end")).toBe(false);
    });

    it("is not visible for arrows that don't have exactly two points", () => {
      const singlePointArrow = makeArrow({ points: [pointFrom(0, 0)] });
      const threePointArrow = makeArrow({
        points: [pointFrom(0, 0), pointFrom(100, 0), pointFrom(200, 0)],
      });

      expect(
        isFocusPointVisible(singlePointArrow, rect, h.state, "start"),
      ).toBe(false);
      expect(isFocusPointVisible(threePointArrow, rect, h.state, "start")).toBe(
        false,
      );
      expect(
        isFocusPointVisible(threePointArrow, otherRect, h.state, "end"),
      ).toBe(false);
    });

    it("only shows this end's handle on this end's bound element", () => {
      const arrow = makeArrow();

      // `rect` is the start's bind target — it must not light up the end handle
      expect(isFocusPointVisible(arrow, rect, h.state, "end")).toBe(false);
      expect(isFocusPointVisible(arrow, otherRect, h.state, "start")).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleFocusPointPointerDown / handleFocusPointHover
  // -------------------------------------------------------------------------

  describe("focus point hit testing (pointerDown / hover)", () => {
    const setup = () => {
      const rectA = createRect({ x: 100, y: 100, width: 200, height: 200 });
      const rectB = createRect({ x: 700, y: 100, width: 200, height: 200 });
      const arrow = createArrow({
        x: 300,
        y: 200,
        width: 400,
        height: 0,
        points: [pointFrom(0, 0), pointFrom(400, 0)],
      });

      API.setElements([rectA, rectB, arrow]);

      bindBindingElement(
        arrow,
        rectA,
        "start",
        h.app.scene,
        pointFrom<GlobalPoint>(300, 200),
      );
      bindBindingElement(
        arrow,
        rectB,
        "end",
        h.app.scene,
        pointFrom<GlobalPoint>(700, 200),
      );

      return { rectA, rectB, arrow };
    };

    it("hits the end focus point when the pointer is on it", () => {
      const { arrow } = inAct(() => setup());
      const endFocusPoint = getFocusPointGlobal(arrow, "end");

      expect(
        inAct(() =>
          handleFocusPointHover(
            arrow,
            endFocusPoint[0],
            endFocusPoint[1],
            h.app.scene,
            h.state,
          ),
        ),
      ).toBe("end");

      const { hitFocusPoint, pointerOffset } = inAct(() =>
        handleFocusPointPointerDown(
          arrow,
          { origin: { x: endFocusPoint[0], y: endFocusPoint[1] } },
          elementsMap(),
          h.state,
        ),
      );
      expect(hitFocusPoint).toBe("end");
      expect(pointerOffset).toEqual({ x: 0, y: 0 });
    });

    it("does not hit any focus point away from the handles", () => {
      const { arrow } = inAct(() => setup());

      expect(
        inAct(() =>
          handleFocusPointHover(arrow, 500, 500, h.app.scene, h.state),
        ),
      ).toBe(null);

      const { hitFocusPoint } = inAct(() =>
        handleFocusPointPointerDown(
          arrow,
          { origin: { x: 500, y: 500 } },
          elementsMap(),
          h.state,
        ),
      );
      expect(hitFocusPoint).toBe(null);
    });
  });

  // -------------------------------------------------------------------------
  // handles on a real arrow drawn in the app
  // -------------------------------------------------------------------------

  describe("handles on an app-drawn arrow", () => {
    it("shows both handles when both ends are bound", () => {
      const rectA = createRect({ x: 100, y: 100, width: 200, height: 200 });
      const rectB = createRect({ x: 700, y: 100, width: 200, height: 200 });
      API.setElements([rectA, rectB]);

      UI.clickTool("arrow");
      mouse.downAt(200, 200);
      mouse.moveTo(800, 200);
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawArrowElement;

      expect(arrow.startBinding?.elementId).toBe(rectA.id);
      expect(arrow.endBinding?.elementId).toBe(rectB.id);

      expect(isFocusPointVisible(arrow, rectA, h.state, "start")).toBe(true);
      expect(isFocusPointVisible(arrow, rectB, h.state, "end")).toBe(true);

      // ... and both are actually hittable where the handles are drawn
      const startFocusPoint = getFocusPointGlobal(arrow, "start");
      const endFocusPoint = getFocusPointGlobal(arrow, "end");

      expect(
        handleFocusPointHover(
          arrow,
          startFocusPoint[0],
          startFocusPoint[1],
          h.app.scene,
          h.state,
        ),
      ).toBe("start");
      expect(
        handleFocusPointHover(
          arrow,
          endFocusPoint[0],
          endFocusPoint[1],
          h.app.scene,
          h.state,
        ),
      ).toBe("end");
    });

    it("does not show a handle on the free end", () => {
      const rectB = createRect({ x: 700, y: 100, width: 200, height: 200 });
      API.setElements([rectB]);

      UI.clickTool("arrow");
      mouse.downAt(100, 200);
      mouse.moveTo(800, 200);
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawArrowElement;

      expect(arrow.startBinding).toBe(null);
      expect(arrow.endBinding?.elementId).toBe(rectB.id);

      expect(isFocusPointVisible(arrow, rectB, h.state, "start")).toBe(false);
      expect(isFocusPointVisible(arrow, rectB, h.state, "end")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // dragging a focus point onto a shape
  // -------------------------------------------------------------------------

  describe("dragging a focus point handle", () => {
    /**
     * Two rectangles with a free-standing arrow drawn from the left of both
     * into the middle of the right one, so the end comes out bound to `rectR`
     * (and resting on its gap-inflated outline). The start stays free.
     */
    const setup = () => {
      const rectL = createRect({
        x: 400,
        y: 100,
        width: 200,
        height: 200,
        strokeWidth: 2,
      });
      const rectR = createRect({
        x: 700,
        y: 100,
        width: 200,
        height: 200,
        strokeWidth: 2,
      });

      API.setElements([rectL, rectR]);

      UI.clickTool("arrow");
      mouse.downAt(100, 200);
      mouse.moveTo(800, 200);
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawArrowElement;

      return { rectL, rectR, arrow };
    };

    const grabEndHandle = (arrow: ExcalidrawArrowElement) => {
      const endPoint = getEndpointGlobal(arrow, "end");
      mouse.moveTo(endPoint[0], endPoint[1]);
      mouse.downAt(endPoint[0], endPoint[1]);
      // the app must have picked up the focus point handle on pointer down,
      // otherwise the assertions below would only be testing a point drag
      expect(h.state.selectedLinearElement?.draggedFocusPointBinding).toBe(
        "end",
      );
    };

    it("creates the end binding on the inflated outline to start with", () => {
      const { rectR, arrow } = setup();

      expect(arrow.startBinding).toBe(null);
      expect(arrow.endBinding?.elementId).toBe(rectR.id);
      expectEndpointOnInflatedOutline(
        getEndpointGlobal(arrow, "end"),
        rectR,
        arrow,
      );
    });

    it("keeps the endpoint on the inflated outline when dragged inside that same shape", () => {
      const { rectR, arrow } = setup();

      grabEndHandle(arrow);
      // drag the handle deep into the shape it is bound to, near its top-right
      // corner — the pointer is strictly inside `rectR` here
      mouse.moveTo(890, 110);
      expect(
        distanceToInflatedOutline(pointFrom(890, 110), rectR),
      ).toBeLessThan(0);
      mouse.up();

      // still bound to the same shape ...
      expect(arrow.endBinding?.elementId).toBe(rectR.id);
      // ... but the endpoint must not follow the pointer into the shape
      expectEndpointOnInflatedOutline(
        getEndpointGlobal(arrow, "end"),
        rectR,
        arrow,
      );
      // the binding's own attach point must agree with the endpoint
      expect(getFocusPointGlobal(arrow, "end")).toEqual(
        getEndpointGlobal(arrow, "end"),
      );
    });

    it("re-binds to the shape the handle was dropped on, keeping the invariant", () => {
      const { rectL, rectR, arrow } = setup();

      expect(arrow.endBinding?.elementId).toBe(rectR.id);

      grabEndHandle(arrow);
      // drop the handle into the other rectangle's interior
      mouse.moveTo(590, 290);
      expect(
        distanceToInflatedOutline(pointFrom(590, 290), rectL),
      ).toBeLessThan(0);
      mouse.up();

      expect(arrow.endBinding?.elementId).toBe(rectL.id);
      expectEndpointOnInflatedOutline(
        getEndpointGlobal(arrow, "end"),
        rectL,
        arrow,
      );
      expect(getFocusPointGlobal(arrow, "end")).toEqual(
        getEndpointGlobal(arrow, "end"),
      );
    });

    it("moves the endpoint freely (and unbinds) when dropped away from any shape", () => {
      const { rectR, arrow } = setup();

      grabEndHandle(arrow);
      mouse.moveTo(200, 600);
      mouse.up();

      expect(arrow.endBinding).toBe(null);
      expect(getEndpointGlobal(arrow, "end")).toEqual(pointFrom(200, 600));
      expect(rectR.boundElements ?? []).toEqual([]);
    });
  });
});
