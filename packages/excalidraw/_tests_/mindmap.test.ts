import { applyDarkModeFilter, arrayToMap } from "@excalidraw/common";
import {
  applyMindmapBranchTheme,
  buildMindmapGraphIndex,
  getCompletelySelectedMindmapGraphElementIds,
  getNonDeletedElements,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  newElement,
  newMindmapEdgeElement,
  newMindmapNodeElement,
  MINDMAP_LEVEL_DISTANCE,
  Scene,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { restoreElement, restoreElements } from "../data/restore";
import { serializeAsJSON } from "../data/json";
import { exportToCanvas, exportToSvg } from "../scene/export";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

const fixture = () => {
  const rootNode = newMindmapNodeElement({
    x: 100,
    y: 80,
    graphId: "graph",
    role: "root",
    parentId: null,
    order: null,
  });
  const childNode = newMindmapNodeElement({
    x: 500,
    y: 300,
    graphId: "graph",
    role: "node",
    parentId: rootNode.id,
    order: "a0" as FractionalIndex,
  });
  return [
    { ...rootNode, texts: API.mindmapBody(rootNode, "根") },
    { ...childNode, texts: API.mindmapBody(childNode, "节点文字") },
  ];
};

const restore = (elements: readonly ExcalidrawElement[]) =>
  restoreElements(elements, null, { repairBindings: true });

describe("mindmap 场景恢复与渲染基础", () => {
  it("完整场景恢复生成 edge、自动布局并读取节点正文", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const restored = restore(input);
    const index = buildMindmapGraphIndex(restored, "graph");
    expect(index.nodes.size).toBe(2);
    expect(index.edgeByChildId.size).toBe(1);
    const child = index.nodes.get(input[1].id)!;
    expect(child.x).toBe(input[0].x + input[0].width + MINDMAP_LEVEL_DISTANCE);
    expect(child.texts?.body?.text).toBe("节点文字");
    expect(restored.some((element) => element.type === "text")).toBe(false);
    expect(restored.every((element) => element.index !== null)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    expect(restore(restored)).toEqual(restored);
  });

  it("JSON 往返保留正式字段、折叠子树和宿主 customData", () => {
    const input = fixture();
    const restored = restore([
      {
        ...input[0],
        collapsed: true,
        customData: { host: "保留" },
      } as ExcalidrawElement,
      ...input.slice(1),
    ]);
    const json = serializeAsJSON(restored, getDefaultAppState(), {}, "local");
    const decoded = JSON.parse(json).elements as ExcalidrawElement[];
    const result = restore(decoded);
    expect(result).toEqual(restored);
    expect(result.find((element) => element.id === input[0].id)).toMatchObject({
      graphId: "graph",
      role: "root",
      collapsed: true,
      customData: { host: "保留" },
    });
    expect(result.filter((element) => !element.isDeleted)).toHaveLength(3);
    const cleaned = restoreElements(result, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    });
    expect(cleaned).toEqual(result);
  });

  it("P05 JSON 往返保留布局方向、默认样式和节点形状", () => {
    const input = fixture();
    const configured = input.map((element) =>
      element.id === input[0].id
        ? {
            ...element,
            layoutDirection: "bottom-to-top" as const,
            defaultNodeShape: "pill" as const,
            defaultEdgeRouting: "curved" as const,
            defaultEdgeStrokeColor: "#6741d9",
            defaultEdgeStrokeWidth: 3,
            defaultEdgeStrokeStyle: "dashed" as const,
          }
        : element.id === input[1].id
        ? {
            ...element,
            shape: { id: "diamond" as const, schemaVersion: 1 as const },
          }
        : element,
    );
    const restored = restore(configured);
    const json = serializeAsJSON(restored, getDefaultAppState(), {}, "local");
    const reopened = restore(JSON.parse(json).elements as ExcalidrawElement[]);
    const root = reopened.find((element) => element.id === input[0].id);
    const child = reopened.find((element) => element.id === input[1].id);

    expect(root).toMatchObject({
      layoutDirection: "bottom-to-top",
      defaultNodeShape: "pill",
      defaultEdgeRouting: "curved",
      defaultEdgeStrokeColor: "#6741d9",
      defaultEdgeStrokeWidth: 3,
      defaultEdgeStrokeStyle: "dashed",
    });
    expect(child).toMatchObject({ shape: { id: "diamond", schemaVersion: 1 } });
  });

  it("字段级恢复补全缺省值，独立恢复不擅自提升子节点为根", () => {
    const input = fixture();
    const child = input[1];
    const partial = {
      ...child,
      collapsed: "yes",
      width: NaN,
      height: 0,
      order: "!invalid",
    } as unknown as typeof child;
    const restored = restoreElement(partial, arrayToMap(input), null);
    expect(restored).toMatchObject({
      type: "mindmap-node",
      parentId: input[0].id,
      role: "node",
      order: null,
      shape: { id: "rectangle", schemaVersion: 1 },
      collapsed: false,
      width: 160,
      height: 56,
    });
    const incremental = restoreElements([child], input);
    expect(incremental[0]).toMatchObject({
      role: "node",
      parentId: input[0].id,
    });
    expect(incremental).toHaveLength(1);
  });

  it.each([
    { id: "unknown", schemaVersion: 1 },
    { id: "rectangle" },
    { id: "pill", schemaVersion: 2 },
    { id: "diamond", schemaVersion: 1, extra: true },
  ])("rejects invalid mindmap shape on restore: %j", (shape) => {
    const child = fixture()[1];
    const invalid = { ...child, shape } as unknown as typeof child;
    expect(() => restoreElement(invalid, arrayToMap([child]), null)).toThrow(
      "Unsupported mindmap shape data",
    );
    expect(() => restore([invalid])).toThrow("Unsupported mindmap shape data");
  });

  it("普通图形的恢复结果和位置保持不变", () => {
    const rectangle = newElement({
      type: "rectangle",
      x: 20,
      y: 60,
      width: 80,
      height: 50,
      customData: { graphId: "not-a-mindmap" },
    });
    const restored = restore([rectangle]);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      type: "composite",
      shape: { id: "rectangle", schemaVersion: 1 },
      x: 20,
      y: 60,
      width: 80,
      height: 50,
      customData: rectangle.customData,
    });
    expect(restored[0]).not.toHaveProperty("graphId");
  });

  it("渲染器只显示折叠节点，Scene 保留完整子树", () => {
    const input = fixture();
    const elements = restore([
      { ...input[0], collapsed: true } as ExcalidrawElement,
      ...input.slice(1),
    ]);
    const scene = new Scene(elements);
    const renderer = new Renderer(scene);
    const state = {
      ...getDefaultAppState(),
      width: 1000,
      height: 1000,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const { elementsMap } = renderer.getRenderableElements({
      zoom: state.zoom,
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: 0,
      scrollY: 0,
      width: 1000,
      height: 1000,
      editingTextElement: null,
      newElement: null,
      selectedElements: [],
      selectedElementsAreBeingDragged: false,
      frameToHighlight: null,
    });
    expect([...elementsMap.keys()]).toEqual([input[0].id]);
    expect(scene.getNonDeletedElements()).toHaveLength(3);
    scene.destroy();
  });

  it("SVG 导出节点、文字和 edge，并按当前折叠状态过滤", async () => {
    const elements = restore(fixture());
    const state = {
      ...getDefaultAppState(),
      width: 1000,
      height: 1000,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const svg = await exportToSvg(
      getNonDeletedElements(elements),
      state,
      {},
      { skipInliningFonts: true },
    );
    const edge = elements.find(isMindmapEdgeElement)!;
    expect(svg.querySelector(`[data-id='${edge.id}']`)).not.toBeNull();
    expect(svg.textContent).toContain("节点文字");
    const collapsed = restore(
      elements.map((element) =>
        element.id === elements[0].id
          ? ({ ...element, collapsed: true } as ExcalidrawElement)
          : element,
      ),
    );
    const collapsedSvg = await exportToSvg(
      getNonDeletedElements(collapsed),
      state,
      {},
      { skipInliningFonts: true },
    );
    expect(collapsedSvg.querySelector(`[data-id='${edge.id}']`)).toBeNull();
    expect(collapsedSvg.textContent).not.toContain("节点文字");
    expect(Number(collapsedSvg.getAttribute("width"))).toBeLessThan(
      Number(svg.getAttribute("width")),
    );
  });

  it("Canvas 导出根据可见节点计算尺寸", async () => {
    const elements = restore(fixture());
    const state = {
      ...getDefaultAppState(),
      width: 1000,
      height: 1000,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const options = { exportBackground: true, viewBackgroundColor: "#ffffff" };
    const canvas = await exportToCanvas(
      getNonDeletedElements(elements),
      state,
      {},
      options,
      undefined,
      async () => {},
    );
    const collapsed = restore(
      elements.map((element) =>
        element.id === elements[0].id
          ? ({ ...element, collapsed: true } as ExcalidrawElement)
          : element,
      ),
    );
    const collapsedCanvas = await exportToCanvas(
      getNonDeletedElements(collapsed),
      state,
      {},
      options,
      undefined,
      async () => {},
    );
    expect(collapsedCanvas.width).toBeLessThan(canvas.width);
    expect(collapsedCanvas.height).toBeGreaterThan(0);
  });
});

describe("mindmap P12 分支主题导出", () => {
  /** root → a（一级）→ b（二级），恢复后整图派生 */
  const themedFixture = () => {
    const base = fixture();
    const rootNode = base[0] as ExcalidrawMindmapNodeElement;
    const child = base[1] as ExcalidrawMindmapNodeElement;
    const grandchildNode = newMindmapNodeElement({
      x: 0,
      y: 0,
      graphId: "graph",
      role: "node",
      parentId: child.id,
      order: "a0" as FractionalIndex,
    });
    const elements = restore([
      { ...rootNode, texts: API.mindmapBody(rootNode, "根") },
      child,
      {
        ...grandchildNode,
        texts: API.mindmapBody(grandchildNode, "叶"),
      },
    ]);
    return applyMindmapBranchTheme(
      elements,
      "graph",
      elements.filter(isMindmapNodeElement).map((element) => element.id),
    );
  };

  it("text 形态与 fontWeight 随 JSON 往返保留", () => {
    const themed = themedFixture();
    const nodes = themed.filter(isMindmapNodeElement);
    const rootNode = nodes.find((element) => element.role === "root")!;
    const childNode = nodes.find(
      (element) => element.parentId === rootNode.id,
    )!;
    const grandchild = nodes.find(
      (element) => element.parentId === childNode.id,
    )!;
    expect(grandchild.shape.id).toBe("text");
    const json = serializeAsJSON(themed, getDefaultAppState(), {}, "local");
    const reopened = restore(JSON.parse(json).elements as ExcalidrawElement[]);
    expect(
      reopened.find((element) => element.id === grandchild.id),
    ).toMatchObject({ shape: { id: "text", schemaVersion: 1 } });
    const reopenedRoot = reopened.find((element) => element.id === rootNode.id);
    expect(reopenedRoot).toMatchObject({
      texts: { body: { style: { fontWeight: 600 } } },
    });
  });

  it("SVG 导出层级形态与分支色，暗色走统一滤镜", async () => {
    const themed = themedFixture();
    const state = {
      ...getDefaultAppState(),
      width: 1000,
      height: 1000,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const svg = await exportToSvg(
      getNonDeletedElements(themed),
      state,
      {},
      { skipInliningFonts: true },
    );
    const html = svg.outerHTML;
    // 根：实心墨色 + 16px 600 反色文字
    expect(html).toContain('fill="#1f2329"');
    expect(html).toContain('font-weight="600"');
    // 一级分支（teal）胶囊与连线
    expect(html).toContain('stroke="#0e8c7e"');
    expect(html).toContain('fill="#e6f4f1"');
    // 二级 text 节点：只画下划线（无填充）
    const grandchild = themed.find(
      (element) => isMindmapNodeElement(element) && element.shape.id === "text",
    )!;
    const group = svg.querySelector(`[data-id='${grandchild.id}']`);
    expect(group).not.toBeNull();
    const underlinePath = group!.querySelector("path");
    expect(underlinePath?.getAttribute("d")).toMatch(/^M\s?0 \d/);
    expect(underlinePath?.getAttribute("stroke")).toBe("#0e8c7e");
    expect(underlinePath?.getAttribute("fill")).toBe("none");

    // 暗色：元素色经全 app 统一滤镜
    const darkSvg = await exportToSvg(
      getNonDeletedElements(themed),
      { ...state, exportWithDarkMode: true },
      {},
      { skipInliningFonts: true },
    );
    expect(darkSvg.outerHTML).toContain(
      `fill="${applyDarkModeFilter("#1f2329", true)}"`,
    );
  });
});

describe("getCompletelySelectedMindmapGraphElementIds", () => {
  const graphFixture = () => {
    const root = {
      ...newMindmapNodeElement({
        x: 100,
        y: 80,
        graphId: "graph",
        role: "root",
        parentId: null,
        order: null,
      }),
      id: "root",
    };
    const child = {
      ...newMindmapNodeElement({
        x: 500,
        y: 300,
        graphId: "graph",
        role: "node",
        parentId: "root",
        order: "a0" as FractionalIndex,
      }),
      id: "child",
    };
    const edge = {
      ...newMindmapEdgeElement({
        x: 0,
        y: 0,
        graphId: "graph",
        parentId: "root",
        childId: "child",
      }),
      id: "edge",
    };
    return [
      { ...root, texts: API.mindmapBody(root, "根") },
      { ...child, texts: API.mindmapBody(child, "子") },
      edge,
    ];
  };

  const select = (...ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, true as const]));

  it("整图选中（节点+边）时返回全部成员", () => {
    const elements = graphFixture();
    const suppressed = getCompletelySelectedMindmapGraphElementIds(
      elements,
      select("root", "child", "edge"),
    );
    expect([...suppressed].sort()).toEqual(["root", "child", "edge"].sort());
  });

  it("节点正文不产生额外的选中成员", () => {
    const elements = graphFixture();
    const suppressed = getCompletelySelectedMindmapGraphElementIds(
      elements,
      select("root", "child", "edge"),
    );
    expect(suppressed.size).toBe(3);
    expect(suppressed.has("root")).toBe(true);
    expect(suppressed.has("child")).toBe(true);
  });

  it("仅根节点选中（部分选中）时返回空集", () => {
    const elements = graphFixture();
    expect(
      getCompletelySelectedMindmapGraphElementIds(elements, select("root"))
        .size,
    ).toBe(0);
  });

  it("缺一条边时不算完整选中", () => {
    const elements = graphFixture();
    expect(
      getCompletelySelectedMindmapGraphElementIds(
        elements,
        select("root", "child"),
      ).size,
    ).toBe(0);
  });

  it("图外元素的选中不混入结果，也不影响完整性判定", () => {
    const rect = { ...newElement({ type: "rectangle", x: 0, y: 0 }), id: "r" };
    const elements = [...graphFixture(), rect];
    const suppressed = getCompletelySelectedMindmapGraphElementIds(
      elements,
      select("root", "child", "edge", "r"),
    );
    expect(suppressed.has("r")).toBe(false);
    expect(suppressed.size).toBe(3);
  });

  it("已删除的图成员被忽略，不影响完整性判定", () => {
    const [root, child, edge] = graphFixture();
    const elements = [
      root,
      child,
      edge,
      {
        ...newMindmapNodeElement({
          x: 0,
          y: 0,
          graphId: "graph",
          role: "node",
          parentId: "child",
          order: "a0" as FractionalIndex,
        }),
        id: "leaf",
        isDeleted: true as const,
      },
    ];
    const suppressed = getCompletelySelectedMindmapGraphElementIds(
      elements,
      select("root", "child", "edge"),
    );
    expect([...suppressed].sort()).toEqual(["root", "child", "edge"].sort());
  });

  it("没有任何选中时返回空集", () => {
    const elements = graphFixture();
    expect(getCompletelySelectedMindmapGraphElementIds(elements, {}).size).toBe(
      0,
    );
  });
});
