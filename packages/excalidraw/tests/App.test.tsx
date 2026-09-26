import React from "react";
import { vi } from "vitest";

import { reseed } from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { updateGestureOnPointerDown } from "../components/app/gesture";
import {
  cleanupAfterMissingPointerUp,
  createInteractionState,
} from "../components/app/pointerSession";
import * as StaticScene from "../renderer/staticScene";

import {
  act,
  render,
  queryByTestId,
  unmountComponent,
} from "../tests/test-utils";

import { API } from "./helpers/api";

import type { DataURL } from "../types";

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
    const onStateChange = vi.fn(() => events.push("onStateChange"));
    const unsubscribe = window.h.app.api.onStateChange(
      "scrollX",
      onStateChange,
    );
    const commit = vi.spyOn(window.h.app.store, "commit");
    commit.mockClear();

    act(() => {
      window.h.app.api.updateScene({ appState: { scrollX: 42 } });
    });

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onScrollChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["onStateChange", "onScrollChange", "onChange"]);
    expect(onStateChange.mock.invocationCallOrder[0]).toBeLessThan(
      commit.mock.invocationCallOrder[0],
    );
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    );
    unsubscribe();
    commit.mockRestore();
  });

  it("removes and reinstalls native listeners without leaving a blur handler behind", async () => {
    await render(<Excalidraw />);
    const app = window.h.app;
    const blur = () =>
      app.ownerWindow.dispatchEvent(new app.ownerWindow.Event("blur"));

    app.pan.setSpaceHeld(true);
    act(blur);
    expect(app.pan.isSpaceHeld()).toBe(false);

    app.removeEventListeners();
    app.pan.setSpaceHeld(true);
    act(blur);
    expect(app.pan.isSpaceHeld()).toBe(true);

    app.addEventListeners();
    act(blur);
    expect(app.pan.isSpaceHeld()).toBe(false);
  });

  it("keeps existing files and queues an inserted image for cache loading", async () => {
    await render(<Excalidraw />);
    const app = window.h.app;
    const id = "stage-two-image" as FileId;
    const image = API.createElement({ type: "image", fileId: id });
    const file = {
      id,
      dataURL:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==" as DataURL,
      mimeType: "image/png" as const,
      created: Date.now(),
      lastRetrieved: Date.now(),
    };

    act(() => {
      app.api.updateScene({ elements: [image] });
      app.api.addFiles([file]);
    });

    expect(app.api.getFiles()[id]).toBe(file);
    expect(app.imageCache.get(id)?.mimeType).toBe("image/png");

    act(() => {
      app.api.addFiles([{ ...file, dataURL: "different" as DataURL }]);
    });
    expect(app.api.getFiles()[id]).toBe(file);
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

  it("keeps pointer session state isolated per App instance", () => {
    const first = createInteractionState();
    const second = createInteractionState();

    first.didTapTwice = true;
    first.firstTapPosition = { x: 10, y: 20 };
    first.currentScrollBars.horizontal = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      deltaMultiplier: 1,
    };

    expect(second.didTapTwice).toBe(false);
    expect(second.firstTapPosition).toBeNull();
    expect(second.currentScrollBars.horizontal).toBeNull();
  });

  it("cleans up only the pointer session that lost its pointerup", () => {
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    const makeApp = (cleanup: () => void) => ({
      pan: { end: vi.fn() },
      interactionState: {
        ...createInteractionState(),
        lastPointerUp: cleanup,
      },
      missingPointerEventCleanupEmitter: {
        trigger: vi.fn(() => ({ clear: vi.fn() })),
      },
    });
    const first = makeApp(firstCleanup);
    const second = makeApp(secondCleanup);

    cleanupAfterMissingPointerUp(first, null);

    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).not.toHaveBeenCalled();
    expect(first.pan.end).toHaveBeenCalledTimes(1);
    expect(second.pan.end).not.toHaveBeenCalled();
  });
});
