import { API } from "@excalidraw/excalidraw/_tests_/helpers/api";

import {
  getSelectedElements,
  makeNextSelectedElementIds,
} from "../src/selection";

describe("frame selection", () => {
  it("includes elements inside the selected frame", () => {
    const frame = API.createElement({ type: "frame" });
    const owner = API.createElement({
      type: "rectangle",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    const selected = getSelectedElements(
      [frame, owner],
      { selectedElementIds: { [frame.id]: true } },
      { includeElementsInFrames: true },
    );

    expect(selected.map((element) => element.id)).toEqual([
      frame.id,
      owner.id,
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
