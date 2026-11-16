import { getNonDeletedElements } from "@excalidraw/element";
import {
  buildMindmapGraphFromTree,
  buildMindmapGraphIndex,
  getMindmapNodeTextStyle,
  getMindmapNodeTheme,
  isMindmapEdgeElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import type { MindmapTreeSpec } from "@excalidraw/element";
import type {
  ExcalidrawMindmapNodeElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";
import { exportToSvg } from "../scene/export";
import { getDefaultAppState } from "../appState";
import { getMindmapPresetTree } from "../components/app/createPresets";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, render, unmountComponent } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

unmountComponent();

const longText = "节点正文自动换行并撑高节点".repeat(8);

const getLiveNode = (elementId: string) =>
  h.app.scene.getNonDeletedElement(
    elementId,
  ) as NonDeleted<ExcalidrawMindmapNodeElement>;

const textElements = () =>
  h.elements.filter((element) => !element.isDeleted && element.type === "text");

const submitText = async (text: string) => {
  const editor = await getTextEditor();
  updateTextEditor(editor, text);
  act(() => {
    h.app.textWysiwygSubmitHandler?.();
  });
};

const startEditingNode = (node: ExcalidrawMindmapNodeElement) => {
  act(() => {
    h.app.startTextEditing({
      sceneX: node.x + node.width / 2,
      sceneY: node.y + node.height / 2,
      container: node,
    });
  });
};

const setGraph = (tree: MindmapTreeSpec) => {
  const { elements, graphId } = buildMindmapGraphFromTree(tree, {
    x: 100,
    y: 100,
  });
  API.setElements(restoreElements(elements, null, { repairBindings: true }));
  return graphId;
};

describe("mindmap text embedding", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements([]);
  });

  it("预设建图生成带 texts.body 的节点，根节点反色标题样式", () => {
    const { elements } = buildMindmapGraphFromTree(getMindmapPresetTree(), {
      x: 100,
      y: 100,
    });
    API.setElements(restoreElements(elements, null, { repairBindings: true }));

    const nodes = h.elements
      .filter((element) => !element.isDeleted)
      .filter(isMindmapNodeElement);
    expect(nodes).toHaveLength(10);
    expect(textElements()).toHaveLength(0);
    expect(
      nodes.every(
        (node) =>
          typeof node.texts?.body?.text === "string" && !!node.texts.body.text,
      ),
    ).toBe(true);
    const root = nodes.find((node) => node.role === "root")!;
    expect(root.texts?.body?.style).toMatchObject({
      fontSize: 16,
      fontWeight: 600,
      color: "#ffffff",
    });
    expect(root.texts?.body?.style).toEqual(
      getMindmapNodeTextStyle({ role: "root" }),
    );
  });

  it("双击编辑写入 texts.body，撑高节点并重排兄弟与派生边", async () => {
    const graphId = setGraph({
      text: "root",
      children: [
        { text: "a", children: [] },
        { text: "b", children: [] },
      ],
    });
    const index = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      graphId,
    );
    const childA = index.nodes.get(index.childrenById.get(index.rootId)![0])!;
    const childB = index.nodes.get(index.childrenById.get(index.rootId)![1])!;
    const siblingY = childB.y;
    const edgeBefore = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapEdgeElement)
      .find((edge) => edge.childId === childB.id)!;
    const edgePointsBefore = JSON.stringify(edgeBefore.points);
    const heightBefore = childA.height;

    UI.clickTool("mindmap");
    mouse.doubleClickAt(
      childA.x + childA.width / 2,
      childA.y + childA.height / 2,
    );
    expect(h.state.editingTextRegion?.target.elementId).toBe(childA.id);
    expect(h.state.editingTextElement).toBe(null);

    await submitText(longText);

    const live = getLiveNode(childA.id);
    expect(live.texts?.body?.text).toBe(longText);
    expect(live.height).toBeGreaterThan(heightBefore);
    expect(getLiveNode(childB.id).y).not.toBe(siblingY);
    const edgeAfter = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapEdgeElement)
      .find((edge) => edge.childId === childB.id)!;
    expect(JSON.stringify(edgeAfter.points)).not.toBe(edgePointsBefore);
    expect(textElements()).toHaveLength(0);
    expect(h.state.editingTextRegion).toBe(null);
  });

  it("输入长正文时节点与兄弟位置在提交前实时重排", async () => {
    const graphId = setGraph({
      text: "root",
      children: [
        { text: "a", children: [] },
        { text: "b", children: [] },
      ],
    });
    const index = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      graphId,
    );
    const childA = index.nodes.get(index.childrenById.get(index.rootId)![0])!;
    const childB = index.nodes.get(index.childrenById.get(index.rootId)![1])!;
    const heightBefore = childA.height;
    const siblingY = childB.y;

    startEditingNode(childA);
    const editor = await getTextEditor();
    updateTextEditor(editor, longText);

    const live = getLiveNode(childA.id);
    expect(live.texts?.body?.text).toBe(longText);
    expect(live.height).toBeGreaterThan(heightBefore);
    expect(getLiveNode(childB.id).y).not.toBe(siblingY);
    expect(h.state.editingTextRegion).not.toBe(null);

    Keyboard.exitTextEditor(editor);
  });

  it("提交空文本删除 body key，节点保持不变", async () => {
    setGraph({ text: "root", children: [] });
    const rootNode = getLiveNode(
      h.elements
        .filter((element) => !element.isDeleted)
        .find(isMindmapNodeElement)!.id,
    );
    expect(rootNode.texts?.body?.text).toBe("root");

    startEditingNode(rootNode);
    await submitText("");

    const live = getLiveNode(rootNode.id);
    expect(live.texts).toBe(undefined);
    expect(h.app.scene.getNonDeletedElement(rootNode.id)).not.toBe(null);
    expect(h.state.editingTextRegion).toBe(null);
  });

  it("重挂节点后按新位置重新派生正文样式", () => {
    const { elements, graphId } = buildMindmapGraphFromTree(
      {
        text: "root",
        children: [{ text: "a", children: [{ text: "a1", children: [] }] }],
      },
      { x: 100, y: 100 },
    );
    API.setElements(restoreElements(elements, null, { repairBindings: true }));
    const index = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      graphId,
    );
    const rootId = index.rootId;
    const branchId = index.childrenById.get(rootId)![0];
    const leafId = index.childrenById.get(branchId)![0];
    const before = getLiveNode(leafId);
    expect(before.texts?.body?.style.fontSize).toBe(
      getMindmapNodeTextStyle({ role: "node" }).fontSize,
    );

    act(() => {
      h.app.mindmap.reparentNode(leafId, rootId, null);
    });

    const live = getLiveNode(leafId);
    const nextIndex = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      graphId,
    );
    const theme = getMindmapNodeTheme(nextIndex, leafId);
    expect(live.texts?.body?.style.fontSize).toBe(theme.text.fontSize);
    expect(live.texts?.body?.style.color).toBe(theme.text.strokeColor);
    expect(live.texts?.body?.style.fontWeight).toBe(theme.text.fontWeight);
  });

  it("layoutFrozen 节点只截断正文，不随正文撑高", async () => {
    const node = API.createElement({
      type: "mindmap-node",
      id: "frozen",
      x: 100,
      y: 100,
      width: 160,
      height: 56,
      texts: API.mindmapBody({ role: "root" }, "短标题"),
      mindmap: {
        graphId: "frozen",
        parentId: null,
        order: null,
        shape: { id: "rectangle", schemaVersion: 1 },
        collapsed: false,
      },
    });
    API.setElements([{ ...node, layoutFrozen: true }]);
    const frozen = getLiveNode(node.id);

    startEditingNode(frozen);
    await submitText(longText);

    const live = getLiveNode(node.id);
    expect(live.texts?.body?.text).toBe(longText);
    expect(live.height).toBe(frozen.height);
    expect(live.width).toBe(frozen.width);
    expect(textElements()).toHaveLength(0);
  });

  it("SVG 导出包含节点正文文本", async () => {
    setGraph({ text: "导出标签", children: [] });
    const state = {
      ...getDefaultAppState(),
      width: 1000,
      height: 1000,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const svg = await exportToSvg(
      getNonDeletedElements(h.app.scene.getNonDeletedElements()),
      state,
      {},
      { skipInliningFonts: true },
    );
    expect(svg.querySelector("text")).not.toBeNull();
    expect(svg.textContent).toContain("导出标签");
  });
});
