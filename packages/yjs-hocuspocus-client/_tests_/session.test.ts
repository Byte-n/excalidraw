import { OutgoingMessage, Server } from "@hocuspocus/server";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { createSceneElement } from "@excalidraw/yjs";

import WebSocket from "ws";
import * as Y from "yjs";
import { expect, test, vi } from "vitest";

import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import { createHocuspocusHeadlessSession } from "../src/session";
import { createExcalidrawHocuspocusCollaboration } from "../src/collaboration";

import type { HocuspocusHeadlessSessionOptions } from "../src/index";

const startServer = async () => {
  const authenticated = vi.fn();
  const tokenSynced = vi.fn();
  const changes = vi.fn();
  const server = new Server({
    port: 0,
    address: "127.0.0.1",
    stopOnSignals: false,
    quiet: true,
    onAuthenticate: async ({ token, connectionConfig }) => {
      authenticated(token);
      if (token === "denied") {
        throw new Error("token rejected");
      }
      connectionConfig.readOnly = token === "reader";
      return {};
    },
    onTokenSync: async ({ token, connection, connectionConfig }) => {
      tokenSynced(token);
      connectionConfig.readOnly = token === "reader";
      connection.readOnly = token === "reader";
      // Hocuspocus 不会自动回传续签后的 scope，宿主协议需要明确通知客户端。
      connection.send(
        new OutgoingMessage(connection.messageAddress)
          .writeAuthenticated(connection.readOnly)
          .toUint8Array(),
      );
    },
    onChange: async (payload) => {
      changes(payload.update);
    },
  });
  await server.listen();
  return {
    server,
    url: `ws://127.0.0.1:${server.address.port}`,
    authenticated,
    tokenSynced,
    changes,
  };
};

const options = (
  url: string,
): HocuspocusHeadlessSessionOptions<ExcalidrawSceneElement, unknown> => ({
  url,
  room: "test-canvas",
  token: () => "writer",
  WebSocketPolyfill: WebSocket,
  syncTimeoutMs: 3_000,
  validateScene: () => {},
});

test("Node sessions initially synchronize and a single transaction converges between two real clients", async () => {
  const { server, url, changes } = await startServer();
  const left = createHocuspocusHeadlessSession(options(url));
  const right = createHocuspocusHeadlessSession(options(url));
  try {
    expect(typeof globalThis.window).toBe("undefined");
    await Promise.all([left.ready, right.ready]);
    expect(left.getState()).toMatchObject({
      status: "connected",
      synced: true,
      canEdit: true,
    });
    const localUpdates = vi.fn();
    left.document.on("update", localUpdates);
    changes.mockClear();
    const element = createSceneElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
    left.mutate({ mutations: [{ type: "add", element }] });
    expect(localUpdates).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(right.getScene().elements).toEqual(left.getScene().elements),
    );
    expect(changes).toHaveBeenCalledTimes(1);
  } finally {
    await Promise.all([left.close(), right.close()]);
    expect(left.document.isDestroyed).toBe(true);
    expect(right.document.isDestroyed).toBe(true);
    await server.destroy();
  }
});

