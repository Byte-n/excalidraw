import { KEYS, arrayToMap } from "@excalidraw/common";

import { pointFrom } from "@excalidraw/math";

import { actionWrapTextInContainer } from "@excalidraw/excalidraw/actions/actionBoundText";

import { Excalidraw, isLinearElement } from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";
import {
  UI,
  Pointer,
  Keyboard,
} from "@excalidraw/excalidraw/_tests_/helpers/ui";
import {
  act,
  fireEvent,
  render,
} from "@excalidraw/excalidraw/_tests_/test-utils";

import { defaultLang, setLanguage } from "@excalidraw/excalidraw/i18n";

import {
  bindBindingElement,
  updateBoundElements,
  BASE_BINDING_GAP,
  getGlobalAttachPointForBindableElement,
} from "../src/binding";
import { getElementAbsoluteCoords } from "../src/bounds";
import { isPointInElement } from "../src/collision";
import { distanceToElement } from "../src/distance";
import { isCompositeShapeId } from "../src/compositeShape";
import { transformElements } from "../src/resizeElements";
import {
  getTextEditor,
  TEXT_EDITOR_SELECTOR,
} from "../../excalidraw/_tests_/queries/dom";

import type {
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawLinearElement,
  ElementBinding,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "../src/types";

const { h } = window;

const mouse = new Pointer("mouse");

describe("binding for simple arrows", () => {
  describe("when both endpoints are bound to the same element", () => {
    beforeEach(async () => {
      mouse.reset();

      await act(() => {
        return setLanguage(defaultLang);
      });
      await render(<Excalidraw handleKeyboardGlobally={true} />);
    });

    it("should pull both endpoints onto the outline of the single bound element", () => {
      // Create a rectangle
      UI.clickTool("rectangle");
      mouse.reset();
      mouse.downAt(100, 100);
      mouse.moveTo(200, 200);
      mouse.up();

      const rect = API.getSelectedElement();

      // Draw arrow with endpoint inside the filled rectangle
      UI.clickTool("arrow");
      mouse.downAt(110, 110);
      mouse.moveTo(160, 160);
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawLinearElement;

      // 端点不再停在指针落下的位置（矩形内部）：起点的落点被吸附到最近的那条
      // **外扩边**上 —— 这里就是矩形左边缘外一个 binding gap，元素原点随它一起走
      const gap = BASE_BINDING_GAP + rect.strokeWidth / 2;
      expect(arrow.x).toBe(rect.x - gap);
      expect(arrow.y).toBe(110);

      // Should bind to the rectangle since endpoint is inside
      expect(arrow.startBinding?.elementId).toBe(rect.id);
      expect(arrow.endBinding?.elementId).toBe(rect.id);

      // 两端都不留在图形内部：`attachPoint` 就是端点本身，落点悬在轮廓外一个 gap，
      // 所以归一化比例会略微超出 0..1（不再按 0..1 夹取）。断言的是几何。
      for (const binding of [arrow.startBinding, arrow.endBinding]) {
        const point = getGlobalAttachPointForBindableElement(
          binding!.attachPoint,
          rect as ExcalidrawBindableElement,
          h.app.scene.getNonDeletedElementsMap(),
        );
        expect(
          isPointInElement(point, rect, h.app.scene.getNonDeletedElementsMap()),
        ).toBe(false);
        expect(
          distanceToElement(
            rect,
            h.app.scene.getNonDeletedElementsMap(),
            point,
          ),
        ).toBeCloseTo(gap, 0);
      }

      // Move the bindable
      mouse.downAt(100, 150);
      mouse.moveTo(280, 110);
      mouse.up();

      // Check if the arrow moved (起点仍贴在左边缘外一个 gap 处)
      expect(arrow.x).toBe(rect.x - gap);
      expect(arrow.y).toBe(70);

      // Restore bindable. Grab the rect's interior (not its left-edge midpoint)
      // so this stays a translation — the selection border's side handles now
      // sit on the border line, so an edge-midpoint grab would resize instead.
      mouse.reset();
      mouse.downAt(350, 130);
      mouse.moveTo(200, 130);
      mouse.up();

      // Move the start point of the arrow to check if
      // the behavior remains the same for old arrows
      mouse.reset();
      mouse.downAt(110, 110);
      mouse.moveTo(120, 120);
      mouse.up();

      // Move the bindable again
      mouse.reset();
      mouse.downAt(130, 110);
      mouse.moveTo(280, 110);
      mouse.up();

      // Check if the arrow moved
      expect(arrow.x).toBe(rect.x - gap);
      expect(arrow.y).toBe(70);
    });

    it("3+ point arrow should be dragged along with the bindable", () => {
      // Create two rectangles as binding targets
      const rectLeft = API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      const rectRight = API.createElement({
        type: "rectangle",
        x: 300,
        y: 0,
        width: 100,
        height: 100,
      });

      // Create a non-elbowed arrow with inner points bound to different elements
      const arrow = API.createElement({
        type: "arrow",
        x: 100,
        y: 50,
        width: 200,
        height: 0,
        points: [
          pointFrom(0, 0), // start point
          pointFrom(50, -20), // first inner point
          pointFrom(150, 20), // second inner point
          pointFrom(200, 0), // end point
        ],
        startBinding: {
          elementId: rectLeft.id,
          attachPoint: [0.5, 0.5],
        },
        endBinding: {
          elementId: rectRight.id,
          attachPoint: [0.5, 0.5],
        },
      });

      API.setElements([rectLeft, rectRight, arrow]);

      // Store original inner point positions
      const originalInnerPoint1 = [...arrow.points[1]];
      const originalInnerPoint2 = [...arrow.points[2]];

      // Move the right rectangle down by 50 pixels
      mouse.reset();
      mouse.downAt(350, 50); // Click on the right rectangle
      mouse.moveTo(350, 100); // Move it down
      mouse.up();

      // Verify that inner points did NOT move when bound to different elements
      // The arrow should NOT translate inner points proportionally when only one end moves
      expect(arrow.points[1][0]).toBe(originalInnerPoint1[0]);
      expect(arrow.points[1][1]).toBe(originalInnerPoint1[1]);
      expect(arrow.points[2][0]).toBe(originalInnerPoint2[0]);
      expect(arrow.points[2][1]).toBe(originalInnerPoint2[1]);
    });
  });

  describe("self-binding (both ends to the same element) single-click finalize", () => {
    // rect spans x:200..400, y:200..400; the two "outside" points below sit just
    // outside its left/right edges (inside the binding distance)
    const INSIDE: [number, number] = [250, 250];
    const OUTSIDE_LEFT: [number, number] = [187, 300];
    const OUTSIDE_RIGHT: [number, number] = [413, 300];
    const MIDDLE: [number, number] = [550, 100];

    beforeEach(async () => {
      mouse.reset();
      await act(() => setLanguage(defaultLang));
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      UI.createElement("rectangle", {
        x: 200,
        y: 200,
        width: 200,
        height: 200,
      });
    });

    const drawSelfArrow = (start: [number, number], end: [number, number]) => {
      UI.clickTool("arrow");
      mouse.reset();
      mouse.clickAt(...start);
      mouse.moveTo(...MIDDLE);
      mouse.clickAt(...MIDDLE); // commit a middle point so it's a multi-point arrow
      mouse.moveTo(...end);
      mouse.clickAt(...end); // single click at the end
    };

    it("outside -> outside finalizes on a single click", () => {
      drawSelfArrow(OUTSIDE_LEFT, OUTSIDE_RIGHT);

      const arrow = h.elements[h.elements.length - 1] as ExcalidrawArrowElement;
      expect(h.state.multiElement).toBe(null);
      expect(h.state.activeTool.type).toBe("selection");
      expect(arrow.startBinding?.elementId).toBe(arrow.endBinding?.elementId);
      expect(arrow.endBinding?.elementId).not.toBe(undefined);
    });

    it("inside -> outside finalizes on a single click", () => {
      drawSelfArrow(INSIDE, OUTSIDE_RIGHT);

      const arrow = h.elements[h.elements.length - 1] as ExcalidrawArrowElement;
      expect(h.state.multiElement).toBe(null);
      expect(h.state.activeTool.type).toBe("selection");
      expect(arrow.startBinding?.elementId).toBe(arrow.endBinding?.elementId);
      expect(arrow.endBinding?.elementId).not.toBe(undefined);
    });

    it("inside -> inside stays in multi-point mode (no single-click finalize)", () => {
      drawSelfArrow(INSIDE, [INSIDE[0] + 50, INSIDE[1] + 50]); // end dropped inside the rect

      // ambiguous → must be confirmed with a second click, so still in progress
      expect(h.state.multiElement).not.toBe(null);
      expect(h.state.activeTool.type).toBe("arrow");
    });
  });

  describe("when arrow is outside of shape", () => {
    beforeEach(async () => {
      mouse.reset();

      await act(() => {
        return setLanguage(defaultLang);
      });
      await render(<Excalidraw handleKeyboardGlobally={true} />);
    });

    it("should handle new arrow start point binding", () => {
      // Create a rectangle
      UI.clickTool("rectangle");
      mouse.downAt(100, 100);
      mouse.moveTo(200, 200);
      mouse.up();

      const rectangle = API.getSelectedElement();

      // Create arrow with arrow tool
      UI.clickTool("arrow");
      mouse.downAt(205, 150); // Start close to rectangle
      mouse.moveTo(250, 150); // End outside
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawLinearElement;

      // Arrow should have start binding to rectangle
      expect(arrow.startBinding?.elementId).toBe(rectangle.id);
      expect(arrow.endBinding).toBeNull();
    });

    it("should handle new arrow end point binding", () => {
      // Create a rectangle
      UI.clickTool("rectangle");
      mouse.downAt(100, 100);
      mouse.moveTo(200, 200);
      mouse.up();

      const rectangle = API.getSelectedElement();

      // Create arrow with end point in binding zone
      UI.clickTool("arrow");
      mouse.downAt(50, 150); // Start outside
      mouse.moveTo(95, 95); // End near rectangle edge (should bind to it)
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawLinearElement;

      // Arrow should have end binding to rectangle
      expect(arrow.endBinding?.elementId).toBe(rectangle.id);
      expect(arrow.startBinding).toBeNull();
    });

    it.skip("should create a binding when one of the cursors is inside the rectangle", () => {
      // Create a filled solid rectangle
      UI.clickTool("rectangle");
      mouse.downAt(100, 100);
      mouse.moveTo(200, 200);
      mouse.up();

      const rect = API.getSelectedElement();
      API.updateElement(rect, {
        fillStyle: "solid",
        backgroundColor: "#a5d8ff",
      });

      // Draw arrow with endpoint inside the filled rectangle, since only
      // filled bindables bind inside the shape
      UI.clickTool("arrow");
      mouse.downAt(10, 10);
      mouse.moveTo(160, 160);
      mouse.up();

      const arrow = API.getSelectedElement() as ExcalidrawLinearElement;
      expect(arrow.x).toBe(10);
      expect(arrow.y).toBe(10);
      expect(arrow.width).toBeCloseTo(85.75985931287957);
      expect(arrow.height).toBeCloseTo(85.75985931288186);

      // Should bind to the rectangle since endpoint is inside
      expect(arrow.startBinding).toBe(null);
      expect(arrow.endBinding?.elementId).toBe(rect.id);

      const endBinding = arrow.endBinding as ElementBinding;
      expect(endBinding.attachPoint[0]).toBeGreaterThanOrEqual(0);
      expect(endBinding.attachPoint[0]).toBeLessThanOrEqual(1);
      expect(endBinding.attachPoint[1]).toBeGreaterThanOrEqual(0);
      expect(endBinding.attachPoint[1]).toBeLessThanOrEqual(1);

      mouse.reset();

      // Move the bindable
      mouse.downAt(130, 110);
      mouse.moveTo(280, 110);
      mouse.up();

      // Check if the arrow moved
      expect(arrow.x).toBe(10);
      expect(arrow.y).toBe(10);
      expect(arrow.width).toBeCloseTo(234);
      expect(arrow.height).toBeCloseTo(117);

      // Restore bindable
      mouse.reset();
      mouse.downAt(280, 110);
      mouse.moveTo(130, 110);
      mouse.up();

      // Move the arrow out
      mouse.reset();
      mouse.click(10, 10);
      mouse.downAt(96.466, 96.466);
      mouse.moveTo(50, 50);
      mouse.up();

      expect(arrow.startBinding).toBe(null);
      expect(arrow.endBinding).toBe(null);

      // Re-bind the arrow by moving the cursor inside the rectangle
      mouse.reset();
      mouse.downAt(50, 50);
      mouse.moveTo(150, 150);
      mouse.up();

      // Check if the arrow is still on the outside
      expect(arrow.width).toBeCloseTo(86, 0);
      expect(arrow.height).toBeCloseTo(86, 0);
    });
  });

  describe("additional binding behavior", () => {
    beforeEach(async () => {
      mouse.reset();

      await act(() => {
        return setLanguage(defaultLang);
      });
      await render(<Excalidraw handleKeyboardGlobally={true} />);
    });

    it(
      "editing arrow and moving its head to bind it to element A, finalizing the" +
        "editing by clicking on element A should end up selecting A",
      async () => {
        UI.createElement("rectangle", {
          y: 0,
          size: 100,
        });
        // Create arrow bound to rectangle
        UI.clickTool("arrow");
        mouse.down(50, -100);
        mouse.up(0, 80);

        // Edit arrow
        Keyboard.withModifierKeys({ ctrl: true }, () => {
          Keyboard.keyPress(KEYS.ENTER);
        });

        // move arrow head
        mouse.down();
        mouse.up(0, 10);
        expect(API.getSelectedElement().type).toBe("arrow");

        expect(h.state.selectedLinearElement?.isEditing).toBe(true);
        mouse.reset();
        mouse.clickAt(-50, -50);
        expect(h.state.selectedLinearElement?.isEditing).toBe(false);
        expect(API.getSelectedElement().type).toBe("arrow");

        // Edit arrow
        Keyboard.withModifierKeys({ ctrl: true }, () => {
          Keyboard.keyPress(KEYS.ENTER);
        });
        expect(h.state.selectedLinearElement?.isEditing).toBe(true);
        mouse.reset();
        mouse.clickAt(0, 0);
        expect(h.state.selectedLinearElement).toBeNull();
        expect(isCompositeShapeId(API.getSelectedElement(), "rectangle")).toBe(
          true,
        );
      },
    );

    it("should unbind on bound element deletion", () => {
      const rectangle = UI.createElement("rectangle", {
        x: 60,
        y: 0,
        size: 100,
      });

      const arrow = UI.createElement("arrow", {
        x: 0,
        y: 5,
        size: 70,
      });

      expect(arrow.endBinding?.elementId).toBe(rectangle.id);

      mouse.select(rectangle);
      expect(isCompositeShapeId(API.getSelectedElement(), "rectangle")).toBe(
        true,
      );
      Keyboard.keyDown(KEYS.DELETE);
      expect(arrow.endBinding).toBe(null);
    });

    it("should unbind arrow when arrow is resized", () => {
      const rectLeft = UI.createElement("rectangle", {
        x: 0,
        width: 200,
        height: 500,
      });
      const rectRight = UI.createElement("rectangle", {
        x: 400,
        width: 200,
        height: 500,
      });
      UI.clickTool("arrow");
      mouse.reset();
      mouse.clickAt(190, 250);
      mouse.moveTo(220, 200);
      mouse.moveTo(300, 200);
      mouse.clickAt(300, 200);
      mouse.moveTo(340, 251);
      mouse.moveTo(410, 251);
      mouse.clickAt(410, 251);
      mouse.clickAt(410, 251);
      const arrow = h.elements[h.elements.length - 1] as any;

      expect(arrow.startBinding?.elementId).toBe(rectLeft.id);
      expect(arrow.endBinding?.elementId).toBe(rectRight.id);

      // Drag arrow off of bound rectangle range.
      //
      // 连接线（含已绑定的箭头）不再有变换手柄，这里改为直接走手柄拖拽落地的
      // 那条入口（`transformElements` 就是 maybeHandleResize 每帧调的函数），
      // 落点沿用原用例的指针终点。
      const [ax1, ay1, ax2, ay2] = getElementAbsoluteCoords(
        arrow,
        arrayToMap(h.elements),
      );
      act(() => {
        transformElements(
          new Map([[arrow.id, { ...arrow }]]),
          "se",
          [arrow],
          h.app.scene,
          false,
          false,
          false,
          300,
          400,
          (ax1 + ax2) / 2,
          (ay1 + ay2) / 2,
        );
      });

      expect(arrow.startBinding).toBe(null);
      expect(arrow.endBinding).toBe(null);
    });

    it("should unbind arrow when arrow is rotated", () => {
      const rectLeft = UI.createElement("rectangle", {
        x: 0,
        width: 200,
        height: 500,
      });
      const rectRight = UI.createElement("rectangle", {
        x: 400,
        width: 200,
        height: 500,
      });

      UI.clickTool("arrow");
      mouse.reset();
      mouse.clickAt(190, 250);
      mouse.moveTo(220, 200);
      mouse.moveTo(300, 200);
      mouse.clickAt(300, 200);
      mouse.moveTo(350, 251);
      mouse.moveTo(410, 251);
      mouse.clickAt(410, 251);
      mouse.clickAt(410, 251);

      const arrow = API.getSelectedElement() as ExcalidrawArrowElement;

      expect(arrow.startBinding?.elementId).toBe(rectLeft.id);
      expect(arrow.endBinding?.elementId).toBe(rectRight.id);

      // Rotation is computed as the angular delta swept from the drag origin
      // around the element's center. Rotating the handle to the point
      // diametrically opposite its start (its reflection through the center)
      // sweeps exactly half a turn, flipping the arrow and unbinding it.
      // 连接线没有旋转手柄了，这里直接调用手柄拖拽落地的同一个入口。
      const [ax1, ay1, ax2, ay2] = getElementAbsoluteCoords(
        arrow,
        arrayToMap(h.elements),
      );
      const centerX = (ax1 + ax2) / 2;
      const centerY = (ay1 + ay2) / 2;
      const rotationHandleX = ax2;
      const rotationHandleY = ay2;
      act(() => {
        transformElements(
          // 按下瞬间的原元素快照，与 PointerDownState.originalElements 同形
          new Map([
            [arrow.id, { ...arrow } as NonDeleted<ExcalidrawArrowElement>],
          ]),
          "rotation",
          [arrow as NonDeletedExcalidrawElement],
          h.app.scene,
          false,
          false,
          false,
          2 * centerX - rotationHandleX,
          2 * centerY - rotationHandleY,
          centerX,
          centerY,
          { x: rotationHandleX, y: rotationHandleY },
        );
      });
      expect(arrow.angle).toBeGreaterThan(0.7 * Math.PI);
      expect(arrow.angle).toBeLessThan(1.3 * Math.PI);
      expect(arrow.startBinding).toBeNull();
      expect(arrow.endBinding).toBeNull();
    });

    it("should not unbind when duplicating via selection group", () => {
      const rectLeft = UI.createElement("rectangle", {
        x: 0,
        width: 200,
        height: 500,
      });
      const rectRight = UI.createElement("rectangle", {
        x: 400,
        y: 200,
        width: 200,
        height: 500,
      });
      const arrow = UI.createElement("arrow", {
        x: 190,
        y: 250,
        width: 217,
        height: 1,
      });
      expect(arrow.startBinding?.elementId).toBe(rectLeft.id);
      expect(arrow.endBinding?.elementId).toBe(rectRight.id);

      mouse.downAt(-100, -100);
      mouse.moveTo(0, 0);
      mouse.moveTo(650, 750);
      mouse.up(0, 0);

      expect(API.getSelectedElements().length).toBe(3);

      mouse.moveTo(5, 5);
      Keyboard.withModifierKeys({ alt: true }, () => {
        mouse.downAt(5, 5);
        mouse.moveTo(1000, 1000);
        mouse.up(0, 0);

        expect(window.h.elements.length).toBe(6);
        window.h.elements.forEach((element) => {
          if (isLinearElement(element)) {
            expect(element.startBinding).not.toBe(null);
            expect(element.endBinding).not.toBe(null);
          } else {
            expect(element.boundElements).not.toBe(null);
          }
        });
      });
    });
  });

  describe("to text elements", () => {
    beforeEach(async () => {
      mouse.reset();

      await act(() => {
        return setLanguage(defaultLang);
      });
      await render(<Excalidraw handleKeyboardGlobally={true} />);
    });

    it("should update binding when text containerized", async () => {
      const rectangle1 = API.createElement({
        type: "rectangle",
        id: "rectangle1",
        width: 100,
        height: 100,
        boundElements: [
          { id: "arrow1", type: "arrow" },
          { id: "arrow2", type: "arrow" },
        ],
      });

      const arrow1 = API.createElement({
        type: "arrow",
        id: "arrow1",
        points: [pointFrom(0, 0), pointFrom(0, -87.45777932247563)],
        startBinding: {
          elementId: "rectangle1",
          attachPoint: [0.5, 1],
        },
        endBinding: {
          elementId: "text1",
          attachPoint: [1, 0.5],
        },
      });

      const arrow2 = API.createElement({
        type: "arrow",
        id: "arrow2",
        points: [pointFrom(0, 0), pointFrom(0, -87.45777932247563)],
        startBinding: {
          elementId: "text1",
          attachPoint: [0.5, 1],
        },
        endBinding: {
          elementId: "rectangle1",
          attachPoint: [1, 0.5],
        },
      });

      const text1 = API.createElement({
        type: "text",
        id: "text1",
        text: "ola",
        boundElements: [
          { id: "arrow1", type: "arrow" },
          { id: "arrow2", type: "arrow" },
        ],
      });

      API.setElements([rectangle1, arrow1, arrow2, text1]);

      API.setSelectedElements([text1]);

      expect(h.state.selectedElementIds[text1.id]).toBe(true);

      API.executeAction(actionWrapTextInContainer);

      // new text container will be placed before the text element
      const container = h.elements.at(-2)!;

      expect(isCompositeShapeId(container, "rectangle")).toBe(true);
      expect(container.id).not.toBe(rectangle1.id);

      expect(container).toEqual(
        expect.objectContaining({
          boundElements: expect.arrayContaining([
            {
              type: "text",
              id: text1.id,
            },
            {
              type: "arrow",
              id: arrow1.id,
            },
            {
              type: "arrow",
              id: arrow2.id,
            },
          ]),
        }),
      );

      expect(arrow1.startBinding?.elementId).toBe(rectangle1.id);
      expect(arrow1.endBinding?.elementId).toBe(container.id);
      expect(arrow2.startBinding?.elementId).toBe(container.id);
      expect(arrow2.endBinding?.elementId).toBe(rectangle1.id);
    });

    it("should keep binding on text update", async () => {
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: 60,
        y: 0,
        width: 100,
        height: 100,
      });

      API.setElements([text]);

      const arrow = UI.createElement("arrow", {
        x: 0,
        y: 0,
        size: 65,
      });

      expect(arrow.endBinding?.elementId).toBe(text.id);

      // delete text element by submitting empty text
      // -------------------------------------------------------------------------

      UI.clickTool("text");

      mouse.clickAt(text.x + 50, text.y + 50);
      const editor = await getTextEditor();

      expect(editor).not.toBe(null);

      fireEvent.change(editor, { target: { value: "asdasdasdasdas" } });
      fireEvent.keyDown(editor, { key: KEYS.ESCAPE });

      expect(document.querySelector(TEXT_EDITOR_SELECTOR)).toBe(null);
      expect(arrow.endBinding?.elementId).toBe(text.id);
    });

    it("should unbind on text element deletion by submitting empty text", async () => {
      const text = API.createElement({
        type: "text",
        text: "¡olá!",
        x: 60,
        y: 0,
        width: 100,
        height: 100,
      });

      API.setElements([text]);

      const arrow = UI.createElement("arrow", {
        x: 0,
        y: 0,
        size: 65,
      });

      expect(arrow.endBinding?.elementId).toBe(text.id);

      // edit text element and submit
      // -------------------------------------------------------------------------

      UI.clickTool("text");

      mouse.clickAt(text.x + 50, text.y + 50);

      const editor = await getTextEditor();

      fireEvent.change(editor, { target: { value: "" } });
      fireEvent.keyDown(editor, { key: KEYS.ESCAPE });

      expect(document.querySelector(TEXT_EDITOR_SELECTOR)).toBe(null);
      expect(arrow.endBinding).toBe(null);
    });

    /**
     * 折线档走的是另一条投影（`bindPointToSnapToElementOutline` 求「轮廓交点」）：
     * 主射线拿不到交点时还有**兜底那一趟**求交，两处的 gap 都曾用 `getBindingGap` ——
     * 于是同一个手势在折线档上会把端点顶到文本外一个 gap（默认 6px）。
     *
     * 落点选在文本**上方外侧**：比 `text.y - height / 2` 还高时 heading 落到 LEFT，
     * 主射线是一条够不着文本的水平线，真正定落点的是兜底那一趟（x 刻意错开 text.x：
     * 与左边线同平面时射线会与轮廓共线，是另一档几何，见 `binding.ts` 中
     * `bindPointToSnapToElementOutline` 末尾的「轴对齐相切」说明）。
     *
     * 侧向落点（主求交那一趟）由 `arrowEndpointTextBinding.test.tsx` 里的 UI 用例覆盖。
     */
    it("keeps an elbow endpoint on the text's edge when the first ray misses the outline", () => {
      const text = API.createElement({
        type: "text",
        x: 200,
        y: 100,
        width: 120,
        height: 25,
        text: "label",
      }) as NonDeleted<ExcalidrawBindableElement>;
      // 端点落在文本左上角外侧：(205, 85) —— 比文本顶边高 15px（仍在建连距离内）
      const arrow = API.createElement({
        type: "arrow",
        elbowed: true,
        x: 100,
        y: 300,
        width: 105,
        height: -215,
        points: [pointFrom(0, 0), pointFrom(105, -215)],
      }) as NonDeleted<ExcalidrawArrowElement>;
      API.setElements([text, arrow]);

      act(() => {
        bindBindingElement(arrow, text, "end", h.scene);
      });

      const binding = arrow.endBinding as ElementBinding;
      expect(binding.elementId).toBe(text.id);

      const elementsMap = h.app.scene.getNonDeletedElementsMap();
      const endpoint = getGlobalAttachPointForBindableElement(
        binding.attachPoint,
        text,
        elementsMap,
      );
      // 端点在文本边界上（文本目标不留 gap），而且落在那条顶边上
      expect(distanceToElement(text, elementsMap, endpoint)).toBeCloseTo(0, 1);
      expect(endpoint[1]).toBeCloseTo(text.y, 1);
    });

    // 落点落在矩形类目标的**角区**时，投影先经过 `avoidRectangularCorner` 把它从
    // 角点外挪开；那一处的 gap 同样是「端点落在哪」的口径 —— 文本目标要落在文本的
    // 角上，而不是角外一个 gap（改前是 6px）。
    it("keeps an elbow endpoint on the text's corner when it lands in the corner zone", () => {
      const text = API.createElement({
        type: "text",
        x: 200,
        y: 100,
        width: 120,
        height: 25,
        text: "label",
      }) as NonDeleted<ExcalidrawBindableElement>;
      // (194, 97)：在文本左上角外侧 6px 内，正落在角区（x < text.x 且 y 贴近顶边）
      const arrow = API.createElement({
        type: "arrow",
        elbowed: true,
        x: 100,
        y: 300,
        width: 94,
        height: -203,
        points: [pointFrom(0, 0), pointFrom(94, -203)],
      }) as NonDeleted<ExcalidrawArrowElement>;
      API.setElements([text, arrow]);

      act(() => {
        bindBindingElement(arrow, text, "end", h.scene);
      });

      const binding = arrow.endBinding as ElementBinding;
      const elementsMap = h.app.scene.getNonDeletedElementsMap();
      const endpoint = getGlobalAttachPointForBindableElement(
        binding.attachPoint,
        text,
        elementsMap,
      );

      expect(binding.elementId).toBe(text.id);
      expect(distanceToElement(text, elementsMap, endpoint)).toBeCloseTo(0, 1);
      // 顶上那个角，不是角外一个 gap
      expect(endpoint[0]).toBeCloseTo(text.x, 1);
      expect(endpoint[1]).toBeCloseTo(text.y, 1);
    });
  });
});

