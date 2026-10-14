import { getBoundTextElement, isMindmapNodeElement } from "@excalidraw/element";

import { actionChangeStrokeColor } from "../actions";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, render } from "./test-utils";

const { h } = window;
const RED = "#ff0000";

// radix 弹层需要 ResizeObserver（jsdom 没有）
const stubResizeObserver = () => {
  (global as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
};

const getElement = (id: string) => h.app.scene.getNonDeletedElement(id)!;

describe("描边取色域（容器与绑定标签）", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw langCode="zh-CN" handleKeyboardGlobally={true} />);
  });

  /** 建一张「根 + 一级子节点」的脑图，返回两个节点与各自的绑定标签。 */
  const createGraph = async () => {
    UI.clickExtraTool("mindmap");
    const pointer = new Pointer("mouse");
    pointer.clickAt(300, 240);
    let editor = await getTextEditor();
    updateTextEditor(editor, "root");
    Keyboard.exitTextEditor(editor);
    act(() => {
      Keyboard.keyPress("Tab");
    });
    editor = await getTextEditor();
    updateTextEditor(editor, "child");
    Keyboard.exitTextEditor(editor);

    const elementsMap = h.app.scene.getNonDeletedElementsMap();
    const nodes = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapNodeElement);
    const child = nodes.find((node) => node.parentId)!;
    return {
      child,
      childText: getBoundTextElement(child, elementsMap),
      elementsMap,
    };
  };

  it("选中节点取描边：只改节点自身，标签文字保持墨色", async () => {
    const { child, childText, elementsMap } = await createGraph();
    const text = getBoundTextElement(child, elementsMap)!;
    expect(child.strokeColor).not.toBe(text.strokeColor);

    act(() => {
      h.app.setState({ selectedElementIds: { [child.id]: true } });
    });
    h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
      color: RED,
    });

    expect(getElement(child.id).strokeColor).toBe(RED);
    expect(getElement(childText!.id).strokeColor).toBe(text.strokeColor);
  });

  it("编辑节点文本取色：只改文字色，节点描边不动", async () => {
    const { child, childText } = await createGraph();

    UI.clickExtraTool("mindmap");
    new Pointer("mouse").doubleClickAt(
      child.x + child.width / 2,
      child.y + child.height / 2,
    );
    const editor = await getTextEditor();
    expect(h.state.editingTextElement?.id).toBe(childText!.id);

    h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
      color: RED,
    });

    expect(getElement(childText!.id).strokeColor).toBe(RED);
    expect(getElement(child.id).strokeColor).toBe(child.strokeColor);
    act(() => editor.blur());
  });

  it("编辑节点文本：色板与弹层小标题都是「字体颜色」", async () => {
    const { child } = await createGraph();

    UI.clickExtraTool("mindmap");
    new Pointer("mouse").doubleClickAt(
      child.x + child.width / 2,
      child.y + child.height / 2,
    );
    await getTextEditor();

    stubResizeObserver();
    UI.clickLabeledElement("字体颜色");
    expect(document.querySelector(".color-picker__title")?.textContent).toBe(
      "字体颜色",
    );
  });

  it("容器取描边不连带标签：图形与脑图节点都一样，便签例外", async () => {
    const rect = API.createElement({
      type: "rectangle",
      id: "rect",
      x: 0,
      y: 0,
      boundElements: [{ type: "text", id: "rect-label" }],
    });
    const rectLabel = API.createElement({
      type: "text",
      id: "rect-label",
      x: 0,
      y: 0,
      text: "label",
      containerId: "rect",
    });
    const node = API.createElement({
      type: "mindmap-node" as any,
      id: "node",
      x: 400,
      y: 0,
      boundElements: [{ type: "text", id: "node-label" }],
    });
    const nodeLabel = API.createElement({
      type: "text",
      id: "node-label",
      x: 400,
      y: 0,
      text: "node",
      containerId: "node",
    });
    const note = API.createElement({
      type: "stickynote",
      id: "note",
      x: 800,
      y: 0,
      boundElements: [{ type: "text", id: "note-label" }],
    });
    const noteLabel = API.createElement({
      type: "text",
      id: "note-label",
      x: 800,
      y: 0,
      text: "note",
      containerId: "note",
    });
    API.setElements([rect, rectLabel, node, nodeLabel, note, noteLabel]);
    act(() => {
      API.setAppState({
        selectedElementIds: { rect: true, node: true, note: true },
      });
    });

    h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
      color: RED,
    });

    expect(getElement("rect").strokeColor).toBe(RED);
    expect(getElement("rect-label").strokeColor).not.toBe(RED);
    expect(getElement("node").strokeColor).toBe(RED);
    expect(getElement("node-label").strokeColor).not.toBe(RED);
    expect(getElement("note").strokeColor).toBe(RED);
    expect(getElement("note-label").strokeColor).toBe(RED);
  });
});
