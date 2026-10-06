import type { AppState, SocketId } from "@excalidraw/excalidraw/types";

import { ExcalidrawPresence } from "../src/excalidraw-presence";

import { peer, presenceChannel } from "./helpers";

import type { ExcalidrawPresenceEditor } from "../src/excalidraw-presence";

const pointer = (x: number, button: "up" | "down" = "down", touches = 1) => ({
  pointer: { x, y: -40, tool: "laser" as const },
  button,
  pointersMap: new Map(
    Array.from({ length: touches }, (_, id) => [id, { x, y: -40 }]),
  ),
});
const editor = () => ({
  getSceneElements: () => [{ id: "visible" }],
  updateScene: vi.fn<ExcalidrawPresenceEditor["updateScene"]>(),
});

beforeEach(() => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("场景 laser 指针按 33ms 尾发，抬起/多指及时清除，解除后无尾调用", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const channel = presenceChannel();
  const presence = new ExcalidrawPresence(channel.channel, vi.fn());
  const detach = presence.attach(editor(), document);
  onTestFinished(() => presence.dispose());
  presence.onPointerUpdate(pointer(400));
  presence.onPointerUpdate(pointer(500));
  expect(channel.published).toHaveLength(1);
  vi.advanceTimersByTime(33);
  expect(channel.published.at(-1)?.pointer).toEqual({
    x: 500,
    y: -40,
    tool: "laser",
  });
  presence.onPointerUpdate(pointer(600, "up"));
  expect(channel.published.at(-1)?.button).toBe("up");
  presence.onPointerUpdate(pointer(700, "down", 2));
  expect(channel.published.at(-1)?.pointer).toBeNull();
  presence.onPointerUpdate(pointer(800));
  detach();
  detach();
  expect(channel.published.at(-1)).toBeNull();
  const count = channel.published.length;
  vi.advanceTimersByTime(60_000);
  expect(channel.published).toHaveLength(count);
  expect(channel.listeners.size).toBe(0);
  expect(channel.channel.dispose).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("idle 单调时钟复核活动，ownerDocument 隐藏 AWAY/恢复 ACTIVE，并可重新绑定", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const channel = presenceChannel();
  const presence = new ExcalidrawPresence(channel.channel, vi.fn());
  const detach = presence.attach(editor(), document);
  onTestFinished(() => presence.dispose());
  vi.advanceTimersByTime(30_000);
  window.dispatchEvent(new KeyboardEvent("keydown"));
  vi.advanceTimersByTime(59_999);
  expect(channel.published.at(-1)?.idleState).toBe("ACTIVE");
  vi.advanceTimersByTime(1);
  expect(channel.published.at(-1)?.idleState).toBe("IDLE");
  window.dispatchEvent(new KeyboardEvent("keydown"));
  expect(channel.published.at(-1)?.idleState).toBe("ACTIVE");
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(channel.published.at(-1)).toMatchObject({
    idleState: "AWAY",
    pointer: null,
    button: "up",
  });
  expect(vi.getTimerCount()).toBe(0);
  detach();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  presence.attach(editor(), document);
  expect(channel.listeners.size).toBe(1);
  expect(channel.published.at(-1)?.idleState).toBe("ACTIVE");
});

test("同用户多会话独立呈现，远端选区仅显示可见元素，本地选区去重/限额/字节裁剪", () => {
  const channel = presenceChannel();
  const presence = new ExcalidrawPresence(channel.channel, vi.fn());
  const api = editor();
  presence.attach(api, document);
  onTestFinished(() => presence.dispose());
  presence.selection({ visible: true });
  presence.selection({ visible: true });
  expect(channel.published).toHaveLength(2);
  presence.selection(
    Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`id-${i}`, true]),
    ),
  );
  expect(channel.published.at(-1)?.selectedElementIds).toHaveLength(200);
  presence.selection(
    Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`${i}${"长".repeat(190)}`, true]),
    ),
  );
  expect(channel.published.at(-1)?.selectedElementIds.length).toBeLessThan(200);
  expect(
    new TextEncoder().encode(JSON.stringify(channel.published.at(-1)))
      .byteLength,
  ).toBeLessThanOrEqual(16 * 1024);
  const state = {
    pointer: { x: 20, y: 40, tool: "laser" as const },
    button: "down" as const,
    selectedElementIds: ["visible", "missing"],
    idleState: "IDLE" as const,
  };
  channel.receive([peer("peer", state), peer("other", state)]);
  const collaborators = api.updateScene.mock.calls.at(-1)?.[0].collaborators;
  expect(collaborators?.size).toBe(2);
  expect([...collaborators!.values()][0]).toMatchObject({
    userState: "idle",
    button: "down",
    selectedElementIds: { visible: true },
    pointer: state.pointer,
  });
  expect([...collaborators!.values()][0].color).not.toEqual(
    [...collaborators!.values()][1].color,
  );
  const rendered = api.updateScene.mock.calls.length;
  presence.render();
  expect(api.updateScene).toHaveBeenCalledTimes(rendered);
  channel.receive([]);
  expect(api.updateScene.mock.calls.at(-1)?.[0].collaborators?.size).toBe(0);
});

