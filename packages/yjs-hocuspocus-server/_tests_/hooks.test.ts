import * as Y from "yjs";
import { expect, test, vi } from "vitest";

import {
  canvasElement as element,
  deferred,
  hookRoom as room,
  startHookRoom as fixture,
} from "./helpers";

import type { HookOptions } from "./helpers";

test("a valid wire update applies, broadcasts and enters WAL exactly once", async () => {
  const f = await fixture();
  const writer = await f.client();
  const updates = vi.fn();
  f.authoritative.on("update", updates);
  writer.applyCommand({ elements: [element()] });
  await vi.waitFor(() => expect(f.accepted).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(f.observer.getScene()).toEqual(writer.getScene()),
  );
  expect(updates).toHaveBeenCalledTimes(1);
  await f.hooks.flush(room);
  expect(f.wal).toHaveLength(1);
  expect(f.wal[0]!.sequence).toBe(1);
  expect(f.wal[0]!.origin).toMatchObject({ source: "connection" });
  expect(f.rejected).not.toHaveBeenCalled();
});

test("full tombstones are accepted and real room unload flushes before repository release", async () => {
  const f = await fixture();
  const initial = element();
  f.observer.applyCommand({ elements: [initial] });
  await vi.waitFor(() => expect(f.accepted).toHaveBeenCalledTimes(1));
  f.observer.mutate({ mutations: [{ type: "delete", id: initial.id }] });
  await vi.waitFor(() => expect(f.accepted).toHaveBeenCalledTimes(2));
  expect(f.authoritative.getMap("elements").get(initial.id)).toMatchObject({
    id: initial.id,
    isDeleted: true,
    x: initial.x,
    version: 2,
  });
  await f.observer.close();
  await vi.waitFor(() => expect(f.release).toHaveBeenCalledTimes(1));
  expect(f.wal).toHaveLength(2);
  expect(f.authoritative.isDestroyed).toBe(true);
});

test("host asset authorization rejects before authoritative apply", async () => {
  const f = await fixture({
    authorizeAssets: () => {
      throw new Error("asset access denied");
    },
  });
  const writer = await f.client();
  const before = Y.encodeStateAsUpdate(f.authoritative);
  writer.applyCommand({
    elements: [element()],
    assets: { file: { size: 1, mimeType: "image/png" } },
  });
  await vi.waitFor(() => expect(f.rejected).toHaveBeenCalledTimes(1));
  expect(f.rejected.mock.calls[0]![0].error.message).toBe(
    "asset access denied",
  );
  expect(Y.encodeStateAsUpdate(f.authoritative)).toEqual(before);
  expect(f.accepted).not.toHaveBeenCalled();
  expect(f.wal).toHaveLength(0);
  await writer.close();
});

test.each([
  "unknown root",
  "array root",
  "nested Yjs data",
  "unsupported version",
  "scene budget",
  "physical delete",
  "asset rebind",
  "host relationship",
])(
  "rejects %s over the real wire without changing authoritative state",
  async (violation) => {
    const f = await fixture();
    const writer = await f.client();
    const initial = element();
    writer.applyCommand({
      elements: [initial],
      assets: { file: { size: 1, mimeType: "image/png" } },
    });
    await vi.waitFor(() => expect(f.accepted).toHaveBeenCalledTimes(1));
    const before = Y.encodeStateAsUpdate(f.authoritative);
    const updates = vi.fn();
    f.authoritative.on("update", updates);
    writer.document.transact(() => {
      if (violation === "unknown root") {
        writer.document.getMap("unexpected").set("x", 1);
      }
      if (violation === "array root") {
        writer.document.getArray("extra").push([1]);
      }
      if (violation === "nested Yjs data") {
        writer.document.getMap("assets").set("nested", new Y.Map());
      }
      if (violation === "unsupported version") {
        writer.document.getMap("canvasMeta").set("version", 3);
      }
      if (violation === "scene budget") {
        for (let i = 0; i < 3; i++) {
          const value = element();
          writer.document.getMap("elements").set(value.id, value);
        }
      }
      if (violation === "physical delete") {
        writer.document.getMap("elements").delete(initial.id);
      }
      if (violation === "asset rebind") {
        writer.document
          .getMap("assets")
          .set("file", { size: 2, mimeType: "image/png" });
      }
      if (violation === "host relationship") {
        writer.document.getMap("elements").set(initial.id, {
          ...initial,
          version: 2,
          startBinding: { elementId: "missing" },
        });
      }
    });
    await vi.waitFor(() => expect(f.rejected).toHaveBeenCalledTimes(1));
    await writer.close();
    expect(Y.encodeStateAsUpdate(f.authoritative)).toEqual(before);
    expect(updates).not.toHaveBeenCalled();
    expect(f.accepted).toHaveBeenCalledTimes(1);
    // 同 room 的另一个连接仍能成功写入，拒绝路径没有遗留锁。
    f.observer.applyCommand({ elements: [{ ...initial, x: 5, version: 2 }] });
    await vi.waitFor(() => expect(f.accepted).toHaveBeenCalledTimes(2));
  },
);

