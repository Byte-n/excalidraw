import type { Radians } from "@excalidraw/math";

import type { FontFamilyValues, TextAlign, VerticalAlign } from "../types";

/** 无单位行高，乘以字号得到像素值。 */
export type UnitlessLineHeight = number & { _brand: "unitlessLineHeight" };

/** 元素内部文本区域的命名；key 只在所属元素内部有意义。 */
export type TextRegionKey =
  | "body"
  | "title"
  | "label"
  | `cell:${string}`
  | `row:${string}`;

/** 一个文本区域持久化的完整状态；布局结果全部是派生值。 */
export type TextBlock = Readonly<{
  /** 唯一事实来源；换行后的显示文本由布局派生。 */
  text: string;
  style: TextBlockStyle;
  /** 仅当区域定义无法推导时才存，例如箭头标签沿路径的位置。 */
  placement?: Readonly<{
    labelPosition?: number;
    /** 用户设定的字号，作为便签 fit 的搜索上限。 */
    baseFontSize?: number;
  }>;
}>;

export type TextBlockStyle = Readonly<{
  fontFamily: FontFamilyValues;
  fontSize: number;
  fontWeight?: number;
  lineHeight: UnitlessLineHeight;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  /** 缺省 = 跟随元素 ink。 */
  color?: string;
}>;

/** 元素自己拥有的全部文本区域；不存在即无文本。 */
export type TextBlockMap = Readonly<Partial<Record<TextRegionKey, TextBlock>>>;

/** 元素局部坐标中的矩形。 */
export type TextRegionRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type TextWrapMode = "wrap" | "truncate" | "single-line";

/** 文本超出区域后，元素几何是否继续增长。 */
export type TextOverflowMode = "grow" | "clip";

/** 文本变化驱动哪一级几何重排。 */
export type TextReflowMode = "none" | "element" | "rows" | "graph";

export type TextRegionDefinition = Readonly<{
  key: TextRegionKey;
  bounds: TextRegionRect;
  wrap: TextWrapMode;
  overflow: TextOverflowMode;
  reflow: TextReflowMode;
  editable: boolean;
  /**
   * 区域文本自身的绘制角度（绝对场景角度）；缺省跟随元素角度。
   * 沿路径的标签始终水平，因此显式记为 0。
   */
  angle?: Radians;
}>;

/** 正在编辑的文本区域：元素 id + 该元素内部的区域 key。 */
export type TextEditingTarget = Readonly<{
  elementId: string;
  region: TextRegionKey;
}>;

/** 一次区域文本编辑会话。 */
export type TextEditingSession = Readonly<{
  target: TextEditingTarget;
  /** 开始编辑时的文本，用于取消/比较 */
  initialText: string;
  /** 当前区域样式（已有 block 或工具默认） */
  style: TextBlockStyle;
}>;

export type TextRegionLayout = Readonly<{
  key: TextRegionKey;
  text: string;
  lines: readonly string[];
  x: number;
  y: number;
  width: number;
  height: number;
  angle: Radians;
  fontSize: number;
  fontFamily: FontFamilyValues;
  fontWeight?: number;
  lineHeight: UnitlessLineHeight;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  color: string;
  maxWidth?: number;
  maxHeight?: number;
}>;
