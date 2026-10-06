import { Server } from "@hocuspocus/server";
import { createSceneElement } from "@excalidraw/yjs";
import WebSocket from "ws";
import { onTestFinished, vi } from "vitest";

import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import { createHocuspocusHeadlessSession } from "../../yjs-hocuspocus-client/src/session";
import { createCanvasHocuspocusHooks } from "../src/index";

import type { HocuspocusHeadlessSession } from "../../yjs-hocuspocus-client/src/index";

import type {
  CanvasHocuspocusHooksOptions,
  CanvasPersistenceUpdate,
  CanvasRepository,
} from "../src/index";

export const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

export const startPersistenceRoom = async (
  repository: CanvasHocuspocusHooksOptions<
    ExcalidrawSceneElement,
    unknown,
    { actor: string },
    string,
    number
  >["repository"],
  onAccepted?: CanvasHocuspocusHooksOptions<
    ExcalidrawSceneElement,
    unknown,
    { actor: string },
    string,
    number
  >["onAccepted"],
) => {
  const onError = vi.fn();
  const hooks = createCanvasHocuspocusHooks<
    ExcalidrawSceneElement,
    unknown,
    { actor: string },
    string,
    number
  >({
    resolveRoom: (name) => ({ name, fence: 1 }),
    repository,
    validator: {
      validateScene: () => {},
      validateTransition: () => {},
      authorizeAssets: () => {},
    },
    resolveActor: (connection) => connection.context.actor,
    authorize: () => {},
    validateAwareness: () => {},
    onAccepted,
    onError,
  });
  // 持久化时机由测试显式驱动，网络接纳仍经过真实 Hocuspocus hooks。
  const server = new Server<{ actor: string }>({
    port: 0,
    address: "127.0.0.1",
    stopOnSignals: false,
    quiet: true,
    extensions: [
      {
        onLoadDocument: hooks.onLoadDocument,
        beforeSync: hooks.beforeSync,
        beforeHandleMessage: hooks.beforeHandleMessage,
        afterHandleMessage: hooks.afterHandleMessage,
        beforeHandleAwareness: hooks.beforeHandleAwareness,
        onChange: hooks.onChange,
      },
    ],
    onAuthenticate: async () => ({ actor: "writer" }),
  });
  await server.listen();
  const room = "persistence-canvas";
  const session = createHocuspocusHeadlessSession({
    url: `ws://127.0.0.1:${server.address.port}`,
    room,
    token: () => "writer",
    WebSocketPolyfill: WebSocket,
    syncTimeoutMs: 3_000,
    validateScene: () => {},
  });
  await session.ready;
  const document = server.hocuspocus.documents.get(room);
  if (!document) {
    throw new Error("synchronized room is missing");
  }
  const addLocal = (id: string, origin: unknown = "host") => {
    document.transact(() => {
      document.getMap("elements").set(id, {
        ...createSceneElement({ type: "rectangle", x: 0, y: 0 }),
        id,
      });
    }, origin);
  };
  return {
    hooks,
    room,
    session,
    document,
    addLocal,
    onError,
    close: async () => {
      await hooks.release(room);
      await session.close();
      await server.destroy();
    },
  };
};

type Context = { id: string };
type Asset = { size: number; mimeType: string };
export type HookOptions = CanvasHocuspocusHooksOptions<
  ExcalidrawSceneElement,
  Asset,
  Context,
  string,
  number
>;
type Session = HocuspocusHeadlessSession<ExcalidrawSceneElement, Asset>;
export const hookRoom = "test-canvas";
export const canvasElement = () =>
  createSceneElement({ type: "rectangle", x: 0, y: 0, width: 100, height: 80 });

