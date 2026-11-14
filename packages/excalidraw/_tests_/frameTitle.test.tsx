import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react-dom/test-utils";

import { FRAME_STYLE, TABLE_TITLE_OFFSET_Y } from "@excalidraw/common";

import { getElementTitleLayout } from "../renderer/elementTitle";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import {
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  unmountComponent,
} from "./test-utils";

unmountComponent();

const { h } = window;

const clientPointAtTitle = (element: {
  x: number;
  y: number;
  width: number;
}) => {
  const layout = getElementTitleLayout(element as any, {
    zoom: h.state.zoom.value,
  });
  return {
    clientX:
      (layout.x + layout.width / 2 + h.state.scrollX) * h.state.zoom.value +
      h.state.offsetLeft,
    clientY:
      (layout.y + layout.height / 2 + h.state.scrollY) * h.state.zoom.value +
      h.state.offsetTop,
  };
};

describe("element titles are canvas chrome", () => {
  beforeEach(async () => {
    localStorage.clear();
    mockBoundingClientRect();
    await render(<Excalidraw />);
  });

  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
  });

  it.each([
    ["frame", "Flow", FRAME_STYLE.nameOffsetY],
    ["table", "Budget", TABLE_TITLE_OFFSET_Y],
  ] as const)(
    "draws no DOM label and starts the rename editor on %s double-click",
    async (type, name, offsetY) => {
      const element = API.createElement({
        type,
        x: 20,
        y: 30,
        width: 120,
        height: 80,
      });
      API.setElements([element]);
      API.updateElement(element, { name });

      expect(document.querySelector(".element-title")).toBe(null);

      const layout = getElementTitleLayout(API.getElement(element) as any, {
        zoom: h.state.zoom.value,
      });
      expect(layout.y).toBeCloseTo(
        element.y - offsetY / h.state.zoom.value - layout.height,
      );

      act(() => {
        fireEvent.doubleClick(
          GlobalTestState.interactiveCanvas,
          clientPointAtTitle(API.getElement(element) as any),
        );
      });

      expect(h.state.editingElementTitle).toBe(element.id);
      expect(
        await waitFor(() => document.querySelector(".element-title input")),
      ).not.toBeNull();
    },
  );

  it.each(["frame", "table"] as const)(
    "aligns the %s rename editor with the canvas title metrics",
    async (type) => {
      const element = API.createElement({
        type,
        x: 20,
        y: 30,
        width: 120,
        height: 80,
      });
      API.setElements([element]);
      API.updateElement(element, { name: "Flow" });

      act(() => {
        h.setState({ editingElementTitle: element.id });
      });

      const input = await waitFor(() => {
        const node =
          GlobalTestState.renderResult.container.querySelector<HTMLInputElement>(
            ".element-title input",
          );
        expect(node).not.toBeNull();
        return node!;
      });

      const zoom = h.state.zoom.value;
      const layout = getElementTitleLayout(API.getElement(element) as any, {
        zoom,
      });
      const glyphAndGap = (layout.glyphSize + layout.glyphGap) * zoom;
      const titleLineHeight =
        FRAME_STYLE.nameFontSize * FRAME_STYLE.nameLineHeight;

      expect(input.style.fontWeight).toBe("500");
      expect(input.style.lineHeight).toBe(`${titleLineHeight}px`);
      expect(input.style.height).toBe(`${titleLineHeight}px`);
      // The glyph slot is painted by the editor instead of left blank.
      const glyph = input.parentElement!.querySelector("svg")!;
      expect(glyph).not.toBeNull();
      expect(glyph.getAttribute("width")).toBe("10");
      expect(glyph.getAttribute("height")).toBe("10");
      expect(parseFloat(glyph.style.top)).toBeCloseTo(
        12 + (titleLineHeight - 10) / 2,
      );
      // The text stays on the title's origin, past the reserved glyph slot.
      expect(parseFloat(input.style.paddingLeft)).toBeCloseTo(glyphAndGap + 6);
      expect(parseFloat(input.style.width)).toBeCloseTo(
        (layout.width - layout.glyphSize - layout.glyphGap) * zoom,
      );
      expect(input.hasAttribute("size")).toBe(false);
    },
  );

  it("keeps table titles screen-fixed across zoom", () => {
    const table = API.createElement({
      type: "table",
      x: 20,
      y: 30,
      width: 120,
      height: 80,
    });
    API.setElements([table]);

    const atOne = getElementTitleLayout(API.getElement(table) as any, {
      zoom: 1,
    });
    const atTwo = getElementTitleLayout(API.getElement(table) as any, {
      zoom: 2,
    });

    expect(atOne.text).toBe("Table");
    expect(atTwo.height * 2).toBeCloseTo(atOne.height);
    expect(atTwo.y).toBeCloseTo(
      table.y - TABLE_TITLE_OFFSET_Y / 2 - atTwo.height,
    );
  });
});
