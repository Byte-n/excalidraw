import React from "react";

import { vi } from "vitest";

import type { FractionalIndex } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

const { h } = window;

const spySetViewport = () =>
  vi.spyOn(h.app.viewport, "setViewport").mockImplementation(() => {});

describe("revealElement", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false for unknown and deleted elements", () => {
    const deleted = API.createElement({
      type: "rectangle",
      isDeleted: true,
    });
    API.setElements([deleted]);
    const setViewport = spySetViewport();

    act(() => {
      expect(h.app.api.revealElement("missing")).toBe(false);
      expect(h.app.api.revealElement(deleted.id)).toBe(false);
    });

    expect(setViewport).not.toHaveBeenCalled();
  });

  it("returns false for hidden mindmap nodes", () => {
    const root = API.createElement({
      type: "mindmap-node",
      x: 0,
      y: 0,
      mindmap: {
        graphId: "graph-1",
        parentId: null,
        order: null,
        collapsed: true,
        shape: { id: "rectangle", schemaVersion: 1 },
      },
      texts: API.mindmapBody({ role: "root" }, "root label"),
    });
    const child = API.createElement({
      type: "mindmap-node",
      x: 0,
      y: 100,
      mindmap: {
        graphId: "graph-1",
        parentId: root.id,
        order: "a1" as FractionalIndex,
        collapsed: false,
        shape: { id: "rectangle", schemaVersion: 1 },
      },
      texts: API.mindmapBody({ role: "node" }, "hidden child"),
    });
    API.setElements([root, child]);
    const setViewport = spySetViewport();

    act(() => {
      expect(h.app.api.revealElement(child.id)).toBe(false);
    });

    expect(h.app.scene.getMindmapHiddenElementIds().has(child.id)).toBe(true);
    expect(setViewport).not.toHaveBeenCalled();
    expect(h.app.state.selectedElementIds).toEqual({});
  });

  it("selects a valid element and reveals it with default options", () => {
    const element = API.createElement({ type: "rectangle", x: 100, y: 200 });
    API.setElements([element]);
    const sceneElement = h.app.scene.getNonDeletedElement(element.id)!;
    const setViewport = spySetViewport();

    let revealed = false;
    act(() => {
      revealed = h.app.api.revealElement(element.id);
    });

    expect(revealed).toBe(true);
    expect(h.app.state.selectedElementIds).toEqual({ [element.id]: true });
    expect(h.app.state.selectedGroupIds).toEqual({});
    expect(h.app.state.editingGroupId).toBeNull();

    expect(setViewport).toHaveBeenCalledTimes(1);
    const options = setViewport.mock.calls[0][0]!;
    expect(options.target).toBe(sceneElement);
    expect(options.fit).toBe("scale-down");
    expect(options.animation).toEqual({ duration: 300 });
    expect(options.offsets).toEqual({ ui: true });
  });

  it("keeps the current selection when select is false", () => {
    const selected = API.createElement({ type: "rectangle", x: 0, y: 0 });
    const target = API.createElement({ type: "rectangle", x: 300, y: 0 });
    API.setElements([selected, target]);
    API.setSelectedElements([h.app.scene.getNonDeletedElement(selected.id)!]);
    const setViewport = spySetViewport();

    act(() => {
      expect(h.app.api.revealElement(target.id, { select: false })).toBe(true);
    });

    expect(h.app.state.selectedElementIds).toEqual({ [selected.id]: true });
    expect(setViewport).toHaveBeenCalledTimes(1);
  });

  it("passes custom fit, animation and offsets through", () => {
    const element = API.createElement({ type: "rectangle" });
    API.setElements([element]);
    const setViewport = spySetViewport();

    act(() => {
      expect(
        h.app.api.revealElement(element.id, {
          select: false,
          fit: "contain",
          animation: false,
          offsets: { top: 40 },
        }),
      ).toBe(true);
    });

    const options = setViewport.mock.calls[0][0]!;
    expect(options.fit).toBe("contain");
    expect(options.animation).toBe(false);
    expect(options.offsets).toEqual({ top: 40 });
  });

  it("does not write the scene", () => {
    const element = API.createElement({ type: "rectangle" });
    API.setElements([element]);
    const before = h.app.getSceneElementsIncludingDeleted();
    const nonce = h.app.scene.getSceneNonce();
    spySetViewport();

    act(() => {
      expect(h.app.api.revealElement(element.id)).toBe(true);
    });

    expect(h.app.getSceneElementsIncludingDeleted()).toEqual(before);
    expect(h.app.scene.getSceneNonce()).toBe(nonce);
  });
});
