import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  getLineHeight,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import { getStickyNoteTextFit } from "../stickyNote";
import {
  getTableCellTextBaseStyle,
  resolveTableCellTextStyle,
} from "../tableTextStyle";
import { getVisibleTableCell } from "../tableStruct";
import {
  isStickyNoteElement,
  isLinearElement,
  isTableElement,
} from "../typeChecks";
import { isSequenceFragmentElement } from "../compositeShape/sequenceOutline";
import { LinearElementEditor } from "../linearElementEditor";

import { parseTextRegionKey } from "./keys";
import { layoutTextBlock } from "./layout";
import { getTextBlock } from "./ops";
import { getTextRegion, getTextRegions } from "./regions";

import type { ElementsMap, ExcalidrawElement } from "../types";

import type {
  TextBlockStyle,
  TextRegionDefinition,
  TextRegionKey,
  TextRegionLayout,
} from "./types";

export type TextRegionLayoutOptions = Readonly<{
  /** 区域没有文本时使用的样式（例如当前工具状态） */
  defaultStyle?: TextBlockStyle;
  /** 线性元素标签沿路径取点所需的场景元素表 */
  elementsMap?: ElementsMap;
}>;

/** 区域没有文本也没有默认样式时的兜底样式。 */
const FALLBACK_STYLE: TextBlockStyle = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
  textAlign: "center",
  verticalAlign: "middle",
};

/** 在区域矩形内按对齐方式求文本块左上角的元素局部坐标。 */
const getLocalOrigin = (
  region: TextRegionDefinition,
  style: TextBlockStyle,
  width: number,
  height: number,
) => {
  const { bounds } = region;
  const x =
    style.textAlign === "left"
      ? bounds.x
      : style.textAlign === "right"
      ? bounds.x + bounds.width - width
      : bounds.x + (bounds.width - width) / 2;
  const y =
    style.verticalAlign === "top"
      ? bounds.y
      : style.verticalAlign === "bottom"
      ? bounds.y + bounds.height - height
      : bounds.y + (bounds.height - height) / 2;
  return { x, y };
};

/** 把元素局部坐标转到场景坐标：先平移，再绕元素中心旋转。 */
const toScenePoint = (
  element: ExcalidrawElement,
  localX: number,
  localY: number,
): GlobalPoint => {
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  return pointRotateRads(
    pointFrom<GlobalPoint>(element.x + localX, element.y + localY),
    center,
    element.angle,
  );
};

/** 区域的有效样式：表格格额外套用行/列覆盖与表头带权重。 */
const resolveRegionStyle = (
  element: ExcalidrawElement,
  region: TextRegionDefinition,
  options?: TextRegionLayoutOptions,
): TextBlockStyle => {
  const block = getTextBlock(element.texts, region.key);
  if (isTableElement(element)) {
    const parsed = parseTextRegionKey(region.key);
    const cell =
      parsed?.kind === "cell"
        ? getVisibleTableCell(element.table, parsed.cellId)
        : null;
    if (cell) {
      return resolveTableCellTextStyle(
        element.table,
        cell,
        block?.style ?? options?.defaultStyle ?? getTableCellTextBaseStyle(),
      );
    }
  }
  if (isSequenceFragmentElement(element) && region.key !== "body") {
    // 片段行文本对齐固定在左上角，不随默认样式变化
    const style = block?.style ?? options?.defaultStyle ?? FALLBACK_STYLE;
    return {
      ...style,
      textAlign: "left",
      verticalAlign: "top",
    };
  }
  return block?.style ?? options?.defaultStyle ?? FALLBACK_STYLE;
};

