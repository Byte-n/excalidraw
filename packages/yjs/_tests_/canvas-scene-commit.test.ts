import * as Y from "yjs";

import {
  createCanvasSceneCommands,
  createSceneBinding,
  YjsSceneError,
} from "../src";

import type { ExcalidrawSceneElement } from "../src";

const make = () => {
  const doc = new Y.Doc();
  const binding = createSceneBinding<ExcalidrawSceneElement>({
    doc,
    adapter: {
      validateCanonical: (scene) => {
        for (const element of scene.elements) {
          if (!element.index) {
            throw new Error("场景元素缺少索引");
          }
        }
      },
    },
  });
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  return { doc, binding, commands: createCanvasSceneCommands({ binding }) };
};

const element = (
  id: string,
  overrides: Partial<ExcalidrawSceneElement> = {},
): ExcalidrawSceneElement => ({
  id,
  type: "rectangle",
  index: `a${id}`,
  version: 1,
  versionNonce: 100,
  isDeleted: false,
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  angle: 0,
  updated: 10,
  ...overrides,
});

/** 新元素不携带 index，由提交边界补齐。 */
const fresh = (
  id: string,
  overrides: Partial<ExcalidrawSceneElement> = {},
): ExcalidrawSceneElement => {
  const value: Record<string, unknown> = { ...element(id, overrides) };
  delete value.index;
  return value as unknown as ExcalidrawSceneElement;
};

const errorCodeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof YjsSceneError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected YjsSceneError");
};

test("commit writes created, updated and deleted elements in one update", () => {
  const fixture = make();
  fixture.binding.applyLocal([
    element("a", { index: "aa" }),
    element("b", { index: "ab", version: 3, x: 10 }),
  ]);
  const updates: Uint8Array[] = [];
  fixture.doc.on("update", (update) => updates.push(update));

  const receipt = fixture.commands.commit({
    elements: [
      element("a", { index: "aa", x: 50 }),
      element("b", { index: "ab", version: 3, x: 10, isDeleted: true }),
      fresh("c"),
    ],
    assets: { "asset-1": { value: "merged" } },
  });

  expect(updates).toHaveLength(1);
  expect(receipt.changedElementIds).toEqual(["a", "b", "c"]);
  expect(receipt.createdElementIds).toEqual(["c"]);
  expect(receipt.deletedElementIds).toEqual(["b"]);
  expect(receipt.elements).toHaveLength(3);
  expect(receipt.elements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "a", x: 50, version: 2 }),
      expect.objectContaining({ id: "b", version: 4, isDeleted: true }),
      expect.objectContaining({ id: "c", version: 1 }),
    ]),
  );
  expect(fixture.binding.getAssets()).toEqual({
    "asset-1": { value: "merged" },
  });
  expect(
    fixture.binding.getElements().find((value) => value.id === "b"),
  ).toMatchObject({ isDeleted: true, version: 4 });
  fixture.doc.destroy();
});

test("commit rejects candidates missing existing elements or tombstones", () => {
  const fixture = make();
  fixture.binding.applyLocal([
    element("a", { index: "aa" }),
    element("b", { index: "ab" }),
  ]);
  const before = Y.encodeStateAsUpdate(fixture.doc);

  expect(
    errorCodeOf(() =>
      fixture.commands.commit({ elements: [element("a", { index: "aa" })] }),
    ),
  ).toBe("invalid_scene");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);

  fixture.binding.applyLocal([
    element("a", { index: "aa" }),
    element("b", { index: "ab", isDeleted: true }),
  ]);
  const tombstoned = Y.encodeStateAsUpdate(fixture.doc);
  expect(
    errorCodeOf(() =>
      fixture.commands.commit({ elements: [element("a", { index: "aa" })] }),
    ),
  ).toBe("invalid_scene");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(tombstoned);
  fixture.doc.destroy();
});