test("permission flips and token refresh reuse the provider and document", async () => {
  const { server, url, authenticated, tokenSynced } = await startServer();
  let token = "reader";
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    token: () => token,
  });
  try {
    await session.ready;
    const provider = session.provider;
    const document = session.document;
    expect(session.getState().canEdit).toBe(false);
    expect(() => session.applyCommand({ elements: [] })).toThrow(
      "not writable",
    );
    token = "writer";
    await session.refreshToken();
    await vi.waitFor(() => expect(session.getState().canEdit).toBe(true));
    session.setPermission(false);
    expect(session.getState().canEdit).toBe(false);
    session.setPermission(true);
    expect(session.getState().canEdit).toBe(true);
    token = "reader";
    await session.refreshToken();
    await vi.waitFor(() => expect(session.getState().canEdit).toBe(false));
    expect(session.provider).toBe(provider);
    expect(session.document).toBe(document);
    expect(authenticated).toHaveBeenCalledTimes(1);
    expect(tokenSynced.mock.calls.map(([value]) => value)).toEqual([
      "writer",
      "reader",
    ]);
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("disconnect and reconnect retain one provider and do not reapply scene updates", async () => {
  const { server, url, changes } = await startServer();
  const session = createHocuspocusHeadlessSession(options(url));
  try {
    await session.ready;
    const provider = session.provider;
    const element = createSceneElement({
      type: "ellipse",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
    });
    session.applyCommand({ elements: [element] });
    await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
    provider.configuration.websocketProvider.disconnect();
    await vi.waitFor(() =>
      expect(session.getState().status).toBe("disconnected"),
    );
    expect(session.getState().canEdit).toBe(false);
    await session.reconnect();
    await vi.waitFor(() =>
      expect(session.getState()).toMatchObject({ synced: true, canEdit: true }),
    );
    expect(session.provider).toBe(provider);
    expect(session.getScene().elements).toHaveLength(1);
    expect(changes).toHaveBeenCalledTimes(1);
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("server authentication rejection closes owned resources and reports the reason", async () => {
  const { server, url } = await startServer();
  const onError = vi.fn();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    token: () => "denied",
    onError,
  });
  try {
    await expect(session.ready).rejects.toMatchObject({
      code: "authentication",
      message: "permission-denied",
    });
    await session.close();
    expect(session.getState().status).toBe("closed");
    expect(session.document.isDestroyed).toBe(true);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "authentication" }),
    );
  } finally {
    await session.close();
    await server.destroy();
  }
});

test.each(["abort", "timeout"] as const)(
  "%s while loading persistence cancels initialization and cleans up once",
  async (mode) => {
    const { server, url, authenticated } = await startServer();
    const abort = new AbortController();
    const close = vi.fn();
    const session = createHocuspocusHeadlessSession({
      ...options(url),
      signal: abort.signal,
      syncTimeoutMs: mode === "timeout" ? 30 : 3_000,
      persistence: {
        load: async (_document, signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
        close,
      },
    });
    try {
      if (mode === "abort") {
        abort.abort();
      }
      await expect(session.ready).rejects.toMatchObject({
        code: mode === "abort" ? "cancelled" : "timeout",
      });
      const first = session.close();
      expect(session.close()).toBe(first);
      await first;
      expect(session.document.isDestroyed).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
      expect(authenticated).not.toHaveBeenCalled();
    } finally {
      await session.close();
      await server.destroy();
    }
  },
);

test("closing a session with a borrowed document destroys its owned provider but retains the document", async () => {
  const { server, url } = await startServer();
  const document = new Y.Doc();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    document,
    ownership: "borrowed",
  });
  const destroy = vi.spyOn(session.provider, "destroy");
  try {
    await session.ready;
    await session.close();
    await session.close();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(document.isDestroyed).toBe(false);
  } finally {
    await session.close();
    document.destroy();
    await server.destroy();
  }
});

test("closing a borrowed provider session releases only session listeners and leaves the host connection usable", async () => {
  const { server, url } = await startServer();
  const document = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url,
    autoConnect: false,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    document,
    websocketProvider: socket,
    name: "test-canvas",
    token: "writer",
  });
  const hostListener = vi.fn();
  provider.on("stateless", hostListener);
  const sessionListener = vi.fn();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    document,
    provider,
    ownership: "borrowed",
    onStateless: sessionListener,
  });
  try {
    await session.ready;
    await session.close();
    await session.close();
    expect(document.isDestroyed).toBe(false);
    expect(provider.isAttached).toBe(true);
    server.hocuspocus.documents
      .get("test-canvas")!
      .broadcastStateless("after-close");
    await vi.waitFor(() => expect(hostListener).toHaveBeenCalledTimes(1));
    expect(sessionListener).not.toHaveBeenCalled();
    document
      .getMap("elements")
      .set("host", createSceneElement({ type: "diamond", x: 0, y: 0 }));
    await vi.waitFor(() =>
      expect(
        server.hocuspocus.documents
          .get("test-canvas")
          ?.getMap("elements")
          .has("host"),
      ).toBe(true),
    );
  } finally {
    await session.close();
    provider.destroy();
    socket.destroy();
    document.destroy();
    await server.destroy();
  }
});

