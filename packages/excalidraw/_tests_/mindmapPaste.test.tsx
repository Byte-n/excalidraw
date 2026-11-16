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
      shape: { id: "pill", schemaVersion: 1 },
      backgroundColor: "#b2f2bb",
      fillStyle: "solid",
      strokeWidth: 2,
      texts: {
        body: {
          text: "独立叶子根节点",
          style: {
            fontFamily: 2,
            fontSize: 20,
            lineHeight: 1.25,
            textAlign: "center",
            verticalAlign: "middle",
            color: "#1e1e1e",
          },
        },
      },
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
      containerRef: undefined,
      roundness: null,
      updated: 1790254703877,
      created: null,
      link: null,
      locked: false,
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

  it("preserves the pasted node shape and its body text", async () => {
    h.app.ownerDocument.dispatchEvent(
      createPasteEvent({ types: { "text/plain": clipboardJSON } }),
    );

    await waitFor(() => {
      expect(h.app.scene.getNonDeletedElements()).toHaveLength(1);
    });

    const elements = h.app.scene.getNonDeletedElements();
    const pastedNode = elements.find(isMindmapNodeElement);

    expect(pastedNode).toMatchObject({
      type: "mindmap-node",
      role: "root",
      parentId: null,
      order: null,
      shape: { id: "pill", schemaVersion: 1 },
      roundness: null,
      width: 200,
      height: 64,
      backgroundColor: "#b2f2bb",
      texts: { body: { text: "独立叶子根节点" } },
    });
    expect(pastedNode?.id).not.toBe("independent");
    expect(pastedNode?.graphId).not.toBe("independent");
    expect(elements.some(isTextElement)).toBe(false);
  });

  it("preserves the text shape and fontWeight through paste", async () => {
    h.app.ownerDocument.dispatchEvent(
      createPasteEvent({
        types: {
          "text/plain": JSON.stringify({
            type: "excalidraw/clipboard",
            elements: [
              {
                id: "leaf",
                type: "mindmap-node",
                x: 0,
                y: 0,
                width: 120,
                height: 32,
                graphId: "leafgraph",
                role: "root",
                parentId: null,
                order: null,
                collapsed: false,
                shape: { id: "text", schemaVersion: 1 },
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 1.5,
                texts: {
                  body: {
                    text: "下划线节点",
                    style: {
                      fontFamily: 1,
                      fontSize: 16,
                      fontWeight: 600,
                      lineHeight: 1.25,
                      textAlign: "center",
                      verticalAlign: "middle",
                      color: "#ffffff",
                    },
                  },
                },
                version: 1,
                versionNonce: 1,
                index: "a1",
                isDeleted: false,
                strokeStyle: "solid",
                opacity: 100,
                angle: 0,
                strokeColor: "#0e8c7e",
                seed: 1,
                groupIds: [],
                roundness: null,
                updated: 1,
                created: 1,
                link: null,
                locked: false,
              },
            ],
            files: {},
          }),
        },
      }),
    );

    await waitFor(() => {
      expect(h.app.scene.getNonDeletedElements()).toHaveLength(1);
    });

    const elements = h.app.scene.getNonDeletedElements();
    const pastedNode = elements.find(isMindmapNodeElement);
    expect(pastedNode).toMatchObject({
      shape: { id: "text", schemaVersion: 1 },
      strokeColor: "#0e8c7e",
      backgroundColor: "transparent",
      texts: { body: { style: { fontWeight: 600 } } },
    });
    expect(elements.some(isTextElement)).toBe(false);
  });
});
