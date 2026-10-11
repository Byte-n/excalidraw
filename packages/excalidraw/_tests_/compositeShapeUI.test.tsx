import { pointFrom, type GlobalPoint, type Radians } from "@excalidraw/math";
import {
  baseShapeData,
  distanceToElement,
  getBindingGap,
  type BaseShapeId,
  supportsFill,
} from "@excalidraw/element";

import type { FixedPointBinding } from "@excalidraw/element/types";

import {
  actionBringToFront,
  actionDuplicateSelection,
  actionFlipHorizontal,
  actionFlipVertical,
  actionGroup,
  actionSendToBack,
} from "../actions";
import { createPasteEvent, serializeAsClipboardJSON } from "../clipboard";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
  togglePopover,
  waitFor,
} from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");
const touch = new Pointer("touch", 3);
const captureBaseline = () =>
  act(() => {
    h.app.store.scheduleCapture();
    h.app.scene.triggerUpdate();
  });
const presets = [
  "rectangle",
  "diamond",
  "ellipse",
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
  "right-triangle",
  "left-triangle",
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
  "pie",
  "circular-ring",
] as const;

const shapeForPreset = (preset: typeof presets[number]) => {
  if (preset === "right-triangle" || preset === "left-triangle") {
    return {
      id: "triangle" as const,
      schemaVersion: 1 as const,
      triangle: { apexX: preset === "right-triangle" ? 0 : 1 },
    };
  }
  return baseShapeData(preset as BaseShapeId);
};

