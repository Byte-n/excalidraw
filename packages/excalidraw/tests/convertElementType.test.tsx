import { ROUNDNESS } from "@excalidraw/common";
import {
  isMindmapEdgeElement,
  isMindmapNodeElement,
  isTextElement,
} from "@excalidraw/element";

import type { FractionalIndex } from "@excalidraw/element/types";

import { convertElementTypes } from "../components/ConvertElementTypePopup";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

const { h } = window;

describe("convert element type", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  // #9662
  it("recalculates roundness type when switching between generic shapes", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS }, // Dooesn't matter as long as it is set
    });

    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "diamond",
      });
    });

    expect(h.elements[0].type).toBe("diamond");
    expect(h.elements[0].roundness?.type).toBe(ROUNDNESS.PROPORTIONAL_RADIUS);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "rectangle",
      });
    });

    expect(h.elements[0].type).toBe("rectangle");
    expect(h.elements[0].roundness?.type).toBe(ROUNDNESS.ADAPTIVE_RADIUS);
  });

  it("converts a complete Mindmap into editable ordinary shapes and lines", () => {
    const root = API.createElement({
      type: "mindmap-node",
      id: "root",
      mindmap: {
        graphId: "graph",
        parentId: null,
        order: null,
        shape: "rectangle",
        collapsed: false,
      },
    });
    const child = API.createElement({
      type: "mindmap-node",
      id: "child",
      mindmap: {
        graphId: "graph",
        parentId: "root",
        order: "a0" as FractionalIndex,
        shape: "rectangle",
        collapsed: false,
      },
    });
    const edge = API.createElement({
      type: "mindmap-edge",
      id: "edge",
      mindmap: {
        graphId: "graph",
        parentId: "root",
        childId: "child",
        routing: "orthogonal",
      },
    });
    const text = API.createElement({
      type: "text",
      id: "root-text",
      text: "Root",
      containerId: root.id,
    });
    API.setElements([root, child, edge, text]);
    API.setSelectedElements([root]);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "rectangle",
      });
    });

    expect(h.app.scene.getNonDeletedElements().some(isMindmapNodeElement)).toBe(
      false,
    );
    expect(h.app.scene.getNonDeletedElements().some(isMindmapEdgeElement)).toBe(
      false,
    );
    expect(h.app.scene.getNonDeletedElement("root")?.type).toBe("rectangle");
    expect(h.app.scene.getNonDeletedElement("child")?.type).toBe("rectangle");
    expect(h.app.scene.getNonDeletedElement("edge")?.type).toBe("line");
    const rootText = h.app.scene.getNonDeletedElement("root-text");
    expect(isTextElement(rootText) && rootText.containerId).toBe("root");
  });

  it("promotes a converted node's children to the original parent", () => {
    const root = API.createElement({
      type: "mindmap-node",
      id: "root",
      mindmap: {
        graphId: "graph",
        parentId: null,
        order: null,
        shape: "rectangle",
        collapsed: false,
      },
    });
    const branch = API.createElement({
      type: "mindmap-node",
      id: "branch",
      mindmap: {
        graphId: "graph",
        parentId: "root",
        order: "a0" as FractionalIndex,
        shape: "rectangle",
        collapsed: false,
      },
    });
    const leaf = API.createElement({
      type: "mindmap-node",
      id: "leaf",
      mindmap: {
        graphId: "graph",
        parentId: "branch",
        order: "a0" as FractionalIndex,
        shape: "rectangle",
        collapsed: false,
      },
    });
    const incoming = API.createElement({
      type: "mindmap-edge",
      id: "incoming",
      mindmap: {
        graphId: "graph",
        parentId: "root",
        childId: "branch",
        routing: "orthogonal",
      },
    });
    const outgoing = API.createElement({
      type: "mindmap-edge",
      id: "outgoing",
      mindmap: {
        graphId: "graph",
        parentId: "branch",
        childId: "leaf",
        routing: "orthogonal",
      },
    });
    API.setElements([root, branch, leaf, incoming, outgoing]);
    API.setSelectedElements([branch]);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "ellipse",
      });
    });

    expect(h.app.scene.getNonDeletedElement("branch")?.type).toBe("ellipse");
    const promotedLeaf = h.app.scene.getNonDeletedElement("leaf");
    expect(isMindmapNodeElement(promotedLeaf) && promotedLeaf.parentId).toBe(
      "root",
    );
    expect(h.app.scene.getElement("incoming")?.isDeleted).toBe(true);
    expect(h.app.scene.getNonDeletedElement("outgoing")).toMatchObject({
      type: "mindmap-edge",
      parentId: "root",
      childId: "leaf",
    });
  });
});
