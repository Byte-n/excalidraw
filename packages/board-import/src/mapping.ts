// 飞书语义 → Excalidraw 原生模型的静态对照表。
//
// 三张表：基础 / 流程图图形的 `composite_shape.type` → `shape.id`；连线箭头
// `arrow_style` → fork 的 `Arrowhead`；颜色开关点。本文件不构造元素，只做
// 查表；未知键由调用方决定降级方式。

import {
  buildShapeData,
  isShapeId,
  shapeElementType,
} from "@excalidraw/element";

import type {
  Arrowhead,
  ShapeData,
  ShapeElementType,
} from "@excalidraw/element/types";

// 查表结果：元素顶层 type 与持久化 shape 载荷，由 family 派生保持一致。
export interface ResolvedCompositeShape {
  type: ShapeElementType;
  shape: ShapeData;
}

// 基础图形（28 项，来自 composite-shape 映射表）。`triangle` / `right_triangle`
// 共用持久化 ID `triangle`，靠 `apexX` 区分：直角在左为 0，居中为 0.5。
const BASIC_SHAPE_BY_LARK: Record<string, ShapeData> = {
  cube: buildShapeData("cube"),
  cross: buildShapeData("cross"),
  brace_reverse: buildShapeData("brace-reverse"),
  brace: buildShapeData("brace"),
  cloud: buildShapeData("cloud"),
  double_arrow: buildShapeData("double-arrow"),
  forward_arrow: buildShapeData("forward-arrow"),
  backward_arrow: buildShapeData("backward-arrow"),
  octagon: buildShapeData("octagon"),
  pentagon: buildShapeData("pentagon"),
  hexagon: buildShapeData("hexagon"),
  star: buildShapeData("star"),
  triangle: { id: "triangle", schemaVersion: 1, triangle: { apexX: 0.5 } },
  right_triangle: { id: "triangle", schemaVersion: 1, triangle: { apexX: 0 } },
  round_rect: buildShapeData("round-rect"),
  rect_bubble: buildShapeData("rectangle-bubble"),
  round_rect2: buildShapeData("pill"),
  bubble: buildShapeData("bubble"),
  diamond: buildShapeData("diamond"),
  trapezoid: buildShapeData("trapezoid"),
  rect: buildShapeData("rectangle"),
  parallelogram: buildShapeData("parallelogram"),
  ellipse: buildShapeData("ellipse"),
  step2: buildShapeData("right-pentagon"),
  cylinder: buildShapeData("cylinder"),
  step: buildShapeData("step"),
  circular_ring: buildShapeData("circular-ring"),
  pie: buildShapeData("pie"),
};

// 流程图图形（14 项，来自 flow-chart 映射表）。
const FLOWCHART_SHAPE_BY_LARK: Record<string, ShapeData> = {
  flow_chart_round_rect: buildShapeData("fc-round-rect"),
  flow_chart_round_rect2: buildShapeData("fc-terminator"),
  flow_chart_diamond: buildShapeData("fc-diamond"),
  document_shape: buildShapeData("fc-document"),
  flow_chart_parallelogram: buildShapeData("fc-parallelogram"),
  flow_chart_cylinder: buildShapeData("fc-cylinder"),
  horiz_cylinder: buildShapeData("fc-horiz-cylinder"),
  predefined_process: buildShapeData("fc-predefined-process"),
  manual_input: buildShapeData("fc-manual-input"),
  flow_chart_trapezoid: buildShapeData("fc-trapezoid"),
  delay_shape: buildShapeData("fc-delay"),
  flow_chart_hexagon: buildShapeData("fc-hexagon"),
  off_page_connector: buildShapeData("fc-off-page-connector"),
  flow_chart_mq: buildShapeData("fc-circle"),
};

// 未知 / 未登记图形类型的降级目标：普通矩形，保证图形仍可编辑。
export const FALLBACK_SHAPE: ShapeData = buildShapeData("rectangle");

// 查表：飞书 `composite_shape.type` → 元素 type + shape 载荷；未命中返回 undefined。
export function resolveCompositeShape(
  shapeType: string | undefined,
): ResolvedCompositeShape | undefined {
  if (shapeType === undefined) {
    return undefined;
  }
  const shape =
    BASIC_SHAPE_BY_LARK[shapeType] ?? FLOWCHART_SHAPE_BY_LARK[shapeType];
  if (shape === undefined || !isShapeId(shape.id)) {
    return undefined;
  }
  return { type: shapeElementType(shape.id), shape };
}

