import {
  fixBindingsAfterDeletion,
  getContainingFrame,
} from "@excalidraw/element";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { act, render } from "../tests/test-utils";

import {
  actionBindText,
  actionUnbindText,
  actionWrapTextInContainer,
} from "./actionBoundText";

const { h } = window;

describe("bound text frame membership", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("inherits the host frame when binding free text", () => {
    const targetFrame = API.createElement({ type: "frame" });
    const sourceFrame = API.createElement({ type: "frame" });
    const host = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: targetFrame.id },
    });
    const text = API.createElement({
      type: "text",
      text: "Label",
      containerRef: { kind: "frameLike", elementId: sourceFrame.id },
    });
    API.setElements([targetFrame, sourceFrame, host, text]);
    API.setSelectedElements([host, text]);

    act(() => {
      h.app.actionManager.executeAction(actionBindText);
    });

    expect(text.containerId).toBe(host.id);
    expect(text.containerRef).toBeUndefined();
    expect(
      getContainingFrame(text, h.app.scene.getNonDeletedElementsMap()),
    ).toBe(targetFrame);
  });

  it("keeps the frame on the new host when wrapping free text", () => {
    const frame = API.createElement({ type: "frame" });
    const text = API.createElement({
      type: "text",
      text: "Label",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });
    API.setElements([frame, text]);
    API.setSelectedElements([text]);

    act(() => {
      h.app.actionManager.executeAction(actionWrapTextInContainer);
    });

    const host = h.elements.find((element) =>
      element.boundElements?.some((binding) => binding.id === text.id),
    );
    expect(host?.containerRef).toEqual({
      kind: "frameLike",
      elementId: frame.id,
    });
    expect(text.containerId).toBe(host?.id);
    expect(text.containerRef).toBeUndefined();
  });

  it("preserves frame membership when unbinding text", () => {
    const frame = API.createElement({ type: "frame" });
    const host = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
      boundElements: [{ type: "text", id: "label" }],
    });
    const text = API.createElement({
      id: "label",
      type: "text",
      text: "Label",
      containerId: host.id,
    });
    API.setElements([frame, host, text]);
    API.setSelectedElements([host]);

    act(() => {
      h.app.actionManager.executeAction(actionUnbindText);
    });

    expect(text.containerId).toBeNull();
    expect(text.containerRef).toEqual({
      kind: "frameLike",
      elementId: frame.id,
    });
  });

  it("preserves frame membership when a bound text host is deleted", () => {
    const frame = API.createElement({ type: "frame" });
    const host = API.createElement({
      type: "rectangle",
      isDeleted: true,
      containerRef: { kind: "frameLike", elementId: frame.id },
      boundElements: [{ type: "text", id: "label" }],
    });
    const text = API.createElement({
      id: "label",
      type: "text",
      text: "Label",
      containerId: host.id,
    });

    fixBindingsAfterDeletion([frame, host, text], [host]);

    expect(text.containerId).toBeNull();
    expect(text.containerRef).toEqual({
      kind: "frameLike",
      elementId: frame.id,
    });
  });
});
