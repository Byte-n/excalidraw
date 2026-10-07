import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyMindmapOperation } from "../src/mindmapScene";
import { buildMindmapGraphIndex, getMindmapEdgeGeometry } from "../src/mindmap";
import { getBoundTextElement } from "../src/textElement";
import { isMindmapEdgeElement, isMindmapNodeElement } from "../src/typeChecks";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";
import { CanvasSceneError } from "../src/sceneOperations";

import type { MindmapNodeTarget, MindmapOperation } from "../src/mindmapScene";
import type { ExcalidrawElement } from "../src/types";

beforeEach(() => {
  setCustomTextMetricsProvider({
    getLineWidth: (text, font) =>
      Array.from(text).length * parseFloat(font) * 0.5,
  });
});
afterEach(() => vi.unstubAllGlobals());

const root = () => {
  const result = applyMindmapOperation([], {
    action: "createRoot",
    position: { x: 100, y: 200 },
    text: "中心",
  });
  if (result.references.domain !== "mindmap") {
    throw new Error("缺少脑图引用");
  }
  return {
    elements: result.elements,
    target: {
      graphId: result.references.graphId,
      nodeId: result.references.nodeId,
    },
  };
};
const add = (
  elements: readonly ExcalidrawElement[],
  target: MindmapNodeTarget,
  text: string,
) => {
  const result = applyMindmapOperation(elements, {
    action: "addChild",
    target,
    text,
  });
  if (result.references.domain !== "mindmap") {
    throw new Error("缺少脑图引用");
  }
  return {
    elements: result.elements,
    target: {
      graphId: result.references.graphId,
      nodeId: result.references.nodeId,
    },
  };
};
const tree = () => {
  const initial = root();
  const child = add(initial.elements, initial.target, "分支");
  const leaf = add(child.elements, child.target, "叶子");
  const other = add(leaf.elements, initial.target, "另一分支");
  return {
    elements: other.elements,
    root: initial.target,
    child: child.target,
    leaf: leaf.target,
    other: other.target,
  };
};
const checkGraph = (
  elements: readonly ExcalidrawElement[],
  graphId: string,
) => {
  const index = buildMindmapGraphIndex(elements, graphId);
  const map = new Map(elements.map((element) => [element.id, element]));
  expect(index.edgeByChildId.size).toBe(index.nodes.size - 1);
  for (const node of index.nodes.values()) {
    const text = getBoundTextElement(node, map);
    expect(text?.containerId).toBe(node.id);
    expect(text?.x).toBeGreaterThanOrEqual(node.x);
    expect(text?.y).toBeGreaterThanOrEqual(node.y);
    if (node.parentId) {
      const edge = index.edgeByChildId.get(node.id)!;
      expect(edge.parentId).toBe(node.parentId);
      expect(edge).toMatchObject(
        getMindmapEdgeGeometry(
          index.nodes.get(node.parentId)!,
          node,
          edge.routing,
          "left-to-right",
        ),
      );
    }
  }
  return index;
};

