import * as Y from "yjs";

import { createSceneBinding, type SceneBindingOptions } from "@excalidraw/yjs";

type Element = { id: string; value: number };

test("public package declarations and runtime consume a real host Y.Doc", () => {
  const doc = new Y.Doc();
  const options: SceneBindingOptions<Element> = {
    doc,
    origin: "package-consumer",
  };
  const binding = createSceneBinding<Element>(options);
  binding.setGate({ initialized: true, synced: true, canEdit: true });
  const transactions: unknown[] = [];
  doc.on("update", (_update, origin) => transactions.push(origin));
  binding.applyLocal([{ id: "one", value: 1 }]);
  expect(binding.document).toBe(doc);
  expect(binding.document).toBeInstanceOf(Y.Doc);
  expect(transactions).toEqual(["package-consumer"]);
  expect(doc.getMap("elements").get("one")).toEqual({ id: "one", value: 1 });
  binding.dispose();
  expect(doc.isDestroyed).toBe(false);
  doc.destroy();
});
