import { queryByText } from "@testing-library/react";

import { pointFrom, type LocalPoint } from "@excalidraw/math";
import {
  LinearElementEditor,
  getLineHeightInPx,
  getLocalTextRegionLayout,
  getOriginalContainerHeightFromCache,
  getSequenceLifelineDefaultSize,
  getTextBlock,
  getTextElementDisplayText,
  getTextElementStyle,
  getTextElementText,
  getTextElementTextPatch,
  isSequenceLifelineElement,
  newElementWith,
  SEQUENCE_LIFELINE_HEAD_HEIGHTS,
} from "@excalidraw/element";

import {
  CODES,
  colorToHex,
  KEYS,
  FONT_FAMILY,
  TEXT_ALIGN,
  THEME,
  VERTICAL_ALIGN,
  applyDarkModeFilter,
  arrayToMap,
  getLineHeight,
} from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawShapeElement,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { exportToSvg } from "../scene/export";
import { API } from "../_tests_/helpers/api";
import { Keyboard, Pointer, UI } from "../_tests_/helpers/ui";
import { getTextEditor, updateTextEditor } from "../_tests_/queries/dom";
import {
  GlobalTestState,
  act,
  render,
  screen,
  unmountComponent,
} from "../_tests_/test-utils";
import {
  fireEvent,
  mockBoundingClientRect,
  restoreOriginalGetBoundingClientRect,
} from "../_tests_/test-utils";
import { actionSetCompositeShapeTextFitAuto } from "../actions/actionCompositeShapeTextFit";
import { actionTextAutoResize } from "../actions/actionTextAutoResize";

const { h } = window;

unmountComponent();

const tab = "    ";
const mouse = new Pointer("mouse");

/**
 * 图形家族的正文内嵌到元素自身的 `texts`；线条标签同样存放在 `texts.label`
 * 里，由区域布局排版。
 */
const createBoundTextContainer = (
  overrides: Partial<{
    x: number;
    y: number;
    angle: number;
    strokeWidth: number;
    containerRef: ExcalidrawElement["containerRef"];
  }> = {},
) =>
  API.createElement({
    type: "line",
    x: 10,
    y: 20,
    width: 90,
    height: 75,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(90, 75)],
    ...overrides,
  });

/** 始终读取场景里的最新元素，避免 fixture 在 replaceAllElements 后过期 */
const liveElement = <T extends ExcalidrawElement>(id: string) =>
  new Proxy({} as T, {
    get(_target, prop) {
      const live = h.elements.find((element) => element.id === id) as any;
      return live?.[prop];
    },
  });

// radix 弹层需要 ResizeObserver（jsdom 没有，同 test-utils 的 togglePopover）
const stubResizeObserver = () => {
  (global as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
};

// T3 起桌面/平板为浮动栏：字号/文字对齐/垂直对齐在「文字属性」弹层，
// 字体在字体弹层
const openTextPropsPopup = () => {
  stubResizeObserver();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>("[aria-label='Text align']")!,
  );
};

const exitTextEditorAndAssertSelection = async ({
  editor,
  selectedIds,
  nextText,
}: {
  editor: HTMLTextAreaElement;
  selectedIds: string[];
  nextText?: string;
}) => {
  if (nextText !== undefined) {
    updateTextEditor(editor, nextText);
  }

  await act(async () => {
    Keyboard.exitTextEditor(editor);
  });

  expect(await getTextEditor({ waitForEditor: false })).toBe(null);
  expect(window.h.state.editingTextElement).toBeNull();
  expect(API.getSelectedElements().map((element) => element.id)).toEqual(
    selectedIds,
  );
};

