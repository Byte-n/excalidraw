import React from "react";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { act, assertElements, render } from "../tests/test-utils";

import { actionDeleteSelected } from "./actionDeleteSelected";

const { h } = window;

describe("deleting a selected frame deletes its descendants", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("frame only", async () => {
    const f1 = API.createElement({
      type: "frame",
    });

    const r1 = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: f1.id },
    });

    API.setElements([f1, r1]);

    API.setSelectedElements([f1]);

    act(() => {
      h.app.actionManager.executeAction(actionDeleteSelected);
    });

    assertElements(h.elements, [
      { id: f1.id, isDeleted: true },
      { id: r1.id, isDeleted: true },
    ]);
    expect(h.app.state.selectedElementIds).toEqual({});
  });

  it("frame + text container", async () => {
    const f1 = API.createElement({
      type: "frame",
    });

    const r1 = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: f1.id },
    });

    const t1 = API.createElement({
      type: "text",
      width: 200,
      height: 100,
      fontSize: 20,
      containerId: r1.id,
      containerRef: undefined,
    });

    h.app.scene.mutateElement(r1, {
      boundElements: [{ type: "text", id: t1.id }],
    });

    API.setElements([f1, r1, t1]);

    API.setSelectedElements([f1]);

    act(() => {
      h.app.actionManager.executeAction(actionDeleteSelected);
    });

    assertElements(h.elements, [
      { id: f1.id, isDeleted: true },
      { id: r1.id, isDeleted: true },
      { id: t1.id, isDeleted: true },
    ]);
    expect(h.app.state.selectedElementIds).toEqual({});
  });

  it("frame + text container (text selected too)", async () => {
    const f1 = API.createElement({
      type: "frame",
    });

    const r1 = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: f1.id },
    });

    const t1 = API.createElement({
      type: "text",
      width: 200,
      height: 100,
      fontSize: 20,
      containerId: r1.id,
      containerRef: undefined,
    });

    h.app.scene.mutateElement(r1, {
      boundElements: [{ type: "text", id: t1.id }],
    });

    API.setElements([f1, r1, t1]);

    API.setSelectedElements([f1, t1]);

    act(() => {
      h.app.actionManager.executeAction(actionDeleteSelected);
    });

    assertElements(h.elements, [
      { id: f1.id, isDeleted: true },
      { id: r1.id, isDeleted: true },
      { id: t1.id, isDeleted: true },
    ]);
    expect(h.app.state.selectedElementIds).toEqual({});
  });

  it("frame + labeled arrow", async () => {
    const f1 = API.createElement({
      type: "frame",
    });

    const a1 = API.createElement({
      type: "arrow",
      containerRef: { kind: "frameLike", elementId: f1.id },
    });

    const t1 = API.createElement({
      type: "text",
      width: 200,
      height: 100,
      fontSize: 20,
      containerId: a1.id,
      containerRef: undefined,
    });

    h.app.scene.mutateElement(a1, {
      boundElements: [{ type: "text", id: t1.id }],
    });

    API.setElements([f1, a1, t1]);

    API.setSelectedElements([f1, t1]);

    act(() => {
      h.app.actionManager.executeAction(actionDeleteSelected);
    });

    assertElements(h.elements, [
      { id: f1.id, isDeleted: true },
      { id: a1.id, isDeleted: true },
      { id: t1.id, isDeleted: true },
    ]);
    expect(h.app.state.selectedElementIds).toEqual({});
  });

  it("frame + children selected", async () => {
    const f1 = API.createElement({
      type: "frame",
    });
    const r1 = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: f1.id },
    });
    API.setElements([f1, r1]);

    API.setSelectedElements([f1, r1]);

    act(() => {
      h.app.actionManager.executeAction(actionDeleteSelected);
    });

    assertElements(h.elements, [
      { id: f1.id, isDeleted: true },
      { id: r1.id, isDeleted: true },
    ]);
    expect(h.app.state.selectedElementIds).toEqual({});
  });

  it("preserves elements outside the frame", async () => {
    const frame = API.createElement({ type: "frame" });
    const child = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    const unrelated = API.createElement({ type: "rectangle" });
    API.setElements([frame, child, unrelated]);
    API.setSelectedElements([frame]);

    act(() => {
      h.app.actionManager.executeAction(actionDeleteSelected);
    });

    assertElements(h.elements, [
      { id: frame.id, isDeleted: true },
      { id: child.id, isDeleted: true },
      { id: unrelated.id, isDeleted: false },
    ]);
    expect(h.app.state.selectedElementIds).toEqual({});
  });
});