test("跟随微任务导航、范围/尺寸去重与循环/目标离线退出，不把程序滚动当用户退出", async () => {
  const channel = presenceChannel();
  const changed = vi.fn();
  const presence = new ExcalidrawPresence(channel.channel, changed);
  const viewport = {
    width: 800,
    height: 600,
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
  };
  const api = {
    ...editor(),
    getAppState: () => viewport,
    setViewport: vi.fn<NonNullable<ExcalidrawPresenceEditor["setViewport"]>>(),
  };
  presence.attach(api, document);
  onTestFinished(() => presence.dispose());
  const bounds = { minX: 100, minY: 200, maxX: 500, maxY: 500 };
  channel.receive([peer("peer", { bounds })]);
  // SocketId 是 editor 字符串品牌；通道 sessionId 使用相同会话键。
  const target = { socketId: "peer" as SocketId, username: "协作者" };
  presence.onUserFollow({ action: "FOLLOW", userToFollow: target });
  expect(api.setViewport).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(api.setViewport).toHaveBeenCalledTimes(1);
  expect(api.setViewport).toHaveBeenLastCalledWith({
    target: [100, 200, 500, 500],
    fit: "contain",
    animation: false,
    offsets: { left: 0, top: 0, right: 0, bottom: 0 },
  });
  channel.receive([peer("peer", { bounds })]);
  // Zoom 值品牌由 editor 定义，测试只构造合法的单位缩放。
  presence.onScrollChange(0, 0, { value: 1 } as AppState["zoom"]);
  expect(api.setViewport).toHaveBeenCalledTimes(1);
  expect(channel.published.at(-1)?.followTarget).toBe("peer");
  viewport.width = 1000;
  presence.render();
  expect(api.setViewport).toHaveBeenCalledTimes(2);
  channel.receive([
    peer("peer", { followTarget: "other", bounds }),
    peer("other", { followTarget: "peer" }),
  ]);
  expect(changed).toHaveBeenLastCalledWith(null);
  expect(channel.published.at(-1)?.followTarget).toBeNull();
  channel.receive([peer("peer", { bounds })]);
  presence.onUserFollow({ action: "FOLLOW", userToFollow: target });
  await Promise.resolve();
  channel.receive([]);
  expect(channel.published.at(-1)?.followTarget).toBeNull();
});

test("Presence DOM 事件限于绑定 ownerDocument，不受其他窗口隐藏影响", () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  onTestFinished(() => iframe.remove());
  const ownerDocument = iframe.contentDocument!;
  let hidden = false;
  Object.defineProperty(ownerDocument, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  const channel = presenceChannel();
  const presence = new ExcalidrawPresence(channel.channel, vi.fn());
  presence.attach(editor(), ownerDocument);
  onTestFinished(() => presence.dispose());
  const count = channel.published.length;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(channel.published).toHaveLength(count);
  hidden = true;
  ownerDocument.dispatchEvent(new Event("visibilitychange"));
  expect(channel.published.at(-1)?.idleState).toBe("AWAY");
});
