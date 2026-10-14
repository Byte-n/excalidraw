import {
  buildMindmapGraphFromTree,
  getBoundTextElement,
  getMindmapAddButtonAffordances,
  getMindmapLayoutConfig,
  getTransformHandles,
  isMindmapEdgeElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import { arrayToMap } from "@excalidraw/common";

import { queryByTestId } from "@testing-library/react";

import type { MindmapTreeSpec } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";
import { t } from "../i18n";

import { getTextEditor, updateTextEditor } from "./queries/dom";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { API } from "./helpers/api";
import { act, fireEvent, GlobalTestState, render, waitFor } from "./test-utils";

const { h } = window;

/**
 * 从文本树建一张已布局的脑图并落成场景元素，作为测试夹具。点击工具建的是
 * 固定形状的预设（10 节点），这里用同一个 builder 造**确定形状**的小图，
 * 让节点顺序稳定（根在 0，一级子节点在 1），断言不再依赖点击的产品细节。
 */
const fixture = (tree: MindmapTreeSpec): ExcalidrawElement[] =>
  restoreElements(
    buildMindmapGraphFromTree(tree, { x: 100, y: 200 }).elements,
    null,
    { repairBindings: true },
  );

/** 只含一个根节点的夹具（无子节点、无连线）。 */
const soloFixture = (text = "根节点") => fixture({ text, children: [] });

/** 根 + 一个一级子节点的夹具（2 节点、1 连线）。 */
const branchFixture = (root = "根节点", child = "原有节点") =>
  fixture({ text: root, children: [{ text: child, children: [] }] });

/** 每个测试自己渲染：有的要空场景（验证建图），有的要预设夹具。 */
const renderScene = async (elements?: ExcalidrawElement[]) => {
  localStorage.clear();
  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      initialData={elements ? { elements } : undefined}
    />,
  );
};

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
  const getBoundText = (node: ExcalidrawElement) =>
    getBoundTextElement(node, h.app.scene.getNonDeletedElementsMap());
  const blurEditor = async (editor: HTMLTextAreaElement) => {
    await waitFor(() => {
      expect(editor.onblur).toEqual(expect.any(Function));
      expect(editor.ownerDocument.activeElement).toBe(editor);
    });
    act(() => editor.blur());
    expect(h.state.editingTextElement).toBeNull();
    expect(editor).not.toBeInTheDocument();
  };
  // 「+」按钮是画布覆盖层（非 DOM）：按几何中心模拟指针点击
  const clickAddChildButton = (node: ReturnType<typeof getNodes>[number]) => {
    const hasChildren = getNodes().some(
      (element) => element.parentId === node.id,
    );
    const { child } = getMindmapAddButtonAffordances(
      node,
      getMindmapLayoutConfig(node).direction,
      hasChildren ? "minus" : null,
    );
    new Pointer("mouse").clickAt(child.center[0], child.center[1]);
  };

  it("点击建出整张预设导图：根左上角落在点击处，一次撤销移除整图", async () => {
    await renderScene();
    UI.clickTool("mindmap");
    new Pointer("mouse").clickAt(300, 240);

    // 建图后立刻进入根节点编辑，占位文字即预设根标签
    const editor = await getTextEditor();
    expect(editor.value).toBe(t("mindmapPreset.root"));

    const nodes = getNodes();
    const root = nodes.find((node) => node.role === "root")!;
    // 根节点左上角 = 点击点
    expect(root.x).toBe(300);
    expect(root.y).toBe(240);
    expect(nodes).toHaveLength(10);
    expect(getEdges()).toHaveLength(9);
    // 1 根 + 3 分支 + 6 叶子；每个分支恰好 2 个子主题
    expect(nodes.filter((node) => node.role === "node")).toHaveLength(9);
    const branches = nodes.filter((node) => node.parentId === root.id);
    expect(branches).toHaveLength(3);
    for (const branch of branches) {
      expect(nodes.filter((node) => node.parentId === branch.id)).toHaveLength(
        2,
      );
    }
    // 每个节点都有绑定文本，根标签用预设占位文字
    expect(
      h.app.scene
        .getNonDeletedElements()
        .filter((element) => element.type === "text"),
    ).toHaveLength(10);
    expect(getBoundText(root)?.originalText).toBe(t("mindmapPreset.root"));
    expect(root.boundElements).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );

    Keyboard.exitTextEditor(editor);
    // 一次点击 = 一整张图 = 一步历史
    Keyboard.undo();
    expect(getNodes()).toHaveLength(0);
    expect(getEdges()).toHaveLength(0);
    Keyboard.redo();
    expect(getNodes()).toHaveLength(10);
    expect(getEdges()).toHaveLength(9);
  });

  describe.each(["blur", "Escape"] as const)(
    "提交预设根节点为空（%s）",
    (submitWith) => {
      it.each([
        { name: "清空占位文字", values: [""] as string[] },
        { name: "输入后清空", values: ["临时内容", ""] },
        { name: "仅含空白", values: [" \n  "] },
      ])(
        "$name：保留整张导图与连线，并支持一步撤销重做",
        async ({ values }) => {
          await renderScene();
          UI.clickTool("mindmap");
          new Pointer("mouse").clickAt(300, 240);
          const editor = await getTextEditor();
          const textElement = h.state.editingTextElement!;
          const rootId = textElement.containerId!;
          const nodeIds = getNodes().map((node) => node.id);
          const edgeIds = getEdges().map((edge) => edge.id);
          const historyLength = API.getUndoStack().length;

          for (const value of values) {
            updateTextEditor(editor, value);
          }
          if (submitWith === "blur") {
            await blurEditor(editor);
          } else {
            Keyboard.exitTextEditor(editor);
          }

          // 节点与连线都保留，只丢弃清空的标签文字
          expect(getNodes().map((node) => node.id)).toEqual(nodeIds);
          expect(getEdges().map((edge) => edge.id)).toEqual(edgeIds);
          expect(h.app.scene.getElement(textElement.id)?.isDeleted).toBe(true);
          expect(
            getBoundText(getNodes().find((node) => node.id === rootId)!),
          ).toBeNull();
          expect(API.getUndoStack()).toHaveLength(historyLength + 1);

          // 撤销恢复占位标签；整张图与连线仍在
          Keyboard.undo();
          expect(
            getBoundText(getNodes().find((node) => node.id === rootId)!)
              ?.originalText,
          ).toBe(t("mindmapPreset.root"));
          expect(getNodes().map((node) => node.id)).toEqual(nodeIds);
          expect(getEdges().map((edge) => edge.id)).toEqual(edgeIds);
          Keyboard.redo();
          expect(
            getBoundText(getNodes().find((node) => node.id === rootId)!),
          ).toBeNull();
        },
      );
    },
  );

  describe.each(["Tab", "Enter", "button"] as const)(
    "%s 创建的空子节点",
    (createWith) => {
      describe.each(["blur", "Escape"] as const)("%s 提交", (submitWith) => {
        it.each([
          { name: "始终为空", values: [] as string[] },
          { name: "输入后清空", values: ["临时内容", ""] },
          { name: "仅含空白", values: [" \n  "] },
        ])(
          "$name：保留节点和连接线，并支持单步撤销重做",
          async ({ values }) => {
            await renderScene(soloFixture());
            UI.clickTool("mindmap");
            const root = getNodes()[0];
            API.setSelectedElements([root]);
            const historyLength = API.getUndoStack().length;

            if (createWith === "button") {
              // 「+」按钮只在选中时出现
              clickAddChildButton(root);
            } else {
              Keyboard.keyPress(createWith);
            }
            const editor = await getTextEditor();
            expect(editor.value).toBe("");
            const textElement = h.state.editingTextElement!;
            const nodeId = textElement.containerId!;
            expect(nodeId).toBe(getNodes()[1].id);
            const nodeIds = getNodes().map((node) => node.id);
            const edges = getEdges().map(({ id, parentId, childId }) => ({
              id,
              parentId,
              childId,
            }));
            expect(nodeIds).toHaveLength(2);
            expect(edges).toHaveLength(1);

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

  describe("布局与创建历史", () => {
    // 夹具：一个根节点，再用界面「Tab」长出原有子节点（与旧流程同形：
    // getNodes()[0] 是根、[1] 是子节点，之后都用确定性操作而非点击建图）。
    // 保持默认的 selection 工具：节点建/删/改与折叠都走全局脑图键盘语义，
    // 而手动 resize 需要 selection 工具（mindmap 工具会把角手柄拖拽当成节点拖拽）。
    beforeEach(async () => {
      await renderScene(soloFixture());
      API.setSelectedElements([getNodes()[0]]);
      Keyboard.keyPress("Tab");
      const editor = await getTextEditor();
      updateTextEditor(editor, "原有节点");
      Keyboard.exitTextEditor(editor);
      API.setSelectedElements([getNodes()[1]]);
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
                UI.clickTool("mindmap");
                // 「+」按钮只在选中时出现
                API.setSelectedElements([root]);
                clickAddChildButton(root);
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
      const text = getBoundText(child)!;
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
      UI.clickTool("mindmap");
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
      const text = getBoundText(child)!;
      const unchanged = [child, text, ...getEdges()].map((element) => ({
        element,
        version: element.version,
      }));
      const before = getSceneSnapshot();
      UI.clickTool("mindmap");
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

    it("手动 resize 节点后重排布局：兄弟让位，与 resize 并入同一条历史", async () => {
      const [, child] = getNodes();
      API.setSelectedElements([child]);
      Keyboard.keyPress("Enter");
      const editor = await getTextEditor();
      updateTextEditor(editor, "兄弟节点");
      Keyboard.exitTextEditor(editor);

      const siblingBefore = getNodes()[2];
      const before = getSceneSnapshot();
      const historyLength = API.getUndoStack().length;

      UI.resize(h.app.scene.getNonDeletedElement(child.id)!, "se", [0, 80]);

      const resized = h.app.scene.getNonDeletedElement(child.id)!;
      expect(resized.height).toBeGreaterThan(child.height);
      const siblingAfter = h.app.scene.getNonDeletedElement(siblingBefore.id)!;
      expect(siblingAfter.y).not.toBe(siblingBefore.y);
      expect(API.getUndoStack()).toHaveLength(historyLength + 1);
      Keyboard.undo();
      expect(getSceneSnapshot()).toEqual(before);
      Keyboard.redo();
      expect(resized.height).toBe(
        h.app.scene.getNonDeletedElement(child.id)!.height,
      );
    });

    it("Stats 输入节点尺寸后重排布局：兄弟让位，与输入并入同一条历史", async () => {
      const [, child] = getNodes();
      API.setSelectedElements([child]);
      Keyboard.keyPress("Enter");
      const editor = await getTextEditor();
      updateTextEditor(editor, "兄弟节点");
      Keyboard.exitTextEditor(editor);

      const siblingBefore = getNodes()[2];
      const historyLength = API.getUndoStack().length;

      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 1,
        clientY: 1,
      });
      UI.openContextMenuSubmenus();
      fireEvent.click(
        queryByTestId(UI.queryContextMenu()!, "stats")! as HTMLElement,
      );

      API.setSelectedElements([h.app.scene.getNonDeletedElement(child.id)!]);
      const input = UI.queryStatsProperty("H")?.querySelector(
        ".drag-input",
      ) as HTMLInputElement;
      expect(input).toBeDefined();
      UI.updateInput(input, String(child.height + 80));

      expect(
        h.app.scene.getNonDeletedElement(child.id)!.height,
      ).toBeGreaterThan(child.height);
      expect(h.app.scene.getNonDeletedElement(siblingBefore.id)!.y).not.toBe(
        siblingBefore.y,
      );
      expect(API.getUndoStack()).toHaveLength(historyLength + 1);
    });

    it("resize 拖拽中实时重排：兄弟实时让位，被拖节点对位稳定", async () => {
      const [, child] = getNodes();
      API.setSelectedElements([child]);
      Keyboard.keyPress("Enter");
      const editor = await getTextEditor();
      updateTextEditor(editor, "兄弟节点");
      Keyboard.exitTextEditor(editor);

      const siblingBefore = getNodes()[2];
      const siblingBeforeY = siblingBefore.y;
      const resized = h.app.scene.getNonDeletedElement(child.id)!;
      // mutateElement 原地改元素，断言前先把基准几何拷贝为值
      const beforeGeom = {
        x: resized.x,
        y: resized.y,
        height: resized.height,
      };
      const historyLength = API.getUndoStack().length;

      API.setSelectedElements([resized]);
      const handleCoords = getTransformHandles(
        resized,
        h.state.zoom,
        arrayToMap(h.elements),
        "mouse",
        {},
      ).se!;
      const mouse = new Pointer("mouse");
      mouse.reset();
      mouse.down(
        handleCoords[0] + handleCoords[2] / 2,
        handleCoords[1] + handleCoords[3] / 2,
      );
      mouse.move(0, 80);

      // 拖拽过程中：尺寸已变、兄弟已实时让位
      const during = h.app.scene.getNonDeletedElement(child.id)!;
      expect(during.height).toBeGreaterThan(beforeGeom.height);
      expect(h.app.scene.getNonDeletedElement(siblingBefore.id)!.y).not.toBe(
        siblingBeforeY,
      );
      // 被拖节点锚定：se 拖拽保持左上对位在画板中不动
      expect(during.x).toBe(beforeGeom.x);
      expect(during.y).toBe(beforeGeom.y);

      mouse.up();

      // 释放后布局完全接管，与 resize 并入同一条历史
      expect(API.getUndoStack()).toHaveLength(historyLength + 1);
      expect(h.app.scene.getNonDeletedElement(siblingBefore.id)!.y).not.toBe(
        siblingBeforeY,
      );
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

  it.each(["root", "child"] as const)(
    "已置空的 %s 节点可以重新编辑并撤销文字修改",
    async (kind) => {
      await renderScene(soloFixture());
      UI.clickTool("mindmap");
      const pointer = new Pointer("mouse");
      // root：把夹具根节点的文字清空；child：用 Tab 长出一个空子节点
      if (kind === "root") {
        const root = getNodes()[0];
        API.setSelectedElements([root]);
        pointer.doubleClickAt(
          root.x + root.width / 2,
          root.y + root.height / 2,
        );
        const editor = await getTextEditor();
        updateTextEditor(editor, "");
        await blurEditor(editor);
      } else {
        API.setSelectedElements([getNodes()[0]]);
        Keyboard.keyPress("Tab");
        const editor = await getTextEditor();
        Keyboard.exitTextEditor(editor);
      }

      const nodeId = getNodes()[kind === "root" ? 0 : 1].id;
      API.setSelectedElements([h.app.scene.getNonDeletedElement(nodeId)!]);
      const node = () => getNodes().find((element) => element.id === nodeId)!;
      const nodeIds = getNodes().map((element) => element.id);
      pointer.doubleClickAt(
        node().x + node().width / 2,
        node().y + node().height / 2,
      );
      const editor = await getTextEditor();
      expect(editor.value).toBe("");
      updateTextEditor(editor, "新内容");
      await blurEditor(editor);
      expect(getBoundText(node())?.originalText).toBe("新内容");
      expect(getNodes().map((element) => element.id)).toEqual(nodeIds);

      Keyboard.undo();
      expect(getNodes().map((element) => element.id)).toEqual(nodeIds);
      expect(getBoundText(node())).toBeNull();
      Keyboard.redo();
      expect(getBoundText(node())?.originalText).toBe("新内容");
      expect(getEdges()).toHaveLength(kind === "root" ? 0 : 1);
    },
  );

  it("清空已提交节点时保留整张脑图，并支持撤销重做", async () => {
    await renderScene(branchFixture());
    UI.clickTool("mindmap");
    const pointer = new Pointer("mouse");
    const nodeIds = getNodes().map((node) => node.id);
    const edgeIds = getEdges().map((edge) => edge.id);

    for (const nodeId of nodeIds) {
      const node = () => getNodes().find((element) => element.id === nodeId)!;
      const originalText = getBoundText(node())!.originalText;
      pointer.doubleClickAt(
        node().x + node().width / 2,
        node().y + node().height / 2,
      );
      const editor = await getTextEditor();
      expect(h.state.editingTextElement?.containerId).toBe(nodeId);
      expect(editor.value).toBe(originalText);
      updateTextEditor(editor, "");
      await blurEditor(editor);
      expect(getBoundText(node())).toBeNull();
      expect(getNodes().map((element) => element.id)).toEqual(nodeIds);
      expect(getEdges().map((edge) => edge.id)).toEqual(edgeIds);

      Keyboard.undo();
      expect(getBoundText(node())?.originalText).toBe(originalText);
      Keyboard.redo();
      expect(getBoundText(node())).toBeNull();
      expect(getNodes().map((element) => element.id)).toEqual(nodeIds);
      expect(getEdges().map((edge) => edge.id)).toEqual(edgeIds);
    }
  });

  it("opens existing node text on double click and exposes the selected add control", async () => {
    await renderScene(soloFixture("Product plan"));
    UI.clickTool("mindmap");
    const pointer = new Pointer("mouse");

    const root = getNodes()[0];
    // 「+」按钮只在选中时出现（画布覆盖层，非 DOM），悬停不显示
    API.setSelectedElements([]);
    pointer.moveTo(root.x + root.width / 2, root.y + root.height / 2);
    expect(h.app.mindmap.getAddButtonTargetNode()).toBeNull();
    API.setSelectedElements([root]);
    expect(h.app.mindmap.getAddButtonTargetNode()?.id).toBe(root.id);
    // 命中测试与渲染共用同一几何
    const { child, sibling } = getMindmapAddButtonAffordances(
      root,
      getMindmapLayoutConfig(root).direction,
      null,
    );
    expect(
      h.app.mindmap.hitTestAddButton(child.center[0], child.center[1]),
    ).toBe("child");
    // 根节点没有同级按钮
    expect(
      h.app.mindmap.hitTestAddButton(sibling.center[0], sibling.center[1]),
    ).toBeNull();

    pointer.doubleClickAt(root.x + root.width / 2, root.y + root.height / 2);
    expect(await getTextEditor()).toBeInTheDocument();
  });
});
