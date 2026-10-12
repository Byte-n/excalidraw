import type { Arrowhead } from "./types";

export const ARROWHEAD_VALUES: readonly [Arrowhead, ...Arrowhead[]] = [
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "x_arrow",
  "cardinality_one",
  "cardinality_many",
  "cardinality_one_or_many",
  "cardinality_exactly_one",
  "cardinality_zero_or_one",
  "cardinality_zero_or_many",
] as const;
