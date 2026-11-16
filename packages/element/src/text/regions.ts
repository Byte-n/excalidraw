import {
  BOUND_TEXT_PADDING,
  DEFAULT_FONT_SIZE,
  STICKY_NOTE_BODY_INSET_Y,
  STICKY_NOTE_PADDING,
  TABLE_CELL_TEXT_PADDING_X,
  TABLE_CELL_TEXT_PADDING_Y,
} from "@excalidraw/common";

import type { LocalPoint, Radians } from "@excalidraw/math";

import {
  getCompositeShapePaddedTextBounds,
  getCompositeShapeTextFitMode,
  getDataflowProcessTitleTextBounds,
  isShapeElement,
  isShapeWithId,
} from "../compositeShape";
import {
  getSequenceFragmentRowBounds,
  getSequenceFragmentRowLayout,
  getSequenceLifelineTextBounds,
  isSequenceFragmentElement,
  isSequenceLifelineElement,
} from "../compositeShape/sequenceOutline";
import { getMindmapShapeId, isMindmapLayoutFrozen } from "../mindmap";
import { getTableCellBounds } from "../tableStruct";
import { getTableCellTextPadding } from "../tableTextStyle";
import {
  isLinearElement,
  isMindmapNodeElement,
  isStickyNoteElement,
  isTableElement,
} from "../typeChecks";

import { cellKey, textRegionKey } from "./keys";
import { getLinearLabelMaxWidth } from "./labelLayout";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawTableElement,
} from "../types";

import type {
  TextRegionDefinition,
  TextRegionKey,
  TextRegionRect,
} from "./types";

const EMPTY_TEXT_REGIONS: readonly TextRegionDefinition[] = [];

/** 形状家族的正文区域：可见文本安全区，宽度内换行。 */
const getShapeTextRegions = (
  element: ExcalidrawElement,
): readonly TextRegionDefinition[] => {
  if (!isShapeElement(element)) {
    return EMPTY_TEXT_REGIONS;
  }
  return [
    {
      key: "body",
      bounds: getCompositeShapePaddedTextBounds(element),
      wrap: "wrap",
      fit: getCompositeShapeTextFitMode(element),
      editable: true,
    },
  ];
};

/**
 * `df-process` 的区域：标题栏在前、正文在后，命中测试先落到标题。
 * 标题栏固定单行高度，排版只截断、不参与元素尺寸求解。
 */
const getDataflowProcessTextRegions = (
  element: ExcalidrawElement,
): readonly TextRegionDefinition[] => [
  {
    key: "title",
    bounds: getDataflowProcessTitleTextBounds(element.width, element.height),
    wrap: "single-line",
    fit: "fixed",
    editable: true,
  },
  ...getShapeTextRegions(element),
];

/** 便签的正文区域：避开四周边距与底部页脚，宽度内换行。 */
const getStickyNoteTextRegions = (
  element: ExcalidrawElement,
): readonly TextRegionDefinition[] => {
  return [
    {
      key: "body",
      bounds: {
        x: STICKY_NOTE_PADDING,
        y: STICKY_NOTE_PADDING,
        width: Math.max(0.01, element.width - STICKY_NOTE_PADDING * 2),
        height: Math.max(0.01, element.height - STICKY_NOTE_BODY_INSET_Y),
      },
      wrap: "wrap",
      fit: "auto",
      editable: true,
    },
  ];
};

/**
 * 脑图节点的正文安全区：矩形/文字形态留固定内边距，
 * 椭圆/胶囊取内接矩形，菱形取内接矩形。x/y 与宽高各自按形态推导。
 */
const getMindmapNodeTextBounds = (
  node: ExcalidrawMindmapNodeElement,
): TextRegionRect => {
  const shapeId = getMindmapShapeId(node);
  const { width, height } = node;
  if (shapeId === "ellipse" || shapeId === "pill") {
    return {
      x: BOUND_TEXT_PADDING + (width / 2) * (1 - Math.sqrt(2) / 2),
      y: BOUND_TEXT_PADDING + (height / 2) * (1 - Math.sqrt(2) / 2),
      width: Math.max(
        0.01,
        Math.round((width / 2) * Math.sqrt(2)) - BOUND_TEXT_PADDING * 2,
      ),
      height: Math.max(
        0.01,
        Math.round((height / 2) * Math.sqrt(2)) - BOUND_TEXT_PADDING * 2,
      ),
    };
  }
  if (shapeId === "diamond") {
    return {
      x: BOUND_TEXT_PADDING + width / 4,
      y: BOUND_TEXT_PADDING + height / 4,
      width: Math.max(0.01, Math.round(width / 2) - BOUND_TEXT_PADDING * 2),
      height: Math.max(0.01, Math.round(height / 2) - BOUND_TEXT_PADDING * 2),
    };
  }
  return {
    x: BOUND_TEXT_PADDING,
    y: BOUND_TEXT_PADDING,
    width: Math.max(0.01, width - BOUND_TEXT_PADDING * 2),
    height: Math.max(0.01, height - BOUND_TEXT_PADDING * 2),
  };
};

/** 脑图节点的正文区域：宽度内换行；几何被冻结时改为定高截断。 */
const getMindmapNodeTextRegions = (
  element: ExcalidrawMindmapNodeElement,
): readonly TextRegionDefinition[] => {
  return [
    {
      key: "body",
      bounds: getMindmapNodeTextBounds(element),
      wrap: "wrap",
      fit: isMindmapLayoutFrozen(element) ? "fixed" : "auto",
      editable: true,
    },
  ];
};

/**
 * 表格的区域：每个可见格（合并区的锚点）一个，边界是格矩形按有效内边距
 * 内缩；宽度内换行、固定高度（行高由表格文本布局反向增长）。
 */