describe("脑图完整纯场景操作", () => {
  it("在无 DOM 下创建真实文字、节点和完整布局边，不修改输入或既有身份", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    const initial = root();
    const before = structuredClone(initial.elements);
    const child = add(
      initial.elements,
      initial.target,
      "一个需要折行并增高的很长节点名称".repeat(8),
    );
    expect(initial.elements).toEqual(before);
    checkGraph(child.elements, initial.target.graphId);
    for (const element of before) {
      expect(
        child.elements.find((item) => item.id === element.id),
      ).toMatchObject({
        version: element.version,
        versionNonce: element.versionNonce,
        updated: element.updated,
        created: element.created,
        index: element.index,
      });
    }
  });

  it("兄弟插在目标后，换父保持子树并使用新父的指定直属子节点顺序", () => {
    const fixture = tree();
    const sibling = applyMindmapOperation(fixture.elements, {
      action: "addSibling",
      target: fixture.child,
      text: "紧邻",
    });
    if (sibling.references.domain !== "mindmap") {
      throw new Error("缺少脑图引用");
    }
    const index = checkGraph(sibling.elements, fixture.root.graphId);
    expect(index.childrenById.get(fixture.root.nodeId)).toEqual([
      fixture.child.nodeId,
      sibling.references.nodeId,
      fixture.other.nodeId,
    ]);
    const moved = applyMindmapOperation(sibling.elements, {
      action: "reparent",
      target: fixture.child,
      parentNodeId: fixture.other.nodeId,
    });
    const final = checkGraph(moved.elements, fixture.root.graphId);
    expect(final.parentById.get(fixture.child.nodeId)).toBe(
      fixture.other.nodeId,
    );
    expect(final.parentById.get(fixture.leaf.nodeId)).toBe(
      fixture.child.nodeId,
    );
    const reordered = applyMindmapOperation(moved.elements, {
      action: "reparent",
      target: {
        graphId: fixture.root.graphId,
        nodeId: sibling.references.nodeId,
      },
      parentNodeId: fixture.other.nodeId,
      beforeNodeId: fixture.child.nodeId,
    });
    expect(
      checkGraph(reordered.elements, fixture.root.graphId).childrenById.get(
        fixture.other.nodeId,
      ),
    ).toEqual([sibling.references.nodeId, fixture.child.nodeId]);
  });

  it("重命名保留真实文字身份，空文字仍是脑图标签", () => {
    const fixture = tree();
    const before = getBoundTextElement(
      buildMindmapGraphIndex(fixture.elements, fixture.root.graphId).nodes.get(
        fixture.child.nodeId,
      )!,
      new Map(fixture.elements.map((element) => [element.id, element])),
    )!;
    const renamed = applyMindmapOperation(fixture.elements, {
      action: "rename",
      target: fixture.child,
      text: "长名称\n第二行",
    });
    expect(
      renamed.elements.find((element) => element.id === before.id),
    ).toMatchObject({
      originalText: "长名称\n第二行",
      containerId: fixture.child.nodeId,
    });
    checkGraph(renamed.elements, fixture.root.graphId);
    const cleared = applyMindmapOperation(renamed.elements, {
      action: "rename",
      target: fixture.child,
      text: "",
    });
    expect(
      cleared.elements.find((element) => element.id === before.id),
    ).toMatchObject({ originalText: "", isDeleted: false });
  });

  it.each(["child", "root"] as const)(
    "平移 %s 带上子树文字并重算相关边，保持父关系",
    (kind) => {
      const fixture = tree();
      const target = fixture[kind];
      const before = buildMindmapGraphIndex(
        fixture.elements,
        fixture.root.graphId,
      ).nodes.get(target.nodeId)!;
      const result = applyMindmapOperation(fixture.elements, {
        action: "move",
        target,
        position: { x: before.x + 123, y: before.y - 87 },
      });
      const index = checkGraph(result.elements, fixture.root.graphId);
      expect(index.nodes.get(target.nodeId)).toMatchObject({
        x: before.x + 123,
        y: before.y - 87,
        parentId: before.parentId,
      });
      const leafBefore = fixture.elements.find(
        (element) => element.id === fixture.leaf.nodeId,
      )!;
      expect(index.nodes.get(fixture.leaf.nodeId)).toMatchObject({
        x: leafBefore.x + 123,
        y: leafBefore.y - 87,
      });
      if (kind === "child") {
        expect(
          result.elements.find(
            (element) => element.id === fixture.other.nodeId,
          ),
        ).toBe(
          fixture.elements.find(
            (element) => element.id === fixture.other.nodeId,
          ),
        );
      }
    },
  );

  it("删除整个子树及其文字/边，删根墓碑整图且保留其它脑图", () => {
    const fixture = tree();
    const unrelated = root();
    const input = [...fixture.elements, ...unrelated.elements];
    const removed = applyMindmapOperation(input, {
      action: "deleteSubtree",
      target: fixture.child,
    });
    const index = checkGraph(removed.elements, fixture.root.graphId);
    expect([...index.nodes.keys()]).toEqual([
      fixture.root.nodeId,
      fixture.other.nodeId,
    ]);
    const deletedNodes = new Set([fixture.child.nodeId, fixture.leaf.nodeId]);
    for (const element of removed.elements) {
      if (
        deletedNodes.has(element.id) ||
        (element.type === "text" &&
          element.containerId &&
          deletedNodes.has(element.containerId)) ||
        (isMindmapEdgeElement(element) && deletedNodes.has(element.childId))
      ) {
        expect(element.isDeleted).toBe(true);
      }
    }
    const deleted = applyMindmapOperation(input, {
      action: "deleteSubtree",
      target: fixture.root,
    });
    expect(
      deleted.elements
        .filter((element) =>
          fixture.elements.some((old) => old.id === element.id),
        )
        .every((element) => element.isDeleted),
    ).toBe(true);
    expect(deleted.references).toMatchObject({ rootNodeId: null });
    expect(
      deleted.elements.filter((element) =>
        unrelated.elements.some((old) => old.id === element.id),
      ),
    ).toEqual(unrelated.elements);
    expect(deleted.elements).toHaveLength(input.length);
  });

  it("无效位置、根兄弟、根换父、环、跨图或非法插入位置在写入前拒绝", () => {
    const fixture = tree();
    const input = fixture.elements;
    const snapshot = structuredClone(input);
    const invalid: MindmapOperation[] = [
      {
        action: "move",
        target: fixture.child,
        position: { x: Number.NaN, y: 0 },
      },
      { action: "addSibling", target: fixture.root, text: "非法" },
      {
        action: "reparent",
        target: fixture.root,
        parentNodeId: fixture.other.nodeId,
      },
      {
        action: "reparent",
        target: fixture.child,
        parentNodeId: fixture.leaf.nodeId,
      },
      { action: "reparent", target: fixture.child, parentNodeId: "另一图的根" },
      {
        action: "reparent",
        target: fixture.child,
        parentNodeId: fixture.root.nodeId,
        beforeNodeId: fixture.leaf.nodeId,
      },
      {
        action: "rename",
        target: { graphId: "错误图", nodeId: fixture.child.nodeId },
        text: "非法",
      },
    ];
    for (const operation of invalid) {
      expect(() => applyMindmapOperation(input, operation)).toThrow(
        CanvasSceneError,
      );
      expect(input).toEqual(snapshot);
    }
  });

  it("已相同文字或位置返回无实际变化，保留输入元素引用", () => {
    const initial = root();
    const result = applyMindmapOperation(initial.elements, {
      action: "rename",
      target: initial.target,
      text: "中心",
    });
    expect(result.changedElementIds).toEqual([]);
    expect(result.elements[0]).toBe(initial.elements[0]);
    expect(result.elements.filter(isMindmapNodeElement)).toHaveLength(1);
  });
});
