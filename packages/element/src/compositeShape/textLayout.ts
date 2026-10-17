import { getCompositeShapeTextBounds } from "./registry";

import type { CompositeShapeTextBounds } from "./textBounds";
import type { ExcalidrawShapeElement } from "../types";

/**
 * Text-fit layout: the forward safe-area accessor and the reverse solvers that
 * pick dimensions whose safe area can contain a requested text block.
 */

export type CompositeShapeTextFitMode = "auto" | "fixed";
export const getCompositeShapeTextFitMode = (
  element: Pick<ExcalidrawShapeElement, "textFitMode">,
): CompositeShapeTextFitMode => element.textFitMode ?? "auto";

export const getCompositeShapeTextFitMinSize = (
  element: Pick<
    ExcalidrawShapeElement,
    "width" | "height" | "textFitMinWidth" | "textFitMinHeight"
  >,
) => ({
  width:
    Number.isFinite(element.textFitMinWidth) && element.textFitMinWidth! > 0
      ? element.textFitMinWidth!
      : element.width,
  height:
    Number.isFinite(element.textFitMinHeight) && element.textFitMinHeight! > 0
      ? element.textFitMinHeight!
      : element.height,
});
/**
 * The actual content rectangle used by text layout. Keep this as the single
 * source of truth for both forward (shape -> text area) and reverse (text area
 * -> shape size) calculations.
 */
export const getCompositeShapePaddedTextBounds = (
  element: Pick<ExcalidrawShapeElement, "width" | "height" | "shape">,
): CompositeShapeTextBounds => {
  return getCompositeShapeTextBounds(element);
};

type CompositeShapeDimension = "width" | "height";

const getCompositeShapeSizeAt = (
  element: Pick<ExcalidrawShapeElement, "width" | "height" | "shape">,
  dimension: CompositeShapeDimension,
  value: number,
) =>
  getCompositeShapePaddedTextBounds({
    ...element,
    [dimension]: value,
  } as Pick<ExcalidrawShapeElement, "width" | "height" | "shape">);

const solveCompositeShapeDimension = (
  element: Pick<ExcalidrawShapeElement, "width" | "height" | "shape">,
  dimension: CompositeShapeDimension,
  required: number,
  minimum: number,
) => {
  if (!Number.isFinite(required) || required <= 0) {
    return Math.max(minimum, element[dimension]);
  }
  const areaDimension = dimension;
  const current = Math.max(0.01, element[dimension]);
  let low = Math.max(0.01, minimum);
  let high = Math.max(current, low);
  const fits = (value: number) =>
    getCompositeShapeSizeAt(element, areaDimension, value)[areaDimension] >=
    required;

  if (fits(low)) {
    return low;
  }
  while (!fits(high) && high < 1_000_000) {
    high *= 2;
  }
  if (!fits(high)) {
    return high;
  }
  for (let i = 0; i < 28; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
};

/**
 * Returns dimensions whose forward safe area can contain the requested text.
 * The alternating solves handle shapes whose safe area depends on both axes
 * (for example cylinder and brace) without using shape-specific inverses.
 */
export const getCompositeShapeDimensionsForText = (
  element: Pick<
    ExcalidrawShapeElement,
    "width" | "height" | "shape" | "textFitMinWidth" | "textFitMinHeight"
  >,
  textWidth: number,
  textHeight: number,
) => {
  const minimum = getCompositeShapeTextFitMinSize(element);
  let width = Math.max(0.01, minimum.width);
  let height = Math.max(0.01, minimum.height);
  const shape = { ...element, width, height };
  for (let i = 0; i < 20; i++) {
    width = solveCompositeShapeDimension(
      { ...shape, width, height },
      "width",
      textWidth,
      minimum.width,
    );
    height = solveCompositeShapeDimension(
      { ...shape, width, height },
      "height",
      textHeight,
      minimum.height,
    );
  }
  const normalize = (value: number, original: number) => {
    if (value > original) {
      return Math.ceil(value - 1e-6);
    }
    return Math.abs(value - Math.round(value)) < 1e-6
      ? Math.round(value)
      : value;
  };
  return {
    width: normalize(width, element.width),
    height: normalize(height, element.height),
  };
};
