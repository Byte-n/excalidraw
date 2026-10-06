import * as Y from "yjs";

import {
  createExcalidrawSceneCommands,
  createSceneBinding,
  createSceneElement,
  projectExcalidrawDisplayElements,
} from "../src";

import { element } from "./helpers";

import type { ExcalidrawSceneElement, SceneSnapshot } from "../src";

const make = (
  validateScene?: (
    scene: SceneSnapshot<ExcalidrawSceneElement, unknown>,
  ) => undefined,
) => {
  const doc = new Y.Doc();
  const binding = createSceneBinding<ExcalidrawSceneElement>({ doc });
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  const commands = createExcalidrawSceneCommands({ binding, validateScene });
  return { doc, binding, commands };
};
const endpoint = (elementId: string) => ({
  elementId,
  fixedPoint: [0.5, 0.5] as [number, number],
  mode: "orbit" as const,
});

test("factory creates fresh IDs and commands update versions and preserve full tombstones", () => {
  const fixture = make();
  const shape = createSceneElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 50,
    height: 50,
  });
  const other = createSceneElement({ type: "rectangle", x: 0, y: 0 });
  expect(shape.id).not.toBe(other.id);
  fixture.commands.apply({ mutations: [{ type: "add", element: shape }] });
  fixture.commands.apply({
    mutations: [
      { type: "update", id: shape.id, expectedVersion: 1, patch: { x: 20 } },
    ],
  });
  const updated = fixture.binding.getElements()[0]!;
  expect(updated).toMatchObject({ x: 20, version: 2 });
  expect(updated.versionNonce).not.toBe(shape.versionNonce);
  fixture.commands.apply({
    mutations: [{ type: "delete", id: shape.id, expectedVersion: 2 }],
  });
  expect(fixture.binding.getElements()[0]).toMatchObject({
    ...updated,
    isDeleted: true,
    version: 3,
    versionNonce: expect.any(Number),
    updated: expect.any(Number),
  });
  expect(fixture.binding.getElements()[0]!.versionNonce).not.toBe(
    updated.versionNonce,
  );
  fixture.doc.destroy();
});

test.each(["arrow", "line"])(
  "%s connection publishes both reverse relationships atomically",
  (type) => {
    const fixture = make();
    const receiver = new Y.Doc();
    const updates: Uint8Array[] = [];
    fixture.doc.on("update", (update) => {
      updates.push(update);
      Y.applyUpdate(receiver, update);
    });
    fixture.commands.apply({
      mutations: [
        { type: "add", element: element("left") },
        { type: "add", element: element("right") },
        {
          type: "add",
          element: element("edge", 0, {
            type,
            startBinding: null,
            endBinding: null,
          }),
        },
        {
          type: "connect",
          id: "edge",
          start: endpoint("left"),
          end: endpoint("right"),
        },
      ],
    });
    expect(updates).toHaveLength(1);
    expect(receiver.getMap("elements").get("left")).toMatchObject({
      boundElements: [{ id: "edge", type }],
    });
    expect(receiver.getMap("elements").get("right")).toMatchObject({
      boundElements: [{ id: "edge", type }],
    });
    expect(receiver.getMap("elements").get("edge")).toMatchObject({
      startBinding: endpoint("left"),
      endBinding: endpoint("right"),
    });
    fixture.commands.apply({
      mutations: [
        { type: "connect", id: "edge", start: null, end: endpoint("right") },
      ],
    });
    expect(
      fixture.binding.getElements().find((value) => value.id === "left")!
        .boundElements,
    ).toEqual([]);
    expect(
      fixture.binding.getElements().find((value) => value.id === "right")!
        .boundElements,
    ).toHaveLength(1);
    receiver.destroy();
    fixture.doc.destroy();
  },
);

