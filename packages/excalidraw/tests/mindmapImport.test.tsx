import {
  isMindmapEdgeElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import { Excalidraw } from "../index";

import { act, render, unmountComponent } from "./test-utils";
import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";

const { h } = window;

describe("mindmap text import", () => {
  afterEach(() => {
    unmountComponent();
  });

  it("creates an independent graph and removes it with one undo", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const before = h.app.scene.getNonDeletedElements();
    const historyLength = API.getUndoStack().length;

    act(() => {
      h.app.mindmap.importTextTree({
        text: "Product plan",
        children: [
          {
            text: "Research",
            children: [{ text: "Interviews", children: [] }],
          },
          { text: "Launch", children: [] },
        ],
      });
    });

    const imported = h.app.scene.getNonDeletedElements();
    expect(imported.filter(isMindmapNodeElement)).toHaveLength(4);
    expect(imported.filter(isMindmapEdgeElement)).toHaveLength(3);
    expect(imported.length).toBe(before.length + 4 * 2 + 3);
    expect(
      new Set(imported.filter(isMindmapNodeElement).map((node) => node.graphId))
        .size,
    ).toBe(1);
    expect(API.getUndoStack()).toHaveLength(historyLength + 1);

    Keyboard.undo();
    expect(h.app.scene.getNonDeletedElements()).toHaveLength(before.length);
    expect(API.getUndoStack()).toHaveLength(historyLength);
  });
});
