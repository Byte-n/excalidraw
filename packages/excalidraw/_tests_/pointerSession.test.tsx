import React from "react";
import { vi } from "vitest";

import { EVENT, POINTER_BUTTON } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { act, fireEvent, render, unmountComponent } from "./test-utils";

beforeEach(() => {
  unmountComponent();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  unmountComponent();
});

const getSessionListeners = (spy: ReturnType<typeof vi.spyOn>, type: string) =>
  spy.mock.calls
    .filter(([eventType]) => eventType === type)
    .map(([, listener]) => listener);

describe("pointer sessions", () => {
  it.each(["pointerup", "pointercancel", "missing up", "unmount"])(
    "removes temporary listeners after %s",
    async (completion) => {
      const { container } = await render(<Excalidraw />);
      const app = window.h.app;
      const canvas = container.querySelector("canvas.interactive")!;
      const add = vi.spyOn(app.ownerWindow, "addEventListener");
      const remove = vi.spyOn(app.ownerWindow, "removeEventListener");

      fireEvent.pointerDown(canvas, { clientX: 40, clientY: 50 });

      const listeners = [
        EVENT.POINTER_MOVE,
        EVENT.POINTER_UP,
        EVENT.POINTER_CANCEL,
        EVENT.KEYDOWN,
        EVENT.KEYUP,
      ].map((type) => ({
        type,
        callbacks: getSessionListeners(add, type),
      }));
      listeners.forEach(({ callbacks }) =>
        expect(callbacks.length).toBeGreaterThan(0),
      );

      if (completion === "pointerup") {
        fireEvent.pointerUp(canvas, { clientX: 40, clientY: 50 });
      } else if (completion === "pointercancel") {
        fireEvent.pointerCancel(canvas, { clientX: 40, clientY: 50 });
      } else if (completion === "missing up") {
        act(() => app.maybeCleanupAfterMissingPointerUp(null));
      } else {
        unmountComponent();
      }

      listeners.forEach(({ type, callbacks }) => {
        const removed = getSessionListeners(remove, type);
        callbacks.forEach((callback) => expect(removed).toContain(callback));
      });
    },
  );

  it("keeps concurrent editor sessions independent", async () => {
    const firstRender = await render(<Excalidraw />);
    const first = window.h.app;
    const secondRender = await render(<Excalidraw />);
    const second = window.h.app;
    expect(first).not.toBe(second);

    const firstCanvas =
      firstRender.container.querySelector("canvas.interactive")!;
    const secondCanvas =
      secondRender.container.querySelector("canvas.interactive")!;
    const add = vi.spyOn(first.ownerWindow, "addEventListener");
    const remove = vi.spyOn(first.ownerWindow, "removeEventListener");

    fireEvent.pointerDown(firstCanvas, { clientX: 40, clientY: 50 });
    const firstMove = getSessionListeners(add, EVENT.POINTER_MOVE).at(-1);
    fireEvent.pointerDown(secondCanvas, { clientX: 60, clientY: 70 });
    const secondMove = getSessionListeners(add, EVENT.POINTER_MOVE).at(-1);
    expect(firstMove).not.toBe(secondMove);

    firstRender.unmount();
    const removed = getSessionListeners(remove, EVENT.POINTER_MOVE);
    expect(removed).toContain(firstMove);
    expect(removed).not.toContain(secondMove);
    expect(first.interactionState).not.toBe(second.interactionState);

    act(() => second.maybeCleanupAfterMissingPointerUp(null));
    expect(getSessionListeners(remove, EVENT.POINTER_MOVE)).toContain(
      secondMove,
    );
  });

  it("box selects and drags elements through the pointer session", async () => {
    const { container } = await render(<Excalidraw />);
    const app = window.h.app;
    const first = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 40,
      height: 40,
      backgroundColor: "#ffec99",
    });
    const second = API.createElement({
      type: "rectangle",
      x: 180,
      y: 180,
      width: 40,
      height: 40,
      backgroundColor: "#ffec99",
    });
    act(() => app.api.updateScene({ elements: [first, second] }));
    const canvas = container.querySelector("canvas.interactive")!;
    expect(app.state.activeTool.type).toBe("selection");

    fireEvent.pointerDown(canvas, { clientX: 70, clientY: 70 });
    expect(app.state.selectionElement).not.toBeNull();
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 80 });
    fireEvent.pointerMove(canvas, { clientX: 240, clientY: 240 });
    fireEvent.pointerUp(canvas, { clientX: 240, clientY: 240 });
    expect(app.state.selectedElementIds).toMatchObject({
      [first.id]: true,
      [second.id]: true,
    });

    fireEvent.pointerDown(canvas, { clientX: 110, clientY: 110 });
    fireEvent.pointerMove(canvas, { clientX: 140, clientY: 150 });
    fireEvent.pointerUp(canvas, { clientX: 140, clientY: 150 });
    expect(app.scene.getElement(first.id)).toMatchObject({ x: 130, y: 140 });
  });

  it("resizes a selection through its transform handle", async () => {
    await render(<Excalidraw />);
    const app = window.h.app;
    const element = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 100,
      height: 80,
      backgroundColor: "#ffec99",
    });
    act(() => app.api.updateScene({ elements: [element] }));

    UI.resize(element, "se", [30, 20]);

    expect(app.scene.getElement(element.id)).toMatchObject({
      width: 130,
      height: 100,
    });
  });

  it("erases a hit element and clears the pending trail", async () => {
    const { container } = await render(<Excalidraw />);
    const app = window.h.app;
    const element = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 100,
      height: 80,
      backgroundColor: "#ffec99",
    });
    act(() => app.api.updateScene({ elements: [element] }));
    UI.clickTool("eraser");
    const canvas = container.querySelector("canvas.interactive")!;

    fireEvent.pointerDown(canvas, { clientX: 110, clientY: 110 });
    fireEvent.pointerUp(canvas, { clientX: 110, clientY: 110 });

    expect(app.scene.getElement(element.id)?.isDeleted).toBe(true);
    expect(app.elementsPendingErasure.size).toBe(0);
  });

  it("does not subscribe a finished eraser-button session on the next animation frame", async () => {
    const { container } = await render(<Excalidraw />);
    const app = window.h.app;
    const canvas = container.querySelector("canvas.interactive")!;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(app.ownerWindow, "requestAnimationFrame").mockImplementation(
      (callback) => {
        frames.push(callback);
        return frames.length;
      },
    );
    const subscribe = vi.spyOn(app.missingPointerEventCleanupEmitter, "once");

    fireEvent.pointerDown(canvas, {
      clientX: 110,
      clientY: 110,
      button: POINTER_BUTTON.ERASER,
    });
    expect(app.interactionState.eraserButtonCleanup).toEqual(
      expect.any(Function),
    );

    const subscriptions = subscribe.mock.calls.length;
    act(() => app.maybeCleanupAfterMissingPointerUp(null));
    expect(app.interactionState.eraserButtonCleanup).toBeNull();
    act(() => frames.at(-1)?.(0));
    expect(subscribe).toHaveBeenCalledTimes(subscriptions);
  });
});