test("an already authenticated borrowed provider is immediately ready without reconnecting", async () => {
  const { server, url, authenticated } = await startServer();
  const host = createHocuspocusHeadlessSession(options(url));
  let borrowed: ReturnType<typeof createHocuspocusHeadlessSession> | undefined;
  try {
    await host.ready;
    borrowed = createHocuspocusHeadlessSession({
      ...options(url),
      document: host.document,
      provider: host.provider,
      ownership: "borrowed",
    });
    await borrowed.ready;
    expect(borrowed.getState()).toMatchObject({ synced: true, canEdit: true });
    expect(authenticated).toHaveBeenCalledTimes(1);
    await borrowed.close();
    expect(host.document.isDestroyed).toBe(false);
    expect(host.provider.isAttached).toBe(true);
  } finally {
    await borrowed?.close();
    await host.close();
    await server.destroy();
  }
});

test("late preparation completion after close cannot connect or revive a session", async () => {
  const { server, url, authenticated } = await startServer();
  let complete!: () => void;
  const preparation = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const entered = vi.fn();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    prepare: async () => {
      entered();
      await preparation;
    },
  });
  try {
    await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(1));
    await session.close();
    await expect(session.ready).rejects.toMatchObject({ code: "cancelled" });
    complete();
    await preparation;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(session.getState().status).toBe("closed");
    expect(session.document.isDestroyed).toBe(true);
    expect(authenticated).not.toHaveBeenCalled();
  } finally {
    complete();
    await session.close();
    await server.destroy();
  }
});

