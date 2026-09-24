import React from "react";

import { isMindmapNodeElement, isTextElement } from "@excalidraw/element";

import { createPasteEvent } from "../clipboard";
import { Excalidraw } from "../index";

import {
  GlobalTestState,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

const clipboardJSON = JSON.stringify({
  type: "excalidraw/clipboard",
  elements: [
    {
      id: "independent",
      type: "mindmap-node",
      x: -617.8776744492982,
      y: 372.300930042353,
      width: 200,
      height: 64,
      graphId: "independent",
      role: "root",
      parentId: null,
      order: null,
      collapsed: false,
      shape: "pill",
      backgroundColor: "#b2f2bb",
      fillStyle: "solid",
      roughness: 0,
      strokeWidth: 2,
      boundElements: [{ type: "text", id: "independent-text" }],
      version: 7,
      versionNonce: 1425250096,
      index: "a7",
      isDeleted: false,
      strokeStyle: "solid",
      opacity: 100,
      angle: 0,
      strokeColor: "#1e1e1e",
      seed: 1,
      groupIds: [],
      frameId: null,
      roundness: null,
      updated: 1790254703877,
      created: null,
      link: null,
      locked: false,
    },
    {
      id: "independent-text",
      type: "text",
      x: -598.0883525679529,
      y: 391.67351304438347,
      width: 160,
      height: 25,
      text: "独立叶子根节点",
      originalText: "独立叶子根节点",
      fontSize: 20,
      fontFamily: 2,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: "independent",
      lineHeight: 1.25,
      version: 8,
      versionNonce: 1604493776,
      index: "aF",
      isDeleted: false,
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      seed: 1,
      groupIds: [],
      frameId: null,
      roundness: null,
      boundElements: [],
      updated: 1790254727519,
      created: null,
      link: null,
      locked: false,
      autoResize: true,
      labelPosition: null,
      baseFontSize: null,
    },
  ],
  files: {},
});

describe("pasting a standalone mindmap pill", () => {
  beforeEach(async () => {
    unmountComponent();
    localStorage.clear();
    await render(<Excalidraw autoFocus handleKeyboardGlobally />);
    Object.assign(h.app.ownerDocument, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
  });

  it("preserves the pasted node shape and its bound text", async () => {
    h.app.ownerDocument.dispatchEvent(
      createPasteEvent({ types: { "text/plain": clipboardJSON } }),
    );

    await waitFor(() => {
      expect(h.app.scene.getNonDeletedElements()).toHaveLength(2);
    });

    const elements = h.app.scene.getNonDeletedElements();
    const pastedNode = elements.find(isMindmapNodeElement);
    const pastedText = elements.find(isTextElement);

    expect(pastedNode).toMatchObject({
      type: "mindmap-node",
      role: "root",
      parentId: null,
      order: null,
      shape: "pill",
      roundness: null,
      width: 200,
      height: 64,
      backgroundColor: "#b2f2bb",
    });
    expect(pastedNode?.id).not.toBe("independent");
    expect(pastedNode?.graphId).not.toBe("independent");
    expect(pastedText).toMatchObject({
      type: "text",
      text: "独立叶子根节点",
      containerId: pastedNode?.id,
    });
    expect(pastedNode?.boundElements).toContainEqual({
      type: "text",
      id: pastedText?.id,
    });
  });
});