describe("textWysiwyg", () => {
  describe("start text editing", () => {
    const { h } = window;
    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      API.setElements([]);
    });

    it("should prefer editing selected text element (non-bindable container present)", async () => {
      const line = API.createElement({
        type: "line",
        width: 100,
        height: 0,
        points: [pointFrom(0, 0), pointFrom(100, 0)],
      });
      const textSize = 20;
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: line.width / 2 - textSize / 2,
        y: -textSize / 2,
        width: textSize,
        height: textSize,
      });
      API.setElements([text, line]);

      API.setSelectedElements([text]);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.state.editingTextElement?.id).toBe(text.id);
    });

    it("should open the embedded body region on ENTER without creating text", () => {
      const container = API.createElement({
        type: "df-process",
        width: 100,
        height: 80,
      });
      API.setElements([container]);
      API.setSelectedElements([container]);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: container.id,
        region: "body",
      });
      expect(h.state.editingTextElement).toBe(null);
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });

    it("should not create another text element when editing an embedded container twice", () => {
      const container = API.createElement({
        type: "df-process",
        width: 100,
        height: 80,
      });
      API.setElements([container]);
      API.setSelectedElements([container]);

      Keyboard.keyPress(KEYS.ENTER);
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.state.editingTextRegion?.target.elementId).toBe(container.id);
      expect(h.state.editingTextElement).toBe(null);
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });

    it("should edit text under cursor when clicked with text tool", async () => {
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: 60,
        y: 0,
        width: 100,
        height: 100,
      });

      API.setElements([text]);
      UI.clickTool("text");

      mouse.clickAt(text.x + 50, text.y + 50);

      const editor = await getTextEditor();

      expect(editor).not.toBe(null);
      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(h.elements.length).toBe(1);
    });

    it("should vertically center newly created text on the cursor when clicked with text tool", async () => {
      API.setAppState({
        currentItemFontFamily: FONT_FAMILY.Cascadia,
        currentItemFontSize: 40,
      });
      UI.clickTool("text");

      mouse.clickAt(120, 80);

      const editor = await getTextEditor();
      const text = h.elements[0] as ExcalidrawTextElement;
      const lineHeightPx = getLineHeightInPx(
        getTextElementStyle(text).fontSize,
        getTextElementStyle(text).lineHeight,
      );

      expect(editor).not.toBe(null);
      expect(text.y + lineHeightPx / 2).toBe(80);
    });

    it("should snap newly created text top-left to the current grid cell when clicked with text tool in grid mode", async () => {
      API.setAppState({
        currentItemFontFamily: FONT_FAMILY.Cascadia,
        currentItemFontSize: 40,
        gridModeEnabled: true,
        gridSize: 24,
      });
      UI.clickTool("text");

      mouse.clickAt(113, 86);

      const editor = await getTextEditor();
      const text = h.elements[0] as ExcalidrawTextElement;

      expect(editor).not.toBe(null);
      expect(text.x).toBe(96);
      expect(text.y).toBe(72);
    });

    it("should edit text under cursor when double-clicked with selection tool", async () => {
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: 60,
        y: 0,
        width: 100,
        height: 100,
      });

      API.setElements([text]);
      UI.clickTool("selection");

      mouse.doubleClickAt(text.x + 50, text.y + 50);

      const editor = await getTextEditor();

      expect(editor).not.toBe(null);
      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(h.elements.length).toBe(1);
    });

    it("should reselect text after exiting wysiwyg with escape", async () => {
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: 60,
        y: 0,
        width: 100,
        height: 100,
      });

      API.setElements([text]);
      API.setSelectedElements([text]);
      UI.clickTool("selection");

      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();

      expect(editor).not.toBe(null);
      expect(h.state.editingTextElement?.id).toBe(text.id);

      await exitTextEditorAndAssertSelection({
        editor,
        selectedIds: [text.id],
      });
    });

    // FIXME too flaky. No one knows why.
    it.skip("should bump the version of a labeled arrow when the label is updated", async () => {
      const arrow = UI.createElement("arrow", {
        width: 300,
        height: 0,
      });
      await UI.editText(arrow, "Hello");
      const { version } = arrow;

      await UI.editText(arrow, "Hello\nworld!");

      expect(arrow.version).toEqual(version + 1);
    });
  });

  describe("Test text wrapping", () => {
    const { h } = window;
    const dimensions = { height: 400, width: 800 };

    beforeAll(() => {
      mockBoundingClientRect(dimensions);
    });

    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      // @ts-ignore
      h.app.refreshEditorInterface();

      API.setElements([]);
    });

    afterAll(() => {
      restoreOriginalGetBoundingClientRect();
    });

    it("should keep width when editing a wrapped text", async () => {
      const text = API.createElement({
        type: "text",
        text: "Excalidraw\nEditor",
      });

      API.setElements([text]);

      const prevWidth = text.width;
      const prevHeight = text.height;
      const prevText = getTextElementDisplayText(text);

      // text is wrapped
      UI.resize(text, "e", [-20, 0]);
      expect(text.width).not.toEqual(prevWidth);
      expect(text.height).not.toEqual(prevHeight);
      expect(getTextElementDisplayText(text)).not.toEqual(prevText);
      expect(text.autoResize).toBe(false);

      const wrappedWidth = text.width;
      const wrappedHeight = text.height;
      const wrappedText = getTextElementDisplayText(text);

      // edit text
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + text.width / 2, text.y + text.height / 2);
      const editor = await getTextEditor();
      expect(editor).not.toBe(null);
      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(h.elements.length).toBe(1);

      const nextText = `${wrappedText} is great!`;
      updateTextEditor(editor, nextText);
      Keyboard.exitTextEditor(editor);

      expect(h.elements[0].width).toEqual(wrappedWidth);
      expect(h.elements[0].height).toBeGreaterThan(wrappedHeight);

      // remove all texts and then add it back editing
      updateTextEditor(editor, "");
      updateTextEditor(editor, nextText);
      Keyboard.exitTextEditor(editor);

      expect(h.elements[0].width).toEqual(wrappedWidth);
    });

    it("should restore original text after unwrapping a wrapped text", async () => {
      const originalText = "Excalidraw\neditor\nis great!";
      const text = API.createElement({
        type: "text",
        text: originalText,
      });
      API.setElements([text]);

      // wrap
      UI.resize(text, "e", [-40, 0]);
      // enter text editing mode
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + text.width / 2, text.y + text.height / 2);
      const editor = await getTextEditor();
      Keyboard.exitTextEditor(editor);
      // restore after unwrapping
      UI.resize(text, "e", [40, 0]);
      expect(
        getTextElementDisplayText(h.elements[0] as ExcalidrawTextElement),
      ).toBe(originalText);

      // wrap again and add a new line
      UI.resize(text, "e", [-30, 0]);
      const wrappedText = getTextElementDisplayText(text);
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + text.width / 2, text.y + text.height / 2);
      updateTextEditor(editor, `${wrappedText}\nA new line!`);
      Keyboard.exitTextEditor(editor);
      // remove the newly added line
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + text.width / 2, text.y + text.height / 2);
      updateTextEditor(editor, wrappedText);
      Keyboard.exitTextEditor(editor);
      // unwrap
      UI.resize(text, "e", [30, 0]);
      // expect the text to be restored the same
      expect(
        getTextElementDisplayText(h.elements[0] as ExcalidrawTextElement),
      ).toBe(originalText);
    });
  });

  describe("Test container-unbound text", () => {
    const { h } = window;
    const dimensions = { height: 400, width: 800 };

    let textarea: HTMLTextAreaElement;
    let textElement: ExcalidrawTextElement;

    beforeAll(() => {
      mockBoundingClientRect(dimensions);
    });

    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      // @ts-ignore
      h.app.refreshEditorInterface();

      textElement = UI.createElement("text");

      mouse.clickOn(textElement);
      textarea = await getTextEditor();
    });

    afterAll(() => {
      restoreOriginalGetBoundingClientRect();
    });

    it("should add a tab at the start of the first line", () => {
      textarea.value = "Line#1\nLine#2";
      // cursor: "|Line#1\nLine#2"
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;
      fireEvent.keyDown(textarea, { key: KEYS.TAB });

      expect(textarea.value).toEqual(`${tab}Line#1\nLine#2`);
      // cursor: "    |Line#1\nLine#2"
      expect(textarea.selectionStart).toEqual(4);
      expect(textarea.selectionEnd).toEqual(4);
    });

    it("should add a tab at the start of the second line", () => {
      textarea.value = "Line#1\nLine#2";
      // cursor: "Line#1\nLin|e#2"
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      fireEvent.keyDown(textarea, { key: KEYS.TAB });

      expect(textarea.value).toEqual(`Line#1\n${tab}Line#2`);

      // cursor: "Line#1\n    Lin|e#2"
      expect(textarea.selectionStart).toEqual(14);
      expect(textarea.selectionEnd).toEqual(14);
    });

    it("should add a tab at the start of the first and second line", () => {
      textarea.value = "Line#1\nLine#2\nLine#3";
      // cursor: "Li|ne#1\nLi|ne#2\nLine#3"
      textarea.selectionStart = 2;
      textarea.selectionEnd = 9;

      fireEvent.keyDown(textarea, { key: KEYS.TAB });

      expect(textarea.value).toEqual(`${tab}Line#1\n${tab}Line#2\nLine#3`);

      // cursor: "    Li|ne#1\n    Li|ne#2\nLine#3"
      expect(textarea.selectionStart).toEqual(6);
      expect(textarea.selectionEnd).toEqual(17);
    });

    it("should remove a tab at the start of the first line", () => {
      textarea.value = `${tab}Line#1\nLine#2`;
      // cursor: "|    Line#1\nLine#2"
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2`);

      // cursor: "|Line#1\nLine#2"
      expect(textarea.selectionStart).toEqual(0);
      expect(textarea.selectionEnd).toEqual(0);
    });

    it("should remove a tab at the start of the second line", () => {
      // cursor: "Line#1\n    Lin|e#2"
      textarea.value = `Line#1\n${tab}Line#2`;
      textarea.selectionStart = 15;
      textarea.selectionEnd = 15;

      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2`);
      // cursor: "Line#1\nLin|e#2"
      expect(textarea.selectionStart).toEqual(11);
      expect(textarea.selectionEnd).toEqual(11);
    });

    it("should remove a tab at the start of the first and second line", () => {
      // cursor: "    Li|ne#1\n    Li|ne#2\nLine#3"
      textarea.value = `${tab}Line#1\n${tab}Line#2\nLine#3`;
      textarea.selectionStart = 6;
      textarea.selectionEnd = 17;

      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2\nLine#3`);
      // cursor: "Li|ne#1\nLi|ne#2\nLine#3"
      expect(textarea.selectionStart).toEqual(2);
      expect(textarea.selectionEnd).toEqual(9);
    });

    it("should remove a tab at the start of the second line and cursor stay on this line", () => {
      // cursor: "Line#1\n  |  Line#2"
      textarea.value = `Line#1\n${tab}Line#2`;
      textarea.selectionStart = 9;
      textarea.selectionEnd = 9;
      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      // cursor: "Line#1\n|Line#2"
      expect(textarea.selectionStart).toEqual(7);
    });

    it("should remove partial tabs", () => {
      // cursor: "Line#1\n  Line#|2"
      textarea.value = `Line#1\n  Line#2`;
      textarea.selectionStart = 15;
      textarea.selectionEnd = 15;
      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2`);
    });

    it("should remove nothing", () => {
      // cursor: "Line#1\n  Li|ne#2"
      textarea.value = `Line#1\nLine#2`;
      textarea.selectionStart = 9;
      textarea.selectionEnd = 9;
      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2`);
    });

    it("should resize text via shortcuts while in wysiwyg", () => {
      textarea.value = "abc def";
      const origFontSize = getTextElementStyle(textElement).fontSize;
      fireEvent.keyDown(textarea, {
        key: KEYS.CHEVRON_RIGHT,
        ctrlKey: true,
        shiftKey: true,
      });
      expect(getTextElementStyle(textElement).fontSize).toBe(
        origFontSize * 1.1,
      );

      fireEvent.keyDown(textarea, {
        key: KEYS.CHEVRON_LEFT,
        ctrlKey: true,
        shiftKey: true,
      });
      expect(getTextElementStyle(textElement).fontSize).toBe(origFontSize);
    });

    it("zooming via keyboard should zoom canvas", () => {
      expect(h.state.zoom.value).toBe(1);
      fireEvent.keyDown(textarea, {
        code: CODES.MINUS,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBe(0.9);
      fireEvent.keyDown(textarea, {
        code: CODES.NUM_SUBTRACT,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBe(0.8);
      fireEvent.keyDown(textarea, {
        code: CODES.NUM_ADD,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBe(0.9);
      fireEvent.keyDown(textarea, {
        code: CODES.EQUAL,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBe(1);
    });

    it("text should never go beyond max width", async () => {
      UI.clickTool("text");
      mouse.click(0, 0);

      textarea = await getTextEditor();
      updateTextEditor(
        textarea,
        "Excalidraw is an opensource virtual collaborative whiteboard for sketching hand-drawn like diagrams!",
      );
      Keyboard.exitTextEditor(textarea);

      expect(textarea.style.width).toBe("792px");
      expect(h.elements[0].width).toBe(1000);
    });
  });

  describe("Test container-bound text", () => {
    let rectangle: any;
    const { h } = window;

    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      API.setElements([]);

      const container = createBoundTextContainer();
      API.setElements([container]);
      API.setSelectedElements([container]);
      rectangle = liveElement(container.id);
    });

    it("should embed a label in a line when double clicked", async () => {
      const line = createBoundTextContainer();
      API.setElements([line]);

      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(line.id);

      mouse.doubleClickAt(line.x + 10, line.y + 10);
      expect(h.elements.length).toBe(1);
      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: line.id,
        region: "label",
      });
      mouse.down();
      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });
      const liveLine = liveElement<ExcalidrawLinearElement>(line.id);
      expect(liveLine.texts?.label?.text).toBe("Hello World!");
      expect(liveLine.texts?.label?.placement?.labelPosition).toBe(0.5);
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });

    it("should not add bound text to a frame when its container is not a frame child", async () => {
      const frame = API.createElement({
        type: "frame",
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      });
      const line = createBoundTextContainer();
      API.setElements([frame, line]);

      mouse.doubleClickAt(line.x + 10, line.y + 10);

      const liveLine = liveElement<ExcalidrawLinearElement>(line.id);
      expect(liveLine.texts?.label).toBeUndefined();
      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: line.id,
        region: "label",
      });
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });

    it("should embed a label in a frame child container when single clicking its center", async () => {
      const frame = API.createElement({
        type: "frame",
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      });
      const line = createBoundTextContainer({
        containerRef: { kind: "frameLike", elementId: frame.id },
      });
      API.setElements([line, frame]);

      UI.clickTool("text");
      mouse.clickAt(line.x + line.width / 2, line.y + line.height / 2);

      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: line.id,
        region: "label",
      });
      expect(h.elements).toHaveLength(2);
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });

    it("should keep the element angle when editing embedded text on a rotated shape", async () => {
      const process = API.createElement({
        type: "df-process",
        x: 0,
        y: 0,
        width: 90,
        height: 75,
        angle: 45,
      });
      API.setElements([process]);

      act(() => {
        h.app.startTextEditing({
          sceneX: process.x + process.width / 2,
          sceneY: process.y + process.height / 2,
          container: process as unknown as ExcalidrawTextContainer,
        });
      });

      expect(h.state.editingTextRegion?.target.region).toBe("body");
      expect(h.state.editingTextElement).toBe(null);

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      expect(process.angle).toBe(45);
      expect(process.texts?.body?.text).toBe("Hello World!");
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });

    it("should compute the container height correctly and not throw error when height is updated while editing the text", async () => {
      const diamond = API.createElement({
        type: "diamond",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
      });
      API.setElements([diamond]);

      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(diamond.id);

      API.setSelectedElements([diamond]);
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();

      const value = new Array(1000).fill("1").join("\n");

      // Composite containers defer geometry updates during live editing, so the
      // container keeps its original height even when large text is pasted.
      await act(async () => {
        expect(() =>
          fireEvent.input(editor, { target: { value } }),
        ).not.toThrow();
      });

      expect(diamond.height).toBe(75);

      // Clearing text to simulate height decrease
      await act(async () => {
        expect(() => updateTextEditor(editor, "")).not.toThrow();
      });

      // Adaptive text fit retains the original shape as its minimum size.
      expect(diamond.height).toBe(75);
    });

    it("keeps the cube editor anchored while text grows and shrinks", async () => {
      const cube = API.createElement({
        type: "cube",
        x: 100,
        y: 100,
        width: 120,
        height: 80,
      });
      API.setElements([cube]);
      API.setSelectedElements([cube]);
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();
      const initialTop = parseFloat(editor.style.top);
      const initialLeft = parseFloat(editor.style.left);

      await act(async () => {
        updateTextEditor(editor, new Array(20).fill("line").join("\n"));
      });
      // 内嵌正文在实时编辑期间不改变形状尺寸，编辑框始终锚定在元素的正文区域
      expect(cube.height).toBe(80);
      expect(cube.width).toBe(120);
      expect(await getTextEditor({ waitForEditor: false })).toBe(editor);

      await act(async () => {
        updateTextEditor(editor, "short");
      });
      expect(cube.height).toBe(80);
      // 收缩回单行后编辑框回到初始锚点
      expect(parseFloat(editor.style.left)).toBeCloseTo(initialLeft, 4);
      expect(parseFloat(editor.style.top)).toBeCloseTo(initialTop, 4);
    });

    it("keeps fixed composite shapes unchanged and truncates the embedded text", async () => {
      const cube = API.createElement({
        type: "cube",
        x: 100,
        y: 100,
        width: 120,
        height: 80,
      });
      API.setElements([cube]);
      API.updateElement(cube as ExcalidrawShapeElement, {
        textFitMode: "fixed",
      });
      API.setSelectedElements([cube]);
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();
      const originalText = new Array(40).fill("long label").join(" ");
      updateTextEditor(editor, originalText);
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      expect(cube.width).toBe(120);
      expect(cube.height).toBe(80);
      const live = h.elements.find(
        (element) => element.id === cube.id,
      ) as ExcalidrawShapeElement;
      // 固定尺寸只截断显示，正文本身完整保留在 texts.body 中
      expect(live.texts?.body?.text).toBe(originalText);
      expect(getLocalTextRegionLayout(live, "body")!.text).toContain("…");
      expect(
        h.elements.some(
          (element) => element.type === "text" && !element.isDeleted,
        ),
      ).toBe(false);
    });

    it("grows a lifeline head upward for a long label and shrinks it back", async () => {
      const id = "sc-lifeline-entity";
      const { width, height } = getSequenceLifelineDefaultSize(id);
      const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      const lifeline = API.createElement({
        type: id,
        x: 100,
        y: 100,
        width,
        height,
      });
      API.setElements([lifeline]);
      API.setSelectedElements([lifeline]);
      API.setAppState({ currentItemFontSize: 14 });
      Keyboard.keyPress(KEYS.ENTER);

      // 生命线的标签走区域编辑，不创建绑定文字元素
      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: lifeline.id,
        region: "body",
      });

      const editor = await getTextEditor();
      const longLabel = new Array(12).fill("lifeline label").join(" ");
      await act(async () => {
        updateTextEditor(editor, longLabel);
      });
      await act(async () => {
        h.app.textWysiwygSubmitHandler?.();
      });

      const latest = () => {
        const element = h.elements.find((item) => item.id === lifeline.id)!;
        if (!isSequenceLifelineElement(element)) {
          throw new Error("Expected a sequence lifeline");
        }
        return element;
      };
      const grown = latest();
      expect(grown.texts?.body?.text).toBe(longLabel);
      expect(
        h.elements.filter(
          (element) => element.type === "text" && !element.isDeleted,
        ),
      ).toHaveLength(0);
      expect(grown.width).toBe(width);
      expect(grown.shape.lifeline.headHeight).toBeGreaterThan(baseHeadHeight);
      // The head bottom and the pole length stay fixed.
      expect(grown.y + grown.shape.lifeline.headHeight).toBeCloseTo(
        100 + baseHeadHeight,
        4,
      );
      expect(grown.height - grown.shape.lifeline.headHeight).toBeCloseTo(
        height - baseHeadHeight,
        4,
      );

      // 提交后元素仍处于选中态，再次回车即可重新进入区域编辑
      Keyboard.keyPress(KEYS.ENTER);
      const secondEditor = await getTextEditor();
      await act(async () => {
        updateTextEditor(secondEditor, "Short");
      });
      await act(async () => {
        h.app.textWysiwygSubmitHandler?.();
      });
      expect(latest().shape.lifeline.headHeight).toBeCloseTo(baseHeadHeight, 4);
    });

    it("keeps a fixed lifeline head unchanged and truncates the label", async () => {
      const id = "sc-lifeline-entity";
      const { width, height } = getSequenceLifelineDefaultSize(id);
      const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      const lifeline = API.createElement({
        type: id,
        x: 100,
        y: 100,
        width,
        height,
      });
      API.setElements([lifeline]);
      API.updateElement(lifeline as ExcalidrawShapeElement, {
        textFitMode: "fixed",
      });
      API.setSelectedElements([lifeline]);
      API.setAppState({ currentItemFontSize: 14 });
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();
      const originalText = new Array(12).fill("lifeline label").join(" ");
      await act(async () => {
        updateTextEditor(editor, originalText);
      });
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      const latest = h.elements.find((item) => item.id === lifeline.id)!;
      if (!isSequenceLifelineElement(latest)) {
        throw new Error("Expected a sequence lifeline");
      }
      expect(latest.y).toBe(100);
      expect(latest.height).toBe(height);
      expect(latest.shape.lifeline.headHeight).toBe(baseHeadHeight);
      // 源文本完整保留在 texts.body，显示层只做截断
      expect(latest.texts?.body?.text).toBe(originalText);
      expect(getLocalTextRegionLayout(latest, "body")!.text).toContain("…");
      expect(
        h.elements.filter(
          (element) => element.type === "text" && !element.isDeleted,
        ),
      ).toHaveLength(0);
    });

    it("removes the lifeline body key when an empty label is submitted", async () => {
      const id = "sc-lifeline-entity";
      const { width, height } = getSequenceLifelineDefaultSize(id);
      const lifeline = API.createElement({
        type: id,
        x: 100,
        y: 100,
        width,
        height,
        texts: {
          body: {
            text: "Label",
            style: {
              fontFamily: FONT_FAMILY.Virgil,
              fontSize: 14,
              lineHeight: getLineHeight(FONT_FAMILY.Virgil),
              textAlign: "center" as const,
              verticalAlign: "middle" as const,
            },
          },
        },
      });
      API.setElements([lifeline]);
      API.setSelectedElements([lifeline]);
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();
      await act(async () => {
        updateTextEditor(editor, "");
      });
      await act(async () => {
        h.app.textWysiwygSubmitHandler?.();
      });

      const latest = h.elements.find((item) => item.id === lifeline.id)!;
      expect(latest.texts).toBeUndefined();
      expect(
        h.elements.filter(
          (element) => element.type === "text" && !element.isDeleted,
        ),
      ).toHaveLength(0);
    });

    it("switches a lifeline to fixed fit after a manual head resize", async () => {
      const id = "sc-lifeline-entity";
      const { width, height } = getSequenceLifelineDefaultSize(id);
      const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      const lifeline = API.createElement({
        type: id,
        x: 100,
        y: 100,
        width,
        height,
      });
      API.setElements([lifeline]);
      API.setSelectedElements([lifeline]);
      API.setAppState({ currentItemFontSize: 14 });
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();
      await act(async () => {
        updateTextEditor(editor, "Label");
      });
      await act(async () => {
        h.app.textWysiwygSubmitHandler?.();
      });

      const latest = () => {
        const element = h.elements.find((item) => item.id === lifeline.id)!;
        if (!isSequenceLifelineElement(element)) {
          throw new Error("Expected a sequence lifeline");
        }
        return element;
      };
      UI.resize(latest(), "n", [0, -20]);
      const resized = latest();
      expect(resized.textFitMode).toBe("fixed");
      expect(resized.shape.lifeline.headHeight).toBeGreaterThan(baseHeadHeight);
      // 标签布局按新的头部重新求解，仍在头部安全区内
      expect(resized.texts?.body?.text).toBe("Label");
      const region = getLocalTextRegionLayout(resized, "body")!;
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.y + region.height).toBeLessThanOrEqual(
        resized.shape.lifeline.headHeight + 1e-6,
      );
    });

    it("opens the lifeline head region on double click and ignores the pole", async () => {
      const id = "sc-lifeline-entity";
      const { width, height } = getSequenceLifelineDefaultSize(id);
      const lifeline = API.createElement({
        type: id,
        x: 100,
        y: 100,
        width,
        height,
      });
      API.setElements([lifeline]);

      mouse.doubleClickAt(
        100 + width / 2,
        100 + SEQUENCE_LIFELINE_HEAD_HEIGHTS[id] / 2,
      );
      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: lifeline.id,
        region: "body",
      });
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      mouse.doubleClickAt(100 + width / 2, 100 + height - 20);
      expect(h.state.editingTextRegion).toBeNull();
    });

    it("re-grows a lifeline head when switching back to auto fit", () => {
      const id = "sc-lifeline-entity";
      const { width, height } = getSequenceLifelineDefaultSize(id);
      const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      const lifeline = API.createElement({
        type: id,
        x: 100,
        y: 100,
        width,
        height,
        texts: {
          body: {
            text: new Array(12).fill("lifeline label").join(" "),
            style: {
              fontFamily: FONT_FAMILY.Virgil,
              fontSize: 14,
              lineHeight: getLineHeight(FONT_FAMILY.Virgil),
              textAlign: "center" as const,
              verticalAlign: "middle" as const,
            },
          },
        },
      });
      API.setElements([lifeline]);
      API.updateElement(lifeline as ExcalidrawShapeElement, {
        textFitMode: "fixed",
      });
      API.setSelectedElements([lifeline]);

      act(() => {
        h.app.actionManager.executeAction(actionSetCompositeShapeTextFitAuto);
      });

      const latest = h.elements.find((element) => element.id === lifeline.id)!;
      if (!isSequenceLifelineElement(latest)) {
        throw new Error("Expected a sequence lifeline");
      }
      expect(latest.textFitMode).toBe("auto");
      expect(latest.shape.lifeline.headHeight).toBeGreaterThan(baseHeadHeight);
      expect(latest.width).toBe(width);
      expect(latest.height - latest.shape.lifeline.headHeight).toBeCloseTo(
        height - baseHeadHeight,
        4,
      );
    });

    it("should embed a label in an unfilled line when double clicked", async () => {
      const line = createBoundTextContainer();
      API.setElements([line]);

      mouse.doubleClickAt(line.x + 10, line.y + 10);
      expect(h.elements.length).toBe(1);
      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: line.id,
        region: "label",
      });
      mouse.down();
      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      expect(
        liveElement<ExcalidrawLinearElement>(line.id).texts?.label?.text,
      ).toBe("Hello World!");
    });

    it("should open the embedded region when Enter is pressed on a shape container", async () => {
      const process = API.createElement({
        type: "df-process",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
      });
      API.setElements([process]);
      API.setSelectedElements([process]);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: process.id,
        region: "body",
      });

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      expect(process.texts?.body?.text).toBe("Hello World!");
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });

    it("should embed a label in a line when double clicked near its stroke", async () => {
      const line = createBoundTextContainer({
        strokeWidth: 4,
      });
      API.setElements([line]);

      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(line.id);

      mouse.doubleClickAt(line.x + 2, line.y + 2);
      expect(h.elements.length).toBe(1);
      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: line.id,
        region: "label",
      });
      mouse.down();
      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");

      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });
      expect(
        liveElement<ExcalidrawLinearElement>(line.id).texts?.label?.text,
      ).toBe("Hello World!");
    });

    it("shouldn't bind to non-text-bindable containers", async () => {
      const freedraw = API.createElement({
        type: "freedraw",
        width: 100,
        height: 0,
      });
      API.setElements([freedraw]);

      UI.clickTool("text");

      mouse.clickAt(
        freedraw.x + freedraw.width / 2,
        freedraw.y + freedraw.height / 2,
      );

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      Keyboard.exitTextEditor(editor);

      expect(freedraw.boundElements).toBe(null);
      expect(h.elements[1].type).toBe("text");
    });

    ["freedraw", "line"].forEach((type: any) => {
      it(`shouldn't create text element when pressing 'Enter' key on ${type} `, async () => {
        API.setElements([]);
        const element = UI.createElement(type, {
          width: 100,
          height: 50,
        });
        API.setSelectedElements([element] as NonDeletedExcalidrawElement[]);
        Keyboard.keyPress(KEYS.ENTER);
        expect(h.elements.length).toBe(1);
      });
    });

    it("does not bind text to a linear element via context menu", async () => {
      API.setElements([]);

      UI.clickTool("text");
      mouse.clickAt(20, 30);
      const editor = await getTextEditor();

      updateTextEditor(
        editor,
        "Excalidraw is an opensource virtual collaborative whiteboard",
      );
      Keyboard.exitTextEditor(editor);

      const textElement = h.elements[0] as ExcalidrawTextElement;
      const line = createBoundTextContainer();
      API.setElements([line, textElement]);
      API.setSelectedElements([
        line,
        textElement,
      ] as NonDeletedExcalidrawElement[]);

      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 20,
        clientY: 30,
      });
      UI.openContextMenuSubmenus();
      const contextMenu = UI.queryContextMenu();
      expect(
        queryByText(contextMenu as HTMLElement, "Bind text to the container"),
      ).toBeNull();
      expect(line.boundElements ?? []).toHaveLength(0);
    });

    it("keeps an arrow label in texts and offers no unbind action", async () => {
      const arrow = API.createElement({
        type: "arrow",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
      });
      API.setElements([arrow]);
      API.setSelectedElements([arrow]);

      mouse.doubleClickAt(arrow.x + 10, arrow.y + 10);
      expect(h.elements.length).toBe(1);
      expect(h.state.editingTextRegion?.target).toEqual({
        elementId: arrow.id,
        region: "label",
      });

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      const liveArrow = liveElement<ExcalidrawLinearElement>(arrow.id);
      expect(liveArrow.texts?.label?.text).toBe("Hello World!");
      expect(liveArrow.boundElements ?? []).toHaveLength(0);

      mouse.reset();
      UI.clickTool("selection");
      mouse.clickAt(10, 20);
      mouse.down();
      mouse.up();
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 20,
        clientY: 30,
      });
      UI.openContextMenuSubmenus();
      const contextMenu = UI.queryContextMenu();
      expect(queryByText(contextMenu as HTMLElement, "Unbind text")).toBeNull();
    });

    it("keeps a single label when editing an arrow twice", async () => {
      const arrow = API.createElement({
        type: "arrow",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
      });
      API.setElements([arrow]);
      API.setSelectedElements([arrow]);

      mouse.doubleClickAt(arrow.x + 10, arrow.y + 10);
      expect(h.elements.length).toBe(1);

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });
      expect(
        liveElement<ExcalidrawLinearElement>(arrow.id).texts?.label?.text,
      ).toBe("Hello World!");

      mouse.select(arrow);
      mouse.doubleClickAt(arrow.x + 10, arrow.y + 10);
      expect(h.elements.length).toBe(1);
      const nextEditor = await getTextEditor();
      updateTextEditor(nextEditor, "Updated");
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });
      expect(
        liveElement<ExcalidrawLinearElement>(arrow.id).texts?.label?.text,
      ).toBe("Updated");
    });

    it("should not write whitespace-only text into the embedded body", async () => {
      const process = API.createElement({
        type: "df-process",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
      });
      API.setElements([process]);
      API.setSelectedElements([process]);

      Keyboard.keyPress(KEYS.ENTER);
      const editor = await getTextEditor();

      updateTextEditor(editor, "   ");
      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      expect(process.texts).toBeUndefined();
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });

    it("should remove an empty arrow label without creating a text element", async () => {
      const [selectedElement] = API.createLabeledArrow();
      API.setElements([selectedElement]);
      API.setSelectedElements([selectedElement]);

      Keyboard.keyPress(KEYS.ENTER);
      const editor = await getTextEditor();

      updateTextEditor(editor, "");
      await act(async () => {
        editor.blur();
      });

      expect(await getTextEditor({ waitForEditor: false })).toBe(null);
      expect(h.elements).toHaveLength(1);
      expect(getTextBlock(h.elements[0].texts, "label")).toBeUndefined();
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });


    it("should keep the text label at 0 degrees when used as an arrow label", async () => {
      const arrow = API.createElement({
        type: "arrow",
        width: 90,
        height: 75,
        angle: 30,
      });

      API.setElements([arrow]);
      API.setSelectedElements([arrow]);

      mouse.doubleClickAt(
        arrow.x + arrow.width / 2,
        arrow.y + arrow.height / 2,
      );

      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      act(() => {
        h.app.textWysiwygSubmitHandler?.();
      });

      const liveArrow = liveElement<ExcalidrawLinearElement>(arrow.id);
      const layout = LinearElementEditor.getLabelSceneLayout(
        liveArrow,
        arrayToMap(h.elements),
      );
      expect(layout.angle).toBe(0);
      expect(
        h.elements.filter((element) => element.type === "text"),
      ).toHaveLength(0);
    });
  });

  describe("Test theme change", () => {
    const { h } = window;

    // Helper to compare colors (browser may return rgb format)
    const colorsAreEqual = (color1: string, color2: string) => {
      return colorToHex(color1) === colorToHex(color2);
    };

    beforeEach(async () => {
      await render(
        <Excalidraw
          handleKeyboardGlobally={true}
          initialData={{
            appState: {
              theme: THEME.LIGHT,
            },
          }}
        />,
      );
      API.setElements([]);
    });

    it("should update textarea color when theme changes to dark mode and back", async () => {
      const originalColor = "#ff0000";

      const textElement = API.createElement({
        type: "text",
        text: "test",
        strokeColor: originalColor,
      });

      API.setElements([textElement]);

      mouse.doubleClickOn(textElement as ExcalidrawTextElement);

      const editor = await getTextEditor({ waitForEditor: true });

      expect(colorsAreEqual(editor.style.color, originalColor)).toBe(true);

      act(() => {
        h.setState({ theme: THEME.DARK });
        // Trigger element mutation to fire onChange callback
        h.app.scene.mutateElement(textElement, {});
      });
      expect(
        colorsAreEqual(editor.style.color, applyDarkModeFilter(originalColor)),
      ).toBe(true);

      act(() => {
        h.setState({ theme: THEME.LIGHT });
        h.app.scene.mutateElement(textElement, {});
      });
      expect(colorsAreEqual(editor.style.color, originalColor)).toBe(true);
    });
  });

  describe("autoResize handle", () => {
    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      API.setElements([]);
    });

    /**
     * a fixed-width text wrapped onto two lines. 源文本不含换行，显示文本由
     * 当前宽度换行得到；`API.createElement` 不接受 `autoResize`，因此事后
     * 补上。
     */
    const wrappedText = (
      overrides: {
        textAlign?: ExcalidrawTextElement["texts"]["body"]["style"]["textAlign"];
        verticalAlign?: ExcalidrawTextElement["texts"]["body"]["style"]["verticalAlign"];
      } = {},
    ): ExcalidrawTextElement => {
      const element = API.createElement({
        type: "text",
        id: "text",
        x: 100,
        y: 100,
        width: 300,
        height: 50,
        text: "this is it my friends\nald aksdl askdlasdk",
        ...overrides,
      });
      return newElementWith(element, {
        autoResize: false,
        width: 300,
        height: 50,
        ...getTextElementTextPatch(
          element,
          "this is it my friends ald aksdl askdlasdk",
        ),
      });
    };

    // unwrapping resizes the box, so whichever edge the alignment pins has to
    // stay put — otherwise the text slides out from under itself
    it.each([
      { textAlign: "left" as const, edge: (t: ExcalidrawTextElement) => t.x },
      {
        textAlign: "right" as const,
        edge: (t: ExcalidrawTextElement) => t.x + t.width,
      },
      {
        textAlign: "center" as const,
        edge: (t: ExcalidrawTextElement) => t.x + t.width / 2,
      },
    ])("keeps the $textAlign anchor when unwrapping", ({ textAlign, edge }) => {
      API.setElements([wrappedText({ textAlign })]);
      API.setAppState({ selectedElementIds: { text: true } });
      expect((h.elements[0] as ExcalidrawTextElement).autoResize).toBe(false);
      const before = edge(h.elements[0] as ExcalidrawTextElement);

      API.executeAction(actionTextAutoResize);

      const text = h.elements[0] as ExcalidrawTextElement;
      expect(text.autoResize).toBe(true);
      // the box really did change size, so the assertion isn't vacuous
      expect(text.width).not.toBeCloseTo(300, 0);
      expect(edge(text)).toBeCloseTo(before, 4);
    });

    it.each([
      {
        verticalAlign: "top" as const,
        edge: (t: ExcalidrawTextElement) => t.y,
      },
      {
        verticalAlign: "bottom" as const,
        edge: (t: ExcalidrawTextElement) => t.y + t.height,
      },
      {
        verticalAlign: "middle" as const,
        edge: (t: ExcalidrawTextElement) => t.y + t.height / 2,
      },
    ])(
      "keeps the $verticalAlign anchor when unwrapping",
      ({ verticalAlign, edge }) => {
        API.setElements([wrappedText({ verticalAlign })]);
        API.setAppState({ selectedElementIds: { text: true } });
        expect((h.elements[0] as ExcalidrawTextElement).autoResize).toBe(false);
        const before = edge(h.elements[0] as ExcalidrawTextElement);

        API.executeAction(actionTextAutoResize);

        const text = h.elements[0] as ExcalidrawTextElement;
        expect(edge(text)).toBeCloseTo(before, 4);
      },
    );
  });

  describe("history", () => {
    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      API.setElements([]);
    });

    // Creating a text used to land in two history entries — the empty element,
    // then its content — so the first undo restored a live, zero-content
    // element. For a text bound to an arrow endpoint that also left the
    // endpoint occupied by something invisible.
    //
    // The invariant behind the single-undo behaviour is that creating the
    // element must not be captured on its own. Pointerup has more than one
    // capture site and they don't all fire in every environment, so assert the
    // stack directly rather than only the observable undo.
    it("does not open a history entry until the text is submitted", async () => {
      const stackSize = () => (h.history as any).undoStack.length;

      UI.clickTool("text");
      const before = stackSize();

      mouse.clickAt(400, 400);
      const editor = await getTextEditor();
      expect(stackSize()).toBe(before);

      updateTextEditor(editor, "plain");
      Keyboard.exitTextEditor(editor);
      expect(stackSize()).toBe(before + 1);
    });

    it("removes a plain text in a single undo", async () => {
      UI.clickTool("text");
      mouse.clickAt(400, 400);
      const editor = await getTextEditor();
      updateTextEditor(editor, "plain");
      Keyboard.exitTextEditor(editor);

      Keyboard.undo();

      expect(h.elements.filter((el) => !el.isDeleted)).toHaveLength(0);
    });
  });
});