test("rejected buffered edits are preserved after stopping the socket and never flushed to the authority", async () => {
  const { server, url, changes } = await startServer();
  const persistenceClosed = vi.fn();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    persistence: { load: async () => {}, close: persistenceClosed },
  });
  let copy: Uint8Array | undefined;
  try {
    await session.ready;
    // 真实 provider 的批处理窗口保留待发增量，拒绝后关闭不能将其补发。
    session.provider.configuration.flushDelay = 1_000;
    const element = createSceneElement({
      type: "rectangle",
      x: 1,
      y: 2,
      width: 40,
      height: 40,
    });
    session.applyCommand({ elements: [element] });
    expect(session.provider.hasUnsyncedChanges).toBe(true);
    session.reject({ code: "rejected", message: "scene rejected" });
    await expect(session.reconnect()).rejects.toThrow("fresh document");
    const preserve = vi.fn((document: Y.Doc) => {
      expect(persistenceClosed).toHaveBeenCalledTimes(1);
      expect(document.isDestroyed).toBe(false);
      expect(session.provider.isAttached).toBe(false);
      copy = Y.encodeStateAsUpdate(document);
    });
    await session.close({ preserve });
    await session.close({ preserve });
    expect(preserve).toHaveBeenCalledTimes(1);
    expect(session.document.isDestroyed).toBe(true);
    const recovered = new Y.Doc();
    try {
      expect(copy).toBeDefined();
      Y.applyUpdate(recovered, copy!);
      expect(recovered.getMap("elements").has(element.id)).toBe(true);
      expect(changes).not.toHaveBeenCalled();
    } finally {
      recovered.destroy();
    }
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("browser collaboration composition in Node owns one session and cleans its injected presence once without attaching an editor", async () => {
  const { server, url, authenticated } = await startServer();
  const disposePresence = vi.fn();
  const presence = vi.fn((_provider: HocuspocusProvider) => ({
    sessionId: "headless-controller",
    publish: () => {},
    subscribe: () => () => {},
    dispose: disposePresence,
  }));
  const collaboration = createExcalidrawHocuspocusCollaboration({
    ...options(url),
    presence,
    assets: {
      upload: async () => ({ size: 1, mimeType: "image/png" }),
      authorize: async () => "injected-url",
      fetch: async () => new Blob(["x"], { type: "image/png" }),
    },
  });
  try {
    await collaboration.session.ready;
    expect(presence).toHaveBeenCalledExactlyOnceWith(
      collaboration.session.provider,
    );
    expect(authenticated).toHaveBeenCalledTimes(1);
    expect(collaboration.getApi()).toBe(null);
    expect(collaboration.getSnapshot().readOnly).toBe(true);
    const closing = collaboration.close();
    collaboration.dispose();
    expect(collaboration.close()).toBe(closing);
    await closing;
    expect(disposePresence).toHaveBeenCalledTimes(1);
    expect(collaboration.session.document.isDestroyed).toBe(true);
    expect(collaboration.session.getState().status).toBe("closed");
  } finally {
    await collaboration.close();
    await server.destroy();
  }
});

test("token expiry automatically renews over the existing socket and retains the session resources", async () => {
  const { server, url, authenticated, tokenSynced } = await startServer();
  const token = vi.fn(async () => ({
    token: "writer",
    expiresAtMs: Date.now() + (token.mock.calls.length === 1 ? 1_000 : 60_000),
  }));
  const session = createHocuspocusHeadlessSession({ ...options(url), token });
  try {
    await session.ready;
    const provider = session.provider;
    const document = session.document;
    const socket = provider.configuration.websocketProvider;
    await vi.waitFor(() => expect(tokenSynced).toHaveBeenCalledWith("writer"), {
      timeout: 3_000,
    });
    expect(token).toHaveBeenCalledTimes(2);
    expect(authenticated).toHaveBeenCalledTimes(1);
    expect(session.provider).toBe(provider);
    expect(session.document).toBe(document);
    expect(session.provider.configuration.websocketProvider).toBe(socket);
    expect(session.getState()).toMatchObject({ synced: true, canEdit: true });
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("an asynchronous token provider failure rejects readiness and closes owned resources", async () => {
  const { server, url, authenticated } = await startServer();
  const cause = new Error("token endpoint unavailable");
  const onError = vi.fn();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    token: async () => {
      await Promise.resolve();
      throw cause;
    },
    onError,
  });
  const destroy = vi.spyOn(session.provider, "destroy");
  try {
    await expect(session.ready).rejects.toMatchObject({
      code: "authentication",
      message: "token provider failed",
      cause,
    });
    await session.close();
    expect(session.getState()).toMatchObject({
      status: "closed",
      canEdit: false,
    });
    expect(session.document.isDestroyed).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "authentication", cause }),
    );
    expect(authenticated).not.toHaveBeenCalled();
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("persistence cleanup failure rejects close but still destroys owned resources and reports its cause once", async () => {
  const { server, url } = await startServer();
  const cause = new Error("persistence cleanup failed");
  const onError = vi.fn();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    onError,
    persistence: {
      load: async () => {},
      close: async () => {
        throw cause;
      },
    },
  });
  const destroy = vi.spyOn(session.provider, "destroy");
  try {
    await session.ready;
    await expect(session.close()).rejects.toBe(cause);
    expect(session.document.isDestroyed).toBe(true);
    expect(session.provider.isAttached).toBe(false);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith({
      code: "transport",
      message: "session cleanup failed",
      cause,
    });
    await expect(session.close()).rejects.toBe(cause);
    expect(onError).toHaveBeenCalledTimes(1);
  } finally {
    await session.close().catch(() => {});
    await server.destroy();
  }
});

