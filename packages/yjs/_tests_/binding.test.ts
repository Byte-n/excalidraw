import * as Y from "yjs";

import {
  createSceneBinding,
  createSceneSession,
  createYjsSceneBinding,
} from "../src/index";
import { createFollowGraph } from "../src/index";

test("follow graph rejects arbitrary cycles and missing targets", () => {
  const graph = createFollowGraph("self");
  expect(
    graph.validChain(
      "a",
      new Map([
        ["a", { followTarget: "b" }],
        ["b", { followTarget: null }],
      ]),
    ),
  ).toBe(true);
  expect(
    graph.validChain(
      "a",
      new Map([
        ["a", { followTarget: "b" }],
        ["b", { followTarget: "a" }],
      ]),
    ),
  ).toBe(false);
});

type Element = { id: string; value: number; version?: number };

test("writes complete snapshots in one transaction and leaves the host doc alive", () => {
  const doc = new Y.Doc();
  const binding = createYjsSceneBinding<Element>({ doc, origin: "local" });
  const updates: Uint8Array[] = [];
  doc.on("update", (update) => updates.push(update));

  binding.transact([{ id: "a", value: 1 }]);
  binding.transact([
    { id: "a", value: 2 },
    { id: "b", value: 3 },
  ]);

  expect(binding.getElements()).toEqual([
    { id: "a", value: 2 },
    { id: "b", value: 3 },
  ]);
  expect(updates).toHaveLength(2);
  binding.dispose();
  expect(doc.getMap("elements").size).toBe(2);
  doc.destroy();
});

test("gates local writes, suppresses origin echo, and propagates between Y.Docs", () => {
  const first = new Y.Doc();
  const second = new Y.Doc();
  const remote = vi.fn();
  const left = createSceneBinding<Element>({
    doc: first,
    onRemoteChange: remote,
  });
  const right = createSceneBinding<Element>({ doc: second });
  expect(() => left.applyLocal([{ id: "blocked", value: 0 }])).toThrow(
    "not writable",
  );
  left.setGate({
    initialized: true,
    synced: true,
    canEdit: true,
    generation: 3,
  });
  left.applyLocal([{ id: "a", value: 1 }]);
  expect(remote).not.toHaveBeenCalled();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  expect(right.getElements()).toEqual([{ id: "a", value: 1 }]);
  expect(left.isCurrent(3)).toBe(true);
  left.dispose();
  expect(left.isCurrent(3)).toBe(false);
  first.destroy();
  second.destroy();
});

test("generation and dispose isolate late callbacks; session keeps display watermarks", () => {
  const doc = new Y.Doc();
  const binding = createSceneBinding<Element>({ doc });
  binding.setGate({
    initialized: true,
    synced: true,
    canEdit: true,
    generation: 1,
  });
  const session = createSceneSession(binding);
  binding.applyLocal([{ id: "a", value: 1, version: 1 }]);
  const projected = session.project();
  expect(projected).toHaveLength(1);
  expect(binding.runIfCurrent(2, () => "late")).toBeUndefined();
  binding.setGate({ generation: 2 });
  expect(binding.runIfCurrent(1, () => "stale")).toBeUndefined();
  session.publish([{ id: "a", value: 2 }]);
  expect(binding.getElements()[0]).toMatchObject({
    id: "a",
    value: 2,
    version: 2,
  });
  session.dispose();
  binding.dispose();
  expect(() => binding.applyLocal([{ id: "a", value: 3 }])).toThrow("disposed");
  doc.destroy();
});

test("session raises display watermark for lower canonical version and preserves nonce changes", () => {
  const doc = new Y.Doc();
  const binding = createSceneBinding<{
    id: string;
    value: number;
    version?: number;
    versionNonce?: number;
  }>({ doc });
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  binding.applyLocal([{ id: "a", value: 1, version: 10, versionNonce: 10 }]);
  const session = createSceneSession(binding);
  const first = session.project();
  session.accept(first);
  binding.applyLocal([{ id: "a", value: 2, version: 3, versionNonce: 11 }]);
  const lower = session.project();
  expect(lower[0]).toMatchObject({ value: 2, version: 12, versionNonce: 11 });
  session.accept(lower);
  session.publish([{ ...lower[0], value: 3, version: 12, versionNonce: 12 }]);
  expect(binding.getElements()[0]).toMatchObject({
    value: 3,
    version: 4,
    versionNonce: 12,
  });
  session.dispose();
  binding.dispose();
  doc.destroy();
});

test("session reverses projected geometry relative to display baseline and publishes new elements", () => {
  const doc = new Y.Doc();
  const binding = createSceneBinding<{
    id: string;
    x: number;
    version?: number;
  }>({ doc });
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  binding.applyLocal([{ id: "a", x: 10, version: 1 }]);
  const session = createSceneSession(binding, (elements) =>
    elements.map((element) => ({ ...element, x: element.x + 20 })),
  );
  const display = session.project();
  session.accept(display);
  session.publish([{ ...display[0], x: display[0].x + 5 }]);
  expect(binding.getElements()[0]).toMatchObject({ x: 15, version: 2 });
  session.publish([{ id: "new", x: 4, version: 1 }]);
  expect(
    binding.getElements().find((element) => element.id === "new"),
  ).toMatchObject({ x: 4 });
  session.dispose();
  binding.dispose();
  doc.destroy();
});

