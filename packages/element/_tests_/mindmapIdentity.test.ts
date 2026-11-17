import { remapMindmapIdentity } from "../src/mindmapIdentity";
import { newMindmapNodeElement } from "../src/newElement";

import type {
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
  MindmapEdgeRouting,
  MindmapLayoutDirection,
  MindmapNodeShape,
  StrokeStyle,
} from "../src/types";

type RootDefaults = {
  layoutDirection?: MindmapLayoutDirection;
  defaultNodeShape?: MindmapNodeShape;
  defaultEdgeRouting?: MindmapEdgeRouting;
  defaultEdgeStrokeColor?: string;
  defaultEdgeStrokeWidth?: number;
  defaultEdgeStrokeStyle?: StrokeStyle;
};

const setId = (
  node: ExcalidrawMindmapNodeElement,
  id: string,
): ExcalidrawMindmapNodeElement => ({ ...node, id });

const makeRoot = (
  id: string,
  graphId: string,
  defaults?: RootDefaults,
): ExcalidrawMindmapNodeElement =>
  setId(
    newMindmapNodeElement({
      x: 0,
      y: 0,
      graphId,
      role: "root",
      parentId: null,
      order: null,
      ...defaults,
    }),
    id,
  );

const makeChild = (
  id: string,
  graphId: string,
  parentId: string,
  order: string,
): ExcalidrawMindmapNodeElement =>
  setId(
    newMindmapNodeElement({
      x: 0,
      y: 0,
      graphId,
      role: "node",
      parentId,
      order: order as FractionalIndex,
    }),
    id,
  );

describe("remapMindmapIdentity", () => {
  it("keeps the old parent id when the parent is retained outside the batch", () => {
    const original = makeChild(
      "mind-child",
      "graph-child",
      "scene-parent",
      "a0",
    );
    const copy = setId(original, "copy-child");

    remapMindmapIdentity([copy], [original], {
      retainedParentIds: new Set(["scene-parent"]),
    });

    expect(copy.role).toBe("node");
    expect(copy.parentId).toBe("scene-parent");
    expect(copy.order).toBe("a0");
    expect(copy.graphId).not.toBe(original.graphId);
  });

  it("promotes a node whose parent is outside the batch and applies root defaults", () => {
    const root = makeRoot("mind-root", "graph-source", {
      layoutDirection: "top-to-bottom",
      defaultNodeShape: "ellipse",
      defaultEdgeRouting: "orthogonal",
      defaultEdgeStrokeColor: "#123456",
      defaultEdgeStrokeWidth: 3,
      defaultEdgeStrokeStyle: "dashed",
    });
    const orphan = makeChild(
      "mind-orphan",
      "graph-source",
      "missing-parent",
      "a1",
    );
    const rootCopy = setId(root, "copy-root");
    const orphanCopy = setId(orphan, "copy-orphan");

    remapMindmapIdentity([rootCopy, orphanCopy], [root, orphan], {
      resolveRootDefaults: (graphId) =>
        graphId === root.graphId ? root : undefined,
    });

    expect(rootCopy.graphId).toBe(orphanCopy.graphId);
    expect(orphanCopy.role).toBe("root");
    expect(orphanCopy.parentId).toBeNull();
    expect(orphanCopy.order).toBeNull();
    expect(orphanCopy.layoutDirection).toBe("top-to-bottom");
    expect(orphanCopy.defaultNodeShape).toBe("ellipse");
    expect(orphanCopy.defaultEdgeRouting).toBe("orthogonal");
    expect(orphanCopy.defaultEdgeStrokeColor).toBe("#123456");
    expect(orphanCopy.defaultEdgeStrokeWidth).toBe(3);
    expect(orphanCopy.defaultEdgeStrokeStyle).toBe("dashed");

    // 入参节点与根配置保持原样
    expect(orphan.role).toBe("node");
    expect(orphan.parentId).toBe("missing-parent");
    expect(root.graphId).toBe("graph-source");
    expect(root.layoutDirection).toBe("top-to-bottom");
  });
});
