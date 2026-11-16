import { getFontSizeFromFontString, getFontString } from "@excalidraw/common";

import {
  getLineHeightInPx,
  getLineWidth,
  measureText,
  normalizeText,
} from "../textMeasurements";
import { getWrappedTextLines, wrapText } from "../textWrapping";

import type { FontFamilyValues } from "../types";

import type { TextWrapMode, UnitlessLineHeight } from "./types";

/** 把硬换行折叠成单个空格，用于单行区域。 */
export const normalizeSingleLineText = (text: string) =>
  text.replace(/\s*[\r\n]+\s*/g, " ");

/**
 * 在给定宽高内换行并截断，超出部分以省略号结尾。
 *
 * 宽度或高度非正时返回空串；高度不足一行时仍保留一行加省略号。
 */
export const truncateTextToBounds = (
  text: string,
  font: ReturnType<typeof getFontString>,
  lineHeight: UnitlessLineHeight,
  maxWidth: number,
  maxHeight: number,
) => {
  if (!text || maxWidth <= 0 || maxHeight <= 0) {
    return "";
  }
  const lines = wrapText(text, font, maxWidth).split("\n");
  const maxLines = Math.max(
    1,
    Math.floor(maxHeight / (lineHeight * getFontSizeFromFontString(font))),
  );
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  const visible = lines.slice(0, maxLines);
  let last = visible[visible.length - 1] || "";
  const ellipsis = "…";
  if (getLineWidth(ellipsis, font) > maxWidth) {
    return visible.slice(0, -1).join("\n");
  }
  while (last && getLineWidth(`${last}${ellipsis}`, font) > maxWidth) {
    last = Array.from(last).slice(0, -1).join("");
  }
  visible[visible.length - 1] = `${last}${ellipsis}`;
  return visible.join("\n");
};

export type TextBlockLayoutOptions = Readonly<{
  text: string;
  fontSize: number;
  fontFamily: FontFamilyValues;
  /** 显式字重：影响渲染与测量，缺省按字体族默认字重 */
  fontWeight?: number;
  lineHeight: UnitlessLineHeight;
  /** 可用宽度；growWidth=true 时忽略 */
  maxWidth: number;
  /** 可用高度；truncate 时限制行数，缺省不限制 */
  maxHeight?: number;
  wrap: TextWrapMode;
  /** true：宽度随文字增长（不换行）；false：在 maxWidth 内换行/截断 */
  growWidth?: boolean;
}>;

export type TextBlockLayout = Readonly<{
  /** 实际显示文本（换行/截断后） */
  text: string;
  lines: readonly string[];
  width: number;
  height: number;
  lineHeightPx: number;
}>;

/** 纯函数：根据文本与可用区域计算显示行、宽高；不修改入参。 */
export const layoutTextBlock = (
  options: TextBlockLayoutOptions,
): TextBlockLayout => {
  const {
    text,
    fontSize,
    fontFamily,
    fontWeight,
    lineHeight,
    maxWidth,
    maxHeight,
    wrap,
  } = options;
  const font = getFontString({ fontSize, fontFamily, fontWeight });
  const lineHeightPx = getLineHeightInPx(fontSize, lineHeight);

  if (!text) {
    return {
      text: "",
      lines: [""],
      width: 0,
      height: lineHeightPx,
      lineHeightPx,
    };
  }

  const normalized = normalizeText(text);

  // 自由文字自动宽度：按硬换行保留空行，宽度取最长行
  if (options.growWidth) {
    const metrics = measureText(normalized, font, lineHeight);
    return {
      text: normalized,
      lines: normalized.split("\n"),
      width: metrics.width,
      height: metrics.height,
      lineHeightPx,
    };
  }

  if (wrap === "wrap") {
    const lines = getWrappedTextLines(
      normalized,
      font,
      maxWidth > 0 ? maxWidth : 1,
    ).map((line) => line.text);
    const metrics = measureText(lines.join("\n"), font, lineHeight);
    return {
      text: lines.join("\n"),
      lines,
      width: metrics.width,
      height: metrics.height,
      lineHeightPx,
    };
  }

  if (wrap === "truncate") {
    const display = truncateTextToBounds(
      normalized,
      font,
      lineHeight,
      maxWidth,
      maxHeight ?? Number.POSITIVE_INFINITY,
    );
    const metrics = measureText(display, font, lineHeight);
    return {
      text: display,
      lines: display.split("\n"),
      width: metrics.width,
      height: metrics.height,
      lineHeightPx,
    };
  }

  // single-line：先折叠换行，再按一行高截断
  const display = truncateTextToBounds(
    normalizeSingleLineText(normalized),
    font,
    lineHeight,
    maxWidth,
    lineHeightPx,
  );
  return {
    text: display,
    lines: [display],
    width: measureText(display, font, lineHeight).width,
    height: lineHeightPx,
    lineHeightPx,
  };
};