test("a later missing target leaves the entire Y.Doc and state vector unchanged", () => {
  const fixture = make();
  const before = Y.encodeStateAsUpdate(fixture.doc);
  const vector = Y.encodeStateVector(fixture.doc);
  expect(() =>
    fixture.commands.apply({
      mutations: [
        { type: "add", element: element("first") },
        { type: "update", id: "missing", patch: { x: 1 } },
      ],
    }),
  ).toThrow("target not found");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  expect(Y.encodeStateVector(fixture.doc)).toEqual(vector);
  fixture.doc.destroy();
});

test("stale expected versions reject before any command in the batch is written", () => {
  const fixture = make();
  fixture.commands.apply({
    mutations: [{ type: "add", element: element("one") }],
  });
  const before = Y.encodeStateAsUpdate(fixture.doc);
  expect(() =>
    fixture.commands.apply({
      mutations: [
        { type: "add", element: element("second") },
        { type: "delete", id: "one", expectedVersion: 0 },
      ],
    }),
  ).toThrow("version conflict");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  fixture.doc.destroy();
});

test("schema rejects the complete connected candidate before a transaction", () => {
  const fixture = make((scene) => {
    expect(
      scene.elements.find((value) => value.id === "left")!.boundElements,
    ).toHaveLength(1);
    throw new Error("schema rejected");
  });
  const before = Y.encodeStateAsUpdate(fixture.doc);
  expect(() =>
    fixture.commands.apply({
      mutations: [
        { type: "add", element: element("left") },
        { type: "add", element: element("edge", 0, { type: "arrow" }) },
        { type: "connect", id: "edge", start: endpoint("left"), end: null },
      ],
    }),
  ).toThrow("schema rejected");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  fixture.doc.destroy();
});

test("asset rebinding after multiple mutations leaves canonical elements unchanged", () => {
  const fixture = make();
  fixture.commands.apply({
    mutations: [{ type: "add", element: element("one") }],
    assets: { asset: { key: "old" } },
  });
  const before = Y.encodeStateAsUpdate(fixture.doc);
  expect(() =>
    fixture.commands.apply({
      mutations: [
        { type: "update", id: "one", patch: { x: 10 } },
        { type: "add", element: element("second") },
      ],
      assets: { asset: { key: "new" } },
    }),
  ).toThrow("cannot be rebound");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  fixture.doc.destroy();
});

test("unrelated soft relationships survive commands and remain display-only repairs", () => {
  const fixture = make();
  fixture.binding.applyCommand({
    elements: [
      element("one", 0, {
        containerRef: { kind: "frameLike", elementId: "missing" },
      }),
    ],
  });
  fixture.commands.apply({
    mutations: [{ type: "update", id: "one", patch: { x: 20 } }],
  });
  const canonical = fixture.binding.getElements();
  expect(canonical[0]!.containerRef).toBeDefined();
  expect(
    projectExcalidrawDisplayElements(canonical)[0]!.containerRef,
  ).toBeUndefined();
  expect(fixture.binding.getElements()[0]!.containerRef).toBeDefined();
  fixture.doc.destroy();
});

test("cyclic asset data rejects before publishing earlier scene mutations", () => {
  const fixture = make();
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const before = Y.encodeStateAsUpdate(fixture.doc);
  expect(() =>
    fixture.commands.apply({
      mutations: [{ type: "add", element: element("one") }],
      assets: { cyclic },
    }),
  ).toThrow("acyclic");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  fixture.doc.destroy();
});

test("non-finite asset data is rejected before writing and undefined keys cannot be rebound", () => {
  const fixture = make();
  expect(() =>
    fixture.commands.apply({
      mutations: [{ type: "add", element: element("one") }],
      assets: { asset: { number: Infinity } },
    }),
  ).toThrow("finite");
  expect(fixture.doc.getMap("elements").size).toBe(0);
  fixture.commands.apply({
    mutations: [],
    assets: { asset: { optional: undefined } },
  });
  const before = Y.encodeStateAsUpdate(fixture.doc);
  expect(() =>
    fixture.commands.apply({
      mutations: [{ type: "add", element: element("one") }],
      assets: { asset: {} },
    }),
  ).toThrow("cannot be rebound");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  fixture.doc.destroy();
});
