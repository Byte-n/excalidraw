import { arrayToMap } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import {
  applyMindmapTreeCommand,
  navigateMindmap,
  buildMindmapGraphIndex,
  compareMindmapNodes,
  getMindmapEdgePath,
  getMindmapElementsForSelection,
  getMindmapHiddenElementIds,
  getMindmapSubtreeIds,
  isMindmapElementHidden,
  layoutMindmap,
  repairMindmapElements,
  reparentMindmapNode,
  reparentMindmapNodes,
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
  it("复制子树时排除原父节点的入边并保留内部边", () => {
    const repaired = repairMindmapElements(graph());
    const selected = repaired.filter((element) => element.id === "a");
    const copied = getMindmapElementsForSelection(repaired, selected);

    expect(copied.map((element) => element.id)).toEqual(
      expect.arrayContaining(["a", "c"]),
    );
    expect(
      copied.filter(
        (element) => isMindmapEdgeElement(element) && element.childId === "a",
      ),
    ).toHaveLength(0);
    expect(
      copied.filter(
        (element) =>
          isMindmapEdgeElement(element) &&
          element.parentId === "a" &&
          element.childId === "c",
      ),
    ).toHaveLength(1);
  });

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

describe("mindmap P02 纯树命令", () => {
  const fixture = () =>
    repairMindmapElements([
      ...graph(),
      node("d", "a", { order: "a1" as FractionalIndex }),
      node("e", "c"),
    ]);

  it("导航按逻辑顺序且边界不循环，不进入折叠后代", () => {
    const index = indexOf(fixture());
    expect(navigateMindmap(index, "a", "ArrowUp")).toBeNull();
    expect(navigateMindmap(index, "b", "ArrowDown")).toBeNull();
    expect(navigateMindmap(index, "a", "ArrowDown")).toBe("b");
    expect(navigateMindmap(index, "b", "ArrowUp")).toBe("a");
    expect(navigateMindmap(index, "a", "ArrowLeft")).toBe("root");
    expect(navigateMindmap(index, "a", "ArrowRight")).toBe("c");
    expect(navigateMindmap(index, "root", "ArrowLeft")).toBeNull();
    expect(navigateMindmap(index, "e", "ArrowRight")).toBeNull();
    const folded = applyMindmapTreeCommand(fixture(), "a", {
      type: "toggleCollapse",
    })!;
    expect(
      navigateMindmap(indexOf(folded.elements), "a", "ArrowRight"),
    ).toBeNull();
    expect(
      navigateMindmap(indexOf(folded.elements), "c", "ArrowDown"),
    ).toBeNull();
  });

  it("保留子节点删除时，在原位置依次提升子节点并保留内部关系和边样式", () => {
    const elements = fixture();
    const before = JSON.stringify(elements);
    const edge = indexOf(elements).edgeByChildId.get("c")!;
    const result = applyMindmapTreeCommand(elements, "a", {
      type: "deletePreservingChildren",
    })!;
    const index = indexOf(result.elements);
    expect(index.childrenById.get("root")).toEqual(["c", "d", "b"]);
    expect(index.parentById.get("e")).toBe("c");
    expect(index.edgeByChildId.get("c")).toMatchObject({
      id: edge.id,
      parentId: "root",
      strokeColor: edge.strokeColor,
    });
    expect(result.selectedNodeId).toBe("c");
    expect(JSON.stringify(elements)).toBe(before);
    expect(repairMindmapElements(result.elements)).toBe(result.elements);
  });

  it("删除折叠子树包含隐藏文本、所有后代和入边", () => {
    const elements = fixture();
    const text = newTextElement({ x: 0, y: 0, text: "隐藏", containerId: "e" });
    const folded = applyMindmapTreeCommand([...elements, text], "a", {
      type: "toggleCollapse",
    })!;
    const result = applyMindmapTreeCommand(folded.elements, "a", {
      type: "delete",
    })!;
    expect([...indexOf(result.elements).nodes.keys()]).toEqual(["root", "b"]);
    expect(indexOf(result.elements).edgeByChildId.size).toBe(1);
    expect(
      result.elements.find((element) => element.id === text.id)?.isDeleted,
    ).toBe(true);
  });

  it("保留子树删除多子根必须指定直属新根，其他分支追加且保持内部顺序", () => {
    const elements = fixture();
    expect(() =>
      applyMindmapTreeCommand(elements, "root", {
        type: "deletePreservingChildren",
      }),
    ).toThrow();
    expect(() =>
      applyMindmapTreeCommand(elements, "root", {
        type: "deletePreservingChildren",
        replacementId: "c",
      }),
    ).toThrow();
    const result = applyMindmapTreeCommand(elements, "root", {
      type: "deletePreservingChildren",
      replacementId: "a",
    })!;
    const index = indexOf(result.elements);
    expect(index.rootId).toBe("a");
    expect(index.nodes.get("a")).toMatchObject({
      parentId: null,
      order: null,
      collapsed: false,
    });
    expect(index.childrenById.get("a")).toEqual(["c", "d", "b"]);
    expect(index.parentById.get("e")).toBe("c");
    expect(index.edgeByChildId.has("a")).toBe(false);
    expect(index.edgeByChildId.size).toBe(index.nodes.size - 1);
  });

  it("删除整图不触碰另一张图和普通图形", () => {
    const foreign = node("foreign", null, { graphId: "foreign" });
    const rectangle = newElement({ type: "rectangle", x: 0, y: 0 });
    const elements = [...fixture(), foreign, rectangle];
    const result = applyMindmapTreeCommand(elements, "root", {
      type: "delete",
    })!;
    expect(result.elements.filter((element) => !element.isDeleted)).toEqual([
      foreign,
      rectangle,
    ]);
    expect(result.selectedNodeId).toBeNull();
  });

  it("普通节点选择接替者不换图、不换父节点，并保留接替者已有子节点", () => {
    const elements = repairMindmapElements([
      ...fixture().map((element) =>
        element.id === "c" ? { ...element, collapsed: true } : element,
      ),
      node("before", "root", { order: "Zz" as FractionalIndex }),
    ]);
    const before = JSON.stringify(elements);
    const original = indexOf(elements);
    const result = applyMindmapTreeCommand(elements, "a", {
      type: "deletePreservingChildren",
      replacementId: "c",
    })!;
    const index = indexOf(result.elements);
    expect(index.rootId).toBe("root");
    expect(index.childrenById.get("root")).toEqual(["before", "c", "b"]);
    expect(index.nodes.get("c")).toMatchObject({
      role: "node",
      parentId: "root",
      graphId: "graph",
      order: original.nodes.get("a")!.order,
      collapsed: true,
    });
    expect(index.childrenById.get("c")).toEqual(["e", "d"]);
    expect(index.edgeByChildId.get("c")).toMatchObject({
      id: original.edgeByChildId.get("c")!.id,
      parentId: "root",
    });
    expect(index.edgeByChildId.get("d")?.parentId).toBe("c");
    expect(index.edgeByChildId.size).toBe(index.nodes.size - 1);
    expect(result.graphIds).toEqual(["graph"]);
    expect(result.selectedNodeId).toBe("c");
    expect(JSON.stringify(elements)).toBe(before);
    expect(repairMindmapElements(result.elements)).toBe(result.elements);
    for (const replacementId of ["root", "a", "e", "missing"]) {
      expect(() =>
        applyMindmapTreeCommand(elements, "a", {
          type: "deletePreservingChildren",
          replacementId,
        }),
      ).toThrow();
    }
  });

  it("裸根直接删除，唯一直属子节点自动接替且不丢失更深后代", () => {
    const empty = applyMindmapTreeCommand([node("root")], "root", {
      type: "deletePreservingChildren",
    })!;
    expect(empty.elements.every((element) => element.isDeleted)).toBe(true);
    expect(empty.selectedNodeId).toBeNull();
    const elements = repairMindmapElements([
      node("root"),
      node("a", "root"),
      node("c", "a"),
      node("e", "c"),
    ]);
    const result = applyMindmapTreeCommand(elements, "root", {
      type: "deletePreservingChildren",
    })!;
    const index = indexOf(result.elements);
    expect(index.rootId).toBe("a");
    expect(index.nodes.size).toBe(3);
    expect(index.nodes.get("a")).toMatchObject({
      role: "root",
      parentId: null,
      order: null,
    });
    expect(index.parentById.get("e")).toBe("c");
    const replaced = applyMindmapTreeCommand(elements, "a", {
      type: "deletePreservingChildren",
    })!;
    expect(indexOf(replaced.elements).nodes.get("c")).toMatchObject({
      role: "node",
      parentId: "root",
      order: "a0",
    });
    expect(indexOf(replaced.elements).parentById.get("e")).toBe("c");
  });

  it("深层提升插在原父节点之后，再次提升拆图且重用内部 edge", () => {
    const original = fixture();
    const promoted = applyMindmapTreeCommand(original, "c", {
      type: "promote",
      newGraphId: "new",
    })!;
    expect(indexOf(promoted.elements).childrenById.get("root")).toEqual([
      "a",
      "c",
      "b",
    ]);
    const edge = indexOf(promoted.elements).edgeByChildId.get("e")!;
    const split = applyMindmapTreeCommand(promoted.elements, "c", {
      type: "promote",
      newGraphId: "new",
    })!;
    const index = buildMindmapGraphIndex(split.elements, "new");
    expect(index.nodes.size).toBe(2);
    expect(index.nodes.get("c")).toMatchObject({
      graphId: "new",
      role: "root",
      parentId: null,
      order: null,
    });
    expect(index.nodes.get("e")?.parentId).toBe("c");
    expect(index.edgeByChildId.get("e")).toMatchObject({
      id: edge.id,
      graphId: "new",
    });
    expect(indexOf(split.elements).nodes.size).toBe(4);
    expect(repairMindmapElements(split.elements)).toBe(split.elements);
    expect(() =>
      applyMindmapTreeCommand(original, "a", {
        type: "promote",
        newGraphId: "graph",
      }),
    ).toThrow();
  });

  it("叶子折叠和根提升均无修改，拆图保留折叠后代及绑定", () => {
    const elements = fixture();
    expect(
      applyMindmapTreeCommand(elements, "root", {
        type: "promote",
        newGraphId: "new",
      }),
    ).toBeNull();
    expect(
      applyMindmapTreeCommand(elements, "b", { type: "toggleCollapse" }),
    ).toBeNull();
    const folded = applyMindmapTreeCommand(elements, "a", {
      type: "toggleCollapse",
    })!;
    const result = applyMindmapTreeCommand(folded.elements, "a", {
      type: "promote",
      newGraphId: "new",
    })!;
    expect(buildMindmapGraphIndex(result.elements, "new").nodes.size).toBe(4);
    expect(getMindmapHiddenElementIds(result.elements).has("e")).toBe(true);
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

  it.each([
    ["left-to-right", "x", 1],
    ["right-to-left", "x", -1],
    ["top-to-bottom", "y", 1],
    ["bottom-to-top", "y", -1],
  ] as const)(
    "四方向布局保持根锚点和逻辑顺序 (%s)",
    (direction, axis, sign) => {
      const elements = repairMindmapElements(graph());
      const root = elements.find((element) => element.id === "root")!;
      const layout = layoutMindmap(indexOf(elements), { direction });
      const map = arrayToMap(layout.elements);
      const first = map.get("a")!;
      const second = map.get("b")!;
      expect(map.get("root")).toMatchObject({ x: root.x, y: root.y });
      const firstMain = axis === "x" ? first.x : first.y;
      const secondMain = axis === "x" ? second.x : second.y;
      const rootMain = axis === "x" ? root.x : root.y;
      expect((firstMain - rootMain) * sign).toBeGreaterThan(0);
      expect((secondMain - rootMain) * sign).toBeGreaterThan(0);
      const firstCross = axis === "x" ? first.y : first.x;
      const secondCross = axis === "x" ? second.y : second.x;
      expect(firstCross).toBeLessThanOrEqual(secondCross);
      for (const edge of layout.edges) {
        expect(edge.points).toHaveLength(4);
        expect(edge.routing).toBe("orthogonal");
      }
    },
  );

  it.each([
    ["left-to-right", "x", 1],
    ["right-to-left", "x", -1],
    ["top-to-bottom", "y", 1],
    ["bottom-to-top", "y", -1],
  ] as const)(
    "四方向每一层的节点边界间距一致 (%s)",
    (direction, axis, sign) => {
      const elements = graph().map((element) => {
        switch (element.id) {
          case "root":
            return { ...element, width: 140, height: 60 };
          case "a":
            return { ...element, width: 110, height: 90 };
          case "b":
            return { ...element, width: 175, height: 50 };
          default:
            return { ...element, width: 75, height: 45 };
        }
      });
      const layout = layoutMindmap(indexOf(elements), { direction });
      const map = arrayToMap(layout.elements);
      for (const child of layout.elements.filter(
        (element) => element.parentId,
      )) {
        const parent = map.get(child.parentId!)!;
        const parentStart = axis === "x" ? parent.x : parent.y;
        const parentSize = axis === "x" ? parent.width : parent.height;
        const childStart = axis === "x" ? child.x : child.y;
        const childSize = axis === "x" ? child.width : child.height;
        const gap =
          sign > 0
            ? childStart - (parentStart + parentSize)
            : parentStart - (childStart + childSize);
        expect(gap).toBe(80);
      }
    },
  );

  it("根配置保留 edge 样式", () => {
    const repaired = repairMindmapElements(graph());
    expect(repairMindmapElements(repaired)).toBe(repaired);
    const styled = repaired.map((element) =>
      isMindmapEdgeElement(element)
        ? { ...element, strokeColor: "#ff0000", routing: "curved" as const }
        : element,
    );
    const relaid = layoutMindmap(indexOf(styled));
    expect(relaid.edges[0]).toMatchObject({
      strokeColor: "#ff0000",
      routing: "curved",
    });
  });

  it("边路由始终沿布局主轴", () => {
    const elements = graph().map((element) =>
      element.id === "a"
        ? { ...element, y: -500 }
        : element.id === "b"
        ? { ...element, y: 500 }
        : element,
    );
    const index = indexOf(repairMindmapElements(elements));
    const horizontal = layoutMindmap(index, { direction: "left-to-right" });
    const horizontalEdge = horizontal.edges.find(
      (edge) => edge.childId === "a",
    )!;
    expect(horizontalEdge.points[1][0]).toBeGreaterThan(
      horizontalEdge.points[0][0],
    );
    expect(horizontalEdge.points[2][0]).toBe(horizontalEdge.points[1][0]);

    const vertical = layoutMindmap(index, { direction: "top-to-bottom" });
    const verticalEdge = vertical.edges.find((edge) => edge.childId === "a")!;
    expect(verticalEdge.points[1][1]).toBeGreaterThan(
      verticalEdge.points[0][1],
    );
    expect(verticalEdge.points[2][1]).toBe(verticalEdge.points[1][1]);
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

  it("多选分支按原树顺序挂接，父子同时选中只移动父分支", () => {
    const elements = graph();
    const before = JSON.stringify(elements);
    const moved = reparentMindmapNodes(
      indexOf(elements),
      ["b", "a", "c"],
      "root",
    );
    const index = indexOf(moved);
    expect(index.childrenById.get("root")).toEqual(["a", "b"]);
    expect(index.childrenById.get("a")).toEqual(["c"]);
    expect(moved.find((element) => element.id === "c")).toBe(elements[3]);
    expect(JSON.stringify(elements)).toBe(before);

    const withTarget = [
      ...elements,
      node("d", "root", { order: "a2" as FractionalIndex }),
    ];
    const reordered = reparentMindmapNodes(
      indexOf(withTarget),
      ["b", "a", "c"],
      "d",
    );
    expect(indexOf(reordered).childrenById.get("d")).toEqual(["a", "b"]);
    expect(indexOf(reordered).childrenById.get("a")).toEqual(["c"]);
  });

  it("同位置挂接不修改节点，非法多选目标被拒绝", () => {
    const elements = graph();
    const index = indexOf(elements);
    const same = reparentMindmapNodes(index, ["a", "c"], "root", "b");
    expect(
      same.every((element) => element === index.nodes.get(element.id)),
    ).toBe(true);
    expect(() => reparentMindmapNodes(index, ["a", "b"], "c")).toThrow();
    expect(() => reparentMindmapNodes(index, ["root"], "a")).toThrow();
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
