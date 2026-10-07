import * as Y from "yjs";

import { createCanvasSceneCommands, createSceneBinding } from "../src";

import type { ExcalidrawSceneElement } from "../src";

const make = (rejectX = false) => {
  const doc = new Y.Doc();
  const binding = createSceneBinding<ExcalidrawSceneElement>({
    doc,
    adapter: {
      validateCanonical: (scene) => {
        for (const element of scene.elements) {
          if (!element.index) {
            throw new Error("场景元素缺少索引");
          }
          if (rejectX && element.x === 25) {
            throw new Error("schema rejected");
          }
        }
      },
    },
  });
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  return { doc, binding, commands: createCanvasSceneCommands({ binding }) };
};

const shape = (x: number) => ({
  domain: "shape" as const,
  operation: {
    action: "create" as const,
    kind: "rectangle" as const,
    geometry: { x, y: 0, width: 100, height: 60 },
  },
});
const shapeId = (
  result: ReturnType<ReturnType<typeof make>["commands"]["execute"]>,
) => {
  if (result.result.references.domain !== "shape") {
    throw new Error("shape result expected");
  }
  return result.result.references.elementId;
};

test("typed shape command commits one update and bumps exactly once", () => {
  const fixture = make();
  const updates: Uint8Array[] = [];
  fixture.doc.on("update", (update) => updates.push(update));
  const created = fixture.commands.execute(shape(0));
  expect(updates).toHaveLength(1);
  expect(created.createdElementIds).toHaveLength(1);
  const value = fixture.binding.getElements()[0]!;
  expect(value.index).toBeTruthy();
  expect(value.version).toBe(1);

  const changed = fixture.commands.execute({
    domain: "shape",
    expectedVersion: 1,
    operation: {
      action: "update",
      target: { elementId: value.id },
      geometry: { x: 25 },
    },
  });
  expect(updates).toHaveLength(2);
  expect(changed.changedElementIds).toEqual([value.id]);
  expect(fixture.binding.getElements()[0]).toMatchObject({
    id: value.id,
    x: 25,
    version: 2,
  });
  fixture.doc.destroy();
});

test("connector candidate is observed atomically with both reverse references", () => {
  const fixture = make();
  const receiver = new Y.Doc();
  const updates: Uint8Array[] = [];
  fixture.doc.on("update", (update) => {
    updates.push(update);
    Y.applyUpdate(receiver, update);
  });
  const left = shapeId(fixture.commands.execute(shape(0)));
  const right = shapeId(fixture.commands.execute(shape(250)));
  const before = updates.length;
  fixture.commands.execute({
    domain: "connector",
    operation: {
      action: "create",
      kind: "arrow",
      start: { elementId: left },
      end: { elementId: right },
      label: "relates",
    },
  });
  expect(updates).toHaveLength(before + 1);
  const elements = receiver.getMap("elements");
  const leftValue = elements.get(left) as { boundElements?: unknown };
  const rightValue = elements.get(right) as { boundElements?: unknown };
  expect(leftValue.boundElements).toHaveLength(1);
  expect(rightValue.boundElements).toHaveLength(1);
  expect((leftValue.boundElements as [{ type: string }])[0]!.type).toBe(
    "arrow",
  );
  expect((rightValue.boundElements as [{ type: string }])[0]!.type).toBe(
    "arrow",
  );
  receiver.destroy();
  fixture.doc.destroy();
});

test("version conflict and gate rejection leave document and state vector unchanged", () => {
  const fixture = make();
  const value = shapeId(fixture.commands.execute(shape(0)));
  const before = Y.encodeStateAsUpdate(fixture.doc);
  const vector = Y.encodeStateVector(fixture.doc);
  expect(() =>
    fixture.commands.execute({
      domain: "shape",
      expectedVersion: 99,
      operation: {
        action: "update",
        target: { elementId: value },
        geometry: { x: 10 },
      },
    }),
  ).toThrow("版本冲突");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  expect(Y.encodeStateVector(fixture.doc)).toEqual(vector);
  fixture.binding.setGate({ canEdit: false });
  expect(() => fixture.commands.execute(shape(50))).toThrow("不可编辑");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  fixture.doc.destroy();
});

test("candidate schema and asset conflicts reject before publishing", () => {
  const fixture = make(true);
  const first = fixture.commands.apply({
    operation: shape(0),
    assets: { "asset-1": { value: "first" } },
  });
  const firstId = shapeId(first);
  const before = Y.encodeStateAsUpdate(fixture.doc);
  const vector = Y.encodeStateVector(fixture.doc);
  expect(() =>
    fixture.commands.execute({
      domain: "shape",
      expectedVersion: 1,
      operation: {
        action: "update",
        target: { elementId: firstId },
        geometry: { x: 25 },
      },
    }),
  ).toThrow("场景候选校验失败");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  expect(Y.encodeStateVector(fixture.doc)).toEqual(vector);
  expect(() =>
    fixture.commands.execute(shape(100), {
      assets: { "asset-1": { value: "second" } },
    }),
  ).toThrow("asset cannot be rebound");
  expect(Y.encodeStateAsUpdate(fixture.doc)).toEqual(before);
  expect(Y.encodeStateVector(fixture.doc)).toEqual(vector);
  fixture.doc.destroy();
});
