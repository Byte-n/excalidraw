import { createSceneElement } from "@excalidraw/yjs";
import * as Y from "yjs";
import { expect, test, vi } from "vitest";

import { deferred, startPersistenceRoom } from "./helpers";

import type { CanvasPersistenceUpdate, CanvasRepository } from "../src/index";

test("failed WAL append retains its batch and updates arriving during append remain queued", async () => {
  const entered = deferred();
  const finish = deferred();
  const failure = new Error("WAL unavailable");
  const batches: (readonly CanvasPersistenceUpdate[])[] = [];
  let fail = true;
  const fixture = await startPersistenceRoom({
    load: async () => [],
    append: async (_room, updates) => {
      batches.push(updates);
      if (fail) {
        entered.resolve();
        await finish.promise;
        fail = false;
        throw failure;
      }
    },
    snapshot: async () => {},
    release: async () => {},
  });
  try {
    fixture.addLocal("first");
    const flush = fixture.hooks.flush(fixture.room);
    const rejected = expect(flush).rejects.toMatchObject({ cause: failure });
    await entered.promise;
    fixture.addLocal("during-append");
    finish.resolve();
    await rejected;
    await fixture.hooks.flush(fixture.room);
    expect(
      batches.map((batch) => batch.map(({ sequence }) => sequence)),
    ).toEqual([[1], [1, 2]]);
    await fixture.hooks.flush(fixture.room);
    expect(batches).toHaveLength(2);
    expect(fixture.onError).toHaveBeenCalledExactlyOnceWith({
      room: fixture.room,
      operation: "flush",
      error: failure,
    });
  } finally {
    finish.resolve();
    await fixture.close();
  }
});

test("snapshot watermark includes only encoded updates and preserves later WAL", async () => {
  const entered = deferred();
  const finish = deferred();
  const wal = new Map<number, Uint8Array>();
  const snapshots: { update: Uint8Array; throughSequence: number }[] = [];
  let pause = true;
  const fixture = await startPersistenceRoom({
    load: async () => [],
    append: async (_room, updates) => {
      if (pause) {
        pause = false;
        entered.resolve();
        await finish.promise;
      }
      updates.forEach(({ sequence, update }) => wal.set(sequence, update));
    },
    snapshot: async (_room, input) => {
      snapshots.push(input);
      for (const sequence of wal.keys()) {
        if (sequence <= input.throughSequence) {
          wal.delete(sequence);
        }
      }
    },
    release: async () => {},
  });
  const recovered = new Y.Doc();
  try {
    fixture.addLocal("included");
    const snapshot = fixture.hooks.snapshot(fixture.room);
    await entered.promise;
    fixture.addLocal("after-watermark");
    finish.resolve();
    await snapshot;
    await fixture.hooks.flush(fixture.room);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].throughSequence).toBe(1);
    expect([...wal.keys()]).toEqual([2]);
    Y.applyUpdate(recovered, snapshots[0].update);
    expect([...recovered.getMap("elements").keys()]).toEqual(["included"]);
    wal.forEach((update) => Y.applyUpdate(recovered, update));
    expect([...recovered.getMap("elements").keys()].sort()).toEqual([
      "after-watermark",
      "included",
    ]);
  } finally {
    finish.resolve();
    recovered.destroy();
    await fixture.close();
  }
});

test("snapshot and release failures can retry without duplicating successful WAL writes", async () => {
  const failure = new Error("storage temporarily unavailable");
  const append = vi.fn(async () => {});
  const snapshot = vi.fn(async () => {}).mockRejectedValueOnce(failure);
  const release = vi.fn(async () => {}).mockRejectedValueOnce(failure);
  const fixture = await startPersistenceRoom({
    load: async () => [],
    append,
    snapshot,
    release,
  });
  try {
    fixture.addLocal("persisted");
    await expect(fixture.hooks.snapshot(fixture.room)).rejects.toMatchObject({
      cause: failure,
    });
    await fixture.hooks.snapshot(fixture.room);
    expect(append).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(2);
    await expect(fixture.hooks.release(fixture.room)).rejects.toMatchObject({
      cause: failure,
    });
    fixture.addLocal("after-release-failure");
    await fixture.hooks.release(fixture.room);
    expect(append).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(
      fixture.onError.mock.calls.map(([input]) => input.operation),
    ).toEqual(["snapshot", "release"]);
  } finally {
    await fixture.close();
  }
});

