import { FONT_FAMILY } from "@excalidraw/common";

import { layoutTextBlock, normalizeSingleLineText } from "../src/text/layout";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";

import type { TextBlockLayoutOptions } from "../src/text/layout";
import type { UnitlessLineHeight } from "../src/text/types";

// 10px/字符（fontSize 20 * 0.5），让换行与截断结果完全确定
setCustomTextMetricsProvider({
  getLineWidth: (text, font) => text.length * parseFloat(font) * 0.5,
});

const LINE_HEIGHT = 1.25 as UnitlessLineHeight;

const baseOptions = (
  overrides: Partial<TextBlockLayoutOptions>,
): TextBlockLayoutOptions => ({
  text: "",
  fontSize: 20,
  fontFamily: FONT_FAMILY.Virgil,
  lineHeight: LINE_HEIGHT,
  maxWidth: 100,
  wrap: "wrap",
  ...overrides,
});

describe("layoutTextBlock", () => {
  it("returns a single empty line for empty text", () => {
    const layout = layoutTextBlock(baseOptions({ text: "" }));

    expect(layout.text).toBe("");
    expect(layout.lines).toEqual([""]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(25);
    expect(layout.lineHeightPx).toBe(25);
  });

  it("keeps hard line breaks and measures the longest line when growing", () => {
    const layout = layoutTextBlock(
      baseOptions({ text: "short\nlonger line", growWidth: true }),
    );

    expect(layout.text).toBe("short\nlonger line");
    expect(layout.lines).toEqual(["short", "longer line"]);
    expect(layout.width).toBe(110);
    expect(layout.height).toBe(50);
  });

  it("preserves empty hard lines when growing", () => {
    const layout = layoutTextBlock(
      baseOptions({ text: "a\n\nb", growWidth: true }),
    );

    expect(layout.lines).toEqual(["a", "", "b"]);
    expect(layout.height).toBe(75);
  });

  it("wraps long text within maxWidth", () => {
    const layout = layoutTextBlock(
      baseOptions({ text: "one two three", wrap: "wrap", maxWidth: 50 }),
    );

    expect(layout.lines).toEqual(["one", "two", "three"]);
    expect(layout.text).toBe("one\ntwo\nthree");
    expect(layout.width).toBe(50);
    expect(layout.height).toBe(75);
  });

  it("truncates to maxHeight and appends an ellipsis", () => {
    const layout = layoutTextBlock(
      baseOptions({
        text: "aaaaaaaaaa bbbbbbbbbb cccccccccc",
        wrap: "truncate",
        maxWidth: 100,
        maxHeight: 50,
      }),
    );

    expect(layout.lines).toEqual(["aaaaaaaaaa", "bbbbbbbbb…"]);
    expect(layout.text).toBe("aaaaaaaaaa\nbbbbbbbbb…");
    expect(layout.width).toBe(100);
    expect(layout.height).toBe(50);
  });

  it("does not truncate when maxHeight is omitted", () => {
    const layout = layoutTextBlock(
      baseOptions({
        text: "aaaaaaaaaa bbbbbbbbbb",
        wrap: "truncate",
        maxWidth: 100,
      }),
    );

    expect(layout.lines).toEqual(["aaaaaaaaaa", "bbbbbbbbbb"]);
    expect(layout.height).toBe(50);
  });

  it("collapses line breaks into a single line for single-line regions", () => {
    const layout = layoutTextBlock(
      baseOptions({
        text: "first\nsecond\nthird",
        wrap: "single-line",
        maxWidth: 200,
      }),
    );

    expect(layout.text).toBe("first second third");
    expect(layout.lines).toEqual(["first second third"]);
    expect(layout.width).toBe(180);
    expect(layout.height).toBe(25);
  });
});

describe("normalizeSingleLineText", () => {
  it("replaces line breaks with a single space", () => {
    expect(normalizeSingleLineText("line1\nline2")).toBe("line1 line2");
    expect(normalizeSingleLineText("line1\r\nline2")).toBe("line1 line2");
  });

  it("folds surrounding whitespace around each line break", () => {
    expect(normalizeSingleLineText("  a \r\n b  \n\n c ")).toBe("  a b c ");
  });
});