/** 区域布局；x/y 为元素局部坐标（不旋转、不含元素平移）。 */
const layoutTextRegionLocal = (
  element: ExcalidrawElement,
  region: TextRegionDefinition,
  options?: TextRegionLayoutOptions,
): TextRegionLayout => {
  // 线性元素的标签沿路径锚点排版，且始终保持水平
  if (region.key === "label" && isLinearElement(element)) {
    return LinearElementEditor.getLabelLayout(element, options?.elementsMap, {
      defaultStyle: options?.defaultStyle,
    });
  }

  const block = getTextBlock(element.texts, region.key);
  const style = resolveRegionStyle(element, region, options);

  // 便签正文走字号自适应：一边换行一边在区域内缩小字号，
  // 因此字号是布局结果而不是样式输入。
  const fit = isStickyNoteElement(element)
    ? getStickyNoteTextFit(
        block?.text ?? "",
        style,
        region.bounds.width,
        region.bounds.height,
      )
    : null;

  // 固定高度的区域超出后必须截断，否则会溢出文本安全区；
  // 单行区域始终按单行折叠与截断，与 fit 无关。
  const wrap =
    region.wrap === "single-line"
      ? "single-line"
      : region.fit === "fixed"
      ? "truncate"
      : region.wrap;
  const layout =
    fit ??
    layoutTextBlock({
      text: block?.text ?? "",
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight:
        isTableElement(element) || isSequenceFragmentElement(element)
          ? style.fontWeight
          : undefined,
      lineHeight: style.lineHeight,
      maxWidth: region.bounds.width,
      maxHeight: region.fit === "fixed" ? region.bounds.height : undefined,
      wrap,
      growWidth: false,
    });

  const origin = getLocalOrigin(region, style, layout.width, layout.height);

  return {
    key: region.key,
    text: layout.text,
    lines: layout.lines,
    x: origin.x,
    y: origin.y,
    width: layout.width,
    height: layout.height,
    angle: region.angle ?? element.angle,
    fontSize: fit ? fit.fontSize : style.fontSize,
    fontFamily: style.fontFamily,
    ...(style.fontWeight !== undefined ? { fontWeight: style.fontWeight } : {}),
    lineHeight: style.lineHeight,
    textAlign: style.textAlign,
    verticalAlign: style.verticalAlign,
    color: style.color ?? element.strokeColor,
    maxWidth: region.bounds.width,
    maxHeight: region.bounds.height,
  };
};

/** 元素全部文本区域的局部布局；没有注册区域时返回空数组。 */
export const layoutTextRegionsLocal = (
  element: ExcalidrawElement,
  options?: TextRegionLayoutOptions,
): readonly TextRegionLayout[] =>
  getTextRegions(element).map((region) =>
    layoutTextRegionLocal(element, region, options),
  );

/** 按 key 查找单个区域的局部布局；元素没有该区域时返回 null。 */
export const getLocalTextRegionLayout = (
  element: ExcalidrawElement,
  key: TextRegionKey,
  options?: TextRegionLayoutOptions,
): TextRegionLayout | null => {
  const region = getTextRegion(element, key);
  return region ? layoutTextRegionLocal(element, region, options) : null;
};

/** 局部布局的左上角绕元素中心旋转到场景坐标。 */
const localLayoutToScene = (
  element: ExcalidrawElement,
  layout: TextRegionLayout,
): TextRegionLayout => {
  const [x, y] = toScenePoint(element, layout.x, layout.y);
  return { ...layout, x, y };
};

/** 元素全部文本区域的场景布局；没有注册区域时返回空数组。 */
export const layoutTextRegions = (
  element: ExcalidrawElement,
  options?: TextRegionLayoutOptions,
): readonly TextRegionLayout[] =>
  layoutTextRegionsLocal(element, options).map((layout) =>
    localLayoutToScene(element, layout),
  );

/** 按 key 查找单个区域的场景布局；元素没有该区域时返回 null。 */
export const getTextRegionLayout = (
  element: ExcalidrawElement,
  key: TextRegionKey,
  options?: TextRegionLayoutOptions,
): TextRegionLayout | null => {
  const layout = getLocalTextRegionLayout(element, key, options);
  return layout ? localLayoutToScene(element, layout) : null;
};