test("opted-in offline editing accumulates locally, while authentication suspension stops editing until reconnection", async () => {
  const { server, url, changes } = await startServer();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    allowOfflineEditing: true,
  });
  try {
    await session.ready;
    session.provider.configuration.websocketProvider.disconnect();
    await vi.waitFor(() =>
      expect(session.getState()).toMatchObject({
        status: "disconnected",
        synced: true,
        canEdit: true,
      }),
    );
    session.applyCommand({
      elements: [
        createSceneElement({
          type: "rectangle",
          x: 0,
          y: 0,
          width: 30,
          height: 30,
        }),
      ],
    });
    expect(session.getScene().elements).toHaveLength(1);
    expect(changes).not.toHaveBeenCalled();
    session.suspend();
    expect(session.getState()).toMatchObject({ synced: false, canEdit: false });
    const emit: unknown = Reflect.get(session.provider, "emit");
    if (typeof emit !== "function") {
      throw new Error("provider event emitter unavailable");
    }
    emit.call(session.provider, "authenticated", { scope: "read-write" });
    emit.call(session.provider, "synced", { state: true });
    expect(session.getState()).toMatchObject({ synced: false, canEdit: false });
    expect(() => session.applyCommand({ elements: [] })).toThrow();
    await session.reconnect();
    await vi.waitFor(() =>
      expect(session.getState()).toMatchObject({ synced: true, canEdit: true }),
    );
    await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("failed recovery preservation keeps the stopped original document available for export", async () => {
  const { server, url } = await startServer();
  const session = createHocuspocusHeadlessSession(options(url));
  const cause = new Error("recovery storage unavailable");
  try {
    await session.ready;
    const element = createSceneElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    session.applyCommand({ elements: [element] });
    session.reject({ code: "rejected", message: "recovery required" });
    await expect(
      session.close({
        preserve: () => {
          throw cause;
        },
      }),
    ).rejects.toBe(cause);
    expect(session.document.isDestroyed).toBe(false);
    expect(session.document.getMap("elements").get(element.id)).toEqual(
      element,
    );
    expect(session.provider.isAttached).toBe(false);
  } finally {
    session.document.destroy();
    await server.destroy();
  }
});

test("paused authentication failure keeps resources and authenticates only after an explicit retry", async () => {
  const { server, url } = await startServer();
  let token = "denied";
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    token: () => token,
    onAuthenticationFailed: () => "pause",
  });
  try {
    await vi.waitFor(() =>
      expect(session.getState()).toMatchObject({
        status: "disconnected",
        canEdit: false,
      }),
    );
    expect(session.document.isDestroyed).toBe(false);
    expect(session.provider.isAttached).toBe(false);
    token = "writer";
    await session.reconnect();
    await session.ready;
    expect(session.getState()).toMatchObject({ synced: true, canEdit: true });
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("externally managed collaboration binds before attach, accepts the initial scene and never manages borrowed resources", async () => {
  const { server, url } = await startServer();
  const authority = createHocuspocusHeadlessSession(options(url));
  await authority.ready;
  const element = createSceneElement({ type: "rectangle", x: 42, y: 0 });
  authority.mutate({ mutations: [{ type: "add", element }] });
  await vi.waitFor(() =>
    expect(
      server.hocuspocus.documents.get("test-canvas")?.getMap("elements").size,
    ).toBe(1),
  );
  const document = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url,
    autoConnect: false,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    document,
    websocketProvider: socket,
    name: "test-canvas",
    token: "writer",
  });
  const attach = vi.spyOn(provider, "attach");
  const connect = vi.spyOn(socket, "connect");
  const disconnect = vi.spyOn(socket, "disconnect");
  const sendToken = vi.spyOn(provider, "sendToken");
  const destroy = vi.spyOn(provider, "destroy");
  const observe = vi.spyOn(document, "on");
  const unobserve = vi.spyOn(document, "off");
  const disposePresence = vi.fn();
  const validateScene = vi.fn((scene: { elements: readonly unknown[] }) => {
    expect(scene.elements).toHaveLength(1);
  });
  const collaboration = createExcalidrawHocuspocusCollaboration({
    ...options(url),
    document,
    provider,
    ownership: "borrowed",
    connectionManagedExternally: true,
    syncTimeoutMs: 1,
    validateScene,
    presence: {
      sessionId: "managed-controller",
      publish: () => {},
      subscribe: () => () => {},
      dispose: disposePresence,
    },
    assets: {
      upload: async () => ({ size: 1, mimeType: "image/png" }),
      authorize: async () => "injected-url",
      fetch: async () => new Blob(["x"]),
    },
  });
  const disposeBinding = vi.spyOn(collaboration.session.binding, "dispose");
  disposePresence.mockImplementation(() => {
    expect(disposeBinding).not.toHaveBeenCalled();
  });
  try {
    expect(
      observe.mock.calls.filter(([event]) => event === "afterTransaction"),
    ).toHaveLength(1);
    expect(collaboration.session.getState().canEdit).toBe(false);
    expect(() =>
      collaboration.session.mutate({ mutations: [{ type: "add", element }] }),
    ).toThrow("not writable");
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
    expect(attach).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    provider.attach();
    await socket.connect();
    await collaboration.session.ready;
    expect(validateScene).toHaveBeenCalled();
    expect(collaboration.getScene().elements).toHaveLength(1);
    expect(collaboration.session.getState().canEdit).toBe(true);
    const sentTokens = sendToken.mock.calls.length;
    await expect(collaboration.session.reconnect()).rejects.toThrow(
      "managed externally",
    );
    await expect(collaboration.session.refreshToken()).rejects.toThrow(
      "managed externally",
    );
    collaboration.session.disconnect();
    collaboration.session.suspend();
    expect(collaboration.session.getState().canEdit).toBe(false);
    expect(disconnect).not.toHaveBeenCalled();
    collaboration.session.resume();
    expect(collaboration.session.getState().canEdit).toBe(true);
    await collaboration.session.close();
    await collaboration.close();
    expect(disposePresence).toHaveBeenCalledTimes(1);
    expect(disposeBinding).toHaveBeenCalledTimes(1);
    expect(
      unobserve.mock.calls.filter(([event]) => event === "afterTransaction"),
    ).toHaveLength(1);
    expect(destroy).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sendToken).toHaveBeenCalledTimes(sentTokens);
    expect(document.isDestroyed).toBe(false);
    expect(provider.isAttached).toBe(true);
  } finally {
    await collaboration.close();
    socket.destroy();
    provider.destroy();
    document.destroy();
    await authority.close();
    await server.destroy();
  }
});

