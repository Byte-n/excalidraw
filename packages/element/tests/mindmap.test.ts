import { arrayToMap } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import {
  buildMindmapGraphIndex,
  compareMindmapNodes,
  getMindmapEdgePath,
  getMindmapHiddenElementIds,
  getMindmapSubtreeIds,
  isMindmapElementHidden,
  layoutMindmap,
  repairMindmapElements,
  reparentMindmapNode,
} from "../src/mindmap";
import {
  newElement,
  newMindmapNodeElement,
  newMindmapEdgeElement,
  newTextElement,
  newArrowElement,
} from "../src/newElement";
import {
  isExcalidrawElement,
  isFlowchartNodeElement,
  isLinearElement,
  isMindmapNodeElement,
  isMindmapEdgeElement,
  isTextBindableContainer,
} from "../src/typeChecks";
import { getElementsWithinSelection } from "../src/selection";
import { hitElementItself, isPointInElement } from "../src/collision";
import { ShapeCache } from "../src/shape";
import { getCornerRadius } from "../src/utils";
import {
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
} from "../src/textElement";

import type {
  ExcalidrawElement,
  ExcalidrawRectangleElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
  MindmapNodeShape,
} from "../src/types";

const node = (
  id: string,
  parentId: string | null = null,
  updates: Partial<ExcalidrawMindmapNodeElement> = {},
): ExcalidrawMindmapNodeElement =>
  ({
    ...newMindmapNodeElement({
      x: 100,
      y: 100,
      width: 100,
      height: 40,
      graphId: "graph",
      ...(parentId === null
        ? { role: "root", parentId: null, order: null }
        : { role: "node", parentId, order: "a0" as FractionalIndex }),
    }),
    id,
    ...updates,
  } as ExcalidrawMindmapNodeElement);

const graph = () => [
  node("root"),
  node("a", "root"),
  node("b", "root", { order: "a1" as FractionalIndex }),
  node("c", "a"),
];

const indexOf = (elements: readonly ExcalidrawElement[]) =>
  buildMindmapGraphIndex(elements, "graph");

describe("mindmap 正式元素模型", () => {
  it("普通图形、流程图节点和 Arrow 不混入 mindmap", () => {
    const root = node("root");
    const rectangle = newElement({ type: "rectangle", x: 0, y: 0 });
    const arrow = newArrowElement({ type: "arrow", x: 0, y: 0 });
    const edge = newMindmapEdgeElement({
      x: 0,
      y: 0,
      graphId: "graph",
      parentId: "root",
      childId: "a",
    });
    expect(isExcalidrawElement(root)).toBe(true);
    expect(isExcalidrawElement(edge)).toBe(true);
    expect(isMindmapNodeElement(rectangle)).toBe(false);
    expect(isMindmapEdgeElement(arrow)).toBe(false);
    expect(isFlowchartNodeElement(root)).toBe(false);
    expect(isLinearElement(edge)).toBe(false);
    expect(isTextBindableContainer(root)).toBe(true);
    expect(root.customData).toBeUndefined();
    expect(root).toMatchObject({ role: "root", parentId: null, order: null });
    const ordinaryWithExtraFields = {
      ...rectangle,
      shape: "pill",
      graphId: "graph",
    };
    expect(getCornerRadius(40, ordinaryWithExtraFields)).toBe(0);
    expect(
      ShapeCache.generateElementShape(
        ordinaryWithExtraFields as ExcalidrawRectangleElement,
        null,
      ),
    ).toEqual(
      ShapeCache.generateElementShape(
        rectangle as ExcalidrawRectangleElement,
        null,
      ),
    );
  });

  it.each(["rectangle", "ellipse", "diamond", "pill"] as MindmapNodeShape[])(
    "%s 节点具有可渲染形状和文本空间",
    (shape) => {
      const root = node("root", null, { shape });
      const text = newTextElement({
        x: 0,
        y: 0,
        text: "节点",
        containerId: root.id,
      });
      expect(ShapeCache.generateElementShape(root, null)).toBeTruthy();
      expect(getBoundTextMaxWidth(root, text)).toBeGreaterThan(0);
      expect(
        getBoundTextMaxHeight(root, { ...text, containerId: root.id }),
      ).toBeGreaterThan(0);
      expect(
        isPointInElement(
          pointFrom<GlobalPoint>(150, 120),
          root,
          arrayToMap([root]),
        ),
      ).toBe(true);
      if (shape !== "rectangle") {
        expect(
          isPointInElement(
            pointFrom<GlobalPoint>(101, 101),
            root,
            arrayToMap([root]),
          ),
        ).toBe(false);
      }
    },
  );
});