test("a read-only client cannot bypass its local gate with a raw Yjs update", async () => {
  const f = await fixture();
  const reader = await f.client("reader");
  const before = Y.encodeStateAsUpdate(f.authoritative);
  const value = element();
  reader.document.getMap("elements").set(value.id, value);
  await vi.waitFor(() => expect(f.rejected).toHaveBeenCalledTimes(1));
  await reader.close();
  expect(Y.encodeStateAsUpdate(f.authoritative)).toEqual(before);
  expect(f.accepted).not.toHaveBeenCalled();
});

test("authorization is checked again after asynchronous asset authorization", async () => {
  const gate = deferred();
  let context:
    | Parameters<HookOptions["validator"]["authorizeAssets"]>[0]["context"]
    | undefined;
  const f = await fixture({
    authorizeAssets: async (input) => {
      context = input.context;
      await gate.promise;
    },
  });
  const writer = await f.client();
  const before = Y.encodeStateAsUpdate(f.authoritative);
  writer.applyCommand({ elements: [element()] });
  await vi.waitFor(() => expect(context).toBeDefined());
  context!.connection.readOnly = true;
  gate.resolve();
  await vi.waitFor(() => expect(f.rejected).toHaveBeenCalledTimes(1));
  await writer.close();
  expect(Y.encodeStateAsUpdate(f.authoritative)).toEqual(before);
  expect(f.accepted).not.toHaveBeenCalled();
});

test("concurrent clients validate complete shadow scenes in one process room order", async () => {
  const gate = deferred();
  const lengths: number[] = [];
  const f = await fixture({
    authorizeAssets: async ({ candidate }) => {
      lengths.push(candidate.elements.length);
      if (lengths.length === 1) {
        await gate.promise;
      }
    },
  });
  const first = await f.client("first");
  const second = await f.client("second");
  first.applyCommand({ elements: [element()] });
  await vi.waitFor(() => expect(lengths).toEqual([1]));
  second.applyCommand({ elements: [element()] });
  // 首个授权临界区内尚未接纳任何更新。
  expect(f.authoritative.getMap("elements").size).toBe(0);
  gate.resolve();
  await vi.waitFor(() => expect(f.accepted).toHaveBeenCalledTimes(2));
  expect(lengths).toEqual([1, 2]);
  await vi.waitFor(() =>
    expect(
      [...first.getScene().elements].sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [...second.getScene().elements].sort((a, b) => a.id.localeCompare(b.id)),
    ),
  );
  expect(first.getScene().elements).toHaveLength(2);
});

test("awareness is sanitized before broadcast and keeps authenticated connection origin", async () => {
  const origins: unknown[] = [];
  const f = await fixture({
    validateAwareness: ({ states, connection, origin }) => {
      origins.push(origin);
      for (const state of states.values()) {
        if ("cursor" in state) {
          state.cursor = { x: 10, y: 20 };
          state.actor = connection?.context.id;
        }
      }
    },
  });
  const writer = await f.client("pointer-user");
  writer.provider.setAwarenessField("cursor", { x: 999, y: 999 });
  await vi.waitFor(() =>
    expect(
      f.observer.provider.awareness?.getStates().get(writer.document.clientID),
    ).toMatchObject({ cursor: { x: 10, y: 20 }, actor: "pointer-user" }),
  );
  expect(
    origins.some(
      (origin) =>
        typeof origin === "object" &&
        origin !== null &&
        "source" in origin &&
        origin.source === "connection",
    ),
  ).toBe(true);
  expect(f.accepted).not.toHaveBeenCalled();
});

test("awareness validation rejection leaves the authoritative awareness unchanged", async () => {
  const rejected = vi.fn();
  const f = await fixture({
    validateAwareness: ({ states }) => {
      if ([...states.values()].some((state) => state.cursor === "invalid")) {
        rejected();
        throw new Error("invalid presence");
      }
    },
  });
  const writer = await f.client("pointer-user");
  writer.provider.setAwarenessField("cursor", "invalid");
  await vi.waitFor(() => expect(rejected).toHaveBeenCalledTimes(1));
  await writer.close();
  expect(
    [...f.authoritative.awareness.getStates().values()].some(
      (state) => state.cursor === "invalid",
    ),
  ).toBe(false);
  expect(f.accepted).not.toHaveBeenCalled();
});
