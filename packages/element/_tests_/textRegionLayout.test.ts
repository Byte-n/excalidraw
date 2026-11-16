import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  getLineHeight,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import { newElementWith } from "../src/mutateElement";
import { newElement } from "../src/newElement";
import {
  getLocalTextRegionLayout,
  getTextRegionLayout,
  layoutTextRegions,
  layoutTextRegionsLocal,
} from "../src/text/regionLayout";
import { getTextRegions } from "../src/text/regions";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";

import type { TextBlockStyle } from "../src/text/types";
import type { ExcalidrawElement } from "../src/types";

// 10px/字符（fontSize 20 * 0.5），让宽度与换行结果完全确定
setCustomTextMetricsProvider({
  getLineWidth: (text, font) => text.length * parseFloat(font) * 0.5,
});

const ELEMENT_X = 100;
const ELEMENT_Y = 50;
const ELEMENT_WIDTH = 200;
const ELEMENT_HEIGHT = 100;

const LINE_HEIGHT = getLineHeight(DEFAULT_FONT_FAMILY);
const LINE_HEIGHT_PX = DEFAULT_FONT_SIZE * LINE_HEIGHT;

const makeStyle = (
  overrides: Partial<TextBlockStyle> = {},
): TextBlockStyle => ({
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  textAlign: "center",
  verticalAlign: "middle",
  ...overrides,
});

const makeElement = (): ExcalidrawElement =>
  newElement({
    type: "rectangle",
    x: ELEMENT_X,
    y: ELEMENT_Y,
    width: ELEMENT_WIDTH,
    height: ELEMENT_HEIGHT,
  });

const withText = (
  element: ExcalidrawElement,
  text: string,
  style: Partial<TextBlockStyle> = {},
): ExcalidrawElement =>
  newElementWith(element, {
    texts: { body: { text, style: makeStyle(style) } },
  });

describe("layoutTextRegions", () => {
  it("空文本也返回可定位的布局", () => {
    const element = makeElement();
    const layouts = layoutTextRegions(element);

    expect(layouts).toHaveLength(1);
    const [body] = layouts;
    expect(body.key).toBe("body");
    expect(body.text).toBe("");
    expect(body.lines).toEqual([""]);
    expect(body.width).toBe(0);
    expect(body.height).toBe(LINE_HEIGHT_PX);
  });

  it("center/middle 时文本块在区域内居中", () => {
    const element = withText(makeElement(), "hello");
    const [region] = getTextRegions(element);
    const [layout] = layoutTextRegions(element);

    expect(layout.width).toBe(50);
    expect(layout.x - element.x).toBeCloseTo(
      region.bounds.x + (region.bounds.width - layout.width) / 2,
    );
    expect(layout.y - element.y).toBeCloseTo(
      region.bounds.y + (region.bounds.height - layout.height) / 2,
    );
  });

  it("left/top 时文本块贴住区域左上角", () => {
    const element = withText(makeElement(), "hello", {
      textAlign: "left",
      verticalAlign: "top",
    });
    const [region] = getTextRegions(element);
    const [layout] = layoutTextRegions(element);

    expect(layout.x - element.x).toBeCloseTo(region.bounds.x);
    expect(layout.y - element.y).toBeCloseTo(region.bounds.y);
  });

  it("right/bottom 时文本块贴住区域右下角", () => {
    const element = withText(makeElement(), "hello", {
      textAlign: "right",
      verticalAlign: "bottom",
    });
    const [region] = getTextRegions(element);
    const [layout] = layoutTextRegions(element);

    expect(layout.x - element.x).toBeCloseTo(
      region.bounds.x + region.bounds.width - layout.width,
    );
    expect(layout.y - element.y).toBeCloseTo(
      region.bounds.y + region.bounds.height - layout.height,
    );
  });

  it("显式 color 覆盖元素描边色，缺省时跟随描边色", () => {
    const element = makeElement();

    expect(layoutTextRegions(element)[0].color).toBe(element.strokeColor);

    const colored = withText(element, "hello", { color: "#ff0000" });
    expect(layoutTextRegions(colored)[0].color).toBe("#ff0000");
  });

  it("多行文本按行数计算高度并垂直居中", () => {
    const element = withText(makeElement(), "a\nb\nc");
    const [region] = getTextRegions(element);
    const [layout] = layoutTextRegions(element);

    expect(layout.lines).toEqual(["a", "b", "c"]);
    expect(layout.height).toBe(LINE_HEIGHT_PX * 3);
    expect(layout.y - element.y).toBeCloseTo(
      region.bounds.y + (region.bounds.height - layout.height) / 2,
    );
  });

  it("旋转元素的布局左上角绕元素中心旋转", () => {
    const element = makeElement();
    const [region] = getTextRegions(element);
    const [unrotated] = layoutTextRegions(element);
    const angle = (Math.PI / 2) as Radians;
    const rotated = newElementWith(element, { angle });
    const [layout] = layoutTextRegions(rotated);

    const localX = region.bounds.x + (region.bounds.width - layout.width) / 2;
    const localY = region.bounds.y + (region.bounds.height - layout.height) / 2;
    const center = pointFrom<GlobalPoint>(
      rotated.x + rotated.width / 2,
      rotated.y + rotated.height / 2,
    );
    const expected = pointRotateRads(
      pointFrom<GlobalPoint>(rotated.x + localX, rotated.y + localY),
      center,
      angle,
    );

    expect(layout.angle).toBe(angle);
    expect(layout.x).toBeCloseTo(expected[0]);
    expect(layout.y).toBeCloseTo(expected[1]);
    expect(layout.x).not.toBeCloseTo(unrotated.x);
  });

  it("fixed 适配下超长文本被截断且不超出区域高度", () => {
    const fixed = newElement({
      type: "rectangle",
      x: ELEMENT_X,
      y: ELEMENT_Y,
      width: ELEMENT_WIDTH,
      height: 30,
      textFitMode: "fixed",
    });
    const element = withText(
      fixed,
      "abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz",
    );
    const [region] = getTextRegions(element);
    const [layout] = layoutTextRegions(element);

    expect(layout.text).toContain("…");
    expect(layout.height).toBeLessThanOrEqual(region.bounds.height);
  });

  it("按 key 查找布局，未注册的区域返回 null", () => {
    const element = withText(makeElement(), "hello");

    expect(getTextRegionLayout(element, "body")).toEqual(
      layoutTextRegions(element)[0],
    );
    expect(getTextRegionLayout(element, "label")).toBeNull();
  });

  it("单行标题折叠换行并按区域宽度截断", () => {
    const process = newElement({
      type: "df-process",
      x: ELEMENT_X,
      y: ELEMENT_Y,
      width: 152,
      height: 137,
    });
    const element = newElementWith(process, {
      texts: {
        title: {
          text: "first line\nsecond line that is far too long for the header",
          style: makeStyle(),
        },
        body: { text: "body", style: makeStyle() },
      },
    });
    const title = getLocalTextRegionLayout(element, "title")!;

    expect(title.text).not.toContain("\n");
    expect(title.text).toContain("…");
    expect(title.lines).toHaveLength(1);
    expect(title.width).toBeLessThanOrEqual(
      getTextRegions(element).find((region) => region.key === "title")!.bounds
        .width,
    );
    expect(title.height).toBe(LINE_HEIGHT_PX);
  });
});

