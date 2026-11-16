import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  getFontString,
  getLineHeight,
} from "@excalidraw/common";

import {
  getTextHeight,
  getTextWidth,
  setCustomTextMetricsProvider,
  wrapText,
} from "@excalidraw/element";

import type { FontFamilyValues } from "@excalidraw/element/types";

import {
  CanvasTextFitInputSchema,
  CanvasTextMeasureInputSchema,
  parseInput,
} from "./schemas.js";
import { resolveFontFamily } from "./skeleton.js";

import type { CanvasTextApi, CanvasTextStyleInput } from "./types.js";

let headlessMetricsInstalled = false;

/** Node 端确定性估算度量；同一进程只注入一次。 */
export const ensureHeadlessTextMetrics = () => {
  if (typeof document !== "undefined" || headlessMetricsInstalled) {
    return;
  }
  headlessMetricsInstalled = true;
  setCustomTextMetricsProvider({
    getLineWidth: (text, fontString) => {
      const match = /(\d+(?:\.\d+)?)px/.exec(fontString);
      const fontSize = match ? Number(match[1]) : DEFAULT_FONT_SIZE;
      return text.length * fontSize * 0.6;
    },
  });
};

const resolveStyle = (style?: CanvasTextStyleInput) => {
  const fontFamily = (
    style?.fontFamily === undefined
      ? DEFAULT_FONT_FAMILY
      : resolveFontFamily(style.fontFamily)
  ) as FontFamilyValues;
  const fontSize = style?.fontSize ?? DEFAULT_FONT_SIZE;
  const lineHeight = style?.lineHeight ?? getLineHeight(fontFamily);
  return {
    fontFamily,
    fontSize,
    lineHeight,
    font: getFontString({ fontSize, fontFamily }),
  };
};

const measureLines = (text: string, style?: CanvasTextStyleInput) => {
  const { fontSize, lineHeight, font } = resolveStyle(style);
  return {
    width: getTextWidth(text, font),
    height: getTextHeight(
      text,
      fontSize,
      lineHeight as Parameters<typeof getTextHeight>[2],
    ),
    lineHeight,
    lines: text.split("\n").length,
  };
};

export const createTextApi = (): CanvasTextApi => ({
  measure: async (input) => {
    const parsed = parseInput(CanvasTextMeasureInputSchema, input);
    return measureLines(parsed.text, parsed.style);
  },
  fit: async (input) => {
    const parsed = parseInput(CanvasTextFitInputSchema, input);
    const { fontSize, lineHeight, font } = resolveStyle(parsed.style);
    const lineHeightPx = fontSize * lineHeight;
    const wrapped = wrapText(parsed.text, font, parsed.maxWidth);
    let lines = wrapped.split("\n");
    let truncated = false;
    if (
      parsed.maxHeight !== undefined &&
      lines.length * lineHeightPx > parsed.maxHeight
    ) {
      const keep = Math.max(0, Math.floor(parsed.maxHeight / lineHeightPx));
      lines = lines.slice(0, keep);
      truncated = true;
    }
    return {
      text: lines.join("\n"),
      lines,
      width: lines.reduce(
        (width, line) => Math.max(width, getTextWidth(line, font)),
        0,
      ),
      height: lines.length * lineHeightPx,
      truncated,
    };
  },
});