describe("binding to a point-like (sub-pixel) element", () => {
  beforeEach(async () => {
    mouse.reset();
    await act(() => setLanguage(defaultLang));
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  // Regression: binding to a zero/near-zero-size element used to yield an
  // enormous attachPoint ratio (offset / ~0), which exploded into an arrow
  // hundreds of thousands of px wide once the element was resized to a normal
  // size
  it.each([
    ["simple", false],
    ["elbow", true],
  ])(
    "%s arrow binds to the center and stays put when the element grows",
    (_label, elbowed) => {
      const rect = API.createElement({
        type: "rectangle",
        x: 200,
        y: 50,
        width: 0.00005,
        height: 0.00005,
      }) as NonDeleted<ExcalidrawBindableElement>;
      const arrow = API.createElement({
        type: "arrow",
        elbowed,
        x: 0,
        y: 50,
        width: 195,
        height: 0,
        points: [pointFrom(0, 0), pointFrom(195, 0)],
      }) as NonDeleted<ExcalidrawArrowElement>;
      API.setElements([rect, arrow]);

      act(() => {
        bindBindingElement(arrow, rect, "end", h.scene);
      });

      const endBinding = arrow.endBinding as ElementBinding;
      expect(endBinding.elementId).toBe(rect.id);
      // Point-like element => bind to center (0.5 is normalized to 0.5001)
      expect(endBinding.attachPoint[0]).toBeCloseTo(0.5001);
      expect(endBinding.attachPoint[1]).toBeCloseTo(0.5001);

      // Grow the element to a normal size and let bound arrows follow
      act(() => {
        h.scene.mutateElement(rect, { width: 300, height: 200 });
        updateBoundElements(rect, h.scene);
      });

      // The arrow endpoint must track the element (its center), not fly off
      expect(Math.abs(arrow.width)).toBeLessThan(1000);
      expect(Math.abs(arrow.height)).toBeLessThan(1000);
    },
  );
});