describe("layoutTextRegionsLocal", () => {
  it("坐标是元素局部坐标，不随元素位置平移", () => {
    const element = withText(makeElement(), "hello");
    const [region] = getTextRegions(element);
    const [layout] = layoutTextRegionsLocal(element);

    expect(layout.x).toBeCloseTo(
      region.bounds.x + (region.bounds.width - layout.width) / 2,
    );
    expect(layout.y).toBeCloseTo(
      region.bounds.y + (region.bounds.height - layout.height) / 2,
    );

    const moved = newElementWith(element, {
      x: ELEMENT_X + 500,
      y: ELEMENT_Y + 300,
    });
    const [movedLayout] = layoutTextRegionsLocal(moved);

    expect(movedLayout.x).toBeCloseTo(layout.x);
    expect(movedLayout.y).toBeCloseTo(layout.y);
  });

  it("旋转不改变局部坐标，场景布局才绕元素中心旋转", () => {
    const element = withText(makeElement(), "hello");
    const angle = (Math.PI / 2) as Radians;
    const rotated = newElementWith(element, { angle });
    const [local] = layoutTextRegionsLocal(element);
    const [rotatedLocal] = layoutTextRegionsLocal(rotated);
    const [scene] = layoutTextRegions(rotated);

    expect(rotatedLocal.x).toBeCloseTo(local.x);
    expect(rotatedLocal.y).toBeCloseTo(local.y);
    expect(rotatedLocal.angle).toBe(angle);
    expect(scene.x).not.toBeCloseTo(local.x);
  });

  it("空文本仍返回局部布局", () => {
    const layouts = layoutTextRegionsLocal(makeElement());

    expect(layouts).toHaveLength(1);
    expect(layouts[0].key).toBe("body");
    expect(layouts[0].text).toBe("");
  });

  it("按 key 查找局部布局，未注册的区域返回 null", () => {
    const element = withText(makeElement(), "hello");

    expect(getLocalTextRegionLayout(element, "body")).toEqual(
      layoutTextRegionsLocal(element)[0],
    );
    expect(getLocalTextRegionLayout(element, "label")).toBeNull();
  });
});
