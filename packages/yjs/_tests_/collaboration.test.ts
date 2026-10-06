import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import * as Y from "yjs";

import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";

import { createExcalidrawCollaboration } from "../src";

import { element, peer, presenceChannel, validateScene } from "./helpers";

afterEach(cleanup);

const setup = () => {
  const document = new Y.Doc();
  document.getMap("elements").set("a", element());
  const channel = presenceChannel();
  const onError = vi.fn();
  const collaboration = createExcalidrawCollaboration({
    document,
    presence: channel.channel,
    assets: {
      upload: async () => ({ size: 3, mimeType: "image/png" }),
      authorize: async () => "signed",
      fetch: async () => new Blob(["abc"], { type: "image/png" }),
    },
    state: { canEdit: true, synced: true, online: true, isCollaborating: true },
    validateScene,
    onError,
  });
  onTestFinished(() => {
    collaboration.dispose();
    document.destroy();
  });
  return { document, collaboration, channel, onError };
};

test("单 collaboration prop 完成场景回灌/写入、选区 Presence 与远端会话呈现", async () => {
  const { document, collaboration, channel, onError } = setup();
  render(createElement(Excalidraw, { collaboration }));
  await waitFor(() => expect(collaboration.getSnapshot().readOnly).toBe(false));
  const api = collaboration.getApi()!;
  expect(api.getSceneElements()[0].id).toBe("a");
  const updates = vi.fn();
  document.on("update", updates);
  act(() => api.updateScene({ appState: { selectedElementIds: { a: true } } }));
  await waitFor(() =>
    expect(channel.published.at(-1)?.selectedElementIds).toEqual(["a"]),
  );
  expect(updates).not.toHaveBeenCalled();
  act(() =>
    channel.receive([
      peer("peer", {
        selectedElementIds: ["a"],
        pointer: { x: 40, y: 80, tool: "laser" },
      }),
    ]),
  );
  await waitFor(() => expect(api.getAppState().collaborators.size).toBe(1));
  expect(updates).not.toHaveBeenCalled();
  act(() =>
    api.updateScene({
      elements: api
        .getSceneElements()
        .map((value) => ({ ...value, x: 30, version: value.version + 1 })),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
  await waitFor(() => expect(collaboration.getScene().elements[0].x).toBe(30));
  expect(updates).toHaveBeenCalledTimes(1);
  act(() => collaboration.updateState({ canEdit: false }));
  expect(collaboration.getSnapshot().readOnly).toBe(true);
  expect(() =>
    collaboration.applyCommand({ elements: [element("a", 90)] }),
  ).toThrow();
  expect(onError).not.toHaveBeenCalled();
});

test("StrictMode、对象替换和重新挂载仅解除 editor，最终 dispose 才释放 Presence 通道", async () => {
  const first = setup();
  const second = setup();
  const mounted = render(
    createElement(
      StrictMode,
      null,
      createElement(Excalidraw, { collaboration: first.collaboration }),
    ),
  );
  await waitFor(() =>
    expect(first.collaboration.getSnapshot().readOnly).toBe(false),
  );
  expect(first.channel.listeners.size).toBe(1);
  const clearHistory = vi.spyOn(first.collaboration.getApi()!.history, "clear");
  mounted.rerender(
    createElement(
      StrictMode,
      null,
      createElement(Excalidraw, { collaboration: second.collaboration }),
    ),
  );
  await waitFor(() =>
    expect(second.collaboration.getSnapshot().readOnly).toBe(false),
  );
  expect(clearHistory).toHaveBeenCalledTimes(1);
  expect(first.collaboration.getApi()).toBeNull();
  expect(first.channel.listeners.size).toBe(0);
  expect(first.channel.channel.dispose).not.toHaveBeenCalled();
  mounted.unmount();
  expect(second.channel.listeners.size).toBe(0);
  expect(second.channel.published.at(-1)).toBeNull();
  expect(second.channel.channel.dispose).not.toHaveBeenCalled();
  render(createElement(Excalidraw, { collaboration: first.collaboration }));
  await waitFor(() =>
    expect(first.collaboration.getSnapshot().readOnly).toBe(false),
  );
  expect(first.channel.listeners.size).toBe(1);
  act(() => first.collaboration.dispose());
  expect(first.channel.channel.dispose).toHaveBeenCalledTimes(1);
  first.document.getMap("host").set("still-alive", true);
  expect(first.document.getMap("host").get("still-alive")).toBe(true);
});

test("预备导入 commit 由入口原子发布并立即显示，无需宿主刷新", async () => {
  const { document, collaboration } = setup();
  render(createElement(Excalidraw, { collaboration }));
  await waitFor(() => expect(collaboration.getSnapshot().readOnly).toBe(false));
  const prepared = collaboration.prepareImportCommand({
    elements: [element("imported", 10)],
    deleteIds: ["a"],
  });
  const updates = vi.fn();
  document.on("update", updates);
  act(() => prepared.commit());
  expect(
    collaboration
      .getApi()!
      .getSceneElements()
      .map((value) => value.id),
  ).toEqual(["imported"]);
  expect(updates).toHaveBeenCalledTimes(1);
});

test("初始业务校验失败可观察且只读，立即释放文档监听并保留原数据", () => {
  const document = new Y.Doc();
  document
    .getMap("elements")
    .set("invalid", element("invalid", 0, { index: "" }));
  const on = vi.spyOn(document, "on");
  const off = vi.spyOn(document, "off");
  const onError = vi.fn();
  const channel = presenceChannel();
  const collaboration = createExcalidrawCollaboration({
    document,
    presence: channel.channel,
    state: { canEdit: true, synced: true, online: true, isCollaborating: true },
    validateScene,
    onError,
    assets: {
      upload: async () => ({ size: 3, mimeType: "image/png" }),
      authorize: async () => "signed",
      fetch: async () => new Blob(["abc"]),
    },
  });
  expect(onError).toHaveBeenCalledWith(expect.any(Error), "restore");
  expect(collaboration.getSnapshot().readOnly).toBe(true);
  const registered = on.mock.calls.find(
    ([event]) => event === "afterTransaction",
  );
  expect(registered).toBeDefined();
  expect(off).toHaveBeenCalledWith(...registered!);
  expect(() => collaboration.getScene()).toThrow("校验失败");
  expect(document.getMap("elements").has("invalid")).toBe(true);
  collaboration.dispose();
  expect(channel.channel.dispose).toHaveBeenCalledTimes(1);
  expect(document.isDestroyed).toBe(false);
  document.destroy();
});
