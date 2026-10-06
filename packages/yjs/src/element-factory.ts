import {
  calculateFixedPointForElbowArrowBinding,
  calculateFixedPointForNonElbowArrowBinding,
  newArrowElement,
  isElbowArrow,
  newElement,
  newLinearElement,
  newTextElement,
  setCustomTextMetricsProvider,
} from "@excalidraw/element";
import { generateNKeysBetween } from "@excalidraw/fractional-indexing";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type { SceneConnectionEndpoint } from "./scene-commands";

/** 工厂只补齐通用元素身份与索引，不解释宿主 schema 或资产授权。 */
const persistent = <T extends ExcalidrawElement>(element: T) => ({
  ...element,
  // 公共 element 类型为品牌字符串，索引生成器返回同一合法字符串格式。
  index: (element.index ??
    generateNKeysBetween(null, null, 1)[0]!) as NonNullable<
    ExcalidrawElement["index"]
  >,
});

export const createSceneElement = (options: Parameters<typeof newElement>[0]) =>
  persistent(newElement(options));
export const createSceneTextElement = (
  options: Parameters<typeof newTextElement>[0],
) => persistent(newTextElement(options));
export const createSceneLineElement = (
  options: Parameters<typeof newLinearElement>[0] & { type: "line" },
) => persistent(newLinearElement(options));
export const createSceneArrowElement = (
  options: Parameters<typeof newArrowElement>[0],
) => persistent(newArrowElement(options));

/** Node 文字度量由宿主显式注入；不初始化 canvas 或 editor。 */
export { setCustomTextMetricsProvider };

export const createSceneConnectionEndpoint = ({
  arrow,
  target,
  end,
  elements,
  mode = "orbit",
}: {
  arrow: NonDeleted<ExcalidrawArrowElement | ExcalidrawElbowArrowElement>;
  target: NonDeleted<ExcalidrawBindableElement>;
  end: "start" | "end";
  elements: ElementsMap;
  mode?: SceneConnectionEndpoint["mode"];
}): SceneConnectionEndpoint => ({
  elementId: target.id,
  mode,
  ...(isElbowArrow(arrow)
    ? calculateFixedPointForElbowArrowBinding(arrow, target, end, elements)
    : calculateFixedPointForNonElbowArrowBinding(arrow, target, end, elements)),
});
