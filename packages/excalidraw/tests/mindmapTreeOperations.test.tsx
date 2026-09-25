import {
  buildMindmapGraphIndex,
  getMindmapHiddenElementIds,
  getBoundTextElement,
  isMindmapNodeElement,
  newMindmapNodeElement,
  newTextElement,
  newElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";
import { serializeAsJSON } from "../data/json";
import { actionDeleteSelected } from "../actions/actionDeleteSelected";

import { getTextEditor, updateTextEditor } from "./queries/dom";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;
const fixture = () => {
  const entries = [
    ["root", null, "产品规划"],
    ["a", "root", "调研"],
    ["b", "root", "方案"],
    ["c", "root", "上线"],
    ["a1", "a", "用户访谈"],
    ["a2", "a", "竞品分析"],
    ["b1", "b", "原型设计"],
    ["foreign", null, "独立根节点"],
  ] as const;
  const elements: ExcalidrawElement[] = [];
  entries.forEach(([id, parentId, label], i) => {
    const node = {
      ...newMindmapNodeElement({
        x: 100,
        y: id === "foreign" ? 800 : 300,
        graphId: id === "foreign" ? "foreign" : "graph",
        ...(parentId
          ? {
              role: "node" as const,
              parentId,
              order: `a${i}` as FractionalIndex,
            }
          : { role: "root" as const, parentId: null, order: null }),
      }),
      id,
    };
    const text = {
      ...newTextElement({
        x: 0,
        y: 0,
        text: label,
        containerId: id,
        textAlign: "center",
        verticalAlign: "middle",
      }),
      id: `${id}-text`,
    };
    elements.push(
      { ...node, boundElements: [{ type: "text", id: text.id }] },
      text,
    );
  });
  elements.push({
    ...newElement({
      type: "rectangle",
      x: 800,
      y: 100,
      width: 100,
      height: 80,
      customData: { host: "untouched" },
    }),
    id: "rectangle",
  });
  return restoreElements(elements, null, { repairBindings: true });
};
const node = (id: string) =>
  h.app.scene.getNonDeletedElement(id) as ExcalidrawMindmapNodeElement & {
    isDeleted: false;
  };
const select = (id: string) => API.setSelectedElements([node(id)]);
const index = (graphId = "graph") =>
  buildMindmapGraphIndex(h.app.scene.getNonDeletedElements(), graphId);
const snapshot = () =>
  JSON.parse(
    JSON.stringify(h.app.scene.getNonDeletedElements(), (key, value) =>
      ["version", "versionNonce", "updated"].includes(key) ? undefined : value,
    ),
  );
const pressShift = (key: string) =>
  Keyboard.withModifierKeys({ shift: true }, () => Keyboard.keyPress(key));
const expectAtomic = (before: unknown, historyLength: number) => {
  const after = snapshot();
  expect(API.getUndoStack()).toHaveLength(historyLength + 1);
  for (let i = 0; i < 2; i++) {
    Keyboard.undo();
    expect(snapshot()).toEqual(before);
    Keyboard.redo();
    expect(snapshot()).toEqual(after);
  }
};
const openMenu = (id: string) => {
  const target = node(id);
  act(() =>
    h.app.openContextMenu({
      clientX: target.x + target.width / 2,
      clientY: target.y + target.height / 2,
    }),
  );
};

describe("Mindmap P02 树操作界面", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(
      <Excalidraw
        handleKeyboardGlobally
        initialData={{ elements: fixture() }}
      />,
    );
  });

  it("方向键只切换本图节点，坐标、版本和历史不变", () => {
    select("a");
    const before = h.app.scene.getElementsIncludingDeleted();
    const count = API.getUndoStack().length;
    for (const [key, id] of [
      ["ArrowUp", "a"],
      ["ArrowDown", "b"],
      ["ArrowDown", "c"],
      ["ArrowDown", "c"],
      ["ArrowLeft", "root"],
      ["ArrowLeft", "root"],
      ["ArrowRight", "a"],
      ["ArrowRight", "a1"],
      ["ArrowRight", "a1"],
      ["ArrowDown", "a2"],
      ["ArrowUp", "a1"],
    ]) {
      Keyboard.keyPress(key);
      expect(h.state.selectedElementIds).toEqual({ [id]: true });
    }
    expect(h.app.scene.getElementsIncludingDeleted()).toEqual(before);
    expect(API.getUndoStack()).toHaveLength(count);
  });

  it("Space 折叠和展开，松键保留选中；叶子及重复按键无历史", () => {
    UI.clickExtraTool("mindmap");
    select("a");
    const before = snapshot();
    const count = API.getUndoStack().length;
    Keyboard.keyPress(" ");
    expect(node("a").collapsed).toBe(true);
    expect(h.state.selectedElementIds).toEqual({ a: true });
    Keyboard.keyPress("ArrowRight");
    expect(h.state.selectedElementIds).toEqual({ a: true });
    expect(
      getMindmapHiddenElementIds(h.app.scene.getNonDeletedElements()).has(
        "a1-text",
      ),
    ).toBe(true);
    fireEvent.keyDown(h.app.ownerDocument, { key: " ", repeat: true });
    expect(node("a").collapsed).toBe(true);
    expectAtomic(before, count);
    Keyboard.keyPress(" ");
    expect(node("a").collapsed).toBe(false);
    select("a1");
    const leafCount = API.getUndoStack().length;
    Keyboard.keyPress(" ");
    expect(API.getUndoStack()).toHaveLength(leafCount);
  });

  it("折叠控制点清除隐藏选中和悬停，隐藏后代不可命中", () => {
    select("a1");
    const hidden = { ...node("a1") };
    const parent = node("a");
    new Pointer("mouse").moveTo(parent.x + 20, parent.y + 20);
    fireEvent.click(screen.getByRole("button", { name: "Collapse branch" }));
    expect(node("a").collapsed).toBe(true);
    expect(h.state.selectedElementIds).toEqual({ a: true });
    expect(h.state.hoveredElementIds).toEqual({});
    expect(
      h.app.getElementAtPosition(hidden.x + 20, hidden.y + 20)?.id,
    ).not.toBe("a1");
    fireEvent.click(screen.getByRole("button", { name: "Expand branch" }));
    expect(
      getMindmapHiddenElementIds(h.app.scene.getNonDeletedElements()).size,
    ).toBe(0);
  });

  it.each(["Delete", "Backspace"])(
    "%s 删除叶子、文本和入边并原子撤销",
    (key) => {
      select("a1");
      const before = snapshot();
      const count = API.getUndoStack().length;
      Keyboard.keyPress(key);
      expect(node("a1")).toBeNull();
      expect(h.app.scene.getNonDeletedElement("a1-text")).toBeNull();
      expect(index().edgeByChildId.has("a1")).toBe(false);
      expect(h.state.selectedElementIds).toEqual({ a2: true });
      expectAtomic(before, count);
    },
  );

  it.each([false, true])(
    "默认删除完整子树，折叠状态 %s，不弹框且不影响其他图形",
    (collapsed) => {
      select("a");
      if (collapsed) {
        Keyboard.keyPress(" ");
      }
      const before = snapshot();
      const count = API.getUndoStack().length;
      const rectangle = node("rectangle");
      const foreign = node("foreign");
      Keyboard.keyPress("Delete");
      expect(h.state.openDialog).toBeNull();
      expect(index().childrenById.get("root")).toEqual(["b", "c"]);
      for (const id of ["a", "a1", "a2", "a-text", "a1-text", "a2-text"]) {
        expect(h.app.scene.getNonDeletedElement(id)).toBeNull();
      }
      expect(node("rectangle")).toBe(rectangle);
      expect(node("foreign")).toBe(foreign);
      expectAtomic(before, count);
    },
  );

  describe.each(["root", "a"])("Shift 删除 %s 的多子分支弹窗", (id) => {
    it.each(["cancel", "Escape"])("%s 不改变场景与历史", (cancel) => {
      select(id);
      const before = snapshot();
      const count = API.getUndoStack().length;
      pressShift("Delete");
      const dialog = screen
        .getByText(
          id === "root" ? "Delete mindmap root" : "Delete mindmap node",
        )
        .closest('[role="dialog"]')!;
      expect(dialog).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name:
            id === "root"
              ? "Keep branches and replace root"
              : "Use selected replacement",
        }),
      ).toBeDisabled();
      expect(snapshot()).toEqual(before);
      expect(API.getUndoStack()).toHaveLength(count);
      if (cancel === "cancel") {
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      } else {
        fireEvent.keyDown(dialog, { key: "Escape" });
      }
      expect(h.state.openDialog).toBeNull();
      expect(snapshot()).toEqual(before);
      expect(API.getUndoStack()).toHaveLength(count);
    });
  });

  it("Shift 删除根节点指定新根，普通 Delete 则无弹窗删除整图", () => {
    select("root");
    const before = snapshot();
    const count = API.getUndoStack().length;
    pressShift("Delete");
    expect(
      screen.queryByRole("button", { name: "Promote children in order" }),
    ).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "New root" }), {
      target: { value: "b" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Keep branches and replace root" }),
    );
    expect(index().rootId).toBe("b");
    expect(index().childrenById.get("b")).toEqual(["b1", "a", "c"]);
    expect(index().childrenById.get("a")).toEqual(["a1", "a2"]);
    expectAtomic(before, count);
    Keyboard.undo();
    select("root");
    Keyboard.keyPress("Delete");
    expect(h.state.openDialog).toBeNull();
    expect(
      h.app.scene
        .getNonDeletedElements()
        .filter(isMindmapNodeElement)
        .map((element) => element.id),
    ).toEqual(["foreign"]);
    expect(h.state.selectedElementIds).toEqual({});
    expectAtomic(before, count);
  });

  it("单击根节点选中整图后，Delete 删除整图并可一次撤销", () => {
    const mouse = new Pointer("mouse");
    mouse.clickAt(node("root").x + 20, node("root").y + 20);
    expect(h.app.mindmap.getSelectedGraphRoot()?.id).toBe("root");
    const before = snapshot();
    const count = API.getUndoStack().length;

    Keyboard.keyPress("Delete");

    expect(
      h.app.scene
        .getNonDeletedElements()
        .some(
          (element) =>
            isMindmapNodeElement(element) && element.graphId === "graph",
        ),
    ).toBe(false);
    expect(node("foreign")).not.toBeNull();
    expect(node("rectangle")).not.toBeNull();
    expect(h.state.toast).toBeNull();
    expectAtomic(before, count);
  });

  it("圈选折叠的整图后，Backspace 删除隐藏后代", () => {
    API.updateElement(node("a"), { collapsed: true });
    const hiddenIds = getMindmapHiddenElementIds(
      h.app.scene.getNonDeletedElements(),
    );
    const graphElements = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          element.id !== "rectangle" &&
          element.id !== "foreign" &&
          element.id !== "foreign-text" &&
          !hiddenIds.has(element.id),
      );
    const mouse = new Pointer("mouse");
    mouse.downAt(50, 50);
    mouse.moveTo(60, 60);
    mouse.moveTo(
      Math.max(...graphElements.map((element) => element.x + element.width)) +
        30,
      Math.max(...graphElements.map((element) => element.y + element.height)) +
        30,
    );
    mouse.upAt();
    expect(h.state.selectedElementIds.a1).toBe(true);
    expect(h.app.mindmap.getSelectedGraphRoot()?.id).toBe("root");
    const before = snapshot();
    const count = API.getUndoStack().length;

    Keyboard.keyPress("Backspace");

    expect(h.app.scene.getNonDeletedElement("root")).toBeNull();
    expect(h.app.scene.getNonDeletedElement("a1-text")).toBeNull();
    expectAtomic(before, count);
  });

  it("完整的多图与普通图形混选后，一次删除并撤销", () => {
    API.setSelectedElements([...h.app.scene.getNonDeletedElements()]);
    expect(h.app.mindmap.isCompleteMindmapSelection()).toBe(true);
    const before = snapshot();
    const count = API.getUndoStack().length;

    act(() => h.app.actionManager.executeAction(actionDeleteSelected));

    expect(h.app.scene.getNonDeletedElements()).toHaveLength(0);
    expect(h.state.toast).toBeNull();
    expectAtomic(before, count);
  });

  it("圈选整图和普通图形时保留选区外的思维导图", () => {
    const mouse = new Pointer("mouse");
    mouse.downAt(50, 50);
    mouse.moveTo(60, 60);
    mouse.moveTo(930, 500);
    mouse.upAt();
    expect(h.state.selectedElementIds.root).toBe(true);
    expect(h.state.selectedElementIds.rectangle).toBe(true);
    expect(h.state.selectedElementIds.foreign).toBeUndefined();
    const before = snapshot();
    const count = API.getUndoStack().length;

    Keyboard.keyPress("Delete");

    expect(h.app.scene.getNonDeletedElement("root")).toBeNull();
    expect(h.app.scene.getNonDeletedElement("rectangle")).toBeNull();
    expect(node("foreign")).not.toBeNull();
    expectAtomic(before, count);
  });

  it("整图混选含锁定节点时不删除任何元素", () => {
    API.updateElement(node("a"), { locked: true });
    API.setSelectedElements([...h.app.scene.getNonDeletedElements()]);
    const before = snapshot();
    const count = API.getUndoStack().length;

    Keyboard.keyPress("Delete");

    expect(snapshot()).toEqual(before);
    expect(API.getUndoStack()).toHaveLength(count);
  });

  it.each(["root", "a"])(
    "Shift 删除仅有一个直属子节点的 %s 自动接替，保留深层后代",
    (id) => {
      for (const removed of ["b", "c", ...(id === "a" ? ["a2"] : [])]) {
        select(removed);
        Keyboard.keyPress("Delete");
      }
      select(id);
      Keyboard.keyPress(" ");
      const before = snapshot();
      const count = API.getUndoStack().length;
      const originalOrder = node(id).order;
      pressShift("Backspace");
      expect(h.state.openDialog).toBeNull();
      const replacement = id === "root" ? "a" : "a1";
      expect(node(replacement)).toMatchObject({
        role: id === "root" ? "root" : "node",
        parentId: id === "root" ? null : "root",
        order: originalOrder,
        graphId: "graph",
      });
      if (id === "root") {
        expect(index().childrenById.get("a")).toEqual(["a1", "a2"]);
      }
      expect(h.state.selectedElementIds).toEqual({ [replacement]: true });
      expectAtomic(before, count);
    },
  );

  it.each(["foreign", "a1"])("Shift 删除无子节点的 %s 不弹窗", (id) => {
    select(id);
    const before = snapshot();
    const count = API.getUndoStack().length;
    pressShift("Delete");
    expect(h.state.openDialog).toBeNull();
    expect(node(id)).toBeNull();
    expect(h.app.scene.getNonDeletedElement(`${id}-text`)).toBeNull();
    expectAtomic(before, count);
  });

  it.each(["promote", "replace"])(
    "Shift 删除折叠普通节点选择 %s，保留后代并原子撤销",
    (choice) => {
      select("a");
      Keyboard.keyPress(" ");
      const before = snapshot();
      const count = API.getUndoStack().length;
      const originalOrder = node("a").order;
      pressShift("Backspace");
      if (choice === "promote") {
        fireEvent.click(
          screen.getByRole("button", { name: "Promote children in order" }),
        );
        expect(index().childrenById.get("root")).toEqual([
          "a1",
          "a2",
          "b",
          "c",
        ]);
      } else {
        fireEvent.change(
          screen.getByRole("combobox", { name: "Replacement node" }),
          { target: { value: "a1" } },
        );
        fireEvent.click(
          screen.getByRole("button", { name: "Use selected replacement" }),
        );
        expect(index().childrenById.get("root")).toEqual(["a1", "b", "c"]);
        expect(node("a1")).toMatchObject({
          role: "node",
          parentId: "root",
          graphId: "graph",
          order: originalOrder,
        });
        expect(index().childrenById.get("a1")).toEqual(["a2"]);
        expect(index().rootId).toBe("root");
      }
      expect(node("a")).toBeNull();
      expect(index().nodes.size).toBe(6);
      for (const id of ["a1", "a2"]) {
        expect(
          getBoundTextElement(node(id), h.app.scene.getNonDeletedElementsMap()),
        ).not.toBeNull();
      }
      const saved = JSON.parse(
        serializeAsJSON(
          h.app.scene.getNonDeletedElements(),
          h.state,
          {},
          "local",
        ),
      );
      const reopened = restoreElements(saved.elements, null, {
        repairBindings: true,
      });
      const restoredIndex = buildMindmapGraphIndex(reopened, "graph");
      expect(restoredIndex.rootId).toBe("root");
      expect(restoredIndex.parentById).toEqual(index().parentById);
      expect(restoredIndex.edgeByChildId.size).toBe(5);
      expectAtomic(before, count);
    },
  );

  it("提升后拆成新图，两次命令各有一条历史，保存后保持绑定", () => {
    select("a1");
    const before = snapshot();
    const count = API.getUndoStack().length;
    pressShift("Tab");
    expect(index().childrenById.get("root")).toEqual(["a", "a1", "b", "c"]);
    expectAtomic(before, count);
    const promoted = snapshot();
    pressShift("Tab");
    expect(node("a1")).toMatchObject({
      role: "root",
      parentId: null,
      order: null,
    });
    expect(node("a1").graphId).not.toBe("graph");
    expect(index(node("a1").graphId).nodes.size).toBe(1);
    expect(
      getBoundTextElement(node("a1"), h.app.scene.getNonDeletedElementsMap())
        ?.originalText,
    ).toBe("用户访谈");
    expectAtomic(promoted, count + 1);
    const saved = JSON.parse(
      serializeAsJSON(
        h.app.scene.getNonDeletedElements(),
        h.state,
        {},
        "local",
      ),
    );
    const reopened = restoreElements(saved.elements, null, {
      repairBindings: true,
    });
    expect(buildMindmapGraphIndex(reopened, node("a1").graphId).rootId).toBe(
      "a1",
    );
    const splitCount = API.getUndoStack().length;
    pressShift("Tab");
    expect(API.getUndoStack()).toHaveLength(splitCount);
  });

  it.each([
    ["mindmapToggleCollapse", "a", " ", false],
    ["deleteSelectedElements", "a", "Delete", false],
    ["mindmapDeletePreservingChildren", "a", "Delete", true],
    ["mindmapDeletePreservingChildren", "root", "Delete", true],
    ["mindmapDeletePreservingChildren", "b", "Delete", true],
    ["mindmapPromote", "a1", "Tab", true],
  ] as const)("菜单 %s 与快捷键共用语义和历史", (action, id, key, shift) => {
    select(id);
    const before = snapshot();
    const count = API.getUndoStack().length;
    if (shift) {
      pressShift(key);
    } else {
      Keyboard.keyPress(key);
    }
    const confirmPreserving = () => {
      if (h.state.openDialog?.name !== "mindmapDelete") {
        return;
      }
      if (id === "root") {
        fireEvent.change(screen.getByRole("combobox", { name: "New root" }), {
          target: { value: "b" },
        });
        fireEvent.click(
          screen.getByRole("button", {
            name: "Keep branches and replace root",
          }),
        );
      } else {
        fireEvent.click(
          screen.getByRole("button", { name: "Promote children in order" }),
        );
      }
    };
    confirmPreserving();
    const keyboardResult = snapshot();
    Keyboard.undo();
    select(id);
    openMenu(id);
    fireEvent.click(screen.getByTestId(action));
    confirmPreserving();
    expect(snapshot()).toEqual(keyboardResult);
    expectAtomic(before, count);
  });

  it("菜单创建子节点和同级节点，折叠父节点创建时自动展开且原子撤销", async () => {
    select("a");
    Keyboard.keyPress(" ");
    const before = snapshot();
    const count = API.getUndoStack().length;
    openMenu("a");
    fireEvent.click(screen.getByTestId("mindmapCreateChild"));
    let editor = await getTextEditor();
    updateTextEditor(editor, "新子节点");
    Keyboard.exitTextEditor(editor);
    expect(node("a").collapsed).toBe(false);
    expect(index().childrenById.get("a")).toHaveLength(3);
    expectAtomic(before, count);
    openMenu("a");
    fireEvent.click(screen.getByTestId("mindmapCreateSibling"));
    editor = await getTextEditor();
    updateTextEditor(editor, "新同级节点");
    Keyboard.exitTextEditor(editor);
    expect(index().childrenById.get("root")).toHaveLength(4);
  });

  it("文本编辑和 IME 不触发树操作，多选不会走原生删除", async () => {
    select("a");
    const before = snapshot();
    fireEvent.keyDown(h.app.ownerDocument, {
      key: "Delete",
      isComposing: true,
    });
    expect(snapshot()).toEqual(before);
    UI.clickExtraTool("mindmap");
    const target = node("a");
    new Pointer("mouse").doubleClickAt(target.x + 30, target.y + 20);
    const editor = await getTextEditor();
    const count = index().nodes.size;
    for (const key of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      " ",
      "Delete",
      "Tab",
    ]) {
      fireEvent.keyDown(editor, { key });
    }
    expect(index().nodes.size).toBe(count);
    expect(node("a").collapsed).toBe(false);
    Keyboard.exitTextEditor(editor);
    API.setSelectedElements([node("a"), node("rectangle")]);
    const mixed = snapshot();
    Keyboard.keyPress("Delete");
    act(() => h.app.actionManager.executeAction(actionDeleteSelected));
    pressShift("Delete");
    expect(h.state.openDialog).toBeNull();
    expect(snapshot()).toEqual(mixed);
    API.setSelectedElements([node("rectangle")]);
    Keyboard.keyPress("Delete");
    expect(node("rectangle")).toBeNull();
    expect(index().nodes.size).toBe(count);
  });
});