test("externally managed session resumes authentication gates on the same provider and controller after a normal reconnect", async () => {
  const { server, url } = await startServer();
  const document = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url,
    autoConnect: false,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    document,
    websocketProvider: socket,
    name: "test-canvas",
    token: "writer",
  });
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    document,
    provider,
    ownership: "borrowed",
    connectionManagedExternally: true,
    allowOfflineEditing: true,
  });
  try {
    provider.attach();
    await socket.connect();
    await session.ready;
    session.setPermission(false);
    expect(session.getState().canEdit).toBe(false);
    session.setPermission(true);
    expect(session.getState().canEdit).toBe(true);
    socket.disconnect();
    await vi.waitFor(() =>
      expect(session.getState().status).toBe("disconnected"),
    );
    expect(session.getState().canEdit).toBe(true);
    session.suspend();
    expect(session.getState().canEdit).toBe(false);
    await socket.connect();
    await vi.waitFor(() => expect(session.getState().canEdit).toBe(true));
    expect(session.provider).toBe(provider);
    expect(session.document).toBe(document);
    session.reject({ code: "rejected", message: "authority rejected content" });
    session.resume();
    expect(session.getState().canEdit).toBe(false);
    const authenticated = new Promise<void>((resolve) => {
      provider.on("authenticated", () => resolve());
    });
    await provider.sendToken();
    await authenticated;
    expect(session.getState().status).toBe("rejected");
  } finally {
    await session.close();
    socket.destroy();
    provider.destroy();
    document.destroy();
    await server.destroy();
  }
});

