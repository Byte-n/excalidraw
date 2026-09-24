import {
  getBoundTextElement,
  isMindmapEdgeElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import { Excalidraw } from "../index";

import { getTextEditor, updateTextEditor } from "./queries/dom";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { API } from "./helpers/api";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";

const { h } = window;

describe("mindmap creation tool", () => {
  const getNodes = () =>
    h.app.scene.getNonDeletedElements().filter(isMindmapNodeElement);
  const getEdges = () =>
    h.app.scene.getNonDeletedElements().filter(isMindmapEdgeElement);
  const blurEditor = async (editor: HTMLTextAreaElement) => {
    await waitFor(() => {
      expect(editor.onblur).toEqual(expect.any(Function));
      expect(editor.ownerDocument.activeElement).toBe(editor);
    });
    act(() => editor.blur());
    expect(h.state.editingTextElement).toBeNull();
    expect(editor).not.toBeInTheDocument();
  };

  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("creates a root and a child with bound text and an edge", async () => {
    UI.clickExtraTool("mindmap");
    const pointer = new Pointer("mouse");
    pointer.clickAt(300, 240);

    let editor = await getTextEditor();
    updateTextEditor(editor, "Product plan");
    Keyboard.exitTextEditor(editor);

    act(() => {
      Keyboard.keyPress("Tab");
    });
    editor = await getTextEditor();
    updateTextEditor(editor, "Research");
    Keyboard.exitTextEditor(editor);

    const nodes = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapNodeElement);
    const edges = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapEdgeElement);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(nodes.find((node) => node.role === "root")?.boundElements).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );
    expect(nodes.find((node) => node.role === "node")?.parentId).toBe(
      nodes.find((node) => node.role === "root")?.id,
    );

    Keyboard.undo();
    expect(
      h.app.scene.getNonDeletedElements().filter(isMindmapNodeElement),
    ).toHaveLength(1);
    Keyboard.redo();
    expect(
      h.app.scene.getNonDeletedElements().filter(isMindmapNodeElement),
    ).toHaveLength(2);
  });

  describe.each(["root", "Tab", "Enter", "button"] as const)(
    "%s 创建的空节点",
    (createWith) => {
      describe.each(["blur", "Escape"] as const)("%s 提交", (submitWith) => {
        it.each([
          { name: "始终为空", values: [] as string[] },
          { name: "输入后清空", values: ["临时内容", ""] },
          { name: "仅含空白", values: [" \n  "] },
        ])(
          "$name：保留节点和连接线，并支持单步撤销重做",
          async ({ values }) => {
            UI.clickExtraTool("mindmap");
            const pointer = new Pointer("mouse");
            let historyLength = API.getUndoStack().length;
            pointer.clickAt(300, 240);
            let editor = await getTextEditor();

            if (createWith !== "root") {
              updateTextEditor(editor, "根节点");
              Keyboard.exitTextEditor(editor);
              historyLength = API.getUndoStack().length;
              if (createWith === "button") {
                const root = getNodes()[0];
                pointer.moveTo(
                  root.x + root.width / 2,
                  root.y + root.height / 2,
                );
                fireEvent.click(
                  screen.getByRole("button", { name: "Add child node" }),
                );
              } else {
                Keyboard.keyPress(createWith);
              }
              editor = await getTextEditor();
            }

            expect(editor.value).toBe("");
            const textElement = h.state.editingTextElement!;
            const nodeId = textElement.containerId!;
            expect(nodeId).toBe(getNodes()[createWith === "root" ? 0 : 1].id);
            const nodeIds = getNodes().map((node) => node.id);
            const edges = getEdges().map(({ id, parentId, childId }) => ({
              id,
              parentId,
              childId,
            }));
            expect(nodeIds).toHaveLength(createWith === "root" ? 1 : 2);
            expect(edges).toHaveLength(createWith === "root" ? 0 : 1);

            for (const value of values) {
              updateTextEditor(editor, value);
            }
            if (submitWith === "blur") {
              await blurEditor(editor);
            } else {
              Keyboard.exitTextEditor(editor);
            }

            expect(h.state.editingTextElement).toBeNull();
            expect(getNodes().map((node) => node.id)).toEqual(nodeIds);
            expect(getEdges()).toEqual(
              edges.map((edge) => expect.objectContaining(edge)),
            );
            expect(h.app.scene.getElement(textElement.id)?.isDeleted).toBe(
              true,
            );
            expect(
              getNodes().find((node) => node.id === nodeId)?.boundElements,
            ).not.toEqual(
              expect.arrayContaining([
                expect.objectContaining({ type: "text" }),
              ]),
            );
            expect(API.getUndoStack()).toHaveLength(historyLength + 1);

            Keyboard.undo();
            expect(getNodes().map((node) => node.id)).toEqual(
              nodeIds.filter((id) => id !== nodeId),
            );
            expect(getEdges()).toHaveLength(0);
            Keyboard.redo();
            expect(getNodes().map((node) => node.id)).toEqual(nodeIds);
            expect(getEdges()).toEqual(
              edges.map((edge) => expect.objectContaining(edge)),
            );
          },
        );
      });
    },
  );

  it.each(["root", "child"] as const)(
    "空 %s 节点可以重新编辑并撤销文字修改",
    async (kind) => {
      UI.clickExtraTool("mindmap");
      const pointer = new Pointer("mouse");
      pointer.clickAt(300, 240);
      let editor = await getTextEditor();
      Keyboard.exitTextEditor(editor);
      if (kind === "child") {
        Keyboard.keyPress("Tab");
        editor = await getTextEditor();
        Keyboard.exitTextEditor(editor);
      }

      const nodeId = Object.keys(h.state.selectedElementIds)[0];
      const node = getNodes().find((element) => element.id === nodeId)!;
      const nodeIds = getNodes().map((element) => element.id);
      const getText = () =>
        getBoundTextElement(
          getNodes().find((element) => element.id === nodeId)!,
          h.app.scene.getNonDeletedElementsMap(),
        );
      pointer.doubleClickAt(node.x + node.width / 2, node.y + node.height / 2);
      editor = await getTextEditor();
      expect(editor.value).toBe("");
      updateTextEditor(editor, "新内容");
      await blurEditor(editor);
      expect(getText()?.originalText).toBe("新内容");
      expect(getNodes().map((element) => element.id)).toEqual(nodeIds);

      Keyboard.undo();
      expect(getNodes().map((element) => element.id)).toEqual(nodeIds);
      expect(getText()).toBeNull();
      Keyboard.redo();
      expect(getText()?.originalText).toBe("新内容");
      expect(getEdges()).toHaveLength(kind === "root" ? 0 : 1);
    },
  );

  it("清空已提交节点时保留整张脑图，并支持撤销重做", async () => {
    UI.clickExtraTool("mindmap");
    const pointer = new Pointer("mouse");
    pointer.clickAt(300, 240);
    let editor = await getTextEditor();
    updateTextEditor(editor, "根节点");
    Keyboard.exitTextEditor(editor);
    Keyboard.keyPress("Tab");
    editor = await getTextEditor();
    updateTextEditor(editor, "子节点");
    Keyboard.exitTextEditor(editor);
    const nodeIds = getNodes().map((node) => node.id);
    const edgeIds = getEdges().map((edge) => edge.id);
    UI.clickExtraTool("mindmap");

    for (const nodeId of nodeIds) {
      const node = getNodes().find((element) => element.id === nodeId)!;
      const getText = () =>
        getBoundTextElement(
          getNodes().find((element) => element.id === nodeId)!,
          h.app.scene.getNonDeletedElementsMap(),
        );
      const originalText = getText()!.originalText;
      pointer.doubleClickAt(node.x + node.width / 2, node.y + node.height / 2);
      editor = await getTextEditor();
      expect(h.state.editingTextElement?.containerId).toBe(nodeId);
      expect(editor.value).toBe(originalText);
      updateTextEditor(editor, "");
      await blurEditor(editor);
      expect(getText()).toBeNull();
      expect(getNodes().map((element) => element.id)).toEqual(nodeIds);
      expect(getEdges().map((edge) => edge.id)).toEqual(edgeIds);

      Keyboard.undo();
      expect(getText()?.originalText).toBe(originalText);
      Keyboard.redo();
      expect(getText()).toBeNull();
      expect(getNodes().map((element) => element.id)).toEqual(nodeIds);
      expect(getEdges().map((edge) => edge.id)).toEqual(edgeIds);
    }
  });

  it("opens existing node text on double click and exposes the hover add control", async () => {
    UI.clickExtraTool("mindmap");
    const pointer = new Pointer("mouse");
    pointer.clickAt(260, 220);
    const editor = await getTextEditor();
    updateTextEditor(editor, "Product plan");
    Keyboard.exitTextEditor(editor);

    const root = h.app.scene
      .getNonDeletedElements()
      .find(isMindmapNodeElement)!;
    pointer.moveTo(root.x + root.width / 2, root.y + root.height / 2);
    expect(
      screen.getByRole("button", { name: "Add child node" }),
    ).toBeInTheDocument();

    pointer.doubleClickAt(root.x + root.width / 2, root.y + root.height / 2);
    expect(await getTextEditor()).toBeInTheDocument();
  });
});
