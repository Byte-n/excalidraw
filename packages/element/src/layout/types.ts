import type { ExcalidrawElement } from "../types";

export const LAYOUT_ALGORITHM_IDS = [
  "layered",
  "tree",
  "grid",
  "row",
  "column",
  "stack",
  "align",
  "distribute",
] as const;
export type LayoutAlgorithmId = typeof LAYOUT_ALGORITHM_IDS[number];

export type LayoutPoint = Readonly<{ x: number; y: number }>;
export type LayoutBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type LayoutWarning = Readonly<{
  code: string;
  message: string;
  path?: string;
}>;

export type LayoutOptions = Readonly<{
  direction?: "TB" | "LR";
  rankGap?: number;
  nodeGap?: number;
  gap?: number;
  columns?: number;
  axis?: "x" | "y";
  position?: "start" | "center" | "end";
}>;

export type LayoutRequest = Readonly<{
  ids: readonly string[];
  algorithm: LayoutAlgorithmId;
  origin?: LayoutPoint;
  options?: LayoutOptions;
}>;

export type LayoutResult = Readonly<{
  elements: readonly ExcalidrawElement[];
  bounds: LayoutBounds;
  warnings: readonly LayoutWarning[];
  affectedElementIds: readonly string[];
}>;

/** 单次布局内部使用的目标坐标。 */
export type LayoutPosition = Readonly<{ x: number; y: number }>;