describe.each([
  { name: "desktop", width: 1200, height: 800, formFactor: "desktop" },
  { name: "phone", width: 390, height: 844, formFactor: "phone" },
])("composite shape tools on $name", ({ width, height, formFactor }) => {
  beforeEach(async () => {
    mockBoundingClientRect({ width, height });
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    act(() => h.app.refreshEditorInterface());
  });

  afterEach(() => restoreOriginalGetBoundingClientRect());

  it("shows a distinct icon for each generic shape option", async () => {
    act(() => h.app.setActiveTool({ type: "rectangle" }));
    fireEvent.click(screen.getByTestId("toolbar-rectangle"));

    const buttons = await waitFor(() => {
      const options = h.app.ownerDocument.querySelectorAll<HTMLButtonElement>(
        '.tool-popover-content [data-testid^="toolbar-"]',
      );
      expect(options).toHaveLength(presets.length);
      return options;
    });
    const icons = Array.from(
      buttons,
      (button) => button.querySelector("svg")?.outerHTML,
    );

    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(buttons.length);
  });

  it("highlights the selected shape and can switch back to rectangle", async () => {
    act(() => h.app.setActiveTool({ type: "rectangle" }));
    const trigger = screen.getByTestId("toolbar-rectangle");
    fireEvent.click(trigger);

    const crossOption = await waitFor(() =>
      screen.getByTestId("toolbar-cross"),
    );
    const rectangleOption =
      h.app.ownerDocument.querySelector<HTMLButtonElement>(
        '.tool-popover-content [data-testid="toolbar-rectangle"]',
      )!;
    fireEvent.click(crossOption);

    expect(h.state.preferredGenericShape).toBe("cross");
    expect(h.state.activeTool.type).toBe("rectangle");
    expect(trigger).toHaveAttribute("aria-pressed", "true");
    expect(crossOption).toHaveAttribute("aria-pressed", "true");
    expect(rectangleOption).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(rectangleOption);
    expect(h.state.preferredGenericShape).toBe("rectangle");
    expect(crossOption).toHaveAttribute("aria-pressed", "false");
  });

  it("creates all three shapes and preserves them through undo and redo", () => {
    expect(h.app.editorInterface.formFactor).toBe(formFactor);

    for (const [index, id] of ["rectangle", "diamond", "ellipse"].entries()) {
      if (formFactor === "phone" && id !== "rectangle") {
        fireEvent.click(screen.getByTestId("toolbar-rectangle"));
        fireEvent.click(screen.getByTestId(`toolbar-${id}`));
      } else {
        UI.clickTool(id as "rectangle" | "diamond" | "ellipse");
      }
      const x = 60 + index * 100;
      mouse.reset();
      mouse.down(x, 80);
      mouse.reset();
      mouse.up(x + 80, 160);
      expect(h.elements[h.elements.length - 1]).toMatchObject({
        type: "composite_shape",
        shape: { id, schemaVersion: 1 },
      });
    }

    expect(h.app.scene.getNonDeletedElements()).toHaveLength(3);
    Keyboard.undo();
    expect(h.app.scene.getNonDeletedElements()).toHaveLength(2);
    Keyboard.redo();
    expect(h.app.scene.getNonDeletedElements()).toHaveLength(3);
  });

  it("creates every preset from the shared shape picker", () => {
    for (const [index, preset] of presets.entries()) {
      if (formFactor === "phone" && preset === "rectangle") {
        UI.clickTool("rectangle");
      } else {
        fireEvent.click(screen.getByTestId("toolbar-rectangle"));
        const option = h.app.ownerDocument.querySelector<HTMLButtonElement>(
          `.tool-popover-content [data-testid="toolbar-${preset}"]`,
        );
        if (!option) {
          throw new Error(`Missing ${preset} option`);
        }
        fireEvent.click(option);
      }

      const x = 32 + (index % 3) * 105;
      const y = 50 + Math.floor(index / 3) * 80;
      mouse.reset();
      mouse.down(x, y);
      mouse.up(x + 65, y + 50);

      const created = h.elements[h.elements.length - 1];
      expect(created).toMatchObject({
        type: "composite_shape",
        shape: {
          id:
            preset === "right-triangle" || preset === "left-triangle"
              ? "triangle"
              : preset,
          schemaVersion: 1,
        },
      });
      if (
        created.type === "composite_shape" &&
        created.shape.id === "triangle"
      ) {
        expect(created.shape.triangle.apexX).toBe(
          preset === "right-triangle"
            ? 0
            : preset === "left-triangle"
            ? 1
            : 0.5,
        );
      }
    }
    expect(h.app.scene.getNonDeletedElements()).toHaveLength(presets.length);
  }, 15_000);

  it("drags a triangle apex as one undoable edit", () => {
    const triangle = API.createElement({
      type: "triangle",
      x: 150,
      y: 150,
      width: 100,
      height: 80,
    });
    if (triangle.type !== "composite_shape") {
      throw new Error("Expected triangle");
    }
    API.setElements([triangle]);
    API.setSelectedElements([triangle]);
    captureBaseline();

    mouse.reset();
    mouse.down(200, 150);
    mouse.move(10, 0);
    mouse.move(15, 0);
    mouse.up();
    expect(h.elements[0]).toMatchObject({
      id: triangle.id,
      shape: { id: "triangle", triangle: { apexX: 0.75 } },
    });
    Keyboard.undo();
    expect(h.elements[0]).toMatchObject({
      shape: { id: "triangle", triangle: { apexX: 0.5 } },
    });
    Keyboard.redo();
    expect(h.elements[0]).toMatchObject({
      shape: { id: "triangle", triangle: { apexX: 0.75 } },
    });
  });

  it("changes trapezoid width and flips its narrow edge", () => {
    const trapezoid = API.createElement({
      type: "trapezoid",
      x: 150,
      y: 150,
      width: 120,
      height: 80,
    });
    if (trapezoid.type !== "composite_shape") {
      throw new Error("Expected trapezoid");
    }
    API.setElements([trapezoid]);
    API.setSelectedElements([trapezoid]);
    captureBaseline();

    mouse.reset();
    mouse.down(250, 150);
    mouse.move(-12, 0);
    mouse.up();
    expect(h.elements[0]).toMatchObject({
      shape: { id: "trapezoid", trapezoid: { narrowEdge: "top" } },
    });
    if (
      h.elements[0].type === "composite_shape" &&
      h.elements[0].shape.id === "trapezoid"
    ) {
      expect(h.elements[0].shape.trapezoid.narrowWidthRatio).toBeCloseTo(
        7 / 15,
      );
    }
    Keyboard.undo();
    expect(h.elements[0]).toMatchObject({
      shape: {
        id: "trapezoid",
        trapezoid: { narrowWidthRatio: 2 / 3, narrowEdge: "top" },
      },
    });
    Keyboard.redo();
    API.executeAction(actionFlipVertical);
    expect(h.elements[0]).toMatchObject({
      shape: { id: "trapezoid", trapezoid: { narrowEdge: "bottom" } },
    });
    API.executeAction(actionFlipVertical);
    expect(h.elements[0]).toMatchObject({
      shape: { id: "trapezoid", trapezoid: { narrowEdge: "top" } },
    });
  });

  it("mirrors a triangle apex with the existing horizontal flip action", () => {
    const triangle = API.createElement({
      type: "composite_shape",
      shape: { id: "triangle", schemaVersion: 1, triangle: { apexX: 0 } },
      x: 150,
      y: 150,
      width: 100,
      height: 80,
    });
    API.setElements([triangle]);
    API.setSelectedElements([triangle]);
    API.executeAction(actionFlipHorizontal);
    expect(h.elements[0]).toMatchObject({
      id: triangle.id,
      shape: { id: "triangle", triangle: { apexX: 1 } },
    });
  });

  it("drags the cube depth without collapsing its faces", () => {
    const cube = API.createElement({
      type: "cube",
      x: 150,
      y: 150,
      width: 100,
      height: 80,
    });
    if (cube.type !== "composite_shape") {
      throw new Error("Expected cube");
    }
    API.setElements([cube]);
    API.setSelectedElements([cube]);
    captureBaseline();

    mouse.reset();
    mouse.down(232, 167.6);
    mouse.move(100, 100);
    mouse.up();
    const changed = h.elements[0];
    expect(changed.type).toBe("composite_shape");
    if (changed.type === "composite_shape" && changed.shape.id === "cube") {
      expect(changed.shape.cube.controlPoint.x).toBeLessThan(1);
      expect(changed.shape.cube.controlPoint.y).toBeLessThan(1);
    }
    Keyboard.undo();
    expect(h.elements[0]).toMatchObject({
      shape: {
        id: "cube",
        cube: { controlPoint: { x: 0.82, y: 0.22 } },
      },
    });
    Keyboard.redo();
    expect(h.elements[0]).toMatchObject({
      shape: {
        id: "cube",
        cube: { controlPoint: { x: 0.95, y: 0.95 } },
      },
    });
  });

  it("maps a rotated control point back to local shape coordinates", () => {
    const triangle = API.createElement({
      type: "triangle",
      x: 150,
      y: 150,
      width: 100,
      height: 80,
      angle: (Math.PI / 2) as Radians,
    });
    if (triangle.type !== "composite_shape") {
      throw new Error("Expected triangle");
    }
    API.setElements([triangle]);
    API.setSelectedElements([triangle]);

    mouse.reset();
    mouse.down(240, 190);
    mouse.move(0, 25);
    mouse.up();
    expect(h.elements[0]).toMatchObject({
      id: triangle.id,
      shape: { id: "triangle", triangle: { apexX: 0.75 } },
    });
  });

  it("uses the touch hit area without jumping the control point", () => {
    const triangle = API.createElement({
      type: "triangle",
      x: 150,
      y: 150,
      width: 100,
      height: 80,
    });
    if (triangle.type !== "composite_shape") {
      throw new Error("Expected triangle");
    }
    API.setElements([triangle]);
    API.setSelectedElements([triangle]);

    touch.reset();
    touch.down(212, 150);
    touch.move(20, 0);
    touch.up();
    expect(h.elements[0]).toMatchObject({
      shape: { id: "triangle", triangle: { apexX: 0.7 } },
    });
  });

  it("keeps bound text and an arrow attached while dragging an apex", () => {
    const triangle = API.createElement({
      type: "triangle",
      x: 150,
      y: 150,
      width: 100,
      height: 80,
    });
    if (triangle.type !== "composite_shape") {
      throw new Error("Expected triangle");
    }
    const text = API.createElement({
      type: "text",
      x: 190,
      y: 190,
      width: 20,
      height: 20,
      text: "A",
      containerId: triangle.id,
    });
    const arrow = API.createElement({
      type: "arrow",
      x: 200,
      y: 50,
      width: 0,
      height: 100,
      points: [pointFrom(0, 0), pointFrom(0, 100)],
      startBinding: null,
      endBinding: {
        elementId: triangle.id,
        fixedPoint: [0.5, 0],
        mode: "orbit",
      } as FixedPointBinding,
    });
    const container = {
      ...triangle,
      boundElements: [
        { id: text.id, type: "text" as const },
        { id: arrow.id, type: "arrow" as const },
      ],
    };
    API.setElements([container, text, arrow]);
    API.setSelectedElements([container]);
    captureBaseline();

    mouse.reset();
    mouse.down(200, 150);
    mouse.move(25, 0);
    mouse.up();

    const moved = h.app.scene.getNonDeletedElement(triangle.id);
    const boundText = h.app.scene.getNonDeletedElement(text.id);
    const boundArrow = h.app.scene.getNonDeletedElement(arrow.id);
    expect(moved).toMatchObject({
      shape: { id: "triangle", triangle: { apexX: 0.75 } },
      boundElements: expect.arrayContaining([
        { id: text.id, type: "text" },
        { id: arrow.id, type: "arrow" },
      ]),
    });
    expect(boundText).toMatchObject({ containerId: triangle.id });
    expect(boundArrow).toMatchObject({
      endBinding: { elementId: triangle.id },
    });
    if (moved?.type === "composite_shape" && boundArrow?.type === "arrow") {
      const end = boundArrow.points.at(-1)!;
      const endPoint = pointFrom<GlobalPoint>(
        boundArrow.x + end[0],
        boundArrow.y + end[1],
      );
      expect(
        distanceToElement(
          moved,
          h.app.scene.getNonDeletedElementsMap(),
          endPoint,
        ),
      ).toBeLessThanOrEqual(getBindingGap(moved, { elbowed: false }) + 1);
    }
    Keyboard.undo();
    expect(h.app.scene.getNonDeletedElement(triangle.id)).toMatchObject({
      shape: { id: "triangle", triangle: { apexX: 0.5 } },
    });
    expect(h.app.scene.getNonDeletedElement(arrow.id)).toMatchObject({
      endBinding: { elementId: triangle.id, fixedPoint: [0.5, 0] },
    });
    Keyboard.redo();
    expect(h.app.scene.getNonDeletedElement(triangle.id)).toMatchObject({
      shape: { id: "triangle", triangle: { apexX: 0.75 } },
    });
    expect(h.app.scene.getNonDeletedElement(text.id)).toMatchObject({
      containerId: triangle.id,
    });
    expect(h.app.scene.getNonDeletedElement(arrow.id)).toMatchObject({
      endBinding: { elementId: triangle.id, fixedPoint: [0.75, 0] },
    });
  });
});

