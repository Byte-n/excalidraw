import { pointCenter, pointFrom } from "@excalidraw/math";
import { act, queryByText } from "@testing-library/react";
import rough from "roughjs/bin/rough";
import { vi } from "vitest";

import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  ROUNDNESS,
  KEYS,
  getLineHeight,
  reseed,
  arrayToMap,
} from "@excalidraw/common";

import { getCurvePathOps } from "@excalidraw/utils/shape";
import { Excalidraw } from "@excalidraw/excalidraw";
import * as InteractiveCanvas from "@excalidraw/excalidraw/renderer/interactiveScene";
import * as StaticScene from "@excalidraw/excalidraw/renderer/staticScene";
import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";

import {
  Keyboard,
  Pointer,
  UI,
} from "@excalidraw/excalidraw/_tests_/helpers/ui";
import {
  render,
  fireEvent,
  GlobalTestState,
  unmountComponent,
} from "@excalidraw/excalidraw/_tests_/test-utils";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import { hasBoundingBox } from "../src";
import { LinearElementEditor } from "../src";
import { newArrowElement } from "../src";
import { isCurvedArrow } from "../src/typeChecks";
import { getTextBlock } from "../src/text/ops";
import {
  distanceToElement,
  generateRoughOptions,
  getCurvedConnectorPath,
  getElementBounds,
  getMinMaxXYFromCurvePathOps,
} from "../src";

import {
  getTextEditor,
  TEXT_EDITOR_SELECTOR,
} from "../../excalidraw/_tests_/queries/dom";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "../src/types";

const renderInteractiveScene = vi.spyOn(
  InteractiveCanvas,
  "renderInteractiveScene",
);
const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");

const { h } = window;