test("binding exposes canonical scene commands with generation and adapter validation", () => {
  const doc = new Y.Doc();
  const remote = vi.fn();
  const binding = createSceneBinding<Element>({
    doc,
    onRemoteChange: remote,
    adapter: {
      validateCanonical: (scene) => {
        expect(scene.elements.every((element) => element.id)).toBe(true);
      },
    },
  });
  binding.setGate({
    initialized: true,
    synced: true,
    canEdit: true,
    generation: 4,
  });
  binding.applyCommand({ elements: [{ id: "a", value: 1 }] }, 4);
  expect(binding.getCanonical()).toEqual({
    elements: [{ id: "a", value: 1 }],
    assets: {},
  });
  expect(() => binding.applyCommand({ elements: [] }, 3)).toThrow("generation");
  expect(binding.applyCommand({ elements: [], deleteIds: ["a"] }, 4)).toEqual([
    "a",
  ]);
  expect(binding.getCanonical().elements[0]).toMatchObject({ isDeleted: true });
  expect(remote).not.toHaveBeenCalled();
  binding.dispose();
  doc.destroy();
});

test("commands preserve unrelated canonical elements and create fresh tombstone nonces", () => {
  const doc = new Y.Doc();
  const binding = createSceneBinding<{
    id: string;
    value: number;
    version?: number;
    versionNonce?: number;
    isDeleted?: boolean;
  }>({ doc });
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  binding.applyCommand({
    elements: [
      { id: "keep", value: 1, version: 1, versionNonce: 10 },
      { id: "remove", value: 2, version: 4, versionNonce: 20 },
    ],
  });
  const changed = binding.applyCommand({
    elements: [],
    deleteIds: ["remove"],
  });
  expect(changed).toEqual(["remove"]);
  expect(binding.getCanonical().elements).toEqual([
    { id: "keep", value: 1, version: 1, versionNonce: 10 },
    expect.objectContaining({
      id: "remove",
      isDeleted: true,
      version: 5,
    }),
  ]);
  const tombstone = binding.getCanonical().elements[1]! as {
    versionNonce?: number;
  };
  expect(tombstone.versionNonce).not.toBe(20);
  expect(binding.applyCommand({ elements: [], deleteIds: ["remove"] })).toEqual(
    [],
  );
  binding.dispose();
  doc.destroy();
});

test.each(["local", "command"] as const)(
  "%s rejects a later asset conflict without changing the document",
  (operation) => {
    const doc = new Y.Doc();
    const binding = createSceneBinding<Element, { size: number }>({ doc });
    binding.setGate({ initialized: true, synced: true, canEdit: true });
    binding.applyLocal([{ id: "keep", value: 1 }], { fixed: { size: 1 } });
    const before = Y.encodeStateAsUpdate(doc);
    const updates = vi.fn();
    doc.on("update", updates);
    const elements = [{ id: "new", value: 2 }];
    const assets = { fresh: { size: 2 }, fixed: { size: 3 } };
    expect(() =>
      operation === "local"
        ? binding.applyLocal(elements, assets)
        : binding.applyCommand({ elements, assets }),
    ).toThrow("asset cannot be rebound");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(updates).not.toHaveBeenCalled();
    binding.dispose();
    doc.destroy();
  },
);

test.each(["local", "command"] as const)(
  "%s rejects an uncloneable later asset before writing elements or earlier assets",
  (operation) => {
    const doc = new Y.Doc();
    const binding = createSceneBinding<Element, unknown>({ doc });
    binding.setGate({ initialized: true, synced: true, canEdit: true });
    binding.applyLocal([{ id: "keep", value: 1 }]);
    const before = Y.encodeStateAsUpdate(doc);
    const updates = vi.fn();
    doc.on("update", updates);
    const elements = [{ id: "new", value: 2 }];
    const assets = { fresh: { size: 2 }, invalid: { callback: () => {} } };
    expect(() =>
      operation === "local"
        ? binding.applyLocal(elements, assets)
        : binding.applyCommand({ elements, assets }),
    ).toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(updates).not.toHaveBeenCalled();
    binding.dispose();
    doc.destroy();
  },
);

test("a later normalization failure leaves existing canonical objects and Y.Doc unchanged", () => {
  const doc = new Y.Doc();
  const binding = createSceneBinding<Element>({
    doc,
    adapter: {
      normalizePersistent: (element) => {
        if (element.id === "invalid") {
          throw new Error("normalization rejected");
        }
        element.value += 1;
        return element;
      },
    },
  });
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  binding.applyLocal([{ id: "keep", value: 1 }]);
  const before = Y.encodeStateAsUpdate(doc);
  const updates = vi.fn();
  doc.on("update", updates);
  expect(() =>
    binding.applyCommand({
      elements: [binding.getElements()[0]!, { id: "invalid", value: 2 }],
    }),
  ).toThrow("normalization rejected");
  expect(binding.getElements()).toEqual([{ id: "keep", value: 1 }]);
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  expect(updates).not.toHaveBeenCalled();
  binding.dispose();
  doc.destroy();
});

test("a later adapter clone failure occurs before any command write", () => {
  const doc = new Y.Doc();
  let rejectClone = false;
  const binding = createSceneBinding<Element>({
    doc,
    adapter: {
      cloneElement: (element) => {
        if (rejectClone && element.id === "later") {
          throw new Error("clone rejected");
        }
        return structuredClone(element);
      },
      validateCanonical: () => {
        rejectClone = true;
      },
    },
  });
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  binding.applyLocal([{ id: "keep", value: 1 }]);
  const before = Y.encodeStateAsUpdate(doc);
  const updates = vi.fn();
  doc.on("update", updates);
  expect(() =>
    binding.applyCommand({
      elements: [
        { id: "first", value: 2 },
        { id: "later", value: 3 },
      ],
    }),
  ).toThrow("clone rejected");
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  expect(updates).not.toHaveBeenCalled();
  binding.dispose();
  doc.destroy();
});