export const startHookRoom = async (
  overrides: {
    authorizeAssets?: HookOptions["validator"]["authorizeAssets"];
    authorize?: HookOptions["authorize"];
    append?: CanvasRepository<number>["append"];
    release?: CanvasRepository<number>["release"];
    snapshot?: CanvasRepository<number>["snapshot"];
    validateAwareness?: HookOptions["validateAwareness"];
  } = {},
) => {
  const wal: CanvasPersistenceUpdate[] = [];
  const append = vi.fn(
    async (...args: Parameters<CanvasRepository<number>["append"]>) => {
      await overrides.append?.(...args);
      wal.push(...args[1]);
    },
  );
  const snapshots: { update: Uint8Array; throughSequence: number }[] = [];
  const snapshot = vi.fn(
    async (...args: Parameters<CanvasRepository<number>["snapshot"]>) => {
      await overrides.snapshot?.(...args);
      snapshots.push(args[1]);
    },
  );
  const release = vi.fn(
    async (...args: Parameters<CanvasRepository<number>["release"]>) => {
      await overrides.release?.(...args);
    },
  );
  const rejected = vi.fn();
  const accepted = vi.fn();
  const errors = vi.fn();
  const hooks = createCanvasHocuspocusHooks<
    ExcalidrawSceneElement,
    Asset,
    Context,
    string,
    number
  >({
    resolveRoom: (name) => ({ name, fence: 1 }),
    repository: { load: async () => [], append, snapshot, release },
    extraRootMaps: ["canvasMeta", "extra"],
    initialize: (document) => {
      document.getMap("canvasMeta").set("version", 2);
    },
    validateDocument: (document) => {
      if (document.getMap("canvasMeta").get("version") !== 2) {
        throw new Error("unsupported scene version");
      }
    },
    validator: {
      validateScene: (scene) => {
        if (scene.elements.length > 3) {
          throw new Error("scene budget exceeded");
        }
        for (const value of scene.elements) {
          if (typeof value.x !== "number" || !Number.isFinite(value.x)) {
            throw new Error("invalid element geometry");
          }
        }
      },
      validateTransition: ({ candidate }) => {
        // 关系硬约束仅是这个宿主的政策，不属于通用包协议。
        for (const value of candidate.elements) {
          const binding = value.startBinding;
          if (
            binding &&
            typeof binding === "object" &&
            "elementId" in binding &&
            !candidate.elements.some(
              (target) => target.id === binding.elementId,
            )
          ) {
            throw new Error("host relationship rejected");
          }
        }
      },
      authorizeAssets: overrides.authorizeAssets ?? (() => {}),
    },
    resolveActor: (connection) => connection.context.id,
    authorize: overrides.authorize ?? (() => {}),
    validateAwareness: overrides.validateAwareness ?? (() => {}),
    onRejected: rejected,
    onAccepted: accepted,
    onError: errors,
  });
  const server = new Server<Context>({
    port: 0,
    address: "127.0.0.1",
    quiet: true,
    stopOnSignals: false,
    debounce: 60_000,
    maxDebounce: 60_000,
    ...hooks,
    onAuthenticate: async ({ token, connectionConfig }) => {
      connectionConfig.readOnly = token === "reader";
      return { id: token };
    },
  });
  await server.listen();
  const sessions: Session[] = [];
  const client = async (token = "writer") => {
    const session = createHocuspocusHeadlessSession<
      ExcalidrawSceneElement,
      Asset
    >({
      room: hookRoom,
      url: `ws://127.0.0.1:${server.address.port}`,
      token: () => token,
      WebSocketPolyfill: WebSocket,
      validateScene: () => {},
      syncTimeoutMs: 3_000,
    });
    sessions.push(session);
    await session.ready;
    return session;
  };
  onTestFinished(async () => {
    await Promise.all(sessions.map((session) => session.close()));
    await server.destroy();
  });
  const observer = await client("observer");
  const authoritative = server.hocuspocus.documents.get(hookRoom)!;
  return {
    hooks,
    server,
    client,
    observer,
    authoritative,
    wal,
    append,
    snapshots,
    snapshot,
    release,
    rejected,
    accepted,
    errors,
  };
};
