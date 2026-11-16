import { getFontString, getLineHeight } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "../types";

import { layoutTextBlock } from "./layout";

import type { TextBlock, TextBlockStyle } from "./types";

/** 文字元素的源文本；显示用的换行结果不落盘。 */
export const getTextElementText = (element: ExcalidrawTextElement): string =>
  element.texts.body.text;

/** 文字元素的完整文本样式。 */
export const getTextElementStyle = (
  element: ExcalidrawTextElement,
): TextBlockStyle => element.texts.body.style;

/** 用户设定的字号（fit 的搜索上限）；未记录时取当前字号。 */
export const getTextElementBaseFontSize = (
  element: ExcalidrawTextElement,
): number =>
  element.texts.body.placement?.baseFontSize ??
  getTextElementStyle(element).fontSize;

/** 文字元素当前样式对应的 CSS 字体字符串。 */
export const getTextElementFont = (element: ExcalidrawTextElement) =>
  getFontString(getTextElementStyle(element));

/**
 * 文字元素要绘制的文本：自动宽度时就是源文本；固定宽度按当前宽度换行；
 * 绑定到箭头端点的独立文字按元素高度截断。
 */
export const getTextElementDisplayText = (
  element: ExcalidrawTextElement,
): string => {
  const style = getTextElementStyle(element);
  const isEndpointLabel = element.boundElements?.some(
    ({ type }) => type === "arrow",
  );
  return layoutTextBlock({
    text: getTextElementText(element),
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    maxWidth: element.width,
    ...(isEndpointLabel ? { maxHeight: element.height } : {}),
    wrap: isEndpointLabel ? "truncate" : "wrap",
    growWidth: element.autoResize && !isEndpointLabel,
  }).text;
};

/**
 * 替换文本块样式的局部字段，其余字段保持不变；改字体族时行高跟随新字体族，
 * 除非调用方同时给出了行高。
 */
export const getTextElementStylePatch = (
  element: ExcalidrawTextElement,
  patch: Partial<TextBlockStyle>,
): Readonly<{ texts: ExcalidrawTextElement["texts"] }> => {
  const style = getTextElementStyle(element);
  const nextStyle: TextBlockStyle = {
    ...style,
    ...patch,
    ...(patch.fontFamily !== undefined && patch.lineHeight === undefined
      ? { lineHeight: getLineHeight(patch.fontFamily) }
      : {}),
  };
  return {
    texts: { body: { ...element.texts.body, style: nextStyle } },
  };
};

/** 替换文本元素的源文本，样式与 placement 保持不变。 */
export const getTextElementTextPatch = (
  element: ExcalidrawTextElement,
  text: string,
): Readonly<{ texts: ExcalidrawTextElement["texts"] }> => {
  const body: TextBlock = { ...element.texts.body, text };
  return { texts: { body } };
};

/** 写入用户设定的字号；仅便签标签需要它作为 fit 的搜索上限。 */
export const getTextElementBaseFontSizePatch = (
  element: ExcalidrawTextElement,
  baseFontSize: number,
): Readonly<{ texts: ExcalidrawTextElement["texts"] }> => {
  const body = element.texts.body;
  return {
    texts: {
      body: {
        ...body,
        placement: { ...body.placement, baseFontSize },
      },
    },
  };
};
