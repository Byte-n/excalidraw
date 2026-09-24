import { syncInvalidIndices } from "@excalidraw/element";

import {
  buildMindmapGraphIndex,
  newMindmapEdgeElement,
  newMindmapNodeElement,
} from "@excalidraw/element";

import type {
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { reconcileMindmapElements } from "../../data/reconcile";

const node = (
  id: string,
  relation:
    | { role: "root"; parentId: null; order: null }
    | { role: "node"; parentId: string; order: FractionalIndex },
) =>
  ({
    ...newMindmapNodeElement({
      x: 100,
      y: 100,
      graphId: "graph",
      ...relation,
    }),
    id,
  } as ExcalidrawMindmapNodeElement);

describe("Mindmap collaboration reconciliation", () => {
  it("repairs a merged edge against the complete graph and reports its node", () => {
    const root = node("root", { role: "root", parentId: null, order: null });
    const child = node("child", {
      role: "node",
      parentId: root.id,
      order: "a0" as FractionalIndex,
    });
    const edge = {
      ...newMindmapEdgeElement({
        x: 0,
        y: 0,
        graphId: "graph",
        parentId: "missing-parent",
        childId: child.id,
      }),
      id: "edge",
    };

    const result = reconcileMindmapElements(
      syncInvalidIndices([root, child, edge]),
      ["graph"],
    );
    const index = buildMindmapGraphIndex(result.elements, "graph");

    expect(index.edgeByChildId.get(child.id)?.parentId).toBe(root.id);
    expect(index.nodes.get(child.id)?.x).toBe(root.x + root.width + 80);
    expect(result.conflicts).toEqual([
      { graphId: "graph", nodeIds: [child.id] },
    ]);

    const replayed = reconcileMindmapElements(result.elements, ["graph"]);
    expect(replayed.conflicts).toEqual([]);
    expect(
      buildMindmapGraphIndex(replayed.elements, "graph").edgeByChildId.get(
        child.id,
      )?.parentId,
    ).toBe(root.id);
  });

  it("is a no-op for an unaffected graph", () => {
    const root = node("root", { role: "root", parentId: null, order: null });
    const elements = syncInvalidIndices([root]);

    expect(reconcileMindmapElements(elements, []).elements).toBe(elements);
  });
});