test("commit validates expected versions before writing", () => {
  const fixture = make();
  fixture.binding.applyLocal([element("a", { index: "aa" })]);
  const before = Y.encodeStateAsUpdate(fixture.doc);
  const candidate = [element("a", { index: "aa", x: 30 })];

  expect(
    errorCodeOf(() =>
      fixture.commands.commit({
        elements: candidate,
        expectedVersions: { a: 2 },
      }),
    ),
  ).toBe("version_conflict");
  expect(
    errorCodeOf(() =>
      fixture.commands.commit({
        elements: candidate,
        expectedVersions: { missing: 1 },
      }),
    ),
  ).toBe("target_not_found");
  expect(
    errorCodeOf(() =>
      fixture.commands.commit({
        elements: candidate,
        expectedVersions: { a: 0 },
      }),
    ),
  ).toBe("invalid_input");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  fixture.doc.destroy();
});

test("commit without changes returns empty receipt and writes nothing", () => {
  const fixture = make();
  fixture.binding.applyLocal([element("a", { index: "aa" })]);
  const updates: Uint8Array[] = [];
  fixture.doc.on("update", (update) => updates.push(update));

  const receipt = fixture.commands.commit({
    elements: [element("a", { index: "aa" })],
    expectedVersions: { a: 1 },
  });

  expect(receipt.changedElementIds).toEqual([]);
  expect(receipt.createdElementIds).toEqual([]);
  expect(receipt.deletedElementIds).toEqual([]);
  expect(receipt.elements).toHaveLength(1);
  expect(updates).toHaveLength(0);
  fixture.doc.destroy();
});

test("commit fills index for new elements and bumps versions once", () => {
  const fixture = make();
  const created = fixture.commands.commit({ elements: [fresh("n")] });
  const value = created.elements[0]!;
  expect(created.createdElementIds).toEqual(["n"]);
  expect(value.index).toBeTruthy();
  expect(value.version).toBe(1);

  const updated = fixture.commands.commit({
    elements: [{ ...value, x: 20 }],
  });
  expect(updated.changedElementIds).toEqual(["n"]);
  expect(updated.createdElementIds).toEqual([]);
  expect(updated.elements[0]).toMatchObject({ id: "n", x: 20, version: 2 });
  expect(fixture.binding.getElements()[0]).toMatchObject({
    x: 20,
    version: 2,
  });
  fixture.doc.destroy();
});

test("commit keeps tombstones and reports deletions once", () => {
  const fixture = make();
  fixture.binding.applyLocal([
    element("a", { index: "aa" }),
    element("b", { index: "ab" }),
  ]);
  const deleted = fixture.commands.commit({
    elements: [
      element("a", { index: "aa" }),
      element("b", { index: "ab", isDeleted: true }),
    ],
  });
  expect(deleted.deletedElementIds).toEqual(["b"]);

  const canonical = fixture.binding.getCanonical();
  expect(canonical.elements.find((value) => value.id === "b")).toMatchObject({
    isDeleted: true,
  });
  const receipt = fixture.commands.commit({
    elements: [...canonical.elements, fresh("c")],
  });
  expect(receipt.changedElementIds).toEqual(["c"]);
  expect(receipt.deletedElementIds).toEqual([]);
  expect(fixture.binding.getElements()).toHaveLength(3);
  fixture.doc.destroy();
});

test("commit enforces the same session gate as execute", () => {
  const fixture = make();
  fixture.binding.applyLocal([element("a", { index: "aa" })]);
  const before = Y.encodeStateAsUpdate(fixture.doc);

  fixture.binding.setGate({ canEdit: false });
  expect(
    errorCodeOf(() =>
      fixture.commands.commit({
        elements: [element("a", { index: "aa", x: 15 })],
      }),
    ),
  ).toBe("not_editable");

  fixture.binding.setGate({ canEdit: true, generation: 2 });
  expect(
    errorCodeOf(() =>
      fixture.commands.commit({
        elements: [element("a", { index: "aa", x: 15 })],
        generation: 1,
      }),
    ),
  ).toBe("session_unavailable");

  fixture.binding.setGate({ synced: false });
  expect(errorCodeOf(() => fixture.commands.commit({ elements: [] }))).toBe(
    "session_unavailable",
  );
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  fixture.doc.destroy();
});
