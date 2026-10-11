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
  // 比较完整场景，排除撤销重做本身会更新的版本和时间戳。
  const getSceneSnapshot = () =>
    JSON.parse(
      JSON.stringify(h.app.scene.getNonDeletedElements(), (key, value) =>
        ["version", "versionNonce", "updated"].includes(key)
          ? undefined
          : value,
      ),
    );
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
    expect(getEdges()).toHaveLength(0);
    Keyboard.redo();
    expect(
      h.app.scene.getNonDeletedElements().filter(isMindmapNodeElement),
    ).toHaveLength(2);
    expect(getEdges()).toEqual(
      edges.map(({ id, parentId, childId }) =>
        expect.objectContaining({ id, parentId, childId }),
      ),
    );
  });

  describe("布局与创建历史", () => {
    beforeEach(async () => {
      UI.clickExtraTool("mindmap");
      new Pointer("mouse").clickAt(300, 240);
      let editor = await getTextEditor();
      updateTextEditor(editor, "根节点");
      Keyboard.exitTextEditor(editor);
      Keyboard.keyPress("Tab");
      editor = await getTextEditor();
      updateTextEditor(editor, "原有节点");
      Keyboard.exitTextEditor(editor);
    });

    describe.each(["Tab", "Enter", "button"] as const)(
      "%s 继续创建节点",
      (createWith) => {
        describe.each(["blur", "Escape"] as const)("%s 提交", (submitWith) => {
          it.each(["", "新增节点\n第二行\n第三行"])(
            "文字为 %j 时，单步撤销重做恢复节点、连线和原有布局",
            async (value) => {
              const [root, child] = getNodes();
              const before = getSceneSnapshot();
              const historyLength = API.getUndoStack().length;
              if (createWith === "button") {
                const pointer = new Pointer("mouse");
                UI.clickExtraTool("mindmap");
                pointer.moveTo(
                  root.x + root.width / 2,
                  root.y + root.height / 2,
                );
                fireEvent.click(
                  screen.getByRole("button", { name: "Add child node" }),
                );
              } else {
                // 在非根节点上按 Enter，确保覆盖真正的兄弟节点创建。
                API.setSelectedElements([child]);
                Keyboard.keyPress(createWith);
              }
              const editor = await getTextEditor();
              const nodeId = h.state.editingTextElement!.containerId!;
              updateTextEditor(editor, value);
              if (submitWith === "blur") {
                await blurEditor(editor);
              } else {
                Keyboard.exitTextEditor(editor);
              }

              expect(getNodes()).toHaveLength(3);
              expect(getEdges()).toHaveLength(2);
              expect(
                getNodes().find((node) => node.id === nodeId)?.parentId,
              ).toBe(createWith === "Tab" ? child.id : root.id);
              expect(API.getUndoStack()).toHaveLength(historyLength + 1);
              const after = getSceneSnapshot();
              for (let i = 0; i < 3; i++) {
                Keyboard.undo();
                expect(getSceneSnapshot()).toEqual(before);
                expect(API.getUndoStack()).toHaveLength(historyLength);
                Keyboard.redo();
                expect(getSceneSnapshot()).toEqual(after);
                expect(API.getUndoStack()).toHaveLength(historyLength + 1);
              }
            },
          );
        });
      },
    );

    it("布局移动已有节点、文字和连线时递增版本，不改变未移动元素", async () => {
      const [root, child] = getNodes();
      const text = getBoundTextElement(
        child,
        h.app.scene.getNonDeletedElementsMap(),
      )!;
      const edge = getEdges()[0];
      const moved = [child, text, edge].map(({ id, version, y }) => ({
        id,
        version,
        y,
      }));
      const rootVersion = root.version;
      Keyboard.keyPress("Enter");
      const editor = await getTextEditor();
      updateTextEditor(editor, "兄弟节点");
      Keyboard.exitTextEditor(editor);

      for (const previous of moved) {
        const next = h.app.scene.getNonDeletedElement(previous.id)!;
        expect(next.y).not.toBe(previous.y);
        expect(next.version).toBeGreaterThan(previous.version);
      }
      expect(h.app.scene.getNonDeletedElement(root.id)?.version).toBe(
        rootVersion,
      );
    });

    it("修改节点文字引发重排时，撤销重做恢复整张脑图的几何信息", async () => {
      Keyboard.keyPress("Enter");
      let editor = await getTextEditor();
      updateTextEditor(editor, "兄弟节点");
      Keyboard.exitTextEditor(editor);
      const before = getSceneSnapshot();
      const historyLength = API.getUndoStack().length;
      const child = getNodes()[1];
      const previousHeight = child.height;
      const sibling = getNodes()[2];
      const previousSiblingY = sibling.y;
      UI.clickExtraTool("mindmap");
      new Pointer("mouse").doubleClickAt(
        child.x + child.width / 2,
        child.y + child.height / 2,
      );
      editor = await getTextEditor();
      updateTextEditor(editor, "第一行\n第二行\n第三行\n第四行");
      await blurEditor(editor);

      expect(
        h.app.scene.getNonDeletedElement(child.id)!.height,
      ).toBeGreaterThan(previousHeight);
      expect(h.app.scene.getNonDeletedElement(sibling.id)!.y).not.toBe(
        previousSiblingY,
      );
      expect(API.getUndoStack()).toHaveLength(historyLength + 1);
      const after = getSceneSnapshot();
      Keyboard.undo();
      expect(getSceneSnapshot()).toEqual(before);
      Keyboard.redo();
      expect(getSceneSnapshot()).toEqual(after);
    });

    it("重复提交相同布局不改变已有连线和其他节点的版本或引用", async () => {
      const [root, child] = getNodes();
      const text = getBoundTextElement(
        child,
        h.app.scene.getNonDeletedElementsMap(),
      )!;
      const unchanged = [child, text, ...getEdges()].map((element) => ({
        element,
        version: element.version,
      }));
      const before = getSceneSnapshot();
      UI.clickExtraTool("mindmap");
      new Pointer("mouse").doubleClickAt(
        root.x + root.width / 2,
        root.y + root.height / 2,
      );
      const editor = await getTextEditor();
      Keyboard.exitTextEditor(editor);

      expect(getSceneSnapshot()).toEqual(before);
      for (const { element, version } of unchanged) {
        const next = h.app.scene.getNonDeletedElement(element.id)!;
        expect(next.version).toBe(version);
        expect(next).toBe(element);
      }
    });

    it("撤销后分叉创建不会恢复旧连线，连续撤销重做保持布局", async () => {
      const before = getSceneSnapshot();
      const historyLength = API.getUndoStack().length;
      Keyboard.keyPress("Enter");
      let editor = await getTextEditor();
      updateTextEditor(editor, "被撤销的节点");
      Keyboard.exitTextEditor(editor);
      const removedNodeId = getNodes()[2].id;
      const removedEdgeId = getEdges().find(
        (edge) => edge.childId === removedNodeId,
      )!.id;
      Keyboard.undo();
      expect(getSceneSnapshot()).toEqual(before);

      API.setSelectedElements([getNodes()[1]]);
      Keyboard.keyPress("Enter");
      editor = await getTextEditor();
      updateTextEditor(editor, "新分支");
      Keyboard.exitTextEditor(editor);
      expect(getEdges().some((edge) => edge.id === removedEdgeId)).toBe(false);
      expect(getNodes().some((node) => node.id === removedNodeId)).toBe(false);
      const branch = getSceneSnapshot();
      Keyboard.redo();
      expect(getSceneSnapshot()).toEqual(branch);
      expect(API.getUndoStack()).toHaveLength(historyLength + 1);

      Keyboard.undo();
      expect(getSceneSnapshot()).toEqual(before);
      Keyboard.undo();
      expect(getNodes()).toHaveLength(1);
      expect(getEdges()).toHaveLength(0);
      Keyboard.redo();
      expect(getSceneSnapshot()).toEqual(before);
      Keyboard.redo();
      expect(getSceneSnapshot()).toEqual(branch);
    });
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
