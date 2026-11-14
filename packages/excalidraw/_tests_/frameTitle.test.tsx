import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react-dom/test-utils";

import { Excalidraw } from "../index";
import { getFrameNameLayout } from "../renderer/frameName";

import { API } from "./helpers/api";
import {
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  unmountComponent,
} from "./test-utils";

unmountComponent();

const { h } = window;

describe("frame titles are canvas chrome", () => {
  beforeEach(async () => {
    localStorage.clear();
    mockBoundingClientRect();
    await render(<Excalidraw />);
  });

  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
  });

  it("draws no DOM label and starts the rename editor on double-click", async () => {
    const frame = API.createElement({
      type: "frame",
      x: 20,
      y: 30,
      width: 120,
      height: 80,
    });
    API.setElements([frame]);
    API.updateElement(frame, { name: "Flow" });

    expect(document.querySelector(".frame-name")).toBe(null);

    const layout = getFrameNameLayout(API.getElement(frame) as any, {
      zoom: h.state.zoom.value,
    });
    const clientX =
      (layout.x + layout.width / 2 + h.state.scrollX) * h.state.zoom.value +
      h.state.offsetLeft;
    const clientY =
      (layout.y + layout.height / 2 + h.state.scrollY) * h.state.zoom.value +
      h.state.offsetTop;

    act(() => {
      fireEvent.doubleClick(GlobalTestState.interactiveCanvas, {
        clientX,
        clientY,
        pointerType: "mouse",
      });
    });

    expect(h.state.editingFrame).toBe(frame.id);
    expect(
      await waitFor(() => document.querySelector(".frame-name input")),
    ).not.toBeNull();
  });
});