test("external initial scene validation failure stops the controller gate while retaining host resources", async () => {
  const { server, url } = await startServer();
  const document = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url,
    autoConnect: false,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    document,
    websocketProvider: socket,
    name: "test-canvas",
    token: "writer",
  });
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    document,
    provider,
    ownership: "borrowed",
    connectionManagedExternally: true,
    validateScene: () => {
      throw new Error("scene budget rejected");
    },
  });
  try {
    provider.attach();
    await socket.connect();
    await expect(session.ready).rejects.toMatchObject({
      code: "rejected",
      message: "synchronized scene rejected",
    });
    expect(session.getState().canEdit).toBe(false);
    expect(document.isDestroyed).toBe(false);
    await session.close();
    expect(provider.isAttached).toBe(true);
  } finally {
    await session.close();
    socket.destroy();
    provider.destroy();
    document.destroy();
    await server.destroy();
  }
});

test("JSON 快照省略可选 undefined 并保留缺省文本尺寸，不应用宿主投影", async () => {
  const { server, url } = await startServer();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    validateScene: (scene) => {
      for (const element of scene.elements) {
        if (!element.id || !Number.isSafeInteger(element.version)) {
          throw new Error("invalid_scene");
        }
      }
    },
  });
  try {
    await session.ready;
    const element = {
      ...createSceneElement({ type: "rectangle", x: 0, y: 0 }),
      type: "text",
      width: undefined,
      height: undefined,
      optional: undefined,
    };
    const scene = { elements: [element], assets: {} };
    vi.spyOn(session.binding, "getCanonical").mockReturnValue(scene);
    const snapshot = session.getSceneSnapshot();
    expect(snapshot).toEqual(JSON.parse(JSON.stringify(scene)));
    expect(snapshot.elements[0]).not.toHaveProperty("width");
    expect(snapshot.elements[0]).not.toHaveProperty("height");
    expect(snapshot.elements[0]).not.toHaveProperty("optional");
    expect(session.getScene()).toBe(scene);
    snapshot.elements[0]!.x = 99;
    expect(element.x).toBe(0);
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("JSON 快照在复制后拒绝丢失的非枚举必需字段", async () => {
  const { server, url } = await startServer();
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    validateScene: (scene) => {
      if (
        scene.elements.some((element) => !Number.isSafeInteger(element.version))
      ) {
        throw new Error("invalid_scene");
      }
    },
  });
  try {
    await session.ready;
    const element = createSceneElement({ type: "rectangle", x: 0, y: 0 });
    Object.defineProperty(element, "version", {
      value: element.version,
      enumerable: false,
    });
    vi.spyOn(session.binding, "getCanonical").mockReturnValue({
      elements: [element],
      assets: {},
    });
    expect(() => session.getSceneSnapshot()).toThrow("invalid_scene");
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("JSON 快照拒绝 getter、toJSON、稀疏和越界数组，且不执行其方法", async () => {
  const { server, url } = await startServer();
  const session = createHocuspocusHeadlessSession(options(url));
  try {
    await session.ready;
    const getter = vi.fn(() => "secret");
    const toJSON = vi.fn(() => ({}));
    const element = createSceneElement({ type: "rectangle", x: 0, y: 0 });
    const withGetter = { ...element };
    Object.defineProperty(withGetter, "secret", {
      get: getter,
      enumerable: true,
    });
    const outOfRange = Array<typeof element>(1);
    Object.defineProperty(outOfRange, "4294967295", {
      value: element,
      enumerable: true,
    });
    const canonical = vi.spyOn(session.binding, "getCanonical");
    for (const elements of [
      [withGetter],
      [{ ...element, toJSON }],
      Array<typeof element>(1),
      outOfRange,
    ]) {
      canonical.mockReturnValue({ elements, assets: {} });
      expect(() => session.getSceneSnapshot()).toThrow("invalid_scene");
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  } finally {
    await session.close();
    await server.destroy();
  }
});

test("JSON 快照拒绝未同步完成的宿主校验", async () => {
  const { server, url } = await startServer();
  let asynchronous = false;
  const session = createHocuspocusHeadlessSession({
    ...options(url),
    validateScene: () => (asynchronous ? Promise.resolve() : undefined),
  });
  try {
    await session.ready;
    asynchronous = true;
    expect(() => session.getSceneSnapshot()).toThrow(
      "scene validation must be synchronous",
    );
  } finally {
    await session.close();
    await server.destroy();
  }
});
