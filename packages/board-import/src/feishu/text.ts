// 文本投影与文本元素构造。
//
// 扁平 text 对象字段直接进入投影；rich_text 按段落拼合为多行纯文本后填入
// text，每次压平回调一次（供保真度统计）。容器内文本的锚点坐标由对齐比例
// 给定，newTextElement 再按度量回退；独立文本按节点宽高覆盖度量结果。

import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from "@excalidraw/common";

import { newTextElement } from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  TextAlign,
  VerticalAlign,
} from "@excalidraw/element/types";

import { identity } from "./identity.js";

import type { ResolvedNode } from "./resolve.js";
import type { LarkNodeRichTextParagraph, LarkNodeText } from "../source.js";

// 节点内嵌 / 附属文本的归一化投影。
export interface ProjectedText {
  text: string;
  fontSize?: number;
  fontWeight?: string;
  horizontalAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "mid" | "bottom";
  italic?: boolean;
  underline?: boolean;
  lineThrough?: boolean;
  textColor?: string;
  textBackgroundColorType?: number;
  richTextFlattened?: boolean;
}

export function mapTextAlign(
  align: ProjectedText["horizontalAlign"],
): TextAlign {
  return align ?? "left";
}

export function mapVerticalAlign(
  align: ProjectedText["verticalAlign"],
): VerticalAlign {
  return align === "mid" ? "middle" : align === "bottom" ? "bottom" : "top";
}

// 扁平 text 对象 → 投影；rich_text 存在时按段落拼合多行纯文本，样式回落到
// 节点级 text 字段。
export function projectText(
  text: LarkNodeText | undefined,
  onRichText: () => void,
): ProjectedText | undefined {
  if (!text) {
    return undefined;
  }
  const result: ProjectedText = {
    text: typeof text.text === "string" ? text.text : "",
  };
  if (typeof text.font_size === "number") {
    result.fontSize = text.font_size;
  }
  if (typeof text.font_weight === "string") {
    result.fontWeight = text.font_weight;
  }
  if (
    text.horizontal_align === "left" ||
    text.horizontal_align === "center" ||
    text.horizontal_align === "right"
  ) {
    result.horizontalAlign = text.horizontal_align;
  }
  if (
    text.vertical_align === "top" ||
    text.vertical_align === "mid" ||
    text.vertical_align === "bottom"
  ) {
    result.verticalAlign = text.vertical_align;
  }
  if (typeof text.italic === "boolean") {
    result.italic = text.italic;
  }
  if (typeof text.underline === "boolean") {
    result.underline = text.underline;
  }
  if (typeof text.line_through === "boolean") {
    result.lineThrough = text.line_through;
  }
  if (typeof text.text_color === "string") {
    result.textColor = text.text_color;
  }
  if (typeof text.text_background_color_type === "number") {
    result.textBackgroundColorType = text.text_background_color_type;
  }

  const paragraphs = text.rich_text?.paragraphs;
  if (Array.isArray(paragraphs) && paragraphs.length > 0) {
    const lines = paragraphs.map((p) => paragraphToLine(p)).filter((l) => l);
    if (lines.length > 0) {
      result.text = lines.join("\n");
      result.richTextFlattened = true;
      onRichText();
    }
  }

  return result;
}

// 单段富文本：按 elements 拼成一行纯文本（run 级样式丢弃）。
export function paragraphToLine(paragraph: LarkNodeRichTextParagraph): string {
  const elements = paragraph.elements;
  if (!Array.isArray(elements)) {
    return "";
  }
  return elements
    .map((e) =>
      typeof e.text_element?.text === "string" ? e.text_element.text : "",
    )
    .join("");
}

// 容器内文本的锚点坐标：中心 / 右 / 底由比例给定，newTextElement 再按度量回退。
export function containerAnchor(
  box: { x: number; y: number; width: number; height: number },
  text: ProjectedText | undefined,
): { x: number; y: number } {
  const align = mapTextAlign(text?.horizontalAlign);
  const vertical = mapVerticalAlign(text?.verticalAlign);
  return {
    x:
      box.x +
      box.width * (align === "center" ? 0.5 : align === "right" ? 1 : 0),
    y:
      box.y +
      box.height *
        (vertical === "middle" ? 0.5 : vertical === "bottom" ? 1 : 0),
  };
}

// 独立文本元素：文本盒尺寸取节点宽高（客户端会重算），故覆盖构造器的度量结果。
export function buildStandaloneText(
  id: string,
  node: ResolvedNode,
  text: ProjectedText,
): ExcalidrawTextElement {
  const element = newTextElement({
    text: text.text,
    fontSize: text.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: mapTextAlign(text.horizontalAlign),
    verticalAlign: mapVerticalAlign(text.verticalAlign),
    containerId: null,
    autoResize: false,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...identity(id, node.angle),
  });
  return {
    ...element,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
}

// 形状 / 便签 / 思维导图节点内嵌文本：containerId 指向容器，容器侧登记
// boundElements。
export function buildBoundText(
  id: string,
  text: ProjectedText,
  containerNode: ResolvedNode,
): ExcalidrawTextElement {
  const anchor = containerAnchor(containerNode, text);
  return newTextElement({
    text: text.text,
    fontSize: text.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: mapTextAlign(text.horizontalAlign),
    verticalAlign: mapVerticalAlign(text.verticalAlign),
    containerId: containerNode.raw.id,
    x: anchor.x,
    y: anchor.y,
    ...identity(id, 0),
  });
}
