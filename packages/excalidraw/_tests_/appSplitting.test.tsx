import React from "react";
import { vi } from "vitest";

import {
  isIframeLikeInteractive,
  handleIframeLikeElementHover,
  handleIframeLikeCenterClick,
} from "../components/app/embeds";
import { insertClipboardContent } from "../components/app/clipboard";
import * as ExcalidrawData from "../data";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

describe("App controller boundaries", () => {
  beforeEach(async () => {
    unmountComponent();
    await render(<Excalidraw />);
  });

  afterEach(() => {
    vi.useRealTimers();
    unmountComponent();
  });

  it("routes mixed and plain clipboard text through their distinct paths", async () => {
    const app = window.h.app;
    const mixedContent = [
      { type: "text" as const, value: "first" },
      { type: "text" as const, value: "second" },
    ];

    await act(async () => {
      await insertClipboardContent(app, { text: "first\n\nsecond" }, [], true);
    });
    const elements = app.scene.getNonDeletedElements();
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe("text");
    if (elements[0].type === "text") {
      expect(elements[0].text).toBe("first\n\nsecond");
    }

    await act(async () => {
      await insertClipboardContent(app, { mixedContent }, [], false);
    });
    expect(
      app.scene.getNonDeletedElements().map((element) => element.type),
    ).toEqual(["text", "text", "text"]);
  });

  it("records asynchronous Magic Frame generation errors on its iframe", async () => {
    const app = window.h.app;
    const frame = API.createElement({
      type: "magicframe",
      width: 300,
      height: 300,
    });
    const child = API.createElement({ type: "rectangle", x: 20, y: 20 });
    API.setElements([frame, child]);
    const generate = vi.fn().mockRejectedValue(new Error("generation failed"));
    app.setPlugins({ diagramToCode: { generate } });

    await act(async () => {
      await app.onMagicFrameGenerate(frame, "button");
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const iframe = app.scene
      .getNonDeletedElements()
      .find((element) => element.type === "iframe");
    expect(iframe?.type).toBe("iframe");
    if (iframe?.type === "iframe") {
      expect(app.magicGenerations.get(iframe.id)).toEqual({
        status: "error",
        code: "ERR_OAI",
        message: "generation failed",
      });
      expect(iframe.customData?.generationData?.status).toBe("error");
    }
  });

  it("surfaces export failures in the editor error state", async () => {
    const app = window.h.app;
    const error = new Error("export failed");
    const exportCanvas = vi
      .spyOn(ExcalidrawData, "exportCanvas")
      .mockRejectedValueOnce(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await act(async () => {
      await app.onExportImage(
        "png",
        ExcalidrawData.prepareElementsForExport([], app.state, false)
          .exportedElements,
        { exportingFrame: null },
      );
    });

    expect(exportCanvas).toHaveBeenCalledTimes(1);
    expect(app.state.errorMessage).toBe(error.message);
    exportCanvas.mockRestore();
    consoleError.mockRestore();
  });

  it("blocks pending iframe hover and only accepts trusted player messages", () => {
    const app = window.h.app;
    const iframe = API.createElement({ type: "iframe" });
    API.setElements([iframe]);
    act(() => {
      app.setState({ viewModeEnabled: true });
    });
    app.magicGenerations.set(iframe.id, { status: "pending" });

    expect(isIframeLikeInteractive(app, iframe)).toBe(false);
    act(() => {
      expect(
        handleIframeLikeElementHover(app, {
          hitElement: iframe,
          scenePointer: { x: iframe.x + 50, y: iframe.y + 50 },
          moveEvent: {} as React.PointerEvent<HTMLCanvasElement>,
        }),
      ).toBe(false);
    });
    expect(app.state.activeEmbeddable).toBeNull();

    const message = JSON.stringify({
      event: "infoDelivery",
      id: iframe.id,
      info: { playerState: 1 },
    });
    app.embeds.onWindowMessage(
      new app.ownerWindow.MessageEvent("message", {
        origin: "https://example.com",
        data: message,
      }),
    );
    expect(app.embeds.youtubeVideoStates.has(iframe.id)).toBe(false);
    app.embeds.onWindowMessage(
      new app.ownerWindow.MessageEvent("message", {
        origin: "https://www.youtube.com",
        data: message,
      }),
    );
    expect(app.embeds.youtubeVideoStates.get(iframe.id)).toBe(1);
  });

  it("activates an iframe only after a short center click", () => {
    const app = window.h.app;
    const iframe = API.createElement({ type: "iframe" });
    API.setElements([iframe]);
    act(() => {
      app.setState({ viewModeEnabled: true });
    });
    const hitTest = vi
      .spyOn(app, "getElementAtPosition")
      .mockReturnValue(iframe);
    app.lastPointerDownEvent = {
      button: 0,
      clientX: 100,
      clientY: 100,
      timeStamp: 100,
    } as React.PointerEvent<HTMLElement>;
    app.lastPointerUpEvent = {
      clientX: 100,
      clientY: 100,
      timeStamp: 150,
    } as PointerEvent;
    vi.useFakeTimers();

    expect(handleIframeLikeCenterClick(app)).toBe(true);
    expect(app.state.activeEmbeddable).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(app.state.activeEmbeddable).toEqual({
      element: iframe,
      state: "active",
    });
    hitTest.mockRestore();
  });

  it("opens the canvas menu and switches arrow binding mode", () => {
    const app = window.h.app;
    act(() => {
      app.openContextMenu({ clientX: 100, clientY: 100 });
    });
    expect(
      app.state.contextMenu?.items.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "name" in item &&
          item.name === "paste",
      ),
    ).toBe(true);

    act(() => {
      app.setState({ bindMode: "orbit" });
      app.handleSkipBindMode();
    });
    expect(app.state.bindMode).toBe("skip");
  });
});
