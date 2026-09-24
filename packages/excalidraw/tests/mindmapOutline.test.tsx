import {
  buildMindmapGraphIndex,
  getBoundTextElement,
  newElement,
  newMindmapNodeElement,
  newTextElement,
} from "@excalidraw/element";

import { DEFAULT_SIDEBAR, MINDMAP_OUTLINE_TAB } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";

const { h } = window;

const fixture = () => {
  const entries = [
    ["root", null, "Product plan", "graph-1"],
    ["research", "root", "Research", "graph-1"],
    ["interview", "research", "User interview", "graph-1"],
    ["competitors", "research", "Competitors", "graph-1"],
    ["other-root", null, "Product plan", "graph-2"],
    ["other-interview", "other-root", "User interview", "graph-2"],
  ] as const;
  const elements: ExcalidrawElement[] = [];
  entries.forEach(([id, parentId, label, graphId], position) => {
    const node = {
      ...newMindmapNodeElement({
        x: graphId === "graph-1" ? 100 : 800,
        y: 100 + position * 80,
        graphId,
        ...(parentId
          ? {
              role: "node" as const,
              parentId,
              order: `a${position}` as FractionalIndex,
            }
          : { role: "root" as const, parentId: null, order: null }),
        collapsed: id === "research",
      }),
      id,
    };
    const text = {
      ...newTextElement({
        x: node.x,
        y: node.y,
        text: label,
        containerId: id,
        textAlign: "center",
        verticalAlign: "middle",
      }),
      id: `${id}-text`,
    };
    elements.push(
      { ...node, boundElements: [{ id: text.id, type: "text" }] },
      text,
    );
  });
  elements.push({
    ...newElement({
      type: "rectangle",
      x: 1300,
      y: 200,
      width: 100,
      height: 60,
    }),
    id: "ordinary-shape",
  });
  return restoreElements(elements, null, { repairBindings: true });
};

const node = (id: string) =>
  h.app.scene.getNonDeletedElement(id) as ExcalidrawMindmapNodeElement & {
    isDeleted: false;
  };
const index = () =>
  buildMindmapGraphIndex(h.app.scene.getNonDeletedElements(), "graph-1");

