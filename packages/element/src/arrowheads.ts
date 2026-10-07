import type { Arrowhead, AnyArrowhead } from "./types";

export const ARROWHEAD_VALUES: readonly [AnyArrowhead, ...AnyArrowhead[]] = [
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "cardinality_one",
  "cardinality_many",
  "cardinality_one_or_many",
  "cardinality_exactly_one",
  "cardinality_zero_or_one",
  "cardinality_zero_or_many",
  "dot",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
] as const;

export type { AnyArrowhead } from "./types";

export const normalizeArrowhead = (
  arrowhead: AnyArrowhead | null | undefined,
): Arrowhead | null => {
  switch (arrowhead) {
    case undefined:
    case null:
      return null;
    case "dot":
      return "circle";
    case "crowfoot_one":
      return "cardinality_one";
    case "crowfoot_many":
      return "cardinality_many";
    case "crowfoot_one_or_many":
      return "cardinality_one_or_many";
    default:
      return arrowhead;
  }
};

export const getArrowheadForPicker = (
  arrowhead: AnyArrowhead | null | undefined,
): Arrowhead | null => {
  const normalizedArrowhead = normalizeArrowhead(arrowhead);
  if (normalizedArrowhead === null) {
    return null;
  }

  return normalizedArrowhead;
};