describe("composite shape editing matrix", () => {
  beforeEach(async () => {
    mockBoundingClientRect({ width: 1200, height: 800 });
    await render(<Excalidraw autoFocus={true} handleKeyboardGlobally={true} />);
    Object.assign(h.app.ownerDocument, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
  });

  afterEach(() => restoreOriginalGetBoundingClientRect());

  it.each(presets)(
    "edits %s through styles, transforms and duplication",
    (preset) => {
      const element = API.createElement({
        type: "composite_shape",
        shape: shapeForPreset(preset),
        x: 150,
        y: 150,
        width: 100,
        height: 80,
        backgroundColor: "#ffec99",
      });
      API.setElements([element]);
      API.setSelectedElements([element]);
      captureBaseline();

      togglePopover("Stroke");
      UI.clickOnTestId("color-red");
      if (supportsFill(shapeForPreset(preset).id)) {
        togglePopover("Background");
        UI.clickOnTestId("color-blue");
      }

      let edited = h.app.scene.getNonDeletedElement(element.id);
      expect(edited).toMatchObject({
        shape: shapeForPreset(preset),
        strokeColor: "#e03131",
        backgroundColor: supportsFill(shapeForPreset(preset).id)
          ? "#a5d8ff"
          : "transparent",
      });
      if (!edited) {
        throw new Error("Edited shape disappeared");
      }
      UI.resize(edited, "e", [30, 0]);
      edited = h.app.scene.getNonDeletedElement(element.id);
      expect(edited).toMatchObject({ width: 130, height: 80 });
      if (!edited) {
        throw new Error("Resized shape disappeared");
      }
      UI.rotate(edited, [40, 25]);
      edited = h.app.scene.getNonDeletedElement(element.id);
      expect(edited?.angle).not.toBe(0);
      expect(edited).toMatchObject({ shape: shapeForPreset(preset) });

      API.executeAction(actionDuplicateSelection);
      const current = h.app.scene.getNonDeletedElements();
      expect(current).toHaveLength(2);
      expect(current[1]).toMatchObject({
        type: "composite_shape",
        shape: shapeForPreset(preset),
        width: edited?.width,
        height: edited?.height,
        angle: edited?.angle,
        strokeColor: edited?.strokeColor,
        backgroundColor: edited?.backgroundColor,
      });
      expect(current[1].id).not.toBe(element.id);
      Keyboard.undo();
      expect(h.app.scene.getNonDeletedElements()).toHaveLength(1);
      Keyboard.redo();
      expect(h.app.scene.getNonDeletedElements()).toHaveLength(2);
    },
  );

  it.each(["star", "step", "brace", "rectangle-bubble", "cube"] as const)(
    "keeps %s identity through grouping and layer changes",
    (preset) => {
      const shape = API.createElement({
        type: "composite_shape",
        shape: shapeForPreset(preset),
        x: 150,
        y: 150,
        width: 100,
        height: 80,
      });
      const peer = API.createElement({
        type: "rectangle",
        x: 350,
        y: 150,
        width: 80,
        height: 80,
      });
      API.setElements([shape, peer]);
      API.setSelectedElements([shape, peer]);
      captureBaseline();
      API.executeAction(actionGroup);
      const groupId = h.app.scene.getNonDeletedElement(shape.id)?.groupIds[0];
      expect(groupId).toBeTruthy();
      expect(h.app.scene.getNonDeletedElement(peer.id)?.groupIds[0]).toBe(
        groupId,
      );

      API.setSelectedElements([shape]);
      API.executeAction(actionBringToFront);
      expect(h.app.scene.getNonDeletedElements().at(-1)?.id).toBe(shape.id);
      API.executeAction(actionSendToBack);
      expect(h.app.scene.getNonDeletedElements()[0]?.id).toBe(shape.id);
      Keyboard.undo();
      expect(h.app.scene.getNonDeletedElements().at(-1)?.id).toBe(shape.id);
      Keyboard.redo();
      expect(h.app.scene.getNonDeletedElements()[0]?.id).toBe(shape.id);
      expect(h.app.scene.getNonDeletedElement(shape.id)).toMatchObject({
        shape: shapeForPreset(preset),
        groupIds: [groupId],
      });
    },
  );

  it.each(["right-triangle", "step", "brace", "bubble", "cube"] as const)(
    "pastes %s into the canvas with its shape data",
    async (preset) => {
      const element = API.createElement({
        type: "composite_shape",
        shape: shapeForPreset(preset),
        x: 150,
        y: 150,
        width: 100,
        height: 80,
        strokeColor: "#e03131",
        backgroundColor: supportsFill(shapeForPreset(preset).id)
          ? "#a5d8ff"
          : "transparent",
      });
      API.setElements([element]);
      const serialized = serializeAsClipboardJSON({
        elements: [element],
        files: null,
      });
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress("v", h.app.ownerDocument);
        h.app.ownerDocument.dispatchEvent(
          createPasteEvent({ types: { "text/plain": serialized } }),
        );
      });

      await waitFor(() => {
        expect(h.app.scene.getNonDeletedElements()).toHaveLength(2);
      });
      const pasted = h.app.scene
        .getNonDeletedElements()
        .find((candidate) => candidate.id !== element.id);
      expect(pasted).toMatchObject({
        type: "composite_shape",
        shape: shapeForPreset(preset),
        width: 100,
        height: 80,
        strokeColor: "#e03131",
        backgroundColor: supportsFill(shapeForPreset(preset).id)
          ? "#a5d8ff"
          : "transparent",
      });
    },
  );
});
