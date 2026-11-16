import {
  buildMindmapGraphFromTree,
  isMindmapNodeElement,
} from "@excalidraw/element";

import { actionChangeStrokeColor } from "../actions";
import { restoreElements } from "../data/restore";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { getTextEditor } from "./queries/dom";
import { act, render } from "./test-utils";

const { h } = window;
const RED = "#ff0000";

const getElement = (id: string) => h.app.scene.getNonDeletedElement(id)!;

describe("描边取色域（容器与绑定标签）", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw langCode="zh-CN" handleKeyboardGlobally={true} />);
  });

  /**
   * 建一张「根 + 一级子节点」的脑图（确定夹具，不再走点击建图——点击现在
   * 会建出整张预设导图），返回子节点。
   */
  const createGraph = async () => {
    const { elements } = buildMindmapGraphFromTree(
      { text: "root", children: [{ text: "child", children: [] }] },
      { x: 300, y: 240 },
    );
    API.setElements(restoreElements(elements, null, { repairBindings: true }));
    UI.clickTool("mindmap");

    const nodes = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapNodeElement);
    const child = nodes.find((node) => node.parentId)!;
    return { child };
  };

  it("选中节点取描边：只改节点自身，正文颜色保持不变", async () => {
    const { child } = await createGraph();
    const bodyColor = child.texts?.body?.style.color;

    act(() => {
      h.app.setState({ selectedElementIds: { [child.id]: true } });
    });
    act(() => {
      h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
        color: RED,
      });
    });

    expect(getElement(child.id).strokeColor).toBe(RED);
    expect(getElement(child.id).texts?.body?.style.color).toBe(bodyColor);
  });

  it("编辑节点正文时取描边：改节点描边，正文颜色不动", async () => {
    const { child } = await createGraph();
    const bodyColor = child.texts?.body?.style.color;

    UI.clickTool("mindmap");
    new Pointer("mouse").doubleClickAt(
      child.x + child.width / 2,
      child.y + child.height / 2,
    );
    const editor = await getTextEditor();
    expect(h.state.editingTextRegion?.target.elementId).toBe(child.id);

    act(() => {
      h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
        color: RED,
      });
    });

    expect(getElement(child.id).strokeColor).toBe(RED);
    expect(getElement(child.id).texts?.body?.style.color).toBe(bodyColor);
    act(() => editor.blur());
  });

  it("容器取描边不连带正文：图形与脑图节点都一样，便签正文跟随墨色", async () => {
    const bodyTexts = {
      body: {
        text: "label",
        style: {
          fontFamily: 1,
          fontSize: 20,
          lineHeight: 1.25,
          textAlign: "center",
          verticalAlign: "middle",
        } as any,
      },
    };
    const rect = API.createElement({
      type: "rectangle",
      id: "rect",
      x: 0,
      y: 0,
      texts: bodyTexts,
    });
    const node = API.createElement({
      type: "mindmap-node" as any,
      id: "node",
      x: 400,
      y: 0,
      texts: API.mindmapBody({ role: "root" }, "node"),
    });
    const note = API.createElement({
      type: "stickynote",
      id: "note",
      x: 800,
      y: 0,
      texts: bodyTexts,
    });
    API.setElements([rect, node, note]);
    act(() => {
      API.setAppState({
        selectedElementIds: { rect: true, node: true, note: true },
      });
    });

    act(() => {
      h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
        color: RED,
      });
    });

    expect(getElement("rect").strokeColor).toBe(RED);
    expect(getElement("rect").texts?.body?.style.color).not.toBe(RED);
    expect(getElement("node").strokeColor).toBe(RED);
    expect(getElement("node").texts?.body?.style.color).not.toBe(RED);
    expect(getElement("note").strokeColor).toBe(RED);
    // 便签正文未设显式颜色时跟随便签墨色，因此不改写正文自身颜色
    expect(getElement("note").texts?.body?.style.color).toBe(
      bodyTexts.body.style.color,
    );
  });
});
