import React from "react";
import { vi } from "vitest";

import { CODES, KEYS, reseed } from "@excalidraw/common";
import { isValidTextContainer } from "@excalidraw/element";

import type { FileId } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import {
  removeGesturePointer,
  updateGestureOnPointerDown,
  updateMultiTouchGesture,
} from "../components/app/gesture";
import {
  cleanupAfterMissingPointerUp,
  createInteractionState,
} from "../components/app/pointerSession";
import * as StaticScene from "../renderer/staticScene";

import {
  act,
  fireEvent,
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

  it("handles tool shortcuts and prevents browser zoom in the mounted document", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const app = window.h.app;

    act(() => {
      app.ownerDocument.dispatchEvent(
        new app.ownerWindow.KeyboardEvent("keydown", {
          key: "r",
          code: "KeyR",
          bubbles: true,
        }),
      );
    });
    expect(app.state.activeTool.type).toBe("rectangle");

    const zoomEvent = new app.ownerWindow.KeyboardEvent("keydown", {
      key: "-",
      code: CODES.MINUS,
      [KEYS.CTRL_OR_CMD]: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      app.ownerDocument.dispatchEvent(zoomEvent);
    });
    expect(zoomEvent.defaultPrevented).toBe(true);
  });

  it("pauses zoom with a third pointer and keeps gesture state local", async () => {
    await render(<Excalidraw />);
    const app = window.h.app;
    const translate = vi
      .spyOn(app.viewport, "translate")
      .mockImplementation(() => true);
    const other = {
      gesture: {
        pointers: new Map(),
        lastCenter: null,
        initialDistance: null,
        initialScale: null,
      },
      state: app.state,
    };

    updateGestureOnPointerDown(app, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    updateGestureOnPointerDown(app, {
      pointerId: 2,
      clientX: 200,
      clientY: 100,
    });
    expect(app.gesture.initialDistance).toBe(100);
    expect(other.gesture.pointers.size).toBe(0);

    act(() => {
      updateMultiTouchGesture(app, {
        pointerId: 2,
        clientX: 250,
        clientY: 100,
      });
    });
    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        zoom: expect.objectContaining({ value: 1.5 }),
      }),
      { zoomPreConstrained: true },
    );

    updateGestureOnPointerDown(app, {
      pointerId: 3,
      clientX: 300,
      clientY: 100,
    });
    const calls = translate.mock.calls.length;
    act(() => {
      updateMultiTouchGesture(app, {
        pointerId: 2,
        clientX: 280,
        clientY: 100,
      });
    });
    expect(translate).toHaveBeenCalledTimes(calls);
    removeGesturePointer(app, 3);
    expect(app.gesture.pointers.size).toBe(2);
    expect(other.gesture.pointers.size).toBe(0);
    translate.mockRestore();
  });

  it("binds a new text editor to its container", async () => {
    await render(<Excalidraw />);
    const app = window.h.app;
    const rectangle = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 160,
      height: 80,
    });
    if (!isValidTextContainer(rectangle)) {
      throw new Error("Expected a text container");
    }

    act(() => {
      app.api.updateScene({ elements: [rectangle] });
      app.startTextEditing({
        sceneX: 180,
        sceneY: 140,
        container: rectangle,
      });
    });

    const text = app.state.editingTextElement;
    expect(text?.containerId).toBe(rectangle.id);
    expect(app.scene.getElement(rectangle.id)?.boundElements).toContainEqual({
      type: "text",
      id: text?.id,
    });
    const editor = app.excalidrawContainerRef.current?.querySelector(
      ".excalidraw-wysiwyg",
    ) as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    fireEvent.input(editor, { target: { value: "Bound label" } });
    act(() => {
      app.textWysiwygSubmitHandler?.();
    });
    expect(app.scene.getElement(text!.id)).toMatchObject({
      originalText: "Bound label",
      containerId: rectangle.id,
    });
    expect(app.scene.getElement(rectangle.id)?.boundElements).toContainEqual({
      type: "text",
      id: text?.id,
    });
  });

  it("prefers a selected hit among overlapping elements and rejects distant points", async () => {
    await render(<Excalidraw />);
    const app = window.h.app;
    const back = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    const front = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    act(() => {
      app.api.updateScene({ elements: [back, front] });
    });

    expect(app.getElementAtPosition(100, 150)?.id).toBe(front.id);
    act(() => {
      app.setState({ selectedElementIds: { [back.id]: true } });
    });
    expect(
      app.getElementAtPosition(100, 150, { preferSelected: true })?.id,
    ).toBe(back.id);
    expect(app.getElementAtPosition(300, 300)).toBeNull();
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