describe("mindmap 索引与结构修复", () => {
  it("按逻辑 order 排列，忽略场景顺序和 x/y", () => {
    const elements = graph().reverse();
    const index = indexOf(elements);
    expect(index.rootId).toBe("root");
    expect(index.childrenById.get("root")).toEqual(["a", "b"]);
    expect(index.depthById.get("c")).toBe(2);
    expect(getMindmapSubtreeIds(index, "a")).toEqual(["a", "c"]);
    expect(getMindmapSubtreeIds(index, "missing")).toEqual([]);
    expect(
      compareMindmapNodes(node("A", "root"), node("a", "root")),
    ).toBeLessThan(0);
  });

  it("拒绝无根、多根、孤儿、环、跨图父节点和重复顺序", () => {
    const invalid = [
      [node("a", "missing")],
      [node("root"), node("root2")],
      [node("root"), node("a", "missing")],
      [node("root"), node("a", "b"), node("b", "a")],
      [
        node("root"),
        node("foreign", null, { graphId: "other" }),
        node("a", "foreign"),
      ],
      [node("root"), node("a", "root"), node("b", "root")],
    ];
    invalid.forEach((elements) => expect(() => indexOf(elements)).toThrow());
  });

  it("确定性修复损坏结构，保留节点，不改变普通图形", () => {
    const rectangle = newElement({ type: "rectangle", x: 20, y: 20 });
    const elements = [
      node("root"),
      node("root2"),
      node("a", "b"),
      node("b", "a"),
      node("orphan", "gone", { order: "invalid" as FractionalIndex }),
      rectangle,
    ];
    const before = JSON.stringify(elements);
    const repaired = repairMindmapElements(elements);
    const reversed = repairMindmapElements([...elements].reverse());
    const byId = (items: readonly ExcalidrawElement[]) =>
      [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(byId(repaired)).toEqual(byId(reversed));
    expect(indexOf(repaired).nodes.size).toBe(5);
    expect(repaired.find((element) => element.id === rectangle.id)).toBe(
      rectangle,
    );
    expect(JSON.stringify(elements)).toBe(before);
    expect(repairMindmapElements(repaired)).toBe(repaired);
  });

  it("无根时提升最小 ID 节点，并修复自环", () => {
    const repaired = repairMindmapElements([
      node("b", "b"),
      node("a", "missing"),
    ]);
    const index = indexOf(repaired);
    expect(index.rootId).toBe("a");
    expect(index.parentById.get("b")).toBe("a");
  });

  it("重复、失效和跨图 edge 变为墓碑，缺失 edge 自动生成且避免 ID 冲突", () => {
    const elements = graph();
    const edge = newMindmapEdgeElement({
      x: 0,
      y: 0,
      graphId: "graph",
      parentId: "wrong",
      childId: "a",
    });
    const duplicate = { ...edge, id: "z-duplicate" };
    const invalid = { ...edge, id: "invalid", childId: "missing" };
    const foreign = { ...edge, id: "foreign", graphId: "other" };
    const collision = {
      ...newElement({ type: "rectangle", x: 0, y: 0 }),
      id: 'mindmap-edge:["graph","b"]',
    };
    const input = [
      ...elements,
      { ...edge, id: "a-edge" },
      duplicate,
      invalid,
      foreign,
      collision,
    ];
    expect(() => indexOf(input)).toThrow();
    const repaired = repairMindmapElements(input);
    const index = indexOf(repaired);
    expect(index.edgeByChildId.size).toBe(3);
    expect(index.edgeByChildId.get("a")?.id).toBe("a-edge");
    expect(index.edgeByChildId.get("a")?.parentId).toBe("root");
    expect(index.edgeByChildId.get("b")?.id).not.toBe(collision.id);
    expect(
      repaired
        .filter((element) => element.isDeleted)
        .map((element) => element.id)
        .sort(),
    ).toEqual(["foreign", "invalid", "z-duplicate"]);
    expect(repairMindmapElements(repaired)).toBe(repaired);
  });

  it("保留删除记录，存活子节点重新挂接，删除根不会残留无根图", () => {
    const deleted = node("root", null, { isDeleted: true });
    const repaired = repairMindmapElements([
      deleted,
      node("a", "root"),
      node("b", "a"),
    ]);
    expect(repaired[0]).toBe(deleted);
    expect(indexOf(repaired).rootId).toBe("a");
  });
});

describe("mindmap 纯布局与影子树", () => {
  it("根位置稳定、子树不重叠、连接线端点匹配，重复布局幂等", () => {
    const elements = repairMindmapElements(graph());
    const before = JSON.stringify(elements);
    const layout = layoutMindmap(indexOf(elements));
    const map = arrayToMap(layout.elements);
    expect(map.get("root")).toMatchObject({ x: 100, y: 100 });
    expect(map.get("a")!.x).toBe(280);
    expect(map.get("a")!.y + map.get("a")!.height + 24).toBeLessThanOrEqual(
      map.get("b")!.y,
    );
    expect(layout.edges).toHaveLength(3);
    for (const edge of layout.edges) {
      const parent = map.get(edge.parentId)!;
      const child = map.get(edge.childId)!;
      expect([edge.x + edge.points[0][0], edge.y + edge.points[0][1]]).toEqual([
        parent.x + parent.width,
        parent.y + parent.height / 2,
      ]);
      expect([edge.x + edge.points[3][0], edge.y + edge.points[3][1]]).toEqual([
        child.x,
        child.y + child.height / 2,
      ]);
    }
    const again = layoutMindmap(indexOf([...layout.elements, ...layout.edges]));
    expect(again).toEqual(layout);
    expect(again.elements[1]).toBe(layout.elements[1]);
    expect(again.edges[0]).toBe(layout.edges[0]);
    expect(JSON.stringify(elements)).toBe(before);
  });

  it("不同尺寸与多层子树均保留间距", () => {
    const elements = [
      node("root"),
      node("a", "root", { height: 200 }),
      node("b", "root", { order: "a1" as FractionalIndex }),
      node("c", "a", { height: 300 }),
      node("d", "a", { order: "a1" as FractionalIndex }),
    ];
    const layout = layoutMindmap(indexOf(elements));
    const aSubtree = layout.elements.filter((element) =>
      ["a", "c", "d"].includes(element.id),
    );
    const bottom = Math.max(
      ...aSubtree.map((element) => element.y + element.height),
    );
    expect(
      layout.elements.find((element) => element.id === "b")!.y,
    ).toBeGreaterThanOrEqual(bottom + 24);
  });

  it("折叠只影响可见布局，隐藏节点、文字和 edge 保留在输入中", () => {
    const elements = repairMindmapElements(
      graph().map((element) =>
        element.id === "a" ? { ...element, collapsed: true } : element,
      ),
    );
    const text = newTextElement({
      x: 0,
      y: 0,
      text: "隐藏文字",
      containerId: "c",
    });
    const input = [...elements, text];
    const hidden = getMindmapHiddenElementIds(input);
    expect(hidden.has("c")).toBe(true);
    expect(hidden.has(text.id)).toBe(true);
    expect(hidden.has(indexOf(elements).edgeByChildId.get("c")!.id)).toBe(true);
    expect(hidden.has("a")).toBe(false);
    const layout = layoutMindmap(indexOf(input));
    expect(layout.elements.map((element) => element.id)).toEqual([
      "root",
      "a",
      "b",
    ]);
    expect(layout.edges).toHaveLength(2);
    expect(input.every((element) => !element.isDeleted)).toBe(true);
    expect(isMindmapElementHidden(text, arrayToMap(input))).toBe(true);
  });

  it("深树不依赖递归栈", () => {
    const elements = Array.from({ length: 2000 }, (_, i) =>
      node(String(i), i ? String(i - 1) : null),
    );
    expect(layoutMindmap(indexOf(elements)).elements).toHaveLength(
      elements.length,
    );
  });

  it("拒绝非法间距", () => {
    expect(() => layoutMindmap(indexOf(graph()), { levelGap: NaN })).toThrow();
    expect(() => layoutMindmap(indexOf(graph()), { siblingGap: -1 })).toThrow();
  });

  it("挂接改变 parentId 和逻辑顺序，预览不修改输入与版本", () => {
    const elements = graph();
    const before = JSON.stringify(elements);
    const moved = reparentMindmapNode(indexOf(elements), "b", "a", "c");
    const index = indexOf(moved);
    expect(index.childrenById.get("a")).toEqual(["b", "c"]);
    expect(moved.find((element) => element.id === "b")!.version).toBe(
      elements[2].version,
    );
    expect(JSON.stringify(elements)).toBe(before);
    expect(layoutMindmap(index).elements).toHaveLength(4);
    expect(() => reparentMindmapNode(index, "root", "a")).toThrow();
    expect(() => reparentMindmapNode(index, "a", "c")).toThrow();
    expect(() => reparentMindmapNode(index, "a", "foreign")).toThrow();
    expect(() => reparentMindmapNode(index, "b", "root", "missing")).toThrow();
  });

  it("orthogonal 与 curved 渲染采用不同路径且 edge 不可独立命中", () => {
    const edge = layoutMindmap(indexOf(graph())).edges[0];
    expect(getMindmapEdgePath(edge)).toContain("L ");
    expect(getMindmapEdgePath({ ...edge, routing: "curved" })).toContain("C ");
    expect(ShapeCache.generateElementShape(edge, null)).toBeTruthy();
    expect(
      hitElementItself({
        element: edge,
        elementsMap: arrayToMap([edge]),
        point: pointFrom<GlobalPoint>(edge.x, edge.y),
        threshold: 10,
      }),
    ).toBe(false);
  });

  it("折叠后代不参与命中或框选", () => {
    const elements = graph().map((element) =>
      element.id === "a" ? { ...element, collapsed: true } : element,
    );
    const map = arrayToMap(elements);
    const child = elements.find((element) => element.id === "c")!;
    expect(isPointInElement(pointFrom<GlobalPoint>(150, 120), child, map)).toBe(
      false,
    );
    expect(
      hitElementItself({
        element: child,
        elementsMap: map,
        point: pointFrom<GlobalPoint>(150, 120),
        threshold: 10,
      }),
    ).toBe(false);
    const selection = newElement({
      type: "selection",
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
    });
    expect(
      getElementsWithinSelection(elements, selection, map).map(
        (element) => element.id,
      ),
    ).toEqual(["root", "a", "b"]);
  });
});
