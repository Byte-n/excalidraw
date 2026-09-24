import { arrayToMap } from "@excalidraw/common";
import {
  buildMindmapGraphIndex,
  computeBoundTextPosition,
  getNonDeletedElements,
  isMindmapEdgeElement,
  newElement,
  newMindmapNodeElement,
  newTextElement,
  Scene,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElementWithContainer,
  FractionalIndex,
} from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { restoreElement, restoreElements } from "../data/restore";
import { serializeAsJSON } from "../data/json";
import { exportToCanvas, exportToSvg } from "../scene/export";
import { Renderer } from "../scene/Renderer";

const fixture = () => {
  const root = newMindmapNodeElement({
    x: 100,
    y: 80,
    graphId: "graph",
    role: "root",
    parentId: null,
    order: null,
  });
  const child = newMindmapNodeElement({
    x: 500,
    y: 300,
    graphId: "graph",
    role: "node",
    parentId: root.id,
    order: "a0" as FractionalIndex,
  });
  const text = newTextElement({
    x: 0,
    y: 0,
    text: "节点文字",
    containerId: child.id,
    textAlign: "center",
    verticalAlign: "middle",
  });
  return [
    root,
    { ...child, boundElements: [{ type: "text" as const, id: text.id }] },
    text,
  ];
};

const restore = (elements: readonly ExcalidrawElement[]) =>
  restoreElements(elements, null, { repairBindings: true });

describe("mindmap 场景恢复与渲染基础", () => {
  it("完整场景恢复生成 edge、自动布局并同步绑定文字", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const restored = restore(input);
    const index = buildMindmapGraphIndex(restored, "graph");
    expect(index.nodes.size).toBe(2);
    expect(index.edgeByChildId.size).toBe(1);
    const child = index.nodes.get(input[1].id)!;
    expect(child.x).toBe(input[0].x + input[0].width + 80);
    const text = restored.find(
      (element) => element.type === "text",
    ) as ExcalidrawTextElementWithContainer;
    expect(text).toMatchObject(
      computeBoundTextPosition(child, text, arrayToMap(restored)),
    );
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
    expect(result.filter((element) => !element.isDeleted)).toHaveLength(4);
    const cleaned = restoreElements(result, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    });
    expect(cleaned).toEqual(result);
  });

  it("字段级恢复补全缺省值，独立恢复不擅自提升子节点为根", () => {
    const input = fixture();
    const child = input[1];
    const partial = {
      ...child,
      shape: "unknown",
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
      shape: "rectangle",
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
      type: "rectangle",
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
    expect(scene.getNonDeletedElements()).toHaveLength(4);
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