describe("Mindmap P07 search and outline", () => {
  beforeEach(async () => {
    await render(
      <Excalidraw
        handleKeyboardGlobally
        initialData={{ elements: fixture() }}
      />,
    );
    h.app.ownerWindow.HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  it("finds a hidden node with graph and path, then reveals it in one undo step", async () => {
    act(() =>
      h.app.setAppState({
        openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "search" },
      }),
    );
    const input = await screen.findByPlaceholderText("Find text on canvas...");
    const beforeQuery = API.getUndoStack().length;
    updateTextEditor(input as HTMLInputElement, "User interview");

    await waitFor(() =>
      expect(h.app.state.searchMatches?.matches).toHaveLength(2),
    );
    const results = h.app.excalidrawContainerValue.container!.querySelectorAll(
      ".layer-ui__result-item",
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveTextContent("Mindmap 1: Product plan");
    expect(results[0]).toHaveTextContent(
      "Product plan / Research / User interview",
    );
    expect(results[1]).toHaveTextContent("Mindmap 2: Product plan");
    expect(node("research").collapsed).toBe(true);
    const before = API.getUndoStack().length;
    expect(before).toBe(beforeQuery);

    fireEvent.click(results[0]);
    expect(node("research").collapsed).toBe(false);
    expect(h.app.state.selectedElementIds).toEqual({ interview: true });
    expect(API.getUndoStack()).toHaveLength(before + 1);
    Keyboard.undo();
    expect(node("research").collapsed).toBe(true);
  });

  it("updates results after text and structure changes without stale jumps", async () => {
    act(() =>
      h.app.setAppState({
        openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "search" },
      }),
    );
    const input = await screen.findByPlaceholderText("Find text on canvas...");
    updateTextEditor(input as HTMLInputElement, "User interview");
    await waitFor(() =>
      expect(h.app.state.searchMatches?.matches).toHaveLength(2),
    );
    const text = getBoundTextElement(
      node("other-interview"),
      h.app.scene.getNonDeletedElementsMap(),
    )!;
    act(() =>
      API.updateElement(text, { originalText: "New label", text: "New label" }),
    );
    await waitFor(() =>
      expect(h.app.state.searchMatches?.matches).toHaveLength(1),
    );
    act(() => h.app.mindmap.focusNode("interview"));
    act(() =>
      h.app.mindmap.executeTreeCommand({ type: "delete" }, "interview"),
    );
    await waitFor(() => expect(h.app.state.searchMatches).toBeNull());
  });

  it("deduplicates mindmap labels without changing ordinary text search", async () => {
    const interviewText = getBoundTextElement(
      node("interview"),
      h.app.scene.getNonDeletedElementsMap(),
    )!;
    act(() =>
      API.updateElement(interviewText, {
        text: "User User",
        originalText: "User User",
      }),
    );
    act(() =>
      h.app.updateScene({
        elements: [
          ...h.app.scene.getElementsIncludingDeleted(),
          {
            ...newTextElement({ x: 1200, y: 400, text: "User User" }),
            id: "ordinary-text",
          },
        ],
      }),
    );
    act(() =>
      h.app.setAppState({
        openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "search" },
      }),
    );
    const input = await screen.findByPlaceholderText("Find text on canvas...");
    updateTextEditor(input as HTMLInputElement, "User");
    await waitFor(() =>
      expect(h.app.state.searchMatches?.matches).toHaveLength(4),
    );
    expect(
      h.app.state.searchMatches?.matches.filter(
        (match) => match.id === "interview-text",
      ),
    ).toHaveLength(1);
    expect(
      h.app.state.searchMatches?.matches.filter(
        (match) => match.id === "ordinary-text",
      ),
    ).toHaveLength(2);
  });

  it("syncs outline selection and collapse with the canvas", async () => {
    act(() =>
      h.app.setAppState({
        openSidebar: {
          name: DEFAULT_SIDEBAR.name,
          tab: MINDMAP_OUTLINE_TAB,
        },
      }),
    );
    expect(
      await screen.findByText("Mindmap 1: Product plan"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "User interview" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Expand branch" }));
    expect(node("research").collapsed).toBe(false);
    fireEvent.click(
      screen.getAllByRole("button", { name: "User interview" })[0],
    );
    expect(h.app.state.selectedElementIds).toEqual({ interview: true });
    expect(
      screen
        .getAllByRole("button", { name: "User interview" })[0]
        .closest(".selected"),
    ).not.toBeNull();
    act(() => API.setSelectedElements([node("other-interview")]));
    expect(
      screen
        .getAllByRole("button", { name: "User interview" })[1]
        .closest('[aria-selected="true"]'),
    ).not.toBeNull();
  });

  it("edits labels and structure through the outline menu", async () => {
    act(() =>
      h.app.setAppState({
        openSidebar: {
          name: DEFAULT_SIDEBAR.name,
          tab: MINDMAP_OUTLINE_TAB,
        },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Research" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const rename = await screen.findByRole("textbox", {
      name: "Rename Research",
    });
    updateTextEditor(rename as HTMLInputElement, "Discovery");
    fireEvent.keyDown(rename, { key: "Enter" });
    expect(h.app.state.openSidebar?.tab).toBe(MINDMAP_OUTLINE_TAB);
    expect(
      getBoundTextElement(
        node("research"),
        h.app.scene.getNonDeletedElementsMap(),
      )?.originalText,
    ).toBe("Discovery");
    expect(
      await screen.findByRole("button", { name: "Discovery" }),
    ).toBeInTheDocument();

    const historyBeforeCancel = API.getUndoStack().length;
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Discovery" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const cancelledRename = await screen.findByRole("textbox", {
      name: "Rename Discovery",
    });
    updateTextEditor(cancelledRename as HTMLInputElement, "Discarded");
    fireEvent.keyDown(cancelledRename, { key: "Escape" });
    expect(
      screen.getByRole("button", { name: "Discovery" }),
    ).toBeInTheDocument();
    expect(API.getUndoStack()).toHaveLength(historyBeforeCancel);

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Discovery" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Add child" }));
    const editor = await getTextEditor();
    updateTextEditor(editor, "Survey");
    fireEvent.blur(editor);
    expect(node("research").collapsed).toBe(false);
    expect(index().childrenById.get("research")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Survey" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Survey" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete branch" }));
    expect(index().childrenById.get("research")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Survey" })).toBeNull();
  });

  it("cancels preserve-delete and promotes a first-level branch from the outline", async () => {
    act(() =>
      h.app.setAppState({
        openSidebar: {
          name: DEFAULT_SIDEBAR.name,
          tab: MINDMAP_OUTLINE_TAB,
        },
      }),
    );
    const before = API.getUndoStack().length;
    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Research" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete node, keep children" }),
    );
    expect(screen.getByText("Delete mindmap node")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(index().childrenById.get("research")).toEqual([
      "interview",
      "competitors",
    ]);
    expect(API.getUndoStack()).toHaveLength(before);

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Research" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Promote or detach branch" }),
    );
    expect(node("research").role).toBe("root");
    expect(node("research").graphId).not.toBe("graph-1");
    expect(API.getUndoStack()).toHaveLength(before + 1);
    Keyboard.undo();
    expect(node("research").parentId).toBe("root");
    expect(node("research").graphId).toBe("graph-1");
  });

  it("reparents a branch through outline drag and keeps a single tree", async () => {
    act(() =>
      h.app.setAppState({
        openSidebar: {
          name: DEFAULT_SIDEBAR.name,
          tab: MINDMAP_OUTLINE_TAB,
        },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand branch" }),
    );
    const source = screen
      .getByRole("button", { name: "Competitors" })
      .closest(".mindmap-outline-row")!;
    const target = screen
      .getAllByRole("button", { name: "User interview" })[0]
      .closest(".mindmap-outline-row")!;
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: jest.fn(),
    };
    const before = API.getUndoStack().length;
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 0 });
    fireEvent.drop(target, { dataTransfer, clientY: 0 });
    fireEvent.dragEnd(source, { dataTransfer });
    expect(index().parentById.get("competitors")).toBe("interview");
    expect(API.getUndoStack()).toHaveLength(before + 1);
    act(() =>
      h.app.setAppState({
        openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "search" },
      }),
    );
    const input = await screen.findByPlaceholderText("Find text on canvas...");
    updateTextEditor(input as HTMLInputElement, "Competitors");
    expect(
      await screen.findByText(
        "Product plan / Research / User interview / Competitors",
      ),
    ).toBeInTheDocument();
    Keyboard.undo();
    expect(index().parentById.get("competitors")).toBe("research");

    act(() =>
      h.app.setAppState({
        openSidebar: {
          name: DEFAULT_SIDEBAR.name,
          tab: MINDMAP_OUTLINE_TAB,
        },
      }),
    );
    const reorderedSource = screen
      .getByRole("button", { name: "Competitors" })
      .closest(".mindmap-outline-row")!;
    const reorderedTarget = screen
      .getAllByRole("button", { name: "User interview" })[0]
      .closest(".mindmap-outline-row")!;
    const reparent = jest.spyOn(h.app.mindmap, "reparentNode");
    fireEvent.dragStart(reorderedSource, { dataTransfer });
    jest.spyOn(reorderedTarget, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);
    fireEvent(
      reorderedTarget,
      new h.app.ownerWindow.MouseEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientY: 10,
      }),
    );
    fireEvent(
      reorderedTarget,
      new h.app.ownerWindow.MouseEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientY: 10,
      }),
    );
    fireEvent.dragEnd(reorderedSource, { dataTransfer });
    expect(reparent).toHaveBeenLastCalledWith(
      "competitors",
      "research",
      "interview",
    );
    expect(index().childrenById.get("research")).toEqual([
      "competitors",
      "interview",
    ]);

    const invalidHistory = API.getUndoStack().length;
    const invalidSource = screen
      .getByRole("button", { name: "Research" })
      .closest(".mindmap-outline-row")!;
    fireEvent.dragStart(invalidSource, { dataTransfer });
    fireEvent.dragOver(reorderedTarget, { dataTransfer, clientY: 50 });
    fireEvent.drop(reorderedTarget, { dataTransfer, clientY: 50 });
    fireEvent.dragEnd(invalidSource, { dataTransfer });
    expect(index().parentById.get("research")).toBe("root");
    expect(API.getUndoStack()).toHaveLength(invalidHistory);
  });
});
