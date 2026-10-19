import { fireEvent, queryByTestId } from "@testing-library/react";
import { isShapeWithId } from "@excalidraw/element";

import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  FREEDRAW_STROKE_WIDTH,
  FONT_FAMILY,
  STROKE_WIDTH,
} from "@excalidraw/common";

import { Excalidraw } from "../index";
import { API } from "../_tests_/helpers/api";
import { UI } from "../_tests_/helpers/ui";
import { render } from "../_tests_/test-utils";

// T3 起桌面/平板为浮动栏：填充/描边宽度/样式等在「样式」弹层，
// 字号/对齐在「文字属性」弹层（radix 弹层需要 ResizeObserver 桩）
const stubResizeObserver = () => {
  (global as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
};

const openStylesPopup = () => {
  stubResizeObserver();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>("[aria-label='Styles']")!,
  );
};

const openTextPropsPopup = () => {
  stubResizeObserver();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>("[aria-label='Text align']")!,
  );
};

const openFontPopup = () => {
  stubResizeObserver();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(
      "[data-testid='font-family-show-fonts']",
    )!,
  );
};

describe("element locking", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  describe("properties when tool selected", () => {
    // 注：形状工具（rectangle）在无选区时不再展示浮动栏（见 FloatingShapeActions
    // 的 TOOL_CONFIG_BAR_TOOLS），因此原有「rectangle 工具默认态下的外露色板
    // / 样式弹层填充」两条用例已随之失效并移除；下述 trivial 用例保留作为
    // 该路径不渲染的哨兵。
    it("should not show fill style when background transparent", () => {
      UI.clickTool("rectangle");

      API.setAppState({
        currentItemBackgroundColor: COLOR_PALETTE.transparent,
        currentItemFillStyle: "hachure",
      });
      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);

      expect(hachureFillButton).toBe(null);
    });

    it("should not show fill style for sticky note tool", () => {
      UI.clickTool("stickynote");

      API.setAppState({
        currentItemBackgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
        currentItemFillStyle: "hachure",
      });
      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);

      expect(hachureFillButton).toBe(null);
    });

    it("should show horizontal text align for text tool", () => {
      UI.clickTool("text");

      API.setAppState({
        currentItemTextAlign: "right",
      });

      openTextPropsPopup();
      const centerTextAlign = queryByTestId(document.body, `align-right`);
      expect(centerTextAlign).toBeChecked();
    });
  });

  describe("properties when elements selected", () => {
    it("should show active styles when single element selected", () => {
      const rect = API.createElement({
        type: "rectangle",
        backgroundColor: "red",
        fillStyle: "cross-hatch",
      });
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      openStylesPopup();
      const crossHatchButton = queryByTestId(document.body, `fill-cross-hatch`);
      expect(crossHatchButton).toHaveClass("active");
    });

    it("should not show fill style selected element's background is transparent", () => {
      const rect = API.createElement({
        type: "rectangle",
        backgroundColor: COLOR_PALETTE.transparent,
        fillStyle: "cross-hatch",
      });
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      const crossHatchButton = queryByTestId(document.body, `fill-cross-hatch`);
      expect(crossHatchButton).toBe(null);
    });

    it("should not show fill style for selected sticky note", () => {
      const stickyNote = API.createElement({
        type: "stickynote",
        backgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
        fillStyle: "hachure",
      });
      API.setElements([stickyNote]);
      API.setSelectedElements([stickyNote]);

      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);
      expect(hachureFillButton).toBe(null);
    });

    it("should paint a frame's board from the background picker", () => {
      // 画板底色默认透明，是元素属性（渲染器读 element.backgroundColor）
      const frame = API.createElement({
        type: "frame",
        backgroundColor: COLOR_PALETTE.transparent,
      });
      API.setElements([frame]);
      API.setSelectedElements([frame]);

      stubResizeObserver();
      fireEvent.click(
        document.querySelector<HTMLButtonElement>("[aria-label='Background']")!,
      );
      fireEvent.change(document.querySelector(".color-picker-input")!, {
        target: { value: "d3f9d8" },
      });
      expect(API.getSelectedElement().backgroundColor).toBe("#d3f9d8");
    });

    it("should not show fill style for a selected frame", () => {
      // 画板只开背景色：填充样式恒为实底，不出现在画板域内
      const frame = API.createElement({
        type: "frame",
        backgroundColor: "#d3f9d8",
        fillStyle: "hachure",
      });
      API.setElements([frame]);
      API.setSelectedElements([frame]);

      openStylesPopup();
      expect(queryByTestId(document.body, `fill-hachure`)).toBe(null);
    });

    it("should highlight common stroke width of selected elements", () => {
      const rect1 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const rect2 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      API.setElements([rect1, rect2]);
      API.setSelectedElements([rect1, rect2]);

      openStylesPopup();
      const thinStrokeWidthButton = queryByTestId(
        document.body,
        `strokeWidth-thin`,
      );
      expect(thinStrokeWidthButton).toBeChecked();
    });

    it("should highlight common stroke width key across freedraw and non-freedraw elements", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      const freedraw = API.createElement({
        type: "freedraw",
        strokeWidth: FREEDRAW_STROKE_WIDTH.medium,
      });
      API.setElements([rect, freedraw]);
      API.setSelectedElements([rect, freedraw]);

      openStylesPopup();
      expect(queryByTestId(document.body, `strokeWidth-medium`)).toBeChecked();
    });

    it("should apply stroke width by element type", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const freedraw = API.createElement({
        type: "freedraw",
        strokeWidth: FREEDRAW_STROKE_WIDTH.thin,
      });
      API.setElements([rect, freedraw]);
      API.setSelectedElements([rect, freedraw]);

      openStylesPopup();
      const boldStrokeWidthButton = queryByTestId(
        document.body,
        `strokeWidth-bold`,
      );
      expect(boldStrokeWidthButton).not.toBe(null);
      fireEvent.click(boldStrokeWidthButton!);

      const selectedElements = API.getSelectedElements();
      const selectedRect = selectedElements.find((element) =>
        isShapeWithId(element, "rectangle"),
      );
      const selectedFreedraw = selectedElements.find(
        (element) => element.type === "freedraw",
      );

      expect(selectedRect?.strokeWidth).toBe(STROKE_WIDTH.bold);
      expect(selectedFreedraw?.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.bold);
    });

    it("should create new elements with stroke width by element type", () => {
      // 形状/箭头读三档键状态；自由画笔读独立的像素笔宽状态，二者互不影响。
      API.setAppState({
        currentItemStrokeWidthKey: "bold",
        currentItemFreedrawStrokeWidth: FREEDRAW_STROKE_WIDTH.bold,
      });

      const rect = API.createElement({ type: "rectangle" });
      const freedraw = API.createElement({ type: "freedraw" });

      expect(rect.strokeWidth).toBe(STROKE_WIDTH.bold);
      expect(freedraw.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.bold);
    });

    it("should not highlight any stroke width button if no common style", () => {
      const rect1 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const rect2 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      API.setElements([rect1, rect2]);
      API.setSelectedElements([rect1, rect2]);

      openStylesPopup();
      expect(queryByTestId(document.body, `strokeWidth-thin`)).not.toBe(null);
      expect(
        queryByTestId(document.body, `strokeWidth-thin`),
      ).not.toBeChecked();
      expect(
        queryByTestId(document.body, `strokeWidth-medium`),
      ).not.toBeChecked();
      expect(
        queryByTestId(document.body, `strokeWidth-bold`),
      ).not.toBeChecked();
    });

    it("should show properties of different element types when selected", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      const text = API.createElement({
        type: "text",
        fontFamily: FONT_FAMILY["Comic Shanns"],
      });
      API.setElements([rect, text]);
      API.setSelectedElements([rect, text]);

      openStylesPopup();
      expect(queryByTestId(document.body, `strokeWidth-medium`)).toBeChecked();

      // 字体在字体弹层列表内（当前字体行尾选中态）
      openFontPopup();
      expect(
        document.querySelector(`button[value="${FONT_FAMILY["Comic Shanns"]}"]`)
          ?.className,
      ).toContain("dropdown-menu-item--selected");
    });
  });
});
