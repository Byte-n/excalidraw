import { reseed } from "@excalidraw/common";

import {
  buildShapeData,
  getQuickCreateHandles,
  isShapeElement,
} from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, render, unmountComponent, waitFor } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

unmountComponent();

const frame = () => h.app.pointer.getFrame();

const activationAt = (x: number, y: number) =>
  API.createElement({
    type: "sequence",
    shape: buildShapeData("sc-activation"),
    x,
    y,
    width: 16,
    height: 100,
  });

const lifelineAt = (x: number) =>
  API.createElement({
    type: "sequence",
    shape: buildShapeData("sc-lifeline-entity"),
    x,
    y: 0,
    width: 64,
    height: 68.272 + 360,
  });

const selectedRect = () => {
  const rect = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 120,
    height: 80,
  });
  API.setElements([rect]);
  API.setSelectedElements([rect]);
  mouse.reset();
  return rect;
};

describe("sequence affordances (PR4a)", () => {
  beforeEach(async () => {
    reseed(7);
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    unmountComponent();
  });

  it("hover = down: quick-create handle enters the quickCreate owner", async () => {
    selectedRect();
    const center = getQuickCreateHandles(h.app).find(
      (handle) => handle.direction === "right",
    )!.center;

    await act(() => {
      mouse.moveTo(center.x, center.y);
    });
    await waitFor(() => {
      expect(frame()?.target.kind).toBe("quickCreateHandle");
      expect(frame()?.phase).toBe("hover");
    });

    await act(() => {
      mouse.downAt(center.x, center.y);
    });
    expect(frame()?.phase).toBe("gesture");
    expect(frame()?.owner).toBe("quickCreate");

    mouse.upAt(center.x, center.y);
  });

  it("transformHandle beats quickCreateHandle", async () => {
    selectedRect();
    await act(() => {
      mouse.moveTo(100, 100);
    });
    await waitFor(() => {
      expect(frame()?.target.kind).toBe("transformHandle");
    });
  });

  it("quickCreateHandle is suppressed when another element is under the pointer", async () => {
    const rect = selectedRect();
    const blocker = API.createElement({
      type: "rectangle",
      x: 220,
      y: 120,
      width: 40,
      height: 40,
    });
    API.setElements([rect, blocker]);
    API.setSelectedElements([rect]);
    mouse.reset();

    const center = getQuickCreateHandles(h.app).find(
      (handle) => handle.direction === "right",
    )!.center;
    await act(() => {
      mouse.moveTo(center.x - 8, center.y);
    });
    await waitFor(() => {
      expect(frame()?.target.kind).not.toBe("quickCreateHandle");
    });
  });

  it("activationEdge beats poleActivation on a bar", async () => {
    const activation = activationAt(624, 200);
    const lifeline = lifelineAt(600);
    API.setElements([lifeline, activation]);
    mouse.reset();

    // right edge x = 640; 1px outside
    await act(() => {
      mouse.moveTo(641, 250);
    });
    await waitFor(() => {
      expect(frame()?.target.kind).toBe("activationEdge");
    });
  });

  it("an element stacked above the bar hides the activation edge", async () => {
    const activation = activationAt(624, 200);
    const lifeline = lifelineAt(600);
    const cover = API.createElement({
      type: "rectangle",
      x: 630,
      y: 240,
      width: 20,
      height: 20,
    });
    API.setElements([lifeline, activation, cover]);
    mouse.reset();

    await act(() => {
      mouse.moveTo(641, 250);
    });
    await waitFor(() => {
      expect(frame()?.target.kind).not.toBe("activationEdge");
    });
  });

  it("poleActivation appears on a bare pole and a click creates it", async () => {
    const lifeline = lifelineAt(600);
    API.setElements([lifeline]);
    mouse.reset();

    await act(() => {
      mouse.moveTo(632, 250);
    });
    await waitFor(() => {
      expect(frame()?.target.kind).toBe("poleActivation");
    });
    // 预演可见 ⇒ 不同时出现其它 affordance
    expect(frame()?.target.kind).toBe("poleActivation");

    await act(() => {
      mouse.downAt(632, 250);
      mouse.upAt(632, 250);
    });
    await waitFor(() => {
      const activations = h.elements.filter(
        (element) =>
          !element.isDeleted &&
          isShapeElement(element) &&
          element.shape.id === "sc-activation",
      );
      expect(activations).toHaveLength(1);
    });
    expect(frame()).toBeNull();
  });

  it("an existing activation on the pole suppresses poleActivation", async () => {
    const activation = activationAt(624, 200);
    const lifeline = lifelineAt(600);
    API.setElements([lifeline, activation]);
    mouse.reset();

    await act(() => {
      mouse.moveTo(632, 260);
    });
    await waitFor(() => {
      expect(frame()?.target.kind).not.toBe("poleActivation");
      expect(frame()?.target.kind).not.toBe("activationEdge");
    });
  });

  it("pole arming does not swallow the gesture and drops it past the threshold", async () => {
    const lifeline = lifelineAt(600);
    API.setElements([lifeline]);
    mouse.reset();

    await act(() => {
      mouse.moveTo(632, 250);
    });
    await waitFor(() => {
      expect(frame()?.target.kind).toBe("poleActivation");
    });
    await act(() => {
      mouse.downAt(632, 250);
    });
    expect(frame()?.phase).toBe("armed");
    expect(frame()?.owner).toBe("selection");

    await act(() => {
      mouse.moveTo(632, 290);
    });
    // 越过阈值：臂化被丢弃、frame 清空
    expect(h.app.quickCreate.hasPointerGesture()).toBe(false);
    expect(frame()).toBeNull();
    await act(() => {
      mouse.upAt(632, 290);
    });
    // 越过阈值：拖生命线，不创建激活条
    expect(
      h.elements.filter(
        (element) =>
          !element.isDeleted &&
          isShapeElement(element) &&
          element.shape.id === "sc-activation",
      ),
    ).toHaveLength(0);
  });
});