test("invalidated epochs cannot commit an in-flight append or create a snapshot", async () => {
  const entered = deferred();
  const finish = deferred();
  let activeFence = 1;
  const committed: CanvasPersistenceUpdate[] = [];
  const snapshot = vi.fn(async () => {});
  const repository: CanvasRepository<number> = {
    load: async () => [],
    append: async (room, updates) => {
      entered.resolve();
      await finish.promise;
      if (room.fence !== activeFence) {
        throw new Error("stale epoch");
      }
      committed.push(...updates);
    },
    snapshot,
    release: async () => {},
  };
  const fixture = await startPersistenceRoom(repository);
  try {
    fixture.addLocal("stale-write");
    const pending = fixture.hooks.snapshot(fixture.room);
    const rejected = expect(pending).rejects.toThrow("WAL flush failed");
    await entered.promise;
    activeFence = 2;
    fixture.hooks.invalidate(fixture.room);
    fixture.addLocal("ignored-after-invalidation");
    finish.resolve();
    await rejected;
    await expect(fixture.hooks.flush(fixture.room)).rejects.toThrow(
      "room is unavailable",
    );
    await expect(fixture.hooks.snapshot(fixture.room)).rejects.toThrow(
      "room is unavailable",
    );
    expect(committed).toEqual([]);
    expect(snapshot).not.toHaveBeenCalled();
  } finally {
    finish.resolve();
    await fixture.close();
  }
});

test("repository fence rejects an old epoch snapshot already in flight", async () => {
  const entered = deferred();
  const finish = deferred();
  let activeFence = 1;
  let committedSnapshot: Uint8Array | undefined;
  const wal = new Map<number, Uint8Array>();
  const fixture = await startPersistenceRoom({
    load: async () => [],
    append: async (room, updates) => {
      if (room.fence !== activeFence) {
        throw new Error("stale append epoch");
      }
      updates.forEach(({ sequence, update }) => wal.set(sequence, update));
    },
    snapshot: async (room, input) => {
      entered.resolve();
      await finish.promise;
      if (room.fence !== activeFence) {
        throw new Error("stale snapshot epoch");
      }
      committedSnapshot = input.update;
      for (const sequence of wal.keys()) {
        if (sequence <= input.throughSequence) {
          wal.delete(sequence);
        }
      }
    },
    release: async () => {},
  });
  try {
    fixture.addLocal("old-epoch");
    const pending = fixture.hooks.snapshot(fixture.room);
    const rejected = expect(pending).rejects.toThrow("snapshot failed");
    await entered.promise;
    activeFence = 2;
    fixture.hooks.invalidate(fixture.room);
    finish.resolve();
    await rejected;
    expect(committedSnapshot).toBeUndefined();
    expect([...wal.keys()]).toEqual([1]);
    expect(fixture.onError).toHaveBeenCalledTimes(1);
    expect(fixture.onError.mock.calls[0][0].operation).toBe("snapshot");
  } finally {
    finish.resolve();
    await fixture.close();
  }
});

test("WAL retains host origins and authenticated remote transaction origins", async () => {
  const stored: CanvasPersistenceUpdate[] = [];
  const fixture = await startPersistenceRoom({
    load: async () => [],
    append: async (_room, updates) => {
      stored.push(...updates);
    },
    snapshot: async () => {},
    release: async () => {},
  });
  const hostOrigin = { source: "host-operation" };
  try {
    fixture.addLocal("host", hostOrigin);
    const element = createSceneElement({ type: "ellipse", x: 0, y: 0 });
    fixture.session.mutate({ mutations: [{ type: "add", element }] });
    await vi.waitFor(() =>
      expect(fixture.document.getMap("elements").has(element.id)).toBe(true),
    );
    await fixture.hooks.flush(fixture.room);
    expect(stored).toHaveLength(2);
    expect(stored[0].origin).toBe(hostOrigin);
    expect(stored[1].origin).toMatchObject({ source: "connection" });
    expect(stored[1].origin).not.toBe(hostOrigin);
  } finally {
    await fixture.close();
  }
});

test("asynchronous accepted callback rejection is reported once while its update remains durable", async () => {
  const failure = new Error("downstream notification failed");
  const append = vi.fn(async () => {});
  const fixture = await startPersistenceRoom(
    {
      load: async () => [],
      append,
      snapshot: async () => {},
      release: async () => {},
    },
    async () => {
      await Promise.resolve();
      throw failure;
    },
  );
  try {
    fixture.addLocal("accepted");
    await vi.waitFor(() =>
      expect(fixture.onError).toHaveBeenCalledExactlyOnceWith({
        room: fixture.room,
        operation: "accepted",
        error: failure,
      }),
    );
    await fixture.hooks.flush(fixture.room);
    expect(append).toHaveBeenCalledTimes(1);
    expect(fixture.document.getMap("elements").has("accepted")).toBe(true);
    expect(fixture.onError).toHaveBeenCalledTimes(1);
  } finally {
    await fixture.close();
  }
});
