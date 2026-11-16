import { BOUND_TEXT_PADDING } from "@excalidraw/common";

import type { ExtractSetType } from "@excalidraw/common/utility-types";

import {
  getSequenceLifelineTextFit,
  type SequenceLifelineElement,
} from "./compositeShape";

import { getTextElementText } from "./text/elementText";

import { isTextElement } from "./typeChecks";

import type { ElementUpdate } from "./mutateElement";

import type { ExcalidrawElement } from "./types";

/**
 * 自适应文本布局下容器需要的尺寸：内边距、椭圆内接矩形与菱形内接矩形
 * 各自按形状换算。仅用于由文本反推容器几何。
 */
const TEXT_CONTAINER_TYPES = new Set([
  "composite",
  "flow",
  "sequence",
  "dataflow",
  "rectangle",
  "stickynote",
  "ellipse",
  "diamond",
  "arrow",
  "line",
]);

export const computeTextContainerDimension = (
  dimension: number,
  containerType: ExtractSetType<typeof TEXT_CONTAINER_TYPES>,
) => {
  dimension = Math.ceil(dimension);
  const padding = BOUND_TEXT_PADDING * 2;

  if (containerType === "ellipse") {
    return Math.round(((dimension + padding) / Math.sqrt(2)) * 2);
  }
  if (containerType === "diamond") {
    return 2 * (dimension + padding);
  }
  return dimension + padding;
};

/**
 * 自适应文本适配时序生命线：宽度固定，头部高度随换行后的文本增长（或缩小），
 * 头部底边与杆长保持不变。文本已经放得下时返回 `null`。
 */
export const getSequenceLifelineTextFitUpdates = <
  T extends SequenceLifelineElement,
>(
  container: T,
  textHeight: number,
): ElementUpdate<T> | null => {
  const headHeight = container.shape.lifeline.headHeight;
  // 生命线的 `textFitMinHeight` 存的是需要保留的头部高度（fit 维度），
  // 不是元素高度；自动模式下宽度不变，`textFitMinWidth` 仅作记录。
  const minHeadHeight =
    Number.isFinite(container.textFitMinHeight) &&
    container.textFitMinHeight! > 0
      ? container.textFitMinHeight!
      : headHeight;
  const fit = getSequenceLifelineTextFit(container, textHeight, minHeadHeight);
  if (!fit) {
    return null;
  }
  // 展开保持形状的 `id` 判别式；只有 `headHeight` 变化，联合成员不变。
  return {
    x: fit.x,
    y: fit.y,
    height: fit.height,
    shape: {
      ...container.shape,
      lifeline: { ...container.shape.lifeline, headHeight: fit.headHeight },
    },
    ...(container.textFitMinWidth === undefined && {
      textFitMinWidth: container.width,
    }),
    ...(container.textFitMinHeight === undefined && {
      textFitMinHeight: headHeight,
    }),
  } as ElementUpdate<T>;
};

/** 取出元素上的文本（独立文字与内嵌正文），用分隔符拼成单个字符串。 */
export const getTextFromElements = (
  elements: readonly ExcalidrawElement[],
  separator = "\n\n",
) => {
  const text = elements
    .reduce((acc: string[], element) => {
      if (isTextElement(element)) {
        acc.push(getTextElementText(element));
      } else if (element.texts?.body?.text) {
        acc.push(element.texts.body.text);
      }
      return acc;
    }, [])
    .join(separator);
  return text;
};
