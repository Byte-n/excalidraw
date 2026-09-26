import React from "react";
import { vi } from "vitest";

import { reseed } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { updateGestureOnPointerDown } from "../components/app/gesture";
import * as StaticScene from "../renderer/staticScene";
import {
  act,
  render,
  queryByTestId,
  unmountComponent,
} from "../tests/test-utils";

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");

describe("Test <App/>", () => {
  beforeEach(async () => {
    unmountComponent();
    localStorage.clear();
    renderStaticScene.mockClear();
    reseed(7);
  });

  it("should show error modal when using brave and measureText API is not working", async () => {
    (global.navigator as any).brave = {
      isBrave: {
        name: "isBrave",
      },
    };

    const originalContext = global.HTMLCanvasElement.prototype.getContext("2d");
    //@ts-ignore
    global.HTMLCanvasElement.prototype.getContext = (contextId) => {
      return {
        ...originalContext,
        measureText: () => ({
          width: 0,
        }),
      };
    };

    await render(<Excalidraw />);
    expect(
      queryByTestId(
        document.querySelector(".excalidraw-modal-container")!,
        "brave-measure-text-error",
      ),
    ).toMatchSnapshot();
  });

  it("keeps viewport notification, store commit, and change notification ordering", async () => {
    const events: string[] = [];
    const onChange = vi.fn(() => events.push("onChange"));
    const onScrollChange = vi.fn(() => events.push("onScrollChange"));

    await render(
      <Excalidraw onChange={onChange} onScrollChange={onScrollChange} />,
    );

    onChange.mockClear();
    onScrollChange.mockClear();
    events.length = 0;
    const commit = vi.spyOn(window.h.app.store, "commit");
    commit.mockClear();

    act(() => {
      window.h.app.api.updateScene({ appState: { scrollX: 42 } });
    });

    expect(onScrollChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["onScrollChange", "onChange"]);
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    );
    commit.mockRestore();
  });

  it("handles page navigation through the mounted editor document", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);

    const app = window.h.app;
    act(() => {
      app.setState({ height: 100, width: 100 });
    });
    const before = app.state.scrollY;
    const event = new app.ownerWindow.KeyboardEvent("keydown", {
      key: "PageDown",
      bubbles: true,
    });

    act(() => {
      app.ownerDocument.dispatchEvent(event);
    });

    expect(app.state.scrollY).toBeLessThan(before);
  });

  it("keeps gesture state isolated per App instance", async () => {
    const makeApp = () => ({
      gesture: {
        pointers: new Map(),
        lastCenter: null,
        initialDistance: null,
        initialScale: null,
      },
      state: { zoom: { value: 1 } },
    });
    const first = makeApp();
    const second = makeApp();
    updateGestureOnPointerDown(first as any, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });

    expect(first.gesture.pointers.size).toBe(1);
    expect(second.gesture.pointers.size).toBe(0);
  });
});
