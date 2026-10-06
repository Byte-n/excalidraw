import React, { StrictMode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { Excalidraw } from "../index";

import type {
  ExcalidrawCollaboration,
  ExcalidrawCollaborationPresentation,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  SocketId,
} from "../types";

const createCollaboration = () => {
  let snapshot: ExcalidrawCollaborationPresentation = {
    isCollaborating: true,
    readOnly: true,
    userToFollow: null,
  };
  const listeners = new Set<() => void>();
  const active = new Set<ExcalidrawImperativeAPI>();
  const detach = vi.fn();
  const dispose = vi.fn();
  const initializedAtAttach: boolean[] = [];
  const collaboration: ExcalidrawCollaboration & { dispose(): void } = {
    dispose,
    attach: vi.fn((api, { ownerDocument }) => {
      expect(ownerDocument).toBe(document);
      initializedAtAttach.push(!api.getAppState().isLoading);
      active.add(api);
      let attached = true;
      return () => {
        if (attached) {
          attached = false;
          active.delete(api);
          detach();
        }
      };
    }),
    getSnapshot: () => snapshot,
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    onChange: vi.fn<NonNullable<ExcalidrawProps["onChange"]>>(),
    onPointerUpdate: vi.fn<NonNullable<ExcalidrawProps["onPointerUpdate"]>>(),
    onScrollChange: vi.fn<NonNullable<ExcalidrawProps["onScrollChange"]>>(),
    onUserFollow: vi.fn<NonNullable<ExcalidrawProps["onUserFollow"]>>(),
  };
  return {
    collaboration,
    active,
    listeners,
    detach,
    dispose,
    initializedAtAttach,
    update: (next: Partial<ExcalidrawCollaborationPresentation>) => {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

const ready = async () => {
  await waitFor(() => expect(window.h.state.isLoading).toBe(false));
  return window.h.app.api;
};

afterEach(() => cleanup());

test("无协作对象保持本地初始化和原始观察回调", async () => {
  const onChange = vi.fn();
  const onPointerUpdate = vi.fn();
  const onScrollChange = vi.fn();
  const onUserFollow = vi.fn();
  const onApi = vi.fn();
  const mounted = render(
    <Excalidraw
      onChange={onChange}
      onPointerUpdate={onPointerUpdate}
      onScrollChange={onScrollChange}
      onUserFollow={onUserFollow}
      onExcalidrawAPI={onApi}
    />,
  );
  const api = await ready();
  expect(api.getAppState().viewModeEnabled).toBe(false);
  expect(window.h.app.props).toMatchObject({
    onChange,
    onPointerUpdate,
    onScrollChange,
    onUserFollow,
  });
  expect(onApi).toHaveBeenCalledWith(api);
  expect(onChange).toHaveBeenCalled();
  mounted.unmount();
  expect(onApi).toHaveBeenLastCalledWith(null);
});

test("单 prop 在 API 初始化前绑定，重复 API ready 不重复绑定", async () => {
  const fixture = createCollaboration();
  const onApi = vi.fn((api: ExcalidrawImperativeAPI | null) => {
    if (api) {
      expect(fixture.active.has(api)).toBe(true);
    } else {
      expect(fixture.active.size).toBe(0);
    }
  });
  const mounted = render(
    <Excalidraw
      collaboration={fixture.collaboration}
      onExcalidrawAPI={onApi}
    />,
  );
  const api = await ready();
  expect(fixture.collaboration.attach).toHaveBeenCalledTimes(1);
  expect(fixture.initializedAtAttach).toEqual([false]);
  act(() => window.h.app.props.onExcalidrawAPI?.(api));
  expect(fixture.collaboration.attach).toHaveBeenCalledTimes(1);
  expect(fixture.active.size).toBe(1);
  mounted.unmount();
  expect(fixture.detach).toHaveBeenCalledTimes(1);
  expect(fixture.listeners.size).toBe(0);
  expect(fixture.dispose).not.toHaveBeenCalled();
});

test("StrictMode 重挂载最终仅有一个绑定和一个订阅，清理不销毁会话", async () => {
  const fixture = createCollaboration();
  const mounted = render(
    <StrictMode>
      <Excalidraw collaboration={fixture.collaboration} />
    </StrictMode>,
  );
  await ready();
  expect(fixture.active.size).toBe(1);
  expect(fixture.listeners.size).toBe(1);
  expect(vi.mocked(fixture.collaboration.attach).mock.calls.length).toBe(
    fixture.detach.mock.calls.length + 1,
  );
  mounted.unmount();
  expect(fixture.active.size).toBe(0);
  expect(fixture.listeners.size).toBe(0);
  expect(vi.mocked(fixture.collaboration.attach).mock.calls.length).toBe(
    fixture.detach.mock.calls.length,
  );
  expect(fixture.dispose).not.toHaveBeenCalled();
});

test("呈现更新接管协作状态与跟随，显式产品只读始终优先", async () => {
  const fixture = createCollaboration();
  const mounted = render(
    <Excalidraw
      collaboration={fixture.collaboration}
      viewModeEnabled={false}
      isCollaborating={false}
    />,
  );
  const api = await ready();
  expect(api.getAppState().viewModeEnabled).toBe(true);
  expect(window.h.app.props.isCollaborating).toBe(true);
  // SocketId 是 core 的字符串品牌，fixture 使用真实协议的字符串标识。
  const userToFollow = { socketId: "peer" as SocketId, username: "协作者" };
  act(() => fixture.update({ readOnly: false, userToFollow }));
  await waitFor(() => expect(api.getAppState().viewModeEnabled).toBe(false));
  expect(window.h.app.props.userToFollow).toEqual(userToFollow);
  mounted.rerender(
    <Excalidraw collaboration={fixture.collaboration} viewModeEnabled={true} />,
  );
  act(() => fixture.update({ readOnly: true, isCollaborating: false }));
  act(() => fixture.update({ readOnly: false }));
  expect(api.getAppState().viewModeEnabled).toBe(true);
  expect(window.h.app.props.isCollaborating).toBe(false);
});

test("替换与移除对象释放旧绑定，旧订阅迟到通知不更新呈现", async () => {
  const first = createCollaboration();
  const second = createCollaboration();
  second.update({ readOnly: false, isCollaborating: false });
  const mounted = render(<Excalidraw collaboration={first.collaboration} />);
  const api = await ready();
  const staleNotification = [...first.listeners][0];
  mounted.rerender(<Excalidraw collaboration={second.collaboration} />);
  expect(first.active.size).toBe(0);
  expect(first.listeners.size).toBe(0);
  expect(second.active.has(api)).toBe(true);
  act(() => {
    first.update({ readOnly: true });
    staleNotification();
  });
  await waitFor(() => expect(api.getAppState().viewModeEnabled).toBe(false));
  expect(window.h.app.props.isCollaborating).toBe(false);
  mounted.rerender(<Excalidraw viewModeEnabled={true} />);
  expect(second.active.size).toBe(0);
  expect(second.listeners.size).toBe(0);
  expect(api.getAppState().viewModeEnabled).toBe(true);
});

test("四类事件只送达一次，协作先于业务观察且不订阅 API 同类事件", async () => {
  const fixture = createCollaboration();
  const onChange = vi.fn();
  const onPointerUpdate = vi.fn();
  const onScrollChange = vi.fn();
  const onUserFollow = vi.fn();
  render(
    <Excalidraw
      collaboration={fixture.collaboration}
      onChange={onChange}
      onPointerUpdate={onPointerUpdate}
      onScrollChange={onScrollChange}
      onUserFollow={onUserFollow}
    />,
  );
  const api = await ready();
  const subscribeChange = vi.spyOn(api, "onChange");
  const subscribeScroll = vi.spyOn(api, "onScrollChange");
  const subscribeFollow = vi.spyOn(api, "onUserFollow");
  vi.mocked(fixture.collaboration.onChange).mockClear();
  onChange.mockClear();
  const editor = window.h.app.props;
  const pointer = {
    pointer: { x: 1, y: 2, tool: "pointer" as const },
    button: "up" as const,
    pointersMap: new Map(),
  };
  // SocketId 是 core 的字符串品牌，fixture 使用真实协议的字符串标识。
  const follow = {
    action: "FOLLOW" as const,
    userToFollow: { socketId: "peer" as SocketId, username: "协作者" },
  };
  act(() => {
    editor.onChange?.(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
    );
    editor.onPointerUpdate?.(pointer);
    editor.onScrollChange?.(3, 4, api.getAppState().zoom);
    editor.onUserFollow?.(follow);
  });
  for (const [handler, observer] of [
    [fixture.collaboration.onChange, onChange],
    [fixture.collaboration.onPointerUpdate, onPointerUpdate],
    [fixture.collaboration.onScrollChange, onScrollChange],
    [fixture.collaboration.onUserFollow, onUserFollow],
  ] as const) {
    const calls = vi.mocked(handler);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls).toEqual(observer.mock.calls);
    expect(calls.mock.invocationCallOrder[0]).toBeLessThan(
      observer.mock.invocationCallOrder[0],
    );
  }
  expect(subscribeChange).not.toHaveBeenCalled();
  expect(subscribeScroll).not.toHaveBeenCalled();
  expect(subscribeFollow).not.toHaveBeenCalled();
});

test("业务观察抛错不撤销协作绑定，卸载仍释放订阅", async () => {
  const fixture = createCollaboration();
  const failure = new Error("观察失败");
  const mounted = render(
    <Excalidraw
      collaboration={fixture.collaboration}
      onPointerUpdate={() => {
        throw failure;
      }}
    />,
  );
  await ready();
  expect(() =>
    window.h.app.props.onPointerUpdate?.({
      pointer: { x: 1, y: 2, tool: "pointer" },
      button: "up",
      pointersMap: new Map(),
    }),
  ).toThrow(failure);
  expect(fixture.collaboration.onPointerUpdate).toHaveBeenCalledTimes(1);
  expect(fixture.active.size).toBe(1);
  mounted.unmount();
  expect(fixture.active.size).toBe(0);
  expect(fixture.listeners.size).toBe(0);
});
