import {
  ARROW_LABEL_FONT_SIZE_TO_MIN_WIDTH_RATIO,
  ARROW_LABEL_WIDTH_FRACTION,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  getLineHeight,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import { layoutTextBlock } from "./layout";

import type { ExcalidrawLinearElement } from "../types";

import type { TextBlockStyle, TextRegionLayout } from "./types";

/** 箭头 / 直线标签沿路径的默认位置（路径长度比例）。 */
export const DEFAULT_BOUND_TEXT_LABEL_POSITION = 0.5;

const clampLabelPosition = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;

/** 读取标签沿路径的位置；缺失或非法时回到默认值。 */
export const getLinearLabelPosition = (
  element: ExcalidrawLinearElement,
): number =>
  clampLabelPosition(
    element.texts?.label?.placement?.labelPosition ??
      DEFAULT_BOUND_TEXT_LABEL_POSITION,
  );

/** 标签的可用宽度：按线长取比例，并保证至少放得下一个字号。 */
export const getLinearLabelMaxWidth = (
  element: ExcalidrawLinearElement,
  fontSize: number,
) =>
  Math.max(
    ARROW_LABEL_WIDTH_FRACTION * element.width,
    fontSize * ARROW_LABEL_FONT_SIZE_TO_MIN_WIDTH_RATIO,
  );

/** 标签样式：居中单块文本，颜色缺省跟随元素 ink。 */
export const getLinearLabelStyle = (
  element: ExcalidrawLinearElement,
  defaultStyle?: TextBlockStyle,
): TextBlockStyle => {
  const base: TextBlockStyle = element.texts?.label?.style ??
    defaultStyle ?? {
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
      textAlign: "center",
      verticalAlign: "middle",
    };
  return {
    ...base,
    textAlign: "center",
    verticalAlign: "middle",
    color: base.color ?? element.strokeColor,
  };
};

/**
 * 标签布局：文本块以路径锚点为中心，且不随元素旋转（始终保持水平）。
 * 锚点已是场景坐标，这里先反向绕元素中心旋转成局部左上角，交给
 * `localLayoutToScene` 再正向旋转回来。
 */
export const layoutLinearLabel = ({
  element,
  anchor,
  style,
}: {
  element: ExcalidrawLinearElement;
  anchor: GlobalPoint;
  style: TextBlockStyle;
}): TextRegionLayout => {
  const maxWidth = getLinearLabelMaxWidth(element, style.fontSize);
  const layout = layoutTextBlock({
    text: element.texts?.label?.text ?? "",
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    maxWidth,
    wrap: "wrap",
    growWidth: false,
  });

  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const topLeft = pointFrom<GlobalPoint>(
    anchor[0] - layout.width / 2,
    anchor[1] - layout.height / 2,
  );
  const [localX, localY] = pointRotateRads(
    topLeft,
    center,
    -element.angle as Radians,
  );

  return {
    key: "label",
    text: layout.text,
    lines: layout.lines,
    x: localX - element.x,
    y: localY - element.y,
    width: layout.width,
    height: layout.height,
    angle: 0 as Radians,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    ...(style.fontWeight !== undefined ? { fontWeight: style.fontWeight } : {}),
    lineHeight: style.lineHeight,
    textAlign: "center",
    verticalAlign: "middle",
    color: style.color ?? element.strokeColor,
    maxWidth,
  };
};