// 连线箭头对照表。`single_arrow` 无 fork 等价物，回落到 `arrow`；`none` 表示
// 该端不画箭头。未命中一律回落 `arrow`。
const ARROWHEAD_BY_LARK: Record<string, Arrowhead | null> = {
  none: null,
  line_arrow: "arrow",
  triangle_arrow: "triangle",
  empty_triangle_arrow: "triangle_outline",
  circle_arrow: "circle",
  empty_circle_arrow: "circle_outline",
  diamond_arrow: "diamond",
  empty_diamond_arrow: "diamond_outline",
  x_arrow: "x_arrow",
  multi_arrow: "cardinality_many",
  single_arrow: "arrow",
  single_or_multi_arrow: "cardinality_one_or_many",
  zero_or_multi_arrow: "cardinality_zero_or_many",
  zero_or_single_arrow: "cardinality_zero_or_one",
  exact_single_arrow: "cardinality_exactly_one",
};

// 连线端点箭头映射结果：`arrowhead` 为落到的 fork 取值；`downgraded` 标记发生
// 了保真度损失（无法一一对应而回落）。
export interface ArrowheadMapping {
  arrowhead: Arrowhead | null;
  downgraded: boolean;
}

// 连线端点箭头映射；缺失按 `none`（不画箭头）处理。`single_arrow` 无 fork
// 等价物，回落 `arrow` 并计一次降级；其余 14 种一一对应。
export function mapArrowhead(style: string | undefined): ArrowheadMapping {
  if (style === undefined) {
    return { arrowhead: null, downgraded: false };
  }
  if (style === "single_arrow") {
    return { arrowhead: "arrow", downgraded: true };
  }
  if (!(style in ARROWHEAD_BY_LARK)) {
    return { arrowhead: "arrow", downgraded: true };
  }
  return { arrowhead: ARROWHEAD_BY_LARK[style], downgraded: false };
}

// 颜色开关点（默认保留飞书原色）。若要归一化到项目色板，只需在此集中改写。
// `mapFillColor`：飞书 `fill_color` → 元素背景色；缺省回落透明。
export function mapFillColor(fillColor: string | undefined): string {
  return fillColor ?? "transparent";
}

// `mapStrokeColor`：飞书 `border_color` → 元素描边色；缺省由调用方给项目默认。
export function mapStrokeColor(
  borderColor: string | undefined,
  fallback: string,
): string {
  return borderColor ?? fallback;
}

// 边框粗细：`narrow` → 1，`extra_narrow` → 0.5，缺省 1。
export function mapStrokeWidth(width: string | undefined): number {
  if (width === "extra_narrow") {
    return 0.5;
  }
  return 1;
}

// 边框线型：`solid` / `dash` → 元素 strokeStyle，`none` 保持实线（描边色另行透明化）。
export function mapStrokeStyle(
  style: string | undefined,
): "solid" | "dashed" | "dotted" {
  return style === "dash" ? "dashed" : "solid";
}

// 连线走向：飞书 `connector.shape` → fork 线性元素的走向。
export type ConnectorRouting = "straight" | "polyline" | "curve";

export interface ConnectorShapeResolution {
  routing: ConnectorRouting;
  downgraded: boolean;
}

// 走向分派：`right_angled_polyline` 是直角折线，其 `turning_points` 已是完整点
// 序列，直角折线在场景里就是「折点即直角」的折线，故与 `polyline` 共用同一条
// 构造路径，不算保真度损失；未知走向按折线保留折点绘制并计一次损失，不丢弃。
// 折点缺失时折线退化为直线，仅 `right_angled_polyline` 与未知走向把它记为损失。
export function resolveConnectorShape(
  shape: string | undefined,
  hasBends: boolean,
): ConnectorShapeResolution {
  switch (shape) {
    case undefined:
    case "straight":
      return { routing: "straight", downgraded: false };
    case "curve":
      return { routing: "curve", downgraded: false };
    case "polyline":
      return { routing: hasBends ? "polyline" : "straight", downgraded: false };
    case "right_angled_polyline":
      return {
        routing: hasBends ? "polyline" : "straight",
        downgraded: !hasBends,
      };
    default:
      return { routing: hasBends ? "polyline" : "straight", downgraded: true };
  }
}
