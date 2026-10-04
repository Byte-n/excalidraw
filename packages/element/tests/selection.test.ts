import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  getSelectedElements,
  makeNextSelectedElementIds,
} from "../src/selection";

describe("frame selection", () => {
  it("includes bound text through its selected frame child", () => {
    const frame = API.createElement({ type: "frame" });
    const owner = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
      boundElements: [{ type: "text", id: "label" }],
    });
    const label = API.createElement({
      id: "label",
      type: "text",
      containerId: owner.id,
    });

    const selected = getSelectedElements(
      [frame, owner, label],
      { selectedElementIds: { [frame.id]: true } },
      { includeBoundTextElement: true, includeElementsInFrames: true },
    );

    expect(selected.map((element) => element.id)).toEqual([
      frame.id,
      owner.id,
      label.id,
    ]);
  });
});

describe("makeNextSelectedElementIds", () => {
  const _makeNextSelectedElementIds = (
    selectedElementIds: { [id: string]: true },
    prevSelectedElementIds: { [id: string]: true },
    expectUpdated: boolean,
  ) => {
    const ret = makeNextSelectedElementIds(selectedElementIds, {
      selectedElementIds: prevSelectedElementIds,
    });
    expect(ret === selectedElementIds).toBe(expectUpdated);
  };
  it("should return prevState selectedElementIds if no change", () => {
    _makeNextSelectedElementIds({}, {}, false);
    _makeNextSelectedElementIds({ 1: true }, { 1: true }, false);
    _makeNextSelectedElementIds(
      { 1: true, 2: true },
      { 1: true, 2: true },
      false,
    );
  });
  it("should return new selectedElementIds if changed", () => {
    // _makeNextSelectedElementIds({ 1: true }, { 1: false }, true);
    _makeNextSelectedElementIds({ 1: true }, {}, true);
    _makeNextSelectedElementIds({}, { 1: true }, true);
    _makeNextSelectedElementIds({ 1: true }, { 2: true }, true);
    _makeNextSelectedElementIds({ 1: true }, { 1: true, 2: true }, true);
    _makeNextSelectedElementIds(
      { 1: true, 2: true },
      { 1: true, 3: true },
      true,
    );
  });
});