describe("Test Linear Elements", () => {
  let container: HTMLElement;
  let interactiveCanvas: HTMLCanvasElement;

  beforeEach(async () => {
    unmountComponent();
    localStorage.clear();
    renderInteractiveScene.mockClear();
    renderStaticScene.mockClear();
    reseed(7);
    const comp = await render(<Excalidraw handleKeyboardGlobally={true} />);
    h.state.width = 1000;
    h.state.height = 1000;
    container = comp.container;
    interactiveCanvas = container.querySelector("canvas.interactive")!;
  });

  const p1 = pointFrom<GlobalPoint>(20, 20);
  const p2 = pointFrom<GlobalPoint>(60, 20);
  const midpoint = pointCenter<GlobalPoint>(p1, p2);
  const delta = 50;
  const mouse = new Pointer("mouse");

  const createTwoPointerLinearElement = (
    type: ExcalidrawLinearElement["type"],
    roundness: ExcalidrawElement["roundness"] = null,
  ) => {
    const line = API.createElement({
      x: p1[0],
      y: p1[1],
      width: p2[0] - p1[0],
      height: 0,
      type,
      points: [pointFrom(0, 0), pointFrom(p2[0] - p1[0], p2[1] - p1[1])],
      roundness,
    });
    API.setElements([line]);

    mouse.clickAt(p1[0], p1[1]);
    return line;
  };

  const createThreePointerLinearElement = (
    type: ExcalidrawLinearElement["type"],
    roundness: ExcalidrawElement["roundness"] = null,
  ) => {
    //dragging line from midpoint
    const p3 = [midpoint[0] + delta - p1[0], midpoint[1] + delta - p1[1]];
    const line = API.createElement({
      x: p1[0],
      y: p1[1],
      width: p3[0] - p1[0],
      height: 0,
      type,
      points: [
        pointFrom(0, 0),
        pointFrom(p3[0], p3[1]),
        pointFrom(p2[0] - p1[0], p2[1] - p1[1]),
      ],
      roundness,
    });
    h.app.scene.mutateElement(line, { points: line.points });
    API.setElements([line]);
    mouse.clickAt(p1[0], p1[1]);
    return line;
  };

  /**
   * 2 点曲线箭头：对角线两端、无绑定 ⇒ 端切线取弦的主轴（这里两轴打平取水平），
   * 于是是一条非退化的 S 曲线。判据只看「圆角 + 非折线」，没有额外字段。
   */
  const createCurvedConnector = (): NonDeleted<ExcalidrawArrowElement> => {
    const arrow = newArrowElement({
      type: "arrow",
      x: p1[0],
      y: p1[1],
      width: 40,
      height: 40,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(40, 40)],
      roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
    });
    API.setElements([arrow]);
    mouse.clickAt(p1[0], p1[1]);
    return arrow;
  };

  const dragSegmentMidpointOfCurvedConnector = (
    arrow: NonDeleted<ExcalidrawArrowElement>,
  ) => {
    const [midPoint] = LinearElementEditor.getEditorMidPoints(
      arrow,
      h.app.scene.getNonDeletedElementsMap(),
      h.state,
    );
    expect(midPoint).not.toBeNull();
    drag(
      midPoint!,
      pointFrom<GlobalPoint>(midPoint![0] + delta, midPoint![1] + delta),
    );
    return midPoint!;
  };

  const enterLineEditingMode = (
    line: ExcalidrawLinearElement,
    selectProgrammatically = false,
  ) => {
    if (selectProgrammatically) {
      API.setSelectedElements([line] as NonDeletedExcalidrawElement[]);
    } else {
      mouse.clickAt(p1[0], p1[1]);
    }
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.ENTER);
    });
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(line.id);
  };

  const drag = (startPoint: GlobalPoint, endPoint: GlobalPoint) => {
    fireEvent.pointerDown(interactiveCanvas, {
      clientX: startPoint[0],
      clientY: startPoint[1],
    });
    fireEvent.pointerMove(interactiveCanvas, {
      clientX: endPoint[0],
      clientY: endPoint[1],
    });
    fireEvent.pointerUp(interactiveCanvas, {
      clientX: endPoint[0],
      clientY: endPoint[1],
    });
  };

  const deletePoint = (point: GlobalPoint) => {
    fireEvent.pointerDown(interactiveCanvas, {
      clientX: point[0],
      clientY: point[1],
    });
    fireEvent.pointerUp(interactiveCanvas, {
      clientX: point[0],
      clientY: point[1],
    });
    Keyboard.keyPress(KEYS.DELETE);
  };

  it("should normalize the element points at creation", () => {
    const element = newArrowElement({
      type: "arrow",
      points: [pointFrom<LocalPoint>(0.5, 0), pointFrom<LocalPoint>(100, 100)],
      x: 0,
      y: 0,
    });
    expect(element.points).toEqual([
      pointFrom<LocalPoint>(0.5, 0),
      pointFrom<LocalPoint>(100, 100),
    ]);
    new LinearElementEditor(element, arrayToMap(h.elements));
    expect(element.points).toEqual([
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(99.5, 100),
    ]);
  });

  it("should not drag line and add midpoint until dragged beyond a threshold", () => {
    createTwoPointerLinearElement("line");
    const line = h.elements[0] as ExcalidrawLinearElement;
    const originalX = line.x;
    const originalY = line.y;
    expect(line.points.length).toEqual(2);

    mouse.clickAt(midpoint[0], midpoint[1]);
    drag(midpoint, pointFrom(midpoint[0] + 1, midpoint[1] + 1));

    expect(line.points.length).toEqual(2);

    expect(line.x).toBe(originalX);
    expect(line.y).toBe(originalY);
    expect(line.points.length).toEqual(2);

    drag(midpoint, pointFrom(midpoint[0] + delta, midpoint[1] + delta));
    expect(line.x).toBe(originalX);
    expect(line.y).toBe(originalY);
    expect(line.points.length).toEqual(3);
  });

  it("should allow dragging line from midpoint in 2 pointer lines outside editor", async () => {
    createTwoPointerLinearElement("line");
    const line = h.elements[0] as ExcalidrawLinearElement;

    expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(`6`);
    expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`6`);
    expect((h.elements[0] as ExcalidrawLinearElement).points.length).toEqual(2);

    // drag line from midpoint
    drag(midpoint, pointFrom(midpoint[0] + delta, midpoint[1] + delta));
    expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
      `11`,
    );
    expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`9`);
    expect(line.points.length).toEqual(3);
    expect(line.points).toMatchInlineSnapshot(`
      [
        [
          0,
          0,
        ],
        [
          70,
          50,
        ],
        [
          40,
          0,
        ],
      ]
    `);
  });

  it("should hide the bounding box while creating or dragging a point", () => {
    const line = createTwoPointerLinearElement("line");
    const editorInterface = {
      userAgent: { isMobileDevice: false },
    } as Parameters<typeof hasBoundingBox>[2];

    fireEvent.pointerDown(interactiveCanvas, {
      clientX: midpoint[0],
      clientY: midpoint[1],
    });
    fireEvent.pointerMove(interactiveCanvas, {
      clientX: midpoint[0] + delta,
      clientY: midpoint[1] + delta,
    });

    expect(line.points.length).toBe(3);
    expect(h.state.selectedLinearElement?.isDragging).toBe(true);
    expect(hasBoundingBox([line], h.state, editorInterface)).toBe(false);

    fireEvent.pointerUp(interactiveCanvas, {
      clientX: midpoint[0] + delta,
      clientY: midpoint[1] + delta,
    });

    const addedPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
      line,
      1,
      h.scene.getNonDeletedElementsMap(),
    );
    fireEvent.pointerDown(interactiveCanvas, {
      clientX: addedPoint[0],
      clientY: addedPoint[1],
    });
    fireEvent.pointerMove(interactiveCanvas, {
      clientX: addedPoint[0] + 1,
      clientY: addedPoint[1] + 1,
    });

    expect(h.state.selectedLinearElement?.isDragging).toBe(true);
    expect(hasBoundingBox([line], h.state, editorInterface)).toBe(false);

    fireEvent.pointerUp(interactiveCanvas, {
      clientX: addedPoint[0],
      clientY: addedPoint[1],
    });
  });

  it("should allow entering and exiting line editor via context menu", () => {
    createTwoPointerLinearElement("line");
    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: midpoint[0],
      clientY: midpoint[1],
    });
    UI.openContextMenuSubmenus();
    // Enter line editor
    const contextMenu = UI.queryContextMenu();
    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: midpoint[0],
      clientY: midpoint[1],
    });
    fireEvent.click(queryByText(contextMenu as HTMLElement, "Edit line")!);

    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(h.elements[0].id);
  });

  it("should enter line editor via enter (line)", () => {
    createTwoPointerLinearElement("line");
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    mouse.clickAt(midpoint[0], midpoint[1]);
    Keyboard.keyPress(KEYS.ENTER);
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(h.elements[0].id);
  });

  // ctrl+enter alias (to align with arrows)
  it("should enter line editor via ctrl+enter (line)", () => {
    createTwoPointerLinearElement("line");
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    mouse.clickAt(midpoint[0], midpoint[1]);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.ENTER);
    });
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(h.elements[0].id);
  });

  it("should enter line editor via ctrl+enter (arrow)", () => {
    createTwoPointerLinearElement("arrow");
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    mouse.clickAt(midpoint[0], midpoint[1]);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.ENTER);
    });
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(h.elements[0].id);
  });

  it("should enter line editor on ctrl+dblclick (simple arrow)", () => {
    createTwoPointerLinearElement("arrow");
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      mouse.doubleClick();
    });
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(h.elements[0].id);
  });

  it("should enter line editor on ctrl+dblclick (line)", () => {
    createTwoPointerLinearElement("line");
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      mouse.doubleClick();
    });
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(h.elements[0].id);
  });

  it("should enter line editor on dblclick (line)", () => {
    createTwoPointerLinearElement("line");
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    mouse.doubleClick();
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(h.elements[0].id);
  });

  it("should not enter line editor on dblclick (arrow)", async () => {
    createTwoPointerLinearElement("arrow");
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    mouse.doubleClickAt(midpoint[0], midpoint[1]);
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);
    await getTextEditor();
  });

  it.each([
    ["start", null],
    ["start", "triangle"],
    ["end", null],
    ["end", "triangle"],
  ] as const)(
    "should not toggle the %s arrowhead from %s on endpoint dblclick",
    async (side, arrowhead) => {
      const arrow = API.createElement({
        type: "arrow",
        x: p1[0],
        y: p1[1],
        width: p2[0] - p1[0],
        height: 0,
        points: [pointFrom(0, 0), pointFrom(p2[0] - p1[0], p2[1] - p1[1])],
        startArrowhead: side === "start" ? arrowhead : null,
        endArrowhead: side === "end" ? arrowhead : null,
      });
      API.setElements([arrow]);
      mouse.clickAt(midpoint[0], midpoint[1]);

      const endpoint = side === "start" ? p1 : p2;
      mouse.doubleClickAt(endpoint[0], endpoint[1]);

      const updatedArrow = h.elements[0] as ExcalidrawArrowElement;
      expect(
        side === "start"
          ? updatedArrow.startArrowhead
          : updatedArrow.endArrowhead,
      ).toBe(arrowhead);

      await getTextEditor();
    },
  );

  it("shouldn't create text element on double click in line editor (arrow)", async () => {
    createTwoPointerLinearElement("arrow");
    const arrow = h.elements[0] as ExcalidrawLinearElement;
    enterLineEditingMode(arrow);

    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(arrow.id);

    mouse.doubleClick();
    expect(h.state.selectedLinearElement?.isEditing).toBe(true);
    expect(h.state.selectedLinearElement?.elementId).toEqual(arrow.id);
    expect(h.elements.length).toEqual(1);

    expect(document.querySelector(TEXT_EDITOR_SELECTOR)).toBe(null);
  });

  describe("Inside editor", () => {
    it("should not drag line and add midpoint when dragged irrespective of threshold", () => {
      createTwoPointerLinearElement("line");
      const line = h.elements[0] as ExcalidrawLinearElement;
      const originalX = line.x;
      const originalY = line.y;
      enterLineEditingMode(line);

      expect(h.state.selectedLinearElement?.isEditing).toBe(true);
      expect(line.points.length).toEqual(2);

      mouse.clickAt(midpoint[0], midpoint[1]);
      expect(line.points.length).toEqual(2);

      drag(midpoint, pointFrom(midpoint[0] + 1, midpoint[1] + 1));
      expect(line.x).toBe(originalX);
      expect(line.y).toBe(originalY);
      expect(line.points.length).toEqual(3);
    });

    it("should allow dragging line from midpoint in 2 pointer lines", async () => {
      createTwoPointerLinearElement("line");

      const line = h.elements[0] as ExcalidrawLinearElement;
      enterLineEditingMode(line);

      // drag line from midpoint
      drag(midpoint, pointFrom(midpoint[0] + delta, midpoint[1] + delta));
      expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
        `15`,
      );
      expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`9`);

      expect(line.points.length).toEqual(3);
      expect(line.points).toMatchInlineSnapshot(`
        [
          [
            0,
            0,
          ],
          [
            70,
            50,
          ],
          [
            40,
            0,
          ],
        ]
      `);
    });

    it("should update the midpoints when element roundness changed", async () => {
      createThreePointerLinearElement("line");

      const line = h.elements[0] as ExcalidrawLinearElement;
      expect(line.points.length).toEqual(3);

      enterLineEditingMode(line);

      const midPointsWithSharpEdge = LinearElementEditor.getEditorMidPoints(
        line,
        h.app.scene.getNonDeletedElementsMap(),
        h.state,
      );

      // update roundness
      // 设计稿（工具栏改造 T2）：编辑节点模式下属性浮动栏整体替换为模式条，
      // 面板上的「Round」按钮不再可用，改为直接变更元素圆角
      act(() => {
        h.app.scene.mutateElement(h.elements[0], {
          roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
        });
      });

      expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
        `11`,
      );
      expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`7`);

      const midPointsWithRoundEdge = LinearElementEditor.getEditorMidPoints(
        h.elements[0] as ExcalidrawLinearElement,
        h.app.scene.getNonDeletedElementsMap(),
        h.state,
      );
      expect(midPointsWithRoundEdge[0]).not.toEqual(midPointsWithSharpEdge[0]);
      expect(midPointsWithRoundEdge[1]).not.toEqual(midPointsWithSharpEdge[1]);

      expect(midPointsWithRoundEdge).toMatchInlineSnapshot(`
        [
          [
            "54.27552",
            "46.16120",
          ],
          [
            "76.95494",
            "44.56052",
          ],
        ]
      `);
    });

    it("should update all the midpoints when element position changed", async () => {
      const elementsMap = arrayToMap(h.elements);

      createThreePointerLinearElement("line", {
        type: ROUNDNESS.PROPORTIONAL_RADIUS,
      });

      const line = h.elements[0] as ExcalidrawLinearElement;
      expect(line.points.length).toEqual(3);
      enterLineEditingMode(line);

      const points = LinearElementEditor.getPointsGlobalCoordinates(
        line,
        elementsMap,
      );
      expect([line.x, line.y]).toEqual(points[0]);

      const midPoints = LinearElementEditor.getEditorMidPoints(
        line,
        h.app.scene.getNonDeletedElementsMap(),
        h.state,
      );

      const startPoint = pointCenter(points[0], midPoints[0]!);
      const deltaX = 50;
      const deltaY = 20;
      const endPoint = pointFrom<GlobalPoint>(
        startPoint[0] + deltaX,
        startPoint[1] + deltaY,
      );

      // Move the element
      drag(startPoint, endPoint);

      expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
        `13`,
      );
      expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`8`);

      expect([line.x, line.y]).toEqual([
        points[0][0] + deltaX,
        points[0][1] + deltaY,
      ]);

      const newMidPoints = LinearElementEditor.getEditorMidPoints(
        line,
        h.app.scene.getNonDeletedElementsMap(),
        h.state,
      );
      expect(midPoints[0]).not.toEqual(newMidPoints[0]);
      expect(midPoints[1]).not.toEqual(newMidPoints[1]);
      expect(newMidPoints).toMatchInlineSnapshot(`
        [
          [
            "104.27552",
            "66.16120",
          ],
          [
            "126.95494",
            "64.56052",
          ],
        ]
      `);
    });

    describe("When edges are round", () => {
      // This is the expected midpoint for line with round edge
      // hence hardcoding it so if later some bug is introduced
      // this will fail and we can fix it
      const firstSegmentMidpoint = pointFrom<GlobalPoint>(55, 45);
      const lastSegmentMidpoint = pointFrom<GlobalPoint>(75, 40);

      let line: ExcalidrawLinearElement;

      beforeEach(() => {
        line = createThreePointerLinearElement("line");

        expect(line.points.length).toEqual(3);

        enterLineEditingMode(line);
      });

      it("should allow dragging lines from midpoints in between segments", async () => {
        // drag line via first segment midpoint
        drag(
          firstSegmentMidpoint,
          pointFrom(
            firstSegmentMidpoint[0] + delta,
            firstSegmentMidpoint[1] + delta,
          ),
        );
        expect(line.points.length).toEqual(4);

        // drag line from last segment midpoint
        drag(
          lastSegmentMidpoint,
          pointFrom(
            lastSegmentMidpoint[0] + delta,
            lastSegmentMidpoint[1] + delta,
          ),
        );

        expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
          `20`,
        );
        expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`12`);

        expect(line.points.length).toEqual(5);

        expect((h.elements[0] as ExcalidrawLinearElement).points)
          .toMatchInlineSnapshot(`
            [
              [
                0,
                0,
              ],
              [
                85,
                75,
              ],
              [
                70,
                50,
              ],
              [
                105,
                70,
              ],
              [
                40,
                0,
              ],
            ]
          `);
      });

      it("should update only the first segment midpoint when its point is dragged", async () => {
        const elementsMap = arrayToMap(h.elements);
        const points = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );
        const midPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );

        const hitCoords = pointFrom<GlobalPoint>(points[0][0], points[0][1]);

        // Drag from first point
        drag(hitCoords, pointFrom(hitCoords[0] - delta, hitCoords[1] - delta));

        expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
          `15`,
        );
        expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`9`);

        const newPoints = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );
        expect([newPoints[0][0], newPoints[0][1]]).toEqual([
          points[0][0] - delta,
          points[0][1] - delta,
        ]);

        const newMidPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );

        expect(midPoints[0]).not.toEqual(newMidPoints[0]);
        expect(midPoints[1]).toEqual(newMidPoints[1]);
      });

      it("should hide midpoints in the segment when points moved close", async () => {
        const elementsMap = arrayToMap(h.elements);
        const points = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );
        const midPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );

        const hitCoords = pointFrom<GlobalPoint>(points[0][0], points[0][1]);

        // Drag from first point
        drag(hitCoords, pointFrom(hitCoords[0] + delta, hitCoords[1] + delta));

        expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
          `15`,
        );
        expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`8`);

        const newPoints = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );
        expect([newPoints[0][0], newPoints[0][1]]).toEqual([
          points[0][0] + delta,
          points[0][1] + delta,
        ]);

        const newMidPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );
        // This midpoint is hidden since the points are too close
        expect(newMidPoints[0]).toBeNull();
        expect(midPoints[1]).toEqual(newMidPoints[1]);
      });

      it("should remove the midpoint when one of the points in the segment is deleted", async () => {
        const line = h.elements[0] as ExcalidrawLinearElement;
        // beforeEach 已进入编辑态；编辑节点模式下 Enter 现在会退出编辑
        // （设计稿模式条「完成」，Enter/Esc 同效），不再重复进入
        const points = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          arrayToMap(h.elements),
        );

        // dragging line from last segment midpoint
        drag(
          lastSegmentMidpoint,
          pointFrom(lastSegmentMidpoint[0] + 50, lastSegmentMidpoint[1] + 50),
        );
        expect(line.points.length).toEqual(4);

        const midPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );

        // delete 3rd point
        deletePoint(points[2]);
        expect(line.points.length).toEqual(3);
        expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
          `19`,
        );
        expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`11`);

        const newMidPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );
        expect(newMidPoints.length).toEqual(2);
        expect(midPoints[0]).toEqual(newMidPoints[0]);
        expect(midPoints[1]).toEqual(newMidPoints[1]);
      });
    });

    describe("When edges are round", () => {
      // This is the expected midpoint for line with round edge
      // hence hardcoding it so if later some bug is introduced
      // this will fail and we can fix it
      const firstSegmentMidpoint = pointFrom<GlobalPoint>(
        55.9697848965255,
        47.442326230998205,
      );
      const lastSegmentMidpoint = pointFrom<GlobalPoint>(
        76.08587175006699,
        43.294165939653226,
      );
      let line: ExcalidrawLinearElement;

      beforeEach(() => {
        line = createThreePointerLinearElement("line", {
          type: ROUNDNESS.PROPORTIONAL_RADIUS,
        });
        expect(line.points.length).toEqual(3);

        enterLineEditingMode(line);
      });

      it("should allow dragging lines from midpoints in between segments", async () => {
        // drag line from first segment midpoint
        drag(
          firstSegmentMidpoint,
          pointFrom(
            firstSegmentMidpoint[0] + delta,
            firstSegmentMidpoint[1] + delta,
          ),
        );
        expect(line.points.length).toEqual(4);

        // drag line from last segment midpoint
        drag(
          lastSegmentMidpoint,
          pointFrom(
            lastSegmentMidpoint[0] + delta,
            lastSegmentMidpoint[1] + delta,
          ),
        );
        expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
          `20`,
        );
        expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`12`);
        expect(line.points.length).toEqual(5);

        expect((h.elements[0] as ExcalidrawLinearElement).points)
          .toMatchInlineSnapshot(`
            [
              [
                0,
                0,
              ],
              [
                "85.96978",
                "77.44233",
              ],
              [
                70,
                50,
              ],
              [
                "106.08587",
                "73.29417",
              ],
              [
                40,
                0,
              ],
            ]
          `);
      });

      it("should update all the midpoints when its point is dragged", async () => {
        const elementsMap = arrayToMap(h.elements);
        const points = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );
        const midPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );

        const hitCoords = pointFrom<GlobalPoint>(points[0][0], points[0][1]);

        // Drag from first point
        drag(hitCoords, pointFrom(hitCoords[0] - delta, hitCoords[1] - delta));

        const newPoints = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );
        expect([newPoints[0][0], newPoints[0][1]]).toEqual([
          points[0][0] - delta,
          points[0][1] - delta,
        ]);

        const newMidPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );

        expect(midPoints[0]).not.toEqual(newMidPoints[0]);
        expect(midPoints[1]).not.toEqual(newMidPoints[1]);
        expect(newMidPoints).toMatchInlineSnapshot(`
          [
            [
              "29.28349",
              "20.91105",
            ],
            [
              "78.86048",
              "46.12277",
            ],
          ]
        `);
      });

      it("should hide midpoints in the segment when points moved close", async () => {
        const elementsMap = arrayToMap(h.elements);
        const points = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );
        const midPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );

        const hitCoords = pointFrom<GlobalPoint>(points[0][0], points[0][1]);

        // Drag from first point
        drag(hitCoords, pointFrom(hitCoords[0] + delta, hitCoords[1] + delta));

        expect(renderInteractiveScene.mock.calls.length).toMatchInlineSnapshot(
          `15`,
        );
        expect(renderStaticScene.mock.calls.length).toMatchInlineSnapshot(`8`);

        const newPoints = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );
        expect([newPoints[0][0], newPoints[0][1]]).toEqual([
          points[0][0] + delta,
          points[0][1] + delta,
        ]);

        const newMidPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );
        // This mid point is hidden due to point being too close
        expect(newMidPoints[0]).toBeNull();
        expect(newMidPoints[1]).not.toEqual(midPoints[1]);
      });

      it("should update all the midpoints when a point is deleted", async () => {
        const elementsMap = arrayToMap(h.elements);

        drag(
          lastSegmentMidpoint,
          pointFrom(
            lastSegmentMidpoint[0] + delta,
            lastSegmentMidpoint[1] + delta,
          ),
        );
        expect(line.points.length).toEqual(4);

        const midPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );
        const points = LinearElementEditor.getPointsGlobalCoordinates(
          line,
          elementsMap,
        );

        // delete 3rd point
        deletePoint(points[2]);
        expect(line.points.length).toEqual(3);

        const newMidPoints = LinearElementEditor.getEditorMidPoints(
          line,
          h.app.scene.getNonDeletedElementsMap(),
          h.state,
        );
        expect(newMidPoints.length).toEqual(2);
        expect(midPoints[0]).not.toEqual(newMidPoints[0]);
        expect(midPoints[1]).not.toEqual(newMidPoints[1]);
        expect(newMidPoints).toMatchInlineSnapshot(`
          [
            [
              "54.27552",
              "46.16120",
            ],
            [
              "76.95494",
              "44.56052",
            ],
          ]
        `);
      });
    });

    it("in-editor dragging a line point covered by another element", () => {
      createTwoPointerLinearElement("line");
      const line = h.elements[0] as ExcalidrawLinearElement;
      API.setElements([
        line,
        API.createElement({
          type: "rectangle",
          x: line.x - 50,
          y: line.y - 50,
          width: 100,
          height: 100,
          backgroundColor: "red",
          fillStyle: "solid",
        }),
      ]);
      const dragEndPositionOffset = [100, 100] as const;
      API.setSelectedElements([line] as NonDeletedExcalidrawElement[]);
      enterLineEditingMode(line, true);
      drag(
        pointFrom(line.points[0][0] + line.x, line.points[0][1] + line.y),
        pointFrom(
          dragEndPositionOffset[0] + line.x,
          dragEndPositionOffset[1] + line.y,
        ),
      );
      expect(line.points).toMatchInlineSnapshot(`
        [
          [
            0,
            0,
          ],
          [
            -60,
            -100,
          ],
        ]
      `);
    });
  });

  describe("Test linear element label", () => {
    const DEFAULT_TEXT = "Online whiteboard collaboration made easy";
    const labelStyle = {
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
    };

    const withLabel = (
      element: ExcalidrawLinearElement,
      text = DEFAULT_TEXT,
      labelPosition = 0.5,
    ): ExcalidrawLinearElement => {
      const next = {
        ...element,
        texts: {
          label: {
            text,
            style: labelStyle,
            placement: { labelPosition },
          },
        },
      } as ExcalidrawLinearElement;
      API.setElements([next]);
      return next;
    };

    const getLabelLayout = (
      element: ExcalidrawLinearElement,
      elementsMap = arrayToMap(h.elements),
    ) => LinearElementEditor.getLabelSceneLayout(element, elementsMap);

    it("keeps the label in texts.label without creating a text element", async () => {
      createTwoPointerLinearElement("arrow");
      mouse.doubleClickAt(midpoint[0], midpoint[1]);
      const editor = await getTextEditor();
      fireEvent.input(editor, { target: { value: DEFAULT_TEXT } });
      act(() => editor.blur());

      expect(h.elements).toHaveLength(1);
      const arrow = h.elements[0] as ExcalidrawLinearElement;
      expect(arrow.texts?.label?.text).toBe(DEFAULT_TEXT);
      expect(arrow.texts?.label?.placement?.labelPosition).toBe(0.5);
      expect(arrow.boundElements ?? []).toHaveLength(0);
      expect(h.elements.filter((el) => el.type === "text")).toHaveLength(0);
    });

    it("creates and edits the label with Enter on a selected arrow", async () => {
      createTwoPointerLinearElement("arrow");
      Keyboard.keyPress(KEYS.ENTER);
      const editor = await getTextEditor();
      fireEvent.input(editor, { target: { value: DEFAULT_TEXT } });
      act(() => editor.blur());
      expect(h.elements).toHaveLength(1);
      expect(getTextBlock(h.elements[0].texts, "label")?.text).toBe(
        DEFAULT_TEXT,
      );
    });

    it("removes the label when submitted empty", async () => {
      const arrow = createTwoPointerLinearElement("arrow");
      withLabel(arrow, DEFAULT_TEXT);
      mouse.doubleClickAt(midpoint[0], midpoint[1]);
      const editor = await getTextEditor();
      fireEvent.input(editor, { target: { value: "   " } });
      act(() => editor.blur());
      expect(
        (h.elements[0] as ExcalidrawLinearElement).texts?.label,
      ).toBeUndefined();
    });

    it("places the label at the path anchor, keeping it horizontal", () => {
      const arrow = createTwoPointerLinearElement("arrow");
      const labeled = withLabel(arrow, DEFAULT_TEXT, 0.5);
      const layout = getLabelLayout(labeled);
      expect(layout.angle).toBe(0);
      expect(layout.x + layout.width / 2).toBeCloseTo(midpoint[0], 5);
      expect(layout.y + layout.height / 2).toBeCloseTo(midpoint[1], 5);
    });

    it("keeps a rotated arrow's label upright at the rotated anchor", () => {
      const arrow = API.createElement({
        type: "arrow",
        x: 20,
        y: 20,
        width: 40,
        height: 20,
        angle: Math.PI / 2,
        points: [pointFrom(0, 0), pointFrom(40, 20)],
      });
      API.setElements([arrow]);
      const labeled = withLabel(arrow, DEFAULT_TEXT, 0.25);
      const elementsMap = arrayToMap(h.elements);
      const layout = getLabelLayout(labeled, elementsMap);
      expect(layout.angle).toBe(0);
      const pathPoint = LinearElementEditor.getPointAtPathParameter(
        labeled,
        0.25,
        elementsMap,
      )!;
      expect(layout.x + layout.width / 2).toBeCloseTo(pathPoint[0], 5);
      expect(layout.y + layout.height / 2).toBeCloseTo(pathPoint[1], 5);
    });

    it("drags the label along the arrow and persists the new position", () => {
      const arrow = API.createElement({
        type: "arrow",
        x: p1[0],
        y: p1[1],
        width: p2[0] - p1[0],
        height: 0,
        points: [pointFrom(0, 0), pointFrom(p2[0] - p1[0], 0)],
      });
      API.setElements([arrow]);
      withLabel(arrow, "label\nlabel", 0.5);
      const beforeLayout = LinearElementEditor.getLabelSceneLayout(
        h.elements[0] as ExcalidrawLinearElement,
        arrayToMap(h.elements),
      );
      expect(beforeLayout.x + beforeLayout.width / 2).toBeCloseTo(
        midpoint[0],
        5,
      );
      mouse.reset();
      mouse.clickAt(p1[0], p1[1]);
      expect(h.state.selectedLinearElement?.elementId).toBe(arrow.id);
      act(() => {
        LinearElementEditor.handleLabelDragging(
          {
            elementId: arrow.id,
            pointerOffset: { x: 0, y: 0 },
          } as LinearElementEditor,
          h.app.scene,
          midpoint[0] + 10,
          midpoint[1],
        );
      });
      const labelPosition = (h.elements[0] as ExcalidrawLinearElement).texts
        ?.label?.placement?.labelPosition;
      expect(labelPosition).toBeCloseTo(0.75, 5);
      expect(
        (h.elements[0] as ExcalidrawLinearElement).texts?.label?.text,
      ).toBe("label\nlabel");
    });

    it("gives the segment midpoint handle precedence over the label", () => {
      const arrow = API.createElement({
        type: "arrow",
        x: p1[0],
        y: p1[1],
        width: p2[0] - p1[0],
        height: 0,
        points: [pointFrom(0, 0), pointFrom(p2[0] - p1[0], 0)],
      });
      API.setElements([arrow]);
      withLabel(arrow, "label", 0.5);
      mouse.reset();
      mouse.clickAt(p1[0], p1[1]);
      drag(midpoint, pointFrom<GlobalPoint>(midpoint[0], midpoint[1] + 40));
      expect((h.elements[0] as ExcalidrawLinearElement).points.length).toBe(3);
      expect(
        (h.elements[0] as ExcalidrawLinearElement).texts?.label?.placement
          ?.labelPosition,
      ).toBe(0.5);
    });
  });

  describe("Test moving linear element points", () => {
    it("should move the endpoint in the negative direction correctly when the start point is also moved in the positive direction", async () => {
      const line = createThreePointerLinearElement("arrow");
      const [origStartX, origStartY] = [line.x, line.y];

      act(() => {
        LinearElementEditor.movePoints(
          line,
          h.app.scene,
          new Map([
            [
              0,
              {
                point: pointFrom(
                  line.points[0][0] + 10,
                  line.points[0][1] + 10,
                ),
              },
            ],
            [
              line.points.length - 1,
              {
                point: pointFrom(
                  line.points[line.points.length - 1][0] - 10,
                  line.points[line.points.length - 1][1] - 10,
                ),
              },
            ],
          ]),
        );
      });
      expect(line.x).toBe(origStartX + 10);
      expect(line.y).toBe(origStartY + 10);

      expect(line.points[line.points.length - 1][0]).toBe(20);
      expect(line.points[line.points.length - 1][1]).toBe(-20);
    });

    it("should preserve original angle when dragging endpoint with SHIFT key", () => {
      createTwoPointerLinearElement("line");
      const line = h.elements[0] as ExcalidrawLinearElement;
      enterLineEditingMode(line);

      const elementsMap = arrayToMap(h.elements);
      const points = LinearElementEditor.getPointsGlobalCoordinates(
        line,
        elementsMap,
      );

      // Calculate original angle between first and last point
      const originalAngle = Math.atan2(
        points[1][1] - points[0][1],
        points[1][0] - points[0][0],
      );

      // Drag the second point (endpoint) with SHIFT key pressed
      const startPoint = pointFrom<GlobalPoint>(points[1][0], points[1][1]);
      const endPoint = pointFrom<GlobalPoint>(
        startPoint[0] + 4,
        startPoint[1] + 4,
      );

      // Perform drag with SHIFT key modifier
      Keyboard.withModifierKeys({ shift: true }, () => {
        mouse.downAt(startPoint[0], startPoint[1]);
        mouse.moveTo(endPoint[0], endPoint[1]);
        mouse.upAt(endPoint[0], endPoint[1]);
      });

      // Get updated points after drag
      const updatedPoints = LinearElementEditor.getPointsGlobalCoordinates(
        line,
        elementsMap,
      );

      // Calculate new angle
      const newAngle = Math.atan2(
        updatedPoints[1][1] - updatedPoints[0][1],
        updatedPoints[1][0] - updatedPoints[0][0],
      );

      // The angle should be preserved (within a small tolerance for floating point precision)
      const angleDifference = Math.abs(newAngle - originalAngle);
      const tolerance = 0.01; // Small tolerance for floating point precision

      expect(angleDifference).toBeLessThan(tolerance);
    });
  });

  it("should keep adding control points to a curved arrow outside the editor", () => {
    const arrow = createTwoPointerLinearElement("arrow", {
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
    });
    const elementsMap = h.app.scene.getNonDeletedElementsMap();

    drag(midpoint, pointFrom<GlobalPoint>(midpoint[0], midpoint[1] + delta));
    expect(arrow.points).toHaveLength(3);
    expect(h.state.selectedLinearElement?.isEditing).toBe(false);

    for (let pointCount = 3; pointCount < 5; pointCount++) {
      const midPoints = LinearElementEditor.getEditorMidPoints(
        arrow,
        elementsMap,
        h.state,
      );
      expect(midPoints).toHaveLength(pointCount - 1);
      const segmentMidpoint = midPoints[midPoints.length - 1]!;
      expect(segmentMidpoint).not.toBeNull();
      drag(
        segmentMidpoint,
        pointFrom<GlobalPoint>(segmentMidpoint[0], segmentMidpoint[1] + delta),
      );
      expect(arrow.points).toHaveLength(pointCount + 1);
    }
  });

  it("should place a curved connector's segment midpoint handle on the drawn curve", () => {
    const arrow = createCurvedConnector();
    const elementsMap = h.app.scene.getNonDeletedElementsMap();

    const midPoints = LinearElementEditor.getEditorMidPoints(
      arrow,
      elementsMap,
      h.state,
    );
    expect(midPoints).toHaveLength(1);
    const midPoint = midPoints[0];
    expect(midPoint).not.toBeNull();

    // 中点手柄必须落在画出来的同一条曲线上（碰撞形状与渲染同源）
    expect(
      distanceToElement(arrow, elementsMap, midPoint!),
    ).toBeLessThanOrEqual(1);
  });

  it("should add a control point when dragging a curved connector's segment midpoint", () => {
    const arrow = createCurvedConnector();

    dragSegmentMidpointOfCurvedConnector(arrow);

    expect(arrow.points).toHaveLength(3);
    // 判据不看点数：加了控制点依然是曲线
    expect(isCurvedArrow(arrow)).toBe(true);

    // 曲线经过新加的控制点
    const controlPoint = pointFrom<GlobalPoint>(
      arrow.x + arrow.points[1][0],
      arrow.y + arrow.points[1][1],
    );
    expect(
      distanceToElement(
        arrow,
        h.app.scene.getNonDeletedElementsMap(),
        controlPoint,
      ),
    ).toBeLessThanOrEqual(1);
  });

  it("should return a curved connector to the automatic curve when its only control point is deleted", () => {
    const arrow = createCurvedConnector();

    dragSegmentMidpointOfCurvedConnector(arrow);
    expect(arrow.points).toHaveLength(3);

    act(() => {
      LinearElementEditor.deletePoints(arrow, h.app, [1]);
    });

    expect(arrow.points).toHaveLength(2);
    // 判据不看点数：删光控制点后仍是曲线（回到自动态）
    expect(isCurvedArrow(arrow)).toBe(true);
  });

  it("should derive a curved connector's bounds from the same curve it renders", () => {
    const arrow = createCurvedConnector();
    const elementsMap = h.app.scene.getNonDeletedElementsMap();

    // 新对象身份 ⇒ ShapeCache / ElementBounds 缓存均未命中，强制走 bounds.ts
    // 的形状生成兜底分支（generateLinearElementShape）
    const coldArrow = { ...arrow };
    const bounds = getElementBounds(coldArrow, elementsMap);

    // 兜底分支与渲染同源：就是 getCurvedConnectorPath 这条曲线的 bbox
    const path = getCurvedConnectorPath(coldArrow)!;
    const ops = getCurvePathOps(
      rough.generator().path(path, generateRoughOptions(coldArrow)),
    );
    const [minX, minY, maxX, maxY] = getMinMaxXYFromCurvePathOps(ops);

    expect(bounds).toEqual([
      minX + coldArrow.x,
      minY + coldArrow.y,
      maxX + coldArrow.x,
      maxY + coldArrow.y,
    ]);
  });
});
