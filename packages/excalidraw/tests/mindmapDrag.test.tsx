import {
  buildMindmapGraphIndex,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  newElement,
  newMindmapNodeElement,
  newTextElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { actionDuplicateSelection, actionToggleElementLock } from "../actions";
import { restoreElements } from "../data/restore";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

import type { ElementRenderOverrides } from "../types";

const { h } = window;

const fixture = () => {
  const entries = [
    ["root", null, "Planning"],
    ["a", "root", "Research"],
    ["b", "root", "Solution"],
    ["a1", "a", "Interview"],
    ["b1", "b", "Prototype"],
  ] as const;
  const elements: ExcalidrawElement[] = [];
  entries.forEach(([id, parentId, label], i) => {
    const node = {
      ...newMindmapNodeElement({
        x: 100,
        y: 200,
        graphId: "graph",
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
      x: 850,
      y: 100,
      width: 100,
      height: 80,
    }),
    id: "rectangle",
  });
  return restoreElements(elements, null, { repairBindings: true });
};

const node = (id: string) =>
  h.app.scene.getNonDeletedElement(id) as ExcalidrawMindmapNodeElement & {
    isDeleted: false;
  };

const addSecondGraph = () => {
  const root = {
    ...newMindmapNodeElement({
      x: 720,
      y: 600,
      graphId: "graph-2",
      role: "root",
      parentId: null,
      order: null,
    }),
    id: "root-2",
  };
  const child = {
    ...newMindmapNodeElement({
      x: 900,
      y: 600,
      graphId: "graph-2",
      role: "node",
      parentId: root.id,
      order: "a0" as FractionalIndex,
    }),
    id: "child-2",
  };
  API.setElements(
    restoreElements(
      [...h.app.scene.getNonDeletedElements(), root, child],
      null,
      {
        repairBindings: true,
      },
    ),
  );
};

const snapshot = () =>
  JSON.stringify(h.app.scene.getElementsIncludingDeleted(), (key, value) =>
    ["version", "versionNonce", "updated"].includes(key) ? undefined : value,
  );
const renderOpacity = (id: string) =>
  (Reflect.get(h.app, "elementRenderOverrides") as ElementRenderOverrides).get(
    id,
  )?.opacity;

describe("Mindmap P03 drag preview", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(
      <Excalidraw
        handleKeyboardGlobally
        initialData={{ elements: fixture() }}
      />,
    );
  });

  it("edits graph design only while the whole mindmap is selected", () => {
    const mouse = new Pointer("mouse");
    mouse.clickAt(node("root").x + 20, node("root").y + 20);

    expect(h.app.mindmap.getSelectedGraphRoot()?.id).toBe("root");
    expect(
      screen.getByRole("button", { name: "Right to left" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mindmap-shape-rectangle"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Right to left" }));
    expect(node("root").layoutDirection).toBe("right-to-left");

    fireEvent.change(screen.getByLabelText("Mindmap edge color"), {
      target: { value: "#ff0000" },
    });
    fireEvent.change(screen.getByLabelText("Mindmap edge width"), {
      target: { value: "5" },
    });
    fireEvent.click(
      screen
        .getByRole("region", { name: "Mindmap edge" })
        .querySelector('button[aria-label="Dashed"]')!,
    );
    fireEvent.click(
      screen
        .getByRole("region", { name: "Mindmap edge" })
        .querySelector('button[aria-label="Curved"]')!,
    );

    expect(node("root")).toMatchObject({
      defaultEdgeStrokeColor: "#ff0000",
      defaultEdgeStrokeWidth: 5,
      defaultEdgeStrokeStyle: "dashed",
      defaultEdgeRouting: "curved",
    });
    const edges = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapEdgeElement);
    expect(edges.length).toBeGreaterThan(0);
    edges.forEach((edge) => {
      expect(edge).toMatchObject({
        strokeColor: "#ff0000",
        strokeWidth: 5,
        strokeStyle: "dashed",
        routing: "curved",
      });
    });
    expect(h.state.toast).toBeNull();

    mouse.clickAt(node("root").x + 20, node("root").y + 20);
    expect(h.state.selectedElementIds).toEqual({ root: true });
    expect(h.app.mindmap.getSelectedGraphRoot()).toBeNull();
    expect(
      screen.queryByLabelText("Mindmap edge color"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Right to left" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("mindmap-shape-rectangle")).toBeInTheDocument();
  });

  it("edits only the selected node's incoming edge", () => {
    API.setSelectedElements([node("a")]);
    const otherEdges = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapEdgeElement)
      .filter((edge) => edge.childId !== "a");
    const rootDefaults = {
      defaultEdgeStrokeColor: node("root").defaultEdgeStrokeColor,
      defaultEdgeStrokeWidth: node("root").defaultEdgeStrokeWidth,
      defaultEdgeStrokeStyle: node("root").defaultEdgeStrokeStyle,
      defaultEdgeRouting: node("root").defaultEdgeRouting,
    };

    expect(
      screen.getByRole("region", { name: "Incoming edge" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Right to left" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Incoming edge color"), {
      target: { value: "#00aa00" },
    });
    fireEvent.change(screen.getByLabelText("Incoming edge width"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen
        .getByRole("region", { name: "Incoming edge" })
        .querySelector('button[aria-label="Dotted"]')!,
    );
    fireEvent.click(
      screen
        .getByRole("region", { name: "Incoming edge" })
        .querySelector('button[aria-label="Curved"]')!,
    );

    const incomingEdge = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapEdgeElement)
      .find((edge) => edge.childId === "a");
    expect(incomingEdge).toMatchObject({
      strokeColor: "#00aa00",
      strokeWidth: 4,
      strokeStyle: "dotted",
      routing: "curved",
    });
    otherEdges.forEach((edge) => {
      expect(h.app.scene.getNonDeletedElement(edge.id)).toMatchObject({
        strokeColor: edge.strokeColor,
        strokeWidth: edge.strokeWidth,
        strokeStyle: edge.strokeStyle,
        routing: edge.routing,
      });
    });
    expect(node("root")).toMatchObject(rootDefaults);
    expect(h.state.toast).toBeNull();
  });

  it("toggles graph design on repeated clicks of a lone root", () => {
    API.setElements(
      h.app.scene
        .getNonDeletedElements()
        .filter(
          (element) => element.id === "root" || element.id === "root-text",
        ),
    );
    const mouse = new Pointer("mouse");

    mouse.clickAt(node("root").x + 20, node("root").y + 20);
    expect(h.app.mindmap.getSelectedGraphRoot()?.id).toBe("root");
    expect(
      screen.getByRole("button", { name: "Right to left" }),
    ).toBeInTheDocument();

    mouse.clickAt(node("root").x + 20, node("root").y + 20);
    expect(h.app.mindmap.getSelectedGraphRoot()).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Right to left" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("mindmap-shape-rectangle")).toBeInTheDocument();
  });

  it("moves only the node preview with the pointer and connects it to the candidate parent", () => {
    API.setSelectedElements([node("a")]);
    const before = snapshot();
    const historyLength = API.getUndoStack().length;
    const mouse = new Pointer("mouse");
    mouse.downAt(node("a").x + 20, node("a").y + 20);
    const destination = {
      x: node("b").x + node("b").width + 20,
      y: node("b").y + node("b").height / 2,
    };
    mouse.moveTo(destination.x, destination.y);

    const preview = h.app.mindmap.getDragPreview();
    expect(preview?.target).toEqual({ parentId: "b", beforeId: null });
    expect(preview?.previewElements.map((element) => element.id)).toEqual([
      expect.any(String),
      "a",
      "a-text",
    ]);
    expect(
      preview?.previewElements.find((element) => element.id === "a")?.x,
    ).toBe(node("a").x + destination.x - (node("a").x + 20));
    expect(renderOpacity("a1")).toBe(24);
    expect(renderOpacity("a1-text")).toBe(24);
    expect(renderOpacity("b1")).toBeUndefined();
    expect(
      preview?.previewElements.filter(
        (element) => isMindmapEdgeElement(element) && element.childId === "a",
      ),
    ).toEqual([expect.objectContaining({ parentId: "b", childId: "a" })]);
    expect(renderOpacity("a")).toBe(24);
    expect(snapshot()).toBe(before);
    expect(API.getUndoStack()).toHaveLength(historyLength);

    mouse.moveTo(destination.x + 12, destination.y + 4);
    expect(
      h.app.mindmap
        .getDragPreview()
        ?.previewElements.find((element) => element.id === "a")?.x,
    ).toBe(node("a").x + destination.x + 12 - (node("a").x + 20));

    mouse.upAt();
    expect(
      buildMindmapGraphIndex(
        h.app.scene.getNonDeletedElements(),
        "graph",
      ).parentById.get("a"),
    ).toBe("b");
    expect(h.app.mindmap.getDragPreview()).toBeNull();
    expect(renderOpacity("a")).toBeUndefined();
    expect(API.getUndoStack()).toHaveLength(historyLength + 1);
    Keyboard.undo();
    expect(snapshot()).toBe(before);
  });

  it("does not start a mindmap drag when a box selection starts on blank space", () => {
    API.setSelectedElements([node("a")]);
    const before = { x: node("a").x, y: node("a").y };
    const elements = h.app.scene.getNonDeletedElements();
    const startX = Math.min(...elements.map((element) => element.x)) - 100;
    const startY = Math.min(...elements.map((element) => element.y)) - 100;
    const endX =
      Math.max(...elements.map((element) => element.x + element.width)) + 100;
    const endY =
      Math.max(...elements.map((element) => element.y + element.height)) + 100;
    const mouse = new Pointer("mouse");

    mouse.downAt(startX, startY);
    mouse.moveTo(endX, endY);

    expect(h.app.mindmap.getDragPreview()).toBeNull();
    expect(node("a")).toMatchObject(before);

    mouse.upAt();
  });

  it("inserts above or below a sibling according to the pointer position", () => {
    API.setSelectedElements([node("a")]);
    const mouse = new Pointer("mouse");
    mouse.downAt(node("a").x + 20, node("a").y + 20);
    mouse.moveTo(node("b").x + node("b").width / 2, node("b").y - 10);
    expect(h.app.mindmap.getDragPreview()?.target).toEqual({
      parentId: "root",
      beforeId: "b",
    });
    mouse.moveTo(
      node("b").x + node("b").width / 2,
      node("b").y + node("b").height + 10,
    );
    expect(h.app.mindmap.getDragPreview()?.target).toEqual({
      parentId: "root",
      beforeId: null,
    });
    mouse.upAt();
    expect(
      buildMindmapGraphIndex(
        h.app.scene.getNonDeletedElements(),
        "graph",
      ).childrenById.get("root"),
    ).toEqual(["b", "a"]);
  });

  it("reparents multiple branches in tree order using the first root as the drag preview", () => {
    API.setSelectedElements([node("b1"), node("a1")]);
    const before = snapshot();
    const historyLength = API.getUndoStack().length;
    const mouse = new Pointer("mouse");
    mouse.downAt(node("b1").x + 20, node("b1").y + 20);
    mouse.moveTo(
      node("root").x + node("root").width + 20,
      node("root").y + node("root").height / 2,
    );

    const preview = h.app.mindmap.getDragPreview();
    expect(preview?.mode).toBe("reparent");
    expect(preview?.nodeIds).toEqual(["a1", "b1"]);
    expect(preview?.target).toEqual({ parentId: "root", beforeId: null });
    expect(
      preview?.previewElements.some((element) => element.id === "a1"),
    ).toBe(true);
    expect(
      preview?.previewElements.some((element) => element.id === "b1"),
    ).toBe(false);
    expect(snapshot()).toBe(before);
    mouse.upAt();

    const index = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      "graph",
    );
    expect(index.childrenById.get("root")).toEqual(["a", "b", "a1", "b1"]);
    expect(API.getUndoStack()).toHaveLength(historyLength + 1);
    Keyboard.undo();
    expect(snapshot()).toBe(before);
  });

  it("moves a selected parent once when its descendant is also selected", () => {
    API.setSelectedElements([node("a1"), node("a")]);
    const mouse = new Pointer("mouse");
    mouse.downAt(node("a").x + 20, node("a").y + 20);
    mouse.moveTo(
      node("b").x + node("b").width + 20,
      node("b").y + node("b").height / 2,
    );
    expect(h.app.mindmap.getDragPreview()?.nodeIds).toEqual(["a"]);
    expect(h.app.mindmap.getDragPreview()?.target).toEqual({
      parentId: "b",
      beforeId: null,
    });
    mouse.upAt();

    const index = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      "graph",
    );
    expect(index.parentById.get("a")).toBe("b");
    expect(index.parentById.get("a1")).toBe("a");
    expect(index.childrenById.get("b")).toEqual(["b1", "a"]);
  });

  it("Escape cancels the preview without Scene or history changes", () => {
    API.setSelectedElements([node("a")]);
    const before = snapshot();
    const historyLength = API.getUndoStack().length;
    const mouse = new Pointer("mouse");
    mouse.downAt(node("a").x + 20, node("a").y + 20);
    mouse.moveTo(node("b").x + 80, node("b").y + 28);
    Keyboard.keyDown("Escape", h.app.ownerWindow);
    mouse.upAt();

    expect(h.app.mindmap.getDragPreview()).toBeNull();
    expect(renderOpacity("a")).toBeUndefined();
    expect(snapshot()).toBe(before);
    expect(API.getUndoStack()).toHaveLength(historyLength);
  });

  it("blank drop and pointercancel restore the source without history", () => {
    API.setSelectedElements([node("a")]);
    const before = snapshot();
    const historyLength = API.getUndoStack().length;
    const mouse = new Pointer("mouse");
    mouse.downAt(node("a").x + 20, node("a").y + 20);
    mouse.moveTo(800, 650);
    expect(h.app.mindmap.getDragPreview()?.target).toBeNull();
    mouse.upAt();
    expect(snapshot()).toBe(before);
    expect(API.getUndoStack()).toHaveLength(historyLength);

    mouse.downAt(node("a").x + 20, node("a").y + 20);
    mouse.moveTo(node("b").x + 80, node("b").y + 28);
    fireEvent.pointerCancel(h.app.interactiveCanvas!, {
      pointerId: 1,
      clientX: node("b").x + 80,
      clientY: node("b").y + 28,
    });
    expect(h.app.mindmap.getDragPreview()).toBeNull();
    expect(renderOpacity("a")).toBeUndefined();
    expect(snapshot()).toBe(before);
    expect(API.getUndoStack()).toHaveLength(historyLength);
  });

  it("root drag moves the full graph, including collapsed descendants and labels", () => {
    API.setSelectedElements([node("root")]);
    act(() => h.app.scene.mutateElement(node("a"), { collapsed: true }));
    const tracked = [
      "root",
      "root-text",
      "a",
      "a-text",
      "a1",
      "a1-text",
      "b",
      "b-text",
    ];
    const positions = new Map(
      tracked.map((id) => {
        const element = h.app.scene.getNonDeletedElement(id)!;
        return [id, { x: element.x, y: element.y }] as const;
      }),
    );
    const before = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      "graph",
    );
    const mouse = new Pointer("mouse");
    mouse.downAt(node("root").x + 20, node("root").y + 20);
    mouse.moveTo(node("root").x + 100, node("root").y + 80);
    tracked.forEach((id) => {
      expect(h.app.scene.getNonDeletedElement(id)).toMatchObject({
        x: positions.get(id)!.x + 80,
        y: positions.get(id)!.y + 60,
      });
    });
    expect(h.app.mindmap.getDragPreview()?.previewElements).toEqual([]);
    expect(renderOpacity("root")).toBeUndefined();
    expect(renderOpacity("a1")).toBeUndefined();
    mouse.upAt();
    tracked.forEach((id) => {
      const element = h.app.scene.getNonDeletedElement(id)!;
      expect(element.x).toBe(positions.get(id)!.x + 80);
      expect(element.y).toBe(positions.get(id)!.y + 60);
    });
    const after = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      "graph",
    );
    expect(after.parentById).toEqual(before.parentById);
    expect(after.childrenById).toEqual(before.childrenById);
    expect(h.app.scene.getNonDeletedElement("rectangle")?.x).toBe(850);
  });

  it("restores a directly moved graph when the drag is cancelled", () => {
    API.setSelectedElements([node("root")]);
    const before = snapshot();
    const historyLength = API.getUndoStack().length;
    const rootBefore = { x: node("root").x, y: node("root").y };
    const mouse = new Pointer("mouse");
    mouse.downAt(node("root").x + 20, node("root").y + 20);
    mouse.moveTo(node("root").x + 100, node("root").y + 80);
    expect(node("root").x).toBe(rootBefore.x + 80);
    expect(node("root").y).toBe(rootBefore.y + 60);
    Keyboard.keyDown("Escape", h.app.ownerWindow);
    mouse.upAt();

    expect(snapshot()).toBe(before);
    expect(API.getUndoStack()).toHaveLength(historyLength);
  });

  it("mixed selection expands to visible graph nodes and moves the rectangle with the full graph", () => {
    const rectangle = h.app.scene.getNonDeletedElement("rectangle")!;
    API.setSelectedElements([node("a"), rectangle]);
    const original = new Map(
      ["root", "root-text", "a", "a1", "b", "rectangle"].map((id) => {
        const element = h.app.scene.getNonDeletedElement(id)!;
        return [id, { x: element.x, y: element.y }] as const;
      }),
    );
    const mouse = new Pointer("mouse");
    mouse.downAt(node("a").x + 20, node("a").y + 20);
    expect(h.state.selectedElementIds.root).toBe(true);
    expect(h.state.selectedElementIds.b).toBe(true);
    mouse.moveTo(node("a").x + 100, node("a").y + 80);
    mouse.upAt();
    original.forEach((position, id) => {
      const element = h.app.scene.getNonDeletedElement(id)!;
      expect(element.x).toBe(position.x + 80);
      expect(element.y).toBe(position.y + 60);
    });
  });

  it("replaces the first graph when clicking the root of a second graph", () => {
    addSecondGraph();
    const mouse = new Pointer("mouse");
    mouse.clickAt(node("root").x + 20, node("root").y + 20);
    expect(h.state.selectedElementIds.a).toBe(true);

    mouse.clickAt(node("root-2").x + 20, node("root-2").y + 20);
    expect(h.state.selectedElementIds["root-2"]).toBe(true);
    expect(h.state.selectedElementIds["child-2"]).toBe(true);
    expect(h.state.selectedElementIds.root).toBeUndefined();
    expect(h.state.selectedElementIds.a).toBeUndefined();
  });

  it("replaces an ordinary selection when clicking a root or child", () => {
    const rectangle = h.app.scene.getNonDeletedElement("rectangle")!;
    API.updateElement(rectangle, { x: 40, y: 40 });
    const mouse = new Pointer("mouse");
    mouse.clickAt(90, 41);
    expect(h.state.selectedElementIds.rectangle).toBe(true);
    mouse.clickAt(node("root").x + 20, node("root").y + 20);
    expect(h.state.selectedElementIds.rectangle).toBeUndefined();
    expect(h.state.selectedElementIds.root).toBe(true);
    expect(h.state.selectedElementIds.a).toBe(true);

    mouse.clickAt(90, 41);
    expect(h.state.selectedElementIds.rectangle).toBe(true);
    expect(h.state.selectedElementIds.root).toBeUndefined();
    mouse.clickAt(node("a").x + 20, node("a").y + 20);
    expect(h.state.selectedElementIds.rectangle).toBeUndefined();
    expect(h.state.selectedElementIds.a).toBe(true);
    expect(h.state.selectedElementIds.root).toBeUndefined();
  });

  it("keeps the previous selection when shift-clicking another root", () => {
    addSecondGraph();
    const mouse = new Pointer("mouse");
    mouse.clickAt(node("root").x + 20, node("root").y + 20);
    Keyboard.withModifierKeys({ shift: true }, () => {
      mouse.clickAt(node("root-2").x + 20, node("root-2").y + 20);
    });
    expect(h.state.selectedElementIds.root).toBe(true);
    expect(h.state.selectedElementIds.a).toBe(true);
    expect(h.state.selectedElementIds["root-2"]).toBe(true);
    expect(h.state.selectedElementIds["child-2"]).toBe(true);
  });

  it("replaces a complete boxed graph with the clicked root's graph", () => {
    addSecondGraph();
    API.setSelectedElements(
      h.app.scene
        .getNonDeletedElements()
        .filter(
          (element) =>
            element.id !== "rectangle" &&
            (!("graphId" in element) || element.graphId === "graph"),
        ),
    );
    expect(h.app.mindmap.isCompleteMindmapSelection()).toBe(true);

    const mouse = new Pointer("mouse");
    mouse.clickAt(node("root-2").x + 20, node("root-2").y + 20);
    expect(h.state.selectedElementIds["root-2"]).toBe(true);
    expect(h.state.selectedElementIds["child-2"]).toBe(true);
    expect(h.state.selectedElementIds.root).toBeUndefined();
  });

  it("replaces selected standalone text and arrow with the clicked graph", () => {
    const text = API.createElement({
      type: "text",
      id: "note",
      x: 50,
      y: 50,
      text: "Note",
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow",
      x: 50,
      y: 100,
    });
    API.setElements([...h.app.scene.getNonDeletedElements(), text, arrow]);
    const mouse = new Pointer("mouse");

    for (const element of [text, arrow]) {
      API.setSelectedElements([element]);
      mouse.clickAt(node("root").x + 20, node("root").y + 20);
      expect(h.state.selectedElementIds[element.id]).toBeUndefined();
      expect(h.state.selectedElementIds.root).toBe(true);
      expect(h.state.selectedElementIds.a).toBe(true);
    }
  });

  it("drags an ordinary shape after replacing a root selection", () => {
    const rectangle = h.app.scene.getNonDeletedElement("rectangle")!;
    API.updateElement(rectangle, { x: 40, y: 40 });
    const originalRootX = node("root").x;
    const mouse = new Pointer("mouse");
    mouse.clickAt(node("root").x + 20, node("root").y + 20);
    mouse.downAt(90, 41);
    mouse.moveTo(110, 61);
    mouse.upAt();

    expect(h.app.scene.getNonDeletedElement("rectangle")?.x).toBe(60);
    expect(node("root").x).toBe(originalRootX);
    expect(h.state.selectedElementIds.root).toBeUndefined();
  });

  it("expands a graph when shift-clicking its root from an ordinary selection", () => {
    const rectangle = h.app.scene.getNonDeletedElement("rectangle")!;
    API.updateElement(rectangle, { x: 40, y: 40 });
    const mouse = new Pointer("mouse");
    mouse.clickAt(90, 41);
    expect(h.state.selectedElementIds.rectangle).toBe(true);
    Keyboard.withModifierKeys({ shift: true }, () => {
      mouse.downAt(node("root").x + 20, node("root").y + 20);
      expect(h.state.selectedElementIds.rectangle).toBe(true);
      mouse.upAt();
    });
    expect(h.state.selectedElementIds.rectangle).toBe(true);
    expect(h.state.selectedElementIds.root).toBe(true);
    expect(h.state.selectedElementIds.a).toBe(true);
  });

  it("excludes an incomplete Mindmap from a box selection", () => {
    const rectangle = h.app.scene.getNonDeletedElement("rectangle")!;
    const mouse = new Pointer("mouse");
    mouse.downAt(80, 80);
    mouse.moveTo(90, 90);
    mouse.moveTo(rectangle.x + rectangle.width + 20, 230);
    mouse.upAt();

    expect(h.state.selectedElementIds.rectangle).toBe(true);
    expect(
      h.app.scene
        .getNonDeletedElements()
        .filter(
          (element) =>
            element.type === "mindmap-node" ||
            element.type === "mindmap-edge" ||
            (element.type === "text" && element.containerId !== null),
        )
        .some((element) => h.state.selectedElementIds[element.id]),
    ).toBe(false);
  });

  it("removes a bound label when its graph is not fully boxed", () => {
    expect(h.app.mindmap.normalizeMindmapSelection({ "a-text": true })).toEqual(
      {},
    );
  });

  it("normalizes freehand selections to complete Mindmap graphs", () => {
    act(() => h.app.lassoTrail.startPath(0, 0));
    act(() => h.app.lassoTrail.selectElementsFromIds(["a"]));
    expect(h.state.selectedElementIds.a).toBeUndefined();

    const graphElements = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          isMindmapNodeElement(element) ||
          isMindmapEdgeElement(element) ||
          (element.type === "text" && element.containerId !== null),
      );
    act(() =>
      h.app.lassoTrail.selectElementsFromIds(graphElements.map(({ id }) => id)),
    );
    graphElements.forEach((element) => {
      expect(h.state.selectedElementIds[element.id]).toBe(true);
    });
  });

  it("copies a non-root node subtree as a new Mindmap with Alt-drag", () => {
    API.setSelectedElements([node("a")]);
    const original = {
      a: { x: node("a").x, y: node("a").y },
      a1: { x: node("a1").x, y: node("a1").y },
    };
    const originalGraphIds = new Set(
      h.app.scene
        .getNonDeletedElements()
        .filter(isMindmapNodeElement)
        .map((element) => element.graphId),
    );
    const mouse = new Pointer("mouse");

    Keyboard.withModifierKeys({ alt: true }, () => {
      mouse.downAt(node("a").x + 20, node("a").y + 20);
      mouse.moveTo(node("a").x + 100, node("a").y + 80);
      mouse.moveTo(node("a").x + 140, node("a").y + 100);
      mouse.upAt();
    });

    expect(node("a")).toMatchObject(original.a);
    expect(node("a1")).toMatchObject(original.a1);
    const copiedNodes = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          element.type === "mindmap-node" &&
          !originalGraphIds.has(
            (element as ExcalidrawMindmapNodeElement).graphId,
          ),
      );
    expect(copiedNodes).toHaveLength(2);
    const copiedRoot = copiedNodes.find(
      (element) => (element as ExcalidrawMindmapNodeElement).role === "root",
    ) as ExcalidrawMindmapNodeElement | undefined;
    const copiedChild = copiedNodes.find(
      (element) => (element as ExcalidrawMindmapNodeElement).role === "node",
    ) as ExcalidrawMindmapNodeElement | undefined;
    expect(copiedRoot).toBeDefined();
    expect(copiedChild).toMatchObject({ parentId: copiedRoot!.id });
    expect(
      h.app.scene
        .getNonDeletedElements()
        .filter(
          (element) =>
            element.type === "mindmap-edge" &&
            element.graphId === copiedRoot!.graphId,
        ),
    ).toHaveLength(1);
    expect(copiedRoot!.x).toBe(original.a.x + 40);
    expect(copiedRoot!.y).toBe(original.a.y + 20);
  });

  it("duplicates a selected Mindmap subtree with Ctrl/Cmd+D", () => {
    API.setSelectedElements([node("a")]);
    act(() => {
      h.app.actionManager.executeAction(actionDuplicateSelection);
    });

    const copiedNodes = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          isMindmapNodeElement(element) &&
          element.graphId !== node("root").graphId,
      );
    expect(copiedNodes).toHaveLength(2);
    const copiedRoot = copiedNodes.find(
      (element) => isMindmapNodeElement(element) && element.role === "root",
    ) as ExcalidrawMindmapNodeElement | undefined;
    expect(copiedRoot).toBeDefined();
    expect(
      h.app.scene
        .getNonDeletedElements()
        .filter(
          (element) =>
            isMindmapEdgeElement(element) &&
            element.graphId === copiedRoot!.graphId,
        ),
    ).toHaveLength(1);
  });

  it("duplicates collapsed descendants and mixed Mindmap graphs", () => {
    addSecondGraph();
    API.updateElement(node("a"), { collapsed: true });
    const secondChild = h.app.scene.getNonDeletedElement("child-2")!;
    API.setSelectedElements([node("a"), secondChild]);

    act(() => {
      h.app.actionManager.executeAction(actionDuplicateSelection);
    });

    const originalGraphIds = new Set(["graph", "graph-2"]);
    const copiedNodes = h.app.scene
      .getNonDeletedElements()
      .filter(isMindmapNodeElement)
      .filter((element) => !originalGraphIds.has(element.graphId));
    expect(copiedNodes).toHaveLength(3);
    expect(new Set(copiedNodes.map((element) => element.graphId))).toHaveLength(
      2,
    );
    expect(copiedNodes.filter((element) => element.collapsed)).toHaveLength(1);
    expect(
      h.app.scene
        .getNonDeletedElements()
        .filter(
          (element) =>
            isMindmapEdgeElement(element) &&
            copiedNodes.some((node) => node.id === element.childId) &&
            !copiedNodes.some((node) => node.id === element.parentId),
        ),
    ).toHaveLength(0);
  });

  it("locks a selected Mindmap as one unit and blocks indirect edits", () => {
    API.setSelectedElements([node("root")]);
    act(() => {
      h.app.actionManager.executeAction(actionToggleElementLock);
    });

    expect(
      h.app.scene
        .getNonDeletedElements()
        .filter(isMindmapNodeElement)
        .every((element) => element.locked),
    ).toBe(true);

    const before = snapshot();
    API.setSelectedElements([node("a")]);
    act(() => h.app.mindmap.createSibling("a"));
    expect(snapshot()).toBe(before);

    act(() => {
      h.app.actionManager.executeAction(actionToggleElementLock);
    });
    expect(
      h.app.scene
        .getNonDeletedElements()
        .filter(isMindmapNodeElement)
        .every((element) => !element.locked),
    ).toBe(true);
  });

  it("copies a root node as a complete new Mindmap with Alt-drag", () => {
    API.setSelectedElements([node("root")]);
    const originalGraphIds = new Set(
      h.app.scene
        .getNonDeletedElements()
        .filter(isMindmapNodeElement)
        .map((element) => element.graphId),
    );
    const mouse = new Pointer("mouse");

    Keyboard.withModifierKeys({ alt: true }, () => {
      mouse.downAt(node("root").x + 20, node("root").y + 20);
      mouse.moveTo(node("root").x + 100, node("root").y + 80);
      mouse.moveTo(node("root").x + 140, node("root").y + 100);
      mouse.upAt();
    });

    const copiedNodes = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          element.type === "mindmap-node" &&
          !originalGraphIds.has(
            (element as ExcalidrawMindmapNodeElement).graphId,
          ),
      );
    expect(copiedNodes).toHaveLength(5);
    const copiedRoot = copiedNodes.find(
      (element) => (element as ExcalidrawMindmapNodeElement).role === "root",
    ) as ExcalidrawMindmapNodeElement | undefined;
    expect(copiedRoot).toBeDefined();
    const copiedIndex = buildMindmapGraphIndex(
      h.app.scene.getNonDeletedElements(),
      copiedRoot!.graphId,
    );
    expect(copiedIndex.nodes.size).toBe(5);
    expect(copiedIndex.edgeByChildId.size).toBe(4);
  });

  it("does not copy multiple selected non-root branches with Alt-drag", () => {
    API.setSelectedElements([node("a"), node("b")]);
    const before = snapshot();
    const mouse = new Pointer("mouse");

    Keyboard.withModifierKeys({ alt: true }, () => {
      mouse.downAt(node("a").x + 20, node("a").y + 20);
      mouse.moveTo(node("a").x + 100, node("a").y + 80);
      mouse.upAt();
    });

    expect(snapshot()).toBe(before);
  });

  it("uses the generic Alt-drag path for a complete selected Mindmap", () => {
    const graphElements = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          isMindmapNodeElement(element) ||
          isMindmapEdgeElement(element) ||
          (element.type === "text" && element.containerId !== null),
      );
    API.setSelectedElements(graphElements);
    expect(h.app.mindmap.isCompleteMindmapSelection()).toBe(true);
    const originalGraphIds = new Set(
      graphElements
        .filter(isMindmapNodeElement)
        .map((element) => element.graphId),
    );
    const mouse = new Pointer("mouse");

    Keyboard.withModifierKeys({ alt: true }, () => {
      mouse.downAt(node("root").x + 20, node("root").y + 20);
      mouse.moveTo(node("root").x + 100, node("root").y + 80);
      expect(
        h.app.scene
          .getNonDeletedElements()
          .filter(
            (element) =>
              isMindmapNodeElement(element) &&
              !originalGraphIds.has(element.graphId),
          ),
      ).toHaveLength(5);
      expect(h.app.mindmap.isCompleteMindmapSelection()).toBe(true);
      mouse.moveTo(node("root").x + 140, node("root").y + 100);
      mouse.upAt();
    });

    const copiedNodes = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          isMindmapNodeElement(element) &&
          !originalGraphIds.has(element.graphId),
      );
    expect(copiedNodes).toHaveLength(5);
  });

  it("selects every node, edge and bound label when boxing the full graph", () => {
    const graphElements = h.app.scene
      .getNonDeletedElements()
      .filter((element) => element.id !== "rectangle");
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

    graphElements.forEach((element) => {
      expect(h.state.selectedElementIds[element.id]).toBe(true);
    });
  });

  it("treats descendants of a boxed collapsed parent as selected", () => {
    API.updateElement(node("a"), { collapsed: true });
    const visibleElements = h.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          element.id !== "rectangle" &&
          element.id !== "a1" &&
          element.id !== "a1-text",
      );
    const mouse = new Pointer("mouse");
    mouse.downAt(50, 50);
    mouse.moveTo(60, 60);
    mouse.moveTo(
      Math.max(...visibleElements.map((element) => element.x + element.width)) +
        30,
      Math.max(
        ...visibleElements.map((element) => element.y + element.height),
      ) + 30,
    );
    mouse.upAt();

    expect(h.state.selectedElementIds.a1).toBe(true);
    expect(h.state.selectedElementIds["a1-text"]).toBe(true);
    h.app.scene.getNonDeletedElements().forEach((element) => {
      if (element.type === "mindmap-edge") {
        expect(h.state.selectedElementIds[element.id]).toBe(true);
      }
    });

    const hiddenBefore = { x: node("a1").x, y: node("a1").y };
    mouse.downAt(node("root").x + 20, node("root").y + 20);
    mouse.moveTo(node("root").x + 100, node("root").y + 80);
    mouse.upAt();
    expect(node("a1")).toMatchObject({
      x: hiddenBefore.x + 80,
      y: hiddenBefore.y + 60,
    });
  });

  it("drags a boxed Mindmap and rectangle from the rectangle", () => {
    const elements = h.app.scene.getNonDeletedElements();
    const positions = new Map(
      elements.map((element) => [element.id, { x: element.x, y: element.y }]),
    );
    const mouse = new Pointer("mouse");
    mouse.downAt(50, 50);
    mouse.moveTo(60, 60);
    mouse.moveTo(
      Math.max(...elements.map((element) => element.x + element.width)) + 30,
      Math.max(...elements.map((element) => element.y + element.height)) + 30,
    );
    mouse.upAt();
    expect(h.app.mindmap.isCompleteMindmapSelection()).toBe(true);

    const rectangle = h.app.scene.getNonDeletedElement("rectangle")!;
    mouse.downAt(rectangle.x + 20, rectangle.y + 20);
    mouse.moveTo(rectangle.x + 100, rectangle.y + 80);
    mouse.upAt();

    elements.forEach((element) => {
      expect(h.app.scene.getNonDeletedElement(element.id)).toMatchObject({
        x: positions.get(element.id)!.x + 80,
        y: positions.get(element.id)!.y + 60,
      });
    });
  });
});
