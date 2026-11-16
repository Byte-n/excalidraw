import { DEFAULT_FONT_FAMILY, getLineHeight } from "@excalidraw/common";

import { isShapeElement } from "../src/compositeShape";
import { getMindmapNodeTextStyle } from "../src/mindmap";
import { newElementWith } from "../src/mutateElement";
import { newElement, newMindmapNodeElement } from "../src/newElement";
import {
  getMindmapNodeTextLayoutUpdates,
  getShapeTextLayoutUpdates,
} from "../src/text/applyLayout";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";

import type { TextBlockStyle } from "../src/text/types";
import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawShapeElement,
} from "../src/types";

// 10px/字符（fontSize 20 * 0.5），让宽度与换行结果完全确定
setCustomTextMetricsProvider({
  getLineWidth: (text, font) => text.length * parseFloat(font) * 0.5,
});

const FONT_SIZE = 20;
const ELEMENT_WIDTH = 100;
const ELEMENT_HEIGHT = 60;
const LONG_TEXT = "a".repeat(30);

const makeStyle = (
  overrides: Partial<TextBlockStyle> = {},
): TextBlockStyle => ({
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: FONT_SIZE,
  lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
  textAlign: "center",
  verticalAlign: "middle",
  ...overrides,
});

const asShape = (element: ExcalidrawElement): ExcalidrawShapeElement => {
  if (!isShapeElement(element)) {
    throw new Error("Expected a shape element");
  }
  return element;
};

const makeElement = (): ExcalidrawShapeElement =>
  asShape(
    newElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: ELEMENT_WIDTH,
      height: ELEMENT_HEIGHT,
    }),
  );

const withText = (
  element: ExcalidrawShapeElement,
  text: string,
  style: Partial<TextBlockStyle> = {},
): ExcalidrawShapeElement =>
  newElementWith(element, {
    texts: { body: { text, style: makeStyle(style) } },
  });

describe("getShapeTextLayoutUpdates", () => {
  it("没有 texts 时返回 null", () => {
    expect(getShapeTextLayoutUpdates(makeElement())).toBeNull();
  });

  it("空文本返回 null", () => {
    expect(getShapeTextLayoutUpdates(withText(makeElement(), ""))).toBeNull();
  });

  it("长文本撑高 auto-fit 形状", () => {
    const element = withText(makeElement(), LONG_TEXT);
    const updates = getShapeTextLayoutUpdates(element);

    if (!updates) {
      throw new Error("Expected layout updates");
    }
    expect(updates.width).toBeGreaterThanOrEqual(element.width);
    expect(updates.height).toBeGreaterThan(element.height);
  });

  it("fixed 适配不返回尺寸变化", () => {
    const element = withText(
      asShape(
        newElement({
          type: "rectangle",
          x: 0,
          y: 0,
          width: ELEMENT_WIDTH,
          height: ELEMENT_HEIGHT,
          textFitMode: "fixed",
        }),
      ),
      LONG_TEXT,
    );

    expect(getShapeTextLayoutUpdates(element)).toBeNull();
  });

  it("textFitMinHeight 是目标高度的下界", () => {
    const element = withText(
      asShape(
        newElement({
          type: "rectangle",
          x: 0,
          y: 0,
          width: ELEMENT_WIDTH,
          height: ELEMENT_HEIGHT,
          textFitMinHeight: 400,
        }),
      ),
      LONG_TEXT,
    );
    const updates = getShapeTextLayoutUpdates(element);

    if (!updates) {
      throw new Error("Expected layout updates");
    }
    expect(updates.height).toBeGreaterThanOrEqual(400);
  });

  it("不修改入参尺寸", () => {
    const element = withText(makeElement(), LONG_TEXT);
    const width = element.width;
    const height = element.height;

    getShapeTextLayoutUpdates(element);

    expect(element.width).toBe(width);
    expect(element.height).toBe(height);
  });
});

const makeMindmapNode = (width = ELEMENT_WIDTH, height = ELEMENT_HEIGHT) =>
  newMindmapNodeElement({
    x: 0,
    y: 0,
    width,
    height,
    graphId: "g",
    role: "root",
    parentId: null,
    order: null,
  });

const withMindmapText = (
  node: ExcalidrawMindmapNodeElement,
  text: string,
): ExcalidrawMindmapNodeElement =>
  newElementWith(node, {
    texts: { body: { text, style: getMindmapNodeTextStyle(node) } },
  });

describe("getMindmapNodeTextLayoutUpdates", () => {
  it("没有 texts 时返回 null", () => {
    expect(getMindmapNodeTextLayoutUpdates(makeMindmapNode())).toBeNull();
  });

  it("空文本返回 null", () => {
    expect(
      getMindmapNodeTextLayoutUpdates(withMindmapText(makeMindmapNode(), "")),
    ).toBeNull();
  });

  it("长文本撑高节点，且不收缩宽度", () => {
    const node = withMindmapText(makeMindmapNode(), "a".repeat(30));
    const updates = getMindmapNodeTextLayoutUpdates(node);

    if (!updates) {
      throw new Error("Expected layout updates");
    }
    expect(updates.width).toBeGreaterThanOrEqual(node.width);
    expect(updates.height).toBeGreaterThan(node.height);
  });

  it("多行文本撑高节点且不改动宽度", () => {
    const node = withMindmapText(makeMindmapNode(200, 60), "aaaa ".repeat(20));
    const updates = getMindmapNodeTextLayoutUpdates(node);

    if (!updates) {
      throw new Error("Expected layout updates");
    }
    expect(updates.width).toBe(node.width);
    expect(updates.height).toBeGreaterThan(node.height);
  });

  it("几何被冻结时返回 null", () => {
    const node = newElementWith(
      withMindmapText(makeMindmapNode(), "a".repeat(30)),
      { layoutFrozen: true },
    );

    expect(getMindmapNodeTextLayoutUpdates(node)).toBeNull();
  });

  it("文本已适配时不返回尺寸变化", () => {
    expect(
      getMindmapNodeTextLayoutUpdates(withMindmapText(makeMindmapNode(), "hi")),
    ).toBeNull();
  });

  it("不修改入参尺寸", () => {
    const node = withMindmapText(makeMindmapNode(), "a".repeat(30));
    const width = node.width;
    const height = node.height;

    getMindmapNodeTextLayoutUpdates(node);

    expect(node.width).toBe(width);
    expect(node.height).toBe(height);
  });
});
