import { CURSOR_TYPE, reseed } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import { buildShapeData, getQuickCreateHandles } from "@excalidraw/element";

import type { GlobalPoint } from "@excalidraw/math";

import { Excalidraw } from "../index";

import { resolvePointerFrame } from "../components/app/pointerFrame";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { act, render, unmountComponent, waitFor } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

unmountComponent();

const rect = () =>
  API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 120,
    height: 80,
  });

const activationAt = (x: number, y: number) =>
  API.createElement({
    type: "sequence",
    shape: buildShapeData("sc-activation"),
    x,
    y,
    width: 16,
    height: 100,
  });

describe("pointer cursor (PR5a-1)", () => {
  beforeEach(async () => {
    reseed(7);
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    unmountComponent();
  });

  it("writes exactly one cursor per pointermove on canvas", async () => {
    const spy = vi.spyOn(h.app.cursor, "set");
    await act(() => {
      mouse.moveTo(400, 400);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("");
  });

  it("element hover → MOVE", async () => {
    const element = rect();
    API.setElements([element]);
    const spy = vi.spyOn(h.app.cursor, "set");
    await act(() => {
      mouse.moveTo(160, 140);
    });
    await waitFor(() => {
      expect(h.app.pointer.getFrame()?.target.kind).toBe("element");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(CURSOR_TYPE.MOVE);
  });

  it("selected element hover → MOVE via selectedElement", async () => {
    const element = rect();
    API.setElements([element]);
    API.setSelectedElements([element]);
    mouse.reset();
    const spy = vi.spyOn(h.app.cursor, "set");
    await act(() => {
      mouse.moveTo(160, 140);
    });
    await waitFor(() => {
      expect(h.app.pointer.getFrame()?.target.kind).toBe("selectedElement");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(CURSOR_TYPE.MOVE);
  });

  it("transform handle wins and uses the resize cursor", async () => {
    const element = rect();
    API.setElements([element]);
    API.setSelectedElements([element]);
    mouse.reset();
    const spy = vi.spyOn(h.app.cursor, "set");
    await act(() => {
      mouse.moveTo(100, 100);
    });
    await waitFor(() => {
      expect(h.app.pointer.getFrame()?.target.kind).toBe("transformHandle");
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sequence handles write POINTER", async () => {
    const element = rect();
    API.setElements([element]);
    API.setSelectedElements([element]);
    mouse.reset();
    const center = getQuickCreateHandles(h.app).find(
      (handle) => handle.direction === "right",
    )!.center;
    const spy = vi.spyOn(h.app.cursor, "set");
    await act(() => {
      mouse.moveTo(center.x, center.y);
    });
    await waitFor(() => {
      expect(h.app.pointer.getFrame()?.target.kind).toBe("quickCreateHandle");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(CURSOR_TYPE.POINTER);
  });

  it("activation edge writes POINTER once", async () => {
    const activation = activationAt(400, 200);
    API.setElements([activation]);
    mouse.reset();
    const spy = vi.spyOn(h.app.cursor, "set");
    await act(() => {
      mouse.moveTo(417, 250);
    });
    await waitFor(() => {
      expect(h.app.pointer.getFrame()?.target.kind).toBe("activationEdge");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(CURSOR_TYPE.POINTER);
  });

  it("hoveredElementId stays pointer-derived (05 §3.3 / O4)", async () => {
    const element = rect();
    const locked = API.createElement({
      type: "rectangle",
      x: 300,
      y: 300,
      width: 80,
      height: 60,
      locked: true,
    });
    API.setElements([element, locked]);

    await act(() => {
      mouse.moveTo(160, 140);
    });
    await waitFor(() => {
      expect(h.app.pointer.getFrame()?.target.kind).toBe("element");
      expect(h.state.hoveredElementId).toBe(element.id);
    });

    await act(() => {
      mouse.moveTo(700, 700);
    });
    await waitFor(() => {
      expect(h.state.hoveredElementId).toBe(null);
    });

    // locked elements are included in the frame-title hover bridge
    await act(() => {
      mouse.moveTo(340, 330);
    });
    await waitFor(() => {
      expect(h.state.hoveredElementId).toBe(locked.id);
    });

    // still pointer-derived after a click-drag selection
    await act(() => {
      mouse.downAt(900, 900);
      mouse.moveTo(950, 950);
      mouse.upAt(950, 950);
      mouse.moveTo(160, 140);
    });
    await waitFor(() => {
      expect(h.state.hoveredElementId).toBe(element.id);
    });
  });

  it("hover and pointerdown resolve the same transform handle target", () => {
    const element = rect();
    API.setElements([element]);
    API.setSelectedElements([element]);
    UI.clickTool("selection");
    const point = pointFrom<GlobalPoint>(100, 100);
    const input = {
      point,
      mode: "selection" as const,
      pointerType: "mouse" as const,
    };
    const hover = resolvePointerFrame(h.app as any, {
      ...input,
      phase: "hover",
    });
    const armed = resolvePointerFrame(h.app as any, {
      ...input,
      phase: "armed",
    });
    expect(hover.target.kind).toBe("transformHandle");
    expect(armed.target).toEqual(hover.target);
  });
});
