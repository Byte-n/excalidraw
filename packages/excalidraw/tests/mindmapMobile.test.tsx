import { newMindmapNodeElement, newTextElement } from "@excalidraw/element";
import { vi } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
  within,
} from "./test-utils";

const { h } = window;

const fixture = () => {
  const elements: ExcalidrawElement[] = [];
  for (const [id, parentId, title] of [
    ["root", null, "Planning"],
    ["child", "root", "Research"],
    ["grandchild", "child", "Interview"],
  ] as const) {
    const node = {
      ...newMindmapNodeElement({
        x: 120,
        y: 160,
        graphId: "mobile-graph",
        ...(parentId
          ? {
              role: "node" as const,
              parentId,
              order: "a0" as FractionalIndex,
            }
          : { role: "root" as const, parentId: null, order: null }),
      }),
      id,
      boundElements: [{ type: "text" as const, id: `${id}-text` }],
    };
    elements.push(node, {
      ...newTextElement({
        x: node.x + 12,
        y: node.y + 12,
        text: title,
        containerId: id,
        textAlign: "center",
        verticalAlign: "middle",
      }),
      id: `${id}-text`,
    });
  }
  return restoreElements(elements, null, { repairBindings: true });
};

const node = (id: string) =>
  h.app.scene.getNonDeletedElement(id) as ExcalidrawMindmapNodeElement & {
    isDeleted: false;
  };

describe("Mindmap mobile actions", () => {
  beforeAll(() => mockBoundingClientRect({ width: 390, height: 844 }));
  afterAll(() => restoreOriginalGetBoundingClientRect());

  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw initialData={{ elements: fixture() }} />);
    act(() => h.app.refreshEditorInterface());
  });

  const selectTool = () => {
    act(() => h.app.setActiveTool({ type: "selection" }));
    API.setAppState({
      preferredSelectionTool: { type: "selection", initialized: true },
    });
  };

  it("offers touch actions without hover and runs the shared collapse command", () => {
    expect(h.app.editorInterface.formFactor).toBe("phone");
    API.setSelectedElements([node("child")]);
    const toolbar = screen.getByRole("toolbar", { name: "Mindmap" });
    expect(
      within(toolbar).getByRole("button", { name: "Add child node" }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole("button", { name: "Edit node" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(toolbar).getByRole("button", { name: "Collapse branch" }),
    );
    expect(node("child").collapsed).toBe(true);
    expect(
      within(toolbar).getByRole("button", { name: "Expand branch" }),
    ).toBeInTheDocument();
  });

  it("shows root actions after tapping an already selected graph root", () => {
    API.setSelectedElements([...h.app.scene.getNonDeletedElements()]);
    expect(h.app.mindmap.getSelectedGraphRoot()?.id).toBe("root");
    expect(screen.queryByRole("toolbar", { name: "Mindmap" })).toBeNull();

    const touch = new Pointer("touch");
    touch.clickAt(node("root").x + 20, node("root").y + 20);

    expect(h.app.mindmap.getSelectedNode()?.id).toBe("root");
    const toolbar = screen.getByRole("toolbar", { name: "Mindmap" });
    expect(
      within(toolbar).getByRole("button", { name: "Add child node" }),
    ).toBeInTheDocument();
  });

  it("selects a node on the first touch and drags it on the next touch", () => {
    selectTool();
    const touch = new Pointer("touch");
    const start = { x: node("child").x, y: node("child").y };
    const point = { x: start.x + 20, y: start.y + 20 };

    touch.downAt(point.x, point.y);
    touch.moveTo(point.x + 80, point.y + 40);
    expect(h.app.mindmap.getDragPreview()).toBeNull();
    expect(node("child")).toMatchObject(start);
    touch.upAt();
    expect(h.app.mindmap.getSelectedNode()?.id).toBe("child");

    touch.downAt(point.x, point.y);
    touch.moveTo(point.x + 80, point.y + 40);
    expect(h.app.mindmap.getDragPreview()).not.toBeNull();
    touch.upAt();
  });

  it("requires a prior root selection before moving the complete graph", () => {
    selectTool();
    const touch = new Pointer("touch");
    const start = { x: node("root").x, y: node("root").y };
    const point = { x: start.x + 20, y: start.y + 20 };

    touch.downAt(point.x, point.y);
    touch.moveTo(point.x + 80, point.y + 40);
    expect(node("root")).toMatchObject(start);
    touch.upAt();

    touch.downAt(point.x, point.y);
    touch.moveTo(point.x + 80, point.y + 40);
    expect(node("root")).toMatchObject({
      x: start.x + 80,
      y: start.y + 40,
    });
    touch.upAt();
  });

  it("opens the node menu only after selection with the selection tool", () => {
    selectTool();
    vi.useFakeTimers();
    const touch = new Pointer("touch");
    const point = { x: node("child").x + 20, y: node("child").y + 20 };

    try {
      touch.downAt(point.x, point.y);
      act(() => vi.advanceTimersByTime(600));
      expect(UI.queryContextMenu()).toBeNull();
      act(() => h.app.openContextMenu({ clientX: point.x, clientY: point.y }));
      expect(UI.queryContextMenu()).toBeNull();
      touch.upAt();

      touch.downAt(point.x, point.y);
      act(() => vi.advanceTimersByTime(600));
      expect(
        UI.queryContextMenu()?.querySelector(
          'li[data-testid="mindmapCreateChild"]',
        ),
      ).not.toBeNull();
      touch.upAt();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not drag or open the node menu while lasso is active", () => {
    act(() => h.app.setActiveTool({ type: "lasso" }));
    API.setAppState({
      preferredSelectionTool: { type: "lasso", initialized: true },
    });
    API.setSelectedElements([node("child")]);
    vi.useFakeTimers();
    const touch = new Pointer("touch");
    const start = { x: node("child").x, y: node("child").y };

    try {
      touch.downAt(start.x + 20, start.y + 20);
      act(() => vi.advanceTimersByTime(600));
      expect(UI.queryContextMenu()).toBeNull();
      touch.moveTo(start.x + 100, start.y + 60);
      expect(h.app.mindmap.getDragPreview()).toBeNull();
      expect(node("child")).toMatchObject(start);
      touch.upAt();
    } finally {
      vi.useRealTimers();
    }
  });
});