const getTableTextRegions = (
  element: ExcalidrawTableElement,
): readonly TextRegionDefinition[] => {
  const regions: TextRegionDefinition[] = [];
  for (const cell of element.table.cells) {
    if (cell.mergedInto) {
      continue;
    }
    const bounds = getTableCellBounds(element.table, cell.id);
    if (!bounds) {
      continue;
    }
    const padding = getTableCellTextPadding(element.table, cell);
    regions.push({
      key: cellKey(cell.id),
      bounds: {
        x: bounds.x + padding.x,
        y: bounds.y + padding.y,
        width: Math.max(0.01, bounds.width - padding.x * 2),
        height: Math.max(0.01, bounds.height - padding.y * 2),
      },
      wrap: "wrap",
      fit: "fixed",
      editable: true,
    });
  }
  return regions;
};

/**
 * 组合片段的区域：operator 页签是 `body`（复用形状正文安全区），每个正文行
 * 一个 `row:<rowId>`，边界是行矩形按单元格内边距内缩。
 */
const getSequenceFragmentTextRegions = (
  element: ExcalidrawElement,
): readonly TextRegionDefinition[] => {
  const regions: TextRegionDefinition[] = [...getShapeTextRegions(element)];
  if (!isSequenceFragmentElement(element)) {
    return regions;
  }
  const rows = getSequenceFragmentRowLayout(
    element.height,
    element.shape.fragment,
  ).rows;
  for (let index = 1; index < rows.length; index++) {
    const bounds = getSequenceFragmentRowBounds(
      element.width,
      element.height,
      element.shape.fragment,
      rows[index].id,
    );
    if (!bounds) {
      continue;
    }
    regions.push({
      key: textRegionKey.row(rows[index].id),
      bounds: {
        x: bounds.x + TABLE_CELL_TEXT_PADDING_X,
        y: bounds.y + TABLE_CELL_TEXT_PADDING_Y,
        width: Math.max(0.01, bounds.width - TABLE_CELL_TEXT_PADDING_X * 2),
        height: Math.max(0.01, bounds.height - TABLE_CELL_TEXT_PADDING_Y * 2),
      },
      wrap: "wrap",
      fit: "fixed",
      editable: true,
    });
  }
  return regions;
};

/**
 * 时序生命线的正文区域：只有头部安全区一个 `body`。宽度内换行，尺寸不参与
 * 通用 auto-fit —— 头部高度由生命线自己的 fit 求解。
 */
const getSequenceLifelineTextRegions = (
  element: ExcalidrawElement,
): readonly TextRegionDefinition[] => {
  if (!isSequenceLifelineElement(element)) {
    return EMPTY_TEXT_REGIONS;
  }
  return [
    {
      key: "body",
      bounds: getSequenceLifelineTextBounds(
        element.shape.id,
        element.width,
        element.shape.lifeline.headHeight,
      ),
      wrap: "wrap",
      fit: "fixed",
      editable: true,
    },
  ];
};

/**
 * 线性元素的标签区域：只有一个 `label`，沿路径锚点居中排版。
 * 区域矩形只承载可用宽度（沿路径位置由布局求解），因此高度记为 0。
 */
const getLinearLabelTextRegions = (
  element: ExcalidrawLinearElement,
): readonly TextRegionDefinition[] => [
  {
    key: "label",
    bounds: {
      x: 0,
      y: 0,
      width: getLinearLabelMaxWidth(
        element,
        element.texts?.label?.style.fontSize ?? DEFAULT_FONT_SIZE,
      ),
      height: 0,
    },
    wrap: "wrap",
    fit: "auto",
    editable: true,
    angle: 0 as Radians,
  },
];

/** 元素自己声明的全部文本区域；未注册区域的元素返回空数组。 */
export const getTextRegions = (
  element: ExcalidrawElement,
): readonly TextRegionDefinition[] =>
  isTableElement(element)
    ? getTableTextRegions(element)
    : isStickyNoteElement(element)
    ? getStickyNoteTextRegions(element)
    : isMindmapNodeElement(element)
    ? getMindmapNodeTextRegions(element)
    : isSequenceFragmentElement(element)
    ? getSequenceFragmentTextRegions(element)
    : isSequenceLifelineElement(element)
    ? getSequenceLifelineTextRegions(element)
    : isLinearElement(element)
    ? getLinearLabelTextRegions(element)
    : isShapeWithId(element, "df-process")
    ? getDataflowProcessTextRegions(element)
    : getShapeTextRegions(element);

/** 按 key 查找区域；元素没有该区域时返回 null。 */
export const getTextRegion = (
  element: ExcalidrawElement,
  key: TextRegionKey,
): TextRegionDefinition | null =>
  getTextRegions(element).find((region) => region.key === key) ?? null;

/** 主区域：优先正文，没有正文时取第一个可编辑区域。 */
export const getPrimaryTextRegion = (
  element: ExcalidrawElement,
): TextRegionDefinition | null => {
  const regions = getTextRegions(element);
  return (
    regions.find((region) => region.key === "body" && region.editable) ??
    regions.find((region) => region.editable) ??
    null
  );
};

/**
 * 命中测试：点在区域矩形内（含边界）时返回其 key。
 * localPoint 已由调用方转换到元素局部坐标，这里不做旋转与平移。
 */
export const getTextRegionAtPosition = (
  element: ExcalidrawElement,
  localPoint: LocalPoint,
): TextRegionKey | null => {
  const [x, y] = localPoint;
  for (const region of getTextRegions(element)) {
    const bounds = region.bounds;
    if (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    ) {
      return region.key;
    }
  }
  return null;
};
