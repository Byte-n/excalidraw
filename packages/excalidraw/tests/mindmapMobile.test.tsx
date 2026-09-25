import { newMindmapNodeElement, newTextElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
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
});
